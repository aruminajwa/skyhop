/* Membuang geometri scene + matriks kamera ke JSON supaya bisa
   dirender ulang oleh tools/render-preview.py (verifikasi visual). */
'use strict';
const fs = require('fs');
const path = require('path');
const { bootGame } = require('./mock');

const { ctx, step, errs } = bootGame('');
const G = ctx.__skyhop;
if (!G) { console.error('boot gagal', errs); process.exit(1); }

G.startRun();
step(45);

const S = G.SG;
const pos = S.pos.slice();
const nor = S.nor.slice();
const col = S.col.slice();
const idx = S.idx.slice();

/* dynamic boxes -> dunia */
const cube = {
  corners: [
    [-.5, -.5, -.5], [.5, -.5, -.5], [.5, .5, -.5], [-.5, .5, -.5],
    [-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5],
  ],
  faces: [
    { f: [1, 2, 6, 5], n: [1, 0, 0] },
    { f: [0, 4, 7, 3], n: [-1, 0, 0] },
    { f: [3, 7, 6, 2], n: [0, 1, 0] },
    { f: [0, 1, 5, 4], n: [0, -1, 0] },
    { f: [4, 5, 6, 7], n: [0, 0, 1] },
    { f: [1, 0, 3, 2], n: [0, 0, -1] },
  ],
};
const M = new Float32Array(16);
for (const b of G.dynBoxes) {
  if (!b.visible) continue;
  ctx.m4trs(M, b.x, b.y, b.z, b.rx, b.ry, b.rz, b.w, b.h, b.d);
  const base = pos.length / 3;
  const world = cube.corners.map(([x, y, z]) => [
    M[0] * x + M[4] * y + M[8] * z + M[12],
    M[1] * x + M[5] * y + M[9] * z + M[13],
    M[2] * x + M[6] * y + M[10] * z + M[14],
  ]);
  for (const face of cube.faces) {
    const n = [
      M[0] * face.n[0] + M[4] * face.n[1] + M[8] * face.n[2],
      M[1] * face.n[0] + M[5] * face.n[1] + M[9] * face.n[2],
      M[2] * face.n[0] + M[6] * face.n[1] + M[10] * face.n[2],
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const faceBase = pos.length / 3;
    for (const vi of face.f) {
      pos.push(world[vi][0], world[vi][1], world[vi][2]);
      nor.push(n[0] / len, n[1] / len, n[2] / len);
      col.push(b.c[0], b.c[1], b.c[2]);
    }
    idx.push(faceBase + 0, faceBase + 1, faceBase + 2, faceBase + 0, faceBase + 2, faceBase + 3);
  }
}

/* lava (hanya untuk preview; di game digambar lewat shader flat) */
{
  const tiles = 17, size = 48;
  const lavaBoxes = [];
  for (let ix = -8; ix <= 8; ix++) {
    for (let iz = -8; iz <= 8; iz++) {
      lavaBoxes.push({ x: ix * size, y: -6.1, z: iz * size, w: size, h: 0.2, d: size, c: [0.80, 0.185, 0.045] });
    }
  }
  for (const b of lavaBoxes) {
    ctx.m4trs(M, b.x, b.y, b.z, 0, 0, 0, b.w, b.h, b.d);
    const base = pos.length / 3;
    const world = cube.corners.map(([x, y, z]) => [
      M[0] * x + M[4] * y + M[8] * z + M[12],
      M[1] * x + M[5] * y + M[9] * z + M[13],
      M[2] * x + M[6] * y + M[10] * z + M[14],
    ]);
    for (const face of cube.faces) {
      if (face.n[1] !== 1) continue;
      const fb = pos.length / 3;
      for (const vi of face.f) {
        pos.push(world[vi][0], world[vi][1], world[vi][2]);
        nor.push(0, 1, 0);
        col.push(b.c[0], b.c[1], b.c[2]);
      }
      idx.push(fb, fb + 1, fb + 2, fb, fb + 2, fb + 3);
    }
  }
}
/* kamera: hitung VP sendiri dari state kamera (sama seperti render) */
const VPm = new Float32Array(16);
ctx.m4perspective(VPm, (G.CFG.fov * Math.PI) / 180, 1280 / 720, 0.1, 900);
const VIEW = new Float32Array(16);
ctx.m4lookAt(VIEW, G.cam.pos, G.cam.target, [0, 1, 0]);
const VPout = new Float32Array(16);
ctx.m4mult(VPout, VPm, VIEW);

const out = {
  vp: Array.from(VPout),
  camPos: Array.from(G.cam.pos),
  pos, nor, col, idx,
  player: { x: G.player.x, y: G.player.y, z: G.player.z },
  fog: [0.80, 0.91, 0.995],
  fogNear: 78, fogFar: 340,
  light: (() => { const l = [0.42, 0.86, 0.30], m = Math.hypot(...l); return [l[0] / m, l[1] / m, l[2] / m]; })(),
};
fs.writeFileSync(path.join(__dirname, 'scene.json'), JSON.stringify(out));
console.log('scene.json:', pos.length / 3, 'verts,', idx.length / 3, 'tris; cam=', out.camPos.map((v) => v.toFixed(1)).join(','));
if (errs.length) console.log(errs.slice(0, 3));
