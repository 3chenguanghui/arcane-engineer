/**
 * 体验审核 · 主探针（只读，不写主文件）
 * ------------------------------------------------------------
 * 四个模式，各自独立起一次 Edge headless：
 *   node _probe/audit_probe.js flow     新手前 3 分钟 + 死亡提示覆盖
 *   node _probe/audit_probe.js density  同屏文字密度（Canvas 文字逐帧录制）
 *   node _probe/audit_probe.js reward   三选一卡面可读性
 *   node _probe/audit_probe.js perf     帧时间 + 按键→画面延迟
 * 产出：shots/audit/<mode>.json + 同名 png（含 annotated 标注图）
 * 约束：1440×900 dpr=1；临时 profile 落 D:\.temp，结束即删；不写任何主文件。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const MODE = process.argv[2] || 'flow';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-audit-${MODE}-${process.pid}-${Date.now()}`);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9741 + (['flow', 'density', 'reward', 'perf'].indexOf(MODE) + 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 找本机 Edge 可执行文件
 * @returns {string} Edge 绝对路径
 */
function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 msedge.exe');
}

/**
 * 计算文件 MD5（大写）
 * @param {string} file 文件路径
 * @returns {string} MD5
 */
function md5File(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 启动浏览器并连上 CDP，返回工具函数集合
 * @returns {Promise<Object>} { send, ev, shot, shotClip, close }
 */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(findEdge(), [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
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

  /**
   * 页面内执行表达式（可返回 Promise 结果）
   * @param {string} expression JS 表达式
   * @returns {Promise<any>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };

  /**
   * 整页截图
   * @param {string} name 文件名
   * @returns {Promise<Object>} { file, bytes }
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return { file: name, bytes: fs.statSync(f).size };
  };

  /**
   * 1:1 裁切截图
   * @param {string} name 文件名
   * @param {{x:number,y:number,w:number,h:number}} rect 裁切框
   * @returns {Promise<Object>} { file, bytes }
   */
  const shotClip = async (name, rect) => {
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 }
    });
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return { file: name, bytes: fs.statSync(f).size };
  };

  /**
   * 关闭浏览器并清理临时 profile
   * @returns {Promise<void>}
   */
  const close = async () => {
    try { ws.close(); } catch (e) { /* ignore */ }
    try { edge.kill(); } catch (e) { /* ignore */ }
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch (e) { console.log('PROFILE_CLEAN_FAIL ' + PROFILE); }
  };

  return { send, ev, shot, shotClip, close };
}

/**
 * 打开页面并进到游戏（标题 → 选角 → 战斗），返回各阶段时间戳
 * @param {Object} t boot() 的返回值
 * @param {string} url file:// 地址
 * @returns {Promise<Object>} 阶段时间与首帧信息
 */
async function enterGame(t, url, skipNavigate) {
  const { ev } = t;
  const t0 = Date.now();
  if (!skipNavigate) await t.send('Page.navigate', { url });
  /* 等标题按钮出现 */
  let titleAt = 0;
  for (let i = 0; i < 80; i += 1) {
    const ok = await ev(`(() => { const b = document.getElementById('btnStart'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
    if (ok) { titleAt = Date.now() - t0; break; }
    await sleep(150);
  }
  const beforeStart = await ev(`(() => {
    const q = (s) => document.querySelector(s);
    const vis = (el) => !!el && el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !!el;
    const guide = q('.title-guide') || q('.title-guide-list');
    const keys = Array.from(document.querySelectorAll('.title-guide li, .title-guide-row, .guide-row')).map((el) => el.textContent.replace(/\\s+/g, ' ').trim());
    return {
      startText: (q('#btnStart') || {}).textContent ? q('#btnStart').textContent.trim() : null,
      guideText: guide ? guide.textContent.replace(/\\s+/g, ' ').trim().slice(0, 400) : null,
      guideRows: keys.length,
      guideItems: keys.slice(0, 10),
      introHintVisible: vis(q('#introHint')),
      introHintText: q('#introHint') ? q('#introHint').textContent.replace(/\\s+/g, ' ').trim() : null,
      toastText: vis(q('#toast')) ? q('#toast').textContent.trim() : null,
      templateCount: document.querySelectorAll('.title-guide, .title-keys, .keycap').length
    };
  })()`);
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  let charAt = 0;
  for (let i = 0; i < 60; i += 1) {
    const ok = await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
    if (ok) { charAt = Date.now() - t0; break; }
    await sleep(150);
  }
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  let gameAt = 0;
  for (let i = 0; i < 100; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; const s = d.getState(); return { mode: s.mode, status: s.status, floor: s.floor }; })()`);
    if (st && st.mode === 'playing') { gameAt = Date.now() - t0; break; }
    await sleep(150);
  }
  return { titleAtMs: titleAt, charAtMs: charAt, gameAtMs: gameAt, beforeStart };
}

/**
 * 注入 Canvas 文字录制器：按帧收集 #game 上的 fillText（含屏幕坐标 / 字号 / 宽度）
 * @returns {Promise<boolean>}
 */
async function installRecorder(ev) {
  return ev(`(() => {
    if (window.__rec) return true;
    const proto = CanvasRenderingContext2D.prototype;
    const mainCanvas = document.getElementById('game');
    const rec = { frames: [], cur: [], fps: [], ticks: 0 };
    window.__rec = rec;
    const origFill = proto.fillText;
    proto.fillText = function (text, x, y) {
      if (this.canvas === mainCanvas) {
        try {
          const t = this.getTransform();
          const str = String(text);
          const m = String(this.font).match(/(\\d+(?:\\.\\d+)?)px/);
          const size = m ? parseFloat(m[1]) : 0;
          const sx = t.a * x + t.c * y + t.e;
          const sy = t.b * x + t.d * y + t.f;
          const w = this.measureText(str).width;
          const align = this.textAlign || 'start';
          const left = align === 'center' ? sx - w / 2 : (align === 'right' || align === 'end' ? sx - w : sx);
          rec.cur.push({ t: str, x: +left.toFixed(1), y: +(sy - size).toFixed(1), w: +w.toFixed(1), h: size, size: size, color: String(this.fillStyle), a: +this.globalAlpha.toFixed(2) });
        } catch (err) { /* 忽略 */ }
      }
      return origFill.apply(this, arguments);
    };
    /* 帧边界用 rAF 自身：每个 rAF 回调 flush 一次，正好等于一个真实渲染帧；
       不再用 setTransform 切分（draw() 一帧内会多次重置变换，会把一帧拆成多块） */
    let last = performance.now();
    const tick = (now) => {
      rec.ticks += 1;
      rec.fps.push(+(now - last).toFixed(2));
      last = now;
      if (rec.fps.length > 8000) rec.fps.shift();
      if (rec.ticks > 30) {
        rec.frames.push({ at: Math.round(performance.now()), items: rec.cur });
        if (rec.frames.length > 6000) rec.frames.shift();
      }
      rec.cur = [];
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
}

/**
 * 在指定帧上画标注层（只注入 DOM，不改文件），并截图
 * @param {Object} t boot() 返回值
 * @param {string} name 截图名
 * @returns {Promise<Object>} 截图信息
 */
async function annotateAndShot(t, name) {
  /* 先等一个"视口内文字数 ≥ 28"的帧，再对当前帧画框，保证标注框和画面同一帧 */
  await t.ev(`(() => new Promise((resolve) => {
    const inV = (i) => i.x + i.w > 0 && i.x < 1440 && i.y + i.h > 0 && i.y < 900;
    let guard = 0;
    const check = () => {
      const fs = window.__rec ? window.__rec.frames : [];
      const last = fs[fs.length - 1];
      guard += 1;
      if ((last && last.items.filter(inV).length >= 28) || guard > 60) resolve(true);
      else setTimeout(check, 16);
    };
    check();
  }))()`);
  await t.ev(`(() => {
    const inV = (i) => i.x + i.w > 0 && i.x < 1440 && i.y + i.h > 0 && i.y < 900;
    const fs = window.__rec ? window.__rec.frames : [];
    const it = fs.length ? fs[fs.length - 1].items.filter(inV) : [];
    const old = document.getElementById('__auditAnno');
    if (old) old.remove();
    if (!it.length) return 0;
    const layer = document.createElement('div');
    layer.id = '__auditAnno';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
    it.forEach((x, i) => {
      const b = document.createElement('div');
      b.style.cssText = 'position:absolute;border:1px solid rgba(255,64,96,.85);background:rgba(255,64,96,.10);left:' + x.x + 'px;top:' + x.y + 'px;width:' + Math.max(6, x.w) + 'px;height:' + Math.max(8, x.size * 1.2) + 'px';
      const tag = document.createElement('span');
      tag.textContent = (i + 1) + ' · ' + x.size + 'px';
      tag.style.cssText = 'position:absolute;left:0;top:-11px;font:9px/1 monospace;color:#fff;background:#c02040;padding:0 2px;white-space:nowrap';
      b.appendChild(tag);
      layer.appendChild(b);
    });
    const note = document.createElement('div');
    note.textContent = '本轮帧内 Canvas 文字 ' + it.length + ' 条（红框为运行时标注，非游戏内 UI）';
    note.style.cssText = 'position:absolute;left:12px;top:12px;font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.72);padding:4px 8px;border:1px solid #ff4060';
    layer.appendChild(note);
    document.body.appendChild(layer);
    return it.length;
  })()`);
  const s = await t.shot(name);
  await t.ev(`(() => { const el = document.getElementById('__auditAnno'); if (el) el.remove(); return true; })()`);
  return s;
}

/**
 * 让战斗真的发生：在玩家周围刷 6 个敌人，并持续按键
 * @param {Object} t boot() 返回值
 * @param {number} ms 持续时长
 * @returns {Promise<void>}
 */
async function combatFor(t, ms) {
  const { ev } = t;
  const spawn = await ev(`(() => {
    const d = window.__roamDebug;
    if (!d || !d.spawnEnemy) return 'NO_SPAWN';
    const kinds = d.enemies ? Object.keys(d.enemies) : [];
    let ids = ['crawler', 'drone', 'mech'];
    try {
      const info = d.enemies && d.enemies.info ? d.enemies.info() : null;
      if (info && Array.isArray(info.ids) && info.ids.length) ids = info.ids.slice(0, 3);
      else if (info && Array.isArray(info.types) && info.types.length) ids = info.types.map((x) => x.id || x).slice(0, 3);
    } catch (e) { /* 用默认 */ }
    const made = [];
    ids.forEach((id, i) => {
      const ang = (Math.PI * 2 / ids.length) * i;
      try { made.push(d.spawnEnemy(id, Math.cos(ang) * 110, Math.sin(ang) * 110)); } catch (e) { /* 类型不存在 */ }
    });
    return { kinds: kinds.slice(0, 12), made: made };
  })()`);
  console.log('SPAWN ' + JSON.stringify(spawn));
  const keys = ['j', 'k', 'j', '1', '2', 'shift', 'j', 'k'];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    const k = keys[i % keys.length];
    i += 1;
    await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(k)}, bubbles: true })); return true; })()`);
    await sleep(110);
  }
}

/**
 * 采一段帧率
 * @param {Object} t boot() 返回值
 * @param {number} ms 采样时长
 * @returns {Promise<Object>} { deltas, longTasks }
 */
async function sampleFrames(t, ms) {
  return t.ev(`(() => new Promise((resolve) => {
    const deltas = [];
    const longTasks = [];
    let po = null;
    try {
      po = new PerformanceObserver((list) => { list.getEntries().forEach((e) => longTasks.push(+e.duration.toFixed(1))); });
      po.observe({ entryTypes: ['longtask'] });
    } catch (e) { /* 不支持 */ }
    let last = performance.now();
    const t0 = last;
    const tick = (now) => {
      deltas.push(+(now - last).toFixed(2));
      last = now;
      if (now - t0 < ${ms}) requestAnimationFrame(tick);
      else { if (po) po.disconnect(); resolve({ deltas: deltas, longTasks: longTasks, drawStats: (window.__roamDebug && window.__roamDebug.getState) ? window.__roamDebug.getState().drawStats : null }); }
    };
    requestAnimationFrame(tick);
  }))()`);
}

/**
 * 统计一组数值的分位数
 * @param {number[]} arr 数值
 * @param {number} q 0..1
 * @returns {number} 分位值
 */
function pct(arr, q) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
  return +s[i].toFixed(2);
}

/**
 * 模式 flow：新手前 3 分钟 + 死亡提示覆盖
 * @returns {Promise<void>}
 */
async function modeFlow() {
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  await t.send('Page.navigate', { url });
  await sleep(3000);
  const title = await t.shot('flow-1-title.png');
  const titleText = await t.ev(`(() => {
    const vis = (el) => !!el && (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true);
    const out = [];
    let occluded = 0;
    document.querySelectorAll('body *').forEach((el) => {
      if (/^(script|style|link|meta|canvas|svg|path)$/i.test(el.tagName)) return;
      let own = '';
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
      own = own.replace(/\\s+/g, ' ').trim();
      if (!own) return;
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.top > 900 || r.bottom < 0) return;
      const top = document.elementFromPoint(Math.min(1439, Math.max(0, r.left + r.width / 2)), Math.min(899, Math.max(0, r.top + r.height / 2)));
      const covered = top && !(el === top || el.contains(top) || top.contains(el));
      if (covered) { occluded += 1; return; }
      out.push({ text: own.slice(0, 120), fs: parseFloat(getComputedStyle(el).fontSize), y: Math.round(r.top), x: Math.round(r.left) });
    });
    return { items: out, count: out.length, occluded: occluded };
  })()`);
  const t2 = t;
  const enterAt = Date.now();
  const flow = await enterGame(t2, url, true);
  const firstShot = await t2.shot('flow-2-first-frame.png');
  const firstFrame = await t2.ev(`(() => {
    const d = window.__roamDebug;
    const s = d.getState();
    const q = (x) => document.querySelector(x);
    const vis = (el) => !!el && (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true);
    const hint = q('#onboardHint');
    const intro = q('#introHint');
    const toast = q('#toast');
    return {
      mode: s.mode, floor: s.floor,
      objective: q('#hudObjective') ? q('#hudObjective').textContent.trim() : null,
      roomType: q('#hudRoomType') ? q('#hudRoomType').textContent.trim() : null,
      onboardHintVisible: vis(hint), onboardHintText: hint ? hint.textContent.trim() : null,
      introVisible: vis(intro), introText: intro ? intro.textContent.replace(/\\s+/g, ' ').trim() : null,
      toastVisible: vis(toast), toastText: toast ? toast.textContent.trim() : null,
      onboard: d.onboard ? d.onboard.info() : null,
      canSkipIntro: !!q('#introHintClose')
    };
  })()`);

  // 首个三选一：打开→量读取成本→关闭，记为"第一次要做决定的时刻"
  const rewardAt = Date.now();
  await t2.ev(`(() => { const d = window.__roamDebug; if (d && d.openReward) d.openReward('audit'); return true; })()`);
  await sleep(600);
  const firstReward = await t2.ev(`(() => {
    const cards = Array.from(document.querySelectorAll('.reward-card'));
    return {
      count: cards.length,
      names: cards.map((c) => (c.querySelector('.r-name') || {}).textContent || ''),
      descChars: cards.map((c) => ((c.querySelector('.r-desc') || {}).textContent || '').replace(/\\s+/g, '').length),
      visible: cards.length > 0 && !!document.querySelector('.modal-layer.is-reward:not(.hidden)')
    };
  })()`);
  const rewardShot = await t2.shot('flow-3-first-reward.png');
  await t2.ev(`(() => { const d = window.__roamDebug; if (d && d.chooseReward) { const k = document.querySelector('[data-reward-key]'); if (k) d.chooseReward(k.getAttribute('data-reward-key')); } return true; })()`);
  await sleep(500);

  // 死亡提示覆盖：逐种死因各跑一次（重启后杀）
  const kinds = ['contact', 'charge', 'burst', 'bullet', 'hazard', 'selfdestruct', 'barrel', 'collapse'];
  const deaths = [];
  for (const kind of kinds) {
    const ok = await t2.ev(`(() => {
      const d = window.__roamDebug;
      if (!d || !d.getState) return 'NO_DEBUG';
      const s = d.getState();
      if (s.mode !== 'playing') { if (d.restart) d.restart(); return 'RESTART'; }
      const r = d.killBy(${JSON.stringify(kind)}, '审核来源', null);
      return r && r.status;
    })()`);
    if (ok !== 'dead' && ok !== 'gameover' && ok !== 'result') { await sleep(400); }
    await sleep(700);
    const info = await t2.ev(`(() => {
      const d = window.__roamDebug;
      const txt = d.resultText ? d.resultText() : '';
      const cause = d.deathCause ? d.deathCause() : null;
      return {
        status: d.getState().status,
        causeKind: cause ? (cause.kind || cause.id || null) : null,
        causeLabel: cause ? (cause.label || cause.name || null) : null,
        quote: cause ? (cause.line || cause.quote || null) : null,
        resultHasCause: /死因|致命|来源/.test(txt),
        resultText: txt.replace(/\\s+/g, ' ').slice(0, 240)
      };
    })()`);
    deaths.push(Object.assign({ kind: kind, dispatchResult: ok }, info));
    if (kind === 'bullet') await t2.shot('flow-4-death-result.png');
    await t2.ev(`(() => { const d = window.__roamDebug; if (d.restart) d.restart(); return true; })()`);
    await sleep(1500);
  }

  const u5 = await t2.ev(`(() => { const d = window.__roamDebug; return d.u5Audit ? { labels: d.u5Audit().labels, covered: d.u5Audit().covered, kinds: d.u5Audit().kinds } : null; })()`);
  const report = {
    sourceBytes: fs.statSync(MAIN).size,
    sourceMd5: md5File(MAIN),
    viewport: '1440x900 dpr=1',
    titleScreenTextCount: titleText.count,
    titleOccludedCount: titleText.occluded,
    titleTotalChars: titleText.items.reduce((a, x) => a + Array.from(x.text).length, 0),
    titleScreenTexts: titleText.items.slice(0, 60),
    flow: flow,
    timeToFirstDecisionMs: rewardAt - enterAt,
    firstFrame: firstFrame,
    firstReward: firstReward,
    deaths: deaths,
    u5: u5,
    shots: { title: title, firstFrame: firstShot, firstReward: rewardShot }
  };
  fs.writeFileSync(path.join(OUT, 'flow.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await t2.close();
}

/**
 * 模式 density：同屏文字密度
 * @returns {Promise<void>}
 */
async function modeDensity() {
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  const flow = await enterGame(t, url);
  await installRecorder(t.ev);
  await sleep(1200);

  // 基线：静止 3 秒（不刷怪、不按键）
  await sleep(3000);
  const idleFrames = await t.ev(`(() => {
    const f = window.__rec.frames.slice(-160);
    return { frames: f, ticks: window.__rec.ticks };
  })()`);
  await t.shot('density-1-idle.png');
  await annotateAndShot(t, 'density-1-idle-annotated.png');

  /* 边打边等"最挤的一帧"（视口内 ≥16 条，或 ≥14 且含伤害数字），等到了立刻拍干净图 + 标注图 */
  const combatDone = combatFor(t, 22000);
  const peakReached = await t.ev(`(() => new Promise((resolve) => {
    const inV = (i) => i.x + i.w > 0 && i.x < 1440 && i.y + i.h > 0 && i.y < 900;
    const isNum = (i) => /^[-+]?\\d+(\\.\\d+)?$/.test(i.t);
    let guard = 0;
    const check = () => {
      const fs = window.__rec ? window.__rec.frames : [];
      const last = fs[fs.length - 1];
      guard += 1;
      const items = last ? last.items.filter(inV) : [];
      const hasNum = items.some(isNum);
      if (items.length >= 16 || (items.length >= 14 && hasNum)) { resolve({ ok: true, n: items.length, guard: guard }); return; }
      if (guard > 2600) { resolve({ ok: false, n: items.length, guard: guard }); return; }
      setTimeout(check, 8);
    };
    check();
  }))()`);
  const cleanShot = await t.shot('density-2-busy.png');
  const annoCount = await annotateAndShot(t, 'density-3-busy-annotated.png');
  await combatDone;
  const raw = await t.ev(`(() => {
    const rec = window.__rec;
    return { frames: rec.frames, fps: rec.fps.slice(-1600), ticks: rec.ticks };
  })()`);

  /* 只算"真的在视口里"的文字：Canvas 会照画视口外的门牌（x 可到 2500+），
     那不算同屏密度。判定：文字框与 1440×900 相交即计入。 */
  const inView = (it) => it.x + it.w > 0 && it.x < 1440 && it.y + it.h > 0 && it.y < 900;
  const frames = raw.frames.map((f) => ({ at: f.at, items: f.items.filter(inView) }));
  const counts = frames.map((f) => f.items.length);
  const sizes = {};
  const texts = {};
  /* 停留检测：同一文本 + 同一位置（8px 网格）连续存在 ≥3000ms（按帧时间戳算，不按帧数） */
  const prevSig = new Map();
  const stuckHits = {};
  frames.forEach((f, idx) => {
    f.items.forEach((it) => {
      sizes[it.size] = (sizes[it.size] || 0) + 1;
      texts[it.t] = (texts[it.t] || 0) + 1;
      const s = it.t + '@' + Math.round(it.x / 8) + ',' + Math.round(it.y / 8);
      const prev = prevSig.get(s);
      const start = prev ? prev.start : f.at;
      prevSig.set(s, { start: start, idx: idx });
      if (f.at - start >= 3000 && !stuckHits[s]) {
        stuckHits[s] = { text: it.t, x: it.x, y: it.y, size: it.size, ms: f.at - start };
      }
    });
    prevSig.forEach((v, k) => { if (v.idx !== idx) prevSig.delete(k); });
  });
  const perFrame = {
    p50: pct(counts, 0.5), p95: pct(counts, 0.95), max: Math.max.apply(null, counts),
    mean: +(counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length)).toFixed(1),
    frames: counts.length, ticks: raw.ticks,
    /* 最挤的三帧：把这一帧里每条文字都记下来，报告里可直接引用 */
    worst: frames.map((f, i) => ({ i: i, n: f.items.length })).sort((a, b) => b.n - a.n).slice(0, 3)
      .map((w) => ({ n: w.n, items: frames[w.i].items.map((it) => it.t + ' · ' + it.size + 'px @' + it.x + ',' + it.y) }))
  };
  const topTexts = Object.keys(texts).map((k) => ({ text: k, perFrameAvg: +(texts[k] / Math.max(1, counts.length)).toFixed(2) })).sort((a, b) => b.perFrameAvg - a.perFrameAvg).slice(0, 25);
  const sizeHist = Object.keys(sizes).map((k) => ({ size: Number(k), avg: +(sizes[k] / Math.max(1, counts.length)).toFixed(2) })).sort((a, b) => a.size - b.size);

  /* DOM 文字：CSS 可见数 + 被上层遮挡数（elementFromPoint 判定；pointer-events:none 的遮罩测不出，故同时给出两个数） */
  const domCount = await t.ev(`(() => {
    const vis = (el) => !!el && (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true);
    let css = 0, occluded = 0;
    const sample = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (/^(script|style|link|meta|canvas|svg|path)$/i.test(el.tagName)) return;
      let own = '';
      for (const c of el.childNodes) if (c.nodeType === 3) own += c.textContent;
      own = own.trim();
      if (!own) return;
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > 900) return;
      css += 1;
      const top = document.elementFromPoint(Math.min(1439, Math.max(0, r.left + r.width / 2)), Math.min(899, Math.max(0, r.top + r.height / 2)));
      const hit = !top || el === top || el.contains(top) || top.contains(el);
      if (!hit) occluded += 1;
      else if (sample.length < 12) sample.push(own.slice(0, 24) + ' @' + Math.round(r.left) + ',' + Math.round(r.top));
    });
    return { cssVisible: css, occluded: occluded, unoccluded: css - occluded, sample: sample };
  })()`);

  const fps = raw.fps.slice(1);
  const report = {
    sourceBytes: fs.statSync(MAIN).size,
    sourceMd5: md5File(MAIN),
    viewport: '1440x900 dpr=1',
    enter: flow,
    idleFrames: (() => {
      const iv = idleFrames.frames.map((f) => f.items.filter(inView).length);
      const last = idleFrames.frames.length ? idleFrames.frames[idleFrames.frames.length - 1].items.filter(inView) : [];
      return {
        n: iv.length, p50: pct(iv, 0.5), max: Math.max.apply(null, iv.concat([0])),
        mean: +(iv.reduce((a, b) => a + b, 0) / Math.max(1, iv.length)).toFixed(1),
        lastFrameTexts: last.map((i) => i.t + ' · ' + i.size + 'px @' + i.x + ',' + i.y)
      };
    })(),
    perFrame: perFrame,
    sizeHist: sizeHist,
    topTexts: topTexts,
    stuckOver3s: Object.keys(stuckHits).map((k) => stuckHits[k]).slice(0, 40),
    stuckCount: Object.keys(stuckHits).length,
    peak: peakReached,
    domVisibleTextCount: domCount,
    annotatedCount: annoCount,
    frameDelta: { p50: pct(fps, 0.5), p95: pct(fps, 0.95), max: Math.max.apply(null, fps.concat([0])) },
    shots: { idle: 'density-1-idle.png', busy: cleanShot, annotated: 'density-3-busy-annotated.png' }
  };
  fs.writeFileSync(path.join(OUT, 'density.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await t.close();
}

/**
 * 模式 reward：三选一卡面可读性
 * @returns {Promise<void>}
 */
async function modeReward() {
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  const flow = await enterGame(t, url);
  await sleep(1200);

  const readCards = `(() => {
    const cards = Array.from(document.querySelectorAll('.reward-card'));
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
    const area = (r) => r.w * r.h;
    const items = cards.map((c) => {
      const q = (s) => c.querySelector(s);
      const name = q('.r-name'), desc = q('.r-desc'), tag = q('.r-tag'), rar = q('.r-rarity'), res = q('.r-result'), fuse = q('.r-fuse');
      const cs = desc ? getComputedStyle(desc) : null;
      const ncs = name ? getComputedStyle(name) : null;
      const cardBox = box(c);
      const textArea = [name, desc, tag, rar, res, fuse].filter(Boolean).reduce((sum, el) => sum + area(box(el)), 0);
      const raw = desc ? desc.textContent.replace(/\\s+/g, '') : '';
      return {
        rarity: (c.className.match(/rarity-(\\w+)/) || [])[1] || null,
        name: name ? name.textContent.trim() : '',
        nameChars: name ? Array.from(name.textContent.trim()).length : 0,
        nameFontPx: ncs ? parseFloat(ncs.fontSize) : null,
        descChars: Array.from(raw).length,
        descText: raw,
        descFontPx: cs ? parseFloat(cs.fontSize) : null,
        descLineHeightPx: cs ? +parseFloat(cs.lineHeight).toFixed(1) : null,
        descLines: desc ? Math.round(desc.getBoundingClientRect().height / parseFloat(cs.lineHeight)) : null,
        descClamped: desc ? desc.scrollHeight > desc.clientHeight + 1 : false,
        tag: tag ? tag.textContent.trim() : null,
        rarityText: rar ? rar.textContent.trim() : null,
        result: res ? res.textContent.trim() : null,
        resultChars: res ? Array.from(res.textContent.trim()).length : 0,
        fuseText: fuse ? fuse.textContent.replace(/\\s+/g, ' ').trim() : null,
        fuseChars: fuse ? Array.from(fuse.textContent.replace(/\\s+/g, '')).length : 0,
        fuseFits: fuse ? (fuse.scrollWidth <= fuse.clientWidth + 1) : null,
        cardOverflow: c.scrollHeight > c.clientHeight + 1,
        card: cardBox,
        textAreaRatioPct: +(textArea / area(cardBox) * 100).toFixed(1)
      };
    });
    const grid = document.querySelector('.reward-grid');
    const modal = document.querySelector('.result-modal, .modal');
    const note = document.querySelector('.modal-note');
    const hint = document.querySelector('[data-onboard-modal="1"]');
    return {
      count: items.length,
      grid: grid ? box(grid) : null,
      modal: modal ? box(modal) : null,
      noteText: note ? note.textContent.replace(/\\s+/g, ' ').trim() : null,
      noteFontPx: note ? parseFloat(getComputedStyle(note).fontSize) : null,
      onboardLine: hint ? hint.textContent.trim() : null,
      cards: items,
      viewport: { w: innerWidth, h: innerHeight }
    };
  })()`;

  /* 连开 12 轮，把池子里更多卡面收进来（每轮 4 张 → 约 48 张样本） */
  const draws = [];
  let shotDone = false;
  let clipInfo = null;
  for (let i = 0; i < 12; i += 1) {
    await t.ev(`(() => { const d = window.__roamDebug; if (d && d.openReward) d.openReward('audit'); return true; })()`);
    await sleep(220);
    const m = await t.ev(readCards);
    draws.push(m);
    const worst = m.cards.slice().sort((a, b) => (b.descChars + b.fuseChars) - (a.descChars + a.fuseChars))[0];
    if (!shotDone && worst && (worst.descChars >= 20 || worst.fuseChars >= 18)) {
      await t.shot('reward-1-modal.png');
      clipInfo = await t.shotClip('reward-3-card1x1.png', {
        x: Math.max(0, worst.card.x - 4), y: Math.max(0, worst.card.y - 4),
        w: Math.min(1440 - worst.card.x, worst.card.w + 8), h: Math.min(900 - worst.card.y, worst.card.h + 8)
      });
      shotDone = true;
    }
    /* 关闭：优先 Esc，其次点关闭按钮，最后选第一张 */
    await t.ev(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const close = document.querySelector('.modal-close, .reward-close');
      if (close) close.click();
      return true;
    })()`);
    await sleep(120);
    const still = await t.ev(`(() => !!document.querySelector('.reward-card'))`);
    if (still) {
      await t.ev(`(() => { const d = window.__roamDebug; const k = document.querySelector('[data-reward-key]'); if (k && d.chooseReward) d.chooseReward(k.getAttribute('data-reward-key')); return true; })()`);
      await sleep(160);
    }
  }
  if (!shotDone) await t.shot('reward-1-modal.png');

  const all = [];
  draws.forEach((d) => d.cards.forEach((c) => all.push(c)));
  const chars = all.map((c) => c.descChars).sort((a, b) => a - b);
  const mustRead = all.map((c) => c.descChars + c.resultChars + c.fuseChars);
  const metrics = {
    draws: draws.length,
    first: draws[0],
    sampleSize: all.length,
    distinctNames: Array.from(new Set(all.map((c) => c.name))).length,
    descChars: { min: chars[0], p50: pct(chars, 0.5), p95: pct(chars, 0.95), max: chars[chars.length - 1], mean: +(chars.reduce((a, b) => a + b, 0) / Math.max(1, chars.length)).toFixed(1) },
    fontPx: Array.from(new Set(all.map((c) => c.descFontPx))),
    lineHeightPx: Array.from(new Set(all.map((c) => c.descLineHeightPx))),
    textAreaRatioPct: { min: Math.min.apply(null, all.map((c) => c.textAreaRatioPct)), max: Math.max.apply(null, all.map((c) => c.textAreaRatioPct)) },
    clampedCount: all.filter((c) => c.descClamped).length,
    fuseOverflowCount: all.filter((c) => c.fuseFits === false).length,
    cardOverflowCount: all.filter((c) => c.cardOverflow).length,
    withFuseHint: all.filter((c) => c.fuseChars > 0).length,
    fuseChars: { max: Math.max.apply(null, all.map((c) => c.fuseChars).concat([0])), mean: +(all.reduce((a, c) => a + c.fuseChars, 0) / Math.max(1, all.length)).toFixed(1) },
    longest: all.slice().sort((a, b) => (b.descChars + b.fuseChars) - (a.descChars + a.fuseChars)).slice(0, 5).map((c) => ({ name: c.name, desc: c.descText, fuse: c.fuseText, total: c.descChars + c.fuseChars })),
    allNames: Array.from(new Set(all.map((c) => c.name)))
  };
  const report = {
    sourceBytes: fs.statSync(MAIN).size,
    sourceMd5: md5File(MAIN),
    viewport: '1440x900 dpr=1',
    enter: flow,
    metrics: metrics,
    summary: {
      cardCountPerDraw: draws[0] ? draws[0].count : null,
      avgMustReadChars: +(mustRead.reduce((a, b) => a + b, 0) / Math.max(1, mustRead.length)).toFixed(1),
      mustReadTotalPerDraw: draws[0] ? draws[0].cards.reduce((a, c) => a + c.descChars + c.resultChars + c.fuseChars, 0) : null,
      readSecondsAt6cps: draws[0] ? +(draws[0].cards.reduce((a, c) => a + c.descChars + c.resultChars + c.fuseChars, 0) / 6).toFixed(1) : null,
      readSecondsAt10cps: draws[0] ? +(draws[0].cards.reduce((a, c) => a + c.descChars + c.resultChars + c.fuseChars, 0) / 10).toFixed(1) : null,
      noteText: draws[0] ? draws[0].noteText : null,
      noteFontPx: draws[0] ? draws[0].noteFontPx : null
    },
    shots: { modal: 'reward-1-modal.png', card: clipInfo }
  };
  fs.writeFileSync(path.join(OUT, 'reward.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await t.close();
}

/**
 * 模式 perf：帧时间 + 按键→画面延迟
 * @returns {Promise<void>}
 */
async function modePerf() {
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  const flow = await enterGame(t, url);
  await sleep(1500);

  // 1) 静止帧时间
  const idle = await sampleFrames(t, 8000);

  // 2) 战斗帧时间（刷怪 + 按键）
  const combatPromise = combatFor(t, 12000);
  const combat = await sampleFrames(t, 11500);
  await combatPromise;

  // 3) 按键→画面延迟 + "按了没反应"比例
  const latency = await t.ev(`(() => new Promise(async (resolve) => {
    const d = window.__roamDebug;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const press = () => {
      const before = d.getState().crosshair;
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      const after = d.getState().crosshair;
      return { before: before, after: after, t0: t0, accepted: after.cdLeft > before.cdLeft };
    };
    /* 1) 冷却时长：成功施放后逐帧等到 cdLeft 归零 */
    let cdMs = null;
    for (let i = 0; i < 40; i += 1) { if (press().accepted) break; await wait(120); }
    if (d.getState().crosshair.cdLeft > 0) {
      const start = performance.now();
      await new Promise((r) => { const poll = () => { if (d.getState().crosshair.cdLeft <= 0.001) r(); else requestAnimationFrame(poll); }; poll(); });
      cdMs = +(performance.now() - start).toFixed(0);
    }
    const fast = { n: 0, accepted: 0, states: {} };
    const slow = { n: 0, accepted: 0, states: {}, lat: [] };
    for (let i = 0; i < 30; i += 1) {
      const p = press();
      fast.n += 1; if (p.accepted) fast.accepted += 1;
      const k = p.after.state || 'unknown';
      fast.states[k] = (fast.states[k] || 0) + 1;
      await wait(90);
    }
    for (let i = 0; i < 18; i += 1) {
      const p = press();
      slow.n += 1; if (p.accepted) slow.accepted += 1;
      const k = p.after.state || 'unknown';
      slow.states[k] = (slow.states[k] || 0) + 1;
      await new Promise((r) => requestAnimationFrame(() => { slow.lat.push(+(performance.now() - p.t0).toFixed(2)); r(); }));
      await wait(400);
    }
    resolve({ cdMs: cdMs, fast: fast, slow: slow, lat: slow.lat, aether: d.getState().crosshair });
  }))()`);

  const perfInfo = await t.ev(`(() => { const d = window.__roamDebug; return { perf: d.perf ? d.perf.info() : null, state: (() => { const s = d.getState(); return { performance: s.performance, drawStats: s.drawStats }; })() }; })()`);

  const summarize = (deltas) => {
    const s = deltas.slice(1);
    return {
      n: s.length,
      p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: Math.max.apply(null, s.concat([0])),
      over33ms: s.filter((x) => x > 33).length,
      over50ms: s.filter((x) => x > 50).length,
      over100ms: s.filter((x) => x > 100).length,
      fpsMean: +(1000 / (s.reduce((a, b) => a + b, 0) / Math.max(1, s.length))).toFixed(1)
    };
  };

  const report = {
    sourceBytes: fs.statSync(MAIN).size,
    sourceMd5: md5File(MAIN),
    viewport: '1440x900 dpr=1',
    enter: flow,
    noiseNote: '本机常驻约 50 个浏览器进程；同一构建两轮采样可差 2 倍，本组数字只作方向性参考',
    idle: summarize(idle.deltas),
    combat: summarize(combat.deltas),
    idleLongTasks: idle.longTasks.slice(0, 20),
    combatLongTasks: combat.longTasks.slice(0, 20),
    drawStats: combat.drawStats,
    inputLatency: {
      samples: latency.lat,
      p50: pct(latency.lat, 0.5), p95: pct(latency.lat, 0.95), max: Math.max.apply(null, latency.lat.concat([0])),
      cooldownMs: latency.cdMs,
      mash90ms: latency.fast,
      tap400ms: latency.slow,
      crosshair: latency.aether
    },
    perfInfo: perfInfo
  };
  fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await t.close();
}

/**
 * 入口：按 MODE 分发
 * @returns {Promise<void>}
 */
/**
 * 模式 textmap：统计 DOM 里"文字叶子节点"数量（标题页 / 战斗 HUD），按面板分组
 * 口径：只算 el.children.length === 0 且自身含文本节点、CSS 可见、在 1440×900 内的元素，
 *       避免父子重复计数；同时给出被 elementFromPoint 判定为遮挡的数量（副口径）。
 * @returns {Promise<void>}
 */
async function modeTextmap() {
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  const countExpr = `(() => {
    const vis = (el) => !!el && (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true);
    const groups = {};
    const items = [];
    let occluded = 0;
    document.querySelectorAll('body *').forEach((el) => {
      if (/^(script|style|link|meta|canvas|svg|path|option)$/i.test(el.tagName)) return;
      if (el.children.length) return;
      let own = '';
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
      own = own.replace(/\\s+/g, ' ').trim();
      if (!own) return;
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > 900 || r.right < 0 || r.left > 1440) return;
      const host = el.closest('[id]');
      const key = host ? (host.id || host.tagName.toLowerCase()) : (el.parentElement ? (el.parentElement.className || el.parentElement.tagName.toLowerCase()) : '?');
      groups[key] = (groups[key] || 0) + 1;
      const top = document.elementFromPoint(Math.min(1439, Math.max(0, r.left + r.width / 2)), Math.min(899, Math.max(0, r.top + r.height / 2)));
      if (top && !(el === top || el.contains(top) || top.contains(el))) occluded += 1;
      items.push({ t: own.slice(0, 40), fs: parseFloat(getComputedStyle(el).fontSize), x: Math.round(r.left), y: Math.round(r.top) });
    });
    const sizes = {};
    items.forEach((i) => { sizes[i.fs] = (sizes[i.fs] || 0) + 1; });
    return { total: items.length, occluded: occluded, groups: groups, sizes: sizes, items: items };
  })()`;
  await t.send('Page.navigate', { url });
  await sleep(2600);
  const title = await t.ev(countExpr);
  await t.shot('textmap-title.png');
  await t.ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await t.ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  await sleep(2200);
  const battle = await t.ev(countExpr);
  await t.shot('textmap-battle.png');
  /* 2 秒内 DOM 变更统计：验证 HUD 是否每帧无条件重写 textContent（文字重排来源） */
  const mutations = await t.ev(`(() => new Promise((resolve) => {
    const per = {};
    let total = 0;
    const obs = new MutationObserver((list) => {
      list.forEach((m) => {
        total += 1;
        const el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        const key = el ? (el.id || el.className || el.tagName) : '?';
        per[String(key).slice(0, 40)] = (per[String(key).slice(0, 40)] || 0) + 1;
      });
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    setTimeout(() => { obs.disconnect(); resolve({ total: total, perSecond: +(total / 2).toFixed(1), top: Object.keys(per).map((k) => [k, per[k]]).sort((a, b) => b[1] - a[1]).slice(0, 12) }); }, 2000);
  }))()`);
  const out = { sourceMd5: md5File(MAIN), sourceBytes: fs.statSync(MAIN).size, viewport: '1440x900 dpr=1', title: title, battle: battle, mutations: mutations };
  fs.writeFileSync(path.join(OUT, 'textmap.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ title: { total: title.total, occluded: title.occluded, sizes: title.sizes, groups: title.groups }, battle: { total: battle.total, occluded: battle.occluded, sizes: battle.sizes, groups: battle.groups } }, null, 2));
  await t.close();
}

/**
 * 模式 dark：战斗态"死黑面积"测量（B3 口径）
 * ------------------------------------------------------------
 * 口径：把 #game 画布整帧复制到临时 2D 画布，按每 4 个像素取一点，
 *       用相对亮度 L = 0.2126R + 0.7152G + 0.0722B 统计 L<8 / <12 / <20 的像素占比。
 *       只读画布，不改任何状态；dpr=1 下画布像素 = CSS 像素。
 * @returns {Promise<void>}
 */
async function modeDark() {
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  await t.send('Page.navigate', { url });
  await sleep(2400);
  await t.ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await t.ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  await sleep(1600);
  /* 制造战斗态：刷几只敌人，保证画面里既有实体也有光效 */
  await t.ev(`(() => { const d = window.__roamDebug; if (d && d.spawnEnemy) { for (let i = 0; i < 4; i += 1) d.spawnEnemy(); } return true; })()`);
  await sleep(1200);
  const measure = `(() => {
    const c = document.getElementById('game');
    if (!c) return { error: 'no canvas' };
    const tmp = document.createElement('canvas');
    tmp.width = c.width; tmp.height = c.height;
    const g = tmp.getContext('2d', { willReadFrequently: true });
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, tmp.width, tmp.height).data;
    let n = 0, lt8 = 0, lt12 = 0, lt20 = 0, sum = 0;
    for (let i = 0; i < d.length; i += 16) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n += 1; sum += y;
      if (y < 8) lt8 += 1;
      if (y < 12) lt12 += 1;
      if (y < 20) lt20 += 1;
    }
    const p = (x) => +(x / n * 100).toFixed(2);
    return { w: tmp.width, h: tmp.height, samples: n, meanL: +(sum / n).toFixed(2), lt8: p(lt8), lt12: p(lt12), lt20: p(lt20) };
  })()`;
  const data = await t.ev(measure);
  await t.shot('dark-battle.png');
  const out = { sourceMd5: md5File(MAIN), sourceBytes: fs.statSync(MAIN).size, viewport: '1440x900 dpr=1', data: data };
  fs.writeFileSync(path.join(OUT, 'dark.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await t.close();
}

/**
 * 模式 tap：点击区尺寸巡检（B4 口径）
 * ------------------------------------------------------------
 * 口径：可点击 = button / a[href] / [role=button] / [onclick] / input / select /
 *       label[for] / [data-tap] / [data-key] / .btn / .chip / .tab / .reward-card；
 *       可见 = rect.w>0 && rect.h>0 且 getComputedStyle 不是 display:none/visibility:hidden；
 *       不达标 = rect.w < 44 || rect.h < 44（任一维不足即算）。
 * 分别在 title / battle / reward / map / skill 五个状态各扫一遍，取并集。
 * @returns {Promise<void>}
 */
async function modeTap() {
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  const SCAN = `(() => {
    const SEL = 'button, a[href], [role="button"], [onclick], input, select, label[for], [data-tap], [data-key], .btn, .chip, .tab, .reward-card';
    const out = [];
    document.querySelectorAll(SEL).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      if (r.width >= 44 && r.height >= 44) return;
      const cls = (el.className && typeof el.className === 'string')
        ? el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
      out.push({
        sig: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : ''),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        text: (el.textContent || '').trim().slice(0, 14)
      });
    });
    return out;
  })()`;
  /** 扫一次并累计 */
  async function scan(stateName, acc) {
    const list = await t.ev(SCAN);
    (list || []).forEach((x) => {
      acc.push(Object.assign({ state: stateName }, x));
    });
    return (list || []).length;
  }
  await t.send('Page.navigate', { url });
  await sleep(2400);
  const all = [];
  await scan('title', all);
  await t.shot('tap-title.png');

  await t.ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await scan('char', all);
  await t.ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  await sleep(1600);
  await scan('battle', all);

  /* 打开地图 */
  await t.ev(`(() => { const b = document.getElementById('btnMapDock'); if (b) b.click(); return true; })()`);
  await sleep(700);
  await scan('map', all);
  await t.ev(`(() => { const b = document.getElementById('mapClose'); if (b) b.click(); return true; })()`);
  await sleep(500);

  /* 打开技能树 */
  await t.ev(`(() => { const b = document.getElementById('btnSkillDock'); if (b) b.click(); return true; })()`);
  await sleep(700);
  await scan('skill', all);
  await t.ev(`(() => { const b = document.getElementById('btnSkillTree'); if (b) b.click(); return true; })()`);
  await sleep(500);

  /* 强制奖励弹窗 */
  await t.ev(`(() => { const d = window.__roamDebug; if (d && d.openReward) d.openReward(); return true; })()`);
  await sleep(900);
  await scan('reward', all);

  /* 去重：同一 sig+尺寸 只留一条（多状态同名元素合并，保留首个状态） */
  const uniq = new Map();
  all.forEach((x) => {
    const k = x.sig + '|' + x.w + 'x' + x.h;
    if (!uniq.has(k)) uniq.set(k, x);
  });
  const rows = Array.from(uniq.values()).sort((a, b) => a.w * a.h - b.w * b.h);
  const bySig = {};
  rows.forEach((r) => {
    const k = r.sig;
    if (!bySig[k]) bySig[k] = { sig: k, n: 0, size: r.w + 'x' + r.h, states: new Set() };
    bySig[k].n += 1;
    bySig[k].states.add(r.state);
  });
  const groups = Object.values(bySig).map((g) => ({
    sig: g.sig, n: g.n, size: g.size, states: Array.from(g.states).join(',')
  })).sort((a, b) => b.n - a.n);
  const out = {
    sourceMd5: md5File(MAIN), sourceBytes: fs.statSync(MAIN).size,
    viewport: '1440x900 dpr=1',
    offendersUnique: rows.length,
    offendersRaw: all.length,
    groups,
    rows
  };
  fs.writeFileSync(path.join(OUT, 'tap.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ unique: rows.length, raw: all.length, groups: groups.length }, null, 2));
  await t.close();
}

/**
 * 模式 contrast：DOM 文本对比度巡检（B4 口径，WCAG 2.1）
 * ------------------------------------------------------------
 * 只扫"叶子节点且可见"的文本；前景色取 computed color（半透明时与背景混合），
 * 背景取最近一个 alpha>=0.85 的祖先背景色；无则按页面底色 rgb(10,14,24) 计。
 * 比值 = (L亮+0.05)/(L暗+0.05)，小字阈值 4.5。
 * Canvas 内文字无法取 computed style，不在本口径内（另行人工判）。
 * @returns {Promise<void>}
 */
async function modeContrast() {
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  const SCAN = `(() => {
    const parseColor = (s) => {
      const m = String(s).match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const p = m[1].split(',').map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lumOf = (c) => {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const blend = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1
    });
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parseColor(getComputedStyle(n).backgroundColor);
        if (c && c.a >= 0.85) return c;
        n = n.parentElement;
      }
      return { r: 10, g: 14, b: 24, a: 1 };
    };
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (el.children && el.children.length) return;
      const txt = (el.textContent || '').trim();
      if (!txt) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
      const fg0 = parseColor(cs.color);
      if (!fg0) return;
      const bg = bgOf(el);
      const fg = fg0.a < 1 ? blend(fg0, bg) : fg0;
      const L1 = lumOf(fg), L2 = lumOf(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (ratio >= 4.5) return;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 46),
        fs: parseFloat(cs.fontSize),
        ratio: Number(ratio.toFixed(2)),
        color: cs.color,
        bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
        text: txt.slice(0, 12)
      });
    });
    const m = new Map();
    out.forEach((o) => {
      const k = [o.tag, o.cls, o.color, o.bg, o.fs].join('|');
      if (!m.has(k)) m.set(k, o);
    });
    return Array.from(m.values()).sort((a, b) => a.ratio - b.ratio);
  })()`;
  await t.send('Page.navigate', { url });
  await sleep(2400);
  const title = await t.ev(SCAN);
  await t.ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await t.ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  await sleep(1600);
  const battle = await t.ev(SCAN);
  await t.ev(`(() => { const d = window.__roamDebug; if (d && d.openReward) d.openReward(); return true; })()`);
  await sleep(900);
  const reward = await t.ev(SCAN);
  await t.shot('contrast-reward.png');
  const out = {
    sourceMd5: md5File(MAIN), sourceBytes: fs.statSync(MAIN).size,
    counts: { title: title.length, battle: battle.length, reward: reward.length },
    worst: [].concat(title, battle, reward).sort((a, b) => a.ratio - b.ratio).slice(0, 25)
  };
  fs.writeFileSync(path.join(OUT, 'contrast.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.counts) + ' worst=' + (out.worst[0] ? out.worst[0].ratio : 'n/a'));
  await t.close();
}

/**
 * 模式 pair：为"改前/改后对照页"拍四屏（B2–B4 收口用）
 * ------------------------------------------------------------
 * 四屏：标题页 / 战斗 / 奖励结算 / 地图。
 * 同一机位靠"自定义种子"保证：两个构建都用 seedInput=artcompare-01 开局，
 * 地牢布局与玩家出生点一致，相机自然一致；视口固定 1440×900 dpr=1。
 * 用法：ARCANE_MAIN=<文件> PAIR_TAG=before node _probe/audit_probe.js pair
 * @returns {Promise<void>}
 */
async function modePair() {
  const tag = process.env.PAIR_TAG || 'shot';
  const t = await boot();
  const url = 'file:///' + MAIN.replace(/\\/g, '/');
  await t.send('Page.navigate', { url });
  await sleep(2600);
  await t.shot('pair-' + tag + '-1-title.png');

  /* 用固定种子开局：两次构建走同一张地图、同一个出生点 */
  await t.ev(`(() => {
    const inp = document.getElementById('seedInput');
    const btn = document.getElementById('btnSeedStart');
    if (inp && btn) { inp.value = 'artcompare-01'; btn.click(); return 'seed'; }
    const start = document.getElementById('btnStart');
    if (start) { start.click(); return 'start'; }
    return 'none';
  })()`);
  await sleep(1400);
  await t.ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b && b.offsetParent) b.click(); return true; })()`);
  await sleep(2200);
  await t.shot('pair-' + tag + '-2-battle.png');

  /* 奖励结算：强制开一次三选一 */
  await t.ev(`(() => { const d = window.__roamDebug; if (d && d.openReward) d.openReward(); return true; })()`);
  await sleep(1000);
  await t.shot('pair-' + tag + '-3-reward.png');
  /* 选第一张，关闭弹窗 */
  await t.ev(`(() => { const c = document.querySelector('.reward-card'); if (c) c.click(); return true; })()`);
  await sleep(900);

  /* 地图 */
  await t.ev(`(() => { const b = document.getElementById('btnMapDock'); if (b) b.click(); return true; })()`);
  await sleep(800);
  await t.shot('pair-' + tag + '-4-map.png');

  console.log('PAIR_DONE ' + tag + ' ' + path.basename(MAIN) + ' ' + fs.statSync(MAIN).size);
  await t.close();
}

async function main() {
  if (MODE === 'textmap') await modeTextmap();
  else if (MODE === 'pair') await modePair();
  else if (MODE === 'contrast') await modeContrast();
  else if (MODE === 'tap') await modeTap();
  else if (MODE === 'dark') await modeDark();
  else if (MODE === 'flow') await modeFlow();
  else if (MODE === 'density') await modeDensity();
  else if (MODE === 'reward') await modeReward();
  else if (MODE === 'perf') await modePerf();
  else throw new Error('未知模式: ' + MODE);
  const after = md5File(MAIN);
  console.log('MAIN_AFTER ' + fs.statSync(MAIN).size + ' ' + after);
}

main().catch((e) => { console.error('AUDIT_FAIL', e && e.stack || e); process.exitCode = 1; });
