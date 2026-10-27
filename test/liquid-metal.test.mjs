import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/liquid-metal.js', import.meta.url), 'utf8');
function setup({ noWebGL = false, deferImage = false, mobile = false, userAgent = '', reduced = false, missingObservers = false, legacyMedia = false, drawError = false } = {}) {
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
    const canvas = elements.get(selector); canvas.draws = 0; canvas.contexts = 0;
    canvas.getContext = () => { canvas.contexts++; return noWebGL ? null : new Proxy({}, { get: (_, name) => {
      if (['getShaderParameter', 'getProgramParameter'].includes(name)) return () => true;
      if (name === 'isContextLost') return () => false;
      if (name === 'drawArrays') return () => { if (drawError) throw new Error('GPU unavailable'); canvas.draws++; };
      return () => ({});
    }}); };
  }
  const doc = { hidden: false, querySelector: selector => elements.get(selector), handlers: {}, addEventListener(name, callback) { (this.handlers[name] ??= []).push(callback); } };
  vm.runInNewContext(source, { document: doc, Float32Array, devicePixelRatio: 1, navigator: { userAgent },
    Image: class {
      naturalWidth=1942; naturalHeight=809; complete=false;
      constructor() { images.push(this); }
      set src(value) { if (!deferImage) { this.complete=true; this.onload(); } }
    },
    matchMedia: query => ({ matches: query.includes('reduced-motion') ? reduced : mobile,
      ...(legacyMedia ? { addListener() {} } : { addEventListener() {} }) }),
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: missingObservers ? undefined : class { observe() {} },
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

test('mobile, WeChat and reduced-motion first paints allocate no GPU contexts or frames', () => {
  for (const options of [{ mobile: true }, { userAgent: 'MicroMessenger/8.0' }, { userAgent: 'iPhone' }, { reduced: true }]) {
    const ui = setup(options);
    assert.equal(ui.frames.size, 0);
    assert.equal(ui.images.length, 0);
    assert.equal(ui.elements.get('#liquid-metal').contexts, 0);
    assert.equal(ui.elements.get('#studio-liquid-metal').contexts, 0);
    assert.equal(ui.elements.get('#motion-toggle').textContent, '播放动态');
    ui.elements.get('#motion-toggle').handlers.click();
    assert.equal(ui.elements.get('#liquid-metal').contexts, 1);
    assert.equal(ui.elements.get('#studio-liquid-metal').contexts, 0);
    assert.equal(ui.frames.size, 1);
    ui.elements.get('#motion-toggle').handlers.click();
    assert.equal(ui.frames.size, 0);
  }
});

test('older WebViews use static artwork when observers are absent and support legacy media listeners', () => {
  const ui = setup({ missingObservers: true });
  assert.equal(ui.elements.get('#liquid-metal').contexts, 0);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.elements.get('#motion-toggle').hidden, true);
  assert.equal(setup({ legacyMedia: true }).frames.size, 2);
});

test('draw errors and sustained slow frames disable animation without retry loops', () => {
  const failed = setup({ drawError: true });
  assert.equal(failed.frames.size, 0);
  assert.equal(failed.elements.get('#motion-toggle').hidden, true);
  const ui = setup();
  for (let i = 0; i < 10; i++) ui.tick(250);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.elements.get('#motion-toggle').hidden, true);
  ui.doc.handlers.visibilitychange.forEach(callback => callback());
  assert.equal(ui.frames.size, 0);
});

test('lost GPU context returns to static artwork and stops rendering', () => {
  const ui = setup();
  ui.elements.get('#liquid-metal').handlers.webglcontextlost({ preventDefault() {} });
  assert.equal(ui.elements.get('#motion-toggle').hidden, true);
  assert.equal(ui.frames.size, 1);
  const draws = ui.elements.get('#liquid-metal').draws;
  ui.tick();
  assert.equal(ui.elements.get('#liquid-metal').draws, draws);
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
