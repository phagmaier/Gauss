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
text, needing text recognition) or "protected" (a PDF that needs a password,
or an EPUB whose text documents are encrypted; obfuscated fonts are not).
Arguments it cannot use, an original it cannot read or a folder that is not
empty are an error on standard error, with exit status 2.

    convert.py page <original> <page> <png>

renders a PDF's page, counted from 1, at 150 dpi as a PNG image, and writes
{"result": "rendered", "page", "width", "height"}; a page the PDF lacks is an
error, with exit status 2.

The format comes from the content: a file starting `%PDF-` is a PDF, a ZIP
archive whose `mimetype` entry is `application/epub+zip` an EPUB, UTF-8 text
named `.txt` is plain text, named `.md` or `.markdown` Markdown. Text is
paragraphs between blank lines, with no headings. Markdown's top-level ATX
and setext headings make the outline. A fenced block, including one in a list
or quote, is never cut. A PDF's text is Markdown that Gauss writes from
PDFium's characters (`_read_pdf`): headings from its bookmarks, or else from
its type; a paragraph per line, its notes' definitions after it; and a marker
at each page's start, `<!-- page 3 label "ii" math images -->`. An EPUB's
text is Markdown that Gauss writes from its XHTML in spine order
(`_read_epub`), with a heading at each target of its table of contents.

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
import codecs
import ctypes
import hashlib
import io
import json
import math
import posixpath
import re
import sys
import zipfile
import zlib
from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass, field
from itertools import pairwise, takewhile
from pathlib import Path
from html.parser import HTMLParser
from statistics import median
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from markdown_it import MarkdownIt

CONVERTER_VERSION = 3  # raised when the same original would give other files
SECTION_LIMIT = 20_000  # characters of a section's text (decisions.md, "Sources")
_MAX_LIMIT = (1 << 53) - 1  # Outline.limit must be a JavaScript safe integer

_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")  # `Slug` in src/shared/course.ts
_EXTENSIONS = {".txt": "text", ".md": "markdown", ".markdown": "markdown"}
_COPY = {"pdf": "original.pdf", "epub": "original.epub", "text": "original.txt", "markdown": "original.md"}

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
    bookmark: "_Bookmark | _TocEntry | None" = None  # its place in a PDF's bookmarks or an EPUB's contents


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
    """The source's format, text, headings and paragraphs; for a PDF or an EPUB, also its title."""
    if data.startswith(b"%PDF-"):
        return _read_pdf(data)
    suffix = Path(name).suffix.lower()
    if data.startswith(b"PK\x03\x04") or suffix == ".epub":
        source = _read_epub(data)
        if source is not None:
            return source
        if suffix == ".epub":
            raise Refused("format", "The file is not an EPUB that can be read.")
    format = _EXTENSIONS.get(suffix)
    if format is None:
        raise Refused("format", "Only PDF, EPUB, .txt, .md and .markdown files are supported.")
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


# EPUB (decisions.md, "Sources"): the standard library reads the container,
# the package, the table of contents and the XHTML, which Gauss writes as
# Markdown in spine order. The outline is the table of contents: a heading at
# each entry's target, in place of the lines there that print its title, so
# an entry's text runs to the next entry's target. A document the contents
# leave out stays in the entry before it.

_EPUB = b"application/epub+zip"
_EPUB_BUDGET = 256 << 20  # bytes read out of the archive, decompressed
_XHTML = {"application/xhtml+xml", "text/html"}
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_SKIPPED = {"head", "script", "style", "svg", "template", "title"}
_BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "body", "caption", "center", "dd", "details", "div", "dl", "dt",
    "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
    "html", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "ul",
}  # fmt: skip
_TAG_FLAGS = {
    "i": {"italic"}, "em": {"italic"}, "cite": {"italic"}, "dfn": {"italic"}, "var": {"italic"},
    "b": {"bold"}, "strong": {"bold"}, "sup": {"super"},
}  # fmt: skip
_NOTE_TYPES = {"footnote", "endnote", "rearnote", "note", "footnotes", "endnotes", "rearnotes", "doc-footnote", "doc-endnote", "doc-endnotes"}  # fmt: skip
_NOTE_REFERENCE = re.compile(r"[\[(]?(?:\d{1,4}|[a-z]{1,3}|[*∗†‡§¶]{1,3})[\])]?\.?", re.IGNORECASE)
_HTML_SPACE = re.compile(r"[ \t\n\r\f]+")
_INVISIBLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\xad]")  # controls and soft hyphens
_ESCAPED = re.compile(r"[\\*`]|<(?=[A-Za-z/!?])")
_LINE_START = re.compile(r"#|>|~~~|[-=]+\s*$")  # would start a heading, a quote or a fence, or underline a heading
_LABEL_AFTER = re.compile(r"[\s.):\]]*")
_CSS_RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
_CSS_CLASS = re.compile(r"\s*[a-z0-9]*\.([\w-]+)\s*", re.IGNORECASE)
_CSS_DECLARATION = re.compile(r"([\w-]+)\s*:\s*([^;]+)")


@dataclass(frozen=True)
class _TocEntry:
    order: int
    parent: int | None
    level: int
    title: str


@dataclass
class _Element:
    tag: str
    attrs: dict
    children: list = field(default_factory=list)

    def types(self):
        return set(f"{self.attrs.get('epub:type', '')} {self.attrs.get('role', '')}".split())


@dataclass
class _Item:
    """A list item a block is in: its marker, written before the item's first block only."""

    marker: str
    used: bool = False


@dataclass
class _Block:
    kind: str  # "text", "heading" (h1 to h6), "table", "pre" or "rule"
    nodes: list
    file: int  # its document's place in the spine
    level: int = 0
    italic: bool = False  # set by an enclosing block's style
    bold: bool = False
    note: bool = False  # inside an element typed as a note
    first: str = ""  # its first line's quote marks and list marker
    rest: str = ""  # its other lines'


@dataclass
class _Link:
    node: _Element
    block: int
    leading: bool  # no text before it in its block
    raised: bool  # superscript, or holding one
    order: int
    key: tuple | None  # (document, id) of the link itself
    target: tuple | None  # (document, fragment or None) it points to, within the spine


class _Archive:
    """The EPUB's ZIP archive, read within a budget; reading an encrypted text document refuses the book."""

    def __init__(self, archive):
        self.archive, self.budget, self.encrypted = archive, _EPUB_BUDGET, set()
        self.names = {info.filename: info for info in archive.infolist()}

    def read(self, name, document=True):
        info = self.names.get(name)
        if info is None:
            return None
        if document and (name in self.encrypted or info.flag_bits & 1):
            raise Refused("protected", "Its text is encrypted (DRM), so Gauss cannot read it.")
        if info.flag_bits & 1:
            return None
        try:
            with self.archive.open(info) as member:
                raw = member.read(self.budget + 1)
        except (zipfile.BadZipFile, NotImplementedError, OSError, EOFError, zlib.error, ValueError):
            raise Refused("format", "The EPUB's archive cannot be read.") from None
        self.budget -= len(raw)
        if self.budget < 0:
            raise Refused("format", "The EPUB is too large to read.")
        return raw

    def xml(self, name, required=True):
        raw = self.read(name)
        if raw is None and not required:
            return None
        if raw is None:
            raise Refused("format", f"The EPUB lacks its {name}.")
        try:
            return ElementTree.fromstring(raw)
        except ElementTree.ParseError:
            if not required:
                return None
            raise Refused("format", f"The EPUB's {name} is not well-formed XML.") from None


def _read_epub(data):
    """An EPUB as Gauss's text, its title and its headings from the contents; None if the data is no EPUB."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError, ValueError, EOFError):
        return None
    with archive:
        book = _Archive(archive)
        try:
            mimetype = book.read("mimetype", document=False)
        except Refused:
            return None
        if mimetype is None or mimetype.strip() != _EPUB:
            return None
        container = book.xml("META-INF/container.xml")
        package_path = next(
            (e.get("full-path") for e in container.iter() if _local(e.tag) == "rootfile" and e.get("full-path")),
            None,
        )
        if package_path is None:
            raise Refused("format", "The EPUB names no package document.")
        book.encrypted = _encrypted(book)
        package = book.xml(package_path)

        manifest = {}  # id: (path, media type, properties)
        for item in package.iter():
            if _local(item.tag) == "item" and item.get("id") and item.get("href"):
                target = _href(package_path, item.get("href"))
                if target:
                    manifest[item.get("id")] = (target[0], item.get("media-type", ""), item.get("properties", "").split())
        spine = next((e for e in package.iter() if _local(e.tag) == "spine"), None)
        paths = []
        for itemref in [] if spine is None else spine:
            item = manifest.get(itemref.get("idref")) if _local(itemref.tag) == "itemref" else None
            if item and item[1] in _XHTML and item[0] not in paths:
                paths.append(item[0])
        documents = []
        for path in paths:
            raw = book.read(path)
            if raw is not None:
                documents.append((path, _body(_parse_html(raw))))

        toc = []
        nav = next((path for path, _, properties in manifest.values() if "nav" in properties), None)
        if nav is not None and (raw := book.read(nav)) is not None:
            toc = _nav_toc(_parse_html(raw), nav)
        ncx = manifest.get(spine.get("toc")) if spine is not None else None
        ncx = ncx or next((item for item in manifest.values() if item[1] == "application/x-dtbncx+xml"), None)
        ncx_root = book.xml(ncx[0], required=False) if ncx and not toc else None
        if ncx_root is not None:
            toc = _ncx_toc(ncx_root, ncx[0])

        sheets = [book.read(path, document=False) for path, media, _ in manifest.values() if media == "text/css"]
        styles = _css_classes(sheet.decode("utf-8", "replace") for sheet in sheets if sheet)
        metadata = (e for e in package.iter() if _local(e.tag) == "title")
        title = next((" ".join("".join(e.itertext()).split()) for e in metadata if "".join(e.itertext()).strip()), None)
        if title is None and ncx_root is not None:
            doc_title = next((e for e in ncx_root.iter() if _local(e.tag) == "docTitle"), None)
            title = " ".join("".join(doc_title.itertext()).split()) if doc_title is not None else None

    entries, targets = _toc_entries(toc, {path: index for index, (path, _) in enumerate(documents)})
    try:
        text, blocks = _EpubWriter(documents, styles).write(entries, targets)
    except RecursionError:
        raise Refused("format", "The EPUB's documents nest too deeply to read.") from None
    if not text:
        raise Refused("empty", "It holds no text.")
    _check_paragraphs(blocks)
    return _Source("epub", text, blocks, title or None)


def _local(tag):
    """An element's name without its namespace (`{...}title`) or prefix (`m:math`)."""
    return tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1]


def _href(document, href):
    """(the archive path, the fragment or None) that `href` in `document` points to; None if outside the book."""
    parts = urlsplit(href.strip())
    if parts.scheme or parts.netloc:
        return None
    path = unquote(parts.path)
    if path:
        path = posixpath.normpath(posixpath.join(posixpath.dirname(document), path)).lstrip("/")
    return path or document, unquote(parts.fragment) or None


def _encrypted(book):
    """The archive paths that META-INF/encryption.xml lists: encrypted, or obfuscated as fonts are.

    Only a text document among them refuses the book (`_Archive.read`); Gauss never reads a font.
    """
    raw = book.read("META-INF/encryption.xml", document=False)
    if raw is None:
        return set()
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        raise Refused("format", "The EPUB's META-INF/encryption.xml is not well-formed XML.") from None
    found = set()
    for data in root.iter():
        if _local(data.tag) != "EncryptedData":
            continue
        for reference in data.iter():
            if _local(reference.tag) == "CipherReference" and reference.get("URI"):
                target = _href("", reference.get("URI"))
                if target:
                    found.add(target[0])
    return found


class _TreeBuilder(HTMLParser):
    """XHTML, or HTML, as a tree of `_Element`s and strings; a stray end tag is left out."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Element("#root", {})
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        element = _Element(_local(tag), {name: value or "" for name, value in attrs})
        self.stack[-1].children.append(element)
        if element.tag not in _VOID:
            self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(_Element(_local(tag), {name: value or "" for name, value in attrs}))

    def handle_endtag(self, tag):
        tag = _local(tag)
        for depth in range(len(self.stack) - 1, 0, -1):
            if self.stack[depth].tag == tag:
                del self.stack[depth:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def _parse_html(raw):
    if raw.startswith(codecs.BOM_UTF8):
        text = raw[3:].decode("utf-8", "replace")
    elif raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        text = raw.decode("utf-16", "replace")
    else:
        declared = re.match(rb"\s*<\?xml[^>]*encoding=[\"']([A-Za-z0-9._-]+)", raw)
        encoding = "utf-8"
        if declared:
            try:
                encoding = codecs.lookup(declared[1].decode()).name
            except LookupError:
                pass
        text = raw.decode(encoding, "replace")
    builder = _TreeBuilder()
    builder.feed(text)
    builder.close()
    return builder.root


def _elements(element):
    """The element's descendant elements, in document order."""
    for child in element.children:
        if isinstance(child, _Element):
            yield child
            yield from _elements(child)


def _body(root):
    return next((element for element in _elements(root) if element.tag == "body"), root)


def _text(element):
    return "".join(child if isinstance(child, str) else _text(child) for child in element.children)


def _nav_toc(root, document):
    """The navigation document's contents, as (title, target or None, parent index) in order."""
    navs = [element for element in _elements(root) if element.tag == "nav"]
    nav = next((nav for nav in navs if nav.types() & {"toc", "doc-toc"}), None)
    top = next((element for element in _elements(nav) if element.tag == "ol"), None) if nav else None
    found = []

    def walk(ol, parent):
        for li in ol.children:
            if not isinstance(li, _Element) or li.tag != "li":
                continue
            label = next((c for c in li.children if isinstance(c, _Element) and c.tag in {"a", "span"}), None)
            title = " ".join(_text(label).split()) if label is not None else ""
            href = label.attrs.get("href") if label is not None and label.tag == "a" else None
            found.append((title, _href(document, href) if href else None, parent))
            index = len(found) - 1
            for child in li.children:
                if isinstance(child, _Element) and child.tag == "ol":
                    walk(child, index)

    if top is not None:
        walk(top, None)
    return found


def _ncx_toc(root, document):
    """The NCX's navMap, as (title, target or None, parent index) in order."""
    found = []

    def walk(element, parent):
        for point in element:
            if _local(point.tag) != "navPoint":
                continue
            label = next((c for c in point if _local(c.tag) == "navLabel"), None)
            text = next((t for t in label.iter() if _local(t.tag) == "text"), None) if label is not None else None
            content = next((c for c in point if _local(c.tag) == "content"), None)
            src = content.get("src") if content is not None else None
            found.append((" ".join("".join(text.itertext()).split()) if text is not None else "", src and _href(document, src), parent))
            walk(point, len(found) - 1)

    navmap = next((e for e in root.iter() if _local(e.tag) == "navMap"), None)
    if navmap is not None:
        walk(navmap, None)
    return found


def _toc_entries(toc, spine):
    """The contents' entries that have a title and a target in the spine, with each one's target.

    An entry with no target of its own takes its first descendant's; a dropped
    entry's children go to its nearest kept ancestor.
    """
    own = [(spine[target[0]], target[1]) if target and target[0] in spine else None for _, target, _ in toc]
    inherited = {}
    for index in reversed(range(len(toc))):
        parent = toc[index][2]
        if parent is not None and (own[index] or inherited.get(index)):
            inherited[parent] = own[index] or inherited[index]
    entries, targets, kept = [], [], {}
    for index, (title, _, parent) in enumerate(toc):
        while parent is not None and parent not in kept:
            parent = toc[parent][2]
        target = own[index] or inherited.get(index)
        if not title or target is None:
            continue
        up = kept.get(parent) if parent is not None else None
        entries.append(_TocEntry(len(entries), up, entries[up].level + 1 if up is not None else 1, title))
        targets.append(target)
        kept[index] = len(entries) - 1
    return entries, targets


def _css_flags(declarations):
    flags = set()
    for name, value in _CSS_DECLARATION.findall(declarations):
        name, value = name.lower(), value.strip().lower()
        if name == "font-style" and value.startswith(("italic", "oblique")):
            flags.add("italic")
        elif name == "font-weight" and (value.startswith("bold") or value in {"600", "700", "800", "900"}):
            flags.add("bold")
        elif name == "vertical-align" and value.startswith("super"):
            flags.add("super")
    return flags


def _css_classes(sheets):
    """Classes that the style sheets make italic, bold or superscript, by simple selectors (`.c`, `span.c`)."""
    styles = {}
    for sheet in sheets:
        for selectors, declarations in _CSS_RULE.findall(re.sub(r"/\*.*?\*/", "", sheet, flags=re.DOTALL)):
            flags = _css_flags(declarations)
            for selector in selectors.split(",") if flags else ():
                if match := _CSS_CLASS.fullmatch(selector):
                    styles.setdefault(match[1], set()).update(flags)
    return styles


def _escape(text):
    return _ESCAPED.sub(lambda match: "\\" + match[0], text)


def _wrap(text, mark):
    """Text in emphasis marks, its outer whitespace outside them."""
    core = text.strip()
    if not mark or not core:
        return text
    return f"{text[: len(text) - len(text.lstrip())]}{mark}{core}{mark[::-1]}{text[len(text.rstrip()) :]}"


def _lines(text):
    """A block's text as its lines: from `<br>`s, spaces collapsed, empty lines left out."""
    lines = (re.sub(" {2,}", " ", line).strip() for line in text.split("\n"))
    return ["\\" + line if _LINE_START.match(line) else line for line in lines if line]


def _epub_label(text):
    label = "".join(_SYMBOLS.get(c, c) for c in text.lower() if c.isalnum() or c in _SYMBOLS)
    return label or "note"


class _EpubWriter:
    """Writes the spine's documents as Markdown blocks, with a heading at each contents entry's target."""

    def __init__(self, documents, styles):
        self.documents, self.styles = documents, styles
        self.files = {path: file for file, (path, _) in enumerate(documents)}
        self.blocks, self.links = [], []
        self.anchors, self.starts, self.pending = {}, [], []  # (document, id): its block; each document's first
        self.references, self.dropped, self.definitions = {}, set(), {}
        for file, (_, body) in enumerate(documents):
            self.file = file
            self.starts.append(len(self.blocks))
            self._container(body, (), False, False, False)
        self.starts.append(len(self.blocks))
        for key in self.pending:
            self.anchors.setdefault(key, len(self.blocks))

    # Blocks

    def _hidden(self, node):
        style = node.attrs.get("style", "").replace(" ", "").lower()
        return node.tag in _SKIPPED or "hidden" in node.attrs or "display:none" in style or "pagebreak" in node.types()

    def _flags(self, node):
        flags = set(_TAG_FLAGS.get(node.tag, ()))
        for name in node.attrs.get("class", "").split():
            flags |= self.styles.get(name, set())
        return flags | _css_flags(node.attrs.get("style", ""))

    def _container(self, element, context, italic, bold, note):
        """Adds the element's children as blocks: a run of inline content between block elements is one."""
        run = []
        for child in element.children:
            if isinstance(child, str) or child.tag not in _BLOCK_TAGS:
                run.append(child)
                continue
            self._add(_Block("text", run, self.file, italic=italic, bold=bold, note=note), context)
            run = []
            self._block(child, context, italic, bold, note)
        self._add(_Block("text", run, self.file, italic=italic, bold=bold, note=note), context)

    def _block(self, element, context, italic, bold, note, marker="- "):
        if self._hidden(element):
            return
        for name in ("id", "name"):
            if element.attrs.get(name):
                self.pending.append((self.file, element.attrs[name]))
        flags = self._flags(element)
        italic, bold = italic or "italic" in flags, bold or "bold" in flags
        note = note or bool(element.types() & _NOTE_TYPES)
        tag = element.tag
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._add(_Block("heading", element.children, self.file, int(tag[1]), note=note), context)
        elif tag in {"table", "pre", "hr"}:
            kind = {"table": "table", "pre": "pre", "hr": "rule"}[tag]
            self._add(_Block(kind, [element], self.file, note=note), context)
        elif tag in {"ul", "ol"}:
            start = element.attrs.get("start", "1").strip()
            number = int(start) if start.isdigit() else 1
            for child in element.children:
                if isinstance(child, _Element):
                    value = child.attrs.get("value", "").strip()
                    number = int(value) if value.isdigit() else number
                    self._block(child, context, italic, bold, note, "- " if tag == "ul" else f"{number}. ")
                    number += child.tag == "li"
        elif tag == "li":
            self._container(element, (*context, _Item(marker)), italic, bold, note)
        elif tag == "blockquote":
            self._container(element, (*context, "quote"), italic, bold, note)
        else:
            self._container(element, context, italic, bold, note)

    def _add(self, block, context):
        ids = [
            (self.file, element.attrs[name])
            for node in block.nodes
            if isinstance(node, _Element)
            for element in (node, *_elements(node))
            for name in ("id", "name")
            if element.attrs.get(name)
        ]
        if block.kind != "rule" and not self._plain(block.nodes).strip():
            self.pending.extend(ids)
            return
        for container in context:
            if container == "quote":
                block.first, block.rest = block.first + "> ", block.rest + "> "
            else:
                block.first += " " * len(container.marker) if container.used else container.marker
                block.rest += " " * len(container.marker)
                container.used = True
        index = len(self.blocks)
        for key in [*self.pending, *ids]:
            self.anchors.setdefault(key, index)
        self.pending = []
        self.blocks.append(block)
        self._scan_links(block, index)

    def _scan_links(self, block, index):
        seen = False
        path, files = self.documents[block.file][0], self.files

        def walk(nodes, raised):
            nonlocal seen
            for node in nodes:
                if isinstance(node, str):
                    seen = seen or bool(node.strip())
                    continue
                if self._hidden(node):
                    continue
                if node.tag in {"img", "math"}:
                    seen = seen or bool(self._plain([node]).strip())
                    continue
                here = raised or "super" in self._flags(node)
                if node.tag == "a" and node.attrs.get("href"):
                    target = _href(path, node.attrs["href"])
                    target = (files[target[0]], target[1]) if target and target[0] in files else None
                    holds = any("super" in self._flags(element) for element in _elements(node))
                    key = (block.file, node.attrs["id"]) if node.attrs.get("id") else None
                    self.links.append(_Link(node, index, not seen, here or holds, len(self.links), key, target))
                walk(node.children, here)

        walk(block.nodes, False)

    def _plain(self, nodes, skip=frozenset()):
        """The nodes' text with images as their alternative text and math as its own, without markup."""
        out = []
        for node in nodes:
            if isinstance(node, str):
                out.append(node)
            elif id(node) in skip or self._hidden(node):
                continue
            elif node.tag == "br":
                out.append(" ")
            elif node.tag == "img":
                out.append(f" {node.attrs.get('alt', '')} ")
            elif node.tag == "math":
                out.append(_math(node))
            else:
                out.append(self._plain(node.children, skip))
        return "".join(out)

    # Notes and headings

    def _notes(self):
        """Footnote references, and the blocks that define their notes, with the label links those start with."""
        leading = {}
        for link in self.links:
            if link.leading:
                leading.setdefault(link.block, link)
        candidates = []
        for link in self.links:
            if link.node.types() & {"noteref", "doc-noteref"}:
                candidates.append(link)
            elif link.raised and link.target is not None and link.target[1] is not None:
                if _NOTE_REFERENCE.fullmatch(" ".join(self._plain([link.node]).split())):
                    candidates.append(link)
        for link in candidates:
            if id(link.node) in self.dropped:
                continue
            block = self.anchors.get(link.target) if link.target and link.target[1] else None
            if block is None or block >= len(self.blocks) or block == link.block or block in self.definitions:
                continue
            label = leading.get(block)
            # The note's label links to the reference, or is its target, or links back into its paragraph.
            if label is None or label is link or not (
                label.key == link.target
                or (label.target is not None and (label.target == link.key or self.anchors.get(label.target) == link.block))
            ):
                label = None
                if not (self.blocks[block].note or link.node.types() & {"noteref", "doc-noteref"}):
                    continue
            self.definitions[block] = link.target
            if label is not None:
                self.dropped.add(id(label.node))
        return [link for link in candidates if id(link.node) not in self.dropped]

    def _match(self, title, first, file, consumed):
        """The block after the lines from `first` that print the title, or None.

        A heading tag of the target's document stands for the title when no lines print it.
        """
        wanted = _letters(title)
        prefix = _NUMBER_PREFIX.match(title)
        bare = _letters(title[prefix.end() :]) if prefix else None
        parts = []
        for index in range(first, min(first + 3, len(self.blocks))):
            block = self.blocks[index]
            if index in consumed or index in self.definitions or block.file != self.blocks[first].file:
                break
            if block.kind not in {"text", "heading"}:
                break
            parts.append(self._plain(block.nodes, self.references))
            printed = " ".join(" ".join(parts).split())
            number = _NUMBER_PREFIX.match(printed)
            if wanted and (_letters(printed) in {wanted, bare} or (number and _letters(printed[number.end() :]) == wanted)):
                return index + 1
        if first < len(self.blocks) and first not in consumed and first not in self.definitions:
            if self.blocks[first].kind == "heading" and self.blocks[first].file == file:
                return first + 1
        return None

    def write(self, entries, targets):
        """The text and its blocks: each entry's heading, in place of the lines that print it, then the blocks."""
        references = self._notes()
        self.references = {id(link.node) for link in references}

        placed, consumed = [], set()  # placed: (block it precedes, entry, the blocks that print it)
        order = sorted(range(len(entries)), key=lambda i: (self._position(targets[i]), i))
        for i in order:
            first = self._position(targets[i])
            while first in consumed:
                first += 1
            after = self._match(entries[i].title, first, targets[i][0], consumed)
            printed = range(first, after) if after else range(0)
            consumed.update(printed)
            placed.append((first, entries[i], printed))
        placed.sort(key=lambda place: (place[0], place[1].order))

        # Footnote labels: the printed one, made unique in the stretches where the note is referred to or defined.
        positions = [place[0] for place in placed]

        def stretch(block):
            return bisect_right(positions, block)

        defined_in = {key: block for block, key in self.definitions.items()}
        notes = {}
        for link in references:
            key = link.target or ("reference", link.order)
            note = notes.setdefault(key, [_epub_label(self._plain([link.node])), set()])
            note[1].add(stretch(link.block))
            if key in defined_in:
                note[1].add(stretch(defined_in[key]))
        used, labels = {}, {}
        for key, (printed, stretches) in notes.items():
            label, number = printed, 1
            while any(label in used.get(s, ()) for s in stretches):
                number += 1
                label = f"{printed}-{number}"
            for s in stretches:
                used.setdefault(s, set()).add(label)
            labels[key] = label
        self.references = {id(link.node): labels[link.target or ("reference", link.order)] for link in references}
        self.labels = {block: labels[key] for block, key in self.definitions.items() if key in labels}

        out, length, blocks = [], 0, []
        for index in range(len(self.blocks) + 1):
            while placed and placed[0][0] == index:
                _, entry, printed = placed.pop(0)
                lines = [line for i in printed for line in _lines(self._inline(self.blocks[i].nodes, marks=False))]
                heading = f"{'#' * min(entry.level, 6)} {' '.join(lines) or _escape(entry.title)}\n"
                blocks.append(Heading(entry.level, entry.title, length, entry))
                out.append(heading + "\n")
                length += len(heading) + 1
            if index == len(self.blocks) or index in consumed:
                continue
            lines = self._render(index)
            if lines:
                paragraph = "\n".join(lines) + "\n"
                blocks.append(Paragraph(length, length + len(paragraph), whole=self.blocks[index].kind == "pre"))
                out.append(paragraph + "\n")
                length += len(paragraph) + 1
        return "".join(out)[:-1], blocks

    def _position(self, target):
        file, fragment = target
        if fragment is None:
            return self.starts[file]
        return self.anchors.get((file, fragment), self.starts[file])

    # Markdown

    def _inline(self, nodes, italic=False, bold=False, marks=True):
        """The nodes as Markdown: emphasis, footnote references, images' alternative text, math's; `<br>` a newline."""
        out = []
        for node in nodes:
            if isinstance(node, str):
                out.append(_escape(_HTML_SPACE.sub(" ", _INVISIBLE.sub("", node))))
            elif self._hidden(node) or id(node) in self.dropped:
                continue
            elif node.tag == "br":
                out.append("\n")
            elif node.tag == "img":
                out.append(_escape(" ".join(node.attrs.get("alt", "").split())))
            elif node.tag == "math":
                out.append(" ".join(_math(node).split()))
            elif id(node) in self.references:
                out.append(f"[^{self.references[id(node)]}]")
            elif node.tag in _BLOCK_TAGS:
                out.append(f" {self._inline(node.children, italic, bold, marks)} ")
            else:
                flags = self._flags(node)
                on_italic, on_bold = "italic" in flags and not italic, "bold" in flags and not bold
                inner = self._inline(node.children, italic or on_italic, bold or on_bold, marks)
                out.append(_wrap(inner, ("*" if on_italic else "") + ("**" if on_bold else "") if marks else ""))
        return "".join(out)

    def _render(self, index):
        """A block's lines, its quote marks and list marker before them."""
        block = self.blocks[index]
        if block.kind == "heading":
            lines = _lines(self._inline(block.nodes, marks=False))
            lines = [f"{'#' * block.level} {' '.join(lines)}"] if lines else []
        elif block.kind == "table":
            lines = self._table(block.nodes[0])
        elif block.kind == "pre":
            code = "".join(_text_with_breaks(block.nodes[0])).replace("\r\n", "\n").replace("\r", "\n")
            code = _INVISIBLE.sub("", code).strip("\n").rstrip()
            fence = "`" * max(3, 1 + max((len(run) for run in re.findall(r"`+", code)), default=0))
            lines = [fence, *code.split("\n"), fence]
        elif block.kind == "rule":
            lines = ["---"]
        else:
            mark = ("*" if block.italic else "") + ("**" if block.bold else "")
            text = _wrap(self._inline(block.nodes, block.italic, block.bold), mark)
            if index in self.labels:
                text = text.lstrip()
                lines = _lines(text[_LABEL_AFTER.match(text).end() :])
                return [f"[^{self.labels[index]}]: {lines[0] if lines else ''}".rstrip(), *lines[1:]]
            lines = _lines(text)
        return [(block.first if number == 0 else block.rest) + line for number, line in enumerate(lines)]

    def _table(self, table):
        """A table as its caption and its rows, a line each, the cells between ` | `."""
        lines = []

        def rows(element):
            for child in element.children:
                if not isinstance(child, _Element) or self._hidden(child):
                    continue
                if child.tag == "caption":
                    lines.extend(_lines(" ".join(_lines(self._inline(child.children)))))
                elif child.tag == "tr":
                    cells = [
                        " ".join(_lines(self._inline(cell.children)))
                        for cell in child.children
                        if isinstance(cell, _Element) and cell.tag in {"td", "th"}
                    ]
                    lines.extend(_lines(" | ".join(cells)))
                elif child.tag in {"thead", "tbody", "tfoot"}:
                    rows(child)

        rows(table)
        return lines


def _math(node):
    """MathML as its alternative text, or else its TeX annotation, or else its characters."""
    if node.attrs.get("alttext", "").strip():
        return node.attrs["alttext"]
    for element in _elements(node):
        if element.tag == "annotation" and "tex" in element.attrs.get("encoding", "").lower():
            return _text(element)
    return " ".join(_text(element) for element in _elements(node) if element.tag in {"mi", "mn", "mo", "mtext"})


def _text_with_breaks(element):
    for child in element.children:
        if isinstance(child, str):
            yield child
        elif child.tag == "br":
            yield "\n"
        else:
            yield from _text_with_breaks(child)


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

    # Bookmarks and EPUB contents entries carry their parents; other headings nest by level in reading order.
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
