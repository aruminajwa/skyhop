"""Rasterizer kecil untuk memverifikasi tampilan scene Obby Parkour.
Membaca tools/scene.json (dari dump-scene.js) lalu menulis PNG.
Jalankan: python tools/render-preview.py
"""
import json, math, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, "scene.json")))

P = np.array(data["pos"], dtype=np.float32).reshape(-1, 3)
NRM = np.array(data["nor"], dtype=np.float32).reshape(-1, 3)
COL = np.array(data["col"], dtype=np.float32).reshape(-1, 3)
IDX = np.array(data["idx"], dtype=np.int32).reshape(-1, 3)
FOG = np.array(data["fog"], dtype=np.float32)
LIGHT = np.array(data["light"], dtype=np.float32)
FOG_NEAR, FOG_FAR = data["fogNear"], data["fogFar"]
CAMPOS = np.array(data["camPos"], dtype=np.float32)

W, H = 1100, 620


def perspective(fovy, aspect, near, far):
    f = 1.0 / math.tan(fovy / 2)
    m = np.zeros((4, 4), dtype=np.float32)
    m[0, 0] = f / aspect
    m[1, 1] = f
    m[2, 2] = (far + near) / (near - far)
    m[2, 3] = (2 * far * near) / (near - far)
    m[3, 2] = -1
    return m


def look_at(eye, center, up):
    eye = np.array(eye, dtype=np.float32)
    center = np.array(center, dtype=np.float32)
    up = np.array(up, dtype=np.float32)
    z = eye - center
    z /= np.linalg.norm(z)
    x = np.cross(up, z)
    x /= np.linalg.norm(x) + 1e-9
    y = np.cross(z, x)
    m = np.eye(4, dtype=np.float32)
    m[0, :3] = x
    m[1, :3] = y
    m[2, :3] = z
    m[:3, 3] = -m[:3, :3] @ eye
    return m


def render(vp, cam, path, label):
    ones = np.ones((len(P), 1), dtype=np.float32)
    clip = np.hstack([P, ones]) @ vp.T
    w = clip[:, 3]
    safe = np.where(np.abs(w) < 1e-4, 1e-4, w)
    ndc = clip[:, :3] / safe[:, None]
    sx = (ndc[:, 0] * 0.5 + 0.5) * W
    sy = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * H
    sz = ndc[:, 2]

    img = np.zeros((H, W, 3), dtype=np.float32)
    # langit gradien
    t = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    top = np.array([0.245, 0.545, 0.905], dtype=np.float32)
    mid = np.array([0.545, 0.792, 0.973], dtype=np.float32)
    hor = np.array([0.855, 0.941, 0.996], dtype=np.float32)
    sky = np.where(t < 0.42, hor + (mid - hor) * (t / 0.42), mid + (top - mid) * ((t - 0.42) / 0.58))
    img[:] = sky[:, None, :]

    zbuf = np.ones((H, W), dtype=np.float32)
    dist = np.linalg.norm(P - cam[None, :], axis=1)

    for tri in IDX:
        i0, i1, i2 = int(tri[0]), int(tri[1]), int(tri[2])
        if w[i0] <= 0.05 or w[i1] <= 0.05 or w[i2] <= 0.05:
            continue
        x0, y0, z0 = sx[i0], sy[i0], sz[i0]
        x1, y1, z1 = sx[i1], sy[i1], sz[i1]
        x2, y2, z2 = sx[i2], sy[i2], sz[i2]
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if abs(area) < 1e-7:
            continue
        minx = max(0, int(math.floor(min(x0, x1, x2))))
        maxx = min(W - 1, int(math.ceil(max(x0, x1, x2))))
        miny = max(0, int(math.floor(min(y0, y1, y2))))
        maxy = min(H - 1, int(math.ceil(max(y0, y1, y2))))
        if minx > maxx or miny > maxy:
            continue
        xs, ys = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
        b0 = ((x1 - xs) * (y2 - ys) - (x2 - xs) * (y1 - ys)) / area
        b1 = ((x2 - xs) * (y0 - ys) - (x0 - xs) * (y2 - ys)) / area
        b2 = 1.0 - b0 - b1
        mask = (b0 >= -1e-6) & (b1 >= -1e-6) & (b2 >= -1e-6)
        if not mask.any():
            continue
        z = b0 * z0 + b1 * z1 + b2 * z2
        sub = zbuf[miny:maxy + 1, minx:maxx + 1]
        better = mask & (z < sub)
        if not better.any():
            continue

        n = NRM[i0] + NRM[i1] + NRM[i2]
        ln = np.linalg.norm(n)
        n = n / ln if ln > 1e-6 else np.array([0, 1, 0], dtype=np.float32)
        diff = max(0.0, float(np.dot(n, LIGHT)))
        skyb = max(0.0, float(n[1])) * 0.11
        base = (COL[i0] + COL[i1] + COL[i2]) / 3.0
        lit = base * (0.58 + 0.42 * diff + skyb)
        d = float(dist[i0] + dist[i1] + dist[i2]) / 3.0
        fo = min(1.0, max(0.0, (d - FOG_NEAR) / (FOG_FAR - FOG_NEAR)))
        fo = fo * fo * (3 - 2 * fo) * 0.92
        color = lit * (1 - fo) + FOG * fo

        sub[better] = z[better]
        img[miny:maxy + 1, minx:maxx + 1][better] = color

    out = np.clip(img, 0, 1) ** (1 / 1.0)
    Image.fromarray((out * 255).astype(np.uint8)).save(path)
    print(path, label, "tris drawn")


vp_game = np.array(data["vp"], dtype=np.float32).reshape(4, 4).T
render(vp_game, CAMPOS, os.path.join(HERE, "preview-game.png"), "gameplay")

# tampilan overview
eye = (-26.0, 34.0, -14.0)
target = (0.0, 6.0, 34.0)
vp2 = perspective(math.radians(58), W / H, 0.1, 900) @ look_at(eye, target, (0, 1, 0))
render(vp2, np.array(eye, dtype=np.float32), os.path.join(HERE, "preview-overview.png"), "overview")

# tampilan depan karakter
eye5 = (1.6, 3.0, 8.0)
target5 = (0.0, 1.3, 0.0)
vp5 = perspective(math.radians(48), W / H, 0.1, 900) @ look_at(eye5, target5, (0, 1, 0))
render(vp5, np.array(eye5, dtype=np.float32), os.path.join(HERE, 'preview-hero.png'), 'hero')

# tampilan tengah course (dari platform kecil)
eye4 = (14.0, 10.0, 6.0)
target4 = (0.0, 2.0, 24.0)
vp4 = perspective(math.radians(62), W / H, 0.1, 900) @ look_at(eye4, target4, (0, 1, 0))
render(vp4, np.array(eye4, dtype=np.float32), os.path.join(HERE, 'preview-mid.png'), 'mid')

# tampilan jauh (zona 4)
eye3 = (16.0, 26.0, 150.0)
target3 = (0.0, 12.0, 180.0)
vp3 = perspective(math.radians(58), W / H, 0.1, 900) @ look_at(eye3, target3, (0, 1, 0))
render(vp3, np.array(eye3, dtype=np.float32), os.path.join(HERE, "preview-zone4.png"), "zone4")
