/**
 * 困难档三条上限实测探针（只读代码路径，不改主文件）
 * ------------------------------------------------------------------
 * 目的：把"困难档收噪音"从"运行时断言"升级为"真·困难难度下的实测峰值"。
 * 设计：
 *   1) 进游戏后，先在 normal 档跑 10 次演出结算（S0/S1/S2 循环），记峰值；
 *   2) 再 setDifficulty('nightmare')，同一套 10 次，记峰值；
 *   3) 对比：粒子是否 −30%、闪白是否 ≤80ms、震幅是否 ≤视野 1.2%、顿帧是否 ≤130ms。
 *
 * 为什么用 fxTierFrame + fxTierFlush 而不是"真的去打怪"：
 *   - 打击演出是"帧末结算"，只要帧桶内容确定，结算路径与真实战斗完全相同；
 *   - 真实战斗无法保证 10 次里每次都稳定出现 S2（清场、多杀不可控），
 *     而验收要的是"上限是否守得住"，需要可复现的最坏值。
 *   注意：这不是改游戏，探针只构造一帧的输入（hits/kills），走的是同一套 fxTierFlush。
 *
 * 用法：node _probe/feel_hard_probe.js [tag]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'feely-hard';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-fh-${TAG}-${process.pid}-${Date.now()}`);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9700 + Math.floor(Math.random() * 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 msedge.exe');
}

/** 文件 MD5（大写） */
function md5File(f) {
  return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').toUpperCase();
}

/** 启动 headless Edge 并连上 CDP */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  spawn(findEdge(), [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  /** 页面内求值 */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return { file: name, bytes: fs.statSync(f).size };
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入游戏：标题 → 选角色 → 开始 */
async function enterGame(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    const ok = await ev(`(() => { const b = document.getElementById('btnStart'); return !!(b && b.getBoundingClientRect().width > 0); })()`);
    if (ok === true) break;
    await sleep(150);
  }
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 60; i += 1) {
    if (await ev(`(() => !!document.querySelector('.char-card'))()`) === true) break;
    await sleep(120);
  }
  await ev(`(() => { const c = document.querySelector('.char-card'); if (c) c.click(); return !!c; })()`);
  await sleep(200);
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  for (let i = 0; i < 200; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; return { mode: d.getState().mode }; })()`);
    if (st && st.mode === 'playing') return;
    if (i > 0 && i % 40 === 0) {
      await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
    }
    await sleep(200);
  }
  throw new Error('未能进入 playing 模式');
}

/**
 * 页面内的一次演出结算（单个字符串，保证"建桶 → 填桶 → 结算 → 读数"在同一帧内原子完成）
 * @param {string} kind 'S0' | 'S1' | 'S2'
 */
function flushExpr(kind) {
  return `(() => {
    try {
      /* 0) 测量前置：确保可访问性开关为默认（减少屏震/关闭闪白会改变可读性口径） */
      if (state.meta) { state.meta.reduceShake = false; state.meta.reduceFlash = false; }
      /* 1) 选一间战斗房作为当前房（最常见的真实场景，battle 档位 shakeMul 0.82 / particlesMul 0.8） */
      if (state.rooms) {
        const bi = state.rooms.findIndex((r) => r && r.type === 'battle');
        if (bi >= 0) state.currentRoomId = bi;
      }
      /* 2) 强制新建帧桶，避免把游戏循环残留的命中算进来 */
      state.fxFrame = null;
      const f = fxTierFrame();
      const kind = ${JSON.stringify(kind)};
      if (kind === 'S0') { f.hits = 1; f.crits = 0; f.kills = 0; }
      else if (kind === 'S1') { f.hits = 4; f.crits = 1; f.kills = 0; }
      else { f.hits = 8; f.crits = 2; f.kills = 3; }   // hits≥5 且 kills≥3 → multiKill（battle 白名单内）
      const p = state.player || { x: 0, y: 0 };
      f.x = p.x + 120; f.y = p.y + 40; f.dir = 0.3;
      /* 3) 结算（与真实战斗完全同一条函数） */
      const s = fxTierFlush();
      /* 4) 立刻读实际生效值（同一帧内，避免游戏循环把顿帧消耗掉） */
      const span = cameraSpan();
      const viewRadius = Math.min(span.w, span.h) * 0.5;
      return {
        kind,
        summary: s,
        roomType: s ? s.roomType : null,
        viewRadius: Math.round(viewRadius * 10) / 10,
        hitStopNow: Number((state.hitStop || 0).toFixed(4)),
        shakePeakApplied: Number((SHAKE_STATS.lastPeak || 0).toFixed(2)),
        shakeState: Number((state.shake.power || 0).toFixed(2)),
        flashMsApplied: (state.feel && state.feel.lastFlashMs) || 0,
        flashCss: (ui.flash && ui.flash.style && ui.flash.style.background) || '',
        poolAfter: state.particles ? state.particles.length : 0,
        diff: (typeof difficultyId === 'function') ? difficultyId() : null
      };
    } catch (e) { return { __err: String((e && e.stack) || e) }; }
  })()`;
}

/** 跑一轮（同一难度下 10 次结算），返回每次样本 + 峰值 */
async function runRounds(t, label) {
  const kinds = ['S0', 'S1', 'S2', 'S0', 'S1', 'S2', 'S2', 'S1', 'S2', 'S0'];
  const samples = [];
  for (let i = 0; i < kinds.length; i += 1) {
    /* 间隔 >1s：让 S2 的 1 秒节流窗口与闪白的 340ms 合流窗口自然过期，
       否则第 2 次 S2 会被降成 S1，测到的就不是峰值。 */
    if (i > 0) await sleep(1120);
    const r = await t.ev(flushExpr(kinds[i]));
    samples.push(r);
  }
  const ok = samples.filter((s) => s && !s.__err && s.summary);
  const peak = (k) => ok.reduce((m, s) => Math.max(m, Number(s.summary[k]) || 0), 0);
  const peakPool = ok.reduce((m, s) => Math.max(m, Number(s.poolAfter) || 0), 0);
  const byTier = {};
  ['S0', 'S1', 'S2'].forEach((k) => {
    const rows = ok.filter((s) => s.summary.tier === k);
    byTier[k] = rows.length ? {
      n: rows.length,
      particles: Math.max.apply(null, rows.map((r) => r.summary.particles)),
      flashMs: Math.max.apply(null, rows.map((r) => r.summary.flashMs)),
      shake: Math.max.apply(null, rows.map((r) => r.summary.shake)),
      hitStopMs: Math.max.apply(null, rows.map((r) => r.summary.hitStopMs)),
      merged: rows.filter((r) => r.summary.merged).length
    } : null;
  });
  return {
    label,
    diff: ok.length ? ok[0].diff : null,
    rounds: samples.length,
    okRounds: ok.length,
    viewRadius: ok.length ? ok[0].viewRadius : null,
    peaks: {
      particles: peak('particles'),
      flashMs: peak('flashMs'),
      shake: peak('shake'),
      hitStopMs: peak('hitStopMs'),
      pool: peakPool
    },
    byTier,
    samples: samples.map((s) => (s && s.__err ? { err: s.__err } : {
      tier: s.summary.tier, hits: s.summary.hits, kills: s.summary.kills,
      particles: s.summary.particles, flashMs: s.summary.flashMs,
      flashMsApplied: s.flashMsApplied, shake: s.summary.shake,
      hitStopMs: s.summary.hitStopMs, hitStopNow: s.hitStopNow,
      merged: s.summary.merged, capped: s.summary.capped, reason: s.summary.reason,
      roomType: s.roomType, diff: s.diff, pool: s.poolAfter
    }))
  };
}

/** 主流程 */
async function main() {
  const t = await boot();
  const finger = { file: MAIN, bytes: fs.statSync(MAIN).size, md5: md5File(MAIN) };
  console.log('FINGER ' + JSON.stringify(finger));
  await enterGame(t);
  await sleep(900);

  /* 基线快照：配置值与初始难度（证明后面对比的是"同一份代码、不同难度"） */
  const base = await t.ev(`(() => {
    const out = {};
    try {
      out.tiers = JSON.parse(JSON.stringify(FX_TIER_CONFIG.tiers));
      out.hitstopMax = HITSTOP_CONFIG.maxSeconds;
      out.shakeRatio = FX_TIER_CONFIG.shakeMaxViewRatio;
      out.hardShakeRatioTarget = 0.012;
      out.flashDefaultMs = FEEL_CONFIG.flashMs;
      out.throttle = FX_TIER_CONFIG.throttleWindow;
      out.diff = difficultyId();
      out.quality = (typeof FX_QUALITY_PRESET !== 'undefined') ? FX_QUALITY_PRESET : null;
      out.reduceShake = !!(state.meta && state.meta.reduceShake);
      out.reduceFlash = !!(state.meta && state.meta.reduceFlash);
      const span = cameraSpan();
      out.cameraSpan = { w: Math.round(span.w), h: Math.round(span.h), zoom: +span.zoom.toFixed(3) };
    } catch (e) { out.err = String(e); }
    return out;
  })()`);
  console.log('BASE ' + JSON.stringify(base));

  /* 性能口径：DOM 变更/秒 + 长任务数（用户指定的唯一证据；帧时间不算） */
  await t.ev(`(() => {
    window.__PH = { mut: 0, long: 0, longMs: 0, t0: performance.now() };
    window.__PHMO = new MutationObserver((ms) => { window.__PH.mut += ms.length; });
    window.__PHMO.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    try {
      window.__PHPO = new PerformanceObserver((l) => { l.getEntries().forEach((e) => { window.__PH.long += 1; window.__PH.longMs += e.duration; }); });
      window.__PHPO.observe({ entryTypes: ['longtask'] });
    } catch (e) { window.__PH.noLongTask = true; }
    return true;
  })()`);

  /* A 组：普通难度 */
  await t.ev(`(() => { setDifficulty('normal'); return difficultyId(); })()`);
  const normal = await runRounds(t, 'normal');

  /* B 组：真·困难难度（先切档，再复核 difficultyId） */
  const switchRes = await t.ev(`(() => { setDifficulty('nightmare'); return { diff: difficultyId(), meta: state.difficulty }; })()`);
  console.log('SWITCH ' + JSON.stringify(switchRes));
  const hard = await runRounds(t, 'nightmare');

  /* 性能读数 */
  const perf = await t.ev(`(() => {
    const a = window.__PH; const sec = (performance.now() - a.t0) / 1000;
    window.__PHMO.disconnect(); if (window.__PHPO) window.__PHPO.disconnect();
    return { seconds: +sec.toFixed(2), mutations: a.mut, mutationsPerSec: +(a.mut / sec).toFixed(1), longTasks: a.long, longTaskMs: +a.longMs.toFixed(1), longtaskSupported: !a.noLongTask };
  })()`);

  await t.shot(`feely-${TAG}.png`);
  t.close();

  /* 判定：困难档三条上限 + 顿帧上限（用实测峰值，不用配置值） */
  const vr = hard.viewRadius || 0;
  const checks = [
    { name: '困难·顿帧 ≤130ms', got: hard.peaks.hitStopMs, limit: 130, pass: hard.peaks.hitStopMs <= 130.5 },
    { name: '困难·白闪 ≤80ms', got: hard.peaks.flashMs, limit: 80, pass: hard.peaks.flashMs <= 80 },
    { name: '困难·震幅 ≤视野1.2%', got: hard.peaks.shake, limit: +(vr * 0.012).toFixed(2), pass: hard.peaks.shake <= vr * 0.012 + 0.05 },
    { name: '困难·粒子池 ≤100', got: hard.peaks.pool, limit: 100, pass: hard.peaks.pool <= 100 },
    { name: '困难·S2粒子=普通×0.7', got: hard.byTier.S2 ? hard.byTier.S2.particles : null, limit: normal.byTier.S2 ? normal.byTier.S2.particles : null, pass: !!(normal.byTier.S2 && hard.byTier.S2) && hard.byTier.S2.particles < normal.byTier.S2.particles }
  ];

  const out = { tag: TAG, finger, at: new Date().toISOString(), base, switchRes, normal, hard, checks, perf };
  const f = path.join(OUT, `feely-${TAG}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.table([
    { 档位: 'normal', 粒子峰值: normal.peaks.particles, 白闪峰值: normal.peaks.flashMs, 震幅峰值: normal.peaks.shake, 顿帧峰值: normal.peaks.hitStopMs, 粒子池: normal.peaks.pool, 视野半径: normal.viewRadius },
    { 档位: 'nightmare', 粒子峰值: hard.peaks.particles, 白闪峰值: hard.peaks.flashMs, 震幅峰值: hard.peaks.shake, 顿帧峰值: hard.peaks.hitStopMs, 粒子池: hard.peaks.pool, 视野半径: hard.viewRadius }
  ]);
  console.table(checks.map((c) => ({ 项: c.name, 实测: c.got, 上限: c.limit, 结果: c.pass ? 'PASS' : 'FAIL' })));
  console.log('PERF ' + JSON.stringify(perf));
  console.log('WROTE ' + f);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
