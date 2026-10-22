#!/usr/bin/env bash
# Build JupyterLite distribution for Nekazari Scientific Lab.
# Run from the jupyterlite/ directory.
# Output: jupyterlite/dist/ (upload to MinIO s3://nekazari-static/jupyterlite/)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing build dependencies..."
pip install -q -r build_requirements.txt

echo "==> Building JupyterLite distribution..."
jupyter lite build \
  --config jupyter_lite_config.json \
  --piplite-wheels requirements.txt \
  --contents notebooks \
  --output-dir dist

# Inject the NKZ auth handshake script into the built index.html (no sed — see script docstring).
if [ -f dist/lab/index.html ] && [ -f nkz_jupyter_init.js ]; then
  echo "==> Injecting nkz_jupyter_init.js into lab/index.html..."
  python3 inject_nkz_init_into_lab_html.py
fi

# Copy the Micro-SDK wheel (plain .py — Pyodide can import it from the virtual FS)
if [ -f nekazari.py ]; then
  echo "==> Copying nekazari.py to distribution..."
  mkdir -p dist/files
  cp nekazari.py dist/files/nekazari.py
fi

echo "==> Build complete: dist/"
ls -lh dist/
