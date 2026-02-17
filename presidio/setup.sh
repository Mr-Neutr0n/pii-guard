#!/bin/bash
set -e
cd "$(dirname "$0")"

PYTHON=""
for candidate in python3.12 python3.13 python3; do
  if command -v "$candidate" &>/dev/null; then
    ver=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    major=$(echo "$ver" | cut -d. -f1)
    minor=$(echo "$ver" | cut -d. -f2)
    if [ "$major" -eq 3 ] && [ "$minor" -ge 10 ] && [ "$minor" -lt 14 ]; then
      PYTHON="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "ERROR: Requires Python 3.10-3.13. Python 3.14 is not yet supported by spaCy/Presidio."
  echo "Install Python 3.12 via: brew install python@3.12"
  exit 1
fi

echo "Using $PYTHON ($($PYTHON --version))"
echo "Creating virtual environment..."
$PYTHON -m venv .venv
source .venv/bin/activate

echo "Installing dependencies..."
pip install -r requirements.txt

echo "Downloading spaCy model (en_core_web_lg, ~560MB)..."
python -m spacy download en_core_web_lg

echo ""
echo "Setup complete."
echo "To run: source .venv/bin/activate && python app.py"
