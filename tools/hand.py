"""Build the musician's hand from anatomy and trace it as line art.

The hand is a skeleton of tapered capsules (palm, three bones per finger, thumb) seen from the thumb side,
index finger extended to press a button. Each part's outline is traced from a signed distance field and
kept only where no nearer part covers it, so overlapping fingers read correctly.

Usage: python tools/hand.py [--preview out/hand.png]
Writes assets/brand/hand.json: polylines in drawing order (fingertip at the origin, finger pointing +y).
"""
import argparse
import json
import math
import pathlib

import numpy as np
from contourpy import contour_generator

ROOT = pathlib.Path(__file__).resolve().parent.parent


def chain(start, angles_deg, lengths, radii):
    """Bones as capsules: start point, absolute angles (0 = pointing down +y, positive = toward -x)."""
    pts, caps = [np.array(start, float)], []
    for a, L, (r0, r1) in zip(angles_deg, lengths, radii):
        t = math.radians(a)
        p = pts[-1] + L * np.array([-math.sin(t), math.cos(t)])
        caps.append((pts[-1].copy(), p.copy(), r0, r1))
        pts.append(p)
    return caps, pts[-1]


def sd_capsule(X, Y, a, b, ra, rb):
    pa = np.stack([X - a[0], Y - a[1]], -1)
    ba = b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
    d = np.linalg.norm(pa - h[..., None] * ba, axis=-1)
    return d - (ra + (rb - ra) * h)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def part_sdf(X, Y, caps, k=6.0):
    d = None
    for c in caps:
        e = sd_capsule(X, Y, *c)
        d = e if d is None else smin(d, e, k)
    return d


def build():
    # units: mm. Wrist at the top, hand pointing down. Thumb side faces the viewer; palm toward -x.
    parts = {}
    parts["palm"] = [
        (np.array([12.0, -75]), np.array([5.0, 0]), 25, 23.5),    # forearm into wrist
        (np.array([5.0, 0]), np.array([0.0, 74]), 23.5, 20.5),    # palm
    ]
    idx, tip = chain([-3.0, 82], [3, 7, 11], [46, 27, 22], [(10.6, 9.6), (9.6, 8.7), (8.7, 7.6)])
    parts["index"] = idx
    for name, base, s_, rr in (("middle", [3.0, 86], 1.0, 1.0), ("ring", [9.0, 83], 0.95, 0.96), ("little", [15.0, 77], 0.82, 0.9)):
        c, _ = chain(base, [72, 172, 252], [44 * s_, 27 * s_, 19 * s_], [(10.0 * rr, 9.2 * rr), (9.2 * rr, 8.4 * rr), (8.4 * rr, 7.6 * rr)])
        parts[name] = c
    th, _ = chain([-12.0, 30], [12, 20, 30], [30, 25, 20], [(13.0, 11.4), (11.4, 10.0), (10.0, 8.6)])
    parts["thumb"] = th
    order = ["thumb", "index", "palm", "middle", "ring", "little"]
    return parts, order, tip


def trace(parts, order, tip, res=0.25):
    xs = np.arange(-100, 70, res)
    ys = np.arange(-85, 200, res)
    X, Y = np.meshgrid(xs, ys)
    sdf = {k: part_sdf(X, Y, parts[k], 3.0) for k in order}
    U = None
    for k in order:
        U = sdf[k] if U is None else smin(U, sdf[k], 5.0)
    lines = []

    def runs_of(line, keep):
        out, cur = [], []
        for p, v in zip(line, keep):
            if v:
                cur.append(p)
            elif cur:
                out.append(np.array(cur)); cur = []
        if cur:
            out.append(np.array(cur))
        return [r for r in out if len(r) > 24]

    def at(d, line):
        ix = np.clip(((line[:, 0] - xs[0]) / res).astype(int), 0, len(xs) - 1)
        iy = np.clip(((line[:, 1] - ys[0]) / res).astype(int), 0, len(ys) - 1)
        return d[iy, ix]

    # 1) the outer silhouette: one smooth line
    for line in contour_generator(xs, ys, U).lines(0.0):
        for r in runs_of(line, line[:, 1] > -70):
            lines.append(("outline", r))
    # 2) inner edges: where a part overlaps another finger (not where it grows out of the palm)
    fingers = ["middle", "ring", "little"]
    for i, k in enumerate(order):
        nearer = order[:i]
        for line in contour_generator(xs, ys, sdf[k]).lines(0.0):
            keep = at(U, line) < -1.5  # inside the silhouette
            for o in nearer:
                keep &= at(sdf[o], line) > 1.0  # not hidden
            if k == "thumb":
                base = parts["thumb"][0][0]
                keep &= np.linalg.norm(line - base, axis=1) > 16  # thumb flows out of the palm
            elif k == "index":
                keep &= at(sdf["palm"], line) > 2.0
            elif k in fingers:
                keep &= at(sdf["palm"], line) > 2.0
                keep &= at(sdf["index"], line) > 1.0
            elif k == "palm":
                keep &= np.zeros(len(line), bool)
            for r in runs_of(line, keep):
                lines.append((k, r))
    def bone_frame(cap, u):
        a, b, ra, rb = cap
        d = (b - a) / np.linalg.norm(b - a)
        n = np.array([d[1], -d[0]])  # +n points to the back of the hand (+x side when pointing down)
        return a + (b - a) * u, d, n, ra + (rb - ra) * u

    def arc(c, d, n, r, a0, a1, k=24):
        return np.array([c + r * (np.cos(t) * n + np.sin(t) * d) for t in np.linspace(a0, a1, k)])

    # fingernail: on the back of the finger, near the tip
    for name in ("index", "thumb"):
        cap = parts[name][-1]
        c, d, n, r = bone_frame(cap, 0.55)
        L = np.linalg.norm(cap[1] - cap[0])
        side = n if name == "index" else -n
        base = c + side * r * 0.45
        nail = np.array([base + side * r * 0.42 * np.sin(t) + d * (L * 0.42) * (np.cos(t) * 0.5 + 0.35) for t in np.linspace(0.15, np.pi - 0.15, 20)])
        lines.append((name + "-nail", nail))
    # knuckle creases: short curved strokes across the back of each joint of the extended finger
    for name, joints in (("index", (1, 2)),):
        for j in joints:
            cap = parts[name][j]
            c, d, n, r = bone_frame(cap, 0.0)
            for off in (-0.9, 0.9):
                cc = c + d * off
                lines.append((name + "-crease", arc(cc - n * r * 0.15, d, n, r * 0.85, -0.55, 0.55, 10)))
    # knuckles of the curled fingers: little rounded marks where they fold
    for name in ("middle", "ring", "little"):
        cap = parts[name][1]
        c, d, n, r = bone_frame(cap, 0.08)
        lines.append((name + "-knuckle", arc(c, d, n, r * 0.7, 2.3, 3.6, 10)))
    return [(k, r - tip) for k, r in lines]


def simplify(p, step=1.2):
    out = [p[0]]
    for q in p[1:]:
        if np.linalg.norm(q - out[-1]) >= step:
            out.append(q)
    if np.linalg.norm(p[-1] - out[-1]) > 0:
        out.append(p[-1])
    return np.array(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview")
    a = ap.parse_args()
    parts, order, tip = build()
    lines = trace(parts, order, tip)
    # drawing order: the long outer silhouette first, then inner lines, longest first
    lines.sort(key=lambda kl: -len(kl[1]))
    out = [dict(part=k, pts=[[round(float(x), 2), round(float(y), 2)] for x, y in simplify(p)]) for k, p in lines]
    dst = ROOT / "assets" / "brand" / "hand.json"
    dst.write_text(json.dumps(dict(units="mm", tip=[0, 0], lines=out)))
    print(f"{len(out)} lines -> {dst.relative_to(ROOT)}")
    if a.preview:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig = plt.figure(figsize=(7, 11), facecolor="#05070b")
        ax = fig.add_axes([0, 0, 1, 1]); ax.set_facecolor("#05070b")
        for l in out:
            p = np.array(l["pts"]); ax.plot(p[:, 0], p[:, 1], color="#cfe0ff", lw=2.0 if l["part"] == "outline" else 1.4)
        ax.set_aspect("equal"); ax.invert_yaxis(); ax.axis("off")
        plt.savefig(a.preview, dpi=90, facecolor="#05070b")


if __name__ == "__main__":
    main()
