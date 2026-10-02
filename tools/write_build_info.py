#!/usr/bin/env python3
"""Add non-secret provenance to an already validated static build."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    destination = ROOT / "dist"
    if not (destination / "index.html").is_file():
        raise SystemExit("Build dist/ before recording provenance")
    info = {
        "sourceCommit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "sourceBranch": os.environ.get("SOURCE_BRANCH", "local"),
        "repository": os.environ.get("REPOSITORY", "mwbimh/mystery-dungeon"),
        "workflowRunUrl": os.environ.get("WORKFLOW_RUN_URL", ""),
        "gameConfigSha256": sha256(destination / "config/game.json"),
        "workbooksSha256": {name: sha256(ROOT / "config" / name)
                            for name in ("rules.xlsx", "monsters.xlsx", "items.xlsx", "dungeons.xlsx", "spawns.xlsx", "texts.xlsx")},
    }
    (destination / "build-info.json").write_text(
        json.dumps(info, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()
