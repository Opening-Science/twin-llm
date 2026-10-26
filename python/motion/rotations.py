"""Small rotation helpers on numpy arrays: 3x3 matrices and (x, y, z, w) quaternions.

Pure functions with no state. Vectors are in the body frame of
``features/digital-twin/motion/gait.ts``: x to the subject's left, y up, z forward.
"""

from __future__ import annotations

import numpy as np

EPS = 1e-9


def normalize(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > EPS else v * 0.0


def perpendicular(v: np.ndarray, axis: np.ndarray) -> np.ndarray:
    """``v`` without its component along the unit vector ``axis``, normalised."""
    return normalize(v - axis * float(np.dot(v, axis)))


def angle_between(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.arccos(np.clip(np.dot(normalize(a), normalize(b)), -1.0, 1.0)))


def axis_angle(axis: np.ndarray, angle: float) -> np.ndarray:
    """Rodrigues: the rotation by ``angle`` radians about ``axis``."""
    k = normalize(axis)
    if not np.any(k):
        return np.eye(3)
    kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(angle) * kx + (1 - np.cos(angle)) * (kx @ kx)


def swing(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """The smallest rotation taking direction ``a`` onto direction ``b``."""
    ua, ub = normalize(a), normalize(b)
    axis = np.cross(ua, ub)
    s = float(np.linalg.norm(axis))
    c = float(np.dot(ua, ub))
    if s < 1e-8:
        if c > 0:
            return np.eye(3)
        # Opposite: any axis perpendicular to a.
        other = np.array([1.0, 0, 0]) if abs(ua[0]) < 0.9 else np.array([0, 1.0, 0])
        return axis_angle(np.cross(ua, other), np.pi)
    return axis_angle(axis, float(np.arctan2(s, c)))


def frame(primary: np.ndarray, secondary: np.ndarray) -> np.ndarray:
    """An orthonormal basis (columns) with ``primary`` first and ``secondary``
    made perpendicular to it second; the third completes a right-handed set."""
    p = normalize(primary)
    s = perpendicular(secondary, p)
    return np.column_stack([p, s, np.cross(p, s)])


def basis_left_up(left: np.ndarray, up: np.ndarray) -> np.ndarray:
    """The rotation whose columns are (left, up, forward), keeping ``left`` exact."""
    lft = normalize(left)
    upv = perpendicular(up, lft)
    return np.column_stack([lft, upv, np.cross(lft, upv)])


def basis_up_left(up: np.ndarray, left: np.ndarray) -> np.ndarray:
    """The rotation whose columns are (left, up, forward), keeping ``up`` exact."""
    upv = normalize(up)
    lft = perpendicular(left, upv)
    return np.column_stack([lft, upv, np.cross(lft, upv)])


def quat_from_matrix(m: np.ndarray) -> np.ndarray:
    """(x, y, z, w) with w >= 0."""
    t = float(np.trace(m))
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = np.array(
            [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
        )
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = np.array(
            [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
        )
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = np.array(
            [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
        )
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = np.array(
            [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
        )
    q = q / np.linalg.norm(q)
    return -q if q[3] < 0 else q


def matrix_from_quat(q: np.ndarray) -> np.ndarray:
    x, y, z, w = normalize(np.asarray(q, dtype=float))
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def slerp(a: np.ndarray, b: np.ndarray, u: float) -> np.ndarray:
    """Spherical interpolation between unit quaternions, the short way round."""
    qa, qb = normalize(a), normalize(b)
    d = float(np.dot(qa, qb))
    if d < 0:
        qb, d = -qb, -d
    if d > 0.9995:
        return normalize(qa + u * (qb - qa))
    theta = np.arccos(d)
    return (np.sin((1 - u) * theta) * qa + np.sin(u * theta) * qb) / np.sin(theta)


def blend_rotation(a: np.ndarray, b: np.ndarray, u: float) -> np.ndarray:
    """Matrices ``a`` to ``b`` by ``u``, through their quaternions."""
    return matrix_from_quat(slerp(quat_from_matrix(a), quat_from_matrix(b), u))


def fraction_of(m: np.ndarray, u: float) -> np.ndarray:
    """The rotation ``m`` scaled to ``u`` of its angle (same axis)."""
    return blend_rotation(np.eye(3), m, u)


def swing_twist(m: np.ndarray, axis: np.ndarray) -> tuple[np.ndarray, float]:
    """Splits rotation ``m`` into m = swing @ twist, the twist being about
    ``axis``; returns the swing matrix and the twist angle in radians."""
    q = quat_from_matrix(m)
    a = normalize(axis)
    twist_q = np.array([*(a * float(np.dot(q[:3], a))), q[3]])
    if np.linalg.norm(twist_q) < 1e-9:
        return m, 0.0
    twist_q = normalize(twist_q)
    angle = 2 * float(np.arctan2(np.dot(twist_q[:3], a), twist_q[3]))
    angle = (angle + np.pi) % (2 * np.pi) - np.pi
    return m @ axis_angle(a, angle).T, angle


def clamp_twist(m: np.ndarray, axis: np.ndarray, limit: float) -> np.ndarray:
    """``m`` with its twist about ``axis`` limited to ±``limit`` radians."""
    swung, angle = swing_twist(m, axis)
    return swung @ axis_angle(axis, float(np.clip(angle, -limit, limit)))


def clamp_angle(m: np.ndarray, limit: float) -> np.ndarray:
    """``m`` turned back along its own axis to at most ``limit`` radians."""
    q = quat_from_matrix(m)
    angle = 2 * float(np.arccos(np.clip(q[3], -1.0, 1.0)))
    return m if angle <= limit else fraction_of(m, limit / angle)


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
