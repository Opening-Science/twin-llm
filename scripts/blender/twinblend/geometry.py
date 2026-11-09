"""Plain numpy geometry for the atlas fit. No bpy, no randomness.

Coordinates are Blender world space after the glTF import: metres, +Z up,
the subject faces -Y, +X is the subject's left.
"""
from __future__ import annotations

import numpy as np


def pca(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Centroid, principal axes (rows, largest spread first) and their standard deviations."""
    centroid = points.mean(axis=0)
    centred = points - centroid
    cov = centred.T @ centred / max(len(points), 1)
    values, vectors = np.linalg.eigh(cov)
    order = np.argsort(values)[::-1]
    axes = vectors[:, order].T
    # Fix the sign so the result does not depend on the solver: first axis points up.
    signs = np.where(axes[:, 2] < 0, -1.0, 1.0)
    return centroid, axes * signs[:, None], np.sqrt(np.clip(values[order], 0, None))


def band_centroid(points: np.ndarray, axis: int, end: str, depth: float) -> np.ndarray:
    """Mean of the points within `depth` of the lowest ("min") or highest ("max") value on `axis`."""
    values = points[:, axis]
    if end == "min":
        mask = values <= values.min() + depth
    else:
        mask = values >= values.max() - depth
    return points[mask].mean(axis=0)


def fit_sphere(points: np.ndarray) -> tuple[np.ndarray, float]:
    """Least-squares sphere through the points: |p|^2 = 2 c.p + (r^2 - |c|^2)."""
    a = np.hstack([2 * points, np.ones((len(points), 1))])
    b = (points**2).sum(axis=1)
    solution, *_ = np.linalg.lstsq(a, b, rcond=None)
    centre = solution[:3]
    radius = float(np.sqrt(max(solution[3] + centre @ centre, 0.0)))
    return centre, radius


def rotation_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """The smallest rotation (3x3) taking direction a onto direction b (no twist about b)."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(a @ b)
    s = float(np.linalg.norm(v))
    if s < 1e-12:
        if c > 0:
            return np.eye(3)
        # Opposite: turn half a circle about any axis perpendicular to a.
        perp = np.cross(a, [1.0, 0.0, 0.0])
        if np.linalg.norm(perp) < 1e-6:
            perp = np.cross(a, [0.0, 1.0, 0.0])
        perp /= np.linalg.norm(perp)
        return 2 * np.outer(perp, perp) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / (s * s))


def translation(offset: np.ndarray) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = offset
    return m


def linear(m3: np.ndarray) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = m3
    return m


def segment_deform(
    head: np.ndarray, tail: np.ndarray, new_head: np.ndarray, new_tail: np.ndarray, stretch: bool
) -> tuple[np.ndarray, float]:
    """
    The 4x4 map that takes the segment head→tail onto new_head→new_tail: the
    smallest rotation, and, with `stretch`, a scale along the segment's own
    axis only (its thickness is kept). Returns the matrix and the stretch.
    """
    old = tail - head
    new = new_tail - new_head
    factor = float(np.linalg.norm(new) / np.linalg.norm(old)) if stretch else 1.0
    d = old / np.linalg.norm(old)
    scale_along = np.eye(3) + (factor - 1.0) * np.outer(d, d)
    m = (
        translation(new_head)
        @ linear(rotation_between(old, new))
        @ linear(scale_along)
        @ translation(-head)
    )
    return m, factor


def transform_points(m: np.ndarray, points: np.ndarray) -> np.ndarray:
    return points @ m[:3, :3].T + m[:3, 3]


def softmin_weights(distances: np.ndarray, tau: float) -> np.ndarray:
    """Rows of weights summing to 1, the nearest column strongest; `tau` sets the blend width."""
    shifted = distances - distances.min(axis=1, keepdims=True)
    raw = np.exp(-shifted / tau)
    return raw / raw.sum(axis=1, keepdims=True)


def quantise_weights(weights: np.ndarray, steps: int = 1000) -> np.ndarray:
    """Weights on a fixed grid, so vertex groups are written in few calls and bytes repeat."""
    return np.round(weights * steps) / steps


def taubin_smooth(points: np.ndarray, edges: np.ndarray, passes: int, lam: float = 0.5, mu: float = -0.53) -> np.ndarray:
    """
    Taubin smoothing: a shrinking step (lam) and an inflating one (mu) per
    pass, on the uniform Laplacian over `edges` (m, 2). It removes noise
    without the shrinkage of plain Laplacian smoothing.
    """
    degree = np.bincount(edges.ravel(), minlength=len(points)).astype(np.float64)
    degree[degree == 0] = 1.0

    def laplacian(p: np.ndarray) -> np.ndarray:
        total = np.zeros_like(p)
        np.add.at(total, edges[:, 0], p[edges[:, 1]])
        np.add.at(total, edges[:, 1], p[edges[:, 0]])
        return total / degree[:, None] - p

    out = points.astype(np.float64).copy()
    for _ in range(passes):
        out = out + lam * laplacian(out)
        out = out + mu * laplacian(out)
    return out


def diffuse(values: np.ndarray, edges: np.ndarray, passes: int, rate: float = 0.5) -> np.ndarray:
    """
    Smooths a per-vertex field over the mesh: each pass moves every value
    `rate` of the way to its neighbours' mean. Rows that summed to 1 still do.
    """
    degree = np.bincount(edges.ravel(), minlength=len(values)).astype(np.float64)
    lonely = degree == 0
    degree[lonely] = 1.0
    out = values.astype(np.float64).copy()
    for _ in range(passes):
        total = np.zeros_like(out)
        np.add.at(total, edges[:, 0], out[edges[:, 1]])
        np.add.at(total, edges[:, 1], out[edges[:, 0]])
        mean = total / degree[:, None]
        mean[lonely] = out[lonely]
        out = out + rate * (mean - out)
    return out


def self_check() -> list[str]:
    """Checks on exact synthetic values; returns failures (empty when all pass)."""
    failures: list[str] = []
    rng = np.random.default_rng(7)
    # Sphere fit on a cap of a known sphere.
    centre = np.array([0.1, -0.2, 0.9])
    directions = rng.normal(size=(400, 3))
    directions /= np.linalg.norm(directions, axis=1, keepdims=True)
    cap = directions[directions[:, 0] < -0.2]
    fitted, radius = fit_sphere(centre + 0.024 * cap)
    if np.linalg.norm(fitted - centre) > 1e-9 or abs(radius - 0.024) > 1e-9:
        failures.append(f"fit_sphere: centre {fitted} radius {radius}")
    # A rotation carries a onto b and is orthonormal.
    a, b = np.array([0.0, 0.0, -1.0]), np.array([0.2, 0.1, -1.0])
    r = rotation_between(a, b)
    if np.linalg.norm(r @ a - b / np.linalg.norm(b)) > 1e-12 or abs(np.linalg.det(r) - 1) > 1e-12:
        failures.append("rotation_between")
    # A segment lands on its target, stretched along its axis.
    m, k = segment_deform(
        np.array([0.1, 0, 1.0]), np.array([0.1, 0, 0.5]), np.array([0.1, 0, 1.0]), np.array([0.15, 0.0, 0.45]), True
    )
    end = transform_points(m, np.array([[0.1, 0, 0.5]]))[0]
    if np.linalg.norm(end - [0.15, 0.0, 0.45]) > 1e-12 or abs(k - np.hypot(0.05, 0.55) / 0.5) > 1e-12:
        failures.append(f"segment_deform: end {end} stretch {k}")
    # Taubin keeps a straight line straight and pulls a bump back toward it.
    line = np.array([[0.0, 0, 0], [1, 0, 0], [2, 0.3, 0], [3, 0, 0], [4, 0, 0]])
    smoothed = taubin_smooth(line, np.array([[0, 1], [1, 2], [2, 3], [3, 4]]), 3)
    if not (0 < smoothed[2, 1] < 0.3) or abs(smoothed[2, 0] - 2) > 1e-9:
        failures.append(f"taubin_smooth: {smoothed[2]}")
    field = diffuse(np.array([[1.0, 0.0], [0.0, 1.0], [0.0, 1.0]]), np.array([[0, 1], [1, 2]]), 2)
    if np.abs(field.sum(axis=1) - 1).max() > 1e-12 or not field[0, 0] < 1.0:
        failures.append(f"diffuse: {field}")
    w = softmin_weights(np.array([[0.0, 0.0], [0.0, 1.0]]), 0.01)
    if abs(w[0, 0] - 0.5) > 1e-12 or w[1, 0] < 0.999:
        failures.append("softmin_weights")
    return failures
