import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/liquid-metal.js', import.meta.url), 'utf8');
function setup({ noWebGL = false, deferImage = false } = {}) {
  const images = [];
  const frames = new Map(), mutations = new Map(), intersections = new Map();
  let id = 0;
  const elements = new Map();
  const element = () => ({ hidden: false, handlers: {}, attributes: {}, textContent: '', classList: { add() {}, remove() {}, toggle() {} },
    getBoundingClientRect: () => ({ width: 400, height: 300 }),
    addEventListener(name, callback) { this.handlers[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector() { return this; },
  });
  for (const selector of ['#liquid-metal', '.metal-hero', '#motion-toggle', '#studio-liquid-metal', '#studio-visual', '#studio-motion-toggle']) elements.set(selector, element());
  for (const selector of ['#liquid-metal', '#studio-liquid-metal']) {
    const canvas = elements.get(selector); canvas.draws = 0;
    canvas.getContext = () => noWebGL ? null : new Proxy({}, { get: (_, name) => {
      if (['getShaderParameter', 'getProgramParameter'].includes(name)) return () => true;
      if (name === 'isContextLost') return () => false;
      if (name === 'drawArrays') return () => canvas.draws++;
      return () => ({});
    }});
  }
  const doc = { hidden: false, querySelector: selector => elements.get(selector), handlers: {}, addEventListener(name, callback) { (this.handlers[name] ??= []).push(callback); } };
  vm.runInNewContext(source, { document: doc, Float32Array, devicePixelRatio: 1,
    Image: class {
      naturalWidth=1942; naturalHeight=809; complete=false;
      constructor() { images.push(this); }
      set src(value) { if (!deferImage) { this.complete=true; this.onload(); } }
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { observe() {} },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(root) { mutations.set(root, this.callback); } },
    IntersectionObserver: class { constructor(callback) { this.callback = callback; } observe(root) { intersections.set(root, this.callback); } },
  });
  let now = 0;
  const tick = (elapsed = 34) => { now += elapsed; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); };
  return { elements, frames, mutations, intersections, doc, tick, images };
}

test('preview hiding stops its drawing, preserves the cover, and resumes on retry', () => {
  const ui = setup(), visual = ui.elements.get('#studio-visual'), preview = ui.elements.get('#studio-liquid-metal'), cover = ui.elements.get('#liquid-metal');
  assert.equal(ui.frames.size, 2);
  ui.tick(); const previewDraws = preview.draws, coverDraws = cover.draws;
  visual.hidden = true; ui.mutations.get(visual)(); ui.tick();
  assert.equal(preview.draws, previewDraws);
  assert.ok(cover.draws > coverDraws);
  assert.equal(ui.frames.size, 1);
  visual.hidden = false; ui.mutations.get(visual)(); ui.tick();
  assert.ok(preview.draws > previewDraws);
  assert.equal(ui.frames.size, 2);
  ui.intersections.get(visual)([{ isIntersecting: false }]);
  const offscreenDraws = preview.draws; ui.tick(); assert.equal(preview.draws, offscreenDraws);
  ui.doc.hidden = true; ui.doc.handlers.visibilitychange.forEach(callback => callback());
  assert.equal(ui.frames.size, 0);
});

test('unavailable WebGL keeps both fallback illustrations and hides motion controls', () => {
  const ui = setup({ noWebGL: true });
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.elements.get('#motion-toggle').hidden, true);
  assert.equal(ui.elements.get('#studio-motion-toggle').hidden, true);
});

test('cover waits for its texture and an image failure leaves studio animation running', () => {
  const ui = setup({ deferImage: true });
  const cover = ui.elements.get('#liquid-metal');
  assert.equal(ui.frames.size, 1);
  ui.tick();
  assert.equal(cover.draws, 0);
  ui.images[0].onerror();
  assert.equal(ui.elements.get('#motion-toggle').hidden, true);
  assert.equal(ui.frames.size, 1);
  assert.ok(ui.elements.get('#studio-liquid-metal').draws > 0);
});

test('studio rendering is capped at 30 fps on high-refresh displays', () => {
  const ui = setup();
  ui.tick();
  const preview = ui.elements.get('#studio-liquid-metal'), before = preview.draws;
  for (let i = 0; i < 120; i++) ui.tick(1000 / 120);
  assert.ok(preview.draws - before <= 31);
  assert.ok(preview.draws - before >= 29);
});
