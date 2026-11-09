// 预览页无头验收公共启动器：用 Edge 的 CDP 打开本地 HTML 并执行一段 JS
// 用法：require('./preview_cdp').openPreview('xxx.html', '(async()=>{...})()')
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** 找一个可用的 Chromium 浏览器（Edge 优先，Chrome 兜底） */
function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  throw new Error('找不到 Edge/Chrome，可用环境变量 EDGE_PATH 指定');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 打开预览页并执行断言表达式
 * @param {string} pagePath 相对 tools 目录或绝对路径的 HTML
 * @param {string} expr 在页面里执行的 JS 表达式（可返回 Promise）
 * @param {Object} [opts] { waitMs, timeoutMs }
 * @returns {Promise<{ value:any, errors:string[] }>}
 */
async function openPreview(pagePath, expr, opts) {
  const o = opts || {};
  const waitMs = Number(o.waitMs) || 1200;
  const timeoutMs = Number(o.timeoutMs) || 15000;
  const abs = path.isAbsolute(pagePath) ? pagePath : path.join(__dirname, '..', pagePath);
  if (!fs.existsSync(abs)) throw new Error('预览页不存在：' + abs);

  const browser = findBrowser();
  const profile = fs.mkdtempSync(path.join('D:\\.temp\\browser-profiles\\arcane', 'arcane-preview-'));
  const port = 9700 + Math.floor(Math.random() * 200);
  const proc = spawn(browser, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    '--window-size=1280,860',
    'about:blank'
  ], { stdio: 'ignore' });

  const kill = () => { try { proc.kill(); } catch (e) {} };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(1); });

  try {
    let target = null;
    for (let i = 0; i < 80; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) {}
      await sleep(200);
    }
    if (!target) throw new Error('浏览器 CDP 未就绪');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });

    let seq = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push('EXCEPTION: ' + (m.params.exceptionDetails.text || ''));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errors.push('CONSOLE: ' + (m.params.args || []).map((a) => a.value || '').join(' '));
      }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      seq += 1;
      pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
      ws.send(JSON.stringify({ id: seq, method, params }));
    });

    await send('Runtime.enable');
    await send('Page.enable');
    const fileUrl = 'file:///' + abs.replace(/\\/g, '/');
    await send('Page.navigate', { url: fileUrl });
    await sleep(waitMs);

    const evalRes = await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs
    });
    if (evalRes.exceptionDetails) {
      throw new Error('页面执行异常：' + (evalRes.exceptionDetails.text || '')
        + ' ' + (evalRes.exceptionDetails.exception && evalRes.exceptionDetails.exception.description || ''));
    }
    return { value: evalRes.result.value, errors: errors };
  } finally {
    kill();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 400);
  }
}

module.exports = { openPreview };
