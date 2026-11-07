/* Mock DOM + WebGL untuk menjalankan game.js di Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function bootGame(search) {
  const code = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
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
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, mkEl(id)); return elements.get(id); };

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
    addEventListener(t, fn) { (doc._h[t] = doc._h[t] || []).push(fn); },
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
    location: { search: search || '' },
    navigator: { maxTouchPoints: 0 },
  };

  let rafQueue = [];
  let nowMs = 0;
  const ctx = {
    console, Math, Date, JSON, Float32Array, Uint16Array, Uint32Array, Int32Array, Array, Object, String,
    Number, Boolean, Error, TypeError, RangeError, isFinite, isNaN, parseInt, parseFloat,
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

  return { ctx, step, key, errs, glCalls, get G() { return ctx.__skyhop; } };
}

module.exports = { bootGame };
