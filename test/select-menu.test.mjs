import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/select-menu.js', import.meta.url), 'utf8');
function setup() {
  class Element {
    constructor() {
      this.children = []; this.handlers = {}; this.attrs = {}; this.hidden = false;
      const classes = new Set();
      this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, yes) => yes ? classes.add(c) : classes.delete(c) };
    }
    append(...nodes) { nodes.forEach(node => { this.children.push(node); node.parent = this; }); }
    before(node) { this.wrapper = node; }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k, fn) { (this.handlers[k] ||= []).push(fn); }
    dispatchEvent(event) { (this.handlers[event.type] || []).forEach(fn => fn(event)); }
    matches() { return disabled; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    focus() { this.focused = true; }
  }
  let disabled = false;
  const native = new Element();
  native.options = ['文案 + 配图 + 视频', '文案 + 配图', '只要文案'].map(textContent => ({ textContent }));
  native.selectedIndex = 0; native.labels = [{ id: 'want-label', htmlFor: 'want' }];
  Object.defineProperty(native, 'value', { get: () => native.options[native.selectedIndex].textContent });
  const doc = new Element(), win = new Element();
  doc.getElementById = id => id === 'want' ? native : null;
  doc.createElement = () => new Element();
  vm.runInNewContext(source, { document: doc, window: win, Event: class { constructor(type) { this.type = type; } }, setTimeout });
  const [, trigger, list] = native.wrapper.children;
  const fire = (element, type, properties = {}) => element.dispatchEvent({ type, preventDefault() {}, ...properties });
  return { native, trigger, list, doc, win, fire, disable: () => { disabled = true; } };
}
test('keyboard choice updates the native form value and emits change; Escape leaves selection intact', () => {
  const ui = setup(); let changes = 0;
  ui.native.addEventListener('change', () => changes++);
  ui.fire(ui.trigger, 'keydown', { key: 'ArrowDown' });
  ui.fire(ui.trigger, 'keydown', { key: 'End' });
  assert.equal(ui.native.value, '文案 + 配图 + 视频');
  ui.fire(ui.trigger, 'keydown', { key: 'Enter' });
  assert.equal(ui.native.value, '只要文案'); assert.equal(changes, 1);
  assert.equal(ui.list.hidden, true); assert.equal(ui.trigger.attrs['aria-expanded'], 'false');
  ui.fire(ui.trigger, 'click'); ui.fire(ui.trigger, 'keydown', { key: 'Home' });
  ui.fire(ui.trigger, 'keydown', { key: 'Escape' });
  assert.equal(ui.native.value, '只要文案'); assert.equal(changes, 1);
});
test('touch/click selection, outside click, Tab and navigation close the menu', () => {
  const ui = setup();
  ui.fire(ui.trigger, 'click'); ui.fire(ui.list.children[1], 'click');
  assert.equal(ui.native.value, '文案 + 配图'); assert.equal(ui.trigger.focused, true);
  for (const close of [() => ui.fire(ui.doc, 'pointerdown', { target: {} }), () => ui.fire(ui.trigger, 'keydown', { key: 'Tab' }), () => ui.fire(ui.win, 'hashchange')]) {
    ui.fire(ui.trigger, 'click'); assert.equal(ui.list.hidden, false); close(); assert.equal(ui.list.hidden, true);
  }
});
test('disabled form prevents opening and changing an already-open selection', () => {
  const ui = setup(); ui.fire(ui.trigger, 'click'); ui.disable();
  ui.fire(ui.list.children[2], 'click'); assert.equal(ui.native.value, '文案 + 配图 + 视频');
  ui.fire(ui.win, 'hashchange'); ui.fire(ui.trigger, 'click'); assert.equal(ui.list.hidden, true);
});
