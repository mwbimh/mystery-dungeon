#!/usr/bin/env python3
"""Reference-guided sticker generation via the OpenAI-compatible /images/edits API.

Reads endpoint/model from .agent/imagegen.toml, the key from the environment
variable named by key_env. Sends one or more reference images plus a prompt.

Usage:
  python tools/image_edit.py --image a.png --image b.png \
      --prompt-file p.txt --out out.png [--size 1024x1024]
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
import tomllib
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]


def load_config() -> tuple[str, str, str]:
    cfg = tomllib.loads((ROOT / ".agent" / "imagegen.toml").read_text(encoding="utf-8"))
    profile = cfg.get("default_profile", "default")
    prof = cfg["profiles"][profile]
    key = os.environ.get(prof["key_env"], "")
    if not key:
        raise SystemExit(f"environment variable {prof['key_env']} is not set")
    return prof["endpoint"].rstrip("/"), prof["model"], key


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", action="append", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="1024x1024")
    args = ap.parse_args()

    endpoint, model, key = load_config()
    prompt = Path(args.prompt_file).read_text(encoding="utf-8")

    files = []
    for i, p in enumerate(args.image):
        path = Path(p)
        files.append(
            ("image[]", (path.name, path.read_bytes(), f"image/{path.suffix.lstrip('.').lower()}"))
        )
    form = {
        "model": (None, model),
        "prompt": (None, prompt),
        "n": (None, "1"),
        "size": (None, args.size),
        "background": (None, "transparent"),
    }
    url = f"{endpoint}/images/edits"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {key}"},
        files=files,
        data=form,
        timeout=300,
    )
    if resp.status_code != 200:
        print(f"HTTP {resp.status_code}: {resp.text[:500]}", file=sys.stderr)
        sys.exit(1)
    payload = resp.json()
    item = payload["data"][0]
    out = Path(args.out)
    if item.get("b64_json"):
        out.write_bytes(base64.b64decode(item["b64_json"]))
    elif item.get("url"):
        img = requests.get(item["url"], timeout=120)
        out.write_bytes(img.content)
    else:
        raise SystemExit(f"no image in response keys={list(item)}")
    print(out)


if __name__ == "__main__":
    main()
