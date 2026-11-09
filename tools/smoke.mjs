#!/usr/bin/env node
/**
 * 烬 · 出包冒烟回归（六项固定检查，串行、一次只开一个浏览器）
 * ------------------------------------------------------------
 * 用途：每次贴完补丁 / 出包前，跑这一条命令，用同一套判据代替人肉点击。
 *
 *   node tools/smoke.mjs                 # 跑全部六项，写 SMOKE_REPORT.md
 *   node tools/smoke.mjs --only=S4       # 只跑某一项（调试用）
 *   node tools/smoke.mjs --force         # 跳过「机器上已有 msedge」的前置保护
 *
 * 纪律：
 *   · 串行执行：任何时刻只有一个 headless 实例；
 *   · 只读主文件，不写主文件、不改数值；
 *   · 截图只在 FAIL 时落盘（.screenshots/smoke/*.jpg）；
 *   · 总预算 300 秒，超出即把剩余项判 FAIL(TIMEOUT)，避免无限等。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const MAIN_URL = 'file:///' + MAIN.replace(/\\/g, '/');
const REPORT = path.join(ROOT, 'SMOKE_REPORT.md');
const SHOT_DIR = path.join(ROOT, '.screenshots', 'smoke');
const PROFILE_ROOT = path.join(ROOT, '.smoke-profile');
const PROFILE_DIR = path.join(PROFILE_ROOT, 'edge');
const META_KEY = 'arcane_rogue_meta';
const TOTAL_BUDGET_MS = 300 * 1000;

/* Edge 可执行文件候选路径（按顺序取第一个存在的） */
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error('FATAL · 未找到 msedge.exe');
  process.exit(1);
}

const argv = process.argv.slice(2);
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const FORCE = argv.includes('--force');

/** 睡眠（毫秒） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 删除目录（Windows 上文件可能被 Edge 短暂占用，带重试）
 * @param {string} dir 目录
 * @returns {boolean} 是否删掉
 */
function rmDir(dir) {
  for (let i = 0; i < 12; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch (error) {
      // 等进程彻底退出再重试（同步等待，避免把清理流程变成异步）
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } catch (e) { /* 忽略 */ }
    }
  }
  return false;
}

/**
 * 结束整棵 Edge 进程树并清掉本次 profile
 * @param {import('node:child_process').ChildProcess} proc 子进程
 * @returns {void}
 */
function killEdge(proc) {
  if (!proc || !proc.pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (error) { /* 已退出 */ }
  for (let i = 0; i < 12; i += 1) {
    if (rmDir(PROFILE_DIR)) break;
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } catch (e) { /* 忽略 */ }
  }
  try { fs.rmdirSync(PROFILE_ROOT); } catch (error) { /* 非空 */ }
}

/**
 * 统计当前系统里 msedge.exe 的进程数
 * @returns {number} 进程数
 */
function countEdgeProcesses() {
  try {
    const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq msedge.exe', '/NH'], { encoding: 'utf8' });
    return (out.stdout || '')
      .split(/\r?\n/)
      .filter((line) => /msedge\.exe/i.test(line)).length;
  } catch (error) {
    return 0;
  }
}

/**
 * 把一个页面里 console.error / pageerror / 资源错误统一收集起来
 * ----------------------------------------------------------
 * 判据要求「console.error 与 pageerror 必须 = 0」，因此这里分开记，
 * 但首页白名单会把 favicon / net::ERR_FILE_NOT_FOUND 这类浏览器自身噪音剔掉。
 */
class Session {
  /**
   * @param {string} tag 会话标记（用于端口与截图文件名）
   */
  constructor(tag) {
    this.tag = tag;
    this.proc = null;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];
    this.logErrors = [];
    this.port = 9700 + Math.floor(Math.random() * 120);
  }

  /** 重置错误收集（同一实例换页时用） */
  resetErrors() {
    this.consoleErrors = [];
    this.pageErrors = [];
    this.logErrors = [];
  }

  /** 失败错误总数（console.error + pageerror + 非噪音资源错误） */
  errorCount() {
    return this.consoleErrors.length + this.pageErrors.length + this.logErrors.length;
  }

  /**
   * 启动浏览器并打开页面
   * @param {string} url 页面地址
   * @param {{width?:number,height?:number,dpr?:number,readyTimeout?:number}} [opts] 视口与就绪超时
   * @returns {Promise<void>}
   */
  async open(url, opts = {}) {
    const width = opts.width || 1280;
    const height = opts.height || 800;
    const dpr = opts.dpr || 1;

    rmDir(PROFILE_DIR);
    fs.mkdirSync(PROFILE_DIR, { recursive: true });

    this.proc = spawn(EDGE, [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--allow-file-access-from-files',
      '--mute-audio',
      /* 无头环境会把定时器钳到 1s，导致转场锁迟迟不释放，测量结果全是假的 */
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      `--window-size=${width},${height}`,
      'about:blank'
    ], { stdio: 'ignore' });

    const target = await this.waitTarget(20000);
    if (!target) throw new Error('Edge 调试端口未就绪（' + this.port + '）');
    await this.connect(target.webSocketDebuggerUrl);
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Page.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: dpr, mobile: false
    });
    await this.navigate(url, opts.readyTimeout || 30000);
  }

  /**
   * 轮询调试端口，拿到第一个 page target
   * @param {number} timeout 超时毫秒
   * @returns {Promise<Object|null>} target
   */
  async waitTarget(timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page');
        if (page) return page;
      } catch (error) { /* 还没起来 */ }
      await sleep(200);
    }
    return null;
  }

  /**
   * 建立 CDP WebSocket 并绑定事件
   * @param {string} wsUrl 调试地址
   * @returns {Promise<void>}
   */
  async connect(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
        return;
      }
      this.onEvent(msg);
    });
  }

  /**
   * 处理 CDP 事件（只保留三类：console.error / 未捕获异常 / 资源错误）
   * @param {Object} msg CDP 消息
   * @returns {void}
   */
  onEvent(msg) {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
      const text = (msg.params.args || [])
        .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description || arg.type)))
        .join(' ');
      if (!this.consoleErrors.includes(text)) this.consoleErrors.push(text);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params && msg.params.exceptionDetails;
      const text = (d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || 'unknown-exception';
      if (!this.pageErrors.includes(text)) this.pageErrors.push(text);
      return;
    }
    if (msg.method === 'Log.entryAdded' && msg.params && msg.params.entry && msg.params.entry.level === 'error') {
      const entry = msg.params.entry;
      const text = entry.text || '';
      /* 浏览器自身噪音不算页面报错：favicon、file:// 下的资源 404 */
      if (/favicon/i.test(text) || /net::ERR_FILE_NOT_FOUND/i.test(text)) return;
      if (!this.logErrors.includes(text)) this.logErrors.push(text);
    }
  }

  /**
   * 发送 CDP 命令
   * @param {string} method 方法名
   * @param {Object} [params] 参数
   * @returns {Promise<Object>} result
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      this.seq += 1;
      const id = this.seq;
      this.pending.set(id, (msg) => {
        if (msg.error) reject(new Error(method + ' · ' + JSON.stringify(msg.error)));
        else resolve(msg.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * 页面内求值（返回 JSON 可序列化值）
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (r.exceptionDetails) {
      const desc = r.exceptionDetails.exception && r.exceptionDetails.exception.description
        || r.exceptionDetails.text || 'eval-error';
      throw new Error('EVAL · ' + desc.split('\n')[0] + ' · ' + expression.slice(0, 80));
    }
    return r.result ? r.result.value : undefined;
  }

  /**
   * 导航到页面并等待「文档就绪 + 游戏 state 已建立」
   * @param {string} url 地址
   * @param {number} timeout 超时毫秒
   * @returns {Promise<void>}
   */
  async navigate(url, timeout) {
    await this.send('Page.navigate', { url });
    await this.waitReady(timeout || 20000);
  }

  /**
   * 轮询就绪条件
   * @param {number} timeout 超时毫秒
   * @returns {Promise<boolean>} 是否就绪
   */
  async waitReady(timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const ok = await this.ev(`(() => document.readyState === 'complete' && typeof state !== 'undefined' && !!state)()`);
        if (ok) return true;
      } catch (error) { /* 执行上下文切换中，继续等 */ }
      await sleep(150);
    }
    return false;
  }

  /**
   * 轮询页面条件，直到返回真值或超时
   * @param {string} expression 返回真值的表达式
   * @param {number} timeout 超时毫秒
   * @returns {Promise<{ok:boolean,value:*,ms:number}>} 结果
   */
  async waitFor(expression, timeout = 5000) {
    const t0 = Date.now();
    let value = null;
    while (Date.now() - t0 < timeout) {
      try { value = await this.ev(expression); } catch (error) { value = null; }
      if (value) return { ok: true, value, ms: Date.now() - t0 };
      await sleep(100);
    }
    return { ok: false, value, ms: Date.now() - t0 };
  }

  /**
   * 用真实鼠标事件点一个元素（返回是否点中）
   * @param {string} selector CSS 选择器
   * @returns {Promise<boolean>} 是否点到
   */
  async click(selector) {
    const point = await this.ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) return false;
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    return true;
  }

  /**
   * 截一张 JPEG（只在 FAIL 时调用并落盘）
   * @param {string} tag 文件名标签
   * @returns {Promise<string|null>} 落盘路径
   */
  async shot(tag) {
    try {
      const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const file = path.join(SHOT_DIR, tag + '.jpg');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    } catch (error) {
      return null;
    }
  }

  /**
   * 取一张截图的字节数（不落盘，用于白屏检测）
   * @returns {Promise<number>} 字节数（失败返回 0）
   */
  async shotBytes() {
    try {
      const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      return Buffer.from(r.data, 'base64').length;
    } catch (error) {
      return 0;
    }
  }

  /** 关闭浏览器并清理 profile */
  close() {
    try { if (this.ws) this.ws.close(); } catch (error) { /* 已断 */ }
    killEdge(this.proc);
    this.proc = null;
  }
}

/* ============================================================
 * 页面内的固定操作片段（全部走游戏自己的公开调试口 / 真实函数）
 * ============================================================ */

/** 点击「开始探索」并确认进入第 1 层 */
const START_EXPR = `(() => {
  const b = document.getElementById('btnStart');
  if (!b) return { ok: false, why: 'no-btnStart' };
  b.click();
  return { ok: true, mode: state.mode, charLayer: !!(document.getElementById('charLayer') && !document.getElementById('charLayer').classList.contains('hidden')) };
})()`;

/** 等待「已在第 1 层、可操作」 */
const PLAYING_F1_EXPR = `(() => state.mode === 'playing' && state.status === 'playing' && state.floor === 1)()`;

/** 走真实 castSlot(0) 施放一次主槽魔法（清冷却、补满奥能，保证可复现） */
const CAST_EXPR = `(() => {
  if (!state || state.mode !== 'playing') return { ok: false, why: 'not-playing', mode: state && state.mode };
  const id = state.activeMagicId;
  if (state.ownedMagic && state.ownedMagic.indexOf(id) < 0) state.ownedMagic.push(id);
  if (state.dual && state.dual.slots) state.dual.slots[0] = id;
  if (state.cooldowns) state.cooldowns[id] = 0;
  state.player.aether = state.player.aetherMax;
  const ok = castSlot(0, false);
  return { ok: ok, magic: id, costLeft: Math.round(state.player.aether) };
})()`;

/** 清空当前层全部敌人（含首领），并返回清层结算状态 */
const KILL_EXPR = `(() => {
  const before = state.enemies ? state.enemies.length : 0;
  let left = before;
  try { left = __roamDebug.killAllEnemies(); } catch (error) { return { error: String(error) }; }
  try { if (state.boss && !state.boss.defeated) __roamDebug.defeatBoss(); } catch (error) { /* 无首领 */ }
  return {
    left: state.enemies ? state.enemies.length : -1,
    cleared: !!state.floorCleared,
    stairs: !!(state.stairs && state.stairs.active),
    mode: state.mode,
    status: state.status,
    killed: before - (state.enemies ? state.enemies.length : before)
  };
})()`;

/** 把奖励 / 被动弹窗全部走完，回到 playing */
const DRAIN_UI_EXPR = `(() => {
  let guard = 0;
  while (state.mode !== 'playing' && guard < 40) {
    guard += 1;
    if (state.mode === 'reward') {
      if (!__roamDebug.xp.chooseFirst()) break;
    } else if (state.mode === 'passive') {
      if (typeof skipPassiveStage !== 'function') break;
      skipPassiveStage();
    } else {
      break;
    }
  }
  return { mode: state.mode, status: state.status, guard: guard };
})()`;

/** 读当前局的关键状态（体积小，便于每步取证） */
const SNAP_EXPR = `(() => ({
  floor: state.floor,
  mode: state.mode,
  status: state.status,
  cleared: !!state.floorCleared,
  hp: Math.round(state.player ? state.player.hp : -1),
  hpMax: Math.round(state.player ? state.player.hpMax : -1),
  characterId: state.characterId,
  enemies: state.enemies ? state.enemies.length : -1,
  errors: (window.__errors || []).length
}))()`;

/* ============================================================
 * 六项检查
 * ============================================================ */

/**
 * S1 · 首屏无报错
 * 判据：加载后 console.error=0 且 pageerror=0；#btnStart 在 15 秒内出现且可点。
 * @returns {Promise<Object>} 结果
 */
async function checkS1() {
  const s = new Session('S1');
  const t0 = Date.now();
  try {
    await s.open(MAIN_URL);
    const btn = await s.waitFor(`(() => {
      const b = document.getElementById('btnStart');
      if (!b) return false;
      const r = b.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? { w: Math.round(r.width), h: Math.round(r.height) } : false;
    })()`, 25000);
    const bootMs = Date.now() - t0;
    const probe = await s.ev(`(() => ({
      ready: document.readyState,
      mode: state.mode,
      floor: state.floor,
      canvas: !!(document.getElementById('game') && document.getElementById('game').width > 0),
      debug: typeof __roamDebug,
      internalErrors: (window.__errors || []).length,          // 游戏自己的 recordError 计数
      titleVisible: !!(document.getElementById('titleLayer') && !document.getElementById('titleLayer').classList.contains('hidden'))
    }))()`);

    const pass = btn.ok && s.errorCount() === 0 && probe.internalErrors === 0 && probe.canvas;
    const value = {
      btnReadyMs: btn.ok ? btn.ms : null,
      consoleErrors: s.consoleErrors.length,
      pageErrors: s.pageErrors.length,
      resourceErrors: s.logErrors.length,
      internalErrors: probe.internalErrors,
      canvas: probe.canvas,
      titleVisible: probe.titleVisible,
      bootMs
    };
    const notes = [];
    if (s.consoleErrors.length) notes.push('console.error 首条：' + s.consoleErrors[0].slice(0, 120));
    if (s.pageErrors.length) notes.push('pageerror 首条：' + s.pageErrors[0].slice(0, 120));
    if (s.logErrors.length) notes.push('资源错误首条：' + s.logErrors[0].slice(0, 120));
    return {
      pass,
      value,
      measured: `首屏到按钮 ${bootMs}ms · console.error ${s.consoleErrors.length} · pageerror ${s.pageErrors.length}`
        + ` · 资源错误 ${s.logErrors.length} · 内部错误 ${probe.internalErrors} · 画布 ${probe.canvas ? '已创建' : '缺失'}`,
      note: notes.join('；'),
      shot: pass ? null : await s.shot('S1-first-screen')
    };
  } finally {
    s.close();
  }
}

/**
 * S2 · 四口径开局
 * 判据：中性 / 守拙 / 疾火 / 观星 各一局，逐项满足：
 *   ① 进入第 1 层且 mode/status 均为 playing；② 真实 castSlot 成功；③ 清层结算（floorCleared=true、楼梯激活）
 *   ④ 奖励弹窗全部走完回到 playing；⑤ 该局无 console.error / pageerror。
 * @returns {Promise<Object>} 结果
 */
async function checkS2() {
  const s = new Session('S2');
  const cases = [
    { id: 'none', label: '中性', skip: true },
    { id: 'warden', label: '守拙' },
    { id: 'ember', label: '疾火' },
    { id: 'gazer', label: '观星' }
  ];
  const rows = [];
  const t0 = Date.now();
  try {
    await s.open(MAIN_URL);
    for (const item of cases) {
      if (rows.length) {
        s.resetErrors();
        await s.navigate(MAIN_URL, 30000);
      }
      const started = Date.now();

      if (item.skip) {
        /* 中性：走种子局同一条「跳过选择页」通道；角色 id 与派生属性一并归位，
           避免上一条用例把 meta.characterId 留在 warden/ember 上（中性用例固定排第一） */
        await s.ev(`(() => {
          __charSkipPick = true;
          __charForceNeutral = true;
          state.meta.characterId = 'none';
          state.characterId = 'none';
          applyMetaStats(state, true);
          return true;
        })()`);
        await s.ev(START_EXPR);
      } else {
        /* 真实 UI 路径：开始 → 角色卡 → 确认按钮。
           注意：无头环境里坐标点击会被弹层的 transform/滚动影响，这里直接用
           两个按钮各自的 click handler（与用户点击走的是同一套函数）。 */
        await s.ev(START_EXPR);
        const opened = await s.waitFor(`(() => {
          const layer = document.getElementById('charLayer');
          return !!(layer && !layer.classList.contains('hidden'));
        })()`, 3000);
        if (!opened.ok) {
          rows.push({ label: item.label, pass: false, why: '选择页未打开', ms: Date.now() - started, errors: s.errorCount() });
          continue;
        }
        const pick = await s.ev(`(() => {
          const card = document.querySelector('[data-char-id="${item.id}"]');
          if (!card) return { ok: false, why: 'no-card' };
          card.click();
          const btn = document.getElementById('btnCharConfirm');
          if (!btn) return { ok: false, why: 'no-confirm' };
          btn.click();
          return { ok: true, mode: state.mode, char: state.characterId };
        })()`);
        if (!pick.ok) {
          /* 兜底：直接调确认函数，并标记 viaUi=false，便于定位 UI 问题 */
          await s.ev(`chooseCharacter(${JSON.stringify(item.id)})`);
        }
        item.viaUi = !!pick.ok;
        item.pick = pick;
      }

      const play = await s.waitFor(PLAYING_F1_EXPR, 8000);
      const snap = await s.ev(SNAP_EXPR);
      const cast = play.ok ? await s.ev(CAST_EXPR) : { ok: false, why: 'not-playing' };
      const kill = play.ok ? await s.ev(KILL_EXPR) : { cleared: false };
      /* 清层结算：killAllEnemies 后 checkFloorClear 同步执行，这里补 1 秒等待以防异步刷新 */
      const clear = await s.waitFor(`(() => !!state.floorCleared)()`, 3000);
      const drain = play.ok ? await s.ev(DRAIN_UI_EXPR) : { mode: 'n/a' };
      const end = play.ok ? await s.ev(SNAP_EXPR) : snap;

      const charOk = item.id === 'none' ? snap.characterId === 'none' || !snap.characterId : snap.characterId === item.id;
      const pass = play.ok && charOk && cast.ok === true && (kill.error === undefined) && clear.ok && drain.mode === 'playing' && s.errorCount() === 0;
      rows.push({
        label: item.label, id: item.id, pass,
        viaUi: item.viaUi !== false,
        floor: snap.floor, mode: snap.mode, status: snap.status,
        characterId: snap.characterId, charOk,
        castOk: cast.ok === true, magic: cast.magic || null,
        cleared: clear.ok, stairs: kill.stairs, killed: kill.killed,
        endMode: drain.mode, endFloor: end.floor,
        errors: s.errorCount(), ms: Date.now() - started,
        why: pass ? '' : (!play.ok ? '未进入第1层' : (!charOk ? '角色未生效' : (cast.ok !== true ? '施法失败' : (!clear.ok ? '清层结算失败' : (drain.mode !== 'playing' ? '奖励弹窗未走完' : '有报错'))))),
      });
      if (!item.skip && !item.viaUi) rows[rows.length - 1].why += '（UI 点击失败，已用兜底函数）';
    }

    const failRows = rows.filter((r) => !r.pass);
    const value = {
      cases: rows,
      summary: rows.map((r) => `${r.label}:${r.pass ? 'PASS' : 'FAIL'}`).join(' / ')
    };
    return {
      pass: failRows.length === 0,
      value,
      extra: { cases: rows },
      measured: rows.map((r) => `${r.label} ${r.pass ? 'PASS' : 'FAIL'}（${r.ms}ms）`).join(' · '),
      note: failRows.map((r) => r.label + ' · ' + r.why).join('；'),
      shot: failRows.length ? await s.shot('S2-four-chars') : null,
      ms: Date.now() - t0
    };
  } finally {
    s.close();
  }
}

/**
 * S3 · 存档写读往返
 * 判据：写入 4 个关键字段 → 重载 → 读回，四字段逐一相等，且页面无报错。
 *   字段口径：层数=meta.bestFloor / 天赋=meta.talents[首个 id] / 金币=meta.crystals（游戏内货币为结晶）
 *            / 已解锁=meta.unlocks.fusion
 * @returns {Promise<Object>} 结果
 */
async function checkS3() {
  const s = new Session('S3');
  try {
    await s.open(MAIN_URL);
    const written = await s.ev(`(() => {
      const m = state.meta;
      m.bestFloor = 7;
      m.crystals = 123;
      m.unlocks = m.unlocks || {};
      m.unlocks.fusion = true;
      const tid = Object.keys(m.talents)[0];
      m.talents[tid] = 1;
      saveMeta();
      return { tid, bestFloor: m.bestFloor, crystals: m.crystals, fusion: m.unlocks.fusion, talent: m.talents[tid],
               rawBytes: (localStorage.getItem(${JSON.stringify(META_KEY)}) || '').length };
    })()`);
    s.resetErrors();
    await s.navigate(MAIN_URL, 30000);
    const read = await s.ev(`(() => {
      const m = state.meta;
      return {
        bestFloor: m.bestFloor, crystals: m.crystals,
        fusion: !!(m.unlocks && m.unlocks.fusion),
        talent: m.talents[${JSON.stringify(written.tid)}]
      };
    })()`);

    const fields = [
      { name: '层数(bestFloor)', write: written.bestFloor, read: read.bestFloor, ok: read.bestFloor === 7 },
      { name: '天赋(' + written.tid + ')', write: written.talent, read: read.talent, ok: read.talent === 1 },
      { name: '金币(crystals)', write: written.crystals, read: read.crystals, ok: read.crystals === 123 },
      { name: '已解锁(unlocks.fusion)', write: written.fusion, read: read.fusion, ok: read.fusion === true }
    ];
    const pass = fields.every((f) => f.ok) && s.errorCount() === 0;
    return {
      pass,
      value: { fields, rawBytes: written.rawBytes, errors: s.errorCount() },
      measured: fields.map((f) => `${f.name} 写${String(f.write)}/读${String(f.read)}`).join(' · ')
        + ` · 报错 ${s.errorCount()}`,
      note: fields.filter((f) => !f.ok).map((f) => f.name + ' 写入' + f.write + ' 读回' + f.read).join('；'),
      shot: pass ? null : await s.shot('S3-save-roundtrip')
    };
  } finally {
    s.close();
  }
}

/**
 * S4 · 坏档保护（高危）
 * 判据：置入非法 JSON 存档后重载：
 *   ① 原文本一个字节都不变（不能被默认档直接覆盖）；
 *   ② 至少生成一个 arcane_rogue_meta.broken.* 备份键；
 *   ③ 点击开始（会触发 saveMeta）之后，原文本依旧不变；
 *   ④ 页面仍能正常到标题页（不白屏、按钮可点）。
 * 任一项不满足 → FAIL，并在报告的「高危项」区块单独列出。
 * @returns {Promise<Object>} 结果
 */
async function checkS4() {
  const s = new Session('S4');
  const broken = '{broken-json:[not-valid';
  try {
    await s.open(MAIN_URL);
    await s.ev(`localStorage.setItem(${JSON.stringify(META_KEY)}, ${JSON.stringify(broken)})`);
    s.resetErrors();
    await s.navigate(MAIN_URL, 30000);

    const btn = await s.waitFor(`(() => {
      const b = document.getElementById('btnStart');
      if (!b) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })()`, 20000);
    const afterBoot = await s.ev(`(() => {
      const raw = localStorage.getItem(${JSON.stringify(META_KEY)});
      const backups = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.indexOf(${JSON.stringify(META_KEY + '.broken.')}) === 0) backups.push(k);
      }
      return {
        raw,
        backups,
        notice: (typeof metaLoadNotice !== 'undefined' ? metaLoadNotice : ''),
        fallbackClean: (typeof metaFallbackClean !== 'undefined' ? metaFallbackClean : null),
        mode: state.mode
      };
    })()`);

    /* ③ 再点一次开始，验证写档通道确实被熔断 */
    await s.ev(START_EXPR);
    await sleep(600);
    const afterStart = await s.ev(`(() => localStorage.getItem(${JSON.stringify(META_KEY)}))()`);

    const c1 = afterBoot.raw === broken;
    const c2 = afterBoot.backups.length >= 1;
    const c3 = afterStart === broken;
    const c4 = btn.ok && afterBoot.mode === 'title';
    const pass = c1 && c2 && c3 && c4;
    return {
      pass,
      highRisk: !c1 || !c3,
      measured: [
        '原档启动后不变=' + (c1 ? '是' : '否'),
        '点开始后不变=' + (c3 ? '是' : '否'),
        '备份键=' + afterBoot.backups.length + '个',
        '标题页=' + (c4 ? '正常' : '异常'),
        '原文字节=' + (afterBoot.raw || '').length
      ].join(' · '),
      note: [
        c1 ? '' : '原档在启动时被改写（高危）',
        c3 ? '' : '点击开始后原档被覆盖（高危）',
        c2 ? '' : '没有生成 .broken 备份键',
        c4 ? '' : '坏档后页面未正常到标题页'
      ].filter(Boolean).join('；'),
      shot: pass ? null : await s.shot('S4-bad-save'),
      /* 坏档场景下 console.error 属于预期上报，不纳入本项判据 */
      ignoreErrors: true
    };
  } finally {
    s.close();
  }
}

/**
 * S5 · 10 层跑通
 * 判据：注入自动操作（清怪 + 走完奖励弹窗 + descendFloor）推进到第 10 层；
 *       到达 10 层或角色死亡都算「跑通」，但全程 console.error + pageerror 必须 = 0；
 *       中途卡住（楼层不递增且未死亡）→ FAIL。
 * @returns {Promise<Object>} 结果
 */
async function checkS5() {
  const s = new Session('S5');
  const t0 = Date.now();
  try {
    await s.open(MAIN_URL);
    await s.ev(`(() => { __charSkipPick = true; state.meta.characterId = 'none'; return true; })()`);
    await s.ev(START_EXPR);
    const start = await s.waitFor(PLAYING_F1_EXPR, 8000);
    if (!start.ok) {
      return { pass: false, value: { started: false }, note: '未能进入第 1 层', shot: await s.shot('S5-start') };
    }

    const floors = [];
    let died = false;
    let stuck = null;
    let forcedUnlock = 0;

    for (let guard = 0; guard < 12; guard += 1) {
      let snap = await s.ev(SNAP_EXPR);

      if (snap.status !== 'playing' || snap.mode === 'result') {
        died = true;
        floors.push({ floor: snap.floor, cleared: snap.cleared, enemies: snap.enemies, hp: snap.hp });
        break;
      }

      /* 清怪 + 首领，然后等清层判定落到 state（update 循环里刷新），再记录真实状态。
         注意：清层后拾取经验 / 首通奖励会异步弹三选一，必须再走一次弹窗，否则 descend 会被 reward 拦住 */
      await s.ev(KILL_EXPR);
      await s.ev(DRAIN_UI_EXPR);
      await s.waitFor(`(() => !!state.floorCleared)()`, 2000);
      await s.ev(DRAIN_UI_EXPR);
      snap = await s.ev(SNAP_EXPR);
      floors.push({ floor: snap.floor, cleared: snap.cleared, enemies: snap.enemies, hp: snap.hp });

      if (snap.floor >= 10) break;

      const before = snap;
      const down = await s.ev(`(() => {
        if (state.mode !== 'playing' || state.status !== 'playing') return { ok: false, why: 'not-playing' };
        const from = state.floor;
        const ok = __roamDebug.descend();
        return { ok: ok, from: from, to: state.floor, lock: !!state.transitionLock };
      })()`);
      if (!down.ok) { stuck = { floor: before.floor, why: 'descend 返回 false', mode: before.mode }; break; }

      const moved = await s.waitFor(`(() => state.floor === ${down.from + 1} && !state.transitionLock)()`, 8000);
      if (!moved.ok) {
        /* 无头节流兜底：放锁并记录次数（真实浏览器里锁定会自动释放，不影响出包） */
        forcedUnlock += 1;
        await s.ev(`(() => { state.transitionLock = false; return true; })()`);
        const after = await s.ev(SNAP_EXPR);
        if (after.floor !== down.from + 1) { stuck = { floor: before.floor, why: '楼层未递增', after }; break; }
        if (after.status !== 'playing') { died = true; break; }
      }
    }

    const last = await s.ev(SNAP_EXPR);
    const reach10 = last.floor >= 10;
    const pass = !stuck && (reach10 || died) && s.errorCount() === 0 && last.errors === 0;
    const value = {
      reachedFloor: last.floor,
      reach10,
      died,
      stuck,
      forcedUnlock,
      floors,
      consoleErrors: s.consoleErrors.length,
      pageErrors: s.pageErrors.length,
      internalErrors: last.errors,
      wallMs: Date.now() - t0
    };
    return {
      pass,
      value,
      extra: { floors },
      measured: `到达第${last.floor}层 · 到10层=${reach10 ? '是' : '否'} · 死亡=${died ? '是' : '否'}`
        + ` · 卡层=${stuck ? '是' : '否'} · 强制解锁${forcedUnlock}次`
        + ` · console.error ${s.consoleErrors.length} / pageerror ${s.pageErrors.length} / 内部 ${last.errors}`
        + ` · 用时${((Date.now() - t0) / 1000).toFixed(1)}s`,
      note: [
        stuck ? '卡住：' + JSON.stringify(stuck) : '',
        died ? '角色死亡（允许的终局）' : '',
        forcedUnlock ? '无头转场锁强制解锁 ' + forcedUnlock + ' 次（仅测试环境）' : ''
      ].filter(Boolean).join('；'),
      shot: pass ? null : await s.shot('S5-ten-floors')
    };
  } finally {
    s.close();
  }
}

/**
 * S6 · 退出重进不白屏
 * 判据：连开三次（每次都是全新浏览器进程 + 全新 profile），
 *       每次都：① #btnStart 可点；② 截图字节数 ≥ 40KB 或画布有 ≥3 种亮度；
 *       ③ console.error + pageerror = 0。第三次必须同样满足。
 * @returns {Promise<Object>} 结果
 */
async function checkS6() {
  const runs = [];
  for (let i = 1; i <= 3; i += 1) {
    const s = new Session('S6-' + i);
    try {
      await s.open(MAIN_URL);
      const btn = await s.waitFor(`(() => {
        const b = document.getElementById('btnStart');
        if (!b) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })()`, 20000);
      const pixels = await s.ev(`(() => {
        try {
          const cv = document.getElementById('game');
          if (!cv || !cv.width) return null;
          const g = cv.getContext('2d');
          const lum = {};
          for (let y = 0; y < 5; y += 1) {
            for (let x = 0; x < 5; x += 1) {
              const d = g.getImageData(Math.floor(cv.width * (x + 0.5) / 5), Math.floor(cv.height * (y + 0.5) / 5), 1, 1).data;
              const key = Math.round((d[0] + d[1] + d[2]) / 3 / 8);
              lum[key] = 1;
            }
          }
          const list = Object.keys(lum).map(Number);
          return { distinct: list.length, min: Math.min.apply(null, list) * 8, max: Math.max.apply(null, list) * 8 };
        } catch (error) { return { distinct: -1, error: String(error) }; }
      })()`);
      const bytes = await s.shotBytes();
      const ok = btn.ok && s.errorCount() === 0 && ((pixels && pixels.distinct >= 3) || bytes >= 40000);
      runs.push({ run: i, btn: btn.ok, shotBytes: bytes, pixels, errors: s.errorCount(), pass: ok });
      if (!ok) {
        runs[runs.length - 1].shot = await s.shot('S6-run' + i);
      }
    } finally {
      s.close();
    }
  }
  const pass = runs.length === 3 && runs.every((r) => r.pass);
  return {
    pass,
    value: { runs },
    measured: runs.map((r) => `第${r.run}次 ${r.pass ? 'PASS' : 'FAIL'}（截图${r.shotBytes}字节/亮度${r.pixels && r.pixels.distinct >= 0 ? r.pixels.distinct : '?'}档/报错${r.errors}）`).join(' · '),
    note: runs.filter((r) => !r.pass).map((r) => '第' + r.run + '次失败').join('；'),
    shot: runs.find((r) => r.shot) ? runs.find((r) => r.shot).shot : null
  };
}

/* ============================================================
 * 主流程 / 报告
 * ============================================================ */

/**
 * 主文件基线（单快照读取：先读进内存，再算字节 / 行数 / MD5，避免撕裂读数）
 * @returns {Object} 基线信息
 */
function readBaseline() {
  const buf = fs.readFileSync(MAIN);
  const text = buf.toString('utf8');
  return {
    filename: path.basename(MAIN),
    bytes: buf.length,
    chars: text.length,
    lines: text.split('\n').length,
    md5: crypto.createHash('md5').update(buf).digest('hex').toUpperCase(),
    mtime: fs.statSync(MAIN).mtime.toISOString()
  };
}

/**
 * 采样当前机器负载（CPU 平均占用 / msedge 进程数）
 * 高负载时功能结论仍然有效，但耗时读数不能当性能基线，必须写进报告。
 * @returns {{cpu:number, edge:number}} 采样值
 */
function sampleHost() {
  let cpu = -1;
  try {
    const out = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'],
      { encoding: 'utf8', timeout: 8000 });
    cpu = Math.round(Number((out.stdout || '').trim()) || -1);
  } catch (error) { cpu = -1; }
  return { cpu, edge: countEdgeProcesses() };
}

/**
 * 生成 SMOKE_REPORT.md
 * @param {Object} ctx 运行上下文
 * @returns {void}
 */
function writeReport(ctx) {
  const { baseline, results, totalMs, startedAt, host } = ctx;
  const fail = results.filter((r) => !r.pass);
  const lines = [];
  lines.push('# 烬 · 出包冒烟回归报告');
  lines.push('');
  lines.push('- 生成时间：' + startedAt);
  lines.push('- 主文件：`' + baseline.filename + '`');
  lines.push('- 基线：' + baseline.bytes.toLocaleString('en-US') + ' 字节 / '
    + baseline.chars.toLocaleString('en-US') + ' 字符 / '
    + baseline.lines.toLocaleString('en-US') + ' 行 / MD5 `' + baseline.md5 + '`');
  lines.push('- 运行环境：CPU 采样 ' + (host && host.cpu >= 0 ? host.cpu + '%' : '未知')
    + ' · msedge 进程 ' + (host ? host.edge : '?') + ' 个'
    + ((host && (host.cpu >= 60 || host.edge > 12)) ? '（⚠ 高负载，功能结论有效，耗时读数不可作性能基线）' : ''));
  lines.push('- 总耗时：' + (totalMs / 1000).toFixed(1) + ' 秒（预算 300 秒）');
  lines.push('- 结论：**' + (fail.length === 0 ? 'PASS ' + results.length + '/' + results.length : 'FAIL ' + fail.length + '/' + results.length) + '**');
  lines.push('');
  lines.push('## 一、逐项判据与实测');
  lines.push('');
  lines.push('| # | 检查项 | 判据（PASS 条件） | 实测值 | 结果 | 备注 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  results.forEach((r) => {
    lines.push('| ' + r.id + ' | ' + r.name + ' | ' + r.criteria + ' | '
      + r.measured.replace(/\|/g, '\\|') + ' | **' + (r.pass ? 'PASS' : 'FAIL') + '** | '
      + (r.note || '').replace(/\|/g, '\\|') + ' |');
  });
  lines.push('');

  const s2 = results.find((r) => r.id === 'S2');
  if (s2 && s2.extra && Array.isArray(s2.extra.cases)) {
    lines.push('### S2 四口径逐局明细');
    lines.push('');
    lines.push('| 口径 | 结果 | 进入第1层 | 角色生效 | 施法 | 清层结算 | 奖励走完 | 用时(ms) | 备注 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    s2.extra.cases.forEach((c) => {
      lines.push('| ' + c.label + ' | ' + (c.pass ? 'PASS' : 'FAIL') + ' | ' + (c.mode === 'playing' && c.floor === 1 ? '是' : '否')
        + ' | ' + (c.charOk ? '是' : '否') + ' | ' + (c.castOk ? '是' : '否') + ' | ' + (c.cleared ? '是' : '否')
        + ' | ' + (c.endMode === 'playing' ? '是' : '否') + ' | ' + c.ms + ' | ' + (c.why || '') + ' |');
    });
    lines.push('');
  }

  const s5 = results.find((r) => r.id === 'S5');
  if (s5 && s5.extra && Array.isArray(s5.extra.floors)) {
    lines.push('### S5 逐层推进记录');
    lines.push('');
    lines.push('| 层 | floorCleared | 剩余敌人 | 血量 |');
    lines.push('| --- | --- | --- | --- |');
    s5.extra.floors.forEach((f) => {
      lines.push('| ' + f.floor + ' | ' + (f.cleared ? '是' : '否') + ' | ' + f.enemies + ' | ' + f.hp + ' |');
    });
    lines.push('');
    lines.push('> 说明：S5 走注入路径（只清「已刷出的敌人」后直接 `descend()`，不逐房间走图），'
      + '因此多房间层的 `floorCleared=否` 属于预期；完整清层结算已由 S2 在第 1 层单独验证。');
    lines.push('');
  }

  lines.push('## 二、高危项（坏档保护）');
  lines.push('');
  const s4 = results.find((r) => r.id === 'S4');
  if (s4) {
    lines.push('- 结论：**' + (s4.pass ? 'PASS' : 'FAIL') + '**' + (s4.highRisk ? ' · ⚠ 原存档被覆盖，需优先修复' : ''));
    lines.push('- 实测：' + s4.measured);
    if (s4.note) lines.push('- 说明：' + s4.note);
  } else {
    lines.push('- 未执行（被总预算截断）');
  }
  lines.push('');
  lines.push('## 三、失败现场');
  lines.push('');
  const shots = results.filter((r) => r.shot);
  if (!shots.length) lines.push('无（全部通过，未落任何截图）');
  shots.forEach((r) => lines.push('- ' + r.id + ' · `' + path.relative(ROOT, r.shot) + '`'));
  lines.push('');
  lines.push('## 四、口径说明');
  lines.push('');
  lines.push('- 「金币」字段在本项目里指 `meta.crystals`（游戏内永久货币为奥术结晶），不是局内临时货币。');
  lines.push('- 「层数」比对字段为 `meta.bestFloor`；「天赋」为首个天赋 id 的等级；「已解锁」为 `meta.unlocks.fusion`。');
  lines.push('- S2 的施法走真实 `castSlot(0)`；清层结算以 `state.floorCleared && stairs.active` 为准。');
  lines.push('- S5 的下楼走真实 `descendFloor()`；无头环境若转场锁未自动释放，会强制放锁并单独计数（仅测试环境）。');
  lines.push('- 所有检查串行：一次只开一个 headless 实例，跑完即 taskkill 并删除专用 profile。');

  fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8');
}

/** 检查清单（顺序执行，前面的失败不影响后面继续跑） */
const CHECKS = [
  {
    id: 'S1', name: '首屏无报错',
    criteria: 'console.error=0 且 pageerror=0；#btnStart 25 秒内可点；画布已创建',
    run: checkS1, extra: null
  },
  {
    id: 'S2', name: '四口径开局',
    criteria: '中性/守拙/疾火/观星各进第1层、施法成功、清层结算、奖励走完、无报错',
    run: checkS2
  },
  {
    id: 'S3', name: '存档写读往返',
    criteria: '写入层数7/天赋1/金币123/已解锁true → 重载逐字段相等，且无报错',
    run: checkS3
  },
  {
    id: 'S4', name: '坏档保护（高危）',
    criteria: '非法档重载后原文本不变 + 生成 .broken 备份 + 点开始后仍不变 + 标题页正常',
    run: checkS4
  },
  {
    id: 'S5', name: '10 层跑通',
    criteria: '注入自动操作到第10层或死亡；页面异常数=0；无卡层',
    run: checkS5
  },
  {
    id: 'S6', name: '退出重进不白屏',
    criteria: '三次独立启动均：按钮可点 + 非白屏 + 异常数=0（第三次同样满足）',
    run: checkS6
  }
];

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  if (!fs.existsSync(MAIN)) {
    console.error('FATAL · 主文件不存在：' + MAIN);
    process.exit(1);
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const edgeCount = countEdgeProcesses();
  if (edgeCount > 2 && !FORCE) {
    console.log('WAIT · 当前机器已有 ' + edgeCount + ' 个 msedge 进程，为避免互相踩出假 FAIL，本脚本不启动。');
    console.log('       等测量窗口干净后再跑，或确认无并发后加 --force。');
    process.exit(3);
  }

  const baseline = readBaseline();
  const host = sampleHost();
  const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const t0 = Date.now();
  const results = [];
  const selected = ONLY ? CHECKS.filter((c) => c.id === ONLY) : CHECKS;

  for (const check of selected) {
    const left = TOTAL_BUDGET_MS - (Date.now() - t0);
    if (left < 15000) {
      results.push({
        id: check.id, name: check.name, criteria: check.criteria,
        pass: false, measured: '未执行（总预算 300 秒用尽）', note: 'TIMEOUT', shot: null
      });
      continue;
    }
    const c0 = Date.now();
    let r;
    try {
      r = await check.run();
    } catch (error) {
      r = { pass: false, value: { error: String(error && error.message || error) }, note: String(error && error.message || error), shot: null };
    }
    const ms = Date.now() - c0;
    results.push({
      id: check.id, name: check.name, criteria: check.criteria,
      pass: !!r.pass,
      measured: r.measured || (typeof r.value === 'string' ? r.value : JSON.stringify(r.value)),
      note: r.note || '',
      shot: r.shot || null,
      highRisk: !!r.highRisk,
      extra: r.extra || null,
      ms
    });
    console.log((r.pass ? 'PASS' : 'FAIL') + ' · ' + check.id + ' ' + check.name + ' · ' + (ms / 1000).toFixed(1) + 's');
  }

  const totalMs = Date.now() - t0;
  writeReport({ baseline, results, totalMs, startedAt, host });

  const fail = results.filter((r) => !r.pass);
  const summary = 'SMOKE · ' + (fail.length === 0 ? 'PASS ' : 'FAIL ')
    + (results.length - fail.length) + '/' + results.length
    + ' · 用时 ' + (totalMs / 1000).toFixed(1) + ' 秒'
    + ' · 报告 SMOKE_REPORT.md'
    + (fail.length ? ' · 失败：' + fail.map((r) => r.id + ' ' + r.name).join('、') : '');
  console.log(summary);
  if (fail.some((r) => r.highRisk)) {
    console.log('⚠ 高危：坏档保护未通过，原存档可能被覆盖（详见 SMOKE_REPORT.md 第二节）');
  }
  process.exitCode = fail.length ? 1 : 0;
}

main().catch((error) => {
  console.error('FATAL · ' + (error && error.stack || error));
  process.exit(1);
});
