"""A photo the learner attaches to a message, made ready for the tutor.

    photo.py <original> <jpeg>

reads the original, a file the learner attached, and writes the photo as a
JPEG at <jpeg>, a file that must not exist yet. It writes one line of JSON on
standard output: {"result": "taken", "width", "height"}, or
{"result": "refused", "reason", "detail"}, the reason "format" (not a JPEG,
PNG or WebP image), "damaged" (one that cannot be read whole) or "large"
(more pixels than Gauss decodes). An original it cannot open, or a JPEG it
cannot write, is an error on standard error, with exit status 2.

The format comes from the content, never the name. The photo is turned as
its EXIF orientation says, transparency is put on white, it is scaled down to
what the tutor's model reads (`fitted_size`), and it is written with no
metadata, since a phone's photo can say where it was taken.
"""

import argparse
import json
import math
import struct
import sys
import warnings
import zlib
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

# What Claude reads of an image (its vision documentation, checked on
# 2026-11-25): on Claude 4.7 and later models, at most 2,576 pixels on a side
# and 4,784 visual tokens of 28 by 28 pixels; earlier models read 1,568 and
# 1,568. The API scales a larger image down itself, so a photo kept larger
# would only cost its upload and storage.
MAX_EDGE = 2576
MAX_PATCHES = 4784
PATCH = 28

# Decoding more than this could take the sandbox's memory: a phone's camera
# takes 12 to 48 megapixels.
PIXEL_LIMIT = 50_000_000
QUALITY = 85

_FORMATS = ("JPEG", "PNG", "WEBP")
# HEIF's brands, at bytes 8 to 12 of its `ftyp` box: an iPhone's default.
_HEIF_BRANDS = {b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"hevm", b"hevs", b"mif1", b"msf1"}

# Damage shows as any of these from a decoder, depending on the format and
# where the data stops (IndexError: a PNG's cut-off chunk read after its
# pixels).
_DAMAGE = (OSError, ValueError, EOFError, SyntaxError, IndexError, struct.error, zlib.error)

# Pillow refuses an image over twice this many pixels before it decodes or
# allocates anything, a WebP's canvas included; between once and twice it
# only warns, which `take` ignores. So it refuses at PIXEL_LIMIT.
Image.MAX_IMAGE_PIXELS = PIXEL_LIMIT // 2


class Unusable(Exception):
    """An argument or file the command cannot use: exit status 2."""


def fitted_size(width, height):
    """The largest size of the same shape that Claude reads unscaled, or the size itself if it does."""

    def fits(w, h):
        across, down = math.ceil(w / PATCH), math.ceil(h / PATCH)
        return across * PATCH <= MAX_EDGE and down * PATCH <= MAX_EDGE and across * down <= MAX_PATCHES

    if fits(width, height):
        return width, height
    if height > width:
        tall, wide = fitted_size(height, width)
        return wide, tall
    # The longest side that fits, its short side rounded as Claude rounds it.
    shape = width / height
    low, high = 1, width
    while low + 1 < high:
        middle = (low + high) // 2
        if fits(middle, max(round(middle / shape), 1)):
            low = middle
        else:
            high = middle
    return low, max(round(low / shape), 1)


def take(original, output):
    """Writes the original as the photo's JPEG at `output`: the result to print."""
    original, output = Path(original), Path(output)
    try:
        with original.open("rb") as file:
            head = file.read(12)
    except OSError as error:
        raise Unusable(f"the original cannot be read ({error})") from None
    if head[4:8] == b"ftyp" and head[8:12] in _HEIF_BRANDS:
        return _refused("format", "It is a HEIC image, which Gauss does not read: save it as JPEG and attach that.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            image = Image.open(original, formats=_FORMATS)
    except Image.DecompressionBombError:
        return _refused("large", f"It has more than {PIXEL_LIMIT // 1_000_000} megapixels, the most Gauss takes.")
    except UnidentifiedImageError:
        # A header a supported format starts with, whose rest Pillow could not read.
        if _supported_start(head):
            return _refused("damaged", _DAMAGED)
        return _refused("format", "It is not a JPEG, PNG or WebP image.")
    except _DAMAGE:
        return _refused("damaged", _DAMAGED)
    with image:
        try:
            image.load()
            photo = _on_white(ImageOps.exif_transpose(image))
        except _DAMAGE:
            return _refused("damaged", _DAMAGED)
    # The JPEG encoder falls back on the image's own comment, which a
    # conversion carries over; nothing of the original's metadata may pass.
    photo.info.clear()
    size = fitted_size(photo.width, photo.height)
    if size != photo.size:
        photo = photo.resize(size, Image.Resampling.LANCZOS, reducing_gap=3.0)
    try:
        # The save is given no metadata, and the image has none left.
        with output.open("xb") as file:
            photo.save(file, "JPEG", quality=QUALITY, optimize=True)
    except OSError as error:
        raise Unusable(f"the photo cannot be written ({error})") from None
    return {"result": "taken", "width": photo.width, "height": photo.height}


_DAMAGED = "The image is damaged: it cannot be read whole."


def _refused(reason, detail):
    return {"result": "refused", "reason": reason, "detail": detail}


def _supported_start(head):
    return head.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")) or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")


def _on_white(image):
    """The image in 8-bit RGB, anything transparent in it on white."""
    if image.mode.startswith("I"):
        # 16-bit grey (a PNG's): converting clips each sample at 255, so it
        # is scaled down first. A transparent grey level it names is lost.
        return image.convert("I").point(lambda sample: sample / 256).convert("L").convert("RGB")
    if not image.has_transparency_data:
        return image.convert("RGB")
    clear = image.convert("RGBA")
    white = Image.new("RGB", clear.size, "white")
    white.paste(clear, mask=clear.getchannel("A"))
    return white


def main(argv=None):
    parser = argparse.ArgumentParser(prog="photo.py", description="Takes in a photo for Gauss.")
    parser.add_argument("original", type=Path)
    parser.add_argument("jpeg", type=Path)
    arguments = parser.parse_args(argv)
    try:
        result = take(arguments.original, arguments.jpeg)
    except Unusable as error:
        print(f"photo.py: {error}", file=sys.stderr)
        return 2
    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
