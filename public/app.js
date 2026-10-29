const $ = id => document.getElementById(id);
const form = $('generate-form');
let active = null;
const ARCHIVE_KEY = 'seed-studio.archive.v1';
let archiveStorageWarning = '';
let archiveRecords = readArchive();
let archiveSelected = archiveRecords[0]?.id || null;

function updateNavIndicator() {
  const link = $(location.hash === '#archive' ? 'nav-archive' : location.hash === '#studio' || location.hash === '#result' ? 'nav-studio' : 'nav-home');
  const indicator = $('nav-indicator');
  indicator.style.width = `${link.offsetWidth}px`;
  indicator.style.transform = `translateX(${link.offsetLeft}px)`;
  indicator.style.opacity = link.offsetWidth ? '1' : '0';
}

// Hash navigation keeps the in-flight job and its access code in this page's memory.
function showPage(page, focus = false) {
  const home = page === 'home';
  const result = page === 'result';
  const archive = page === 'archive';
  $('home-page').hidden = !home;
  $('archive-page').hidden = !archive;
  $('studio').hidden = home || archive;
  $('studio').className = result ? 'page-result' : 'page-brief';
  $('brief-page').hidden = home || result || archive;
  $('result-page').hidden = home || !result;
  for (const [id, selected] of [['nav-home', home], ['nav-studio', !home && !archive], ['nav-archive', archive]]) {
    $(id).className = selected ? 'nav-active' : '';
    $(id).setAttribute('aria-current', selected ? 'page' : 'false');
  }
  if (archive) renderArchive();
  updateNavIndicator();
  if (focus) {
    const target = archive ? $('archive-title') : result ? $('output-title') : home ? $('hero-title') : $('brief-title');
    target.focus({ preventScroll: true });
    (result ? target : $('top')).scrollIntoView({ block: 'start', behavior: 'auto' });
  }
}
function pageFromHash() {
  return location.hash === '#archive' ? 'archive' : location.hash === '#result' ? 'result' : location.hash === '#studio' ? 'studio' : 'home';
}
window.addEventListener('hashchange', () => showPage(pageFromHash(), true));
window.addEventListener('resize', updateNavIndicator);
window.addEventListener('load', updateNavIndicator);
showPage(pageFromHash());

for (const name of ['audience', 'shot']) $(name).addEventListener('input', () => {
  $(`${name}-count`).textContent = `${[...$(name).value].length} / ${name === 'audience' ? 60 : 500}`;
});

// All generated text is inserted as text nodes. It is never parsed as HTML.
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = typeof text === 'string' ? text : String(text);
  if (className) element.className = className;
  return element;
}
function badge(text, kind = '', prefix = '') { $(prefix + 'status-badge').textContent = text; $(prefix + 'status-badge').className = `badge ${kind}`; }
function notice(title, message, prefix = '') {
  const box = node('div', null, 'notice');
  box.append(node('strong', title), node('span', message));
  $(prefix + 'state-message').replaceChildren(box);
}
function stop(job) {
  if (active !== job) return;
  clearInterval(job.clock); clearInterval(job.poll); clearTimeout(job.deadline);
  job.controller.abort(); active = null;
  $('form-fields').disabled = false; $('button-label').textContent = '重新生成';
  $('current-run-link').textContent = '查看本次结果 →';
  $('return-brief-link').textContent = '← 返回修改需求';
  $('progress-state').hidden = true;
  $('studio-visual').hidden = true;
}
function text(value) { return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value); }
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function card(title, content, copyText) {
  const section = node('section', null, 'result-card');
  const heading = node('div', null, 'result-card-head');
  heading.append(node('h3', title));
  if (copyText) {
    const copy = node('button', '复制', 'copy-button'); copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(copyText); copy.textContent = '已复制'; }
      catch { copy.textContent = '请选中文字复制'; }
      setTimeout(() => { copy.textContent = '复制'; }, 2500);
    });
    heading.append(copy);
  }
  section.append(heading, content); return section;
}
function mediaCard(kind, value, description) {
  const body = node('div', null, 'result-body');
  const url = safeUrl(value);
  if (url) {
    const media = node(kind === 'image' ? 'img' : 'video', null, 'result-media');
    if (kind === 'image') { media.alt = '生成的商品配图'; media.loading = 'lazy'; media.referrerPolicy = 'no-referrer'; }
    else { media.controls = true; media.preload = 'metadata'; media.playsInline = true; }
    media.src = url;
    media.addEventListener('error', () => { media.hidden = true; body.prepend(node('p', '媒体暂时无法加载，请尝试打开原链接。')); }, { once: true });
    const link = node('a', '打开原链接 ↗', 'media-link'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    body.append(media, link);
  } else body.append(node('p', value ? '媒体链接无效，暂时无法展示。' : '本次未返回该素材。'));
  if (description) body.append(node('p', text(description), 'media-note'));
  return card(kind === 'image' ? '商品配图' : '种草视频', body);
}
function renderOutputs(outputs, want, prefix = '') {
  if (!prefix) $('studio-visual').hidden = true;
  if (!outputs || typeof outputs !== 'object') throw new Error('工作流没有返回结果，请联系管理员检查输出配置。');
  let result = {};
  try { result = typeof outputs.result === 'string' ? JSON.parse(outputs.result) : outputs.result ?? {}; }
  catch {
    if (outputs.verdict === '转人工') { badge('转人工', 'warning', prefix); notice('这次内容需要人工确认', '结果格式异常，未能读取转人工原因。', prefix); return; }
    throw new Error('工作流返回的 result 不是有效 JSON，请检查输出配置。');
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('工作流结果格式不正确。');
  // If either verdict requires review, withhold all generated material.
  if (result.verdict === '转人工' || outputs.verdict === '转人工') {
    badge('转人工', 'warning', prefix); notice('这次内容需要人工确认', text(result.reason) || text(result.error) || '工作流未提供原因，请联系人工审核。', prefix); return;
  }
  const verdict = result.verdict || outputs.verdict;
  if (verdict !== '自动通过') throw new Error(text(result.reason || result.error) || '工作流未返回有效审核结论，请联系管理员确认。');
  badge('自动通过', 'success', prefix);
  const stack = node('div', null, 'result-stack');
  const xhs = result.xhs || {}, douyin = result.douyin || {}, detail = result.detail || {};
  const tags = Array.isArray(xhs.tags) ? xhs.tags.map(text).join(' ') : text(xhs.tags);
  const xhsBody = node('div', null, 'result-body');
  xhsBody.append(node('strong', text(xhs.title) || '未返回标题', 'result-title'), node('p', text(xhs.body) || '未返回正文'), node('div', tags, 'tags'));
  stack.append(card('小红书笔记', xhsBody, [text(xhs.title), text(xhs.body), tags].filter(Boolean).join('\n\n')));
  const script = text(douyin.script);
  stack.append(card('抖音口播', node('div', script || '未返回口播文案', 'result-body'), script));
  const detailBody = node('div', null, 'result-body');
  const points = Array.isArray(detail.points) ? detail.points.slice(0, 3).map(text) : [];
  detailBody.append(node('strong', text(detail.headline) || '未返回主标题', 'result-title'));
  const list = node('ul');
  for (let index = 0; index < 3; index++) list.append(node('li', points[index] || '未返回该卖点'));
  detailBody.append(list, node('div', text(detail.price) || '未返回价格条', 'price'));
  stack.append(card('详情页首屏', detailBody, [text(detail.headline), ...points, text(detail.price)].filter(Boolean).join('\n')));
  const imageUrl = outputs.image_url || result.image_url;
  const videoUrl = outputs.video_url || result.video_url;
  if (imageUrl || want !== '只要文案') stack.append(mediaCard('image', imageUrl));
  if (videoUrl || want === '文案 + 配图 + 视频') stack.append(mediaCard('video', videoUrl, result.video_desc));
  if (result.error) notice('部分内容需要留意', text(result.error), prefix);
  $(prefix + 'results').replaceChildren(stack); $(prefix + 'results').hidden = false;
}
function archivePayload(payload) {
  return Object.fromEntries(['product', 'campaign', 'audience', 'want', 'shot'].map(key => [key, typeof payload?.[key] === 'string' ? payload[key] : '']));
}
function readArchive() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Array.isArray(saved.records)) throw new Error('Invalid archive');
    return saved.records.filter(record => record && typeof record.id === 'string' && Number.isFinite(record.createdAt) && record.createdAt >= 0 && record.createdAt < 8640000000000000 && record.outputs && typeof record.outputs.result === 'string')
      .slice(0, 20).map(record => ({ id: record.id, createdAt: record.createdAt, payload: archivePayload(record.payload), outputs: record.outputs }));
  } catch {
    archiveStorageWarning = '浏览器暂时无法读取本地记录，新记录仍可在本次打开期间查看。';
    return [];
  }
}
function saveArchive(id, payload, outputs) {
  // Persist only the brief and public workflow outputs, never the access code.
  const savedOutputs = Object.fromEntries(['verdict', 'image_url', 'video_url'].map(key => [key, typeof outputs[key] === 'string' ? outputs[key] : '']));
  savedOutputs.result = typeof outputs.result === 'string' ? outputs.result : JSON.stringify(outputs.result ?? {});
  const record = { id, createdAt: Date.now(), payload: archivePayload(payload), outputs: savedOutputs };
  archiveRecords = [record, ...archiveRecords.filter(item => item.id !== id)].slice(0, 20);
  archiveSelected ||= id;
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify({ version: 1, records: archiveRecords }));
    archiveStorageWarning = '';
  } catch {
    archiveStorageWarning = '浏览器存储不可用或已满。本次记录暂存于当前页面，关闭或刷新后可能丢失。';
  }
  if (pageFromHash() === 'archive') renderArchive();
}
function renderArchive() {
  $('archive-storage-note').textContent = archiveStorageWarning || '仅保存在当前设备的此浏览器，保留最近 20 次已完成记录，不跨设备同步。图片和视频链接可能随时间失效。';
  $('archive-count').textContent = `${String(archiveRecords.length).padStart(2, '0')} / 已收录`;
  $('archive-list').replaceChildren();
  $('archive-empty').hidden = archiveRecords.length > 0;
  $('archive-layout').hidden = archiveRecords.length === 0;
  const record = archiveRecords.find(item => item.id === archiveSelected) || archiveRecords[0];
  archiveSelected = record?.id || null;
  for (const item of archiveRecords) {
    const button = node('button', null, 'archive-entry' + (item.id === archiveSelected ? ' is-selected' : ''));
    button.type = 'button';
    button.setAttribute('aria-pressed', String(item.id === archiveSelected));
    button.append(node('span', new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(item.createdAt), 'archive-date'), node('strong', item.payload.product || '未命名创作'), node('span', `${item.payload.campaign || '日常创作'} · ${item.payload.want || '内容创作'}`));
    button.addEventListener('click', () => {
      archiveSelected = item.id;
      renderArchive();
      $('archive-detail-title').focus({ preventScroll: true });
      $('archive-detail-title').scrollIntoView({ block: 'start', behavior: 'auto' });
    });
    $('archive-list').append(button);
  }
  $('archive-results').replaceChildren(); $('archive-results').hidden = true;
  $('archive-state-message').replaceChildren();
  if (!record) return;
  $('archive-detail-title').textContent = record.payload.product || '创作回顾';
  $('archive-detail-brief').textContent = [record.payload.campaign, record.payload.audience, record.payload.shot].filter(Boolean).join(' · ');
  try { renderOutputs(record.outputs, record.payload.want, 'archive-'); }
  catch (error) { badge('暂不可读', 'warning', 'archive-'); notice('这份记录暂时无法展示', error.message, 'archive-'); }
}
async function api(path, code, job, options = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  job.controller.signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, options.method === 'POST' ? 45000 : 20000);
  try {
    let response;
    try {
      response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Access-Code': code }, signal: controller.signal });
    } catch (error) {
      error.retryable = true;
      error.networkFailure = true;
      throw error;
    }
    const retryableStatus = [408, 429, 500, 502, 503, 504].includes(response.status);
    let data;
    try { data = await response.json(); } catch (cause) {
      const error = new Error('服务响应异常，请稍后重试。');
      error.retryable = retryableStatus || cause.name === 'AbortError' || cause.name === 'TypeError';
      error.networkFailure = cause.name === 'AbortError' || cause.name === 'TypeError';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(data.error || `请求失败（${response.status}）`);
      error.retryable = retryableStatus;
      throw error;
    }
    return data;
  } finally { clearTimeout(timeout); job.controller.signal.removeEventListener('abort', cancel); }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (active || !form.reportValidity()) return;
  if (!$('audience').value.trim()) { $('audience').setCustomValidity('请填写目标人群，不能只输入空格。'); $('audience').reportValidity(); return; }
  const payload = Object.fromEntries(['product', 'campaign', 'audience', 'want', 'shot'].map(key => [key, $(key).value.trim()]));
  const code = $('access-code').value;
  const job = { start: Date.now(), controller: new AbortController(), polling: false, retries: 0, nextPollAt: 0 };
  active = job;
  $('form-fields').disabled = true; $('button-label').textContent = '正在生成…';
  $('current-run-link').hidden = false;
  $('current-run-link').textContent = '查看生成进度 →';
  $('return-brief-link').textContent = '← 返回查看需求';
  $('state-message').replaceChildren(); $('results').replaceChildren(); $('results').hidden = true;
  $('empty-state').hidden = true; $('progress-state').hidden = false;
  $('studio-visual').hidden = false;
  $('elapsed').textContent = '0'; $('time-progress').value = 0; badge('正在生成');
  location.hash = '#result';
  showPage('result', true);
  const expire = () => {
    if (active !== job) return;
    stop(job); badge('等待超时', 'warning');
    notice('已等待 6 分钟', '本次已停止查询。后台任务可能仍在运行，请稍后联系管理员确认，避免重复生成。');
  };
  job.clock = setInterval(() => {
    const seconds = Math.floor((Date.now() - job.start) / 1000);
    if (seconds >= 360) { expire(); return; }
    $('elapsed').textContent = String(seconds); $('time-progress').value = seconds;
  }, 1000);
  job.deadline = setTimeout(expire, 360000);
  const fail = error => {
    if (active !== job) return;
    stop(job); badge('生成未完成', 'warning');
    notice('这次没能完成生成', error.networkFailure
      ? '连接中断，暂时无法确认任务状态。后台可能仍在处理，请先联系管理员确认，避免重复生成。'
      : error.message);
  };
  try {
    const { id } = await api('/api/start', code, job, { method: 'POST', body: JSON.stringify(payload) });
    if (active !== job) return;
    if (!id || typeof id !== 'string') throw new Error('服务没有返回任务 ID。');
    job.poll = setInterval(async () => {
      if (active !== job || job.polling) return;
      if (Date.now() - job.start >= 360000) { expire(); return; }
      if (Date.now() < job.nextPollAt) return;
      job.polling = true;
      try {
        const data = await api(`/api/status?id=${encodeURIComponent(id)}`, code, job);
        if (active !== job) return;
        if (Date.now() - job.start >= 360000) { expire(); return; }
        if (job.retries) { $('state-message').replaceChildren(); badge('正在生成'); }
        job.retries = 0; job.nextPollAt = 0;
        if (data.status === 'succeeded') { renderOutputs(data.outputs, payload.want); saveArchive(id, payload, data.outputs); stop(job); }
        else if (['failed', 'stopped', 'partial-succeeded', 'paused'].includes(data.status)) throw new Error(text(data.error) || '工作流未完成，请联系管理员检查。');
        else if (!['running', 'pending', 'queued'].includes(data.status)) throw new Error('服务返回了未知任务状态，请联系管理员。');
      } catch (error) {
        if (active !== job) return;
        if (Date.now() - job.start >= 360000) { expire(); return; }
        if (error.retryable) {
          // Retry only the read-only status request, never POST /api/start.
          const delay = Math.min(5000 * 2 ** Math.min(job.retries++, 3), 30000);
          job.nextPollAt = Date.now() + delay;
          badge('正在重连', 'warning');
          notice('连接暂时中断', `将在 ${delay / 1000} 秒后自动继续查询，请保持页面打开。不会重复提交生成任务。`);
        } else fail(error);
      }
      finally { job.polling = false; }
    }, 5000);
  } catch (error) { fail(error); }
});
$('audience').addEventListener('input', () => $('audience').setCustomValidity(''));
