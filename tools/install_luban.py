#!/usr/bin/env python3
"""Install the checksum-pinned official Luban release without trusting existing tools."""
import argparse
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = "5.1.0"
URL = f"https://github.com/focus-creative-games/luban/releases/download/v{VERSION}/Luban.7z"
SHA256 = "bac9a1b8d69cfeaa7ef1d8c67b34a007324d1cd158e0b14294521b3879ba5213"


def verify(archive):
    with archive.open("rb") as handle:
        actual = hashlib.file_digest(handle, "sha256").hexdigest()
    if actual != SHA256:
        raise ValueError(f"Luban archive SHA-256 mismatch: expected {SHA256}, got {actual}. Existing tools were not changed.")


def install(archive=None):
    try:
        import py7zr
    except ImportError as exc:
        raise RuntimeError("Install dependencies first: python3 -m pip install -r requirements-dev.txt") from exc
    tools = ROOT / ".tools"
    tools.mkdir(exist_ok=True)
    destination = tools / "luban"
    with tempfile.TemporaryDirectory(prefix="luban-install-", dir=tools) as work:
        work = Path(work)
        if archive is None:
            archive = work / "Luban.7z"
            print(f"Downloading official Luban {VERSION}: {URL}", flush=True)
            if shutil.which("curl"):
                subprocess.run(["curl", "--fail", "--location", "--retry", "2", "--connect-timeout", "30", "--max-time", "300", "--output", str(archive), URL], check=True)
            else:
                with urllib.request.urlopen(URL, timeout=60) as response, archive.open("wb") as output:
                    shutil.copyfileobj(response, output)
        archive = Path(archive).resolve()
        verify(archive)
        extracted = work / "extracted"
        extracted.mkdir()
        with py7zr.SevenZipFile(archive, mode="r") as bundle:
            for name in bundle.getnames():
                parts = PurePosixPath(name.replace("\\", "/"))
                if parts.is_absolute() or ".." in parts.parts or ":" in name:
                    raise ValueError(f"Unsafe archive path: {name}")
            bundle.extractall(path=extracted)
        dll = extracted / "Luban" / "Luban.dll"
        if not dll.is_file():
            raise ValueError("Official archive does not contain expected Luban/Luban.dll")
        (extracted / "VERSION").write_text(f"{VERSION}\narchive-sha256={SHA256}\n", encoding="utf-8")
        # Replace only after download, checksum and extraction all succeed.
        previous = work / "previous"
        if destination.exists():
            destination.rename(previous)
        try:
            extracted.rename(destination)
        except OSError:
            if previous.exists():
                previous.rename(destination)
            raise
    print(f"Installed verified Luban {VERSION}: {destination / 'Luban/Luban.dll'}")
    print("Requires .NET SDK 8.0.408 (or compatible .NET 8 runtime).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Use a locally downloaded official Luban.7z; the same SHA-256 is required")
    args = parser.parse_args()
    try:
        install(args.archive)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Luban installation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
