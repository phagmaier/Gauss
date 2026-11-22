"""Conversion of EPUB sources, on EPUBs the tests build with zipfile (decisions.md, "Sources").

Each book is a few XHTML documents in spine order, with an NCX (EPUB 2) or a
navigation document (EPUB 3). Each expected section is written out by hand.
"""

import io
import zipfile

import pytest
from markdown_it import MarkdownIt
from test_convert import heading, outline, run, section, section_files

import convert

# What a reader of Markdown makes of a section: CommonMark, with the tables and struck-through text of GFM.
# What remark-gfm, the page's parser, reads otherwise is tested with it (`src/shared/source-markdown.test.ts`).
MARKDOWN = MarkdownIt("commonmark").enable(["table", "strikethrough"])

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
        f"<li>{f'<a href="{href}">{title}</a>' if href else f'<span>{title}</span>'}"
        f"{_nav_list(children) if children else ''}</li>"
        for title, href, children in entries
    )
    return f"<ol>{items}</ol>"


def _nav_points(entries):
    return "".join(
        f'<navPoint id="p-{title.replace(" ", "-")}"><navLabel><text>{title}</text></navLabel>'
        f'<content src="{href}"/>{_nav_points(children)}</navPoint>'
        for title, href, children in entries
    )


def write_epub(documents, *, ncx=None, nav=None, title="The Book", ncx_title=None, files=(), encryption=None):
    """An EPUB's bytes: its documents, (name, body) under OEBPS/ in spine order, and its contents.

    `ncx` and `nav` are entries (title, href or None, children); `title` is
    the package's, and the NCX's unless `ncx_title` is given; `files` are
    other (name, bytes, media type) under OEBPS/, in the manifest only;
    `encryption`, META-INF/encryption.xml.
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
                f"<docTitle><text>{title if ncx_title is None else ncx_title}</text></docTitle><navMap>{_nav_points(ncx)}</navMap></ncx>",
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
        "**Chapter 2**\\\n**Left Out**\n\nText the contents skip.\n\n"
    )
    last = "# Chapter 3 The End\n\n**Chapter Three**\n\nLast words.\n"
    written = outline(folder)
    assert written["title"] == "The Book"
    assert (written["format"], written["file"]) == ("epub", "original.epub")
    assert "pages" not in written
    assert written["entries"] == [
        section("s1", "The Book", front, 1, 1),
        heading(
            "Part One Beginnings",
            section(
                "s2", "Chapter 1 The First", first, 1, 4, starts=("More,", "**Chapter 2**", "Text the"),
                headings=(("# Part One Beginnings\n", "Part One Beginnings"),
                          ("## Chapter 1 The First\n", "Chapter 1 The First")),
            ),  # fmt: skip
        ),
        section("s3", "Chapter 3 The End", last, 1, 2, starts=("Last words",),
                headings=(("# Chapter 3 The End\n", "Chapter 3 The End"),)),  # fmt: skip
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
        heading(
            "One",
            section("s1", "One", one, 1, 1, headings=(("# One\n", "One"),)),
            section("s2", "One A", one_a, 1, 1, headings=(("## One A\n", "One A"),)),
        ),
        section("s3", "Two", two, 1, 2, starts=("[^1]:",), headings=(("# Two\n", "Two"),)),
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
>
> Twice.

Sizes\\
Name | Size\\
A | 1

A figure: a red square, and x^2.

Line one\\
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
    # A paragraph is a block: each list item, each paragraph of a quote, a table, a fence.
    starts = ("- First", "- Second", "  3. Third", "> Quoted", "> Twice", "Sizes", "A figure", "Line one", "\\# not")
    starts += ("Page break", "````")
    assert outline(folder)["entries"] == [
        section("s1", "Forms", FORMS_TEXT, 1, 12, starts=starts, headings=(("# Forms\n", "Forms"),))
    ]


def test_footnote_references_and_their_notes_get_labels_unique_where_they_are_read(tmp_path):
    # Chapter 1's note ends the chapter, as Wiley's do: the reference's target is the note's leading link.
    # Chapters 2 and 3 have theirs in a notes document, raised by a style: each note's leading link is the
    # target, and links back. A raised link with a short label is no reference when its target is no note: a
    # heading, or a paragraph that starts with a link back but not with the label.
    documents = [
        ("ch1.xhtml", '<h1 id="top">One</h1><p>See this.<sup><a href="#ft1" id="fn1">1</a></sup></p>'
                      '<aside epub:type="rearnote"><a href="#fn1" id="ft1">1</a>. The first note.</aside>'),
        ("ch2.xhtml", '<h1>Two</h1><p>And this.<a class="up" href="notes.xhtml#n2-1" id="r2-1">1</a> Also '
                      '<sup><a href="ch1.xhtml#top">1</a></sup> and <sup><a href="#sec" id="jump">2</a></sup>.</p>'
                      '<p><a href="#jump" id="sec">Section two</a> is text.</p>'),
        ("ch3.xhtml", '<h1>Three</h1><p>Third.<a href="notes.xhtml#n3-1" id="r3-1"><sup>[1]</sup></a></p>'),
        ("notes.xhtml", '<h1>Notes</h1><p><span><a href="ch2.xhtml#r2-1" id="n2-1">1</a></span>Two’s note.</p>'
                        '<p><a href="ch3.xhtml#r3-1" id="n3-1">1</a> Three’s note.</p>'),
    ]  # fmt: skip
    ncx = [(title, f"{name}", []) for title, (name, _) in zip(["One", "Two", "Three", "Notes"], documents, strict=True)]
    _, folder = run(tmp_path, "book.epub", write_epub(documents, ncx=ncx))

    assert section_files(folder) == {
        "s1": "# One\n\nSee this.[^1]\n\n[^1]: The first note.\n\n",
        "s2": "# Two\n\nAnd this.[^1] Also 1 and 2.\n\nSection two is text.\n\n",
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
            section("s1", "Long (part 1 of 2)", first, 1, 2, part=(1, 2), starts=("Paragraph two",),
                    headings=(("# Long\n", "Long"),)),  # fmt: skip
            section("s2", "Long (part 2 of 2)", second, 3, 4, part=(2, 2), starts=("Paragraph ten",)),
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


CIPHERTEXT = bytes(range(256)) * 4  # as a DRM book's chapters are


@pytest.mark.parametrize(
    ("documents", "files"),
    [
        ([("ch1.xhtml", CIPHERTEXT)], []),
        # A text document that is not in the reading order, beside a chapter that can be read.
        ([("ch1.xhtml", "<h1>One</h1><p>Readable.</p>")], [("ch2.xhtml", CIPHERTEXT, "application/xhtml+xml")]),
    ],
)
def test_an_epub_whose_text_is_encrypted_is_refused_and_nothing_is_written(tmp_path, documents, files):
    encrypted = "ch2.xhtml" if files else "ch1.xhtml"
    data = write_epub(documents, ncx=[("One", "ch1.xhtml", [])], files=files,
                      encryption=encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc", f"OEBPS/{encrypted}"))  # fmt: skip
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
        (lambda: write_epub([("deep.xhtml", "<div>" * 5000 + "<p>Text.</p>" + "</div>" * 5000)]), "format"),
        (lambda: write_epub([("deep.xhtml", "<p>" + "<span>" * 5000 + "Text." + "</span>" * 5000 + "</p>")]), "format"),
        (lambda: write_epub([("deep.xhtml", b"<div>" * 5000 + b"<p>Text.</p>")]), "format"),  # and no body element
    ],
)
def test_an_epub_without_text_to_read_is_refused_and_nothing_is_written(tmp_path, content, reason):
    summary, folder = run(tmp_path, "book.epub", content())

    assert (summary["result"], summary["reason"]) == ("refused", reason)
    assert summary["detail"]
    assert list(folder.iterdir()) == []


@pytest.mark.parametrize(("limit", "value"), [("_EPUB_BUDGET", 2_000), ("_EPUB_ELEMENTS", 40)])
def test_an_epub_over_the_budget_of_bytes_or_of_elements_is_refused(tmp_path, monkeypatch, limit, value):
    data = write_epub([("long.xhtml", "<p>A paragraph.</p>" * 200)], ncx=[("Long", "long.xhtml", [])])
    assert run(tmp_path, "book.epub", data, folder="whole")[0]["result"] == "converted"

    monkeypatch.setattr(convert, limit, value)
    summary, folder = run(tmp_path, "book.epub", data)

    assert (summary["result"], summary["reason"]) == ("refused", "format")
    assert "too large" in summary["detail"]
    assert list(folder.iterdir()) == []


@pytest.mark.parametrize(
    ("limit", "value", "detail"),
    [("_EPUB_ELEMENTS", 30, "too large"), ("_EPUB_DEPTH", 8, "nest too deeply")],
)
def test_the_budgets_of_elements_and_of_depth_cover_the_contents_too(tmp_path, monkeypatch, limit, value, detail):
    # The document has six elements, three deep. The NCX has 44, ten entries inside one another: 14 deep.
    entry = ("Entry 0", "one.xhtml", [])
    for number in range(1, 10):
        entry = (f"Entry {number}", "one.xhtml", [entry])
    data = write_epub([("one.xhtml", "<p>Text.</p>")], ncx=[entry])
    assert run(tmp_path, "book.epub", data, folder="whole")[0]["result"] == "converted"

    monkeypatch.setattr(convert, limit, value)
    summary, folder = run(tmp_path, "book.epub", data)

    assert (summary["result"], summary["reason"]) == ("refused", "format")
    assert detail in summary["detail"]
    assert list(folder.iterdir()) == []


def test_an_anchor_inside_a_paragraph_starts_its_entry_there(tmp_path):
    # The first target has text before it in its paragraph; the second is inside emphasis; the third ends a
    # paragraph, so its entry starts with the next one.
    book = (
        '<p>Before the first entry. <a name="turn"></a>After the boundary.</p>'
        '<p>It <em>goes <span id="on">along</span> so</em> far.<a id="end"></a></p><p>The last words.</p>'
    )
    nav = [("First", "book.xhtml#turn", []), ("Second", "book.xhtml#on", []), ("Third", "book.xhtml#end", [])]
    _, folder = run(tmp_path, "book.epub", write_epub([("book.xhtml", book)], nav=nav))

    front = "Before the first entry.\n\n"
    first = "# First\n\nAfter the boundary.\n\nIt *goes*\n\n"
    second = "# Second\n\n*along so* far.\n\n"
    third = "# Third\n\nThe last words.\n"
    assert section_files(folder) == {"s1": front, "s2": first, "s3": second, "s4": third}
    assert outline(folder)["entries"] == [
        section("s1", "The Book", front, 1, 1),
        section("s2", "First", first, 1, 2, starts=("It *goes*",), headings=(("# First\n", "First"),)),
        section("s3", "Second", second, 1, 1, headings=(("# Second\n", "Second"),)),
        section("s4", "Third", third, 1, 1, headings=(("# Third\n", "Third"),)),
    ]


def test_a_title_s_lines_end_at_the_next_entry_s_target(tmp_path):
    # "Alpha" and "Beta" together print the first entry's title, but "Beta" is the second entry's target.
    book = '<p id="a">Alpha</p><h2 id="b">Beta</h2><p>Body A.</p><p>Body B.</p>'
    nav = [("Alpha Beta", "book.xhtml#a", []), ("Beta", "book.xhtml#b", [])]
    _, folder = run(tmp_path, "book.epub", write_epub([("book.xhtml", book)], nav=nav))

    assert section_files(folder) == {"s1": "# Alpha Beta\n\nAlpha\n\n", "s2": "# Beta\n\nBody A.\n\nBody B.\n"}


def test_a_title_s_lines_are_looked_for_in_its_target_s_document_only(tmp_path):
    # Both entries point to the first document, which prints only the first one's title.
    documents = [("one.xhtml", "<h1>Alpha</h1>"), ("two.xhtml", "<p>Beta</p><p>Text.</p>")]
    nav = [("Alpha", "one.xhtml", []), ("Beta", "one.xhtml", [])]
    _, folder = run(tmp_path, "book.epub", write_epub(documents, nav=nav))

    text = "# Alpha\n\n# Beta\n\nBeta\n\nText.\n"
    assert section_files(folder) == {"s1": text}
    assert outline(folder)["entries"] == [
        heading("Alpha"),
        section("s1", "Beta", text, 1, 2, starts=("Text.",), headings=(("# Alpha\n", "Alpha"), ("# Beta\n", "Beta"))),
    ]


def test_a_heading_tag_stands_for_an_entry_only_when_it_prints_its_title_s_words(tmp_path):
    # A part with no link takes its chapter's target, whose heading is the chapter's; a heading that prints
    # something else stays in the text; one that holds the title's words, or whose words the title holds, is it.
    documents = [
        ("one.xhtml", '<h2 id="chapter">Child Chapter</h2><p>Text.</p>'),
        ("two.xhtml", "<h2>Publisher’s Foreword</h2><p>Words.</p>"),
        ("three.xhtml", "<h2>The Licence Agreement</h2><p>Terms.</p>"),
    ]
    nav = [
        ("Parent Part", None, [("Child Chapter", "one.xhtml#chapter", [])]),
        ("Chapter One", "two.xhtml", []),
        ("Licence", "three.xhtml", []),
    ]
    _, folder = run(tmp_path, "book.epub", write_epub(documents, nav=nav))

    first = "# Parent Part\n\n## Child Chapter\n\nText.\n\n"
    second = "# Chapter One\n\n## Publisher’s Foreword\n\nWords.\n\n"
    third = "# The Licence Agreement\n\nTerms.\n"
    assert section_files(folder) == {"s1": first, "s2": second, "s3": third}
    assert outline(folder)["entries"] == [
        heading(
            "Parent Part",
            section("s1", "Child Chapter", first, 1, 1,
                    headings=(("# Parent Part\n", "Parent Part"), ("## Child Chapter\n", "Child Chapter"))),  # fmt: skip
        ),
        section("s2", "Chapter One", second, 1, 2, starts=("Words.",), headings=(("# Chapter One\n", "Chapter One"),)),
        section("s3", "Licence", third, 1, 1, headings=(("# The Licence Agreement\n", "Licence"),)),
    ]


def test_a_note_s_references_share_its_label_and_its_paragraphs_stay_in_it(tmp_path):
    # Three references to one note, by the aside's id and by each of its paragraphs'; and a link typed as
    # leading back, which is left out.
    book = (
        '<h1>One</h1><p>Once<a epub:type="noteref" id="r" href="#n">1</a>; again<a epub:type="noteref" href="#alias">1</a>;'
        ' thrice<a epub:type="noteref" href="#later">1</a>.</p>'
        '<aside epub:type="footnote" id="n"><p id="alias">The note.</p>'
        '<p id="later">Its second paragraph. <sup><a role="doc-backlink" href="#r">1</a></sup></p></aside><p>After.</p>'
    )
    _, folder = run(tmp_path, "book.epub", write_epub([("book.xhtml", book)], nav=[("One", "book.xhtml", [])]))

    text = "# One\n\nOnce[^1]; again[^1]; thrice[^1].\n\n[^1]: The note.\n\n    Its second paragraph.\n\nAfter.\n"
    assert section_files(folder) == {"s1": text}
    # The note is one paragraph, its second paragraph in it.
    assert outline(folder)["entries"] == [
        section("s1", "One", text, 1, 3, starts=("[^1]:", "After."), headings=(("# One\n", "One"),))
    ]


def test_a_contents_target_inside_a_note_starts_its_entry_at_the_note(tmp_path):
    book = (
        '<h1>One</h1><p>Once<a epub:type="noteref" href="#n">1</a>.</p>'
        '<aside epub:type="footnote" id="n"><p>The note.</p><p id="later">Its second paragraph.</p></aside><p>After.</p>'
    )
    nav = [("One", "book.xhtml", []), ("Two", "book.xhtml#later", [])]
    _, folder = run(tmp_path, "book.epub", write_epub([("book.xhtml", book)], nav=nav))

    assert section_files(folder) == {
        "s1": "# One\n\nOnce[^1].\n\n",
        "s2": "# Two\n\n[^1]: The note.\n\n    Its second paragraph.\n\nAfter.\n",
    }


def test_a_note_known_by_one_reference_is_every_reference_s(tmp_path):
    # The note is a paragraph like any other, known by its label: a link back to the second reference. The
    # first, in a paragraph before, points to the same note.
    book = (
        '<h1>One</h1><p>First<sup><a href="#n">1</a></sup> here.</p>'
        '<p>Second<sup><a href="#n" id="r">1</a></sup> there.</p><p id="n"><a href="#r">1</a>. The note.</p>'
    )
    _, folder = run(tmp_path, "book.epub", write_epub([("book.xhtml", book)], nav=[("One", "book.xhtml", [])]))

    assert section_files(folder) == {"s1": "# One\n\nFirst[^1] here.\n\nSecond[^1] there.\n\n[^1]: The note.\n"}


def test_a_cut_never_falls_inside_a_reference_or_a_note(tmp_path):
    book = '<p>AAAAAA<a epub:type="noteref" href="#n">12345</a>ZZZZZZ</p><aside epub:type="footnote" id="n">Note text here.</aside>'
    _, folder = run(tmp_path, "book.epub", write_epub([("book.xhtml", book)]), limit=10)

    # 48 characters. The first paragraph has no space to be cut at, and its middle is inside the reference and
    # the word it follows, so it is cut after them; the note, over the limit, is whole.
    parts = ["AAAAAA[^12345]", "ZZZZZZ\n\n", "[^12345]: Note text here.\n"]
    assert section_files(folder) == dict(zip(["s1", "s2", "s3"], parts, strict=True))
    assert [entry["place"]["paragraphs"] for entry in outline(folder)["entries"]] == [
        {"first": 1, "last": 1},
        {"first": 1, "last": 1},
        {"first": 2, "last": 2},
    ]


def test_a_cut_never_falls_inside_an_escape(tmp_path):
    _, folder = run(tmp_path, "book.epub", write_epub([("book.xhtml", "<p>*******</p>")]), limit=10)

    # 15 characters with no space to be cut at. Their middle is between the fourth star and its backslash, so
    # the cut goes to the nearer end of that pair.
    assert section_files(folder) == {"s1": "\\*\\*\\*\\*", "s2": "\\*\\*\\*\n"}


def test_a_declared_encoding_a_cdata_section_and_end_tags_left_out_are_read(tmp_path):
    document = (
        '<?xml version="1.0" encoding = "ISO-8859-1"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body>'
        "<p>Déjà vu.</p><p><![CDATA[a < b]]> followed.</p><ol><li>One<li>Two</ol><p>A stray</b> end tag."
        "<table><tr><td>a<td>b<tr><td>c</table></body></html>"
    ).encode("iso-8859-1")
    _, folder = run(tmp_path, "book.epub", write_epub([("one.xhtml", document)], nav=[("One", "one.xhtml", [])]))

    assert section_files(folder) == {
        "s1": "# One\n\nDéjà vu.\n\na < b followed.\n\n1. One\n\n2. Two\n\nA stray end tag.\n\na | b\\\nc\n"
    }


def written(tmp_path, body):
    """The Markdown that the converter writes for a document's body, under a heading "T"."""
    _, folder = run(tmp_path, "book.epub", write_epub([("one.xhtml", body)], nav=[("T", "one.xhtml", [])]))
    text = section_files(folder)["s1"]
    assert text.startswith("# T\n\n")
    return text.removeprefix("# T\n\n")


@pytest.mark.parametrize(
    ("body", "markdown", "read"),
    [
        # The document's own characters are not Markdown's.
        ("<p>- Not a list</p>", "\\- Not a list\n", "<p>- Not a list</p>\n"),
        ("<p>+ Nor this</p>", "\\+ Nor this\n", "<p>+ Nor this</p>\n"),
        ("<p>1. Not a list</p>", "1\\. Not a list\n", "<p>1. Not a list</p>\n"),
        ("<p>12) Nor this</p>", "12\\) Nor this\n", "<p>12) Nor this</p>\n"),
        ("<p>____</p>", "\\_\\_\\_\\_\n", "<p>____</p>\n"),
        ("<p>Text<br/>---</p>", "Text\\\n\\---\n", "<p>Text<br />\n---</p>\n"),
        ("<p>a | b<br/>--- | ---</p>", "a | b\\\n\\--- | ---\n", "<p>a | b<br />\n--- | ---</p>\n"),
        ("<p>&amp;copy; AT&amp;T</p>", "\\&copy; AT&T\n", "<p>&amp;copy; AT&amp;T</p>\n"),
        ("<p>&lt;b&gt; and 2 &lt; 3</p>", "\\<b> and 2 < 3\n", "<p>&lt;b&gt; and 2 &lt; 3</p>\n"),
        ("<p>_under_ snake_case ~~gone~~</p>", "\\_under\\_ snake_case \\~\\~gone\\~\\~\n", "<p>_under_ snake_case ~~gone~~</p>\n"),
        ("<p>~once~ H~2~O &lt;123@example.com&gt;</p>", "\\~once\\~ H\\~2\\~O \\<123@example.com>\n", "<p>~once~ H~2~O &lt;123@example.com&gt;</p>\n"),
        ("<p>[a]: b and [c](d)</p>", "\\[a]: b and [c\\](d)\n", "<p>[a]: b and [c](d)</p>\n"),
        ("<p>[^x] is literal</p><p>[^x]: So is this</p>", "\\[^x] is literal\n\n\\[^x]: So is this\n", "<p>[^x] is literal</p>\n<p>[^x]: So is this</p>\n"),
        ("<h2>F #</h2>", "## F \\#\n", "<h2>F #</h2>\n"),
        # Emphasis is marked where Markdown reads the marks.
        ("<p>A<em>! </em>B</p>", "A! B\n", "<p>A! B</p>\n"),
        ("<p><em>one</em><em>two</em> <em>three</em></p>", "*onetwo three*\n", "<p><em>onetwo three</em></p>\n"),
        ("<p>word<i>—aside—</i>word</p>", "word—*aside*—word\n", "<p>word—<em>aside</em>—word</p>\n"),
        ("<p><i>one</i><b>two</b></p>", "*one***two**\n", "<p><em>one</em><strong>two</strong></p>\n"),
        ("<p><i>a <b>b</b> c</i> d</p>", "*a **b** c* d\n", "<p><em>a <strong>b</strong> c</em> d</p>\n"),
        ("<p><b><i>both</i> bold</b></p>", "***both* bold**\n", "<p><strong><em>both</em> bold</strong></p>\n"),
        # Bold inside a word in italics, and italic and bold that overlap, cannot be written: one gives way.
        ("<p><i>un<b>believ</b>able</i></p>", "*unbelievable*\n", "<p><em>unbelievable</em></p>\n"),
        ("<p><i>a <b>b</b></i><b> c</b></p>", "*a b* **c**\n", "<p><em>a b</em> <strong>c</strong></p>\n"),
    ],
)
def test_a_document_s_characters_and_its_emphasis_are_read_back_from_the_markdown(tmp_path, body, markdown, read):
    text = written(tmp_path, body)

    assert text == markdown
    assert MARKDOWN.render(text) == read


def test_blocks_keep_their_breaks_their_nesting_and_their_spaces(tmp_path):
    body = (
        "<p>A<br/>B<br/><br/>C<br/></p>"
        "<blockquote><ul><li><p>Item</p><pre>code  \n  more</pre></li></ul><p>Tail</p></blockquote>"
        "<pre>\n  \n  x  \n\n  y  \n\n</pre>"  # the first newline is HTML's to drop, and the last ends a line
        '<table><tr><td>Shown</td><td hidden="hidden">Secret</td></tr><tr><td>Second</td><td>2</td></tr></table>'
    )
    text = written(tmp_path, body)

    assert text == (
        "A\\\nB\n\nC\n\n"
        "> - Item\n>\n>   ```\n>   code  \n>     more\n>   ```\n>\n> Tail\n\n"
        "```\n  \n  x  \n\n  y  \n\n```\n\n"
        "Shown\\\nSecond | 2\n"
    )
    assert MARKDOWN.render(text) == (
        "<p>A<br />\nB</p>\n<p>C</p>\n"
        "<blockquote>\n<ul>\n<li>\n<p>Item</p>\n<pre><code>code  \n  more\n</code></pre>\n</li>\n</ul>\n<p>Tail</p>\n</blockquote>\n"
        "<pre><code>  \n  x  \n\n  y  \n\n</code></pre>\n"
        "<p>Shown<br />\nSecond | 2</p>\n"
    )


@pytest.mark.parametrize(
    ("nav", "ncx_title", "title"),
    [
        # No title in the package: the NCX's, though the contents come from the navigation document.
        ([("Only chapter", "one.xhtml", [])], "The NCX's Title", "The NCX's Title"),
        # Nor in the NCX: as a Markdown source's, its one top heading if that opens it, or else its file's name.
        ([("Only chapter", "one.xhtml", [])], "", "Only chapter"),
        ([("Only chapter", "one.xhtml", []), ("Second", "two.xhtml", [])], "", "book"),
    ],
)
def test_an_epub_without_a_title_in_its_package_takes_the_ncx_s_or_else_a_markdown_source_s(tmp_path, nav, ncx_title, title):
    documents = [("one.xhtml", "<h1>Only chapter</h1><p>Text.</p>"), ("two.xhtml", "<h1>Second</h1><p>More.</p>")]
    data = write_epub(documents, nav=nav, ncx=[("Elsewhere", "one.xhtml", [])], title="", ncx_title=ncx_title)
    summary, _ = run(tmp_path, "book.epub", data)

    assert summary["title"] == title
