#!/usr/bin/env python3
"""
Inject nkz_jupyter_init.js into JupyterLite dist/lab/index.html before </head>.
Used by CI and build.sh — do not use sed (JS content breaks sed delimiters).
"""
from __future__ import annotations

import pathlib
import sys


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent
    html_path = root / "dist" / "lab" / "index.html"
    js_path = root / "nkz_jupyter_init.js"
    if not html_path.is_file() or not js_path.is_file():
        return 0
    js = js_path.read_text(encoding="utf-8")
    content = html_path.read_text(encoding="utf-8")
    needle = "</head>"
    if needle not in content:
        print("inject_nkz_init: no </head> in lab/index.html", file=sys.stderr)
        return 1
    html_path.write_text(
        content.replace(needle, f"<script>{js}</script></head>", 1),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
