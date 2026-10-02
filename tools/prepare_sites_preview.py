#!/usr/bin/env python3
"""Prepare a verified GitHub preview revision for the existing private Site.

This does not create Sites, push Git, publish, merge, or record human approval.
Use the supported Sites workflow after this preparation step.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

REPOSITORY = "https://github.com/mwbimh/mystery-dungeon"
PROJECT_ID = "appgprj_6abf37f379808191aece1448c4431460"
BRANCH = "preview"


def run(root, *args, capture=False):
    return subprocess.run(args, cwd=root, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def sha256(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def validate_sha(value):
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Use the full, exact 40-character GitHub commit SHA")
    return value


def check_source(root, expected):
    if run(root, "git", "rev-parse", "HEAD", capture=True).strip() != expected:
        raise ValueError("Source HEAD changed or differs from the selected preview SHA")
    if run(root, "git", "status", "--porcelain", capture=True).strip():
        raise ValueError("Source checkout is not clean; preserve and resolve local changes first")
    advertised = run(root, "git", "ls-remote", "--heads", REPOSITORY + ".git",
                     "refs/heads/" + BRANCH, capture=True).strip().split()
    if not advertised or advertised[0] != expected:
        raise ValueError("GitHub preview advanced; reselect, recheck and rebuild the latest revision")


def check_destination(site, expected_previous):
    manifest = json.loads((site / ".openai/hosting.json").read_text())
    if manifest.get("project_id") != PROJECT_ID:
        raise ValueError("Destination is not the registered mystery-dungeon preview Site")
    if manifest.get("static", {}).get("directory") != "dist":
        raise ValueError("Preview Site must use static.directory=dist")
    if (site / ".git").exists():
        if run(site, "git", "status", "--porcelain", capture=True).strip():
            raise ValueError("Site checkout has local changes; preserve them before preparing another version")
    dist = site / "dist"
    if dist.is_symlink():
        raise ValueError("Site dist must not be a symlink")
    if dist.exists():
        metadata = dist / "deployment.json"
        if not metadata.is_file():
            raise ValueError("Existing dist lacks provenance; do not overwrite it automatically")
        previous = json.loads(metadata.read_text())
        if previous.get("repository") != REPOSITORY or previous.get("branch") != BRANCH:
            raise ValueError("Existing dist belongs to a different source")
        actual = previous.get("source_sha")
    else:
        actual = "unpublished"
    if actual != expected_previous:
        raise ValueError(f"Site source moved: expected {expected_previous}, found {actual}")


def prepare(root, site, expected, expected_previous):
    root, site = root.resolve(), site.resolve()
    validate_sha(expected)
    if site == root or root in site.parents or site in root.parents:
        raise ValueError("Use separate GitHub source and Sites checkout directories")
    check_source(root, expected)
    check_destination(site, expected_previous)
    # Both commands run the real, pinned Luban conversion. Never reuse stale JSON.
    run(root, "npm", "run", "check")
    run(root, "npm", "run", "build")
    check_source(root, expected)
    check_destination(site, expected_previous)
    output = root / "dist"
    if not (output / "index.html").is_file():
        raise ValueError("Build did not produce dist/index.html")
    generated = output / "config/game.json"
    if sha256(generated) != sha256(root / "config/game.json"):
        raise ValueError("Build config differs from the freshly validated runtime config")
    for entry in output.rglob("*"):
        if entry.is_symlink():
            raise ValueError(f"Refuse symlink in build output: {entry}")
        if entry.is_file() and entry.suffix.lower() == ".png":
            with entry.open("rb") as handle:
                if handle.read(8) != b"\x89PNG\r\n\x1a\n":
                    raise ValueError(f"Runtime asset is not a hydrated PNG: {entry}")
    provenance = {
        "repository": REPOSITORY, "branch": BRANCH, "source_sha": expected,
        "source_tree": run(root, "git", "rev-parse", "HEAD^{tree}", capture=True).strip(),
        "source_url": REPOSITORY + "/commit/" + expected,
        "project_id": PROJECT_ID,
        "generated_config_sha256": sha256(generated),
        "workbooks_sha256": {name: sha256(root / "config" / name)
                             for name in ("rules.xlsx", "monsters.xlsx", "items.xlsx", "dungeons.xlsx", "spawns.xlsx", "texts.xlsx")},
        "prepared_at": datetime.now(timezone.utc).isoformat(),
        "checks": ["npm run check", "npm run build"],
        "human_acceptance": "not_recorded_by_this_tool",
    }
    # A failed build leaves the previous Site intact. Keep a recoverable backup
    # until the new tree is installed, then remove only that known generated tree.
    with tempfile.TemporaryDirectory(prefix="md-preview-", dir=site.parent) as temporary:
        temporary = Path(temporary)
        staging, backup = temporary / "dist", temporary / "previous-dist"
        shutil.copytree(output, staging)
        (staging / "deployment.json").write_text(json.dumps(provenance, indent=2) + "\n")
        (staging / "build-info.json").write_text(json.dumps({
            "sourceCommit": expected, "sourceBranch": BRANCH,
            "repository": "mwbimh/mystery-dungeon", "workflowRunUrl": None,
            "gameConfigSha256": provenance["generated_config_sha256"],
            "workbooksSha256": provenance["workbooks_sha256"],
            "builder": "local-pinned-luban-and-native-sites",
        }, indent=2) + "\n")
        shutil.copy2(root / "LICENSE", staging / "LICENSE")
        check_source(root, expected)
        check_destination(site, expected_previous)
        current = site / "dist"
        if current.exists():
            current.rename(backup)
        try:
            staging.rename(current)
        except OSError:
            if backup.exists():
                backup.rename(current)
            raise
    print(json.dumps({"project_id": PROJECT_ID, "github_source_sha": expected,
                      "site_checkout": str(site), "publication_required": True}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--site-checkout", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--expected-previous-source-sha", required=True,
                        help="Read from opened Site dist/deployment.json, or unpublished for the first version")
    args = parser.parse_args()
    prepare(args.source, args.site_checkout, args.source_sha, args.expected_previous_source_sha)


if __name__ == "__main__":
    main()
