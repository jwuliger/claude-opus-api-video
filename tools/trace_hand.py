"""Turn a line-drawing reference of a pointing hand into the film's own line art.

The reference only guides proportions: dark lines are thinned to centre lines, split into strokes,
and each stroke is redrawn as a smooth spline. The result is re-oriented so the finger points down
(tip at the origin) and written to assets/brand/hand.json in design pixels.

Usage: python tools/trace_hand.py <reference.png|jpg> [--preview out/hand.png] [--length 600]
The reference image is not stored in the repository.
"""
import argparse
import json
import pathlib

import numpy as np
from scipy.interpolate import splev, splprep
from skimage import io, morphology
from skimage.color import rgb2gray

ROOT = pathlib.Path(__file__).resolve().parent.parent
NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def skeleton_paths(sk):
    """Split a 1-px skeleton into pixel chains between endpoints/junctions."""
    H, W = sk.shape
    pts = set(zip(*np.nonzero(sk)))

    def nbrs(p):
        return [(p[0] + dy, p[1] + dx) for dy, dx in NB if (p[0] + dy, p[1] + dx) in pts]

    deg = {p: len(nbrs(p)) for p in pts}
    nodes = {p for p, d in deg.items() if d != 2}
    used = set()
    paths = []
    for n in nodes:
        for q in nbrs(n):
            if (n, q) in used:
                continue
            path = [n, q]
            used.add((n, q)); used.add((q, n))
            prev, cur = n, q
            while cur not in nodes:
                nxt = [r for r in nbrs(cur) if r != prev and (cur, r) not in used]
                if not nxt:
                    break
                r = nxt[0]
                used.add((cur, r)); used.add((r, cur))
                path.append(r)
                prev, cur = cur, r
            paths.append(path)
    # closed loops with no nodes
    rest = pts - {p for path in paths for p in path}
    while rest:
        start = rest.pop()
        path, cur, prev = [start], start, None
        while True:
            nxt = [r for r in nbrs(cur) if r != prev and r in rest]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            rest.discard(cur)
            path.append(cur)
        paths.append(path)
    return [np.array([[c, r] for r, c in p], float) for p in paths]


def join_paths(paths, gap=6.0, angle=0.6):
    """Merge chains that continue each other through junction pixels (keeps long, flowing strokes)."""
    paths = [p for p in paths if len(p) > 2]
    merged = True
    while merged:
        merged = False
        for i in range(len(paths)):
            for j in range(len(paths)):
                if i == j:
                    continue
                a, b = paths[i], paths[j]
                for ra in (False, True):
                    for rb in (False, True):
                        A = a[::-1] if ra else a
                        B = b[::-1] if rb else b
                        if np.linalg.norm(A[-1] - B[0]) > gap or len(A) < 6 or len(B) < 6:
                            continue
                        da = A[-1] - A[-6]; db = B[5] - B[0]
                        c = da @ db / (np.linalg.norm(da) * np.linalg.norm(db) + 1e-9)
                        if c > angle:
                            paths[i] = np.vstack([A, B[1:]])
                            paths.pop(j)
                            merged = True
                            break
                    if merged: break
                if merged: break
            if merged: break
    return paths


def smooth(p, step=4.0, s_per_pt=1.6):
    if len(p) < 6:
        return p
    _, idx = np.unique(p, axis=0, return_index=True)
    p = p[np.sort(idx)]
    k = 3 if len(p) > 6 else 1
    tck, u = splprep([p[:, 0], p[:, 1]], s=len(p) * s_per_pt, k=k)
    L = np.sum(np.linalg.norm(np.diff(p, axis=0), axis=1))
    n = max(4, int(L / step))
    x, y = splev(np.linspace(0, 1, n), tck)
    return np.stack([x, y], 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--preview")
    ap.add_argument("--length", type=float, default=620, help="tip-to-wrist length in design px")
    ap.add_argument("--min", type=float, default=40, help="drop strokes shorter than this (source px)")
    a = ap.parse_args()

    img = io.imread(a.image)
    g = rgb2gray(img[..., :3]) if img.ndim == 3 else img / 255.0
    ink = g < 0.55
    ink = morphology.remove_small_objects(ink, 30)
    sk = morphology.skeletonize(ink)
    paths = join_paths(skeleton_paths(sk))
    strokes = []
    for p in paths:
        L = np.sum(np.linalg.norm(np.diff(p, axis=0), axis=1))
        if L >= a.min:
            strokes.append(smooth(p))
    # drop the short horizontal "motion" dashes on the forearm (straight, isolated, left of the wrist)
    allp = np.vstack(strokes)
    xmin, xmax = allp[:, 0].min(), allp[:, 0].max()
    keep = []
    for s in strokes:
        straight = np.ptp(s[:, 1]) < 14 and np.ptp(s[:, 0]) > 60
        if straight and s[:, 0].max() < xmin + 0.33 * (xmax - xmin) and s[:, 0].min() > xmin + 40:
            continue
        keep.append(s)
    strokes = keep
    # orientation: finger tip = the point furthest along the pointing direction (+x in the reference)
    allp = np.vstack(strokes)
    tip = allp[np.argmax(allp[:, 0])]
    span = tip[0] - allp[:, 0].min()
    scale = a.length / span
    out = []
    for s in strokes:
        q = (s - tip) * scale
        q = np.stack([-q[:, 1], q[:, 0]], 1)  # rotate +90 deg: pointing +x -> pointing +y (down)
        out.append(q)
    # draw order: the long outer contour first, then details from the wrist toward the finger
    out.sort(key=lambda q: -np.sum(np.linalg.norm(np.diff(q, axis=0), axis=1)))
    head, rest = out[:2], out[2:]
    rest.sort(key=lambda q: q[:, 1].mean())
    out = head + rest
    data = dict(units="design px", tip=[0, 0], lines=[dict(pts=[[round(float(x), 1), round(float(y), 1)] for x, y in q]) for q in out])
    dst = ROOT / "assets" / "brand" / "hand.json"
    dst.write_text(json.dumps(data))
    print(f"{len(out)} strokes -> {dst.relative_to(ROOT)}")
    if a.preview:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig = plt.figure(figsize=(6, 9), facecolor="#05070b")
        ax = fig.add_axes([0, 0, 1, 1]); ax.set_facecolor("#05070b")
        for q in out:
            ax.plot(q[:, 0], q[:, 1], color="#cfe0ff", lw=1.6)
        ax.set_aspect("equal"); ax.invert_yaxis(); ax.axis("off")
        plt.savefig(a.preview, dpi=90, facecolor="#05070b")


if __name__ == "__main__":
    main()
