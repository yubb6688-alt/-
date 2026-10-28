import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.handlers = {}; this.textContent = ''; this.value = ''; this.hidden = false; this.style = {}; this.attributes = {}; this.offsetLeft = 0; this.offsetWidth = 0; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  reportValidity() { return true; }
  setCustomValidity(value) { this.validityMessage = value; }
  focus() { this.focused = true; }
  scrollIntoView(options) { this.scrolled = options; }
  set innerHTML(value) { throw new Error('Generated text must never enter innerHTML'); }
}
function setup({ narrow = false } = {}) {
  const elements = new Map(), timers = new Map(); let counter = 0, time = 1000000;
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const context = vm.createContext({ document: { getElementById: get, createElement: tag => new Element(tag) }, URL, AbortController, navigator: { clipboard: { writeText: async () => {} } }, Date: { now: () => time }, setInterval(fn, ms) { const id = ++counter; timers.set(id, { fn, ms, interval: true }); return id; }, clearInterval(id) { timers.delete(id); }, setTimeout(fn, ms) { const id = ++counter; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, fetch: async () => ({ ok: true, json: async () => ({ id: 'run-1' }) }) });
  context.location = { hash: '' };
  context.window = { handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  context.matchMedia = query => ({ matches: query.includes('max-width') ? narrow : false });
  vm.runInContext(source, context);
  return { get, context, timers, setTime: value => { time = value; }, run: code => vm.runInContext(code, context) };
}
const flatten = element => [element.textContent, ...element.children.map(flatten)].join(' ');
const find = (element, tag) => [element, ...element.children.flatMap(child => find(child, tag))].filter(e => e.tag === tag);
test('home, brief and result are separate screens; navigation preserves an active job', async () => {
  const ui = setup();
  assert.equal(ui.get('home-page').hidden, false);
  assert.equal(ui.get('studio').hidden, true);
  ui.context.location.hash = '#studio'; ui.context.window.handlers.hashchange();
  assert.equal(ui.get('home-page').hidden, true);
  assert.equal(ui.get('brief-page').hidden, false);
  assert.equal(ui.get('result-page').hidden, true);
  ui.get('audience').value = '上班族';
  await ui.get('generate-form').handlers.submit({ preventDefault() {} });
  assert.equal(ui.context.location.hash, '#result');
  assert.equal(ui.get('brief-page').hidden, true);
  assert.equal(ui.get('result-page').hidden, false);
  ui.context.location.hash = '#studio'; ui.context.window.handlers.hashchange();
  assert.equal(ui.get('form-fields').disabled, true);
  assert.equal(ui.get('current-run-link').hidden, false);
  assert.match(ui.get('current-run-link').textContent, /查看生成进度/);
  assert.match(ui.get('return-brief-link').textContent, /返回查看需求/);
  ui.context.location.hash = '#result'; ui.context.window.handlers.hashchange();
  assert.equal(ui.get('progress-state').hidden, false);
});
test('mobile submission brings the generation progress into view', async () => {
  const ui = setup({ narrow: true });
  ui.get('audience').value = '上班族';
  await ui.get('generate-form').handlers.submit({ preventDefault() {} });
  assert.equal(ui.get('output-title').focused, true);
  assert.equal(ui.get('output-title').scrolled.block, 'start');
  assert.equal(ui.get('progress-state').hidden, false);
});
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
  assert.equal(ui.get('studio-visual').hidden, true);
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
  assert.equal(ui.get('studio-visual').hidden, true);
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
  assert.equal(ui.get('studio-visual').hidden, false);
  await [...ui.timers.values()].find(t => t.ms === 5000).fn();
  assert.equal(ui.get('status-badge').textContent, '自动通过'); assert.equal(ui.timers.size, 0);
  assert.equal(ui.get('studio-visual').hidden, true);
  assert.equal(ui.get('results').hidden, false);
  assert.match(ui.get('current-run-link').textContent, /查看本次结果/);
  await ui.get('generate-form').handlers.submit({ preventDefault() {} });
  assert.equal(starts, 2);
  assert.equal(ui.get('studio-visual').hidden, false);
  assert.equal(ui.get('results').hidden, true);
});

test('temporary network failures back off and recover the same run without a second POST', async () => {
  const ui = setup(); let starts = 0, polls = 0;
  ui.get('audience').value = '上班族'; ui.get('want').value = '只要文案';
  ui.context.fetch = async path => {
    if (path === '/api/start') { starts++; return { ok: true, json: async () => ({ id: 'run-original' }) }; }
    assert.equal(path, '/api/status?id=run-original');
    if (++polls <= 2) throw new TypeError('Network connection lost');
    return { ok: true, json: async () => ({ status: 'succeeded', outputs: { result: '{"verdict":"自动通过"}' } }) };
  };
  await ui.get('generate-form').handlers.submit({ preventDefault() {} });
  const poll = [...ui.timers.values()].find(t => t.ms === 5000).fn;
  await poll();
  assert.equal(ui.get('status-badge').textContent, '正在重连');
  assert.equal(ui.get('form-fields').disabled, true);
  assert.match(flatten(ui.get('state-message')), /5 秒/);
  await poll(); assert.equal(polls, 1);
  ui.setTime(1005000); await poll();
  assert.match(flatten(ui.get('state-message')), /10 秒/);
  ui.setTime(1010000); await poll(); assert.equal(polls, 2);
  ui.setTime(1015000); await poll();
  assert.equal(polls, 3); assert.equal(starts, 1);
  assert.equal(ui.get('status-badge').textContent, '自动通过');
  assert.equal(ui.get('state-message').children.length, 0);
  assert.equal(ui.get('results').hidden, false);
  assert.equal(ui.timers.size, 0);
});

test('gateway HTML errors retry but authentication and valid malformed JSON responses stop', async () => {
  for (const [status, retry] of [[503, true], [401, false], [200, false]]) {
    const ui = setup(); ui.get('audience').value = '上班族';
    ui.context.fetch = async path => path === '/api/start'
      ? { ok: true, json: async () => ({ id: 'run-1' }) }
      : { status, ok: status === 200, json: async () => { if (status === 401) return { error: '口令不正确' }; throw new SyntaxError('Invalid JSON'); } };
    await ui.get('generate-form').handlers.submit({ preventDefault() {} });
    await [...ui.timers.values()].find(t => t.ms === 5000).fn();
    assert.equal(ui.get('status-badge').textContent, retry ? '正在重连' : '生成未完成');
    assert.equal(ui.get('form-fields').disabled, retry);
  }
});

test('reconnection respects the original deadline, ignores late responses, and never retries POST', async () => {
  const ui = setup(); ui.get('audience').value = '上班族'; let starts = 0, rejectPoll;
  ui.context.fetch = async path => {
    if (path === '/api/start') { starts++; return { ok: true, json: async () => ({ id: 'run-1' }) }; }
    return new Promise((_resolve, reject) => { rejectPoll = reject; });
  };
  await ui.get('generate-form').handlers.submit({ preventDefault() {} });
  const pending = [...ui.timers.values()].find(t => t.ms === 5000).fn();
  ui.setTime(1360000);
  [...ui.timers.values()].find(t => t.ms === 360000).fn();
  rejectPoll(new TypeError('Offline')); await pending;
  assert.equal(ui.get('status-badge').textContent, '等待超时');
  assert.equal(ui.timers.size, 0); assert.equal(starts, 1);
  const offline = setup(); offline.get('audience').value = '上班族'; let attempts = 0;
  offline.context.fetch = async () => { attempts++; throw new TypeError('Offline'); };
  await offline.get('generate-form').handlers.submit({ preventDefault() {} });
  assert.equal(attempts, 1); assert.equal(offline.timers.size, 0);
  assert.match(flatten(offline.get('state-message')), /避免重复生成/);
});
