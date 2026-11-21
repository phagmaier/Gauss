"""Conversion of text and Markdown sources, on files the tests write (decisions.md, "Sources").

Each expected section is written out by hand: its text, and so its size, and
its place as the paragraphs it holds, numbered within its heading's stretch.
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from convert import CONVERTER_VERSION, SECTION_LIMIT, ingest

SCRIPT = Path(__file__).parents[1] / "convert.py"


def run(tmp_path, name, content, limit=SECTION_LIMIT, folder="notes"):
    """Ingests `content` (text or bytes) as a file called `name`: the printed summary and the folder."""
    original = tmp_path / "upload" / name
    original.parent.mkdir(exist_ok=True)
    original.write_bytes(content.encode() if isinstance(content, str) else content)
    target = tmp_path / folder
    return ingest(original, target, limit), target


def outline(folder):
    return json.loads((folder / "outline.json").read_text(encoding="utf-8"))


def section_files(folder):
    """Each section file's text, by id, in reading order."""
    sections = []

    def walk(entries):
        for entry in entries:
            if "entries" in entry:
                walk(entry["entries"])
            else:
                sections.append(entry["id"])

    walk(outline(folder)["entries"])
    return {id: (folder / "sections" / f"{id}.md").read_text(encoding="utf-8") for id in sections}


def section(id, title, text, first, last, part=None):
    """An outline's section entry for a section file holding `text`."""
    entry = {"id": id, "title": title, "size": len(text), "place": {"paragraphs": {"first": first, "last": last}}}
    if part is not None:
        entry["part"] = {"number": part[0], "of": part[1]}
    return entry


def heading(title, *entries):
    return {"title": title, "entries": list(entries)}


BOOK = """\
# Phenomenology

Opening words.

Consciousness
-------------

Before the first chapter.

### Sense-certainty

The this and the meaning.

Second paragraph,
on two lines.

### Perception, or *the Thing*

The thing and deception.

## Self-consciousness

The truth of self-certainty.
"""


def test_headings_nest_three_deep_and_a_heading_s_text_before_its_first_subheading_is_a_section(tmp_path):
    texts = [
        "# Phenomenology\n\nOpening words.\n\n",
        "Consciousness\n-------------\n\nBefore the first chapter.\n\n",
        "### Sense-certainty\n\nThe this and the meaning.\n\nSecond paragraph,\non two lines.\n\n",
        "### Perception, or *the Thing*\n\nThe thing and deception.\n\n",
        "## Self-consciousness\n\nThe truth of self-certainty.\n",
    ]
    summary, folder = run(tmp_path, "hegel.md", BOOK)

    written = outline(folder)
    assert written["title"] == "Phenomenology"  # its one top heading, which opens it
    assert written["entries"] == [
        heading(
            "Phenomenology",
            section("s1", "Phenomenology", texts[0], 1, 1),
            heading(
                "Consciousness",
                section("s2", "Consciousness", texts[1], 1, 1),
                section("s3", "Sense-certainty", texts[2], 1, 2),
                section("s4", "Perception, or the Thing", texts[3], 1, 1),
            ),
            section("s5", "Self-consciousness", texts[4], 1, 1),
        )
    ]
    assert list(section_files(folder).values()) == texts
    assert "".join(texts) == BOOK
    assert summary == {"result": "converted", "title": "Phenomenology", "format": "markdown", "sections": 5, "cut": []}


def test_a_heading_with_no_text_of_its_own_goes_into_the_next_section_or_else_the_last(tmp_path):
    book = "# Book\n\n## Part One\n\n### Chapter 1\n\nText one.\n\n# Appendix\n"
    _, folder = run(tmp_path, "book.md", book)

    written = outline(folder)
    assert written["title"] == "book"  # two top headings: its file's name
    assert written["entries"] == [
        heading("Book", heading("Part One", section("s1", "Chapter 1", book, 1, 1))),
        heading("Appendix"),
    ]


def test_text_before_the_first_heading_is_a_section_under_the_source_s_title(tmp_path):
    _, folder = run(tmp_path, "notes.md", "Before any heading.\n\n# Chapter\n\nText.\n")

    assert outline(folder)["entries"] == [
        section("s1", "notes", "Before any heading.\n\n", 1, 1),
        section("s2", "Chapter", "# Chapter\n\nText.\n", 1, 1),
    ]


def test_plain_text_is_paragraphs_with_no_headings_and_its_original_is_kept(tmp_path):
    original = b"# Not a heading\r\n\r\nSecond line.\r\n"
    _, folder = run(tmp_path, "Hegel notes.txt", original, folder="hegel-notes")

    assert outline(folder) == {
        "id": "hegel-notes",
        "title": "Hegel notes",
        "file": "original.txt",
        "name": "Hegel notes.txt",
        "format": "text",
        "sha256": hashlib.sha256(original).hexdigest(),
        "converter": CONVERTER_VERSION,
        "limit": SECTION_LIMIT,
        "entries": [section("s1", "Hegel notes", "# Not a heading\n\nSecond line.\n", 1, 2)],
    }
    assert (folder / "original.txt").read_bytes() == original


def paragraphs(sizes):
    """Plain-text paragraphs of these sizes, each counting the blank line after it (the last, its newline)."""
    out = []
    for number, size in enumerate(sizes, 1):
        end = "\n" if number == len(sizes) else "\n\n"
        out.append((f"P{number:02d} " + "lorem ipsum " * (size // 12 + 2))[: size - len(end) - 1] + "." + end)
        assert len(out[-1]) == size
    return out


@pytest.mark.parametrize(
    ("sizes", "groups"),
    [
        # 2,500 in 3 shares: the cuts nearest 833 and 1,667 are at 1,000 and 1,500.
        ([500] * 5, [(1, 2), (3, 3), (4, 5)]),
        # 2,999 in 3 shares cuts at 900 and 2,100, leaving 1,200 between; in
        # 4, the cuts nearest 750, 1,500 and 2,250 are at 600, 1,500 and 2,100.
        ([300] * 9 + [299], [(1, 2), (3, 5), (6, 7), (8, 10)]),
    ],
)
def test_a_long_stretch_is_cut_between_paragraphs_near_equal_shares_within_the_limit(tmp_path, sizes, groups):
    texts = paragraphs(sizes)
    summary, folder = run(tmp_path, "notes.txt", "".join(texts), limit=1000)

    parts = ["".join(texts[first - 1 : last]) for first, last in groups]
    assert all(len(part) <= 1000 for part in parts)
    n = len(groups)
    assert outline(folder)["entries"] == [
        section(f"s{i}", f"notes (part {i} of {n})", part, first, last, part=(i, n))
        for i, (part, (first, last)) in enumerate(zip(parts, groups, strict=True), 1)
    ]
    assert list(section_files(folder).values()) == parts
    assert summary["cut"] == [{"title": "notes", "parts": n}]


def test_the_parts_of_a_heading_s_stretch_sit_under_it_and_number_its_paragraphs_on(tmp_path):
    texts = paragraphs([300, 300, 500])
    texts[-1] += "\n"  # the paragraph's blank line, since a heading follows
    book = "# Long\n\n" + "".join(texts) + "## Next\n\nShort.\n"
    _, folder = run(tmp_path, "long.md", book, limit=700)

    # 8 + 1,101 in two shares: the cut nearest 554.5 is at 608.
    part_1 = "# Long\n\n" + texts[0] + texts[1]
    assert outline(folder)["entries"] == [
        heading(
            "Long",
            section("s1", "Long (part 1 of 2)", part_1, 1, 2, part=(1, 2)),
            section("s2", "Long (part 2 of 2)", texts[2], 3, 3, part=(2, 2)),
            section("s3", "Next", "## Next\n\nShort.\n", 1, 1),
        )
    ]


def sentence(number, length=99):
    return (f"Sentence {number:02d} " + "lorem " * 30)[: length - 1] + "."


@pytest.mark.parametrize(
    ("words", "middle"),
    [
        # Sentences of 99 characters and a space, the 8th of 149: of 1,450, the
        # sentence end nearest 725 is after the 7th, at 700; a space is nearer.
        ([sentence(n) for n in range(1, 8)] + [sentence(8, 149)] + [sentence(n) for n in range(9, 15)], 7),
        # no sentence end: the space nearest 750 is after the 150th word of 300.
        ([f"w{n:03d}" for n in range(1, 301)], 150),
    ],
)
def test_a_paragraph_over_the_limit_is_cut_at_the_sentence_end_or_else_the_space_nearest_its_middle(
    tmp_path, words, middle
):
    _, folder = run(tmp_path, "notes.txt", " ".join(words) + "\n", limit=1000)

    first, second = " ".join(words[:middle]) + " ", " ".join(words[middle:]) + "\n"
    assert outline(folder)["entries"] == [
        section("s1", "notes (part 1 of 2)", first, 1, 1, part=(1, 2)),
        section("s2", "notes (part 2 of 2)", second, 1, 1, part=(2, 2)),
    ]


def test_a_fenced_block_is_never_cut_and_holds_no_heading(tmp_path):
    code = "".join(f"x{n} = {n}  # a line of code\n" for n in range(1, 16))
    fence = f"```python\n{code}\n    # not a heading\n# nor this\n{code}```\n"
    book = f"# Code\n\nIntro paragraph.\n\n{fence}\nAfter the code.\n"
    _, folder = run(tmp_path, "code.md", book, limit=600)

    # Cut inside the fence, at its blank line, two parts would fit; whole, it is a part over the limit.
    assert len(fence) > 600
    assert outline(folder)["entries"] == [
        heading(
            "Code",
            section("s1", "Code (part 1 of 3)", "# Code\n\nIntro paragraph.\n\n", 1, 1, part=(1, 3)),
            section("s2", "Code (part 2 of 3)", fence + "\n", 2, 2, part=(2, 3)),
            section("s3", "Code (part 3 of 3)", "After the code.\n", 3, 3, part=(3, 3)),
        )
    ]


def test_a_second_run_writes_the_same_bytes(tmp_path):
    original = tmp_path / "hegel.md"
    original.write_text(BOOK + "\n" + "".join(paragraphs([300] * 6)), encoding="utf-8")

    def files(folder):
        return {path.relative_to(folder): path.read_bytes() for path in sorted(folder.rglob("*")) if path.is_file()}

    runs = [tmp_path / run / "hegel" for run in ("one", "two")]
    for folder in runs:
        folder.parent.mkdir()
    first, second = (ingest(original, folder, 500) for folder in runs)

    assert first == second
    assert files(runs[0]) == files(runs[1])
    assert len(files(runs[0])) > 5  # the original, the outline, and the sections, some of them parts


@pytest.mark.parametrize(
    ("name", "content", "reason"),
    [
        ("notes.txt", "Café".encode("latin-1"), "format"),
        ("paper.pdf", b"%PDF-1.7\n", "format"),
        ("notes.rtf", b"{\\rtf1 Hello}", "format"),
        ("notes.txt", b"Hello\x00world", "format"),
        ("notes.md", b"\xef\xbb\xbf \n\n\t\n", "empty"),
        ("notes.md", b"# Only\n\n## Headings\n", "empty"),
    ],
)
def test_a_file_with_no_text_gauss_reads_is_refused_and_nothing_is_written(tmp_path, name, content, reason):
    summary, folder = run(tmp_path, name, content)

    assert summary["result"] == "refused"
    assert summary["reason"] == reason
    assert summary["detail"]
    assert list(folder.iterdir()) == []


def test_the_command_prints_the_summary_and_refuses_a_folder_that_is_not_empty(tmp_path):
    original = tmp_path / "notes.txt"
    original.write_text("".join(paragraphs([300] * 9 + [299])), encoding="utf-8")
    command = [sys.executable, str(SCRIPT), "ingest", str(original), str(tmp_path / "notes"), "--limit", "1000"]

    done = subprocess.run(command, capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stderr
    assert done.stdout.count("\n") == 1
    assert json.loads(done.stdout) == {
        "result": "converted",
        "title": "notes",
        "format": "text",
        "sections": 4,
        "cut": [{"title": "notes", "parts": 4}],
    }

    again = subprocess.run(command, capture_output=True, text=True, check=False)
    assert again.returncode == 2
    assert again.stdout == ""
    assert "not empty" in again.stderr
