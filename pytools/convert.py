"""Source conversion: a source's original into its outline and section files.

    convert.py ingest <original> <folder> [--limit N] [--status-only]

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
With --status-only, success reports only {"result": "converted"}; refusals
are unchanged.
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
continue the count; each section lists where its paragraphs after its first
start in its text. A PDF section's place is its pages instead.
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
import unicodedata
import zipfile
import zlib
from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass, field, replace
from itertools import dropwhile, groupby, pairwise, takewhile
from operator import not_
from pathlib import Path
from html.parser import HTMLParser
from statistics import median
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from markdown_it import MarkdownIt

CONVERTER_VERSION = 8  # raised when the same original would give other files
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
_PAGE_OPENER = "<!-- page "
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
    end: int | None = None  # after the heading's final LF; not needed for PDF headings


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
    # EPUB footnotes: (reference offset, label, definition offset), before section cuts.
    note_links: tuple[tuple[int, str, int], ...] = ()


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
        entries, sections, cut = _outline(source.text, source.blocks, title, limit, source.place, source.note_links)
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
            blocks.append(Heading(int(token.tag[1:]), title, start, end=end))
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
        self._emit("#" * min(level, 6) + " " + _escape_page_openers(title) + "\n")
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
            self.paragraph, self.note_start = self._render(line)
            if self.paragraph_start < self.length:
                first_space = self.paragraph.find(" ")
                word_end = len(self.paragraph) if first_space < 0 else first_space
                self._protect(self.paragraph_start, self.length + word_end)
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
            previous_start, previous_end = self.protected.pop()
            start, end = min(start, previous_start), max(end, previous_end)
        self.protected.append((start, end))

    def _close(self):
        if self.paragraph is None:
            return
        origin = self.length
        # Do this after joining lines, which can itself create a literal opener.
        # Generated inline markers are already recorded at their exact offsets.
        real = {offset - origin for offset, _ in self.inline}
        literal = [match.start() for match in re.finditer(_PAGE_OPENER, self.paragraph) if match.start() not in real]
        escapes = literal
        # Other leading Markdown metacharacters still need protection, but
        # not a second slash for a literal opener at the start.
        if self.paragraph.startswith(("#", ">", "<")) and (not literal or literal[0] != 0):
            escapes = [0, *literal]
        guards = []
        if escapes:

            def offset(at):
                return at + bisect_left(escapes, at)

            pieces, previous = [], 0
            for at in escapes:
                pieces.extend((self.paragraph[previous:at], "\\"))
                previous = at
            pieces.append(self.paragraph[previous:])
            self.paragraph = "".join(pieces)
            self.inline = [(origin + offset(at - origin), page) for at, page in self.inline]
            self.protected = [
                (origin + offset(start - origin), origin + offset(end - origin)) for start, end in self.protected
            ]
            if self.note_start is not None:
                self.note_start = offset(self.note_start)
            for at in literal:
                start = offset(at)
                while start > 0 and self.paragraph[start - 1] == "\\":
                    start -= 1
                guards.append((origin + start, origin + offset(at + len(_PAGE_OPENER))))
        self.marks.extend(self.inline)
        self.inline = []
        self._emit(self.paragraph + "\n")
        self._definitions()
        if self.note_start is not None:
            word_start = self.paragraph.rfind(" ", 0, self.note_start) + 1
            self._protect(origin + word_start, self.length)
        if guards:
            protected, self.protected = sorted(self.protected + guards), []
            for start, end in protected:
                self._protect(start, end)
        self.blocks.append(Paragraph(self.paragraph_start, self.length, protected=tuple(self.protected)))
        self.protected = []
        self.note_start = None
        self._emit("\n")
        self.paragraph = None

    def _definitions(self):
        for label, note in self.notes:
            self._emit(f"\n[^{label}]: {_escape_page_openers(self._note_text(note))}\n")
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


def _escape_page_openers(text):
    return text.replace(_PAGE_OPENER, "\\" + _PAGE_OPENER)


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
_EPUB_BUDGET = 64 << 20  # bytes read out of the archive, decompressed
_EPUB_ELEMENTS = 1_000_000  # elements in all the documents parsed
_EPUB_DEPTH = 100  # elements inside one another
_TOO_LARGE = "The EPUB is too large to read."
_TOO_DEEP = "The EPUB's documents nest too deeply to read."
_XHTML = {"application/xhtml+xml", "text/html"}
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_SKIPPED = {"head", "script", "style", "svg", "template", "title"}
_BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "body", "caption", "center", "dd", "details", "div", "dl", "dt",
    "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
    "html", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "ul",
}  # fmt: skip
# HTML's implied end tags: a start tag ends an open element of the first set, inside the nearest of the second.
_ENDS = {
    "li": ({"li"}, {"ol", "ul"}),
    "dt": ({"dt", "dd"}, {"dl"}),
    "dd": ({"dt", "dd"}, {"dl"}),
    "tr": ({"tr"}, {"table"}),
    "td": ({"td", "th"}, {"tr", "table"}),
    "th": ({"td", "th"}, {"tr", "table"}),
    "thead": ({"thead", "tbody", "tfoot"}, {"table"}),
    "tbody": ({"thead", "tbody", "tfoot"}, {"table"}),
    "tfoot": ({"thead", "tbody", "tfoot"}, {"table"}),
}
_ENDS_P = _BLOCK_TAGS - {"body", "caption", "html"}  # these start tags end an open paragraph
_TAG_FLAGS = {
    "i": {"italic"}, "em": {"italic"}, "cite": {"italic"}, "dfn": {"italic"}, "var": {"italic"},
    "b": {"bold"}, "strong": {"bold"}, "sup": {"super"},
}  # fmt: skip
_NOTES = {"footnote", "endnote", "rearnote", "note", "doc-footnote", "doc-endnote"}  # an element that is one note
_NOTE_LISTS = {"footnotes", "endnotes", "rearnotes", "doc-endnotes"}  # an element that holds notes
_NOTEREFS = {"noteref", "doc-noteref"}
_BACKLINKS = {"backlink", "doc-backlink"}
_NOTE_REFERENCE = re.compile(r"[\[(]?(?:\d{1,4}|[a-z]{1,3}|[*∗†‡§¶]{1,3})[\])]?\.?", re.IGNORECASE)
_LABEL_AFTER = {".", ")", ":", "]"}  # between a note's printed label and its text
_HTML_SPACE = re.compile(r"[ \t\n\r\f]+")
_SPACES = re.compile(" {2,}")
_INVISIBLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\xad]")  # controls and soft hyphens
_CSS_RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
_CSS_CLASS = re.compile(r"\s*[a-z0-9]*\.([\w-]+)\s*", re.IGNORECASE)
_CSS_DECLARATION = re.compile(r"([\w-]+)\s*:\s*([^;]+)")

# Markdown's inline syntax in a document's own characters. A reference is written between \x00 and \x01, and
# text kept as it is (math) as its number between \x02 and \x03, until the line is whole (`_EpubWriter._line`).
_ESCAPED = re.compile(
    r"[\\*`~]"  # `~` too: GFM reads text between single ones as struck through
    r"|(?<![^\W_])_|_(?![^\W_])"  # an underscore that is not inside a word
    r"|<(?=[A-Za-z/!?]|[0-9A-Za-z.!#$%&'*+/=?^_`{|}~-]+@)"  # a tag, or a link or an address in angle brackets
    r"|&(?=#?[A-Za-z0-9]+;)"  # an entity
    r"|\[(?=\^)"  # a footnote
    r"|\](?=\()"  # a link
    r"|(?<=\x01)[(:]"  # after a reference: its text as a link's, or a definition's colon
)
_KEPT = re.compile("\x00([^\x01]*)\x01|\x02([0-9]+)\x03")
# A line's start that would make it a heading, a quote, a list item, a rule, a heading's underline, a table's
# rule or a link's definition.
_LINE_START = re.compile(r"#{1,6}(?=\s|$)|>|[-+](?=\s|$)|[-=:|][-=:|\s]*$|\[(?=.*\]:)")
_LINE_NUMBER = re.compile(r"\d{1,9}(?=[.)](?:\s|$))")
# A written paragraph's spans that are not the document's characters: a line break, an escape, a reference.
_WRITTEN = re.compile(r"(\\\n)|(\\.)|(\[\^[^\]\s]+\])")
_ATOM = re.compile(r"([ \t\n\r\f   -   　]+)|([^\W_]+)|(.)", re.DOTALL)
_ITALIC, _BOLD = 1, 2


@dataclass(frozen=True)
class _TocEntry:
    order: int
    parent: int | None
    level: int
    title: str


@dataclass(eq=False, slots=True)
class _Element:
    tag: str
    attrs: dict
    children: list = field(default_factory=list)

    def types(self):
        return set(f"{self.attrs.get('epub:type', '')} {self.attrs.get('role', '')}".split())


@dataclass(eq=False)
class _Container:
    """A block quote or a list item a block is in; an item's marker is written before its first block only."""

    marker: str
    quote: bool = False
    used: bool = False


@dataclass(frozen=True)
class _Inherited:
    """What a block takes from the elements it is in."""

    context: tuple = ()  # the quotes and list items, from the outside
    italic: bool = False
    bold: bool = False
    note: bool = False  # in an element typed as a note, or as notes
    unit: int | None = None  # the note it is in: an element typed as one, or an item of a list typed as notes
    listed: bool = False  # in an element typed as notes


@dataclass
class _Block:
    kind: str  # "text", "heading" (h1 to h6), "table", "pre" or "rule"
    nodes: list
    file: int  # its document's place in the spine
    state: _Inherited
    level: int = 0
    first: str = ""  # its first line's quote marks and list marker
    rest: str = ""  # its other lines'


@dataclass
class _Link:
    node: _Element
    block: int
    leading: bool  # no text before it in its block
    raised: bool  # superscript, or holding one
    order: int
    keys: tuple  # (document, id) of the link itself, by its id and its name
    target: tuple | None  # (document, fragment or None) it points to, within the spine


@dataclass(slots=True)
class _Atom:
    """A piece of a line: spaces, a word's characters, or one punctuation mark; or a reference, or math."""

    text: str
    style: int  # _ITALIC, _BOLD
    head: str  # its first character's kind for emphasis marks: "s" space, "p" punctuation, "w" other
    tail: str  # its last character's


class _Archive:
    """The EPUB's ZIP archive, read within a budget of bytes, and of parsed elements and their depth."""

    def __init__(self, archive):
        self.archive, self.budget, self.elements, self.encrypted = archive, _EPUB_BUDGET, _EPUB_ELEMENTS, set()
        self.names = {info.filename: info for info in archive.infolist()}

    def locked(self, name):
        """Whether the member is encrypted: META-INF/encryption.xml lists it, or the ZIP says so."""
        info = self.names.get(name)
        return name in self.encrypted or (info is not None and bool(info.flag_bits & 1))

    def read(self, name, document=True):
        """The member's bytes, or None without it; an encrypted one refuses the book if it is a text document."""
        info = self.names.get(name)
        if info is None:
            return None
        if self.locked(name):
            if document:
                raise Refused("protected", "Its text is encrypted (DRM), so Gauss cannot read it.")
            return None
        try:
            with self.archive.open(info) as member:
                raw = member.read(self.budget + 1)
        except (zipfile.BadZipFile, NotImplementedError, OSError, EOFError, zlib.error, ValueError):
            raise Refused("format", "The EPUB's archive cannot be read.") from None
        self.budget -= len(raw)
        if self.budget < 0:
            raise Refused("format", _TOO_LARGE)
        return raw

    def xml(self, name, required=True):
        raw = self.read(name)
        if raw is None and not required:
            return None
        if raw is None:
            raise Refused("format", f"The EPUB lacks its {name}.")
        try:
            return self.parse(raw)
        except ElementTree.ParseError:
            if not required:
                return None
            raise Refused("format", f"The EPUB's {name} is not well-formed XML.") from None

    def parse(self, raw):
        """XML as a tree of its elements, each counted as it is read."""
        parser = ElementTree.XMLParser(target=_XmlBuilder(self))
        parser.feed(raw)
        return parser.close()

    def html(self, name):
        raw = self.read(name)
        return None if raw is None else _parse_html(raw, self)

    def element(self, depth):
        """Counts a parsed element, the `depth`th inside one another, against the budgets."""
        self.elements -= 1
        if self.elements < 0:
            raise Refused("format", _TOO_LARGE)
        if depth > _EPUB_DEPTH:
            raise Refused("format", _TOO_DEEP)


class _XmlBuilder(ElementTree.TreeBuilder):
    """`ElementTree`'s builder, within the archive's budgets."""

    def __init__(self, book):
        super().__init__()
        self.book, self.depth = book, 0

    def start(self, tag, attrs):
        self.depth += 1
        self.book.element(self.depth)
        return super().start(tag, attrs)

    def end(self, tag):
        self.depth -= 1
        return super().end(tag)


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
        try:
            return _read_book(book)
        except RecursionError:
            raise Refused("format", _TOO_DEEP) from None


def _read_book(book):
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
    for path, media, _ in manifest.values():
        if media in _XHTML and book.locked(path):
            book.read(path)  # refuses: a text document of the book, in its reading order or not
    spine = next((e for e in package.iter() if _local(e.tag) == "spine"), None)
    paths = []
    for itemref in [] if spine is None else spine:
        item = manifest.get(itemref.get("idref")) if _local(itemref.tag) == "itemref" else None
        if item and item[1] in _XHTML and item[0] not in paths:
            paths.append(item[0])
    documents = []
    for path in paths:
        root = book.html(path)
        if root is not None:
            documents.append((path, _body(root)))

    metadata = (e for e in package.iter() if _local(e.tag) == "title")
    title = next((" ".join("".join(e.itertext()).split()) for e in metadata if "".join(e.itertext()).strip()), None)
    toc = []
    nav = next((path for path, _, properties in manifest.values() if "nav" in properties), None)
    if nav is not None and (root := book.html(nav)) is not None:
        toc = _nav_toc(root, nav)
    ncx = manifest.get(spine.get("toc")) if spine is not None else None
    ncx = ncx or next((item for item in manifest.values() if item[1] == "application/x-dtbncx+xml"), None)
    ncx_root = book.xml(ncx[0], required=False) if ncx and (not toc or title is None) else None
    if ncx_root is not None and not toc:
        toc = _ncx_toc(ncx_root, ncx[0])
    if ncx_root is not None and title is None:
        doc_title = next((e for e in ncx_root.iter() if _local(e.tag) == "docTitle"), None)
        title = " ".join("".join(doc_title.itertext()).split()) if doc_title is not None else None

    sheets = [book.read(path, document=False) for path, media, _ in manifest.values() if media == "text/css"]
    styles = _css_classes(sheet.decode("utf-8", "replace") for sheet in sheets if sheet)
    entries, targets = _toc_entries(toc, {path: index for index, (path, _) in enumerate(documents)})
    text, blocks, note_links = _EpubWriter(documents, styles, targets).write(entries, targets)
    if not text:
        raise Refused("empty", "It holds no text.")
    _check_paragraphs(blocks)
    return _Source("epub", text, blocks, title or None, note_links=note_links)


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

    Only a text document among them refuses the book (`_read_book`); Gauss never reads a font.
    """
    raw = book.read("META-INF/encryption.xml", document=False)
    if raw is None:
        return set()
    try:
        root = book.parse(raw)
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
    """XHTML, or HTML, as a tree of `_Element`s and strings.

    HTML's end tags that may be left out are supplied (`_ENDS`), and a stray end tag is left out.
    """

    def __init__(self, book):
        super().__init__(convert_charrefs=True)
        self.book = book
        self.root = _Element("#root", {})
        self.stack = [self.root]

    def _end(self, tags, within):
        for depth in range(len(self.stack) - 1, 0, -1):
            if self.stack[depth].tag in tags:
                del self.stack[depth:]
                return
            if self.stack[depth].tag in within:
                return

    def _start(self, tag, attrs, open):
        tag = _local(tag)
        if tag in _ENDS:
            self._end(*_ENDS[tag])
        if tag in _ENDS_P:
            self._end({"p"}, _BLOCK_TAGS)
        self.book.element(len(self.stack))
        element = _Element(tag, {name: value or "" for name, value in attrs})
        self.stack[-1].children.append(element)
        if open and tag not in _VOID:
            self.stack.append(element)

    def handle_starttag(self, tag, attrs):
        self._start(tag, attrs, True)

    def handle_startendtag(self, tag, attrs):
        self._start(tag, attrs, False)

    def handle_endtag(self, tag):
        tag = _local(tag)
        for depth in range(len(self.stack) - 1, 0, -1):
            if self.stack[depth].tag == tag:
                del self.stack[depth:]
                return

    def handle_data(self, data):
        children = self.stack[-1].children
        if children and isinstance(children[-1], str):
            children[-1] += data
        else:
            children.append(data)

    def unknown_decl(self, data):
        if data.startswith("CDATA["):
            self.handle_data(data[6:])


def _parse_html(raw, book):
    if raw.startswith(codecs.BOM_UTF8):
        text = raw[3:].decode("utf-8", "replace")
    elif raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        text = raw.decode("utf-16", "replace")
    else:
        declared = re.match(rb"\s*<\?xml[^>]*?\bencoding\s*=\s*[\"']([A-Za-z0-9._-]+)", raw)
        encoding = "utf-8"
        if declared:
            try:
                encoding = codecs.lookup(declared[1].decode()).name
            except LookupError:
                pass
        text = raw.decode(encoding, "replace")
    builder = _TreeBuilder(book)
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


def _line_start(line):
    """The line, with a start that Markdown would read as a block's mark escaped."""
    if _LINE_START.match(line):
        return "\\" + line
    if number := _LINE_NUMBER.match(line):
        return f"{number[0]}\\{line[number.end() :]}"
    return line


def _heading_line(level, text):
    """An ATX heading; a run of `#` that would close it is escaped."""
    if re.search(r"(?:^|\s)#+$", text):
        text = text[:-1] + "\\#"
    return f"{'#' * min(level, 6)} {text}"


def _words(text):
    return re.findall(r"[^\W_]+", text.lower())


def _holds(words, others):
    """Whether one list of words holds the other, in order and together."""
    long, short = (words, others) if len(words) >= len(others) else (others, words)
    return bool(short) and any(long[i : i + len(short)] == short for i in range(len(long) - len(short) + 1))


def _text_atoms(text, style, out):
    for match in _ATOM.finditer(text):
        if match[1]:
            kind = "s"
        elif match[2]:
            kind = "w"
        else:
            kind = "p" if unicodedata.category(match[3])[0] in "PS" else "w"
        out.append(_Atom(match[0], style, kind, kind))


def _settle(atoms):
    """Narrows the atoms' styles until emphasis marks written around them are read as written.

    CommonMark reads `*` as opening only before a character that is not a
    space, and not before punctuation that follows a letter; as closing, the
    reverse. So spaces take the style both their neighbours share, and
    punctuation between a letter and a change of style takes the letter's
    side. Italic and bold that overlap without one holding the other cannot
    be nested: the one that starts later gives up the overlap. And marks
    that open more emphasis inside emphasis are read as closing it unless
    they follow a space, or punctuation before a letter: elsewhere the text
    gives the inner emphasis up.
    """
    while True:
        changed = False
        for index, atom in enumerate(atoms):
            if atom.head == "s":
                atom.style = atoms[index - 1].style & atoms[index + 1].style
        for a, b in pairwise(atoms):
            if a.head == "s" or b.head == "s" or a.style == b.style:
                continue
            closes, opens = a.style & ~b.style, b.style & ~a.style
            if closes and a.tail == "p" and b.head == "w":
                a.style &= b.style
                changed = True
            elif opens and (a.tail + b.head == "wp" or (a.style & b.style and a.tail + b.head != "pw")):
                b.style &= a.style
                changed = True
        for bit, other in ((_ITALIC, _BOLD), (_BOLD, _ITALIC)):
            start = 0
            while start < len(atoms):
                end = start
                while end < len(atoms) and atoms[end].style & bit:
                    end += 1
                if end > start and start > 0 and atoms[start].style & atoms[start - 1].style & other:
                    stop = start
                    while stop < end and atoms[stop].style & other:
                        stop += 1
                    if stop < end:  # the other style started before this one, and ends inside it
                        for atom in atoms[start:stop]:
                            atom.style &= ~bit
                        changed = True
                start = max(end, start + 1)
        if not changed:
            return


def _marked(runs, active=0):
    """Runs of (style, text) as Markdown: each style's marks around the longest stretch of runs that have it."""
    out, index = [], 0
    while index < len(runs):
        style, text = runs[index]
        best = None
        for bit, mark in ((_ITALIC, "*"), (_BOLD, "**")):
            if style & bit & ~active:
                end = index
                while end < len(runs) and runs[end][0] & bit:
                    end += 1
                if best is None or end > best[0]:
                    best = (end, bit, mark)
        if best is None:
            out.append(_escape(text))
            index += 1
        else:
            end, bit, mark = best
            out.append(mark + _marked(runs[index:end], active | bit) + mark)
            index = end
    return "".join(out)


def _guarded(paragraph):
    """A written paragraph's spans that no cut may fall in.

    A reference with the word it follows, a line break, and an escaped character with its backslash.
    """
    spans = []
    for match in _WRITTEN.finditer(paragraph):
        if match[1]:
            start, end = match.start(), min(match.end() + 1, len(paragraph))
        elif match[2]:
            start, end = match.span()
        else:
            word = max(paragraph.rfind(" ", 0, match.start()), paragraph.rfind("\n", 0, match.start())) + 1
            start, end = word, match.end()
        while spans and spans[-1][1] > start:
            start = min(start, spans.pop()[0])
        spans.append((start, end))
    return spans


def _epub_label(text):
    label = "".join(_SYMBOLS.get(c, c) for c in text.lower() if c.isalnum() or c in _SYMBOLS)
    return label or "note"


class _EpubWriter:
    """Writes the spine's documents as Markdown blocks, with a heading at each contents entry's target."""

    def __init__(self, documents, styles, targets):
        self.documents, self.styles = documents, styles
        self.targets = {target for target in targets if target[1] is not None}
        self.files = {path: file for file, (path, _) in enumerate(documents)}
        self.blocks, self.links = [], []
        self.anchors, self.starts, self.pending = {}, [], []  # (document, id): its block; each document's first
        self.definitions, self.continued = set(), {}  # blocks that start a note; a note's later blocks: its first
        self.dropped, self.stripped = set(), set()  # links left out; blocks whose label was one
        self.references, self.labels, self.kept = {}, {}, []  # a reference's label; a definition's; text kept as it is
        for file, (_, body) in enumerate(documents):
            self.file = file
            self.starts.append(len(self.blocks))
            self._container(body, _Inherited())
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

    def _keys(self, element):
        return [(self.file, element.attrs[name]) for name in ("id", "name") if element.attrs.get(name)]

    def _container(self, element, state):
        """Adds the element's children as blocks: a run of inline content between block elements is one."""
        run = []
        for child in element.children:
            if isinstance(child, str) or child.tag not in _BLOCK_TAGS:
                run.append(child)
                continue
            self._add(_Block("text", run, self.file, state))
            run = []
            self._block(child, state)
        self._add(_Block("text", run, self.file, state))

    def _block(self, element, state, marker="- "):
        self.pending.extend(self._keys(element))
        if self._hidden(element):
            return
        flags, types, tag = self._flags(element), element.types(), element.tag
        unit = state.unit
        if unit is None and (types & _NOTES or (tag == "li" and state.listed)):
            unit = id(element)
        state = replace(
            state,
            italic=state.italic or "italic" in flags,
            bold=state.bold or "bold" in flags,
            note=state.note or bool(types & (_NOTES | _NOTE_LISTS)),
            unit=unit,
            listed=state.listed or bool(types & _NOTE_LISTS),
        )
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._add(_Block("heading", element.children, self.file, state, int(tag[1])))
        elif tag in {"table", "pre", "hr"}:
            kind = {"table": "table", "pre": "pre", "hr": "rule"}[tag]
            self._add(_Block(kind, [element], self.file, state))
        elif tag in {"ul", "ol"}:
            start = element.attrs.get("start", "1").strip()
            number = int(start) if start.isdigit() else 1
            for child in element.children:
                if isinstance(child, _Element):
                    value = child.attrs.get("value", "").strip()
                    number = int(value) if value.isdigit() else number
                    self._block(child, state, "- " if tag == "ul" else f"{number}. ")
                    number += child.tag == "li"
        elif tag == "li":
            self._container(element, replace(state, context=(*state.context, _Container(marker))))
        elif tag == "blockquote":
            self._container(element, replace(state, context=(*state.context, _Container("> ", quote=True))))
        else:
            self._container(element, state)

    def _ids(self, nodes):
        return [
            key
            for node in nodes
            if isinstance(node, _Element)
            for element in (node, *_elements(node))
            for key in self._keys(element)
        ]

    def _add(self, block):
        """Adds the block, divided where a contents entry's target is inside its text."""
        if block.kind == "text" and any(key in self.targets for key in self._ids(block.nodes)):
            while (parts := self._divide(block.nodes)) is not None:
                self._put(replace(block, nodes=parts[0]))
                block = replace(block, nodes=parts[1])
        self._put(block)

    def _divide(self, nodes):
        """The nodes before, and from, the first contents target among them that has text before it; or None."""
        seen, found = False, None

        def find(nodes):
            nonlocal seen, found
            for node in nodes:
                if isinstance(node, str):
                    seen = seen or bool(node.strip())
                    continue
                if seen and any(key in self.targets for key in self._keys(node)):
                    found = node
                    return True
                if self._hidden(node):
                    continue
                if node.tag in {"img", "math"}:
                    seen = seen or bool(self._plain([node]).strip())
                elif find(node.children):
                    return True
            return False

        def cut(nodes):
            for index, node in enumerate(nodes):
                if node is found:
                    return nodes[:index], nodes[index:]
                inner = cut(node.children) if isinstance(node, _Element) else None
                if inner is not None:
                    attrs = {name: value for name, value in node.attrs.items() if name not in {"id", "name"}}
                    before, after = _Element(node.tag, node.attrs, inner[0]), _Element(node.tag, attrs, inner[1])
                    return [*nodes[:index], before], [after, *nodes[index + 1 :]]
            return None

        return cut(nodes) if find(nodes) else None

    def _put(self, block):
        ids = self._ids(block.nodes)
        if block.kind != "rule" and not self._plain(block.nodes).strip():
            self.pending.extend(ids)
            return
        for container in block.state.context:
            if container.quote:
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
                    keys = tuple((block.file, node.attrs[name]) for name in ("id", "name") if node.attrs.get(name))
                    self.links.append(_Link(node, index, not seen, here or holds, len(self.links), keys, target))
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

    def _label(self, link):
        return " ".join(self._plain([link.node]).split())

    # Notes and headings

    def _notes(self):
        """The footnote references, each with the block that starts its note, or None when it has none.

        A link typed as a note's reference is one. So is a raised link with a
        short label, when its target is in a note: inside an element typed as
        a note, or a block starting with the same label as a link that is the
        target or leads back. That link, and one typed as leading back, are
        left out. The notes are found first, from every link, so that a
        reference does not depend on the ones read before it; and a target in
        a note's later block is a reference to the note.
        """
        leading = {}
        for link in self.links:
            if link.leading:
                leading.setdefault(link.block, link)
        candidates = []  # (link, whether typed as a reference, the block at its target or None)
        for link in self.links:
            types = link.node.types()
            if types & _BACKLINKS:
                self.dropped.add(id(link.node))
                continue
            typed = bool(types & _NOTEREFS)
            anchored = link.target is not None and link.target[1] is not None
            if not typed and not (link.raised and anchored and _NOTE_REFERENCE.fullmatch(self._label(link))):
                continue
            block = self.anchors.get(link.target) if anchored else None
            if block is not None and (block >= len(self.blocks) or self.blocks[block].kind != "text"):
                block = None
            candidates.append((link, typed, block))

        inside = set()  # blocks in a note that do not start with its label
        for link, typed, block in candidates:
            if block is None or block == link.block or id(link.node) in self.dropped:
                continue
            label = leading.get(block)
            if label is not None and self._labels(label, link):
                self.dropped.add(id(label.node))
                self.stripped.add(block)
                self.definitions.add(block)
            elif typed or self.blocks[block].state.note:
                inside.add(block)
        self.definitions.update([self._note_start(block) for block in inside])

        references = []
        for link, typed, block in candidates:
            if id(link.node) in self.dropped:
                continue
            if block is not None:
                block = self._note_start(block)
                if block not in self.definitions or block == self._note_start(link.block):
                    block = None
            if block is not None or typed:
                references.append((link, block))

        owner = unit = None  # the note being read, and the element it is
        for index, block in enumerate(self.blocks):
            if index in self.definitions:
                owner, unit = index, block.state.unit
            elif unit is not None and block.state.unit == unit:
                self.continued[index] = owner
            else:
                owner = unit = None
        # A link in a note that leads back to its reference, by a mark or the label alone, is left out too.
        referred = {id(link.node) for link, _ in references}
        back = {}
        for link, block in references:
            if block is not None:
                back.setdefault(block, set()).update(link.keys)
        for link in self.links:
            keys = back.get(self.continued.get(link.block, link.block), ())
            if link.target in keys and id(link.node) not in referred:
                label = self._label(link)
                if not any(c.isalnum() for c in label) or _NOTE_REFERENCE.fullmatch(label):
                    self.dropped.add(id(link.node))
        return references

    def _note_start(self, block):
        """The block that starts the note `block` is in.

        Itself, unless it is a later block of an element that is one note: then the nearest block before it
        that starts with a note's label, or else the element's first block of text.
        """
        unit = self.blocks[block].state.unit
        start = block
        if unit is None:
            return start
        while start not in self.definitions and block and self.blocks[block - 1].state.unit == unit:
            block -= 1
            if self.blocks[block].kind == "text":
                start = block
        return start

    def _labels(self, label, link):
        """Whether `label`, the link a block starts with, prints the label of the note that `link` refers to."""
        if label is link or id(label.node) in self.dropped:
            return False
        printed = self._label(label)
        if not _NOTE_REFERENCE.fullmatch(printed) or _epub_label(printed) != _epub_label(self._label(link)):
            return False
        back = label.target
        return link.target in label.keys or (
            back is not None and (back in link.keys or self.anchors.get(back) == link.block)
        )

    def _place(self, entries, targets):
        """Each entry's heading, as (the block it goes before, the entry, the blocks that print its title).

        The title is looked for from the entry's target, after the lines an
        entry before it took, in its document and before the next entry's
        target. Lines that print its letters come first for every entry; then
        a heading tag at the target whose words hold the title's, or the
        reverse.
        """
        positions = [self._position(target) for target in targets]
        bounds = sorted(set(positions))
        noted = self.definitions | self.continued.keys()
        consumed, printed = set(), {}
        for exact in (True, False):
            for i in sorted(range(len(entries)), key=lambda i: (positions[i], i)):
                if i in printed:
                    continue
                first = positions[i]
                while exact and first in consumed:
                    first += 1
                after = bisect_right(bounds, positions[i])
                end = min(self.starts[targets[i][0] + 1], bounds[after] if after < len(bounds) else len(self.blocks))
                found = self._match(entries[i].title, first, end, consumed, noted, exact)
                if found is not None:
                    printed[i] = range(first, found)
                    consumed.update(printed[i])
        placed = [(positions[i], entry, printed.get(i, range(0))) for i, entry in enumerate(entries)]
        return sorted(placed, key=lambda place: (place[0], place[1].order)), consumed

    def _match(self, title, first, end, consumed, noted, exact):
        """The block after those from `first`, before `end`, that print the title; or None.

        `exact`: by their letters, with or without a number before them; or else a heading tag by its words.
        """
        if not exact:
            if first >= end or first in consumed or first in noted or self.blocks[first].kind != "heading":
                return None
            printed = self._plain(self.blocks[first].nodes, self.references)
            return first + 1 if _holds(_words(title), _words(printed)) else None
        wanted = _letters(title)
        prefix = _NUMBER_PREFIX.match(title)
        bare = _letters(title[prefix.end() :]) if prefix else None
        parts = []
        for index in range(first, min(first + 3, end)):
            if index in consumed or index in noted or self.blocks[index].kind not in {"text", "heading"}:
                break
            parts.append(self._plain(self.blocks[index].nodes, self.references))
            printed = " ".join(" ".join(parts).split())
            number = _NUMBER_PREFIX.match(printed)
            numbered = number and _letters(printed[number.end() :]) == wanted
            if wanted and (_letters(printed) in {wanted, bare} or numbered):
                return index + 1
        return None

    def _position(self, target):
        file, fragment = target
        if fragment is None:
            return self.starts[file]
        block = self.anchors.get((file, fragment), self.starts[file])
        return self.continued.get(block, block)  # a target inside a note is the note's: its blocks stay together

    def write(self, entries, targets):
        """The text and its blocks: each entry's heading, in place of the lines that print it, then the blocks."""
        references = self._notes()
        self.references = dict.fromkeys(id(link.node) for link, _ in references)
        placed, consumed = self._place(entries, targets)

        # Footnote labels: the printed one, made unique in the stretches where the note is referred to or defined.
        positions = [place[0] for place in placed]

        def stretch(block):
            return bisect_right(positions, block)

        def key(link, block):
            if block is not None:
                return "note", block
            return ("target", link.target) if link.target else ("reference", link.order)

        notes = {}
        for link, block in references:
            note = notes.setdefault(key(link, block), [_epub_label(self._label(link)), set()])
            note[1].add(stretch(link.block))
            if block is not None:
                note[1].add(stretch(block))
        used, labels = {}, {}
        for note, (printed, stretches) in notes.items():
            label, number = printed, 1
            while any(label in used.get(s, ()) for s in stretches):
                number += 1
                label = f"{printed}-{number}"
            for s in stretches:
                used.setdefault(s, set()).add(label)
            labels[note] = label
        self.references = {id(link.node): labels[key(link, block)] for link, block in references}
        self.labels = {block: labels["note", block] for block in self.definitions}
        # Keep the original destination until the final section cuts are known.
        # Labels alone cannot distinguish notes in disjoint stretches.
        destinations = {}
        for link, block in references:
            if block is not None:
                destinations.setdefault(link.block, {})[labels["note", block]] = block
        refs_at, definitions_at = [], {}

        def record_refs(text, start, targets):
            if targets:
                for match in _WRITTEN.finditer(text):
                    if match[3] and (label := match[3][2:-1]) in targets:
                        refs_at.append((start + match.start(), label, targets[label]))

        out, length, blocks = [], 0, []
        before = None  # the block written last, when the next may go on in its quote
        note = None  # the note being written: the block that starts it
        for index in range(len(self.blocks) + 1):
            while placed and placed[0][0] == index:
                _, entry, printed = placed.pop(0)
                lines = [line for i in printed for line in self._lines(self.blocks[i].nodes, marks=False)]
                text = " ".join(line for line in lines if line)
                heading = _heading_line(entry.level, text or _escape(_INVISIBLE.sub("", entry.title))) + "\n"
                if out:
                    out.append("\n")
                    length += 1
                blocks.append(Heading(entry.level, entry.title, length, entry, length + len(heading)))
                record_refs(heading, length, {k: v for i in printed for k, v in destinations.get(i, {}).items()})
                out.append(heading)
                length += len(heading)
                before = note = None
            if index == len(self.blocks) or index in consumed:
                continue
            block = self.blocks[index]
            joined = note is not None and self.continued.get(index) == note
            paragraphs, breaks = self._render(index, joined)
            for number, lines in enumerate(paragraphs):
                paragraph = ("\\\n" if breaks else "\n").join(lines) + "\n"
                continuation = joined or (number and index in self.labels)
                if continuation:
                    out.append("\n")
                    length += 1
                elif out:
                    separator = "" if index in self.labels else self._separator(before, block)
                    out.append(separator + "\n")
                    length += len(separator) + 1
                if index in self.labels and number == 0:
                    definitions_at[index] = length
                record_refs(paragraph, length, destinations.get(index))
                if continuation:  # a note's later paragraphs are part of it
                    blocks[-1] = Paragraph(blocks[-1].start, length + len(paragraph), whole=True)
                else:
                    whole = block.kind == "pre" or index in self.labels
                    guarded = () if whole else tuple((length + a, length + b) for a, b in _guarded(paragraph))
                    blocks.append(Paragraph(length, length + len(paragraph), whole=whole, protected=guarded))
                out.append(paragraph)
                length += len(paragraph)
                if not continuation:
                    before, note = (None, index) if index in self.labels else (block, None)
        links = tuple((r, label, definitions_at[d]) for r, label, d in refs_at if d in definitions_at)
        return "".join(out), blocks, links

    # Markdown

    def _separator(self, before, block):
        """The line between two blocks: empty, or the marks of the innermost quote that both are in."""
        if before is None:
            return ""
        shared = list(takewhile(lambda pair: pair[0] is pair[1], zip(before.state.context, block.state.context)))
        while shared and not shared[-1][0].quote:
            shared.pop()
        return "".join("> " if c.quote else " " * len(c.marker) for c, _ in shared).rstrip()

    def _atoms(self, nodes, style, marks, out):
        """The nodes' text in pieces, each with its emphasis, and None for a `<br>`."""
        for node in nodes:
            if isinstance(node, str):
                _text_atoms(_HTML_SPACE.sub(" ", _INVISIBLE.sub("", node)), style, out)
            elif self._hidden(node) or id(node) in self.dropped:
                continue
            elif node.tag == "br":
                out.append(None)
            elif node.tag == "img":
                _text_atoms(" ".join(_INVISIBLE.sub("", node.attrs.get("alt", "")).split()), style, out)
            elif node.tag == "math":
                text = " ".join(_math(node).split())
                if text:
                    kinds = ["p" if unicodedata.category(c)[0] in "PS" else "w" for c in (text[0], text[-1])]
                    out.append(_Atom(f"\x02{len(self.kept)}\x03", style, *kinds))
                    self.kept.append(text)
            elif id(node) in self.references:
                out.append(_Atom(f"\x00{self.references[id(node)]}\x01", style, "p", "p"))
            elif node.tag in _BLOCK_TAGS:
                out.append(_Atom(" ", style, "s", "s"))
                self._atoms(node.children, style, marks, out)
                out.append(_Atom(" ", style, "s", "s"))
            else:
                flags = self._flags(node) if marks else ()
                inner = style | (_ITALIC if "italic" in flags else 0) | (_BOLD if "bold" in flags else 0)
                self._atoms(node.children, inner, marks, out)
        return out

    def _lines(self, nodes, style=0, marks=True, strip=False):
        """The nodes as Markdown, a line for each run between `<br>`s, empty for a run with no text.

        `strip`: without the punctuation that followed the note's label, which was a link left out.
        """
        rows = [[]]
        for atom in self._atoms(nodes, style, marks, []):
            if atom is None:
                rows.append([])
            else:
                rows[-1].append(atom)
        if strip:
            rows[0] = list(dropwhile(lambda atom: atom.head == "s" or atom.text in _LABEL_AFTER, rows[0]))
        return [self._line(row) for row in rows]

    def _line(self, atoms):
        """A line's pieces as Markdown: spaces collapsed and trimmed, emphasis marked, its own characters escaped."""
        line = []
        for atom in atoms:
            if atom.head == "s" and (not line or line[-1].head == "s"):
                if line:
                    line[-1].text += atom.text
                continue
            line.append(atom)
        if line and line[-1].head == "s":
            line.pop()
        for atom in line:
            if atom.head == "s":
                atom.text = _SPACES.sub(" ", atom.text)
        if any(atom.style for atom in line):
            _settle(line)
        styled = groupby(line, key=lambda atom: atom.style)
        runs = [(style, "".join(atom.text for atom in run)) for style, run in styled]
        return _KEPT.sub(lambda m: f"[^{m[1]}]" if m[2] is None else self.kept[int(m[2])], _marked(runs))

    def _flat(self, nodes, marks=True):
        return " ".join(line for line in self._lines(nodes, marks=marks) if line)

    def _render(self, index, joined=False):
        """A block's paragraphs, each its lines, and whether a line of them ends with a break.

        A note's first block starts with its label; `joined`, a later block of the note written before it.
        """
        block = self.blocks[index]
        breaks = block.kind in {"text", "table"}
        if block.kind == "heading":
            text = self._flat(block.nodes, marks=False)
            paragraphs = [[_heading_line(block.level, text)]] if text else []
        elif block.kind == "table":
            rows = self._table(block.nodes[0])
            paragraphs = [rows] if rows else []
        elif block.kind == "pre":
            code = "".join(_text_with_breaks(block.nodes[0])).replace("\r\n", "\n").replace("\r", "\n")
            # HTML leaves out a newline that starts the element; one that ends the text ends its last line.
            code = _INVISIBLE.sub("", code).removeprefix("\n").removesuffix("\n").split("\n")
            fence = "`" * max(3, 1 + max((len(run) for line in code for run in re.findall(r"`+", line)), default=0))
            paragraphs = [[fence, *code, fence]]
        elif block.kind == "rule":
            paragraphs = [["---"]]
        else:
            style = (_ITALIC if block.state.italic else 0) | (_BOLD if block.state.bold else 0)
            lines = self._lines(block.nodes, style, strip=index in self.stripped)
            paragraphs = [[_line_start(line) for line in run] for empty, run in groupby(lines, key=not_) if not empty]
        first, rest = block.first, block.rest
        if index in self.labels:
            marker = f"[^{self.labels[index]}]:"
            if not paragraphs:
                return [[marker]], breaks
            paragraphs[0][0] = f"{marker} {paragraphs[0][0]}"
            first, rest = "", "    "
        elif joined:
            outer = self.blocks[self.continued[index]].rest
            inside = len(outer) if rest.startswith(outer) else 0
            first, rest = "    " + first[inside:], "    " + rest[inside:]
        written = []
        for lines in paragraphs:
            starts = [rest] * len(lines) if written else [first, *[rest] * (len(lines) - 1)]
            pairs = zip(starts, lines, strict=True)
            written.append([start + line if line else start.rstrip() for start, line in pairs])
        return written, breaks

    def _table(self, table):
        """A table as its caption and its rows, a line each, the cells between ` | `."""
        lines = []

        def rows(element):
            for child in element.children:
                if not isinstance(child, _Element) or self._hidden(child):
                    continue
                if child.tag == "caption":
                    lines.append(self._flat(child.children))
                elif child.tag == "tr":
                    cells = [
                        self._flat(cell.children)
                        for cell in child.children
                        if isinstance(cell, _Element) and cell.tag in {"td", "th"} and not self._hidden(cell)
                    ]
                    lines.append(" | ".join(cells).strip() if any(cells) else "")
                elif child.tag in {"thead", "tbody", "tfoot"}:
                    rows(child)

        rows(table)
        return [_line_start(line) for line in lines if line]


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


def _outline(text, blocks, title, limit, place=_paragraph_place, note_links=()):
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
    headings = iter(block for block in blocks if isinstance(block, Heading) and block.end is not None)
    next_heading = next(headings, None)
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
            if "paragraphs" in entry["place"]:
                # Where each paragraph after its first starts, in its text: a quote's citation counts them.
                entry["paragraphStarts"] = [paragraph.start - start for paragraph in stretch.paragraphs[first:last]]
                assert all(0 < offset < end - start for offset in entry["paragraphStarts"])
                spans = []
                while next_heading is not None and next_heading.start < end:
                    assert start <= next_heading.start < next_heading.end <= end
                    spans.append({
                        "start": next_heading.start - start,
                        "end": next_heading.end - start,
                        "title": next_heading.title,
                    })
                    next_heading = next(headings, None)
                if spans:
                    entry["headings"] = spans
            if len(parts) > 1:
                entry["part"] = {"number": number, "of": len(parts)}
            stretch.sections.append(entry)

    if note_links:
        # Both offsets refer to the original normalized text. A cut can put
        # a reference and definition from even a single stretch in different files.
        leaves = [entry for stretch in with_text for entry in stretch.sections]
        ends, offset = [], 0
        for leaf in leaves:
            offset += leaf["size"]
            ends.append(offset)
        for ref, label, definition in note_links:
            owner = leaves[bisect_right(ends, ref)]
            target = leaves[bisect_right(ends, definition)]
            if owner is not target:
                owner.setdefault("noteDefinitions", {})[label] = target["id"]

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
    ingest_command.add_argument("--status-only", action="store_true", help="omit the summary on success")
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
            if arguments.status_only and result["result"] == "converted":
                result = {"result": "converted"}
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
