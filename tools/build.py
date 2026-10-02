#!/usr/bin/env python3
"""Regenerate validated workbook data and assemble a static site in dist/."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def check_runtime_images(directory):
    images = list(directory.rglob("*.png"))
    if not images:
        raise ValueError(f"No runtime PNGs found in {directory}")
    for image in images:
        with image.open("rb") as handle:
            signature = handle.read(8)
        if signature != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"{image}: expected PNG image bytes, not a Git LFS pointer or other file. Run git lfs install and git lfs pull.")


def main():
    # Validation must finish before replacing the previous successful build.
    subprocess.run([sys.executable, str(ROOT / "tools/convert_config.py")],
                   cwd=ROOT, check=True)
    check_runtime_images(ROOT / "assets/runtime")
    destination = ROOT / "dist"
    staging = ROOT / ".dist-staging"
    if staging.exists():
        shutil.rmtree(staging)
    try:
        staging.mkdir()
        shutil.copy2(ROOT / "index.html", staging / "index.html")
        for directory in ("js", "css", "assets/runtime", "vendor"):
            shutil.copytree(ROOT / directory, staging / directory)
        (staging / "config").mkdir()
        for filename in ("game.json", "schema.json"):
            shutil.copy2(ROOT / "config" / filename, staging / "config" / filename)
        if destination.exists():
            shutil.rmtree(destination)
        staging.rename(destination)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print(f"Static site built: {destination}")


if __name__ == "__main__":
    main()
