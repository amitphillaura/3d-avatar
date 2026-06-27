"""CPU drop-in for ``torchmcubes.marching_cubes``, backed by PyMCubes.

Why this exists
---------------
Upstream ``torchmcubes`` only ships a *source* build. Its CMake does
``find_package(Torch)``, and because we install the CUDA (cu121) build of
torch, that transitively drags in Caffe2's hard CUDA requirement at configure
time. A WSL2 box has the CUDA *runtime* (via torch's bundled libs) but no
``nvcc``/CUDA toolkit, so the build fails. Installing a ~3 GB CUDA toolkit just
to compile marching cubes isn't worth it.

TripoSR only needs ``marching_cubes(level, isovalue) -> (verts, faces)``
(see ``tsr/models/isosurface.py``). PyMCubes provides exactly that and ships a
manylinux wheel — no compiler required. This module is installed into the venv
as ``torchmcubes`` so ``from torchmcubes import marching_cubes`` resolves here
and TripoSR is left untouched.

Coordinate convention
----------------------
PyMCubes returns vertices in array-index order ``(i, j, k)`` for ``vol[i,j,k]``.
The real torchmcubes returns ``(x, y, z) = (k, j, i)``. TripoSR applies a
``[2, 1, 0]`` swap downstream, so we reverse here to match torchmcubes exactly
and keep the output geometry correct (not mirrored).
"""

from __future__ import annotations

import mcubes
import numpy as np
import torch


def marching_cubes(vol, isovalue: float = 0.0):
    arr = vol.detach().cpu().numpy().astype(np.float64)
    verts, faces = mcubes.marching_cubes(arr, float(isovalue))
    verts = verts[:, [2, 1, 0]]  # (i,j,k) -> (k,j,i), matching torchmcubes
    v = torch.from_numpy(np.ascontiguousarray(verts)).float()
    f = torch.from_numpy(np.ascontiguousarray(faces)).long()
    return v, f
