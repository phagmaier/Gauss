"""Source conversion: a source's original into its outline and section files.

    convert.py ingest <original> <folder> [--limit N]

reads the original, a file the learner attached, and writes into the folder,
which must be empty and whose name is the source's id: a copy of the
original (`original.<ext>`), `outline.json` (`Outline` in
`src/shared/source.ts`) and `sections/<id>.md`. It writes one line of JSON on
standard output: {"result": "converted", ...} with the outline's summary (its
title, format, number of sections, and each stretch cut into parts), or
{"result": "refused", "reason", "detail"}, the reason "format" (not a file
Gauss reads) or "empty" (no text). Arguments it cannot use, an original it
cannot read or a folder that is not empty are an error on standard error, with
exit status 2.

The format comes from the content: UTF-8 text named `.txt` is plain text,
named `.md` or `.markdown` Markdown. Text is paragraphs between blank lines,
with no headings. Markdown's top-level ATX and setext headings make the
outline. A fenced block, including one in a list or quote, is never cut.

The sections (architecture.md section 8; decisions.md, "Sources"): a
heading's stretch runs to the next heading. Its text before a first
subheading is a section of its own, under the heading's title; a heading
with no text of its own goes into the next section, or the last. The
section files are slices of the source's text, which in order are the whole
of it, so a section holds its heading. A stretch over the limit is cut
(`_cut`), and its paragraphs are numbered before the cut, so that its parts
continue the count.
"""

import argparse
import hashlib
import json
import re
import sys
from bisect import bisect_left
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path

from markdown_it import MarkdownIt

CONVERTER_VERSION = 2  # raised when the same original would give other files
SECTION_LIMIT = 20_000  # characters of a section's text (decisions.md, "Sources")
_MAX_LIMIT = (1 << 53) - 1  # Outline.limit must be a JavaScript safe integer

_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")  # `Slug` in src/shared/course.ts
_EXTENSIONS = {".txt": "text", ".md": "markdown", ".markdown": "markdown"}
_COPY = {"text": "original.txt", "markdown": "original.md"}

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
class Heading:
    level: int
    title: str
    start: int  # where the heading's lines start in the text


@dataclass(frozen=True)
class Paragraph:
    start: int
    end: int  # after its last line's newline
    whole: bool = False  # never cut: a fenced block


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
        format, text, blocks = _read(data, original.name)
        headings = [block for block in blocks if isinstance(block, Heading)]
        title = _title(original.name, blocks, headings)
        entries, sections, cut = _outline(text, blocks, title, limit)
    except Refused as refusal:
        return {"result": "refused", "reason": refusal.reason, "detail": str(refusal)}

    (folder / "sections").mkdir()
    for id, section in sections.items():
        with open(folder / "sections" / f"{id}.md", "w", encoding="utf-8", newline="\n") as out:
            out.write(section)
    (folder / _COPY[format]).write_bytes(data)
    outline = {
        "id": folder.name,
        "title": title,
        "file": _COPY[format],
        "name": original.name,
        "format": format,
        "sha256": hashlib.sha256(data).hexdigest(),
        "converter": CONVERTER_VERSION,
        "limit": limit,
        "entries": entries,
    }
    with open(folder / "outline.json", "w", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(outline, ensure_ascii=False, indent=2) + "\n")
    return {"result": "converted", "title": title, "format": format, "sections": len(sections), "cut": cut}


# Reading


def _read(data, name):
    """The format, the source's text, and its headings and paragraphs in order."""
    format = _EXTENSIONS.get(Path(name).suffix.lower())
    if format is None:
        raise Refused("format", "Only .txt, .md and .markdown files are supported.")
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
    if not any(isinstance(block, Paragraph) for block in blocks):
        raise Refused("empty", "It holds headings but no text under them.")
    return format, text, blocks


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


# Sections


def _outline(text, blocks, title, limit):
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
                "place": {"paragraphs": {"first": first, "last": last}},
            }
            if len(parts) > 1:
                entry["part"] = {"number": number, "of": len(parts)}
            stretch.sections.append(entry)

    # Nesting: each heading under the nearest one before it of a higher level.
    top, open_headings = [], []
    for stretch in stretches:
        if stretch.heading is None:
            top.append(stretch)
            continue
        while open_headings and open_headings[-1].heading.level >= stretch.heading.level:
            open_headings.pop()
        (open_headings[-1].children if open_headings else top).append(stretch)
        open_headings.append(stretch)
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
    cut = _cut_point(text, low, high)
    if cut is None:
        return [start]
    return _split(text, start, cut, paragraph, limit) + _split(text, cut, end, paragraph, limit)


def _cut_point(text, low, high):
    """The sentence end, or else the space, nearest the middle of text[low:high], cut after its spacing."""
    for pattern in (_SENTENCE_END, _SPACE):
        cuts = [m.end() for m in pattern.finditer(text, low, high) if low < m.end() < high]
        if cuts:
            return min(cuts, key=lambda cut: (abs(2 * cut - low - high), cut))
    return (low + high) // 2 if high - low > 1 else None


def main(argv=None):
    parser = argparse.ArgumentParser(prog="convert.py", description="Converts a source for Gauss.")
    commands = parser.add_subparsers(dest="command", required=True)
    ingest_command = commands.add_parser("ingest", help="convert an original into a folder")
    ingest_command.add_argument("original", type=Path)
    ingest_command.add_argument("folder", type=Path)
    ingest_command.add_argument("--limit", type=_positive, default=SECTION_LIMIT, help="a section's characters")
    arguments = parser.parse_args(argv)
    try:
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
