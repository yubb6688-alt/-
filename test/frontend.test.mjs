import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.handlers = {}; this.textContent = ''; this.value = ''; this.hidden = false; }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  reportValidity() { return true; }
  setCustomValidity(value) { this.validityMessage = value; }
  set innerHTML(value) { throw new Error('Generated text must never enter innerHTML'); }
}
function setup() {
  const elements = new Map(), timers = new Map(); let counter = 0, time = 1000000;
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const context = vm.createContext({ document: { getElementById: get, createElement: tag => new Element(tag) }, URL, AbortController, navigator: { clipboard: { writeText: async () => {} } }, Date: { now: () => time }, setInterval(fn, ms) { const id = ++counter; timers.set(id, { fn, ms, interval: true }); return id; }, clearInterval(id) { timers.delete(id); }, setTimeout(fn, ms) { const id = ++counter; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, fetch: async () => ({ ok: true, json: async () => ({ id: 'run-1' }) }) });
  vm.runInContext(source, context);
  return { get, context, timers, setTime: value => { time = value; }, run: code => vm.runInContext(code, context) };
}
const flatten = element => [element.textContent, ...element.children.map(flatten)].join(' ');
const find = (element, tag) => [element, ...element.children.flatMap(child => find(child, tag))].filter(e => e.tag === tag);
test('automatic approval renders all three text sections, treats hostile strings as literal text and blocks unsafe URLs', () => {
  const ui = setup();
  ui.context.outputs = { verdict: '自动通过', result: JSON.stringify({ verdict: '自动通过', xhs: { title: '<img src=x onerror=alert(1)>', body: '<script>attack()</script>', tags: ['#猫'] }, douyin: { script: '口播' }, detail: { headline: '主标题', points: ['1', '2', '3'], price: '价格条' }, image_url: 'javascript:alert(1)', video_url: 'https://example.com/video.mp4', video_desc: '<b>镜头</b>' }) };
  ui.run('renderOutputs(outputs, "文案 + 配图 + 视频")');
  const rendered = flatten(ui.get('results'));
  for (const value of ['<img src=x onerror=alert(1)>', '<script>attack()</script>', '口播', '价格条', '<b>镜头</b>']) assert.ok(rendered.includes(value));
  assert.equal(find(ui.get('results'), 'img').length, 0);
  const videos = find(ui.get('results'), 'video'); assert.equal(videos.length, 1); assert.equal(videos[0].controls, true);
});
test('manual review withholds content even when verdict fields conflict', () => {
  const ui = setup(); ui.context.outputs = { verdict: '转人工', result: JSON.stringify({ verdict: '自动通过', reason: '<b>参数需核实</b>', xhs: { title: '不应该显示' } }) };
  ui.run('renderOutputs(outputs, "只要文案")');
  assert.ok(flatten(ui.get('state-message')).includes('<b>参数需核实</b>'));
  assert.equal(ui.get('results').children.length, 0); assert.equal(ui.get('status-badge').textContent, '转人工');
});
test('invalid JSON and unknown verdict fail explicitly', () => {
  const ui = setup();
  assert.throws(() => ui.run('renderOutputs({result:"invalid"}, "只要文案")'), /JSON/);
  assert.throws(() => ui.run('renderOutputs({result:"{}"}, "只要文案")'), /审核结论/);
});
test('5-second polling interval and hard 6-minute timeout restore the form and abort work', async () => {
  const ui = setup();
  for (const [key, value] of Object.entries({ product: 'T20 Pro 月白', campaign: '双 11', audience: '小户型', want: '只要文案', shot: '', 'access-code': 'test-only-code' })) ui.get(key).value = value;
  await ui.get('generate-form').handlers.submit({ preventDefault() {} });
  assert.equal(ui.get('form-fields').disabled, true);
  assert.ok([...ui.timers.values()].some(t => t.interval && t.ms === 5000));
  const timeout = [...ui.timers.values()].find(t => t.ms === 360000);
  assert.ok(timeout); ui.setTime(1360000); timeout.fn();
  assert.equal(ui.get('form-fields').disabled, false);
  assert.equal(ui.get('progress-state').hidden, true);
  assert.ok(flatten(ui.get('state-message')).includes('已等待 6 分钟'));
  assert.equal(ui.timers.size, 0);
});
test('poll success stops all timers, and a duplicate submit does not create a second run', async () => {
  const ui = setup(); let starts = 0;
  ui.get('audience').value = '上班族'; ui.get('want').value = '只要文案';
  ui.context.fetch = async path => ({ ok: true, json: async () => path === '/api/start' ? (starts++, { id: 'run-1' }) : { status: 'succeeded', outputs: { result: '{"verdict":"自动通过"}' } } });
  await ui.get('generate-form').handlers.submit({ preventDefault() {} });
  await ui.get('generate-form').handlers.submit({ preventDefault() {} });
  assert.equal(starts, 1);
  await [...ui.timers.values()].find(t => t.ms === 5000).fn();
  assert.equal(ui.get('status-badge').textContent, '自动通过'); assert.equal(ui.timers.size, 0);
});
