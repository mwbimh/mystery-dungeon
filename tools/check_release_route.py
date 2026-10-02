#!/usr/bin/env python3
"""Check the requested PR route; repository rules enforce merge permissions."""
import os
import sys


def validate_route(event, base, head, head_repository, repository):
    if event == "push":
        return  # The workflow limits pushes to preview and main.
    if event != "pull_request":
        raise ValueError(f"Unsupported release event: {event}")
    expected = {"preview": "design", "main": "preview"}.get(base)
    if expected is None or head != expected or head_repository != repository:
        raise ValueError(
            "Allowed pull requests: this repository's design -> preview, "
            "then preview -> main after human acceptance. "
            f"Received {head_repository}:{head} -> {base}."
        )


def main():
    try:
        validate_route(*(os.environ.get(key, "") for key in (
            "EVENT_NAME", "BASE_BRANCH", "HEAD_BRANCH", "HEAD_REPOSITORY", "REPOSITORY"
        )))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print("Release route is valid. CI success is not human acceptance.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
