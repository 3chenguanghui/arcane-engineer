// 冷启动耗时分布探针（只读，不修改任何游戏文件）
// 做法：用 Edge/Chrome 的 CDP 连无头浏览器 → 每次用全新临时 profile → 导航到主文件 →
//      每 50ms 轮询一次页面，记录 4 个启动信号的"首次命中时间"（相对 Page.navigate 调用前）。
// 用法：node _probe\boot_timing.js [次数=10]
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, 'boot_timing.json');
const POLL_MS = 50;          // 轮询间隔
const LIMIT_MS = 30000;      // 单信号超时上限（超时记 -1）
const RUNS = Math.max(1, Number(process.argv[2]) || 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 找一个可用的 Chromium 浏览器（Edge 优先，Chrome 兜底）
 * @returns {string} 可执行文件绝对路径
 */
function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 忽略不可访问路径 */ }
  }
  throw new Error('找不到 Edge/Chrome，可用环境变量 EDGE_PATH 指定');
}

/**
 * 结束整个浏览器进程树（Windows 下只杀主进程会留下渲染子进程）
 * @param {number} pid 进程号
 */
function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 忽略 */ }
}

/**
 * 启动一个无头浏览器实例（独立 profile，确保是"冷"缓存）
 * @param {string} profile 用户数据目录
 * @returns {{proc: import('child_process').ChildProcess, port: number}}
 */
function launch(profile) {
  const port = 9800 + Math.floor(Math.random() * 400);
  const proc = spawn(findBrowser(), [
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
  proc.on('error', () => { /* 启动失败由 waitTarget 超时兜底 */ });
  return { proc, port };
}

/**
 * 等待 CDP 调试端口可用并返回第一个 page 目标
 * @param {number} port 调试端口
 * @returns {Promise<Object>} CDP target 描述
 */
async function waitTarget(port) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = list.find((t) => t.type === 'page');
      if (target) return target;
    } catch (e) { /* 浏览器还没起来 */ }
    await sleep(200);
  }
  throw new Error('浏览器 CDP 未就绪（端口 ' + port + '）');
}

/**
 * 建立一个最小 CDP 会话（send/close），并收集页面异常用于诊断
 * @param {string} wsUrl WebSocket 调试地址
 * @returns {Promise<{send: Function, close: Function, errors: string[]}>}
 */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('WS 连接失败')); });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errors.push('EXCEPTION: ' + (d.text || '') + ' ' + ((d.exception && d.exception.description) || ''));
    }
  };
  /**
   * 发送一条 CDP 指令并等待结果
   * @param {string} method 方法名
   * @param {Object} [params] 参数
   * @returns {Promise<Object>} result
   */
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  return { send, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } }, errors };
}

// 页面内探针：一次求值拿回 4 个信号 + 诊断信息。
// 关键：只有在 URL 已经切到目标文件后才认可信号，否则会读到 about:blank 的 readyState=complete（假命中）。
const MARKER = encodeURIComponent(path.basename(PAGE));
const PROBE = `(() => {
  const href = location.href;
  const committed = href.indexOf(${JSON.stringify(MARKER)}) >= 0;
  const out = { committed: committed, href: href, rs: 'n/a', st: false, rd: false, tl: false, titleHidden: null };
  if (!committed) return out;
  out.rs = document.readyState;
  try { out.st = (typeof state !== 'undefined'); } catch (e) { out.st = false; }   // let state 有 TDZ，必须 try
  try { out.rd = !!(window.__roamDebug); } catch (e) { out.rd = false; }
  try {
    const el = document.getElementById('titleLayer');
    out.titleHidden = el ? el.classList.contains('hidden') : null;
    out.tl = !!el && !el.classList.contains('hidden');
  } catch (e) { out.tl = false; }
  return out;
})()`;

/**
 * 导航并轮询四个启动信号，返回各自首次命中时间（ms，相对 navigate 调用前；超时 -1）
 * @param {{send: Function}} cdp CDP 会话
 * @returns {Promise<Object>} { values, lastSeen, roundTrips }
 */
async function pollBoot(cdp) {
  const fileUrl = 'file:///' + PAGE.replace(/\\/g, '/');
  const keys = ['readyStateComplete', 'stateDefined', 'roamDebugReady', 'titleVisible'];
  const hit = { readyStateComplete: -1, stateDefined: -1, roamDebugReady: -1, titleVisible: -1 };
  const lo = { readyStateComplete: -1, stateDefined: -1, roamDebugReady: -1, titleVisible: -1 };
  const hi = { readyStateComplete: -1, stateDefined: -1, roamDebugReady: -1, titleVisible: -1 };
  let lastSeen = null;
  const rtts = [];
  const t0 = Date.now();
  await cdp.send('Page.navigate', { url: fileUrl });

  while (Date.now() - t0 < LIMIT_MS) {
    const tSend = Date.now() - t0;
    let v = null;
    try {
      const res = await cdp.send('Runtime.evaluate', {
        expression: PROBE, returnByValue: true, timeout: 5000
      });
      v = res && res.result ? res.result.value : null;
    } catch (e) { v = null; }   // 导航过程中执行上下文会被销毁，属正常
    const tRecv = Date.now() - t0;
    if (v) {
      rtts.push(tRecv - tSend);
      lastSeen = { at: tSend, href: v.href, rs: v.rs, st: v.st, rd: v.rd, tl: v.tl, titleHidden: v.titleHidden };
      if (v.committed) {
        /* 页面状态是"执行求值那一瞬间"的快照，真实命中时刻落在 [发送, 收到] 之间，
           取中点作为点估计（发送前未命中、收到时已命中）。 */
        const mid = Math.round((tSend + tRecv) / 2 * 10) / 10;
        const mark = (k, okFlag) => {
          if (okFlag && hit[k] < 0) { hit[k] = mid; lo[k] = tSend; hi[k] = tRecv; }
        };
        mark('readyStateComplete', v.rs === 'complete');
        mark('stateDefined', v.st);
        mark('roamDebugReady', v.rd);
        mark('titleVisible', v.tl);
        if (keys.every((k) => hit[k] >= 0)) break;
      }
    }
    await sleep(POLL_MS);
  }
  const avgRtt = rtts.length ? (rtts.reduce((a, b) => a + b, 0) / rtts.length) : -1;
  return {
    values: hit, bounds: { lo: lo, hi: hi }, lastSeen: lastSeen,
    pollCount: rtts.length, avgEvalRtt: Math.round(avgRtt * 10) / 10
  };
}

/**
 * 跑一次"全新 profile 的独立冷启动"
 * @param {number} index 第几次
 * @returns {Promise<Object>} 该项测得的四个时间
 */
async function coldRun(index) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arcane-boot-'));
  const { proc, port } = launch(profile);
  let cdp = null;
  try {
    const target = await waitTarget(port);
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const r = await pollBoot(cdp);
    return { run: index, values: r.values, bounds: r.bounds, pollCount: r.pollCount, avgEvalRtt: r.avgEvalRtt, lastSeen: r.lastSeen, errors: cdp.errors.slice(0, 3) };
  } finally {
    if (cdp) cdp.close();
    killTree(proc.pid);
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 占用时留待系统清理 */ }
  }
}

/**
 * 热启动对照：同一个浏览器、同一个 profile 里连续导航两次（第 2 次即热启动）
 * @returns {Promise<Object>} { first, second }
 */
async function hotCompare() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arcane-boot-hot-'));
  const { proc, port } = launch(profile);
  let cdp = null;
  try {
    const target = await waitTarget(port);
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const first = await pollBoot(cdp);
    await sleep(500);
    const second = await pollBoot(cdp);
    return {
      first: { values: first.values, bounds: first.bounds, pollCount: first.pollCount, avgEvalRtt: first.avgEvalRtt },
      second: { values: second.values, bounds: second.bounds, pollCount: second.pollCount, avgEvalRtt: second.avgEvalRtt }
    };
  } finally {
    if (cdp) cdp.close();
    killTree(proc.pid);
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

/**
 * 线性插值分位数
 * @param {number[]} sorted 升序数组
 * @param {number} q 0~1
 * @returns {number} 分位数值
 */
function quantile(sorted, q) {
  if (!sorted.length) return -1;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 对某一信号的 10 次取值做 min/median/p90/max（-1 视为超时，不参与分位，单独计数）
 * @param {number[]} arr 原始数组
 * @returns {Object} 统计结果
 */
function stats(arr) {
  const ok = arr.filter((v) => v >= 0).sort((a, b) => a - b);
  const r = (v) => (v < 0 ? -1 : Math.round(v * 10) / 10);
  return {
    n: arr.length,
    timeouts: arr.length - ok.length,
    min: ok.length ? r(ok[0]) : -1,
    median: ok.length ? r(quantile(ok, 0.5)) : -1,
    p90: ok.length ? r(quantile(ok, 0.9)) : -1,
    max: ok.length ? r(ok[ok.length - 1]) : -1
  };
}

/**
 * 主流程：RUNS 次冷启动 + 1 组冷/热对照，落盘 JSON 并打印汇总
 */
(async () => {
  if (!fs.existsSync(PAGE)) throw new Error('主文件不存在：' + PAGE);
  const startedAt = new Date().toISOString();
  const runs = [];
  for (let i = 1; i <= RUNS; i += 1) {
    const r = await coldRun(i);
    runs.push(r);
    console.log(`RUN ${String(i).padStart(2, '0')}  ready=${r.values.readyStateComplete}  state=${r.values.stateDefined}`
      + `  roam=${r.values.roamDebugReady}  title=${r.values.titleVisible}`
      + `  polls=${r.pollCount}  evalRtt=${r.avgEvalRtt}ms`);
  }

  const keys = ['readyStateComplete', 'stateDefined', 'roamDebugReady', 'titleVisible'];
  const raw = {};
  const stat = {};
  keys.forEach((k) => {
    raw[k] = runs.map((r) => r.values[k]);
    stat[k] = stats(raw[k]);
  });

  const hot = await hotCompare();

  const payload = {
    generatedAt: new Date().toISOString(),
    startedAt: startedAt,
    page: PAGE,
    pageBytes: fs.statSync(PAGE).size,
    pollMs: POLL_MS,
    limitMs: LIMIT_MS,
    method: '每次独立进程 + 全新临时 profile；Page.navigate 前起表，每 50ms 一次 Runtime.evaluate；命中时刻取该次求值的 [发送,收到] 中点',
    signals: {
      readyStateComplete: "document.readyState === 'complete'（且 URL 已切到目标文件）",
      stateDefined: 'typeof state !== "undefined"',
      roamDebugReady: 'typeof window.__roamDebug !== "undefined" && window.__roamDebug',
      titleVisible: '#titleLayer 存在且不带 hidden 类'
    },
    runs: runs.map((r) => ({
      run: r.run, values: r.values, bounds: r.bounds, pollCount: r.pollCount, avgEvalRtt: r.avgEvalRtt, errors: r.errors
    })),
    raw: raw,
    stats: stat,
    hot: {
      note: '同一浏览器同一 profile 连续两次导航，第 2 次为热启动（不新建 profile）',
      first: hot.first,
      second: hot.second,
      delta: keys.reduce((acc, k) => {
        const a = hot.first.values[k];
        const b = hot.second.values[k];
        acc[k] = (a >= 0 && b >= 0) ? Math.round((b - a) * 10) / 10 : null;
        return acc;
      }, {})
    }
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');

  const fmt = (s) => `min=${s.min} med=${s.median} p90=${s.p90} max=${s.max}` + (s.timeouts ? ` 超时${s.timeouts}` : '');
  console.log('BOOT_SUMMARY 冷启动 n=' + RUNS
    + ' | ready[' + fmt(stat.readyStateComplete) + ']'
    + ' | state[' + fmt(stat.stateDefined) + ']'
    + ' | roam[' + fmt(stat.roamDebugReady) + ']'
    + ' | title[' + fmt(stat.titleVisible) + ']');
  console.log('RAW ready=' + JSON.stringify(raw.readyStateComplete)
    + ' state=' + JSON.stringify(raw.stateDefined)
    + ' roam=' + JSON.stringify(raw.roamDebugReady)
    + ' title=' + JSON.stringify(raw.titleVisible));
  console.log('HOT 第1次=' + JSON.stringify(hot.first.values) + ' 第2次=' + JSON.stringify(hot.second.values));
  console.log('SAVED ' + OUT);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
