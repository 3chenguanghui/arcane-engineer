// 同种子逐字节对拍探针（只读，不修改任何游戏文件）
// 做法：CDP 在页面脚本执行前注入固定种子的 mulberry32 覆盖 Math.random →
//      导航到指定文件 → 等就绪 → 在页面里跑 40 层确定性布局生成 → 把结果规范化为 JSON 字符串 →
//      计算 FNV-1a(32) 哈希与字符长度落盘。
// 用法：
//   node _probe\parity_generation.js <html 路径>
//   node _probe\parity_generation.js <html 路径> --diff <另一个 parity_*.json>
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SEED = 261108;
const POLL_MS = 50;
const READY_LIMIT_MS = 30000;

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
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 忽略 */ }
  }
  throw new Error('找不到 Edge/Chrome，可用环境变量 EDGE_PATH 指定');
}

/**
 * 结束整个浏览器进程树（Windows 下避免残留渲染进程）
 * @param {number} pid 进程号
 */
function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 忽略 */ }
}

/**
 * 启动无头浏览器（每次全新临时 profile）
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
  proc.on('error', () => { /* 由等待超时兜底 */ });
  return { proc, port };
}

/**
 * 等 CDP 端口可用并取第一个 page 目标
 * @param {number} port 调试端口
 * @returns {Promise<Object>} target
 */
async function waitTarget(port) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = list.find((t) => t.type === 'page');
      if (target) return target;
    } catch (e) { /* 未就绪 */ }
    await sleep(200);
  }
  throw new Error('浏览器 CDP 未就绪（端口 ' + port + '）');
}

/**
 * 建立最小 CDP 会话
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
   * 发送 CDP 指令并等结果
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

// 注入脚本：页面任何脚本执行前就装好固定种子的 mulberry32，并暴露重播种函数
const INJECT = `(function () {
  var SEED = ${SEED};
  /** mulberry32：32 位确定性伪随机数发生器 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(SEED);
  Math.random = function () { return rng(); };
  window.__probeSeed = SEED;
  window.__probeSeedReset = function () { rng = mulberry32(SEED); };
  window.__probeMathRandomInstalled = true;
})();`;

// 页面内求值：跑 40 层确定性生成 + 三个等价性枚举 + HUD 宽度读取
const EXPR = `(async () => {
  const types = {};
  /** 安全取 typeof（避免 TDZ 抛错整段中断） */
  const probeType = (name, fn) => { try { types[name] = fn(); } catch (e) { types[name] = 'THROW:' + e.name; } };
  probeType('buildValidatedFloorLayout', () => typeof buildValidatedFloorLayout);
  probeType('GAME_CONFIG', () => typeof GAME_CONFIG);
  probeType('AIM_CONFIG', () => typeof AIM_CONFIG);
  probeType('ASCENSION_CONFIG', () => typeof ASCENSION_CONFIG);
  probeType('OVERDRIVE_CONFIG', () => typeof OVERDRIVE_CONFIG);
  probeType('__roamDebug', () => typeof window.__roamDebug);
  probeType('floorGen.simulate', () => typeof (window.__roamDebug && window.__roamDebug.floorGen && window.__roamDebug.floorGen.simulate));

  // 等两条 HUD 细条被 cacheUi 写过内联宽度（配置接线的实际落点）
  let tracksReady = false;
  for (let i = 0; i < 100; i += 1) {
    const els = document.querySelectorAll('.od-track');
    if (els.length >= 2 && els[0].style.width && els[1].style.width) { tracksReady = true; break; }
    await new Promise((r) => setTimeout(r, 50));
  }

  /** 把单层布局规范化为固定字段顺序的对象 */
  const norm = (floor, lay) => {
    const list = (lay && Array.isArray(lay.rooms)) ? lay.rooms : [];
    return {
      floor: floor,
      valid: !!(lay && lay.valid),
      fallback: !!(lay && lay.fallback),
      attempts: lay ? lay.attempts : null,
      spawnId: lay ? lay.spawnId : null,
      stairId: lay ? lay.stairId : null,
      rooms: list.map((r) => ({
        id: r.id,
        type: (r.type === undefined || r.type === null) ? null : String(r.type),
        x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy,
        seed: (r.seed === undefined) ? null : r.seed
      }))
    };
  };

  const minR = GAME_CONFIG.floorMinRooms || 4;
  const maxR = GAME_CONFIG.floorMaxRooms || 7;
  const cols = GAME_CONFIG.roomColumns || 3;
  const span = maxR - minR + 1;

  let mode = 'none';
  const floors = [];
  if (typeof buildValidatedFloorLayout === 'function') {
    mode = 'buildValidatedFloorLayout';
    if (window.__probeSeedReset) window.__probeSeedReset();   // 从同一随机流起点开始生成
    for (let f = 1; f <= 40; f += 1) {
      const target = minR + (f % span);
      const lay = buildValidatedFloorLayout(f, target, cols);
      floors.push(norm(f, lay));
    }
  }

  // 备用入口：__roamDebug.floorGen.simulate(40)
  let simulate = null;
  try {
    const fg = window.__roamDebug && window.__roamDebug.floorGen;
    if (fg && typeof fg.simulate === 'function') simulate = fg.simulate.call(fg, 40);
  } catch (e) {
    simulate = { error: String((e && e.message) || e) };
  }

  // a) 追踪转向：6*dt 与 AIM_CONFIG.homingTurnRate*dt
  const dts = [1 / 240, 1 / 144, 1 / 120, 1 / 90, 1 / 60, 1 / 30];
  const rate = AIM_CONFIG.homingTurnRate;
  const homing = dts.map((dt) => ({
    dt: dt, literal: 6 * dt, config: rate * dt, same: Object.is(6 * dt, rate * dt)
  }));

  // b) 升阶解封：Math.max(1, n) 与 Math.max(ASCENSION_CONFIG.unlockClears, n)
  const unlockCfg = ASCENSION_CONFIG.unlockClears;
  const unlock = [];
  for (let n = 0; n <= 10; n += 1) {
    unlock.push({ n: n, literal: Math.max(1, n), config: Math.max(unlockCfg, n), same: Object.is(Math.max(1, n), Math.max(unlockCfg, n)) });
  }

  // c) HUD：两条 .od-track 的 computed width
  const trackEls = Array.prototype.slice.call(document.querySelectorAll('.od-track'));
  const hud = {
    count: trackEls.length,
    ids: trackEls.map((e) => e.id || ''),
    computedWidths: trackEls.map((e) => getComputedStyle(e).width),
    inlineWidths: trackEls.map((e) => e.style.width || ''),
    configWidth: OVERDRIVE_CONFIG.hudWidth
  };

  return {
    types: types,
    mode: mode,
    tracksReady: tracksReady,
    config: { minRooms: minR, maxRooms: maxR, cols: cols, homingTurnRate: rate, unlockClears: unlockCfg, hudWidth: OVERDRIVE_CONFIG.hudWidth },
    genString: floors.map((x) => JSON.stringify(x)).join('\\n'),
    floors: floors,
    equiv: {
      homing: homing,
      homingAll: homing.every((x) => x.same),
      unlock: unlock,
      unlockAll: unlock.every((x) => x.same),
      hud: hud
    },
    simulate: simulate,
    simulateString: simulate ? JSON.stringify(simulate) : ''
  };
})()`;

/**
 * FNV-1a 32 位哈希（对 UTF-8 字节计算）
 * @param {string} str 输入字符串
 * @returns {number} 无符号 32 位哈希
 */
function fnv1a32(str) {
  const buf = Buffer.from(str, 'utf8');
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i += 1) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 跑一个文件：注入随机种子 → 导航 → 等就绪 → 执行生成 → 落盘 parity_<id>.json
 * @param {string} abs 目标 HTML 绝对路径
 * @returns {Promise<Object>} 落盘的数据对象
 */
async function runFile(abs) {
  if (!fs.existsSync(abs)) throw new Error('文件不存在：' + abs);
  const id = path.basename(abs).replace(/\.html?$/i, '');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arcane-parity-'));
  const { proc, port } = launch(profile);
  let cdp = null;
  try {
    const target = await waitTarget(port);
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    // 关键：在任何页面脚本执行前装好确定性 Math.random
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

    const fileUrl = 'file:///' + abs.replace(/\\/g, '/');
    const marker = encodeURIComponent(path.basename(abs));
    await cdp.send('Page.navigate', { url: fileUrl });

    const READY_EXPR = `(() => {
      try {
        if (location.href.indexOf(${JSON.stringify(marker)}) < 0) return false;
        return (typeof state !== 'undefined') && !!window.__roamDebug;
      } catch (e) { return false; }
    })()`;

    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < READY_LIMIT_MS) {
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: READY_EXPR, returnByValue: true, timeout: 5000 });
        if (r && r.result && r.result.value === true) { ready = true; break; }
      } catch (e) { /* 导航切上下文 */ }
      await sleep(POLL_MS);
    }
    if (!ready) throw new Error('30s 内未就绪（state/__roamDebug 未出现）：' + abs);

    const res = await cdp.send('Runtime.evaluate', {
      expression: EXPR, awaitPromise: true, returnByValue: true, timeout: 120000
    });
    if (res.exceptionDetails) {
      throw new Error('页面求值异常：' + (res.exceptionDetails.text || '') + ' '
        + ((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || ''));
    }
    const value = res.result.value;
    const genString = String(value.genString || '');
    const simulateString = String(value.simulateString || '');

    const payload = {
      file: abs,
      fileId: id,
      fileBytes: fs.statSync(abs).size,
      seed: SEED,
      readyMs: Date.now() - t0,
      types: value.types,
      mode: value.mode,
      tracksReady: value.tracksReady,
      config: value.config,
      gen: {
        floorCount: value.floors.length,
        length: genString.length,
        bytes: Buffer.byteLength(genString, 'utf8'),
        fnv1a32: fnv1a32(genString),
        fnv1a32Hex: '0x' + fnv1a32(genString).toString(16).padStart(8, '0'),
        sha256: crypto.createHash('sha256').update(genString, 'utf8').digest('hex')
      },
      genString: genString,
      floors: value.floors,
      equiv: value.equiv,
      simulate: value.simulate,
      simulateString: simulateString,
      simulateHash: { length: simulateString.length, fnv1a32: fnv1a32(simulateString), fnv1a32Hex: '0x' + fnv1a32(simulateString).toString(16).padStart(8, '0') },
      pageErrors: cdp.errors.slice(0, 5)
    };
    const outPath = path.join(__dirname, 'parity_' + id + '.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    payload.outPath = outPath;
    return payload;
  } finally {
    if (cdp) cdp.close();
    killTree(proc.pid);
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

/**
 * 比较两份 parity JSON 的原始字符串（不是只比哈希），并定位第一处不同
 * @param {Object} a 本次结果
 * @param {Object} b 另一个结果
 * @returns {Object} 对比结论
 */
function compare(a, b) {
  const sa = a.genString;
  const sb = b.genString;
  const out = {
    a: { file: a.file, length: sa.length, fnv1a32Hex: a.gen.fnv1a32Hex, sha256: a.gen.sha256 },
    b: { file: b.file, length: sb.length, fnv1a32Hex: b.gen.fnv1a32Hex, sha256: b.gen.sha256 },
    byteIdentical: sa === sb,
    simulateIdentical: a.simulateString === b.simulateString,
    firstDiff: null
  };
  if (!out.byteIdentical) {
    const la = sa.split('\n');
    const lb = sb.split('\n');
    const n = Math.max(la.length, lb.length);
    let floorIdx = -1;
    let field = null;
    let detail = null;
    for (let i = 0; i < n; i += 1) {
      if (la[i] !== lb[i]) {
        floorIdx = i;
        try {
          const oa = JSON.parse(la[i] || 'null');
          const ob = JSON.parse(lb[i] || 'null');
          for (const k of Object.keys(oa || {})) {
            if (JSON.stringify(oa[k]) !== JSON.stringify(ob == null ? null : ob[k])) {
              field = k;
              detail = { a: JSON.stringify(oa[k]).slice(0, 400), b: JSON.stringify(ob == null ? null : ob[k]).slice(0, 400) };
              break;
            }
          }
        } catch (e) { field = 'PARSE_FAILED'; detail = String(e.message || e); }
        break;
      }
    }
    // 逐字符定位（跨行不一致的兜底）
    let chIdx = -1;
    const m = Math.min(sa.length, sb.length);
    for (let i = 0; i < m; i += 1) { if (sa.charCodeAt(i) !== sb.charCodeAt(i)) { chIdx = i; break; } }
    out.firstDiff = {
      lineIndex: floorIdx,
      floor: floorIdx >= 0 ? floorIdx + 1 : null,
      field: field,
      fieldValues: detail,
      charIndex: chIdx,
      aContext: chIdx >= 0 ? sa.slice(Math.max(0, chIdx - 80), chIdx + 80) : null,
      bContext: chIdx >= 0 ? sb.slice(Math.max(0, chIdx - 80), chIdx + 80) : null
    };
  }
  return out;
}

/**
 * 主流程：跑指定文件并对拍（可选 --diff）
 */
(async () => {
  const args = process.argv.slice(2);
  const fileArg = args[0];
  if (!fileArg) {
    console.error('用法：node _probe\\parity_generation.js <html 路径> [--diff <另一个 parity_*.json>]');
    process.exit(2);
  }
  const diffIdx = args.indexOf('--diff');
  const diffPath = diffIdx >= 0 ? args[diffIdx + 1] : null;
  const abs = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);

  const cur = await runFile(abs);
  console.log('FILE      ' + cur.file);
  console.log('MODE      ' + cur.mode + '  floors=' + cur.gen.floorCount + '  types=' + JSON.stringify(cur.types));
  console.log('HASH      fnv1a32=' + cur.gen.fnv1a32Hex + ' (' + cur.gen.fnv1a32 + ')  len=' + cur.gen.length
    + '  bytes=' + cur.gen.bytes + '  sha256=' + cur.gen.sha256);
  console.log('EQUIV     homingAll=' + cur.equiv.homingAll + '  unlockAll=' + cur.equiv.unlockAll
    + '  hudWidths=' + JSON.stringify(cur.equiv.hud.computedWidths));
  console.log('SIMULATE  ' + JSON.stringify(cur.simulate).slice(0, 300));
  console.log('SAVED     ' + cur.outPath);

  if (diffPath) {
    const otherAbs = path.isAbsolute(diffPath) ? diffPath : path.resolve(process.cwd(), diffPath);
    const other = JSON.parse(fs.readFileSync(otherAbs, 'utf8'));
    const cmp = compare(cur, other);
    console.log('COMPARE   A=' + cmp.a.file + ' [' + cmp.a.fnv1a32Hex + ']  B=' + cmp.b.file + ' [' + cmp.b.fnv1a32Hex + ']');
    console.log('LENGTH    A=' + cmp.a.length + '  B=' + cmp.b.length);
    console.log('BYTE_IDENTICAL=' + cmp.byteIdentical + '  SIMULATE_IDENTICAL=' + cmp.simulateIdentical);
    if (cmp.firstDiff) console.log('FIRST_DIFF ' + JSON.stringify(cmp.firstDiff));
    fs.writeFileSync(path.join(__dirname, 'parity_compare.json'), JSON.stringify(cmp, null, 2), 'utf8');
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', (e && e.stack) || e); process.exit(1); });
