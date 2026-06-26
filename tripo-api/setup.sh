#!/usr/bin/env bash
# Set up the TripoSR FastAPI service in a self-contained venv.
#
#   ./setup.sh            # CPU torch (works anywhere, slow generation)
#   ./setup.sh cu121      # CUDA 12.1 torch (NVIDIA GPU, fast)
#   ./setup.sh cu118      # CUDA 11.8 torch
#
# Run this once on the Lenovo (or any box that will serve the model). The venv,
# the cloned TripoSR repo, and downloaded weights are all gitignored.
set -euo pipefail

cd "$(dirname "$0")"
HERE="$(pwd)"
TORCH_VARIANT="${1:-cpu}"
TRIPOSR_REPO="https://github.com/VAST-AI-Research/TripoSR.git"
VENDOR_DIR="$HERE/vendor/TripoSR"

echo "==> Python venv"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel

echo "==> PyTorch ($TORCH_VARIANT)"
case "$TORCH_VARIANT" in
  cpu)
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    ;;
  cu118|cu121|cu124)
    pip install torch torchvision --index-url "https://download.pytorch.org/whl/$TORCH_VARIANT"
    ;;
  *)
    echo "Unknown torch variant '$TORCH_VARIANT' (use: cpu | cu118 | cu121 | cu124)" >&2
    exit 1
    ;;
esac

echo "==> Clone TripoSR"
if [ ! -d "$VENDOR_DIR/.git" ]; then
  git clone --depth 1 "$TRIPOSR_REPO" "$VENDOR_DIR"
else
  git -C "$VENDOR_DIR" pull --ff-only || true
fi

echo "==> TripoSR deps (builds torchmcubes against the torch installed above)"
# setuptools<70 avoids a known build break for torchmcubes' legacy setup.
pip install "setuptools<70"
pip install -r "$VENDOR_DIR/requirements.txt"

echo "==> FastAPI service deps"
pip install -r "$HERE/requirements.txt"

echo
echo "Done. Start the API with:  ./run.sh"
echo "First request downloads the ~1.7GB weights from Hugging Face and caches them."
