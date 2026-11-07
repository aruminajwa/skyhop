/* Dev harness: menjalankan game.js di Node dengan DOM + WebGL tiruan.
   Jalankan: node tools/test.js                                            */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

/* ---------------- mock DOM ---------------- */
const elements = new Map();
function mkEl(id) {
  const handlers = Object.create(null);
  return {
    id, style: {}, textContent: '', innerHTML: '', width: 1280, height: 760,
    clientWidth: 1280, clientHeight: 720, readyState: 'complete',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    removeEventListener() { },
    dispatch(t, ev) { (handlers[t] || []).forEach((fn) => fn(ev || {})); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 132, height: 132 }; },
    setPointerCapture() { }, releasePointerCapture() { },
    requestPointerLock() { }, exitPointerLock() { },
    getContext() { return null; },
  };
}
function getEl(id) {
  if (!elements.has(id)) elements.set(id, mkEl(id));
  return elements.get(id);
}

const glCalls = { drawElements: 0, drawArrays: 0, buffers: 0 };
const GL = {
  ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, STATIC_DRAW: 3, DYNAMIC_DRAW: 4, FLOAT: 5,
  UNSIGNED_SHORT: 6, VERTEX_SHADER: 7, FRAGMENT_SHADER: 8, COMPILE_STATUS: 9, LINK_STATUS: 10,
  ACTIVE_UNIFORMS: 11, ACTIVE_ATTRIBUTES: 12, TRIANGLES: 13, TRIANGLE_STRIP: 14,
  DEPTH_TEST: 15, CULL_FACE: 16, BLEND: 17, SRC_ALPHA: 18, ONE_MINUS_SRC_ALPHA: 19,
  COLOR_BUFFER_BIT: 20, DEPTH_BUFFER_BIT: 21, LEQUAL: 22, LESS: 23, TEXTURE_2D: 24,
};
const gl = new Proxy({}, {
  get(t, k) {
    if (k in GL) return GL[k];
    if (k in t) return t[k];
    return (...args) => {
      if (k === 'drawElements' || k === 'drawArrays') glCalls[k]++;
      if (k === 'createBuffer') { glCalls.buffers++; return {}; }
      if (k === 'getShaderParameter') return true;
      if (k === 'getProgramParameter') return args[1] === GL.LINK_STATUS ? true : 0;
      if (k === 'getAttribLocation') return 0;
      if (k === 'getUniformLocation') return {};
      return {};
    };
  },
});

const canvasEl = getEl('gl');
canvasEl.getContext = () => gl;

const doc = {
  readyState: 'complete',
  body: mkEl('body'),
  getElementById: getEl,
  querySelector: (s) => getEl(s),
  createElement: (t) => mkEl(t),
  _h: Object.create(null),
  addEventListener: (t, fn) => { (doc._h[t] = doc._h[t] || []).push(fn); },
  exitPointerLock() { },
  pointerLockElement: null,
};

const winHandlers = Object.create(null);
const win = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener(t, fn) { (winHandlers[t] = winHandlers[t] || []).push(fn); },
  removeEventListener() { },
  localStorage: {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
  },
  requestAnimationFrame: () => 0,
  location: { search: '' },
  navigator: { maxTouchPoints: 0 },
};

let rafQueue = [];
let nowMs = 0;
const ctx = {
  console, Math, Date, JSON, Float32Array, Uint16Array, Uint32Array, Int32Array, Array, Object, String, Number,
  Boolean, Error, TypeError, RangeError, isFinite, isNaN, parseInt, parseFloat,
  setTimeout, clearTimeout, setInterval, clearInterval,
  document: doc, navigator: win.navigator, localStorage: win.localStorage,
  location: win.location, performance: { now: () => nowMs },
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
  AudioContext: undefined, webkitAudioContext: undefined,
  addEventListener: win.addEventListener,
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

const errs = [];
try {
  vm.runInContext(code, ctx, { filename: 'game.js' });
} catch (e) {
  errs.push('LOAD: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e));
}

function step(frames, msPerFrame) {
  msPerFrame = msPerFrame || 16.7;
  for (let f = 0; f < frames; f++) {
    nowMs += msPerFrame;
    const q = rafQueue; rafQueue = [];
    for (const cb of q) {
      try { cb(nowMs); } catch (e) { errs.push('FRAME: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e)); return; }
    }
  }
}
function key(type, code) {
  (winHandlers[type] || []).forEach((fn) => fn({ code, repeat: false, preventDefault() { } }));
}
function check(name, cond, info) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '   [' + info + ']' : ''));
  if (!cond) errs.push('ASSERT: ' + name + (info !== undefined ? ' [' + info + ']' : ''));
}

const G = ctx.__skyhop;
step(30);
check('boot ok / __skyhop ada', !!G);
if (G) {
  const p = G.player;
  check('render jalan', glCalls.drawElements > 100, glCalls.drawElements + ' drawElements');
  G.startRun();
  step(40);
  check('spawn di atas pulau', Math.abs(p.y - 1.06) < 0.06 && p.grounded, 'y=' + p.y.toFixed(2));

  /* kamera: pemain harus terproyeksi dekat tengah layar */
  const ndc = G.projectPoint(p.x, p.y, p.z);
  check('kamera menghadap pemain', Math.abs(ndc[0]) < 0.35 && Math.abs(ndc[1]) < 0.55 && ndc[2] > -1 && ndc[2] < 1,
    ndc.map((v) => v.toFixed(2)).join(','));

  /* --- lompat --- */
  G.startRun();
  step(20);
  const y0 = p.y;
  key('keydown', 'Space');
  step(12);
  key('keyup', 'Space');
  check('lompat naik', p.y > y0 + 1.0, 'y0=' + y0.toFixed(2) + ' y=' + p.y.toFixed(2));
  step(60);
  check('mendarat lagi', p.grounded && Math.abs(p.y - 1.06) < 0.06, 'y=' + p.y.toFixed(2));

  /* --- checkpoint --- */
  G.startRun(); step(5);
  p.x = 0; p.z = 44; p.y = 6.06; p.vx = p.vy = p.vz = 0;
  step(6);
  const cp1 = G.level.checkpoints[0];
  check('checkpoint 1 aktif', cp1.active && Math.abs(G.state.respawn.z - 44) < 0.01, 'z=' + G.state.respawn.z);

  /* --- mati lava + respawn di checkpoint --- */
  const d0 = G.state.deaths;
  p.x = 30; p.y = 10; p.z = 60;
  step(90);
  check('mati jatuh & respawn', G.state.deaths > d0 && Math.abs(p.z - 44) < 0.6, 'deaths=' + G.state.deaths + ' z=' + p.z.toFixed(2));

  /* --- platform bergerak ikut membawa pemain --- */
  G.startRun(); step(6);
  const m0 = G.level.movers[0];
  p.x = m0.cx; p.z = m0.cz; p.y = m0.cy + 1.06 + 0.02; p.vx = p.vy = p.vz = 0;
  step(6);
  const xA = p.x;
  step(40);
  check('ikut platform bergerak', Math.abs(p.x - m0.cx) < 0.6 && Math.abs(p.x - xA) > 0.2,
    'x=' + p.x.toFixed(2) + ' mover=' + m0.cx.toFixed(2));

  /* --- trampolin --- */
  G.startRun(); step(6);
  p.x = 0; p.z = 168.5; p.y = 12.4; p.vx = 0; p.vy = 0; p.vz = 0;
  key('keydown', 'KeyW');
  let maxY = 0;
  for (let i = 0; i < 160; i++) { step(1); maxY = Math.max(maxY, p.y); }
  key('keyup', 'KeyW');
  check('trampolin melempar ke platform tinggi', maxY > 18.5, 'maxY=' + maxY.toFixed(2));
  check('mendarat di platform tinggi', p.grounded && p.y > 18.5 && p.z > 173 && p.z < 185,
    'y=' + p.y.toFixed(2) + ' z=' + p.z.toFixed(2));

  /* --- pisau putar membunuh --- */
  G.startRun(); step(6);
  const d1 = G.state.deaths;
  p.x = 0; p.z = 104; p.y = 9.06;
  step(12);
  check('pisau putar mematikan', G.state.deaths > d1, 'deaths=' + G.state.deaths);

  /* --- kill tile --- */
  G.startRun(); step(6);
  const d2 = G.state.deaths;
  p.x = -3.2; p.z = 81.0; p.y = 7.2 + 1.06 + 1.6; p.vx = p.vy = p.vz = 0;
  step(40);
  check('ubin merah mematikan', G.state.deaths > d2, 'deaths=' + G.state.deaths);

  /* --- blink platform: padam & menyala lagi --- */
  G.startRun(); step(4);
  let sawOn = false, sawOff = false;
  for (let i = 0; i < 400; i++) { step(1); if (G.level.blinks[0].active) sawOn = true; else sawOff = true; }
  check('platform hilang muncul bergantian', sawOn && sawOff, 'on=' + sawOn + ' off=' + sawOff);

  /* --- finish --- */
  G.startRun(); step(6);
  p.x = 0; p.z = 192; p.y = 19.5; p.vx = p.vy = p.vz = 0;
  step(6);
  check('menyentuh finish = menang', G.state.mode === 'won', 'mode=' + G.state.mode);

  /* --- jarak lompat antar platform utama --- */
  let prev = null, worst = 0, worstTo = '';
  for (const pl of G.level.solids) {
    if (!pl.platform) continue;
  }
  console.log('info: solids=' + G.level.solids.length + ' movers=' + G.level.movers.length +
    ' blinks=' + G.level.blinks.length + ' cp=' + G.level.checkpoints.length + ' coins=' + G.level.coins.length);
}

step(20);
if (errs.length) {
  console.log('\n=== ERRORS (' + errs.length + ') ===');
  errs.slice(0, 6).forEach((e) => console.log(e));
  process.exit(1);
} else {
  console.log('\nALL OK');
}
