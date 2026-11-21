"""Conversion of PDF sources, on PDFs the tests write with reportlab (decisions.md, "Sources").

Each page is drawn in Courier, a character 0.6 of the type size wide, so that
a line's length is known; lines but a paragraph's last are spread to the
column's right edge, as a book's are. PDFium reads the text in the order it is
drawn. Each expected section is written out by hand.
"""

import io
import json
import re
import subprocess
import sys

import pytest
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from test_convert import SCRIPT, heading, outline, run, section_files

LEFT, RIGHT, INDENT, LEADING = 72, 432, 90, 12  # the column, a paragraph's indent and the distance between lines
_SCRIPT = re.compile(r"\^(\w+)")  # a superscript in a word: "Thing,^1"


class Page:
    """A page to draw: its drawing calls in order, and the bookmarks on it."""

    def __init__(self):
        self.calls, self.bookmarks = [], []

    def text(self, text, y, x=LEFT, font="Courier", size=10):
        self.calls.append(lambda c: (c.setFont(font, size), c.drawString(x, y, text)))

    def line(self, words, y, x=LEFT, spread=False, size=10):
        """Draws words, `*bold*` or with a `^superscript` (6 points, 4 up), from x, spread to the edge if asked."""
        pieces = [_pieces(word, size) for word in words]
        widths = [sum(0.6 * piece_size * len(text) for text, _, piece_size, _ in word) for word in pieces]
        gap = 0.6 * size
        if spread:
            gap = (RIGHT - x - sum(widths)) / (len(words) - 1)
            assert 0.6 * size <= gap <= 1.2 * size, f"the line cannot be spread: {' '.join(words)}"
        for word, width in zip(pieces, widths, strict=True):
            at = x
            for text, font, piece_size, rise in word:
                self.text(text, y + rise, at, font, piece_size)
                at += 0.6 * piece_size * len(text)
            x += width + gap

    def paragraph(self, lines, y, indent=True):
        """A paragraph's lines from y down, each spread but the last; the next line's height."""
        for number, line in enumerate(lines):
            last = number == len(lines) - 1
            self.line(line.split(" "), y, INDENT if indent and number == 0 else LEFT, spread=not last)
            y -= LEADING
        return y

    def image(self, x, y, width, height):
        picture = ImageReader(Image.new("L", (40, 40), 128))
        self.calls.append(lambda c: c.drawImage(picture, x, y, width, height))

    def bookmark(self, title, level, top=None):
        self.bookmarks.append((title, level, top))


def _pieces(word, size):
    """A word's pieces as (text, font, size, rise)."""
    bold = len(word) > 2 and word.startswith("*") and word.endswith("*")
    word, font = (word[1:-1], "Courier-Bold") if bold else (word, "Courier")
    pieces, at = [], 0
    for match in _SCRIPT.finditer(word):
        pieces += [(word[at : match.start()], font, size, 0), (match.group(1), font, 6, 4)]
        at = match.end()
    pieces.append((word[at:], font, size, 0))
    return [piece for piece in pieces if piece[0]]


def write_pdf(pages, title="", labels=(), password=None):
    """The PDF's bytes: its pages, metadata title and page labels as (first page, style, start)."""
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(612, 792), encrypt=password)
    c.setTitle(title)
    for number, page in enumerate(pages):
        for call in page.calls:
            call(c)
        for index, (name, level, top) in enumerate(page.bookmarks):
            key = f"p{number}b{index}"
            if top is None:
                c.bookmarkPage(key, fit="Fit")
            else:
                c.bookmarkPage(key, fit="XYZ", left=0, top=top)
            c.addOutlineEntry(name, key, level)
        c.showPage()
    for page, style, start in labels:
        c.addPageLabel(page, style, start)
    c.save()
    return out.getvalue()


def pdf_section(id, title, text, first, last, part=None):
    entry = {"id": id, "title": title, "size": len(text), "place": {"pages": {"first": first, "last": last}}}
    if part is not None:
        entry["part"] = {"number": part[0], "of": part[1]}
    return entry


def test_a_pdf_s_bookmarks_make_its_outline_from_the_lines_that_print_them(tmp_path):
    one, two, three = Page(), Page(), Page()
    one.bookmark("Preface   ", 0, top=740)  # padded, as the Inwood edition's are
    one.text("Preface", 720, font="Courier-Bold", size=14)
    y = one.paragraph(["It is customary to begin a work by explaining in a preface", "its aim."], 696, indent=False)
    one.paragraph(["Here such an explanation seems superfluous, and even", "unsuitable."], y)
    two.bookmark("Introduction", 0, top=740)  # printed with its number
    two.text("1 Introduction", 720, font="Courier-Bold", size=14)
    two.paragraph(["It is natural to suppose that before philosophy enters on", "its subject proper."], 696, False)
    two.bookmark("Sense-certainty", 1, top=660)
    two.text("Sense-certainty", 650, font="Courier-Bold", size=12)
    two.paragraph(["The knowledge which is at the start our object can be no", "other than immediate knowledge."], 630, False)
    three.bookmark("Appendix", 0)  # printed nowhere
    y = three.paragraph(
        ["The appendix has no heading printed, so its bookmark's", "title is written before its text; its last line is full."],
        720,
        indent=False,
    )
    three.paragraph(["Another paragraph follows after a wider gap, with no indent."], y - 6, indent=False)
    texts = [
        "<!-- page 1 -->\n# Preface\n\n"
        "It is customary to begin a work by explaining in a preface its aim.\n\n"
        "Here such an explanation seems superfluous, and even unsuitable.\n\n",
        "<!-- page 2 -->\n# 1 Introduction\n\nIt is natural to suppose that before philosophy enters on its subject proper.\n\n",
        "## Sense-certainty\n\nThe knowledge which is at the start our object can be no other than immediate knowledge.\n\n",
        "<!-- page 3 -->\n# Appendix\n\n"
        "The appendix has no heading printed, so its bookmark's title is written before its text; its last line is full."
        "\n\nAnother paragraph follows after a wider gap, with no indent.\n",
    ]

    summary, folder = run(tmp_path, "hegel.pdf", write_pdf([one, two, three], title="Phenomenology"))

    written = outline(folder)
    assert written["entries"] == [
        pdf_section("s1", "Preface", texts[0], 1, 1),
        heading(
            "1 Introduction",
            pdf_section("s2", "1 Introduction", texts[1], 2, 2),
            pdf_section("s3", "Sense-certainty", texts[2], 2, 2),
        ),
        pdf_section("s4", "Appendix", texts[3], 3, 3),
    ]
    assert list(section_files(folder).values()) == texts
    assert written["pages"] == {"count": 3, "blank": []}
    assert (written["title"], written["format"], written["file"]) == ("Phenomenology", "pdf", "original.pdf")
    assert summary["result"] == "converted"


def test_without_bookmarks_headings_are_lines_set_larger_or_bold_alone_or_numbered(tmp_path):
    page = Page()
    page.text("A Study of Things", 740, font="Courier-Bold", size=18)
    page.text("Ann Author and Bob Writer", 716, size=12)  # larger, but not by a quarter: not a heading
    page.text("1 Introduction", 690, font="Courier-Bold", size=12)
    y = page.paragraph(["*Run-in.* The opening paragraph starts with a bold phrase,", "which is not a heading."], 672, False)
    page.text("1.1 Scope", y - 6, font="Courier-Bold")
    y = page.paragraph(["The scope is narrow, as a test's ought to be, and it is", "stated once."], y - 24, False)
    page.text("2 Results", y - 8, font="Courier-Bold", size=12)
    y = page.paragraph(
        ["The results are as expected, and are reported in full", "here, at the end of a line that is all but full of them."],
        y - 26,
        False,
    )
    page.text("Quoted in smaller type, a line follows with no indent.", y, size=8)  # a paragraph by its size alone
    y = page.paragraph(["*Remark.* A paragraph of one line opens in bold."], y - 12, False)  # alone, but not all bold
    page.text("Acknowledgements", y - 8, font="Courier-Bold", size=12)
    page.paragraph(["We thank the reader."], y - 26, False)
    texts = [
        "<!-- page 1 -->\n# A Study of Things\n\nAnn Author and Bob Writer\n\n",
        "# 1 Introduction\n\nRun-in. The opening paragraph starts with a bold phrase, which is not a heading.\n\n",
        "## 1.1 Scope\n\nThe scope is narrow, as a test's ought to be, and it is stated once.\n\n",
        "# 2 Results\n\n"
        "The results are as expected, and are reported in full here, at the end of a line that is all but full of them."
        "\n\nQuoted in smaller type, a line follows with no indent.\n\n"
        "Remark. A paragraph of one line opens in bold.\n\n",
        "# Acknowledgements\n\nWe thank the reader.\n",
    ]

    _, folder = run(tmp_path, "paper.pdf", write_pdf([page]))

    written = outline(folder)
    assert written["title"] == "A Study of Things"  # no title in its metadata: the first page's largest line
    assert written["entries"] == [
        pdf_section("s1", "A Study of Things", texts[0], 1, 1),
        heading(
            "1 Introduction",
            pdf_section("s2", "1 Introduction", texts[1], 1, 1),
            pdf_section("s3", "1.1 Scope", texts[2], 1, 1),
        ),
        pdf_section("s4", "2 Results", texts[3], 1, 1),
        pdf_section("s5", "Acknowledgements", texts[4], 1, 1),
    ]
    assert list(section_files(folder).values()) == texts


def book():
    """Four pages with a running head and page numbers: hyphens at lines' ends, notes, a page with no text."""
    pages = [Page() for _ in range(4)]
    # Page numbers at the foot, and the last at the head's right: twice at one place, which is no running foot.
    for page, number in zip(pages, [("i", 306, 40), ("1", 306, 40), None, ("3", 520, 760)], strict=True):
        if number:
            page.text("THE BOOK OF TESTS", 760)
            page.text(number[0], number[2], x=number[1])
    one, two, three, four = pages
    y = one.paragraph(
        [
            "Words broken at the end of a line are mended: a hyphen-",
            "ated word is joined, while self-consciousness, written",
            "with its hyphen mid-line, keeps it, and this line is full.",  # the next paragraph is indented
        ],
        730,
    )
    one.paragraph(
        ["The second paragraph runs on to the next page, and its", "last word on this page is broken there as well: self-"],
        y,
    )
    y = two.paragraph(["consciousness is kept across the page."], 730, indent=False)
    two.paragraph(
        ["A marker follows the Thing,^1 and another the word^2 here,", "so that each note is written after the paragraph."],
        y,
    )
    two.text("1 A note at the foot.", 100, size=8)
    two.text("2 Another note, which runs on", 90, size=8)
    two.text("to a second line.", 80, size=8)
    three.image(200, 300, 200, 200)
    four.paragraph(
        [
            "The last page repeats a marker's number,^1 which is made",
            "unique in the section, and the note at its foot goes",
            "after it.",
        ],
        730,
    )
    four.text("1 The third note.", 100, size=8)
    labels = [(0, "ROMAN_LOWER", 1), (1, "ARABIC", 1)]
    return write_pdf(pages, title="The Book of Tests", labels=labels)


BOOK_TEXT = """\
<!-- page 1 label "i" -->
Words broken at the end of a line are mended: a hyphenated word is joined, while self-consciousness, written with its \
hyphen mid-line, keeps it, and this line is full.

The second paragraph runs on to the next page, and its last word on this page is broken there as well: \
self-consciousness <!-- page 2 label "1" --> is kept across the page.

A marker follows the Thing,[^1] and another the word[^2] here, so that each note is written after the paragraph.

[^1]: A note at the foot.

[^2]: Another note, which runs on to a second line.

<!-- page 3 label "2" images -->
<!-- page 4 label "3" -->
The last page repeats a marker's number,[^1-2] which is made unique in the section, and the note at its foot goes \
after it.

[^1-2]: The third note.
"""


def test_a_book_s_pages_join_into_paragraphs_without_their_furniture_and_with_their_notes(tmp_path):
    # Running heads and page numbers are left out; a paragraph runs across a page, its marker after the mended
    # word; a line-end hyphen is joined but a compound's kept; superscripts are references with unique labels
    # in the section, the notes at the foot their definitions; a page with no text keeps its marker.
    data = book()
    summary, folder = run(tmp_path, "book.pdf", data)

    written = outline(folder)
    assert written["title"] == "The Book of Tests"
    assert written["pages"] == {"count": 4, "labels": ["i", "1", "2", "3"], "blank": [3]}
    assert written["entries"] == [pdf_section("s1", "The Book of Tests", BOOK_TEXT, 1, 4)]
    assert section_files(folder) == {"s1": BOOK_TEXT}
    assert (folder / "original.pdf").read_bytes() == data
    assert summary == {"result": "converted", "title": "The Book of Tests", "format": "pdf", "sections": 1, "cut": []}


def test_a_cut_pdf_stretch_gives_each_part_its_pages(tmp_path):
    _, folder = run(tmp_path, "book.pdf", book(), limit=300)

    # BOOK_TEXT's 771 characters in 3 shares: the paragraph starts nearest 257 and 514 are at 195 and 563,
    # leaving 368 between, over the limit; in 4, each paragraph is a part, its notes and markers with it.
    pieces = BOOK_TEXT.split("\n\n")
    parts = [pieces[0] + "\n\n", pieces[1] + "\n\n", "\n\n".join(pieces[2:5]) + "\n\n", "\n\n".join(pieces[5:])]
    pages = [(1, 1), (1, 2), (2, 2), (3, 4)]  # the second runs onto page 2; the last starts at page 3's marker
    assert outline(folder)["entries"] == [
        pdf_section(f"s{n}", f"The Book of Tests (part {n} of 4)", part, first, last, part=(n, 4))
        for n, (part, (first, last)) in enumerate(zip(parts, pages, strict=True), 1)
    ]


def scanned():
    pages = [Page() for _ in range(3)]
    for page in pages:
        page.image(36, 36, 540, 720)
    pages[0].text("A line of text recognised on the first page alone.", 720)
    return write_pdf(pages)


def protected():
    page = Page()
    page.text("Secret.", 720)
    return write_pdf([page], password="secret")


@pytest.mark.parametrize(
    ("content", "reason"),
    [(scanned, "scanned"), (protected, "protected"), (lambda: b"%PDF-1.7\nnot a PDF after all\n", "format")],
)
def test_a_pdf_without_text_to_read_is_refused_and_nothing_is_written(tmp_path, content, reason):
    summary, folder = run(tmp_path, "paper.pdf", content())

    assert (summary["result"], summary["reason"]) == ("refused", reason)
    assert summary["detail"]
    assert list(folder.iterdir()) == []


def test_the_page_command_renders_a_page_at_150_dpi_and_refuses_a_page_past_the_end(tmp_path):
    original = tmp_path / "book.pdf"
    original.write_bytes(book())
    image = tmp_path / "page.png"

    def page(number):
        command = [sys.executable, "-I", str(SCRIPT), "page", str(original), str(number), str(image)]
        return subprocess.run(command, capture_output=True, text=True, check=False)

    done = page(3)
    assert done.returncode == 0, done.stderr
    # 612 by 792 points at 150 dots per 72 points, give or take PDFium's rounding up.
    printed = json.loads(done.stdout)
    assert printed["result"] == "rendered" and printed["page"] == 3
    assert printed["width"] == 1275 and printed["height"] in (1650, 1651)
    with Image.open(image) as png:
        assert (png.format, png.size) == ("PNG", (printed["width"], printed["height"]))
        assert png.convert("L").getpixel((637, 825)) == 128  # the page's picture

    beyond = page(5)
    assert beyond.returncode == 2
    assert "4 pages" in beyond.stderr and "Traceback" not in beyond.stderr
