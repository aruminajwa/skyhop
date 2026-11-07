'use strict';
/* =========================================================================
   SKYHOP  —  game murni WebGL, tanpa library eksternal.
   Bagian: 0 util · 1 math · 2 renderer · 3 level · 4 fisika · 5 input
           6 kamera · 7 efek · 8 audio · 9 UI/loop
   ========================================================================= */

/* ---------------------------------------------------------------- 0. util */
const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const fatalEl = $('fatal');
function showFatal(msg) {
  if (!fatalEl) return;
  fatalEl.style.display = 'block';
  fatalEl.textContent = String(msg).slice(0, 800);
}
window.addEventListener('error', (e) => showFatal('ERROR: ' + e.message));

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

const hexRGB = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const C = (h) => hexRGB(h);

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- 1. math */
const m4 = () => new Float32Array(16);
const m3 = () => new Float32Array(9);
const v3 = () => new Float32Array(3);

function m4identity(o) {
  o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
}
const IDENT4 = m4identity(m4());

function m4perspective(o, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
  o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
  return o;
}

function m4lookAt(o, eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz);
  if (l < 1e-6) { xx = 1; xy = 0; xz = 0; } else { xx /= l; xy /= l; xz /= l; }
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  o[15] = 1;
  return o;
}

function m4mult(o, a, b) { // o = a * b
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}

const ROT3 = m3();
function m4trs(o, tx, ty, tz, rx, ry, rz, sx, sy, sz) {
  const cx = Math.cos(rx), sxx = Math.sin(rx);
  const cy = Math.cos(ry), syy = Math.sin(ry);
  const cz = Math.cos(rz), szz = Math.sin(rz);
  // R = Ry * Rx * Rz
  const r00 = cy * cz + syy * sxx * szz;
  const r01 = -cy * szz + syy * sxx * cz;
  const r02 = syy * cx;
  const r10 = cx * szz;
  const r11 = cx * cz;
  const r12 = -sxx;
  const r20 = -syy * cz + cy * sxx * szz;
  const r21 = syy * szz + cy * sxx * cz;
  const r22 = cy * cx;

  o[0] = r00 * sx; o[1] = r10 * sx; o[2] = r20 * sx; o[3] = 0;
  o[4] = r01 * sy; o[5] = r11 * sy; o[6] = r21 * sy; o[7] = 0;
  o[8] = r02 * sz; o[9] = r12 * sz; o[10] = r22 * sz; o[11] = 0;
  o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1;

  ROT3[0] = r00; ROT3[1] = r10; ROT3[2] = r20;
  ROT3[3] = r01; ROT3[4] = r11; ROT3[5] = r21;
  ROT3[6] = r02; ROT3[7] = r12; ROT3[8] = r22;
  return o;
}

/* ------------------------------------------------------------ 2. renderer */
let gl = null;
try {
  gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' })
    || canvas.getContext('experimental-webgl');
} catch (e) { /* ignore */ }
if (!gl) showFatal('Browser ini belum mendukung WebGL. Coba Chrome / Edge / Firefox terbaru.');

const GLSL_FOG = `
  uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
`;

const VS_BLOCK = `
  attribute vec3 aPos;
  attribute vec3 aNormal;
  attribute vec3 aColor;
  attribute vec2 aUv;
  uniform mat4 uVP;
  uniform mat4 uModel;
  uniform mat3 uNMat;
  uniform vec3 uCamPos;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vec4 world = uModel * vec4(aPos, 1.0);
    vNormal = normalize(uNMat * aNormal);
    vColor  = aColor;
    vUv     = aUv;
    vDist   = length(world.xyz - uCamPos);
    gl_Position = uVP * world;
  }
`;

const FS_BLOCK = `
  precision mediump float;
  ${GLSL_FOG}
  uniform vec3 uLightDir;
  uniform vec3 uTint;
  uniform float uUseChecker;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vec3 base = vColor * uTint;
    if (uUseChecker > 0.5) {
      float chk = mod(floor(vUv.x) + floor(vUv.y), 2.0);
      base *= mix(0.90, 1.07, chk);
    }
    float diff = max(dot(normalize(vNormal), uLightDir), 0.0);
    float skyBounce = max(normalize(vNormal).y, 0.0) * 0.11;
    vec3 lit = base * (0.58 + 0.42 * diff + skyBounce);
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    vec3 col = mix(lit, uFogColor, fog * 0.92);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const VS_SKY = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.999, 1.0);
  }
`;

const FS_SKY = `
  precision mediump float;
  uniform vec2 uSun;
  varying vec2 vUv;
  void main() {
    vec3 top = vec3(0.245, 0.545, 0.905);
    vec3 mid = vec3(0.545, 0.792, 0.973);
    vec3 hor = vec3(0.855, 0.941, 0.996);
    float t = clamp(vUv.y, 0.0, 1.0);
    vec3 c = mix(hor, mid, smoothstep(0.0, 0.42, t));
    c = mix(c, top, smoothstep(0.42, 1.0, t));
    float d = length((vUv - uSun) * vec2(1.75, 1.0));
    c += vec3(1.0, 0.93, 0.74) * (1.0 - smoothstep(0.0, 0.62, d)) * 0.30;
    c += vec3(1.0, 0.97, 0.86) * (1.0 - smoothstep(0.0, 0.16, d)) * 0.55;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const VS_SPRITE = `
  attribute vec3 aPos;
  attribute vec4 aColor;
  attribute vec2 aCorner;
  attribute float aSize;
  attribute float aKind;
  uniform mat4 uVP;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uCamPos;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vKind;
  varying float vDist;
  void main() {
    vec3 wp = aPos + (uCamRight * aCorner.x + uCamUp * aCorner.y) * aSize * 0.5;
    vUv = aCorner * 0.5 + 0.5;
    vColor = aColor;
    vKind = aKind;
    vDist = length(aPos - uCamPos);
    gl_Position = uVP * vec4(wp, 1.0);
  }
`;

const FS_SPRITE = `
  precision mediump float;
  ${GLSL_FOG}
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vKind;
  varying float vDist;
  void main() {
    float a = vColor.a;
    if (vKind > 0.5) a *= 1.0 - smoothstep(0.08, 0.5, length(vUv - 0.5));
    if (a < 0.012) discard;
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    vec3 col = mix(vColor.rgb, uFogColor, fog * 0.65);
    gl_FragColor = vec4(col, a);
  }
`;

const VS_FLAT = `
  attribute vec3 aPos;
  attribute vec2 aUv;
  uniform mat4 uVP;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = aUv;
    vWorld = aPos;
    gl_Position = uVP * vec4(aPos, 1.0);
  }
`;

const FS_FLAT = `
  precision mediump float;
  ${GLSL_FOG}
  uniform vec4 uColor;
  uniform float uSoft;
  uniform vec3 uCamPos;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float a = uColor.a;
    if (uSoft > 0.5) a *= 1.0 - smoothstep(0.02, 0.5, length(vUv - 0.5));
    if (a < 0.008) discard;
    float fog = smoothstep(uFogNear, uFogFar, length(vWorld - uCamPos));
    gl_FragColor = vec4(mix(uColor.rgb, uFogColor, fog * 0.85), a);
  }
`;

let progBlock = null, progSky = null, progSprite = null, progFlat = null;

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader error:\n' + gl.getShaderInfoLog(s));
  }
  return s;
}

function makeProgram(vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  const u = {}, a = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    a[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { p, u, a };
}

function buildBuffers() {
  /* ---- kotak statis (satu batch besar) ---- */
  m4perspective(PROJ, CFG.fov * Math.PI / 180, 1, 0.1, 900);
  m4lookAt(VIEW, [0, 8, -20], [0, 4, 0], UP);
  m4mult(VP, PROJ, VIEW);

  progBlock = makeProgram(VS_BLOCK, FS_BLOCK);
  progSky = makeProgram(VS_SKY, FS_SKY);
  progSprite = makeProgram(VS_SPRITE, FS_SPRITE);
  progFlat = makeProgram(VS_FLAT, FS_FLAT);

  /* ---- geometri statis ---- */
  const pos = new Float32Array(SG.pos), nor = new Float32Array(SG.nor);
  const col = new Float32Array(SG.col), uv = new Float32Array(SG.uv);
  const idx = new Uint16Array(SG.idx);
  if (SG.count > 65000) showFatal('Terlalu banyak geometri statis: ' + SG.count);

  SB.pos = makeBuf(gl.ARRAY_BUFFER, pos);
  SB.nor = makeBuf(gl.ARRAY_BUFFER, nor);
  SB.col = makeBuf(gl.ARRAY_BUFFER, col);
  SB.uv = makeBuf(gl.ARRAY_BUFFER, uv);
  SB.idx = makeBuf(gl.ELEMENT_ARRAY_BUFFER, idx);
  SB.count = SG.idx.length;

  /* ---- unit cube dinamis ---- */
  const cube = buildUnitCube();
  CB.pos = makeBuf(gl.ARRAY_BUFFER, new Float32Array(cube.pos));
  CB.nor = makeBuf(gl.ARRAY_BUFFER, new Float32Array(cube.nor));
  CB.col = makeBuf(gl.ARRAY_BUFFER, new Float32Array(cube.col));
  CB.uv = makeBuf(gl.ARRAY_BUFFER, new Float32Array(cube.uv));
  CB.idx = makeBuf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cube.idx));

  /* ---- sky quad ---- */
  SkyBuf = makeBuf(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));

  /* ---- flat quad buffer (shadow / glow) ---- */
  FlatData = new Float32Array(FLAT_MAX * 20);
  FlatVerts = new Float32Array(FLAT_MAX * 20);
  FlatBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, FlatBuf);
  gl.bufferData(gl.ARRAY_BUFFER, FlatVerts.byteLength, gl.DYNAMIC_DRAW);

  /* ---- sprite buffer ---- */
  SprData = new Float32Array(SP_MAX * 44);
  SprBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, SprBuf);
  gl.bufferData(gl.ARRAY_BUFFER, SprData.byteLength, gl.DYNAMIC_DRAW);
  const sIdx = new Uint16Array(SP_MAX * 6);
  for (let i = 0; i < SP_MAX; i++) {
    const b = i * 4, o = i * 6;
    sIdx[o] = b; sIdx[o + 1] = b + 1; sIdx[o + 2] = b + 2;
    sIdx[o + 3] = b; sIdx[o + 4] = b + 2; sIdx[o + 5] = b + 3;
  }
  SprIdx = makeBuf(gl.ELEMENT_ARRAY_BUFFER, sIdx);
}

function makeBuf(target, data) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return b;
}

function buildUnitCube() {
  const p = [], n = [], c = [], uv = [], idx = [];
  const V = (x, y, z, nx, ny, nz, u, v) => { p.push(x, y, z); n.push(nx, ny, nz); c.push(1, 1, 1); uv.push(u, v); };
  const F = (a, b, cc, d) => { idx.push(a, b, cc, a, cc, d); };
  // +X
  V(.5, -.5, -.5, 1, 0, 0, 0, 0); V(.5, -.5, .5, 1, 0, 0, 1, 0); V(.5, .5, .5, 1, 0, 0, 1, 1); V(.5, .5, -.5, 1, 0, 0, 0, 1); F(0, 1, 2, 3);
  // -X
  V(-.5, -.5, -.5, -1, 0, 0, 0, 0); V(-.5, .5, -.5, -1, 0, 0, 0, 1); V(-.5, .5, .5, -1, 0, 0, 1, 1); V(-.5, -.5, .5, -1, 0, 0, 1, 0); F(4, 5, 6, 7);
  // +Y
  V(-.5, .5, -.5, 0, 1, 0, 0, 0); V(-.5, .5, .5, 0, 1, 0, 0, 1); V(.5, .5, .5, 0, 1, 0, 1, 1); V(.5, .5, -.5, 0, 1, 0, 1, 0); F(8, 9, 10, 11);
  // -Y
  V(-.5, -.5, -.5, 0, -1, 0, 0, 0); V(.5, -.5, -.5, 0, -1, 0, 1, 0); V(.5, -.5, .5, 0, -1, 0, 1, 1); V(-.5, -.5, .5, 0, -1, 0, 0, 1); F(12, 13, 14, 15);
  // +Z
  V(-.5, -.5, .5, 0, 0, 1, 0, 0); V(.5, -.5, .5, 0, 0, 1, 1, 0); V(.5, .5, .5, 0, 0, 1, 1, 1); V(-.5, .5, .5, 0, 0, 1, 0, 1); F(16, 17, 18, 19);
  // -Z
  V(-.5, -.5, -.5, 0, 0, -1, 0, 0); V(-.5, .5, -.5, 0, 0, -1, 0, 1); V(.5, .5, -.5, 0, 0, -1, 1, 1); V(.5, -.5, -.5, 0, 0, -1, 1, 0); F(20, 21, 22, 23);
  return { pos: p, nor: n, col: c, uv, idx };
}

/* ---- state render ---- */
const PROJ = m4(), VIEW = m4(), VP = m4(), MODEL = m4();
const UP = [0, 1, 0];
const LIGHT_DIR = (() => { const l = [0.42, 0.86, 0.30], m = Math.hypot(...l); return [l[0] / m, l[1] / m, l[2] / m]; })();
const FOG = [0.80, 0.91, 0.995];
const FOG_NEAR = 78, FOG_FAR = 340;
const SB = {}, CB = {};
let SkyBuf = null, FlatBuf = null, SprBuf = null, SprIdx = null;
let FlatData = null, FlatVerts = null, SprData = null;
const FLAT_MAX = 64, SP_MAX = 640;
let flatCount = 0, sprCount = 0;

/* ---- geometri statis builder ---- */
const SG = { pos: [], nor: [], col: [], uv: [], idx: [], count: 0 };

function quad(p0, p1, p2, p3, n, c, u0, u1, u2, u3) {
  const base = SG.count;
  const pts = [p0, p1, p2, p3], uvs = [u0, u1, u2, u3];
  for (let i = 0; i < 4; i++) {
    SG.pos.push(pts[i][0], pts[i][1], pts[i][2]);
    SG.nor.push(n[0], n[1], n[2]);
    SG.col.push(c[0], c[1], c[2]);
    SG.uv.push(uvs[i][0], uvs[i][1]);
  }
  SG.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  SG.count += 4;
}

function box3(cx, cy, cz, w, h, d, c) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], c,
    [x0, z0], [x0, z1], [x1, z1], [x1, z0]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], shade(c, 0.82),
    [x0, z0], [x1, z0], [x1, z1], [x0, z1]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], c,
    [x0, y0], [x1, y0], [x1, y1], [x0, y1]);
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], shade(c, 0.90),
    [x0, y0], [x0, y1], [x1, y1], [x1, y0]);
  quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], shade(c, 0.95),
    [z0, y0], [z1, y0], [z1, y1], [z0, y1]);
  quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], shade(c, 0.86),
    [z0, y0], [z0, y1], [z1, y1], [z1, y0]);
}

function torus3(cx, cy, cz, R, r, segU, segV, c) {
  const P = (u, v) => {
    const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
    return [cx + (R + r * cv) * cu, cy + (R + r * cv) * su, cz + r * sv];
  };
  const N = (u, v) => {
    const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
    return [cv * cu, cv * su, sv];
  };
  for (let i = 0; i < segU; i++) {
    const u0 = i / segU * TAU, u1 = (i + 1) / segU * TAU;
    for (let j = 0; j < segV; j++) {
      const v0 = j / segV * TAU, v1 = (j + 1) / segV * TAU;
      quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1),
        N((u0 + u1) / 2, (v0 + v1) / 2), c,
        [i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]);
    }
  }
}

/* ---- dynamic boxes ---- */
const dynBoxes = [];
function dynBox(x, y, z, w, h, d, c, opts) {
  const b = {
    x, y, z, w, h, d, c, rx: 0, ry: 0, rz: 0,
    visible: true, checker: 0,
    base: c
  };
  if (opts) Object.assign(b, opts);
  dynBoxes.push(b);
  return b;
}

/* ---- flat / sprite helpers ---- */
function addFlat(x, y, z, r, color, alpha, soft) {
  if (flatCount >= FLAT_MAX || !FlatData) return;
  const o = flatCount * 20;
  const d = FlatData;
  const cr = color[0], cg = color[1], cb = color[2];
  const cs = [[-r, -r, 0, 0], [r, -r, 1, 0], [r, r, 1, 1], [-r, r, 0, 1]];
  for (let i = 0; i < 4; i++) {
    const b = o + i * 5;
    d[b] = x + cs[i][0]; d[b + 1] = y; d[b + 2] = z + cs[i][1];
    d[b + 3] = cs[i][2]; d[b + 4] = cs[i][3];
  }
  FLATS.push({ o, r: cr, g: cg, b: cb, a: alpha, soft: soft ? 1 : 0 });
  flatCount++;
}

function addSprite(x, y, z, size, color, alpha, kind) {
  if (sprCount >= SP_MAX || !SprData) return;
  SPRS.push({ x, y, z, size, r: color[0], g: color[1], b: color[2], a: alpha, kind: kind ? 1 : 0 });
  sprCount++;
}

/* ---------------------------------------------------------------- level */
const CFG = {
  fov: 62,
  gravity: -62,
  jump: 22.0,
  speed: 13.5,
  sprint: 17.5,
  accelGround: 130,
  accelAir: 40,
  friction: 11,
  camDist: 13.5,
  lavaY: -6,
};

const PAL = {
  z1: C(0x54d6f8), z1b: C(0x0f6f93),
  z2: C(0xffc94d), z2b: C(0x9a6a10),
  z3: C(0xff7a9c), z3b: C(0x94284a),
  z4: C(0x8ee06a), z4b: C(0x3c7a2a),
  z5: C(0xb79cff), z5b: C(0x5541a0),
  kill: C(0xff3b30), kill2: C(0x8c1610),
  bounce: C(0xff5ad1), bounce2: C(0x8c1c74),
  gold: C(0xffd35c), goldDark: C(0xb8862a),
  rock: C(0x486180), rock2: C(0x2b3d55),
  cloud: C(0xe8f5ff),
  white: C(0xffffff),
  cpOff: C(0x93a8bd), cpOn: C(0x4be08a),
  ink: C(0x0c1622),
};

const level = {
  solids: [], movers: [], spinners: [], blinks: [], checkpoints: [], coins: [],
  goal: null, spawn: { x: 0, y: 0.02, z: 0 }, endZ: 197,
};
const player = {
  x: 0, y: 1.08, z: 0, vx: 0, vy: 0, vz: 0,
  grounded: false, ground: null, coyote: 0, jumpBuf: 0,
  dead: 0, hidden: false, walk: 0, anim: 0, faceYaw: 0,
};
const PH = { hx: 0.46, hy: 1.06, hz: 0.46 };

function addCol(box, type, extra) {
  const c = {
    minx: box.x - box.w / 2, maxx: box.x + box.w / 2,
    miny: box.y - box.h / 2, maxy: box.y + box.h / 2,
    minz: box.z - box.d / 2, maxz: box.z + box.d / 2,
    type, active: true,
  };
  if (extra) Object.assign(c, extra);
  level.solids.push(c);
  return c;
}

function platform(x, top, z, w, d, o) {
  o = o || {};
  const h = o.h !== undefined ? o.h : 1.5;
  const color = o.color || PAL.z1;
  const dyn = !!o.dyn;
  const parts = [];
  const capH = 0.18;
  const baseH = Math.max(0.3, h - capH);

  const push = (px, py, pz, pw, ph, pd, pc) => {
    if (dyn) {
      const b = dynBox(px, py, pz, pw, ph, pd, pc);
      parts.push(b);
    } else {
      box3(px, py, pz, pw, ph, pd, pc);
    }
  };

  push(x, top - capH - baseH / 2, z, w, baseH, d, shade(color, 0.66));
  push(x, top - capH / 2, z, w, capH, d, color);

  // pilar batu di bawah (biar terlihat seperti pulau)
  if (o.rock !== false && h > 1.8) {
    push(x, top - h - 1.6, z, w * 0.55, 3.2, d * 0.55, PAL.rock);
  }

  const col = addCol({ x, y: top - h / 2, z, w, h, d }, 'solid', { top });
  const p = { x, top, z, w, d, col, parts, color };
  col.platform = p;
  return p;
}

function mover(p, axis, amp, speed, phase) {
  const m = {
    p, axis, amp, speed, phase: phase || 0,
    x0: p.x, y0: p.top, z0: p.z,
    cx: p.x, cy: p.top, cz: p.z, dx: 0, dy: 0, dz: 0,
  };
  level.movers.push(m);
  p.col.mover = m;
  return m;
}

function blink(p, offset) {
  const b = { p, offset, period: 3.8, onTime: 2.3, active: true, warn: 0 };
  level.blinks.push(b);
  p.col.blink = b;
  p.capBase = p.color;
  return b;
}

function checkpoint(x, top, z, idx) {
  const cp = {
    x, top, z, idx, active: false,
    pad: dynBox(x, top + 0.07, z, 3.4, 0.14, 3.4, PAL.cpOff),
    flag: dynBox(x + 1.6, top + 3.15, z, 1.9, 1.15, 0.12, PAL.cpOff),
    glow: 0,
  };
  box3(x + 1.2, top + 1.75, z, 0.2, 3.5, 0.2, shade(PAL.cpOff, 0.8));
  level.checkpoints.push(cp);
  addCol({ x, y: top + 1.0, z, w: 3.4, h: 2.0, d: 3.4 }, 'checkpoint', { cp });
  return cp;
}

function coin(x, y, z) {
  const b = dynBox(x, y, z, 0.62, 0.62, 0.12, PAL.gold);
  const c = { x, y, z, taken: false, box: b, phase: rand(0, TAU) };
  level.coins.push(c);
  return c;
}

function killTile(x, top, z, w, d) {
  w = w || 1.8; d = d || 1.8;
  box3(x, top + 0.17, z, w, 0.34, d, PAL.kill);
  box3(x, top + 0.35, z, w * 0.55, 0.06, d * 0.55, PAL.kill2);
  addCol({ x, y: top + 0.17, z, w, h: 0.34, d }, 'kill');
}

function bouncePad(x, top, z, w, d) {
  w = w || 3.2; d = d || 3.2;
  dynBox(x, top + 0.13, z, w, 0.26, d, PAL.bounce);
  dynBox(x, top + 0.30, z, w * 0.45, 0.1, d * 0.45, mix3(PAL.bounce, PAL.white, 0.5));
  addCol({ x, y: top + 0.13, z, w, h: 0.26, d }, 'bounce');
}

function spinner(x, y, z, len, speed, phase) {
  const s = { x, y, z, len, speed, phase: phase || 0, angle: phase || 0 };
  level.spinners.push(s);
  s.bar = dynBox(x, y, z, len * 2, 0.3, 0.34, PAL.kill);
  s.hub = dynBox(x, y - 0.35, z, 0.86, 0.86, 0.86, PAL.ink);
  return s;
}

function goal(x, top, z) {
  const gy = top + 3.4;
  torus3(x, gy, z, 2.5, 0.3, 30, 10, PAL.gold);
  box3(x - 2.9, top + 1.3, z, 0.5, 2.6, 0.5, PAL.z5b);
  box3(x + 2.9, top + 1.3, z, 0.5, 2.6, 0.5, PAL.z5b);
  const g = { x, y: gy, z, top, trigger: { minx: x - 2.4, maxx: x + 2.4, miny: top, maxy: top + 5, minz: z - 1.4, maxz: z + 1.4 } };
  level.goal = g;
  addCol({ x, y: top + 2.5, z, w: 4.6, h: 5, d: 2.6 }, 'goal', { goal: g });
  return g;
}

function buildLevel() {
  /* ================= ZONA 1 · PEMANASAN ================= */
  platform(0, 0, 0, 20, 20, { h: 3.6, color: PAL.z1 });
  platform(0, 1.0, 15, 6, 6, { color: PAL.z1 });
  platform(3.5, 2.0, 21, 5, 5, { color: PAL.z1 });
  platform(-1.5, 3.0, 27, 4.6, 4.6, { color: PAL.z1 });
  platform(0, 4.0, 33, 4.2, 4.2, { color: PAL.z1 });
  platform(0, 5.0, 44, 12, 12, { h: 2.4, color: PAL.z1 });
  checkpoint(0, 5.0, 44, 0);

  /* ================= ZONA 2 · PIJAKAN HILANG ================= */
  mover(platform(0, 5.5, 55, 5, 5, { color: PAL.z2, dyn: true }), 'x', 4.6, 1.05, 0);
  blink(platform(0, 6.0, 62, 4.2, 4.2, { color: PAL.z2, dyn: true }), 0);
  blink(platform(0, 6.5, 68, 4.2, 4.2, { color: PAL.z2, dyn: true }), 1.25);
  blink(platform(0, 7.0, 74, 4.2, 4.2, { color: PAL.z2, dyn: true }), 2.5);
  platform(0, 7.2, 82, 10, 9, { color: PAL.z2 });
  killTile(-3.2, 7.2, 81.0);
  killTile(0.9, 7.2, 82.6);
  killTile(3.2, 7.2, 83.9);
  checkpoint(0, 7.2, 79.0, 1);
  platform(0, 8.0, 92, 12, 10, { h: 2.4, color: PAL.z2 });
  checkpoint(0, 8.0, 92, 2);

  /* ================= ZONA 3 · PISAU PUTAR ================= */
  platform(0, 8.0, 103, 4.8, 12, { color: PAL.z3 });
  spinner(0, 8.5, 103, 3.3, 1.75, 0);
  mover(platform(0, 9.0, 117, 4.8, 4.8, { color: PAL.z3, dyn: true }), 'z', 4.0, 0.85, 0);
  platform(0, 9.5, 130, 10, 10, { h: 2.6, color: PAL.z3 });
  spinner(0, 10.0, 130, 4.0, -1.25, 0.7);
  platform(0, 10.0, 140, 10, 8, { h: 2.4, color: PAL.z3 });
  checkpoint(0, 10.0, 140, 3);

  /* ================= ZONA 4 · LOMPATAN TINGGI ================= */
  platform(0, 10.5, 150, 2.6, 10, { color: PAL.z4 });
  platform(-1.4, 11.0, 161, 2.4, 8, { color: PAL.z4 });
  platform(0, 11.0, 168.5, 4.8, 4.8, { color: PAL.z4 });
  bouncePad(0, 11.0, 168.5);
  platform(0, 18.0, 178, 8.6, 8.6, { h: 2.8, color: PAL.z4 });
  checkpoint(0, 18.0, 178, 4);
  platform(0, 18.0, 190, 14, 12, { h: 2.8, color: PAL.z5 });
  goal(0, 18.0, 191.5);

  /* ================= bintang ================= */
  coin(0, 3.4, 15);
  coin(3.5, 4.4, 21);
  coin(-1.5, 5.4, 27);
  coin(0, 8.0, 56);
  coin(0, 9.0, 68);
  coin(0, 11.2, 103);
  coin(0, 12.4, 130);
  coin(0, 20.4, 179);

  /* ================= dekorasi ================= */
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? -1 : 1;
    const x = side * rand(52, 130);
    const z = rand(-50, 260);
    const w = rand(10, 28), d = rand(10, 28), h = rand(6, 22);
    const top = rand(-4, 9);
    box3(x, top - h / 2, z, w, h, d, shade(PAL.rock, rand(0.85, 1.12)));
  }
  for (let i = 0; i < 18; i++) {
    const x = rand(-190, 190), z = rand(-70, 280), y = rand(42, 80);
    const w = rand(16, 42), h = rand(2.4, 5.5), d = rand(14, 34);
    box3(x, y, z, w, h, d, PAL.cloud);
    box3(x + w * 0.3, y + h * 0.6, z + d * 0.2, w * 0.55, h * 0.9, d * 0.6, PAL.cloud);
  }

  level.spawn = { x: 0, y: 0.02, z: 0 };
  state.respawn = { x: 0, y: 0.02 + PH.hy, z: 0 };
}

/* --------------------------------------------------------------- 4. fisika */
const state = {
  mode: 'menu', time: 0, deaths: 0, coins: 0,
  respawn: { x: 0, y: 2, z: 0 },
  started: false, best: 0,
};

function activeSolids() {
  return level.solids;
}

function overlapsPlayer(c, pad) {
  const p = pad || 0;
  return player.x + PH.hx > c.minx - p && player.x - PH.hx < c.maxx + p &&
    player.z + PH.hz > c.minz - p && player.z - PH.hz < c.maxz + p &&
    player.y + PH.hy > c.miny - p && player.y - PH.hy < c.maxy + p;
}

function resolveAxis(c, axis) {
  if (axis === 'x') {
    if (player.vx > 0) player.x = c.minx - PH.hx;
    else if (player.vx < 0) player.x = c.maxx + PH.hx;
    else player.x = player.x < (c.minx + c.maxx) / 2 ? c.minx - PH.hx : c.maxx + PH.hx;
    player.vx = 0;
  } else if (axis === 'z') {
    if (player.vz > 0) player.z = c.minz - PH.hz;
    else if (player.vz < 0) player.z = c.maxz + PH.hz;
    else player.z = player.z < (c.minz + c.maxz) / 2 ? c.minz - PH.hz : c.maxz + PH.hz;
    player.vz = 0;
  } else {
    if (player.vy <= 0) {
      player.y = c.maxy + PH.hy;
      if (c.type === 'bounce') {
        player.vy = 33;
        player.vz = 12.5;
        player.vx *= 0.4;
        player.grounded = false;
        player.ground = null;
        Sfx.bounce();
        emitBurst(player.x, player.y - PH.hy, player.z, PAL.bounce, 16, 7, 0.5);
        return;
      }
      player.vy = 0;
      player.grounded = true;
      player.ground = c;
    } else {
      player.y = c.miny - PH.hy;
      player.vy = 0;
    }
  }
}

function moveAxis(axis, amount) {
  player[axis] += amount;
  for (let i = 0; i < level.solids.length; i++) {
    const c = level.solids[i];
    if (!c.active || c.type === 'checkpoint' || c.type === 'goal') continue;
    if (!overlapsPlayer(c, 0)) continue;
    resolveAxis(c, axis);
  }
}

function physics(dt) {
  const p = player;
  const wasGrounded = p.grounded;
  p.grounded = false;
  p.ground = null;

  /* --- input arah --- */
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  ix += touchInput.x; iz += touchInput.y;
  const mag = Math.hypot(ix, iz);
  if (mag > 1) { ix /= mag; iz /= mag; }

  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx = -fz, rz = fx;
  let dx = fx * iz + rx * ix;
  let dz = fz * iz + rz * ix;
  const dl = Math.hypot(dx, dz);
  if (dl > 1e-4) { dx /= dl; dz /= dl; }

  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const targetSpeed = (sprint ? CFG.sprint : CFG.speed) * (dl > 1e-4 ? 1 : 0);
  const accel = (p.grounded ? CFG.accelGround : CFG.accelAir) * dt;
  const tvx = dx * targetSpeed, tvz = dz * targetSpeed;
  p.vx += clamp(tvx - p.vx, -accel, accel);
  p.vz += clamp(tvz - p.vz, -accel, accel);

  if (dl < 1e-4 && p.grounded) {
    const fr = Math.max(0, 1 - CFG.friction * dt);
    p.vx *= fr; p.vz *= fr;
  }

  /* --- lompat --- */
  if (p.jumpBuf > 0) p.jumpBuf -= dt;
  if (p.jumpBuf > 0 && (wasGrounded || p.coyote > 0)) {
    p.vy = CFG.jump;
    p.jumpBuf = 0;
    p.coyote = 0;
    p.grounded = false;
    Sfx.jump();
    emitBurst(p.x, p.y - PH.hy, p.z, PAL.white, 7, 3.2, 0.35);
  }

  p.vy += CFG.gravity * dt * (p.vy < 0 ? 1.12 : 1);
  if (p.vy < -58) p.vy = -58;

  moveAxis('x', p.vx * dt);
  moveAxis('z', p.vz * dt);
  moveAxis('y', p.vy * dt);

  if (p.grounded) p.coyote = 0.11;
  else p.coyote = Math.max(0, p.coyote - dt);

  checkHazards();
  checkTriggers();
}

function checkHazards() {
  const p = player;
  const feet = p.y - PH.hy;
  for (let i = 0; i < level.solids.length; i++) {
    const c = level.solids[i];
    if (c.type !== 'kill' || !c.active) continue;
    if (p.x + PH.hx > c.minx && p.x - PH.hx < c.maxx &&
      p.z + PH.hz > c.minz && p.z - PH.hz < c.maxz &&
      p.y + PH.hy > c.miny + 0.02 && feet < c.maxy + 0.06) {
      die();
      return;
    }
  }
  // spinner
  for (let i = 0; i < level.spinners.length; i++) {
    const s = level.spinners[i];
    const dx = p.x - s.x, dz = p.z - s.z;
    const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
    const lx = ca * dx - sa * dz;
    const lz = sa * dx + ca * dz;
    if (Math.abs(lx) < s.len && Math.abs(lz) < 0.42 && feet < s.y + 0.18 && feet + 1.75 > s.y - 0.18) {
      die();
      return;
    }
  }
  if (p.y < CFG.lavaY + PH.hy + 0.12) die();
}

function checkTriggers() {
  const p = player;
  if (state.mode !== 'playing') return;

  for (let i = 0; i < level.checkpoints.length; i++) {
    const cp = level.checkpoints[i];
    if (cp.active) continue;
    if (!overlapsPlayer({ minx: cp.x - 1.7, maxx: cp.x + 1.7, miny: cp.top - 0.4, maxy: cp.top + 2.2, minz: cp.z - 1.7, maxz: cp.z + 1.7 }, 0)) continue;
    cp.active = true;
    cp.glow = 1;
    state.respawn = { x: cp.x, y: cp.top + PH.hy + 0.06, z: cp.z };
    toast('CHECKPOINT ' + (i + 1));
    Sfx.checkpoint();
    emitBurst(cp.x, cp.top + 1.6, cp.z, PAL.cpOn, 26, 6, 0.9);
  }

  for (let i = 0; i < level.coins.length; i++) {
    const c = level.coins[i];
    if (c.taken) continue;
    const dx = p.x - c.x, dy = (p.y + 0.1) - c.y, dz = p.z - c.z;
    if (dx * dx + dy * dy + dz * dz < 2.0) {
      c.taken = true;
      state.coins++;
      Sfx.coin();
      emitBurst(c.x, c.y, c.z, PAL.gold, 14, 5, 0.6);
      updateCoins();
    }
  }

  const g = level.goal;
  if (g && p.x > g.trigger.minx && p.x < g.trigger.maxx && p.z > g.trigger.minz && p.z < g.trigger.maxz &&
    p.y > g.trigger.miny && p.y < g.trigger.maxy) {
    winRun();
  }
}

function die() {
  if (state.mode !== 'playing' || player.dead > 0) return;
  state.deaths++;
  player.dead = 0.55;
  player.hidden = true;
  player.vx = player.vy = player.vz = 0;
  emitBurst(player.x, player.y, player.z, PAL.kill, 30, 10, 0) ;
  emitBurst(player.x, player.y, player.z, PAL.z1, 14, 6, 0);
  Sfx.die();
  flashEl.classList.add('on');
  setTimeout(() => flashEl.classList.remove('on'), 110);
  updateDeaths();
}

function respawn() {
  const r = state.respawn;
  player.x = r.x; player.y = r.y; player.z = r.z;
  player.vx = player.vy = player.vz = 0;
  player.dead = 0;
  player.hidden = false;
  player.grounded = false;
  player.ground = null;
  player.coyote = 0;
  player.jumpBuf = 0;
  snapCamera();
  emitBurst(player.x, player.y - 0.8, player.z, PAL.white, 12, 4, 0.6);
}

function winRun() {
  if (state.mode !== 'playing') return;
  state.mode = 'won';
  state.started = false;
  Sfx.win();
  const isBest = !state.best || state.time < state.best;
  if (isBest) { state.best = state.time; saveBest(state.time); }
  dom.winTime.textContent = fmtTime(state.time);
  dom.winDeaths.textContent = String(state.deaths);
  dom.winCoins.textContent = state.coins + '/' + level.coins.length;
  dom.winBest.textContent = state.best ? fmtTime(state.best) : '—';
  dom.newBest.classList.toggle('on', !!isBest);
  dom.win.classList.remove('hidden');
  dom.hud.classList.add('off');
  if (document.pointerLockElement) document.exitPointerLock();
  confetti();
}

/* ---------------------------------------------------------------- 5. input */
const keys = Object.create(null);
const touchInput = { x: 0, y: 0, jump: false, active: false };

window.addEventListener('keydown', (e) => {
  if (e.repeat) { return; }
  const k = e.code;
  keys[k] = true;
  if (k === 'Space') { e.preventDefault(); player.jumpBuf = 0.16; }
  if (k === 'KeyR' && state.mode === 'playing' && player.dead <= 0) respawn();
  if (k === 'KeyR' && state.mode === 'won') startRun();
  if (k === 'KeyM') toggleSound();
  if (k === 'Enter' && state.mode === 'menu') startRun();
  if (k === 'Enter' && state.mode === 'won') startRun();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
}, { passive: false });

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space' && player.vy > 3) player.vy *= 0.55;
});

/* mouse look */
let dragging = false, lastMX = 0, lastMY = 0;
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  lastMX = e.clientX; lastMY = e.clientY;
  if (state.mode === 'playing' && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock && canvas.requestPointerLock();
  }
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    cam.yaw -= e.movementX * 0.0026;
    cam.pitch = clamp(cam.pitch + e.movementY * 0.0021, -0.25, 1.15);
  } else if (dragging) {
    cam.yaw -= (e.clientX - lastMX) * 0.0055;
    cam.pitch = clamp(cam.pitch + (e.clientY - lastMY) * 0.0045, -0.25, 1.15);
    lastMX = e.clientX; lastMY = e.clientY;
  }
});
window.addEventListener('wheel', (e) => {
  cam.distTarget = clamp(cam.distTarget + Math.sign(e.deltaY) * 1.2, 7, 22);
}, { passive: true });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) dom.hint.style.opacity = '0';
});

/* touch look + joystick */
const stickEl = $('stick'), knobEl = $('knob'), jumpEl = $('jumpBtn');
let stickId = null, stickCX = 0, stickCY = 0;

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}
if (isTouchDevice()) document.body.classList.add('touch');

stickEl.addEventListener('pointerdown', (e) => {
  stickId = e.pointerId;
  stickEl.setPointerCapture(e.pointerId);
  const r = stickEl.getBoundingClientRect();
  stickCX = r.left + r.width / 2; stickCY = r.top + r.height / 2;
  touchInput.active = true;
  e.preventDefault();
});
stickEl.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickId) return;
  let dx = e.clientX - stickCX, dy = e.clientY - stickCY;
  const max = 46, l = Math.hypot(dx, dy);
  if (l > max) { dx = dx / l * max; dy = dy / l * max; }
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  touchInput.x = dx / max;
  touchInput.y = -dy / max;
  e.preventDefault();
});
function endStick(e) {
  if (e.pointerId !== stickId) return;
  stickId = null;
  touchInput.x = 0; touchInput.y = 0; touchInput.active = false;
  knobEl.style.transform = 'translate(0px,0px)';
}
stickEl.addEventListener('pointerup', endStick);
stickEl.addEventListener('pointercancel', endStick);

jumpEl.addEventListener('pointerdown', (e) => {
  player.jumpBuf = 0.16;
  e.preventDefault();
});

/* touch drag look on canvas */
let tLookId = null, tLookX = 0, tLookY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && tLookId === null) {
    tLookId = e.pointerId; tLookX = e.clientX; tLookY = e.clientY;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== tLookId) return;
  cam.yaw -= (e.clientX - tLookX) * 0.006;
  cam.pitch = clamp(cam.pitch + (e.clientY - tLookY) * 0.005, -0.25, 1.15);
  tLookX = e.clientX; tLookY = e.clientY;
});
function endLook(e) { if (e.pointerId === tLookId) tLookId = null; }
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);

/* ---------------------------------------------------------------- 6. kamera */
const cam = {
  yaw: Math.PI, pitch: 0.24, dist: 13.5, distTarget: 13.5,
  pos: [0, 12, -14], target: [0, 3, 0], smoothTarget: [0, 3, 0],
};

function snapCamera() {
  cam.target = [player.x, player.y + 0.5, player.z];
  cam.smoothTarget = [cam.target[0], cam.target[1], cam.target[2]];
  const cp = Math.cos(cam.pitch), dx = Math.sin(cam.yaw) * cp, dz = Math.cos(cam.yaw) * cp;
  cam.pos = [cam.target[0] + dx * cam.dist, cam.target[1] + Math.sin(cam.pitch) * cam.dist, cam.target[2] + dz * cam.dist];
}

function updateCamera(dt) {
  cam.dist = damp(cam.dist, cam.distTarget, 8, dt);
  const tx = player.x, ty = player.y + 0.5, tz = player.z;
  cam.smoothTarget[0] = damp(cam.smoothTarget[0], tx, 14, dt);
  cam.smoothTarget[1] = damp(cam.smoothTarget[1], ty, 9, dt);
  cam.smoothTarget[2] = damp(cam.smoothTarget[2], tz, 14, dt);

  const cp = Math.cos(cam.pitch);
  let dist = cam.dist;

  // tabrakan kamera sederhana: jangan tembus platform
  let ox = Math.sin(cam.yaw) * cp, oy = Math.sin(cam.pitch), oz = Math.cos(cam.yaw) * cp;
  const hit = raycastSolids(cam.smoothTarget, [ox, oy, oz], dist);
  if (hit < dist) dist = Math.max(3.2, hit - 0.6);

  cam.pos[0] = damp(cam.pos[0], cam.smoothTarget[0] + ox * dist, 16, dt);
  cam.pos[1] = damp(cam.pos[1], cam.smoothTarget[1] + oy * dist, 16, dt);
  cam.pos[2] = damp(cam.pos[2], cam.smoothTarget[2] + oz * dist, 16, dt);
  if (cam.pos[1] < CFG.lavaY + 1.6) cam.pos[1] = CFG.lavaY + 1.6;
  cam.target = cam.smoothTarget;
}

function raycastSolids(origin, dir, maxT) {
  let best = maxT;
  for (let i = 0; i < level.solids.length; i++) {
    const c = level.solids[i];
    if (!c.active || (c.type !== 'solid' && c.type !== 'kill' && c.type !== 'bounce')) continue;
    const t = rayBox(origin, dir, c, best);
    if (t < best) best = t;
  }
  return best;
}

function rayBox(o, d, c, maxT) {
  let tmin = 0, tmax = maxT;
  const lo = [c.minx - 0.1, c.miny - 0.1, c.minz - 0.1];
  const hi = [c.maxx + 0.1, c.maxy + 0.1, c.maxz + 0.1];
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o[0] : a === 1 ? o[1] : o[2];
    const da = a === 0 ? d[0] : a === 1 ? d[1] : d[2];
    if (Math.abs(da) < 1e-6) {
      if (oa < lo[a] || oa > hi[a]) return maxT;
    } else {
      let t1 = (lo[a] - oa) / da, t2 = (hi[a] - oa) / da;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return maxT;
    }
  }
  return tmin;
}

/* ---------------------------------------------------------------- 7. efek */
const particles = [];
const FLATS = [];
const SPRS = [];

function emitBurst(x, y, z, color, count, speed, gravity) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU), b = rand(-0.7, 0.9);
    const sp = speed * rand(0.35, 1);
    particles.push({
      x, y, z,
      vx: Math.cos(a) * sp * Math.cos(b),
      vy: Math.sin(b) * sp + 2,
      vz: Math.sin(a) * sp * Math.cos(b),
      life: rand(0.4, 0.9), max: 0.9,
      size: rand(0.18, 0.46),
      r: color[0], g: color[1], b: color[2],
      grav: gravity === undefined ? 14 : gravity,
      kind: Math.random() < 0.55 ? 1 : 0,
    });
  }
}

function confetti() {
  const g = level.goal;
  for (let i = 0; i < 150; i++) {
    const a = rand(0, TAU), sp = rand(2, 11);
    const colors = [PAL.gold, PAL.z1, PAL.z4, PAL.z3, PAL.z5];
    const c = colors[i % colors.length];
    particles.push({
      x: g.x + rand(-2, 2), y: g.y + rand(-1, 2), z: g.z + rand(-1, 1),
      vx: Math.cos(a) * sp, vy: rand(4, 14), vz: Math.sin(a) * sp,
      life: rand(1.2, 2.6), max: 2.6, size: rand(0.2, 0.45),
      r: c[0], g: c[1], b: c[2], grav: 9, kind: 0,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy -= p.grav * dt;
    p.vx *= 1 - 0.9 * dt; p.vz *= 1 - 0.9 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  }
}

/* ---------------------------------------------------------------- 8. audio */
const Sfx = {
  ctx: null, master: null, muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* no audio */ }
  },
  tone(freq, dur, o) {
    o = o || {};
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (o.delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(24, o.to), t0 + dur);
    const vol = o.vol === undefined ? 0.1 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  },
  jump() { this.tone(340, 0.15, { type: 'square', to: 640, vol: 0.055 }); },
  land() { this.tone(130, 0.1, { type: 'triangle', to: 70, vol: 0.06 }); },
  step() { this.tone(rand(90, 120), 0.05, { type: 'triangle', vol: 0.025 }); },
  die() { this.tone(320, 0.45, { type: 'sawtooth', to: 50, vol: 0.09 }); this.tone(150, 0.55, { type: 'square', to: 40, vol: 0.05, delay: 0.04 }); },
  checkpoint() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.24, { type: 'triangle', vol: 0.07, delay: i * 0.07 })); },
  coin() { this.tone(1046, 0.09, { type: 'square', vol: 0.045 }); this.tone(1568, 0.13, { type: 'square', vol: 0.04, delay: 0.06 }); },
  bounce() { this.tone(170, 0.3, { type: 'sine', to: 920, vol: 0.1 }); },
  win() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.45, { type: 'triangle', vol: 0.08, delay: i * 0.1 })); },
};

function toggleSound() {
  Sfx.muted = !Sfx.muted;
  dom.soundBtn.textContent = Sfx.muted ? '🔇' : '🔊';
  dom.soundBtn.classList.toggle('muted', Sfx.muted);
}

/* ---------------------------------------------------------------- 9. UI */
function loadBest() {
  try { return parseFloat(localStorage.getItem('skyhop.best') || '0') || 0; } catch (e) { return 0; }
}
function saveBest(t) {
  try { localStorage.setItem('skyhop.best', String(t)); } catch (e) { /* private mode */ }
}

const flashEl = $('flash');
const dom = {
  hud: $('hud'), clock: $('clock'), zone: $('zoneName'),
  deaths: $('deathCount'), coins: $('coinCount'),
  fill: $('trackFill'), dot: $('trackDot'),
  menu: $('menu'), win: $('win'), toast: $('toast'),
  best: $('menuBest'), winTime: $('winTime'), winDeaths: $('winDeaths'),
  winCoins: $('winCoins'), winBest: $('winBest'), newBest: $('newBest'),
  soundBtn: $('btnSound'), hint: $('hint'),
};
if (!dom.newBest) dom.newBest = document.createElement('div');

let toastTimer = 0;
function toast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 1400);
}
function updateDeaths() { dom.deaths.textContent = String(state.deaths); }
function updateCoins() { dom.coins.textContent = String(state.coins); }

function zoneAt(z) {
  if (z < 51) return 'ZONA 1 · PEMANASAN';
  if (z < 97) return 'ZONA 2 · PIJAKAN HILANG';
  if (z < 145) return 'ZONA 3 · PISAU PUTAR';
  if (z < 175) return 'ZONA 4 · LOMPATAN TINGGI';
  return 'FINISH · GARIS AKHIR';
}

function startRun() {
  Sfx.init();
  level.checkpoints.forEach((cp) => {
    cp.active = false; cp.glow = 0;
    cp.pad.c = PAL.cpOff; cp.flag.c = PAL.cpOff;
  });
  level.coins.forEach((c) => { c.taken = false; c.box.visible = true; });
  state.mode = 'playing';
  state.time = 0;
  state.deaths = 0;
  state.coins = 0;
  state.respawn = { x: level.spawn.x, y: level.spawn.y + PH.hy, z: level.spawn.z };
  player.x = level.spawn.x; player.y = level.spawn.y + PH.hy; player.z = level.spawn.z;
  player.vx = player.vy = player.vz = 0;
  player.dead = 0; player.hidden = false; player.grounded = false; player.ground = null;
  player.jumpBuf = 0; player.coyote = 0; player.faceYaw = 0;
  particles.length = 0;
  updateDeaths(); updateCoins();
  dom.menu.classList.add('hidden');
  dom.win.classList.add('hidden');
  dom.hud.classList.remove('off');
  dom.clock.textContent = '00:00.00';
  dom.hint.style.opacity = '';
  hudZone = '';
  if (dom.best) dom.best.textContent = state.best ? fmtTime(state.best) : '—';
  snapCamera();
}

/* ---------------------------------------------------------------- main loop */
let timeAcc = 0;
let lastT = performance.now();
let camInit = false;
let hudZone = '';

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function resetAttribs() {
  for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
}

function drawSky() {
  const P = progSky;
  gl.useProgram(P.p);
  resetAttribs();
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.bindBuffer(gl.ARRAY_BUFFER, SkyBuf);
  gl.enableVertexAttribArray(P.a.aPos);
  gl.vertexAttribPointer(P.a.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(P.u.uSun, 0.72, 0.80);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function blockUniforms(P) {
  gl.uniformMatrix4fv(P.u.uVP, false, VP);
  gl.uniform3fv(P.u.uCamPos, cam.pos);
  gl.uniform3fv(P.u.uLightDir, LIGHT_DIR);
  gl.uniform3fv(P.u.uFogColor, FOG);
  gl.uniform1f(P.u.uFogNear, FOG_NEAR);
  gl.uniform1f(P.u.uFogFar, FOG_FAR);
}

function drawStatic() {
  const P = progBlock;
  gl.useProgram(P.p);
  resetAttribs();
  blockUniforms(P);
  gl.uniformMatrix4fv(P.u.uModel, false, IDENT4);
  gl.uniformMatrix3fv(P.u.uNMat, false, IDENT3);
  gl.uniform3fv(P.u.uTint, [1, 1, 1]);
  gl.uniform1f(P.u.uUseChecker, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, SB.pos); gl.enableVertexAttribArray(P.a.aPos); gl.vertexAttribPointer(P.a.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, SB.nor); gl.enableVertexAttribArray(P.a.aNormal); gl.vertexAttribPointer(P.a.aNormal, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, SB.col); gl.enableVertexAttribArray(P.a.aColor); gl.vertexAttribPointer(P.a.aColor, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, SB.uv); gl.enableVertexAttribArray(P.a.aUv); gl.vertexAttribPointer(P.a.aUv, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, SB.idx);
  gl.drawElements(gl.TRIANGLES, SB.count, gl.UNSIGNED_SHORT, 0);
}

const IDENT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function drawDynBoxes() {
  const P = progBlock;
  gl.useProgram(P.p);
  resetAttribs();
  blockUniforms(P);
  gl.uniform1f(P.u.uUseChecker, 0);
  gl.uniformMatrix3fv(P.u.uNMat, false, ROT3);
  gl.uniform3fv(P.u.uTint, [1, 1, 1]);

  gl.bindBuffer(gl.ARRAY_BUFFER, CB.pos); gl.enableVertexAttribArray(P.a.aPos); gl.vertexAttribPointer(P.a.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, CB.nor); gl.enableVertexAttribArray(P.a.aNormal); gl.vertexAttribPointer(P.a.aNormal, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, CB.col); gl.enableVertexAttribArray(P.a.aColor); gl.vertexAttribPointer(P.a.aColor, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, CB.uv); gl.enableVertexAttribArray(P.a.aUv); gl.vertexAttribPointer(P.a.aUv, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, CB.idx);

  for (let i = 0; i < dynBoxes.length; i++) {
    const b = dynBoxes[i];
    if (!b.visible) continue;
    m4trs(MODEL, b.x, b.y, b.z, b.rx, b.ry, b.rz, b.w, b.h, b.d);
    gl.uniformMatrix4fv(P.u.uModel, false, MODEL);
    gl.uniformMatrix3fv(P.u.uNMat, false, ROT3);
    gl.uniform3fv(P.u.uTint, b.c);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
  }
}

function drawFlats() {
  if (!flatCount) return;
  const P = progFlat;
  gl.useProgram(P.p);
  resetAttribs();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniformMatrix4fv(P.u.uVP, false, VP);
  gl.uniform3fv(P.u.uCamPos, cam.pos);
  gl.uniform3fv(P.u.uFogColor, FOG);
  gl.uniform1f(P.u.uFogNear, FOG_NEAR);
  gl.uniform1f(P.u.uFogFar, FOG_FAR);

  gl.bindBuffer(gl.ARRAY_BUFFER, FlatBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, FlatVerts.subarray(0, flatCount * 20));
  gl.enableVertexAttribArray(P.a.aPos); gl.vertexAttribPointer(P.a.aPos, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(P.a.aUv); gl.vertexAttribPointer(P.a.aUv, 2, gl.FLOAT, false, 20, 12);
  gl.uniform1f(P.u.uSoft, 1);

  for (let i = 0; i < FLATS.length; i++) {
    const f = FLATS[i];
    gl.uniform4f(P.u.uColor, f.r, f.g, f.b, f.a);
    gl.uniform1f(P.u.uSoft, f.soft);
    gl.drawArrays(gl.TRIANGLE_STRIP, i * 4, 4);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

const SPRITE_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function drawSprites() {
  if (!sprCount) return;
  const P = progSprite;
  gl.useProgram(P.p);
  resetAttribs();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniformMatrix4fv(P.u.uVP, false, VP);
  gl.uniform3fv(P.u.uCamPos, cam.pos);
  gl.uniform3fv(P.u.uFogColor, FOG);
  gl.uniform1f(P.u.uFogNear, FOG_NEAR);
  gl.uniform1f(P.u.uFogFar, FOG_FAR);

  // camera right/up for billboards
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  gl.uniform3f(P.u.uCamRight, cy, 0, -sy);
  gl.uniform3f(P.u.uCamUp, 0, 1, 0);

  const out = SprData;
  const corners = SPRITE_CORNERS;
  let n = 0;
  for (let i = 0; i < sprCount; i++) {
    const s = SPRS[i];
    for (let k = 0; k < 4; k++) {
      const o = n * 11;
      out[o] = s.x; out[o + 1] = s.y; out[o + 2] = s.z;
      out[o + 3] = s.r; out[o + 4] = s.g; out[o + 5] = s.b; out[o + 6] = s.a;
      out[o + 7] = corners[k][0]; out[o + 8] = corners[k][1];
      out[o + 9] = s.size; out[o + 10] = s.kind;
      n++;
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, SprBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, out.subarray(0, n * 11));
  const stride = 44;
  gl.enableVertexAttribArray(P.a.aPos); gl.vertexAttribPointer(P.a.aPos, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(P.a.aColor); gl.vertexAttribPointer(P.a.aColor, 4, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(P.a.aCorner); gl.vertexAttribPointer(P.a.aCorner, 2, gl.FLOAT, false, stride, 28);
  gl.enableVertexAttribArray(P.a.aSize); gl.vertexAttribPointer(P.a.aSize, 1, gl.FLOAT, false, stride, 36);
  gl.enableVertexAttribArray(P.a.aKind); gl.vertexAttribPointer(P.a.aKind, 1, gl.FLOAT, false, stride, 40);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, SprIdx);
  gl.drawElements(gl.TRIANGLES, sprCount * 6, gl.UNSIGNED_SHORT, 0);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

/* ---- player visuals: "Kurir Langit" — robot kecil berhelm + visor ---- */
const SUIT = C(0xf1ece0);      // helm & baju krem
const LIMB = C(0x2c3644);      // lengan/tulang abu gelap
const VISOR = C(0x101823);     // kaca visor
const GLOW = C(0x5ee7ff);      // lampu cyan
const ACCENT = C(0xff8a3d);    // aksen oranye

const playerParts = {
  torso: dynBox(0, 0, 0, 0.88, 0.78, 0.46, SUIT),
  chest: dynBox(0, 0, 0, 0.5, 0.3, 0.06, LIMB),
  chestGlow: dynBox(0, 0, 0, 0.3, 0.08, 0.03, GLOW),
  pack: dynBox(0, 0, 0, 0.6, 0.56, 0.24, LIMB),
  thrusterL: dynBox(0, 0, 0, 0.12, 0.12, 0.06, GLOW),
  thrusterR: dynBox(0, 0, 0, 0.12, 0.12, 0.06, GLOW),
  head: dynBox(0, 0, 0, 0.7, 0.58, 0.62, SUIT),
  visor: dynBox(0, 0, 0, 0.58, 0.24, 0.06, VISOR),
  visorGlow: dynBox(0, 0, 0, 0.42, 0.07, 0.03, GLOW),
  antenna: dynBox(0, 0, 0, 0.05, 0.3, 0.05, LIMB),
  antennaTip: dynBox(0, 0, 0, 0.12, 0.12, 0.12, ACCENT),
  armL: dynBox(0, 0, 0, 0.2, 0.62, 0.22, LIMB),
  armR: dynBox(0, 0, 0, 0.2, 0.62, 0.22, LIMB),
  gloveL: dynBox(0, 0, 0, 0.24, 0.18, 0.24, SUIT),
  gloveR: dynBox(0, 0, 0, 0.24, 0.18, 0.24, SUIT),
  legL: dynBox(0, 0, 0, 0.26, 0.7, 0.28, LIMB),
  legR: dynBox(0, 0, 0, 0.26, 0.7, 0.28, LIMB),
  bootL: dynBox(0, 0, 0, 0.3, 0.2, 0.42, SUIT),
  bootR: dynBox(0, 0, 0, 0.3, 0.2, 0.42, SUIT),
  toeL: dynBox(0, 0, 0, 0.24, 0.1, 0.12, ACCENT),
  toeR: dynBox(0, 0, 0, 0.24, 0.1, 0.12, ACCENT),
};


function updatePlayerVisuals(dt) {
  const p = player;
  const feet = p.y - PH.hy;
  const speed = Math.hypot(p.vx, p.vz);

  // arah hadap karakter
  if (speed > 1.2) {
    const targetYaw = Math.atan2(p.vx, p.vz);
    let d = targetYaw - p.faceYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.faceYaw += d * Math.min(1, dt * 14);
  }
  const yaw = p.faceYaw;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const WX = (ox, oz) => p.x + ox * cy + oz * sy;
  const WZ = (ox, oz) => p.z - ox * sy + oz * cy;

  if (p.grounded && speed > 0.6) {
    p.walk += dt * (4.2 + speed * 0.55);
    if (Math.sin(p.walk) * Math.sin(p.walk - 0.3) < 0 && Math.random() < 0.06) Sfx.step();
  } else {
    p.walk = damp(p.walk, Math.round(p.walk / Math.PI) * Math.PI, 10, dt);
  }
  const swingAmt = clamp(speed / 9, 0, 1);
  const swing = Math.sin(p.walk) * 0.8 * swingAmt;
  const air = !p.grounded;
  const armA = air ? -1.15 : -swing * 0.9;
  const armB = air ? -1.15 : swing * 0.9;
  const legA = air ? 0.5 : swing;
  const legB = air ? -0.3 : -swing;

  const vis = !p.hidden;
  const parts = playerParts;
  const bob = p.grounded ? Math.abs(Math.sin(p.walk)) * 0.04 * swingAmt : 0;
  const fy = feet + bob;

  const put = (part, ox, oy, oz, rx) => {
    part.x = WX(ox, oz); part.y = fy + oy; part.z = WZ(ox, oz);
    part.rx = rx || 0; part.ry = yaw; part.rz = 0;
    part.visible = vis;
  };

  const lean = air ? 0.1 : 0;
  put(parts.torso, 0, 1.22, 0, lean);
  put(parts.chest, 0, 1.24, 0.243, lean);
  put(parts.chestGlow, 0, 1.24, 0.268, lean);
  put(parts.pack, 0, 1.26, -0.34, lean);
  put(parts.thrusterL, -0.16, 1.0, -0.45, lean);
  put(parts.thrusterR, 0.16, 1.0, -0.45, lean);

  const headLean = air ? -0.08 : Math.sin(p.walk * 0.5) * 0.02;
  put(parts.head, 0, 1.92, 0, headLean);
  put(parts.visor, 0, 1.95, 0.31, headLean);
  put(parts.visorGlow, 0, 1.95, 0.342, headLean);

  const sway = Math.sin(p.walk) * 0.12 * swingAmt + (air ? -0.3 : 0);
  put(parts.antenna, 0.22, 2.36, -0.02, sway);
  put(parts.antennaTip, 0.22, 2.36 + 0.2 * Math.cos(sway), -0.02 + 0.2 * Math.sin(sway), sway);

  const seg = (part, ox, pivotY, ang, len) => {
    put(part, ox, pivotY - (len / 2) * Math.cos(ang), -(len / 2) * Math.sin(ang), ang);
  };
  const tip = (ox, pivotY, ang, len) => [ox, pivotY - len * Math.cos(ang), -len * Math.sin(ang)];

  seg(parts.armL, -0.56, 1.52, armA, 0.62);
  seg(parts.armR, 0.56, 1.52, armB, 0.62);
  let t = tip(-0.56, 1.52, armA, 0.64); put(parts.gloveL, t[0], t[1], t[2], armA);
  t = tip(0.56, 1.52, armB, 0.64); put(parts.gloveR, t[0], t[1], t[2], armB);

  seg(parts.legL, -0.22, 0.84, legA, 0.7);
  seg(parts.legR, 0.22, 0.84, legB, 0.7);

  const boot = (part, toe, ox, ang) => {
    const by = 0.84 - 0.7 * Math.cos(ang);
    const bz = -0.7 * Math.sin(ang);
    put(part, ox, by, bz, ang);
    const oy = -0.03, oz = 0.16;
    const ty = oy * Math.cos(ang) - oz * Math.sin(ang);
    const tz = oy * Math.sin(ang) + oz * Math.cos(ang);
    put(toe, ox, by + ty, bz + tz, ang);
  };
  boot(parts.bootL, parts.toeL, -0.22, legA);
  boot(parts.bootR, parts.toeR, 0.22, legB);
}

function groundYAt(x, z, fromY) {
  let best = -999;
  for (let i = 0; i < level.solids.length; i++) {
    const c = level.solids[i];
    if (!c.active) continue;
    if (c.type !== 'solid' && c.type !== 'bounce') continue;
    if (x > c.minx && x < c.maxx && z > c.minz && z < c.maxz && c.maxy <= fromY + 0.35 && c.maxy > best) best = c.maxy;
  }
  return best;
}

/* ---- update movers / blink / spinners ---- */
function updateWorld(dt) {
  const t = state.mode === 'menu' ? timeAcc * 0.4 : timeAcc;

  for (let i = 0; i < level.movers.length; i++) {
    const m = level.movers[i];
    const off = Math.sin(t * m.speed + m.phase) * m.amp;
    let nx = m.x0, ny = m.y0, nz = m.z0;
    if (m.axis === 'x') nx += off;
    else if (m.axis === 'y') ny += off;
    else nz += off;
    m.dx = nx - m.cx; m.dy = ny - m.cy; m.dz = nz - m.cz;
    m.cx = nx; m.cy = ny; m.cz = nz;

    const p = m.p, c = p.col;
    const sx = nx - p.x, sy = ny - p.top, sz = nz - p.z;
    if (sx || sy || sz) {
      for (let k = 0; k < p.parts.length; k++) {
        const b = p.parts[k];
        b.x += sx; b.y += sy; b.z += sz;
      }
      c.minx += sx; c.maxx += sx;
      c.miny += sy; c.maxy += sy;
      c.minz += sz; c.maxz += sz;
      p.x = nx; p.top = ny; p.z = nz;
    }
  }

  for (let i = 0; i < level.blinks.length; i++) {
    const b = level.blinks[i];
    const tt = (t + b.offset) % b.period;
    const on = tt < b.onTime;
    const warnT = on && tt > b.onTime - 0.75 ? (tt - (b.onTime - 0.75)) / 0.75 : 0;
    b.active = on;
    b.p.col.active = on;
    const cap = b.p.parts[1];
    cap.c = on ? mix3(b.p.capBase, PAL.kill, warnT * 0.85) : b.p.capBase;
    cap.visible = on;
    b.p.parts[0].visible = on;
    if (b.p.parts[2]) b.p.parts[2].visible = on;
  }

  for (let i = 0; i < level.spinners.length; i++) {
    const s = level.spinners[i];
    s.angle = s.phase + t * s.speed;
    s.bar.ry = s.angle;
  }

  // koin
  for (let i = 0; i < level.coins.length; i++) {
    const c = level.coins[i];
    if (c.taken) { c.box.visible = false; continue; }
    c.box.visible = true;
    c.box.ry = t * 2.4 + c.phase;
    c.box.y = c.y + Math.sin(t * 2 + c.phase) * 0.14;
  }

  // checkpoint visual
  for (let i = 0; i < level.checkpoints.length; i++) {
    const cp = level.checkpoints[i];
    cp.pad.c = cp.active ? PAL.cpOn : PAL.cpOff;
    cp.flag.c = cp.active ? PAL.cpOn : PAL.cpOff;
    cp.flag.ry = Math.sin(t * 2.2 + i) * 0.4;
    if (cp.glow > 0) cp.glow = Math.max(0, cp.glow - dt * 0.7);
  }
}

function buildFx(dt) {
  flatCount = 0; sprCount = 0;
  FLATS.length = 0; SPRS.length = 0;

  // lautan lava
  addFlat(0, CFG.lavaY, 0, 1400, [0.80, 0.185, 0.045], 1.0, false);
  addFlat(0, CFG.lavaY + 0.02, 0, 700, [1.0, 0.46, 0.09], 0.16, false);

  // shadow pemain
  const feet = player.y - PH.hy;
  const gy = groundYAt(player.x, player.z, feet + 0.2);
  if (gy > -900 && !player.hidden) {
    const h = clamp((feet - gy) / 9, 0, 1);
    addFlat(player.x, gy + 0.03, player.z, 0.95 - h * 0.35, [0.02, 0.05, 0.1], 0.42 * (1 - h * 0.8), true);
  }

  // glow checkpoint
  for (let i = 0; i < level.checkpoints.length; i++) {
    const cp = level.checkpoints[i];
    if (cp.glow > 0) addFlat(cp.x, cp.top + 0.05, cp.z, 3.2, PAL.cpOn, 0.35 * cp.glow, true);
    if (cp.active) addFlat(cp.x, cp.top + 0.04, cp.z, 2.2, PAL.cpOn, 0.14, true);
  }

  // glow goal
  if (level.goal) {
    const pulse = 0.5 + 0.5 * Math.sin(timeAcc * 2.4);
    addFlat(level.goal.x, level.goal.top + 0.04, level.goal.z, 4.6, PAL.gold, 0.2 + pulse * 0.12, true);
    addSprite(level.goal.x, level.goal.y, level.goal.z, 7.5, PAL.gold, 0.16, 1);
  }

  // partikel
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const a = clamp(p.life / p.max, 0, 1);
    addSprite(p.x, p.y, p.z, p.size, [p.r, p.g, p.b], a, p.kind);
  }
}

function projectPoint(x, y, z) {
  const v = [x, y, z, 1], out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) out[r] = VP[r] * v[0] + VP[4 + r] * v[1] + VP[8 + r] * v[2] + VP[12 + r] * v[3];
  const w = out[3] || 1e-6;
  return [out[0] / w, out[1] / w, out[2] / w];
}

function render() {
  const w = canvas.width, h = canvas.height;
  gl.viewport(0, 0, w, h);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.CULL_FACE);

  m4perspective(PROJ, CFG.fov * Math.PI / 180, w / h, 0.1, 900);
  m4lookAt(VIEW, cam.pos, cam.target, UP);
  m4mult(VP, PROJ, VIEW);

  drawSky();
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  drawStatic();
  drawDynBoxes();
  drawFlats();
  drawSprites();
  gl.depthMask(true);
}

function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.05);

  resize();
  if (!camInit) { snapCamera(); camInit = true; }

  timeAcc += dt;

  if (state.mode === 'playing') {
    state.time += dt;
    updateWorld(dt);
    if (player.dead > 0) {
      player.dead -= dt;
      if (player.dead <= 0) respawn();
      timeSlice = 0;
    } else {
      // terbawa platform bergerak
      if (player.ground && player.ground.mover && player.ground.active) {
        const m = player.ground.mover;
        player.x += m.dx; player.y += m.dy; player.z += m.dz;
      }
      timeSlice += dt;
      let steps = 0;
      while (timeSlice >= FIXED && steps < 6) {
        physics(FIXED);
        timeSlice -= FIXED;
        steps++;
        if (player.dead > 0) { timeSlice = 0; break; }
      }
      if (steps >= 6) timeSlice = 0;
    }
  } else {
    updateWorld(dt);
  }

  updatePlayerVisuals(dt);
  updateParticles(dt);
  buildFx(dt);
  updateCamera(dt);
  render();
  updateHud(dt);
}

let timeSlice = 0;
const FIXED = 1 / 120;

let hudTick = 0;
function updateHud(dt) {
  hudTick += dt;
  if (state.mode !== 'playing') return;
  dom.clock.textContent = fmtTime(state.time);
  const z = clamp((player.z + 10) / (level.endZ + 10), 0, 1);
  dom.fill.style.width = (z * 100).toFixed(1) + '%';
  dom.dot.style.left = (z * 100).toFixed(1) + '%';
  if (hudTick > 0.15) {
    hudTick = 0;
    const zone = zoneAt(player.z);
    if (zone !== hudZone) {
      if (hudZone) toast(zone.split('·')[0].trim() + ' · ' + (zone.split('·')[1] || '').trim());
      hudZone = zone;
      dom.zone.textContent = zone;
    }
  }
}

/* ---------------------------------------------------------------- boot */
function boot() {
  try {
    buildLevel();
    buildBuffers();
    state.best = loadBest();
    if (dom.best) dom.best.textContent = state.best ? fmtTime(state.best) : '—';
    updateDeaths(); updateCoins();

    $('btnPlay').addEventListener('click', startRun);
    $('btnAgain').addEventListener('click', startRun);
    $('btnRestart').addEventListener('click', () => { if (state.mode === 'playing' || state.mode === 'won') startRun(); });
    dom.soundBtn.addEventListener('click', toggleSound);

    snapCamera();
    lastT = performance.now();
    requestAnimationFrame(loop);

    if (location.search.indexOf('auto') >= 0) {
      setTimeout(startRun, 60);
    }
    window.__skyhop = { player, state, cam, level, startRun, projectPoint, respawn, SG, dynBoxes, PH, CFG, PAL };
  } catch (err) {
    showFatal(err && err.stack ? err.stack : err);
  }
}

/* dead code guard: variables used before definition inside functions are fine,
   but keep constants referenced at module init above their use. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
