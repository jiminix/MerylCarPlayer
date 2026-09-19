#!/usr/bin/env python3
"""Repair the one missing base64 character in the image uploaded to GitHub.

The checksum is for the original, fully decoded, verified 360x80 PNG.
Refuse to build if that original cannot be recovered exactly.
"""
from pathlib import Path
import base64
import hashlib
import string
import struct
import zlib

root = Path(__file__).resolve().parent.parent
target = root / "app/src/main/res/drawable/merylcarplayer_logo.png"
damaged = root / "scripts/banner_source_damaged.bin"
expected = "a8cca929f16b0780ee1b211a1f84a59fbd59cd8e"
alphabet = string.ascii_uppercase + string.ascii_lowercase + string.digits + "+/"


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def full_png_is_valid(data: bytes) -> bool:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    index = 8
    while index + 12 <= len(data):
        length = struct.unpack(">I", data[index:index + 4])[0]
        typ = data[index + 4:index + 8]
        end = index + 12 + length
        if end > len(data):
            return False
        chunk_data = data[index + 4:index + 8 + length]
        crc = struct.unpack(">I", data[index + 8 + length:end])[0]
        if zlib.crc32(chunk_data) != crc:
            return False
        index = end
        if typ == b"IEND":
            return index == len(data)
    return False


if target.exists() and git_blob_sha(target.read_bytes()) == expected:
    print("The logo is already verified.")
    raise SystemExit(0)

decoded = damaged.read_bytes()
data64 = base64.b64encode(decoded).decode("ascii").rstrip("=")
assert len(data64) == 8671, f"Unexpected damaged base64 length: {len(data64)}"
# The final base64 digit from the original PNG is 'C'; the damaged
# one is reset by the decoder because its last two bits were lost.
data64 = data64[:-1] + "C"
png_header = b"\x89PNG\r\n\x1a\n"
for position in range(len(data64) + 1):
    prefix, suffix = data64[:position], data64[position:]
    for digit in alphabet:
        candidate = base64.b64decode(prefix + digit + suffix)
        if not candidate.startswith(png_header):
            continue
        if git_blob_sha(candidate) == expected and full_png_is_valid(candidate):
            target.write_bytes(candidate)
            print("Successfully restored the original banner and verified PNG checksums.")
            raise SystemExit(0)

raise SystemExit("The banner image could not be repaired; APK build stopped.")
