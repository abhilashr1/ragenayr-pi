#!/usr/bin/env python3
"""Print a small line-numbered slice of a text file for source citations."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Print FILE lines START through END with line numbers.")
    parser.add_argument("file", help="file to read")
    parser.add_argument("start", type=int, help="1-based start line")
    parser.add_argument("end", type=int, nargs="?", help="1-based end line, inclusive; defaults to START")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path = Path(args.file)
    start = args.start
    end = args.end if args.end is not None else start

    if start < 1 or end < start:
        print("start must be >= 1 and end must be >= start", file=sys.stderr)
        return 2

    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for lineno, line in enumerate(fh, start=1):
                if lineno < start:
                    continue
                if lineno > end:
                    break
                print(f"{lineno}: {line.rstrip()}")
    except FileNotFoundError:
        print(f"file not found: {path}", file=sys.stderr)
        return 1
    except IsADirectoryError:
        print(f"is a directory: {path}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
