"""Source conversion: a source's original into its outline and section files.

    convert.py ingest <original> <folder> [--limit N]

reads the original, a file the learner attached, and writes into the folder,
which must be empty and whose name is the source's id: a copy of the
original (`original.<ext>`), `outline.json` (`Outline` in
`src/shared/source.ts`) and `sections/<id>.md`. It writes one line of JSON on
standard output: {"result": "converted", ...} with the outline's summary (its
title, format, number of sections, and each stretch cut into parts), or
{"result": "refused", "reason", "detail"}, the reason "format" (not a file
Gauss reads), "empty" (no text), "scanned" (a PDF most of whose pages have no
text, needing text recognition) or "protected" (a PDF that needs a password).
Arguments it cannot use, an original it cannot read or a folder that is not
empty are an error on standard error, with exit status 2.

    convert.py page <original> <page> <png>

renders a PDF's page, counted from 1, at 150 dpi as a PNG image, and writes
{"result": "rendered", "page", "width", "height"}; a page the PDF lacks is an
error, with exit status 2.

The format comes from the content: a file starting `%PDF-` is a PDF, UTF-8
text named `.txt` is plain text, named `.md` or `.markdown` Markdown. Text is
paragraphs between blank lines, with no headings. Markdown's top-level ATX
and setext headings make the outline. A fenced block, including one in a list
or quote, is never cut. A PDF's text is Markdown that Gauss writes from
PDFium's characters (`_read_pdf`): headings from its bookmarks, or else from
its type; a paragraph per line, its notes' definitions after it; and a marker
at each page's start, `<!-- page 3 label "ii" math images -->`.

The sections (architecture.md section 8; decisions.md, "Sources"): a
heading's stretch runs to the next heading. Its text before a first
subheading is a section of its own, under the heading's title; a heading
with no text of its own goes into the next section, or the last. The
section files are slices of the source's text, which in order are the whole
of it, so a section holds its heading. A stretch over the limit is cut
(`_cut`), and its paragraphs are numbered before the cut, so that its parts
continue the count. A PDF section's place is its pages instead.
"""

import argparse
import ctypes
import hashlib
import json
import math
import re
import sys
from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass, field
from itertools import pairwise, takewhile
from pathlib import Path
from statistics import median

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from markdown_it import MarkdownIt

CONVERTER_VERSION = 3  # raised when the same original would give other files
SECTION_LIMIT = 20_000  # characters of a section's text (decisions.md, "Sources")
_MAX_LIMIT = (1 << 53) - 1  # Outline.limit must be a JavaScript safe integer

_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")  # `Slug` in src/shared/course.ts
_EXTENSIONS = {".txt": "text", ".md": "markdown", ".markdown": "markdown"}
_COPY = {"pdf": "original.pdf", "text": "original.txt", "markdown": "original.md"}

_LINE = re.compile(r"[^\n]*\n")
_BLANK = re.compile(r"[ \t]*")
_MARKDOWN = MarkdownIt("commonmark").disable("inline")
_LEAF_BLOCKS = {"heading_open", "paragraph_open", "fence", "code_block", "html_block", "hr"}
_SENTENCE_END = re.compile(r"[.!?…][\"'”’»)\]]*\s+")
_SPACE = re.compile(r"\s+")


class Refused(Exception):
    """A file Gauss does not convert; the message says why, in a sentence."""

    def __init__(self, reason, detail):
        super().__init__(detail)
        self.reason = reason


class Unusable(Exception):
    """A request the command cannot carry out: its arguments, or its folder."""


@dataclass(frozen=True)
class _Bookmark:
    order: int
    parent: int | None
    level: int
    title: str
    page: int
    y: float | None


@dataclass(frozen=True)
class Heading:
    level: int
    title: str
    start: int  # where the heading's lines start in the text
    bookmark: _Bookmark | None = None


@dataclass(frozen=True)
class Paragraph:
    start: int
    end: int  # after its last line's newline
    whole: bool = False  # never cut: a fenced block
    protected: tuple[tuple[int, int], ...] = ()  # no cut strictly inside these sorted, disjoint spans


def _paragraph_place(start, end, first, last):
    return {"paragraphs": {"first": first, "last": last}}


@dataclass(frozen=True)
class _Source:
    format: str
    text: str
    blocks: list
    title: str | None = None  # None: from its headings or its file's name (`_title`)
    pages: dict | None = None  # `Outline.pages`, for a PDF
    place: object = _paragraph_place  # a section's place from (start, end, first paragraph, last paragraph)


@dataclass
class _Stretch:
    heading: Heading | None  # None for the text before any heading
    start: int
    paragraphs: list[Paragraph] = field(default_factory=list)
    end: int = 0
    sections: list[dict] = field(default_factory=list)
    children: list["_Stretch"] = field(default_factory=list)


def ingest(original, folder, limit=SECTION_LIMIT):
    """Converts `original` into `folder` (the module's header): the summary, or the refusal."""
    original, folder = Path(original), Path(folder)
    if not _SLUG.fullmatch(folder.name) or len(folder.name) > 60:
        raise Unusable(f"the folder's name, {folder.name!r}, is not a source id")
    try:
        data = original.read_bytes()
    except OSError as error:
        raise Unusable(f"the original cannot be read ({error})") from None
    try:
        folder.mkdir(exist_ok=True)
        if any(folder.iterdir()):
            raise Unusable(f"the folder {folder} is not empty")
    except OSError as error:
        raise Unusable(f"the destination folder cannot be used ({error})") from None

    try:
        source = _read(data, original.name)
        headings = [block for block in source.blocks if isinstance(block, Heading)]
        title = source.title or _title(original.name, source.blocks, headings)
        entries, sections, cut = _outline(source.text, source.blocks, title, limit, source.place)
    except Refused as refusal:
        return {"result": "refused", "reason": refusal.reason, "detail": str(refusal)}

    (folder / "sections").mkdir()
    for id, section in sections.items():
        with open(folder / "sections" / f"{id}.md", "w", encoding="utf-8", newline="\n") as out:
            out.write(section)
    (folder / _COPY[source.format]).write_bytes(data)
    outline = {
        "id": folder.name,
        "title": title,
        "file": _COPY[source.format],
        "name": original.name,
        "format": source.format,
        "sha256": hashlib.sha256(data).hexdigest(),
        "converter": CONVERTER_VERSION,
        "limit": limit,
    }
    if source.pages is not None:
        outline["pages"] = source.pages
    outline["entries"] = entries
    with open(folder / "outline.json", "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(outline, ensure_ascii=False, indent=2) + "\n")
    return {"result": "converted", "title": title, "format": source.format, "sections": len(sections), "cut": cut}


# Reading


def _read(data, name):
    """The source's format, text, headings and paragraphs; for a PDF, also its title, pages and places."""
    if data.startswith(b"%PDF-"):
        return _read_pdf(data)
    format = _EXTENSIONS.get(Path(name).suffix.lower())
    if format is None:
        raise Refused("format", "Only PDF, .txt, .md and .markdown files are supported.")
    try:
        decoded = data.decode("utf-8")
    except UnicodeDecodeError:
        raise Refused("format", "The file is not UTF-8 text.") from None
    if "\x00" in decoded:
        raise Refused("format", "The file contains a NUL character.")
    text = _normal(decoded)
    if not text:
        raise Refused("empty", "It holds no text.")
    blocks = _markdown_blocks(text) if format == "markdown" else _text_blocks(text)
    _check_paragraphs(blocks)
    return _Source(format, text, blocks)


def _check_paragraphs(blocks):
    if not any(isinstance(block, Paragraph) for block in blocks):
        raise Refused("empty", "It holds headings but no text under them.")


def _normal(text):
    """The text as Gauss keeps it: newlines as `\\n`, no byte-order mark, no blank lines before or after."""
    text = text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    start = re.match(r"(?:[ \t]*\n)*", text).end()
    last = len(text) - 1
    while last >= start and text[last] in " \t\n":
        last -= 1
    if last < start:
        return ""
    newline = text.find("\n", last + 1)
    return text[start : newline + 1] if newline != -1 else text[start:] + "\n"


def _text_blocks(text, low=0, high=None):
    """Paragraphs between blank lines in a line-aligned span."""
    blocks, start, end = [], None, None
    for line in _LINE.finditer(text, low, len(text) if high is None else high):
        if _BLANK.fullmatch(text, line.start(), line.end() - 1):
            if start is not None:
                blocks.append(Paragraph(start, end))
            start = None
        else:
            start = line.start() if start is None else start
            end = line.end()
    if start is not None:
        blocks.append(Paragraph(start, end))
    return blocks


def _markdown_blocks(text):
    """Use CommonMark block ranges, never rendered text, to locate headings and paragraphs."""
    offsets = [0, *(line.end() for line in _LINE.finditer(text))]
    env = {}
    tokens = _MARKDOWN.parse(text, env)
    blocks, previous = [], 0
    for index, token in enumerate(tokens):
        if token.type not in _LEAF_BLOCKS:
            continue
        first, after = token.map
        start, end = offsets[first], offsets[after]
        # Link definitions and empty containers may not emit a leaf token.
        if previous < start:
            blocks.extend(_text_blocks(text, previous, start))
        if token.type == "heading_open" and token.level == 0:
            title = _plain(tokens[index + 1].content, env)
            blocks.append(Heading(int(token.tag[1:]), title, start))
        else:
            blocks.append(Paragraph(start, end, whole=token.type == "fence"))
        previous = end
    if previous < len(text):
        blocks.extend(_text_blocks(text, previous))
    return blocks


def _plain(title, env):
    """Read inline text only in headings, with code and link labels intact."""

    def contents(tokens):
        for token in tokens:
            if token.type in {"text", "text_special", "code_inline"}:
                yield token.content
            elif token.type in {"softbreak", "hardbreak"}:
                yield " "
            elif token.type == "image":
                yield from contents(token.children)

    tokens = _MARKDOWN.inline.parse(title, _MARKDOWN, env, [])
    return " ".join("".join(contents(tokens)).split()) or "Untitled"


def _title(name, blocks, headings):
    """The source's title: a top heading that opens it and is its only one, or else its file's name."""
    tops = [heading for heading in headings if heading.level == 1]
    if len(tops) == 1 and blocks[0] is tops[0]:
        return tops[0].title
    return Path(name).stem.strip() or name


# PDF (decisions.md, "Sources"): lines from PDFium's characters, then
# furniture, footnotes, headings and paragraphs from the lines' geometry.

_BOLD_FONT = re.compile(r"bold|black|heavy|semibold|demi|medi", re.IGNORECASE)
_MATH_FONT = re.compile(r"CMMI|CMEX|CMBSY|MSAM|MSBM|EUFM|EURM|EUSM|RSFS|Math")
_NUMBERED = re.compile(r"(\d{1,2}(?:\.\d{1,2})*)\.?\s+[A-Z]")
_PAGE_NUMBER = re.compile(r"[\[(–—-]?\s*(?:\d+|[ivxlcdm]+)\s*[\])–—-]?")
_NUMBER_PREFIX = re.compile(r"(?i)(?:(?:chapter|part|section)\s+)?(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z][.)])[.):]*\s+")
_NOTE_LABEL = re.compile(r"(\d{1,3}|[*∗†‡§¶])(?=\s)")
_WORD = re.compile(r"[^\W_]+(?:-[^\W_]+)*")
_HYPHENATED_END = re.compile(r"([^\W\d_]+(?:-[^\W\d_]+)*)-$")
# Footnote marks as labels: a Markdown footnote label holds no spaces, and `*` would read as emphasis.
_SYMBOLS = {"*": "star", "∗": "star", "†": "dagger", "‡": "ddagger", "§": "section", "¶": "pilcrow"}
_DPI = 150


def _address(pointer):
    return ctypes.cast(pointer, ctypes.c_void_p).value


@dataclass(frozen=True, slots=True)
class _Font:
    size: float
    bold: bool
    math: bool
    upright: bool


@dataclass(slots=True)
class _Char:
    text: str
    x: float  # the origin
    y: float
    left: float  # the loose box's sides
    right: float
    font: _Font
    space: bool  # a space comes before it


@dataclass(frozen=True, slots=True)
class _Ref:
    label: str  # as printed


@dataclass(eq=False, slots=True)
class _Line:
    page: int  # from 0
    parts: list  # its text, `str`, and its footnote markers, `_Ref`, in order
    size: float  # its body's type size, superscripts aside
    bold: bool  # every letter bold
    y: float  # the baseline
    left: float
    right: float
    first_word: float  # the first word's width
    count: int  # its characters
    anchor: float = 0.0  # its column's left edge
    edge: float = 0.0  # its column's right edge

    @property
    def text(self):
        return "".join(part for part in self.parts if isinstance(part, str))


@dataclass(eq=False)
class _Page:
    lines: list
    images: bool
    math: bool
    bounds: tuple[float, float, float, float]
    notes: dict = field(default_factory=dict)  # printed label to a list of notes, each with its own lines


def _read_pdf(data):
    """A PDF as Gauss's text: its pages' lines in reading order, as headings and paragraphs."""
    try:
        document = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as error:
        if getattr(error, "err_code", None) == pdfium_c.FPDF_ERR_PASSWORD:
            raise Refused("protected", "The PDF needs a password to open.") from None
        raise Refused("format", "The file is not a PDF that can be read.") from None
    try:
        pages = [_pdf_page(document, index) for index in range(len(document))]
        labels = [document.get_page_label(index) for index in range(len(document))]
        bookmarks = _bookmarks(document)
        title = " ".join(document.get_metadata_value("Title").split())
        title = "" if title.lower() == "untitled" else title
    finally:
        document.close()
    if not pages:
        raise Refused("empty", "The PDF has no pages.")

    _drop_furniture(pages)
    blank = [number for number, page in enumerate(pages, 1) if not page.lines]
    if 2 * len(blank) > len(pages):
        raise Refused("scanned", "Most of its pages have no text: it needs text recognition, which Gauss does not do.")
    sizes, bolds = Counter(), Counter()
    for page in pages:
        for line in page.lines:
            sizes[line.size] += line.count
            bolds[line.size, line.bold] += line.count
    body = max(sizes, key=lambda size: (sizes[size], size))
    body_bold = bolds[body, True] > bolds[body, False]
    for page in pages:
        _take_notes(page, body)
        _columns(page, body)

    lines = [line for page in pages for line in page.lines]
    starts = _paragraph_starts(lines, _leading(lines))
    if bookmarks:
        headings = _bookmark_headings(bookmarks, pages)
    else:
        headings = _type_headings(lines, starts, pages, body, body_bold)
    labelled = labels if any(labels) else None
    text, blocks, marks = _PdfWriter(pages, labelled, lines, headings, starts).write()
    _check_paragraphs(blocks)

    def place(start, end, first, last):
        last_character = len(text[start:end].rstrip()) + start - 1
        return {"pages": {"first": _page_at(marks, start), "last": _page_at(marks, max(start, last_character))}}

    outline_pages = {"count": len(pages)}
    if labelled:
        outline_pages["labels"] = labels
    outline_pages["blank"] = blank
    return _Source("pdf", text, blocks, title or _largest_line(pages), outline_pages, place)


def _page_at(marks, offset):
    """The page, from 1, that the text at `offset` is on: the last page marker's at or before it."""
    offsets = [mark[0] for mark in marks]
    return marks[max(0, bisect_right(offsets, offset) - 1)][1]


def _largest_line(pages):
    """A title from the first page's largest type, for a PDF with none in its metadata; else None."""
    page = next((page for page in pages if page.lines), None)
    if page is None:
        return None
    largest = max(line.size for line in page.lines)
    first = next(index for index, line in enumerate(page.lines) if line.size == largest)
    run = list(takewhile(lambda line: line.size == largest, page.lines[first:]))
    return " ".join(" ".join(line.text for line in run).split()) or None


def _pdf_page(document, index):
    page = document[index]
    try:
        bounds = page.get_bbox()
        textpage = page.get_textpage()
        try:
            images, chart_labels = _page_graphics(page, textpage, bounds)
            chars, has_math = _chars(textpage.raw, chart_labels)
        finally:
            textpage.close()
    finally:
        page.close()
    return _Page([_line(group, index) for group in _line_groups(chars)], images, has_math, bounds)


def _page_graphics(page, textpage, bounds):
    """Whether the page shows graphics, and the text objects identified as chart labels."""
    left, bottom, right, top = bounds
    area = (right - left) * (top - bottom) or 1
    labels, images = set(), False
    for obj in page.get_objects(max_depth=1, filter=[pdfium_c.FPDF_PAGEOBJ_FORM, pdfium_c.FPDF_PAGEOBJ_IMAGE]):
        left, bottom, right, top = obj.get_bounds()
        share = (right - left) * (top - bottom) / area
        if obj.type == pdfium_c.FPDF_PAGEOBJ_IMAGE:
            images = images or share >= 0.01
        elif share < 0.5:
            # A form is a container, not a figure. Inspect its objects, never text that merely overlaps it.
            text_objects, paths, pictures = [], 0, False
            for child in page.get_objects(form=obj, textpage=textpage):
                if child.type == pdfium_c.FPDF_PAGEOBJ_TEXT:
                    text_objects.append(child)
                elif child.type == pdfium_c.FPDF_PAGEOBJ_PATH:
                    paths += 1
                elif child.type in (pdfium_c.FPDF_PAGEOBJ_IMAGE, pdfium_c.FPDF_PAGEOBJ_SHADING):
                    pictures = True
            images = images or (share >= 0.01 and (paths > 0 or pictures))
            if paths >= max(10, len(text_objects)):
                for text in text_objects:
                    label = text.extract().strip()
                    if len(label.split()) <= 4 and not (len(label) > 1 and label.endswith((".", "?", "!"))):
                        labels.add(_address(text.raw))
    return images, labels


def _chars(raw, figure_text):
    """Upright characters in PDFium's order, skipping chart labels and private-use characters other than small capitals."""
    x, y, box, matrix = ctypes.c_double(), ctypes.c_double(), pdfium_c.FS_RECTF(), pdfium_c.FS_MATRIX()
    fonts, chars, space, has_math = {}, [], False, False
    for index in range(pdfium_c.FPDFText_CountChars(raw)):
        code = pdfium_c.FPDFText_GetUnicode(raw, index)
        if code in (0x20, 0xA0, 0x09, 0x3000):
            space = True
            continue
        if code in (0x02, 0xFFFE):  # PDFium's mark for a hyphen at a line's end
            code = 0x2D
        elif 0xF761 <= code <= 0xF77A:  # Adobe's small capitals, a to z (the Inwood edition's headings)
            code -= 0xF700
        if code < 0x20 or 0x7F <= code < 0xA0 or 0xE000 <= code <= 0xF8FF or code == 0xFFFF:
            continue
        raw_obj = pdfium_c.FPDFText_GetTextObject(raw, index)
        if not raw_obj:
            continue
        obj = _address(raw_obj)
        if obj in figure_text:
            continue
        font = fonts.get(obj)
        if font is None:
            font = fonts[obj] = _font(raw, index, raw_obj, matrix)
        if not font.upright:
            continue
        pdfium_c.FPDFText_GetCharOrigin(raw, index, x, y)
        pdfium_c.FPDFText_GetLooseCharBox(raw, index, box)
        chars.append(_Char(chr(code), x.value, y.value, box.left, box.right, font, space))
        has_math = has_math or font.math
        space = False
    return chars, has_math


def _font(raw, index, obj, matrix):
    """A text object's type size, from its font size and matrix (the Inwood PDF's font size is 1), and its kind."""
    pdfium_c.FPDFText_GetMatrix(raw, index, matrix)
    scale = math.sqrt(abs(matrix.a * matrix.d - matrix.b * matrix.c))
    size = round(pdfium_c.FPDFText_GetFontSize(raw, index) * scale, 1)
    upright = matrix.a > 0 and abs(matrix.b) <= 0.02 * matrix.a
    name = ""
    handle = pdfium_c.FPDFTextObj_GetFont(obj)
    if handle:
        buffer = ctypes.create_string_buffer(256)
        pdfium_c.FPDFFont_GetBaseFontName(handle, buffer, len(buffer))
        name = buffer.value.decode("latin-1")
    return _Font(size, bool(_BOLD_FONT.search(name)), bool(_MATH_FONT.search(name)), upright)


def _line_groups(chars):
    """Characters into lines by their origins: a line ends where x goes back, a wide gap opens, or the baseline jumps."""
    line, base_y, base_size = [], 0.0, 0.0
    for char in chars:
        if line:
            previous, size = line[-1], max(base_size, char.font.size)
            # A line's next character is to the right; scripts, radicals and fractions move from the baseline.
            moved = 2 if char.font.math or previous.font.math else 1.5
            if (
                abs(char.y - base_y) >= moved * size
                or char.x < previous.x - 0.1 * size
                or char.left - previous.right > 2.5 * size
            ):
                yield line
                line = []
        if not line:
            base_y, base_size = char.y, char.font.size
        elif char.font.size >= 0.85 * base_size:  # the line's own type, not a superscript
            base_y, base_size = char.y, max(base_size, char.font.size)
        line.append(char)
    if line:
        yield line


def _line(chars, page):
    """A line's text and footnote markers: runs of smaller, raised digits or marks, not beside math."""
    counts = Counter(char.font.size for char in chars)
    size = max(counts, key=lambda size: (counts[size], size))
    baseline = median(char.y for char in chars if char.font.size == size)
    spaced = [False] + [char.space or char.left - previous.right > 0.15 * size for previous, char in pairwise(chars)]
    marks = [
        char.font.size < 0.85 * size
        and char.y > baseline + 0.2 * size
        and not char.font.math
        and (char.text.isdigit() or char.text in _SYMBOLS)
        for char in chars
    ]
    parts, buffer, index = [], [], 0
    while index < len(chars):
        end = index
        if marks[index]:
            end = index + 1
            digits = chars[index].text.isdigit()
            while end < len(chars) and marks[end] and not spaced[end] and chars[end].text.isdigit() == digits:
                end += 1
            before = chars[index - 1] if index > 0 and not spaced[index] else None
            after = chars[end] if end < len(chars) else None
            # Beside math, or after a digit (10⁹), raised digits are part of the text.
            if (before and (before.font.math or before.text.isdigit())) or (after and after.font.math):
                end = index
        if spaced[index]:
            buffer.append(" ")
        if end > index:
            if buffer:
                parts.append("".join(buffer))
                buffer = []
            parts.append(_Ref("".join(char.text for char in chars[index:end])))
            index = end
        else:
            buffer.append(chars[index].text)
            index += 1
    if buffer:
        parts.append("".join(buffer))
    # A soft hyphen is a hyphen at the line's end, and nothing within it.
    parts = [part.replace("\xad", "") if isinstance(part, str) else part for part in parts]
    if chars[-1].text == "\xad":
        parts.append("-")
    first_word = next((chars[i - 1].right for i in range(1, len(chars)) if spaced[i]), chars[-1].right)
    letters = [char for char in chars if char.text.isalpha()]
    return _Line(
        page=page,
        parts=[part for part in parts if part != ""],
        size=size,
        bold=bool(letters) and all(char.font.bold for char in letters),
        y=baseline,
        left=min(char.left for char in chars),
        right=max(char.right for char in chars),
        first_word=first_word - chars[0].left,
        count=len(chars),
    )


def _drop_furniture(pages):
    """Removes running heads and feet (text repeated at one place on pages), page numbers and margin line numbers."""
    rows, edges = Counter(), []
    for page in pages:
        if not page.lines:
            edges.append([])
            continue
        _, bottom, _, top = page.bounds
        margin = 0.12 * (top - bottom)
        upper, lower = max(line.y for line in page.lines), min(line.y for line in page.lines)
        candidates = [
            line for line in page.lines
            if (line.y >= upper - 2 and line.y >= top - margin)
            or (line.y <= lower + 2 and line.y <= bottom + margin)
        ]
        edges.append(candidates)
        # A lone line cannot establish that the recurring text is separate from the body.
        if upper - lower > 2:
            rows.update({(_signature(line), round(line.y / 2)) for line in candidates})
    for page, candidates in zip(pages, edges, strict=True):
        drop = set()
        for line in candidates:
            text = line.text.strip()
            if _PAGE_NUMBER.fullmatch(text) or (rows[_signature(line), round(line.y / 2)] >= 3 and text):
                drop.add(id(line))
        margins = Counter(round(line.left / 3) for line in page.lines if line.text.strip().isdigit())
        for line in page.lines:
            if line.text.strip().isdigit() and margins[round(line.left / 3)] >= 5:
                drop.add(id(line))
        page.lines = [line for line in page.lines if id(line) not in drop and line.text.strip()]


def _signature(line):
    """A line's text with its numbers, and a page number in roman at either end, as `#`."""
    words = re.sub(r"\d+", "#", line.text.lower()).split()
    for end in (0, -1):
        if words and _PAGE_NUMBER.fullmatch(words[end]):
            words[end] = "#"
    return " ".join(words)


def _take_notes(page, body):
    """Moves the notes at the page's foot out of its lines: smaller lines from one that starts with a marker's label."""
    refs = {part.label for line in page.lines for part in line.parts if isinstance(part, _Ref)}
    if not refs:
        return
    lines, kept, index = page.lines, [], 0
    while index < len(lines):
        label = _note_label(lines[index], refs) if lines[index].size < 0.92 * body else None
        end = index + 1
        while end < len(lines) and lines[end].size < 0.92 * body and lines[end].y < lines[end - 1].y:
            end += 1
        # The run must close the page, or its column: the next line is higher up.
        if label is None or (end < len(lines) and lines[end].y < lines[end - 1].y):
            kept.append(lines[index])
            index += 1
            continue
        current = None
        for line in lines[index:end]:
            label = _note_label(line, refs)
            if label is not None:
                current = []
                page.notes.setdefault(label, []).append(current)
            current.append(line)
        index = end
    page.lines = kept


def _note_label(line, refs):
    first = line.parts[0]
    if isinstance(first, _Ref):
        return first.label if first.label in refs else None
    match = _NOTE_LABEL.match(first)
    return match.group(1) if match and match.group(1) in refs else None


def _columns(page, body):
    """Each line's column: its left edge, the page's most frequent left edges that are not indents, and right edge."""
    edges = Counter(round(line.left) for line in page.lines)
    anchors = []
    for edge, count in sorted(edges.items(), key=lambda item: (-item[1], item[0])):
        if count < 2:
            break
        if not any(anchor - 1 <= edge <= anchor + 4 * body for anchor in anchors):
            anchors.append(edge)
    rights = {}
    for line in page.lines:
        below = [anchor for anchor in anchors if anchor <= line.left + 1]
        line.anchor = max(below) if below else line.left
        rights.setdefault(line.anchor, Counter())[round(line.right)] += 1
    for line in page.lines:
        counts = rights[line.anchor]
        repeated = [right for right, count in counts.items() if count >= 2]
        line.edge = max(repeated) if repeated else max(counts)


def _leading(lines):
    """The usual distance between baselines, for each type size."""
    gaps = {}
    for previous, line in pairwise(lines):
        gap = previous.y - line.y
        same = previous.page == line.page and previous.anchor == line.anchor and previous.size == line.size
        if same and 0 < gap < 2.5 * line.size:
            gaps.setdefault(line.size, Counter())[round(gap, 1)] += 1
    return {size: max(counts, key=lambda gap: (counts[gap], -gap)) for size, counts in gaps.items()}


def _paragraph_starts(lines, leading):
    """Whether each line starts a paragraph: a change of size, an indent, a short line before it, or a wider gap."""
    starts = []
    for index, line in enumerate(lines):
        if index == 0:
            starts.append(True)
            continue
        previous = lines[index - 1]
        same_column = previous.page == line.page and previous.anchor == line.anchor and previous.y > line.y
        starts.append(
            abs(line.size - previous.size) > 0.15 * max(line.size, previous.size)
            or line.left - line.anchor > 0.4 * line.size
            or previous.edge - previous.right > line.first_word + 0.3 * line.size
            or (same_column and previous.y - line.y > 1.4 * leading.get(line.size, 1.2 * line.size))
        )
    return starts


def _bookmarks(document):
    """Local bookmarks in TOC order, with their nearest included parent and destination."""
    found, parents = [], []
    for bookmark in document.get_toc():
        level = bookmark.level + 1
        while parents and parents[-1].level >= level:
            parents.pop()
        title = " ".join(bookmark.get_title().split())
        dest = pdfium_c.FPDFBookmark_GetDest(document.raw, bookmark.raw)
        if not dest:
            action = pdfium_c.FPDFBookmark_GetAction(bookmark.raw)
            if action and pdfium_c.FPDFAction_GetType(action) == pdfium_c.PDFACTION_GOTO:
                dest = pdfium_c.FPDFAction_GetDest(document.raw, action)
        if not dest or not title:
            continue
        page = pdfium_c.FPDFDest_GetDestPageIndex(document.raw, dest)
        if not 0 <= page < len(document):
            continue
        has = [ctypes.c_int() for _ in range(3)]
        place = [ctypes.c_float() for _ in range(3)]
        pdfium_c.FPDFDest_GetLocationInPage(dest, *has, *place)
        item = _Bookmark(
            len(found), parents[-1].order if parents else None, level, title, page,
            place[1].value if has[1].value else None,
        )
        found.append(item)
        parents.append(item)
    return found


def _letters(text):
    return "".join(character for character in text.lower() if character.isalnum())


def _bookmark_headings(bookmarks, pages):
    """Each bookmark's heading: the lines on its page that print its title, or else a heading before its place.

    Returns {(page, line index): [(level, title, line count, bookmark)]}.
    """
    headings, taken = {}, set()
    for bookmark in bookmarks:
        title, page, y = bookmark.title, bookmark.page, bookmark.y
        lines, wanted = pages[page].lines, _letters(title)
        matches = []
        for first, line in enumerate(lines):
            for after in range(first + 1, min(first + 4, len(lines)) + 1):
                if after > first + 1:
                    previous, current = lines[after - 2], lines[after - 1]
                    if not 0 < previous.y - current.y <= 1.8 * max(previous.size, current.size):
                        break
                printed = " ".join(" ".join(part.text for part in lines[first:after]).split())
                prefix = _NUMBER_PREFIX.match(printed)
                if _letters(printed) == wanted:
                    name = title
                elif prefix and _letters(printed[prefix.end():]) == wanted:
                    name = printed
                else:
                    continue
                rank = (abs(line.y - y) if y is not None else 0, -line.size, not line.bold, after - first, first)
                matches.append((rank, first, after, name))
        if matches:
            _, first, after, name = min(matches)
            positions = {(page, index) for index in range(first, after)}
            count = 0 if taken & positions else after - first
            if count:
                taken.update(positions)
        else:
            first = 0 if y is None else next((i for i, line in enumerate(lines) if line.y <= y + 2), len(lines))
            name, count = title, 0
        headings.setdefault((page, first), []).append((bookmark.level, name, count, bookmark))
    return headings


def _type_headings(lines, starts, pages, body, body_bold):
    """Headings for a PDF with no bookmarks: lines set larger, or bold and alone, or numbered as headings are."""
    runs, index = [], 0
    while index < len(lines):
        line = lines[index]
        end = index + 1
        while (
            end < len(lines)
            and lines[end].page == line.page
            and (lines[end].size, lines[end].bold) == (line.size, line.bold)
            and 0 < lines[end - 1].y - lines[end].y <= 1.5 * line.size
            and not _NUMBERED.match(lines[end].text)
            and (line.size >= 1.25 * body or (line.bold and not body_bold))
        ):
            end += 1
        runs.append((index, end))
        index = end

    found = []
    for first, end in runs:
        group, line = lines[first:end], lines[first]
        text = " ".join(" ".join(part.text for part in group).split())
        starts_alone = starts[first] or line.page != lines[first - 1].page
        ends_alone = end == len(lines) or starts[end] or line.page != lines[end].page
        alone = starts_alone and ends_alone
        numbered = _NUMBERED.match(text)
        big = line.size >= 1.25 * body
        bold = line.bold and not body_bold
        if sum(character.isalpha() for character in text) < 2 or any(_crowded(part, pages) for part in group):
            continue
        if (
            (big and len(group) <= 4)
            or (bold and alone and len(group) <= 3)
            or (numbered and alone and len(group) == 1 and len(text.split()) <= 12 and text[-1] not in ".,;:")
        ):
            depth = numbered.group(1).count(".") + 1 if numbered else None
            found.append((first, end, text, (line.size, line.bold), depth))

    depths = {}
    for _, _, _, style, depth in found:
        if depth is not None:
            depths.setdefault(style, Counter())[depth] += 1
    styles = sorted({style for _, _, _, style, _ in found}, key=lambda style: (-style[0], not style[1]))
    ranks = {style: rank for rank, style in enumerate(styles, 1)}
    headings = {}
    for first, end, text, style, depth in found:
        if depth is None:
            depth = depths[style].most_common(1)[0][0] if style in depths else ranks[style]
        line = lines[first]
        position = pages[line.page].lines.index(line)
        headings.setdefault((line.page, position), []).append((depth, text, end - first, None))
    return headings


def _crowded(line, pages):
    """Another line on its baseline within its column: a table's cell, not a heading."""
    for other in pages[line.page].lines:
        if other is line or abs(other.y - line.y) > 1:
            continue
        if line.right < other.left <= line.edge or line.anchor <= other.right < line.left:
            return True
    return False


class _PdfWriter:
    """Writes the lines as Markdown: headings, a paragraph per line of text with its notes after it, page markers."""

    def __init__(self, pages, labels, lines, headings, starts):
        self.pages, self.labels, self.headings = pages, labels, headings
        self.starts = {id(line): start for line, start in zip(lines, starts, strict=True)}
        self.out, self.length, self.blocks, self.marks = [], 0, [], []  # marks: (offset, page from 1)
        self.pending = []  # pages, from 0, whose markers wait for the next line
        self.paragraph = None  # the open paragraph's text
        self.paragraph_start = 0
        self.inline = []  # (offset in the open paragraph, page from 1) of its markers
        self.protected = []
        self.note_start = None  # first reference whose definition follows the open paragraph
        self.notes = []  # (label, a note's lines), written after the open heading or paragraph
        self.page_notes = {}
        self.claimed = Counter()
        self.used = Counter()  # footnote labels in the current heading's stretch
        self.words = {
            word.lower()
            for page in pages
            for line in page.lines
            for word in _WORD.findall(line.text)
        }
        self.words.update(
            word.lower()
            for page in pages
            for notes in page.notes.values()
            for note in notes
            for line in note
            for word in _WORD.findall(line.text)
        )

    def write(self):
        for number, page in enumerate(self.pages):
            self.pending.append(number)
            self.page_notes, self.claimed = page.notes, Counter()
            consumed = 0
            for index, line in enumerate(page.lines):
                for level, title, count, bookmark in self.headings.get((number, index), ()):
                    self._heading(level, title, page.lines[index:index + count], bookmark)
                    consumed = max(consumed, index + count)
                if index >= consumed:
                    self._line(line)
            for level, title, _, bookmark in self.headings.get((number, len(page.lines)), ()):
                self._heading(level, title, (), bookmark)
            # Keep any definition left after pairing rather than silently dropping source text.
            for label, notes in self.page_notes.items():
                self.notes.extend((self._unique(label), note) for note in notes[self.claimed[label]:])
            if self.paragraph is None and self.notes:
                self._definitions()
                self._emit("\n")
        self._close()
        self._markers()
        text = "".join(self.out)
        return (text[:-1] if text.endswith("\n\n") else text), self.blocks, self.marks

    def _emit(self, text):
        self.out.append(text)
        self.length += len(text)

    def _marker(self, number):
        words = [f"page {number + 1}"]
        if self.labels is not None:
            label = " ".join(self.labels[number].replace('"', "'").split())
            while "--" in label:
                label = label.replace("--", "-")
            words.append(f'label "{label}"')
        if self.pages[number].math:
            words.append("math")
        if self.pages[number].images:
            words.append("images")
        return f"<!-- {' '.join(words)} -->"

    def _markers(self):
        """Writes the waiting markers as lines of their own and returns their start."""
        start = self.length
        for number in self.pending:
            self.marks.append((self.length, number + 1))
            self._emit(self._marker(number) + "\n")
        self.pending = []
        return start

    def _heading(self, level, title, printed, bookmark):
        self._close()
        start = self._markers()
        self.blocks.append(Heading(level, title, start, bookmark))
        self.used = Counter()
        if any(isinstance(part, _Ref) for line in printed for part in line.parts):
            title = " ".join(self._render(line)[0] for line in printed)
        self._emit("#" * min(level, 6) + " " + title + "\n")
        self._definitions()
        self._emit("\n")

    def _unique(self, label):
        label = _SYMBOLS.get(label, label)
        self.used[label] += 1
        return label if self.used[label] == 1 else f"{label}-{self.used[label]}"

    def _render(self, line):
        """Returns the line with footnote references and the offset of its first attached reference."""
        out, length, first = [], 0, None
        for part in line.parts:
            if isinstance(part, str):
                text = part
            else:
                label = self._unique(part.label)
                text = f"[^{label}]"
                notes = self.page_notes.get(part.label)
                used = self.claimed[part.label]
                if notes and (used < len(notes) or len(notes) == 1):
                    self.notes.append((label, notes[used] if len(notes) > 1 else notes[0]))
                    self.claimed[part.label] += 1
                    if first is None:
                        first = length
            out.append(text)
            length += len(text)
        raw = "".join(out)
        text = raw.lstrip()
        return text.rstrip(), None if first is None else first - (len(raw) - len(text))

    def _line(self, line):
        if self.paragraph is None or self.starts[id(line)]:
            self._close()
            self.paragraph_start = self._markers()
            text, note = self._render(line)
            # A line starting so would be a heading, a quote or HTML.
            escape = text.startswith(("#", ">", "<"))
            self.paragraph = "\\" + text if escape else text
            if self.paragraph_start < self.length:
                first_space = self.paragraph.find(" ")
                word_end = len(self.paragraph) if first_space < 0 else first_space
                self._protect(self.paragraph_start, self.length + word_end)
            self.note_start = note + escape if note is not None else None
            return
        following, note = self._render(line)
        joined, at = self._join(self.paragraph, following)
        if note is not None:
            note += len(joined) - len(following)
        if self.pending:
            # A comment inside a paragraph follows the preceding word, including across a section cut.
            before, after = joined[:at], joined[at:].lstrip(" ")
            position, markers = at + 1, []
            for number in self.pending:
                marker = self._marker(number)
                self.inline.append((self.length + position, number + 1))
                position += len(marker) + 1
                markers.append(marker)
            self._protect(self.length + before.rfind(" ") + 1, self.length + position - 1)
            with_markers = before + " " + " ".join(markers) + (" " + after if after else "")
            if note is not None and note >= at:
                note += len(with_markers) - len(joined)
            joined = with_markers
            self.pending = []
        if self.note_start is None:
            self.note_start = note
        self.paragraph = joined

    def _join(self, text, following):
        """The text with its next line, a word hyphenated at the line's end mended; where a page marker would go."""
        if not text.endswith("-"):
            return text + " " + following, len(text)
        match = _HYPHENATED_END.search(text, max(0, len(text) - 80))  # the end only: a paragraph grows long
        word = _WORD.match(following)
        if not (match and word):
            return text + " " + following, len(text)
        left, right = match.group(1).lower(), word.group().lower()
        compound = f"{left}-{right}" in self.words
        if not (compound or following[0].islower()):
            return text + " " + following, len(text)
        head = right.split("-", 1)[0]
        keep = f"{left}{right}" not in self.words and (
            compound or (f"{left}{head}" not in self.words and ("-" in right or f"{left}-{head}" in self.words))
        )
        joined = (text if keep else text[:-1]) + following
        return joined, len(joined) - len(following) + len(following.split(" ", 1)[0])

    def _protect(self, start, end):
        """Adds an indivisible span, coalescing any overlapping spans at the end."""
        while self.protected and self.protected[-1][1] > start:
            start = min(start, self.protected.pop()[0])
        self.protected.append((start, end))

    def _close(self):
        if self.paragraph is None:
            return
        self.marks.extend(self.inline)
        self.inline = []
        origin = self.length
        self._emit(self.paragraph + "\n")
        self._definitions()
        if self.note_start is not None:
            word_start = self.paragraph.rfind(" ", 0, self.note_start) + 1
            self._protect(origin + word_start, self.length)
        self.blocks.append(Paragraph(self.paragraph_start, self.length, protected=tuple(self.protected)))
        self.protected = []
        self.note_start = None
        self._emit("\n")
        self.paragraph = None

    def _definitions(self):
        for label, note in self.notes:
            self._emit(f"\n[^{label}]: {self._note_text(note)}\n")
        self.notes = []

    def _note_text(self, lines):
        """A note's text, its label left out."""
        first = lines[0]
        parts = [part if isinstance(part, str) else part.label for part in first.parts]
        if isinstance(first.parts[0], _Ref):
            parts = parts[1:]
        else:
            parts[0] = parts[0][_NOTE_LABEL.match(parts[0]).end() :]
        text = "".join(parts).strip()
        for line in lines[1:]:
            following = "".join(part if isinstance(part, str) else part.label for part in line.parts).strip()
            text = self._join(text, following)[0]
        return " ".join(text.split())


def render_page(original, number, png):
    """Renders page `number` (from 1) of the PDF `original` at 150 dpi into `png`: its size in pixels."""
    try:
        document = pdfium.PdfDocument(Path(original).read_bytes())
    except (OSError, pdfium.PdfiumError) as error:
        raise Unusable(f"the original cannot be read as a PDF ({error})") from None
    try:
        if not 1 <= number <= len(document):
            raise Unusable(f"the PDF has {len(document)} pages, not a page {number}")
        page = document[number - 1]
        try:
            image = page.render(scale=_DPI / 72).to_pil()
        finally:
            page.close()
        try:
            image.save(png, format="PNG")
        except OSError as error:
            raise Unusable(f"the image cannot be written ({error})") from None
        return {"result": "rendered", "page": number, "width": image.width, "height": image.height}
    finally:
        document.close()


# Sections


def _outline(text, blocks, title, limit, place=_paragraph_place):
    """The outline's entries, each section's text by id, and the stretches cut into parts."""
    stretches = []
    for block in blocks:
        if isinstance(block, Heading):
            stretches.append(_Stretch(block, block.start))
        else:
            if not stretches:
                stretches.append(_Stretch(None, block.start))
            stretches[-1].paragraphs.append(block)

    # A stretch with no paragraph of its own starts the next one that has one; the last one runs to the end.
    with_text, carried = [], None
    for stretch in stretches:
        if not stretch.paragraphs:
            carried = stretch.start if carried is None else carried
            continue
        stretch.start = stretch.start if carried is None else carried
        carried = None
        with_text.append(stretch)
    for stretch, after in zip(with_text, [*with_text[1:], None], strict=True):
        stretch.end = after.start if after else len(text)
    assert with_text[0].start == 0

    sections, cut = {}, []
    for stretch in with_text:
        name = stretch.heading.title if stretch.heading else title
        parts = _cut(text, stretch, limit)
        if len(parts) > 1:
            cut.append({"title": name, "parts": len(parts)})
        for number, (start, end, first, last) in enumerate(parts, 1):
            id = f"s{len(sections) + 1}"
            sections[id] = text[start:end]
            entry = {
                "id": id,
                "title": name if len(parts) == 1 else f"{name} (part {number} of {len(parts)})",
                "size": end - start,
                "place": place(start, end, first, last),
            }
            if len(parts) > 1:
                entry["part"] = {"number": number, "of": len(parts)}
            stretch.sections.append(entry)

    # Bookmarks carry their parents; other headings nest by level in reading order.
    top, open_headings = [], []
    bookmarked = {}
    for stretch in stretches:
        if stretch.heading is None:
            top.append(stretch)
            continue
        if stretch.heading.bookmark is not None:
            bookmarked[stretch.heading.bookmark.order] = stretch
            continue
        while open_headings and open_headings[-1].heading.level >= stretch.heading.level:
            open_headings.pop()
        (open_headings[-1].children if open_headings else top).append(stretch)
        open_headings.append(stretch)
    for _, stretch in sorted(bookmarked.items()):
        parent = stretch.heading.bookmark.parent
        (bookmarked[parent].children if parent is not None else top).append(stretch)
    return [entry for stretch in top for entry in _entries(stretch)], sections, cut


def _entries(stretch):
    """A stretch's entries in its parent's: its sections, or a heading holding them and its subheadings'."""
    if stretch.heading is None:
        return stretch.sections
    if not stretch.children and len(stretch.sections) == 1:
        return stretch.sections
    inner = stretch.sections + [entry for child in stretch.children for entry in _entries(child)]
    return [{"title": stretch.heading.title, "entries": inner}]


def _cut(text, stretch, limit):
    """The stretch's parts as (start, end, first paragraph, last paragraph).

    Within the limit, one part. Over it, `ceil(size / limit)` parts, cut at the
    paragraph boundaries closest to equal shares, with one part more while a
    part of several units is still over the limit. Split an oversized
    paragraph at a sentence end nearest its middle, or else at a space.
    Fences and attached text that cannot fit without cutting a heading or
    a short paragraph may make a part exceed the limit.
    """
    start, end, paragraphs = stretch.start, stretch.end, stretch.paragraphs
    if end - start <= limit:
        return [(start, end, 1, len(paragraphs))]

    units = []  # (start, paragraph number): where a part may start
    unit_start = start
    for number, paragraph in enumerate(paragraphs, 1):
        following = paragraphs[number] if number < len(paragraphs) else None
        unit_end = following.start if following else end
        if following and paragraph.end <= unit_start + limit < unit_end:
            # Assign only the excess separator to the next paragraph, if it fits there.
            if following.end <= unit_start + 2 * limit:
                unit_end = unit_start + limit
        pieces = [unit_start]
        if not paragraph.whole and paragraph.end - paragraph.start > limit:
            pieces = _split(text, unit_start, unit_end, paragraph, limit)
        units.extend((piece, number) for piece in pieces)
        unit_start = unit_end
    starts = [unit[0] for unit in units] + [end]

    size = end - start
    count = min((size + limit - 1) // limit, len(units))
    while True:
        firsts = [0, *_shares(starts, size, count), len(units)]
        over = any(starts[b] - starts[a] > limit and b - a > 1 for a, b in pairwise(firsts))
        if not over or count == len(units):
            break
        count += 1
    return [(starts[a], starts[b], units[a][1], units[b - 1][1]) for a, b in pairwise(firsts)]


def _shares(starts, size, count):
    """The units starting the second part onwards: for each share, the boundary nearest it after the last cut."""
    picks, low = [], 1
    units = len(starts) - 1
    for k in range(1, count):
        high = units - (count - 1 - k)  # leaving a unit for each part after this one
        near = bisect_left(starts, starts[0] + k * size // count, low, high)
        best = min(
            range(max(low, near - 1), min(high, near + 2)),
            key=lambda i: (abs(count * (starts[i] - starts[0]) - k * size), i),
        )
        picks.append(best)
        low = best + 1
    return picks


def _split(text, start, end, paragraph, limit):
    """Split a long paragraph, without trying to shrink a heading that alone fills a part."""
    low, high = max(start, paragraph.start), min(end, paragraph.end)
    # Attachments live at the edges; if one cannot fit with any paragraph text,
    # leave it attached instead of repeatedly cutting right next to it.
    prefix, suffix = low - start, end - high
    if high - low + (prefix if prefix < limit else 0) + (suffix if suffix < limit else 0) <= limit:
        return [start]
    cut = _cut_point(text, low, high, paragraph.protected)
    if cut is None:
        return [start]
    return _split(text, start, cut, paragraph, limit) + _split(text, cut, end, paragraph, limit)


def _cut_point(text, low, high, protected):
    """The nearest sentence end or whitespace, then the midpoint; never inside a protected span."""

    def covering(offset):
        i = bisect_right(protected, offset, key=lambda span: span[0]) - 1
        return protected[i] if i >= 0 and protected[i][0] < offset < protected[i][1] else None

    def distance(offset):
        return abs(2 * offset - low - high), offset

    for pattern in (_SENTENCE_END, _SPACE):
        cuts = (m.end() for m in pattern.finditer(text, low, high) if m.end() < high and not covering(m.end()))
        best = min(cuts, key=distance, default=None)
        if best is not None:
            return best
    middle = (low + high) // 2
    edges = covering(middle) or (middle,)
    return min((edge for edge in edges if low < edge < high), key=distance, default=None)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="convert.py", description="Converts a source for Gauss.")
    commands = parser.add_subparsers(dest="command", required=True)
    ingest_command = commands.add_parser("ingest", help="convert an original into a folder")
    ingest_command.add_argument("original", type=Path)
    ingest_command.add_argument("folder", type=Path)
    ingest_command.add_argument("--limit", type=_positive, default=SECTION_LIMIT, help="a section's characters")
    page_command = commands.add_parser("page", help="render a PDF's page as a PNG image at 150 dpi")
    page_command.add_argument("original", type=Path)
    page_command.add_argument("page", type=_positive, help="the page's number, from 1")
    page_command.add_argument("png", type=Path)
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "page":
            result = render_page(arguments.original, arguments.page, arguments.png)
        else:
            result = ingest(arguments.original, arguments.folder, arguments.limit)
    except Unusable as error:
        print(f"convert.py: {error}", file=sys.stderr)
        return 2
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    return 0


def _positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be a positive number")
    if number > _MAX_LIMIT:
        raise argparse.ArgumentTypeError(f"must be at most {_MAX_LIMIT}")
    return number


if __name__ == "__main__":
    sys.exit(main())
