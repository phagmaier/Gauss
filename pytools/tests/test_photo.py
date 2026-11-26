"""A photo taken in, on images Pillow makes in each test.

Expected sizes are worked out by hand from Claude's resizing rule: a side
rounds up to whole 28-pixel patches, neither side may pass 2,576 pixels and
the patches may number at most 4,784.
"""

import json
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import pytest
from PIL import Image

from photo import fitted_size, take

SCRIPT = Path(__file__).parents[1] / "photo.py"

RED = (220, 20, 30)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def near(pixel, colour, slack=40):
    return all(abs(a - b) <= slack for a, b in zip(pixel, colour, strict=True))


def chunk(kind, data):
    """A PNG chunk with its length and checksum."""
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def test_a_turned_phone_photo_comes_out_upright_scaled_and_without_metadata(tmp_path):
    # Stored 4000 wide and 3000 high with a red top-left corner; orientation 6
    # says to turn it a quarter clockwise, which puts the corner top right and
    # makes it 3000 by 4000. 3000 by 4000 is 108 by 143 patches, far over 4,784;
    # 1659 by 2212 is 60 by 79, 4,740 patches, and 1660 by 2213 would be
    # 60 by 80, 4,800.
    stored = Image.new("RGB", (4000, 3000), "white")
    stored.paste(RED, (0, 0, 600, 600))
    exif = Image.Exif()
    exif[0x0112] = 6
    exif[0x010E] = "taken at 12 Elm Street"
    original = tmp_path / "IMG_0001.JPG"
    stored.save(original, "JPEG", exif=exif)
    output = tmp_path / "photo.jpg"

    assert take(original, output) == {"result": "taken", "width": 1659, "height": 2212}

    with Image.open(output) as photo:
        assert photo.format == "JPEG"
        assert photo.size == (1659, 2212)
        assert near(photo.getpixel((1659 - 50, 50)), RED)
        assert near(photo.getpixel((50, 50)), (255, 255, 255))
        assert len(photo.getexif()) == 0
        assert "exif" not in photo.info
    assert b"Elm Street" not in output.read_bytes()


def test_transparency_comes_out_white_and_a_small_image_keeps_its_size(tmp_path):
    clear = Image.new("RGBA", (100, 80), (0, 0, 0, 0))
    clear.paste((0, 0, 0, 255), (0, 0, 50, 80))
    original = tmp_path / "screenshot.png"
    clear.save(original)
    output = tmp_path / "photo.jpg"

    assert take(original, output) == {"result": "taken", "width": 100, "height": 80}

    with Image.open(output) as photo:
        assert near(photo.getpixel((20, 40)), (0, 0, 0))
        assert near(photo.getpixel((80, 40)), (255, 255, 255))


def test_a_webp_is_read_whatever_its_name(tmp_path):
    original = tmp_path / "board.png"
    Image.new("RGB", (300, 200), (20, 40, 200)).save(original, "WEBP")
    output = tmp_path / "photo.jpg"

    assert take(original, output) == {"result": "taken", "width": 300, "height": 200}
    with Image.open(output) as photo:
        assert near(photo.getpixel((150, 100)), (20, 40, 200))


def test_text_named_as_a_jpeg_is_refused_as_not_an_image(tmp_path):
    original = tmp_path / "photo.jpg"
    original.write_text("Not an image at all.\n")
    output = tmp_path / "out.jpg"

    assert take(original, output) == {
        "result": "refused",
        "reason": "format",
        "detail": "It is not a JPEG, PNG or WebP image.",
    }
    assert not output.exists()


def test_a_heic_photo_is_refused_with_what_to_do(tmp_path):
    original = tmp_path / "IMG_0002.HEIC"
    original.write_bytes(struct.pack(">I", 24) + b"ftypheic" + b"\0\0\0\0mif1heic" + bytes(64))

    assert take(original, tmp_path / "out.jpg") == {
        "result": "refused",
        "reason": "format",
        "detail": "It is a HEIC image, which Gauss does not read: save it as JPEG and attach that.",
    }


def test_a_cut_off_jpeg_is_refused_as_damaged(tmp_path):
    whole = tmp_path / "whole.jpg"
    Image.effect_noise((800, 600), 80).convert("RGB").save(whole, "JPEG")
    original = tmp_path / "cut.jpg"
    original.write_bytes(whole.read_bytes()[: whole.stat().st_size // 2])
    output = tmp_path / "out.jpg"

    assert take(original, output) == {
        "result": "refused",
        "reason": "damaged",
        "detail": "The image is damaged: it cannot be read whole.",
    }
    assert not output.exists()


@pytest.mark.parametrize(
    "name, content",
    [
        # A PNG claiming 10,000 by 6,000 pixels whose image data holds one row.
        (
            "huge.png",
            PNG_SIGNATURE
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 10_000, 6_000, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(1 + 3 * 10_000)))
            + chunk(b"IEND", b""),
        ),
        # A WebP header claiming an 8,000 by 7,000 canvas, which its decoder
        # would allocate on opening.
        (
            "huge.webp",
            b"RIFF"
            + struct.pack("<I", 22)
            + b"WEBPVP8X"
            + struct.pack("<I", 10)
            + bytes(4)
            + (8_000 - 1).to_bytes(3, "little")
            + (7_000 - 1).to_bytes(3, "little"),
        ),
    ],
)
def test_an_image_over_50_megapixels_is_refused_before_it_is_decoded(tmp_path, name, content):
    original = tmp_path / name
    original.write_bytes(content)

    assert take(original, tmp_path / "out.jpg") == {
        "result": "refused",
        "reason": "large",
        "detail": "It has more than 50 megapixels, the most Gauss takes.",
    }


def test_a_png_whose_header_is_broken_is_damaged_not_another_format(tmp_path):
    whole = tmp_path / "whole.png"
    Image.new("RGB", (40, 30), "white").save(whole)
    content = bytearray(whole.read_bytes())
    content[29] ^= 0xFF  # the first byte of IHDR's checksum
    original = tmp_path / "broken.png"
    original.write_bytes(content)

    assert take(original, tmp_path / "out.jpg")["reason"] == "damaged"


def test_a_png_with_a_cut_off_chunk_after_its_pixels_is_damaged(tmp_path):
    whole = tmp_path / "whole.png"
    Image.new("RGB", (40, 30), "white").save(whole)
    content = whole.read_bytes()
    end = content.rindex(b"IEND") - 4
    original = tmp_path / "broken.png"
    original.write_bytes(content[:end] + chunk(b"iCCP", b"profile\0") + content[end:])

    assert take(original, tmp_path / "out.jpg")["reason"] == "damaged"


def test_a_jpeg_comment_does_not_pass_into_the_photo(tmp_path):
    original = tmp_path / "scan.jpg"
    Image.new("RGB", (60, 40), "white").save(original, "JPEG", comment=b"home address: 12 Elm Street")
    output = tmp_path / "photo.jpg"

    assert take(original, output)["result"] == "taken"
    assert b"Elm Street" not in output.read_bytes()


def test_16_bit_grey_is_scaled_to_8_bits_not_clipped(tmp_path):
    original = tmp_path / "grey.png"
    # Each row: ten samples of 32,768, half of 65,536 (128 in 8 bits), then ten of 0.
    grey = Image.frombytes("I;16", (20, 10), struct.pack("<20H", *[32768] * 10, *[0] * 10) * 10)
    grey.save(original)
    output = tmp_path / "photo.jpg"

    assert take(original, output)["result"] == "taken"
    with Image.open(output) as photo:
        assert near(photo.getpixel((5, 5)), (128, 128, 128), slack=8)
        assert near(photo.getpixel((15, 5)), (0, 0, 0), slack=8)


def test_a_long_narrow_image_is_cut_to_the_longest_side_only():
    # 6000 by 300 is 20 to 1. At 2576 wide (92 patches) it is 128.8, so 129,
    # high (5 patches, 460 in all): the side limit binds, not the count.
    assert fitted_size(6000, 300) == (2576, 129)
    assert fitted_size(300, 6000) == (129, 2576)


def test_the_command_writes_its_result_as_one_line(tmp_path):
    original = tmp_path / "page.png"
    Image.new("RGB", (40, 30), "white").save(original)
    output = tmp_path / "photo.jpg"

    ran = subprocess.run(
        [sys.executable, str(SCRIPT), str(original), str(output)],
        capture_output=True,
        text=True,
        check=True,
    )

    assert json.loads(ran.stdout) == {"result": "taken", "width": 40, "height": 30}
    assert output.read_bytes()[:2] == b"\xff\xd8"


def test_the_command_will_not_write_over_a_file(tmp_path):
    original = tmp_path / "page.png"
    Image.new("RGB", (40, 30), "white").save(original)
    output = tmp_path / "photo.jpg"
    output.write_bytes(b"kept")

    ran = subprocess.run([sys.executable, str(SCRIPT), str(original), str(output)], capture_output=True, text=True)

    assert ran.returncode == 2
    assert ran.stdout == ""
    assert output.read_bytes() == b"kept"
