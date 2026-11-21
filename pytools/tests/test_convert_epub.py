"""Conversion of EPUB sources, on EPUBs the tests build with zipfile (decisions.md, "Sources").

Each book is a few XHTML documents in spine order, with an NCX (EPUB 2) or a
navigation document (EPUB 3). Each expected section is written out by hand.
"""

import io
import zipfile

import pytest
from test_convert import heading, outline, run, section, section_files

STYLES = ".bold { font-weight: bold }\n.it, span.italic { font-style: italic }\n.up { vertical-align: super }\n"
CONTAINER = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
"""


def xhtml(body):
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
        '<head><title>A page</title><link href="styles.css" rel="stylesheet" type="text/css"/></head>'
        f"<body>{body}</body></html>"
    )


def _nav_list(entries):
    items = "".join(
        f'<li><a href="{href}">{title}</a>{_nav_list(children) if children else ""}</li>'
        for title, href, children in entries
    )
    return f"<ol>{items}</ol>"


def _nav_points(entries):
    return "".join(
        f'<navPoint id="p-{title.replace(" ", "-")}"><navLabel><text>{title}</text></navLabel>'
        f'<content src="{href}"/>{_nav_points(children)}</navPoint>'
        for title, href, children in entries
    )


def write_epub(documents, *, ncx=None, nav=None, title="The Book", files=(), encryption=None):
    """An EPUB's bytes: its documents, (name, body) under OEBPS/ in spine order, and its contents.

    `ncx` and `nav` are entries (title, href, children); `files` are other
    (name, bytes, media type) under OEBPS/; `encryption`, META-INF/encryption.xml.
    """
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as book:
        book.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        book.writestr("META-INF/container.xml", CONTAINER)
        manifest = ['<item id="css" href="styles.css" media-type="text/css"/>']
        book.writestr("OEBPS/styles.css", STYLES)
        spine = []
        for number, (name, body) in enumerate(documents):
            manifest.append(f'<item id="d{number}" href="{name}" media-type="application/xhtml+xml"/>')
            spine.append(f'<itemref idref="d{number}"/>')
            book.writestr(f"OEBPS/{name}", body if isinstance(body, bytes) else xhtml(body))
        for number, (name, data, media) in enumerate(files):
            manifest.append(f'<item id="f{number}" href="{name}" media-type="{media}"/>')
            book.writestr(f"OEBPS/{name}", data)
        if nav is not None:
            manifest.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
            book.writestr("OEBPS/nav.xhtml", xhtml(f'<nav epub:type="toc"><h1>Contents</h1>{_nav_list(nav)}</nav>'))
        if ncx is not None:
            manifest.append('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>')
            book.writestr(
                "OEBPS/toc.ncx",
                '<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">'
                f"<docTitle><text>{title}</text></docTitle><navMap>{_nav_points(ncx)}</navMap></ncx>",
            )
        if encryption is not None:
            book.writestr("META-INF/encryption.xml", encryption)
        book.writestr(
            "OEBPS/content.opf",
            f'<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" '
            f'version="{"3.0" if nav is not None else "2.0"}" unique-identifier="id">'
            f'<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{title}</dc:title></metadata>'
            f'<manifest>{"".join(manifest)}</manifest>'
            f'<spine{" toc=\"ncx\"" if ncx is not None else ""}>{"".join(spine)}</spine></package>',
        )
    return out.getvalue()


# Front matter before the first entry; a part with no text of its own; headings set as bold paragraphs, as
# Calibre's are, matched by their letters; a chapter the NCX leaves out; and a heading printed otherwise.
BOOK = [
    ("front.xhtml", "<p>A Book of Tests</p>"),
    ("part1.xhtml", '<p><span class="bold">Part One</span><br/><span class="bold"> Beginnings</span></p><p> </p>'),
    ("ch1.xhtml", '<p><b>Chapter 1</b><br/><b>The First</b></p><p>First words.</p><p>More, <span class="italic">styled</span>.</p>'),
    ("ch2.xhtml", "<p><b>Chapter 2</b><br/><b>Left Out</b></p><p>Text the contents skip.</p>"),
    ("ch3.xhtml", "<p><b>Chapter Three</b></p><p>Last words.</p>"),
]  # fmt: skip
NCX = [
    ("Part One Beginnings", "part1.xhtml", [("Chapter 1 The First", "ch1.xhtml", [])]),
    ("Chapter 3 The End", "ch3.xhtml", []),
]


def test_an_ncx_outline_nests_its_entries_and_a_document_it_leaves_out_stays_in_the_entry_before(tmp_path):
    data = write_epub(BOOK, ncx=NCX)
    summary, folder = run(tmp_path, "book.epub", data)

    front = "A Book of Tests\n\n"
    first = (
        "# Part One Beginnings\n\n## Chapter 1 The First\n\nFirst words.\n\nMore, *styled*.\n\n"
        "**Chapter 2**\n**Left Out**\n\nText the contents skip.\n\n"
    )
    last = "# Chapter 3 The End\n\n**Chapter Three**\n\nLast words.\n"
    written = outline(folder)
    assert written["title"] == "The Book"
    assert (written["format"], written["file"]) == ("epub", "original.epub")
    assert "pages" not in written
    assert written["entries"] == [
        section("s1", "The Book", front, 1, 1),
        heading("Part One Beginnings", section("s2", "Chapter 1 The First", first, 1, 4)),
        section("s3", "Chapter 3 The End", last, 1, 2),
    ]
    assert section_files(folder) == {"s1": front, "s2": first, "s3": last}
    assert (folder / "original.epub").read_bytes() == data
    assert summary == {"result": "converted", "title": "The Book", "format": "epub", "sections": 3, "cut": []}


def test_a_navigation_document_s_anchors_divide_one_file_and_win_over_the_ncx(tmp_path):
    book = (
        '<section><h1 id="one">One</h1><p>Alpha.</p><h2 id="one-a">One A</h2><p>Beta.</p></section>'
        '<section id="two"><header><h1>Two</h1></header><p>Gamma<a href="#n1" epub:type="noteref">1</a>.</p>'
        '<aside epub:type="footnote" id="n1"><p>The note.</p></aside></section>'
    )
    nav = [("One", "book.xhtml#one", [("One A", "book.xhtml#one-a", [])]), ("Two", "book.xhtml#two", [])]
    _, folder = run(tmp_path, "book.epub", write_epub([("book.xhtml", book)], nav=nav, ncx=[("Elsewhere", "book.xhtml", [])]))

    one, one_a, two = "# One\n\nAlpha.\n\n", "## One A\n\nBeta.\n\n", "# Two\n\nGamma[^1].\n\n[^1]: The note.\n"
    assert outline(folder)["entries"] == [
        heading("One", section("s1", "One", one, 1, 1), section("s2", "One A", one_a, 1, 1)),
        section("s3", "Two", two, 1, 2),
    ]
    assert section_files(folder) == {"s1": one, "s2": one_a, "s3": two}


FORMS = """\
<h1>Forms</h1>
<p>Plain, <em>emphasis</em>, <strong>strong</strong>, <span class="it">styled</span>, <i><b>both</b></i>
and 2 * 3, with a soft hy­phen.</p>
<ul><li>First</li><li>Second<ol start="3"><li>Third</li></ol></li></ul>
<blockquote><p>Quoted.</p><p>Twice.</p></blockquote>
<table><caption>Sizes</caption><thead><tr><th>Name</th><th>Size</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr></tbody></table>
<p>A figure: <img src="f.png" alt="a red   square"/>, and <math alttext="x^2"><mi>x</mi><mn>2</mn></math>.</p>
<p>Line one<br/>line two</p>
<p># not a heading</p>
<p hidden="hidden">Hidden text.</p>
<p>Page<span epub:type="pagebreak" id="p7" title="7">7</span> break.</p>
<pre>a *b*  ```
  indented</pre>
"""
FORMS_TEXT = """\
# Forms

Plain, *emphasis*, **strong**, *styled*, ***both*** and 2 \\* 3, with a soft hyphen.

- First

- Second

  3. Third

> Quoted.

> Twice.

Sizes
Name | Size
A | 1

A figure: a red square, and x^2.

Line one
line two

\\# not a heading

Page break.

````
a *b*  ```
  indented
````
"""


def test_xhtml_becomes_markdown(tmp_path):
    _, folder = run(tmp_path, "book.epub", write_epub([("forms.xhtml", FORMS)], ncx=[("Forms", "forms.xhtml", [])]))

    assert section_files(folder) == {"s1": FORMS_TEXT}
    assert outline(folder)["entries"] == [section("s1", "Forms", FORMS_TEXT, 1, 12)]


def test_footnote_references_and_their_notes_get_labels_unique_where_they_are_read(tmp_path):
    # Chapter 1's note ends the chapter, as Wiley's do: the reference's target is the note's leading link.
    # Chapters 2 and 3 have theirs in a notes document, raised by a style: each note's leading link is the
    # target, and links back. A superscript link to a heading is not a reference.
    documents = [
        ("ch1.xhtml", '<h1>One</h1><p>See this.<sup><a href="#ft1" id="fn1">1</a></sup></p>'
                      '<aside epub:type="rearnote"><a href="#fn1" id="ft1">1</a>. The first note.</aside>'),
        ("ch2.xhtml", '<h1>Two</h1><p>And this.<a class="up" href="notes.xhtml#n2-1" id="r2-1">1</a> Also '
                      '<sup><a href="ch1.xhtml">One</a></sup>.</p>'),
        ("ch3.xhtml", '<h1>Three</h1><p>Third.<a href="notes.xhtml#n3-1" id="r3-1"><sup>[1]</sup></a></p>'),
        ("notes.xhtml", '<h1>Notes</h1><p><span><a href="ch2.xhtml#r2-1" id="n2-1">1</a></span>Two’s note.</p>'
                        '<p><a href="ch3.xhtml#r3-1" id="n3-1">1</a> Three’s note.</p>'),
    ]  # fmt: skip
    ncx = [(title, f"{name}", []) for title, (name, _) in zip(["One", "Two", "Three", "Notes"], documents, strict=True)]
    _, folder = run(tmp_path, "book.epub", write_epub(documents, ncx=ncx))

    assert section_files(folder) == {
        "s1": "# One\n\nSee this.[^1]\n\n[^1]: The first note.\n\n",
        "s2": "# Two\n\nAnd this.[^1] Also One.\n\n",
        "s3": "# Three\n\nThird.[^1-2]\n\n",
        "s4": "# Notes\n\n[^1]: Two’s note.\n\n[^1-2]: Three’s note.\n",
    }


def test_a_long_chapter_is_cut_between_paragraphs_and_its_parts_sit_under_its_heading(tmp_path):
    paragraphs = "".join(f"<p>Paragraph {word}, a sentence.</p>" for word in ("one", "two", "six", "ten"))
    data = write_epub([("long.xhtml", f'<div class="chapter"><p class="bold">Long</p>{paragraphs}</div>')],
                      ncx=[("Long", "long.xhtml", [])])  # fmt: skip
    summary, folder = run(tmp_path, "book.epub", data, limit=70)

    # 119 characters: the heading's 8, then four paragraphs of 26 and their newlines. In two shares, the
    # paragraph start nearest 59.5 is the third's, at 64.
    first = "# Long\n\nParagraph one, a sentence.\n\nParagraph two, a sentence.\n\n"
    second = "Paragraph six, a sentence.\n\nParagraph ten, a sentence.\n"
    assert outline(folder)["entries"] == [
        heading(
            "Long",
            section("s1", "Long (part 1 of 2)", first, 1, 2, part=(1, 2)),
            section("s2", "Long (part 2 of 2)", second, 3, 4, part=(2, 2)),
        )
    ]
    assert section_files(folder) == {"s1": first, "s2": second}
    assert summary["cut"] == [{"title": "Long", "parts": 2}]


def encryption(algorithm, uri):
    return (
        '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" '
        'xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData>'
        f'<enc:EncryptionMethod Algorithm="{algorithm}"/>'
        f'<enc:CipherData><enc:CipherReference URI="{uri}"/></enc:CipherData></enc:EncryptedData></encryption>'
    )


def test_an_epub_whose_text_is_encrypted_is_refused_and_nothing_is_written(tmp_path):
    documents = [("ch1.xhtml", bytes(range(256)) * 4)]  # ciphertext, as a DRM book's chapters are
    data = write_epub(documents, ncx=[("One", "ch1.xhtml", [])],
                      encryption=encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc", "OEBPS/ch1.xhtml"))  # fmt: skip
    summary, folder = run(tmp_path, "book.epub", data)

    assert (summary["result"], summary["reason"]) == ("refused", "protected")
    assert "encrypted" in summary["detail"]
    assert list(folder.iterdir()) == []


def test_an_epub_that_only_obfuscates_its_fonts_is_converted(tmp_path):
    font = ("fonts/serif.otf", bytes(range(256)), "application/vnd.ms-opentype")
    data = write_epub([("ch1.xhtml", "<h1>One</h1><p>Readable.</p>")], ncx=[("One", "ch1.xhtml", [])], files=[font],
                      encryption=encryption("http://www.idpf.org/2008/embedding", "OEBPS/fonts/serif.otf"))  # fmt: skip
    summary, folder = run(tmp_path, "book.epub", data)

    assert summary["result"] == "converted"
    assert section_files(folder) == {"s1": "# One\n\nReadable.\n"}


def _no_mimetype():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("OEBPS/ch1.xhtml", xhtml("<p>Text.</p>"))
    return out.getvalue()


@pytest.mark.parametrize(
    ("content", "reason"),
    [
        (lambda: b"PK\x03\x04 not an archive after all", "format"),
        (_no_mimetype, "format"),
        (lambda: write_epub([("cover.xhtml", '<p><img src="cover.jpg"/></p>')]), "empty"),
    ],
)
def test_an_epub_without_text_to_read_is_refused_and_nothing_is_written(tmp_path, content, reason):
    summary, folder = run(tmp_path, "book.epub", content())

    assert (summary["result"], summary["reason"]) == ("refused", reason)
    assert summary["detail"]
    assert list(folder.iterdir()) == []
