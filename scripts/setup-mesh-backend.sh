#!/usr/bin/env bash
#
# Set up the mesh API Python env (Phase 1 / TripoSR) in WSL2 Ubuntu.
#
#   npm run mesh:setup
#
# Mirrors scripts/setup-motion-backend.sh but for the mesh stack. Because the
# 3D engines need a CUDA-matched torch and a non-pip-installable git clone, the
# ordering matters and lives here rather than in requirements-mesh.txt.
#
# This script DOWNLOADS SEVERAL GB (torch + TripoSR). Weights (~1.6 GB) download
# separately on the first generation run, cached under ~/.cache/huggingface.
#
# Tunables:
#   TORCH_INDEX_URL  default https://download.pytorch.org/whl/cu121
#   PYTHON_VERSION   default 3.11
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV="$BACKEND/.venv"
ENGINES="$BACKEND/engines"
TRIPOSR_DIR="$ENGINES/TripoSR"
PYTHON_VERSION="${PYTHON_VERSION:-3.11}"
TORCH_INDEX_URL="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cu121}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --- Prerequisites (system packages; install once with apt) -----------------
say "Checking prerequisites"
MISSING=()
command -v git  >/dev/null 2>&1 || MISSING+=(git)
command -v curl >/dev/null 2>&1 || MISSING+=(curl)
command -v g++  >/dev/null 2>&1 || MISSING+=(build-essential)
if ((${#MISSING[@]})); then
  die "Missing system packages: ${MISSING[*]}
  Install them first (changes system packages):
      sudo apt update && sudo apt install -y build-essential git curl python3-dev"
fi

# --- uv (manages a Python 3.11 toolchain without touching system Python) -----
if ! command -v uv >/dev/null 2>&1; then
  say "Installing uv (Python toolchain manager)"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
command -v uv >/dev/null 2>&1 || die "uv install failed; ensure ~/.local/bin is on PATH"

# --- venv at backend/.venv (POSIX layout -> .venv/bin/python3) --------------
PY="$VENV/bin/python3"
if [ -x "$PY" ]; then
  say "Reusing existing venv at $VENV"          # don't recreate -> keeps torch
else
  say "Creating venv at $VENV (Python $PYTHON_VERSION)"
  uv venv --python "$PYTHON_VERSION" "$VENV"
fi
PIP=(uv pip install --python "$PY")

say "Installing torch + torchvision ($TORCH_INDEX_URL)"
"${PIP[@]}" torch torchvision --index-url "$TORCH_INDEX_URL"

say "Verifying CUDA is visible to torch"
"$PY" - <<'PY'
import torch
print(f"torch {torch.__version__} | cuda_available={torch.cuda.is_available()} "
      f"| device={torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu'}")
PY

# --- TripoSR engine (smoke test) --------------------------------------------
say "Cloning TripoSR -> $TRIPOSR_DIR"
mkdir -p "$ENGINES"
if [ -d "$TRIPOSR_DIR/.git" ]; then
  git -C "$TRIPOSR_DIR" pull --ff-only || true
else
  git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git "$TRIPOSR_DIR"
fi

# torchmcubes only ships a source build whose CMake does find_package(Torch);
# with the cu121 torch that pulls in Caffe2's hard CUDA requirement, which needs
# a CUDA toolkit (nvcc) WSL doesn't have. Rather than install ~3 GB of toolkit
# just for marching cubes, install everything EXCEPT torchmcubes and drop in a
# compile-free CPU shim backed by PyMCubes (see backend/engines/torchmcubes_shim.py).
say "Installing TripoSR requirements (minus torchmcubes)"
REQ_FILTERED="$(mktemp)"
grep -iv 'torchmcubes' "$TRIPOSR_DIR/requirements.txt" > "$REQ_FILTERED"
"${PIP[@]}" -r "$REQ_FILTERED"
rm -f "$REQ_FILTERED"

say "Installing PyMCubes + torchmcubes CPU shim"
"${PIP[@]}" PyMCubes
SITE="$("$PY" -c 'import sysconfig; print(sysconfig.get_path("purelib"))')"
install -m 0644 "$BACKEND/engines/torchmcubes_shim.py" "$SITE/torchmcubes.py"
echo "Installed torchmcubes CPU shim -> $SITE/torchmcubes.py"

say "Installing mesh API Python deps (requirements-mesh.txt)"
"${PIP[@]}" -r "$BACKEND/requirements-mesh.txt"

say "Mesh backend ready"
cat <<EOF

  Interpreter : $PY
  Engine      : $TRIPOSR_DIR
  Weights     : download automatically on first run (stabilityai/TripoSR,
                ~1.6 GB) into ~/.cache/huggingface

  Next:
    npm run mesh:api          # start the gateway (127.0.0.1:5190)
    curl 127.0.0.1:5190/api/mesh/health
EOF
