/**
 * 逐层消融探针（只读，不改主文件）
 * ------------------------------------------------------------
 * 目的：定位"整间房偏紫"（meanRgb≈70,55,80 / 色相 285°）到底由哪一层造成。
 * 手段：用页面里已有的调试口改配置 → 重烘焙 → 读 artAudit.roomStats() 的逐房间像素均值。
 * 每开/关一层都记录 meanRgb / ΔG / near / l50，有数字才算证据，不做推断。
 *
 * 用法：node _probe/ablate_probe.js [tag]
 *      ARCANE_MAIN=<被测 html> 可指定版本，默认主文件。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'ablate';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-ab-${TAG}-${process.pid}-${Date.now()}`);
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

/** 进入游戏：标题 → 真实点卡 → 开始 */
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

/** 把 roomStats 收敛成"战斗房平均色 + 近中性/亮度"一行数字 */
function summarize(stats) {
  if (!Array.isArray(stats) || !stats.length) return null;
  const rows = stats.filter((r) => r && r.meanRgb && r.type === 'battle');
  const use = rows.length ? rows : stats.filter((r) => r && r.meanRgb);
  if (!use.length) return null;
  const avg = (k) => use.reduce((s, r) => s + (r[k] || 0), 0) / use.length;
  /* roomStats 的 meanRgb 是数组 [r,g,b]，不是对象 */
  const mr = (i) => use.reduce((s, r) => s + r.meanRgb[i], 0) / use.length;
  return {
    rooms: use.length,
    r: +mr(0).toFixed(1), g: +mr(1).toFixed(1), b: +mr(2).toFixed(1),
    near: +avg('near').toFixed(4), l50: +avg('l50').toFixed(4), s30: +avg('s30').toFixed(4),
    per: use.map((r) => ({ id: r.id, type: r.type, rgb: r.meanRgb }))
  };
}

/** 消融矩阵：每项给出"打开/关闭"的页面内语句（用页面已有配置对象 + 调试口） */
const ABLATIONS = [
  { name: 'baseline', on: '' },
  { name: 'SCENE_ART2.enabled=false', on: 'SCENE_ART2_CONFIG.enabled=false;' },
  { name: 'floorWash=false', on: 'SCENE_ART2_CONFIG.floorWash=false;' },
  { name: 'directionalLight=false', on: 'SCENE_ART2_CONFIG.directionalLight=false;' },
  { name: 'contactShadow=false', on: 'SCENE_ART2_CONFIG.contactShadow=false;' },
  { name: 'vignette=0', on: 'SCENE_ART_CONFIG.vignette=0;' },
  { name: 'ART_DIRECTION.enabled=false', on: 'ART_DIRECTION_CONFIG.enabled=false;' },
  { name: 'MECH_SCENE.enabled=false', on: 'MECH_SCENE_CONFIG.enabled=false;' },
  { name: 'SCENE_ART.enabled=false', on: 'SCENE_ART_CONFIG.enabled=false;' },
  { name: 'ALL_OFF(底色+灯光only)', on: 'SCENE_ART2_CONFIG.enabled=false;SCENE_ART_CONFIG.enabled=false;ART_DIRECTION_CONFIG.enabled=false;MECH_SCENE_CONFIG.enabled=false;' }
];

/** 主流程 */
async function main() {
  const t = await boot();
  const finger = { file: MAIN, bytes: fs.statSync(MAIN).size, md5: md5File(MAIN) };
  console.log('FINGER ' + JSON.stringify(finger));
  await enterGame(t);
  await sleep(700);

  /* 1) 先留一份配置快照，保证每次消融后能原样还原 */
  const snap = await t.ev(`(() => {
    const s = {};
    try { s.s2 = { enabled: SCENE_ART2_CONFIG.enabled, fw: SCENE_ART2_CONFIG.floorWash, dl: SCENE_ART2_CONFIG.directionalLight, cs: SCENE_ART2_CONFIG.contactShadow }; } catch (e) { s.s2 = null; }
    try { s.vig = SCENE_ART_CONFIG.vignette; } catch (e) { s.vig = null; }
    try { s.ad = ART_DIRECTION_CONFIG.enabled; } catch (e) { s.ad = null; }
    try { s.mech = MECH_SCENE_CONFIG.enabled; } catch (e) { s.mech = null; }
    try { s.s1 = SCENE_ART_CONFIG.enabled; } catch (e) { s.s1 = null; }
    return s;
  })()`);
  console.log('SNAP ' + JSON.stringify(snap));

  /* 1.5) 关键取证：逐房实际灯色（roomAccentTheme 是否把近中性灯转成紫），
         以及"只用底色+细节+灯光"合成的标准房读数（判断紫是否在基础层） */
  const diag = await t.ev(`(() => {
    const out = {};
    try { out.shiftP30 = shiftHueArr([160,166,176], 30); out.shiftM30 = shiftHueArr([160,166,176], -30); out.shiftP90 = shiftHueArr([160,166,176], 90); } catch (e) { out.shiftErr = String(e); }
    try {
      const st = window.__roamDebug.getState();
      const rooms = st.rooms || [];
      out.rooms = rooms.map((r) => {
        const h = roomHash01(r, 41);
        const rt = roomAccentTheme(getTheme(st.floor), r);
        return { id: r.id, type: r.type, hash: +h.toFixed(4), deg: +((h - 0.5) * 60).toFixed(2), light: rt.light, accent: rt.accent };
      });
    } catch (e) { out.roomErr = String(e); }
    try { out.sample = window.__roamDebug.sceneArt2.sampleTheme('mech'); } catch (e) { out.sampleErr = String(e); }
    return out;
  })()`);
  console.log('DIAG ' + JSON.stringify(diag));

  /* 1.6) 爽感硬上限的运行时取证（不是"代码里写了"，而是页面里真的生效的值） */
  const feel = await t.ev(`(() => {
    const out = {};
    try {
      out.s0 = FX_TIER_CONFIG.tiers.S0; out.s1 = FX_TIER_CONFIG.tiers.S1; out.s2 = FX_TIER_CONFIG.tiers.S2;
      out.hitstopMax = HITSTOP_CONFIG.maxSeconds;
      out.shakeRatio = FX_TIER_CONFIG.shakeMaxViewRatio;
      out.flashDefaultMs = FEEL_CONFIG.flashMs;
      out.diff = (typeof difficultyId === 'function') ? difficultyId() : null;
      out.hardNoise = out.diff === 'nightmare';
    } catch (e) { out.err = String(e); }
    return out;
  })()`);
  console.log('FEEL ' + JSON.stringify(feel));

  /* 还原函数：把三套配置按快照写回，再重烘焙 */
  const RESTORE = `(() => {
    const s = ${JSON.stringify(snap)};
    try { if (s.s2) { SCENE_ART2_CONFIG.enabled=s.s2.enabled; SCENE_ART2_CONFIG.floorWash=s.s2.fw; SCENE_ART2_CONFIG.directionalLight=s.s2.dl; SCENE_ART2_CONFIG.contactShadow=s.s2.cs; } } catch (e) {}
    try { if (s.vig !== null) SCENE_ART_CONFIG.vignette = s.vig; } catch (e) {}
    try { if (s.ad !== null) ART_DIRECTION_CONFIG.enabled = s.ad; } catch (e) {}
    try { if (s.mech !== null) MECH_SCENE_CONFIG.enabled = s.mech; } catch (e) {}
    try { if (s.s1 !== null) SCENE_ART_CONFIG.enabled = s.s1; } catch (e) {}
    window.__roamDebug.sceneArt2.rebake();
    return true;
  })()`;

  const rows = [];
  for (const a of ABLATIONS) {
    if (a.on) {
      const r = await t.ev(`(() => { ${a.on} window.__roamDebug.sceneArt2.rebake(); return true; })()`);
      if (r && r.__err) { rows.push({ name: a.name, err: r.__err }); await t.ev(RESTORE); continue; }
    }
    await sleep(180);
    const stats = await t.ev(`(() => { try { return window.__roamDebug.artAudit.roomStats(); } catch (e) { return { __err: String((e && e.message) || e) }; } })()`);
    const sum = summarize(stats);
    rows.push(Object.assign({ name: a.name }, sum ? {
      r: sum.r, g: sum.g, b: sum.b, near: sum.near, l50: sum.l50, s30: sum.s30, rooms: sum.rooms
    } : { err: (stats && stats.__err) || 'no-rooms' }));
    if (a.on) await t.ev(RESTORE);
    await sleep(120);
  }

  /* 2) 每层开关的 ΔG（相对 baseline）——判据写死：ΔG 最大者即"压绿"的那层 */
  const base = rows[0] || {};
  rows.forEach((r) => {
    if (typeof r.g === 'number' && typeof base.g === 'number') r.dG = +(r.g - base.g).toFixed(1);
    if (typeof r.near === 'number' && typeof base.near === 'number') r.dNear = +(r.near - base.near).toFixed(4);
  });

  /* 3) 主题变体 / 灯色证据：把每层 floorBase 与第 1 层逐房灯色打出来 */
  const themeInfo = await t.ev(`(() => {
    const out = { floors: [], rooms: null };
    try { out.floors = [1,2,3,4,5,6].map((f) => { const th = getTheme(f); return { f, id: th.id, floorBase: th.floorBase, floorAlt: th.floorAlt, light: th.light, accent: th.accent, wash: th.floorWash }; }); } catch (e) { out.floorsErr = String(e); }
    try { out.rooms = window.__roamDebug.artAudit.lightProbe(); } catch (e) { out.roomsErr = String(e); }
    return out;
  })()`);
  console.log('THEME ' + JSON.stringify(themeInfo));

  /* 4) 用户要的证据口径：DOM 变更/秒 + 长任务数（不用帧时间） */
  await t.ev(`(() => {
    window.__AB = { mut: 0, long: 0, longMs: 0, t0: performance.now() };
    window.__ABMO = new MutationObserver((ms) => { window.__AB.mut += ms.length; });
    window.__ABMO.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    try {
      window.__ABPO = new PerformanceObserver((l) => { l.getEntries().forEach((e) => { window.__AB.long += 1; window.__AB.longMs += e.duration; }); });
      window.__ABPO.observe({ entryTypes: ['longtask'] });
    } catch (e) { window.__AB.noLongTask = true; }
    return true;
  })()`);
  await sleep(3000);
  const perf = await t.ev(`(() => {
    const a = window.__AB; const sec = (performance.now() - a.t0) / 1000;
    window.__ABMO.disconnect(); if (window.__ABPO) window.__ABPO.disconnect();
    return { seconds: +sec.toFixed(2), mutations: a.mut, mutationsPerSec: +(a.mut / sec).toFixed(1), longTasks: a.long, longTaskMs: +a.longMs.toFixed(1), longtaskSupported: !a.noLongTask };
  })()`);

  await t.shot(`ablate-${TAG}.png`);
  t.close();

  const out = { tag: TAG, finger, at: new Date().toISOString(), snap, diag, feel, rows, theme: themeInfo, perf };
  const f = path.join(OUT, `ablate-${TAG}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.table(rows.map((r) => ({ 层: r.name, R: r.r, G: r.g, B: r.b, dG: r.dG, near: r.near, l50: r.l50, s30: r.s30 })));
  console.log('PERF ' + JSON.stringify(perf));
  console.log('WROTE ' + f);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
