#!/usr/bin/env bash
# Installs Piper TTS into ./.venv-piper and downloads the default voice into ./models/piper.
# Usage: bash scripts/setup-piper.sh [voice ...]   (default: en_US-lessac-medium)
set -euo pipefail
cd "$(dirname "$0")/.."
VOICES=("${@:-en_US-lessac-medium}")
MODELS_DIR="${PIPER_MODELS_DIR:-models/piper}"
mkdir -p "$MODELS_DIR"

if command -v uv >/dev/null 2>&1; then
  [ -d .venv-piper ] || uv venv --python 3.11 .venv-piper
  uv pip install --python .venv-piper/bin/python "piper-tts>=1.3"
else
  [ -d .venv-piper ] || python3 -m venv .venv-piper
  .venv-piper/bin/pip install --upgrade pip "piper-tts>=1.3"
fi

for v in "${VOICES[@]}"; do
  if [ ! -f "$MODELS_DIR/$v.onnx" ]; then
    .venv-piper/bin/python -m piper.download_voices --download-dir "$MODELS_DIR" "$v"
  fi
done
echo "Piper ready: $(ls "$MODELS_DIR")"
