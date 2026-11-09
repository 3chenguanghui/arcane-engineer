/**
 * v1.6.0 成品全流程体检 · F1→F20 实跑（1280×720 / 1920×1080）
 * ------------------------------------------------------------
 * 只查四类：卡顿（单帧 >20ms）、UI 错位/溢出/文字截断、点了没反应、控制台报错。
 * 不判时长、不改数值、不写 dist。
 *
 * 用法：
 *   node tools\_health_v160.js                # 默认 1280×720
 *   $env:HB_W=1920;$env:HB_H=1080; node tools\_health_v160.js
 *   $env:HB_MAXFLOOR=5                        # 只跑前 5 层（分段预检）
 *   $env:HB_STARTFLOOR=6                      # 断点续跑（不得已才用）
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'dist', 'emberfall_v1.6.0', '烬_v1.6.0.html');
const W = Number(process.env.HB_W || 1280);
const H = Number(process.env.HB_H || 720);
const PORT = Number(process.env.HB_PORT || (W >= 1900 ? 9612 : 9611));
const MAXFLOOR = Number(process.env.HB_MAXFLOOR || 20);
const STARTFLOOR = Number(process.env.HB_STARTFLOOR || 1);
const CHUNK = Number(process.env.HB_CHUNK || 900);
const TAGNAME = W + 'x' + H;
const OUT = path.join(ROOT, '.screenshots', 'health160', TAGNAME);
const PROFILE = path.join(ROOT, '.testprofile', 'edge_hb_' + TAGNAME);
const RESULT = path.join(OUT, 'result.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 结果容器（每层落盘一次） ---------------- */
const report = {
  target: FILE,
  resolution: TAGNAME,
  startedAt: new Date().toISOString(),
  note: '与另一条线（_cut_run.js）并行运行，帧时间样本受宿主负载影响，只用于定位结构性卡顿点',
  floors: [],
  ui: [],
  clicks: [],
  errors: [],
  perf: [],
  meta: {}
};
let shotSeq = 0;

/**
 * 落盘当前报告（每完成一层/一个检查点调用一次）
 * @returns {void}
 */
function flush() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(RESULT, JSON.stringify(report, null, 2));
}

/**
 * 打印并落盘一条 UI / 点击问题
 * @param {Object} item 问题项
 * @returns {void}
 */
function pushIssue(item) {
  report.ui.push(item);
  flush();
}

/* ---------------- CDP ---------------- */
/**
 * 启动无头 Edge 并连接 CDP
 * @returns {Promise<Object>} 句柄
 */
async function boot() {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${W},${H}`, 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪（端口 ' + PORT + '）');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  /**
   * 把异常堆栈压成一行文本
   * @param {Object} st CDP stackTrace
   * @returns {string} 文本
   */
  const stackText = (st) => ((st && st.callFrames) || []).slice(0, 6)
    .map((f) => (f.functionName || '(anon)') + '@' + (f.lineNumber + 1) + ':' + (f.columnNumber + 1)).join(' < ');
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      errors.push({ kind: 'exception', at: Date.now(), text: String(desc).slice(0, 900), stack: stackText(d.stackTrace) });
      flush();
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' ').slice(0, 900);
      errors.push({ kind: 'console.error', at: Date.now(), text, stack: stackText(m.params.stackTrace) });
      flush();
    }
    if (m.method === 'Log.entryAdded' && m.params.entry && m.params.entry.level === 'error') {
      errors.push({ kind: 'log.error', at: Date.now(), text: String(m.params.entry.text).slice(0, 500), url: m.params.entry.url || '' });
      flush();
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  /**
   * 发送 CDP 命令
   * @param {string} method 方法
   * @param {Object} [params] 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 页面内执行表达式
   * @param {string} expression JS
   * @param {boolean} [awaitPromise] 是否等待 Promise
   * @returns {Promise<*>} 结果
   */
  const ev = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('EVAL: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2600);
  return { ws, send, ev, runtimeErrors: errors, edge };
}

/**
 * 截一张当前视口的 PNG
 * @param {Object} h 句柄
 * @param {string} name 文件名（不含扩展名）
 * @returns {Promise<string>} 相对路径
 */
async function shot(h, name) {
  shotSeq += 1;
  const file = String(shotSeq).padStart(3, '0') + '-' + name + '.png';
  const r = await h.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
  return file;
}

/**
 * 取元素中心点坐标
 * @param {Object} h 句柄
 * @param {string} sel CSS 选择器
 * @returns {Promise<Object|null>} {x,y,w,h,visible}
 */
async function rectOf(h, sel) {
  return h.ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width > 2 && r.height > 2;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), visible: vis };
  })()`);
}

/**
 * 在指定坐标发一次真实鼠标点击
 * @param {Object} h 句柄
 * @param {number} x 视口内 x
 * @param {number} y 视口内 y
 * @returns {Promise<void>}
 */
async function clickPoint(h, x, y) {
  await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await h.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

/**
 * 点一个按钮直到出现预期反应（最多 3 次）
 * @param {Object} h 句柄
 * @param {string} sel 选择器
 * @param {string} checkExpr 判定表达式（真=有反应）
 * @param {number} [tries] 次数
 * @returns {Promise<Object>} {ok,tries,why,rect}
 */
async function clickUntil(h, sel, checkExpr, tries = 3) {
  const rec = { selector: sel, ok: false, tries: 0, why: '' };
  for (let t = 1; t <= tries; t += 1) {
    const r = await rectOf(h, sel);
    rec.rect = r;
    if (!r) { rec.why = '元素不存在'; rec.tries = t; break; }
    if (!r.visible) { rec.why = '元素不可见'; rec.tries = t; break; }
    if (r.x < 0 || r.y < 0 || r.x > W || r.y > H) {
      rec.why = '元素中心在视口外(' + r.x + ',' + r.y + ')';
      rec.tries = t;
      break;
    }
    await clickPoint(h, r.x, r.y);
    await sleep(260);
    rec.tries = t;
    if (await h.ev(`(() => { try { return !!(${checkExpr})(); } catch (e) { return false; } })()`)) {
      rec.ok = true; rec.why = '';
      return rec;
    }
  }
  if (!rec.why) rec.why = tries + ' 次点击均未产生反应';
  return rec;
}

/* ---------------- 页面内注入 ---------------- */
/**
 * 注入帧时间采样 + UI 审计 + 机器人
 * @returns {string} 安装表达式
 */
function installAll() {
  return `(() => {
  if (window.__hb) return true;
  window.__hb = { tag: 'idle', collect: true, frames: [], spikes: [], samples: 0 };
  /* 帧时间：包住主循环，记录每次 rAF 回调的完整耗时（update + render） */
  (function () {
    const _loop = window.loop;
    if (typeof _loop !== 'function') return;
    window.loop = function (now) {
      const t0 = performance.now();
      let ret;
      try { ret = _loop.apply(this, arguments); } finally {
        const dt = performance.now() - t0;
        const b = window.__hb;
        if (b.collect) {
          b.samples += 1;
          let enemies = 0, fl = 0, md = '';
          try {
            fl = state.floor; md = state.mode;
            enemies = state.enemies.filter(function (e) { return e && e.hp > 0; }).length;
          } catch (e) { /* 未初始化 */ }
          const rec = { tag: b.tag, floor: fl, mode: md, enemies: enemies, dt: +dt.toFixed(2), t: Math.round(now) };
          if (b.frames.length < 6000) b.frames.push(rec);
          if (dt > 20 && b.spikes.length < 400) b.spikes.push(rec);
        }
      }
      return ret;
    };
  })();

  /**
   * 设置当前动作标签（帧样本按它归因）
   * @param {string} t 标签
   * @returns {void}
   */
  window.__hb.setTag = function (t) { window.__hb.tag = String(t); };
  /**
   * 清空帧样本
   * @returns {void}
   */
  window.__hb.clearFrames = function () { window.__hb.frames = []; window.__hb.spikes = []; };
  /**
   * 读取并清空帧样本
   * @returns {Object} {frames,spikes}
   */
  window.__hb.takeFrames = function () { const f = window.__hb.frames; const s = window.__hb.spikes; window.__hb.frames = []; window.__hb.spikes = []; return { frames: f, spikes: s }; };

  /**
   * 生成元素的可读选择器
   * @param {Element} el 元素
   * @returns {string} 选择器
   */
  function selOf(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    if (cls) s += '.' + cls;
    return s;
  }
  /**
   * 元素是否在可滚动祖先内（这类问题玩家可滚动看到，单独降级）
   * @param {Element} el 元素
   * @returns {boolean} 是否可滚动抵达
   */
  function inScroller(el) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 2) return true;
      p = p.parentElement;
    }
    return false;
  }

  /**
   * UI 审计：文字裁切 / 越界 / 兄弟重叠
   * @param {string} stage 阶段名
   * @returns {Object} {meta,issues}
   */
  window.__hb.auditUI = function (stage) {
    const vw = innerWidth, vh = innerHeight;
    const meta = {
      stage: stage, vw: vw, vh: vh,
      docH: document.documentElement.scrollHeight, bodyH: document.body ? document.body.scrollHeight : 0,
      bodyScrollable: document.documentElement.scrollHeight > vh + 2,
      scrollY: window.scrollY
    };
    const issues = [];
    const seen = {};
    /**
     * 记录一条问题（按选择器+类型去重）
     * @param {Object} it 问题
     * @returns {void}
     */
    function add(it) {
      const k = it.kind + '|' + it.selector + '|' + (it.text || '') + '|' + Math.round(it.rect ? it.rect.x : 0) + ',' + Math.round(it.rect ? it.rect.y : 0);
      if (seen[k]) return;
      seen[k] = 1;
      it.stage = stage;
      issues.push(it);
    }
    const nodes = Array.from(document.querySelectorAll('body *'));
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.15) continue;
      if (cs.pointerEvents === 'none' && el.tagName !== 'CANVAS') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      /* 只看元素自身的直接文本，避免父容器报重复 */
      let own = '';
      for (let n = 0; n < el.childNodes.length; n += 1) {
        const c = el.childNodes[n];
        if (c.nodeType === 3) own += c.textContent;
      }
      own = own.replace(/\\s+/g, ' ').trim();
      const tag = el.tagName;
      const isCtrl = tag === 'BUTTON' || tag === 'INPUT' || tag === 'KBD' || el.getAttribute('role') === 'button';
      /* A. 横向文字被裁（overflow hidden + 内容更宽） */
      if (own && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2) {
        add({ kind: 'text-clip-x', selector: selOf(el), text: own.slice(0, 30), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, content: el.scrollWidth + '>', box: el.clientWidth, ellipsis: cs.textOverflow === 'ellipsis', inScroller: inScroller(el) });
      }
      /* B. 纵向文字被裁 */
      if (own && (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 2 && cs.whiteSpace !== 'nowrap') {
        add({ kind: 'text-clip-y', selector: selOf(el), text: own.slice(0, 30), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, content: el.scrollHeight + '>', box: el.clientHeight, inScroller: inScroller(el) });
      }
      /* C. 控件/面板越出视口 */
      if ((isCtrl || el.id === 'minimap' || el.classList.contains('reward-card')) && !inScroller(el)) {
        if (r.right > vw + 2 || r.left < -2 || r.bottom > vh + 2 || r.top < -2) {
          add({ kind: 'out-of-viewport', selector: selOf(el), text: own.slice(0, 30) || (el.getAttribute('aria-label') || ''), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, inScroller: false, textShort: own.length < 6 && tag === 'BUTTON' });
        }
      }
      /* C2. 首屏之外（能靠滚动看到，但不在 1280×720 首屏内） */
      if (isCtrl && inScroller(el) && (r.bottom > vh + 2 || r.top < -2) && r.height > 6) {
        add({ kind: 'below-first-screen', selector: selOf(el), text: own.slice(0, 30) || (el.getAttribute('aria-label') || ''), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, inScroller: true });
      }
    }
    /* D. 兄弟重叠：卡牌 / 难度 / 工具条 / HUD */
    const groups = ['.reward-grid', '.card-row', '.difficulty-modes', '.title-tools', '.title-lr-tools', '.hud-actions', '.skill-chips', '.title-secondary'];
    for (let gi = 0; gi < groups.length; gi += 1) {
      const gs = document.querySelectorAll(groups[gi]);
      for (let k = 0; k < gs.length; k += 1) {
        const g = gs[k];
        const kids = Array.from(g.children).filter(function (c) {
          const s2 = getComputedStyle(c);
          if (s2.display === 'none' || s2.visibility === 'hidden') return false;
          const rr = c.getBoundingClientRect();
          return rr.width > 6 && rr.height > 6;
        });
        for (let a = 0; a < kids.length; a += 1) {
          for (let b = a + 1; b < kids.length; b += 1) {
            const ra = kids[a].getBoundingClientRect();
            const rb = kids[b].getBoundingClientRect();
            const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
            const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
            if (ox > 4 && oy > 4) {
              const minArea = Math.min(ra.width * ra.height, rb.width * rb.height);
              if (ox * oy > minArea * 0.15) {
                add({ kind: 'overlap', selector: selOf(g), text: selOf(kids[a]) + ' × ' + selOf(kids[b]), rect: { x: Math.min(ra.left, rb.left), y: Math.min(ra.top, rb.top), w: ox, h: oy }, overlap: Math.round(ox * oy), minArea: Math.round(minArea) });
              }
            }
          }
        }
      }
    }
    return { meta: meta, issues: issues };
  };
  return true;
})()`;
}

/**
 * 注入机器人（走真实键位/坐标，与被测版本同源逻辑）
 * @returns {string} 安装表达式
 */
function installBot() {
  return `(() => {
  if (window.__e2e) return true;
  window.__e2e = (function () {
    var fallback = 0, fallbackDoor = 0, fallbackCombat = 0;
    var safeFrac = 0.2;
    (function () { if (window.__hrDmg || typeof damagePlayer !== 'function') return; window.__hrDmg = 1; })();
    function heal() {
      if (state.mods) state.mods.hpBonus = Math.max(state.mods.hpBonus || 0, 140);
      state.player.hpMax = Math.max(state.player.hpMax, 240);
      state.player.hp = state.player.hpMax;
      state.player.aether = state.player.aetherMax;
    }
    function alive() { return state.enemies.filter(function (e) { return e && e.hp > 0; }); }
    function roomById(id) { return state.rooms.filter(function (r) { return r.id === id; })[0] || null; }
    function roomEnemies(id) { return alive().filter(function (e) { return e.roomId === id; }); }
    function setKeys(l, r, u, d) { state.keys = { left: !!l, right: !!r, up: !!u, down: !!d }; }
    function stop() { setKeys(false, false, false, false); }
    function walkable(x, y) { try { return !!__roamDebug.walkableAt(x, y); } catch (e) { return true; } }
    function steer(tx, ty) {
      var dx = tx - state.player.x, dy = ty - state.player.y;
      if (Math.hypot(dx, dy) < 2) { stop(); return; }
      var base = Math.atan2(dy, dx);
      var offs = [0, 25, -25, 50, -50, 75, -75, 100, -100, 135, -135, 170, -170];
      for (var i = 0; i < offs.length; i += 1) {
        var a = base + offs[i] * Math.PI / 180;
        var cx = Math.cos(a), cy = Math.sin(a);
        if (!walkable(state.player.x + cx * 26, state.player.y + cy * 26)) continue;
        setKeys(cx < -0.25, cx > 0.25, cy < -0.25, cy > 0.25);
        return;
      }
      stop();
    }
    function placeNear(e) {
      if (!e) return false;
      var tryD = [Math.max(40, reachOf() * 0.8), Math.max(28, reachOf() * 0.5), 20];
      for (var ti = 0; ti < tryD.length; ti += 1) {
        for (var bi = 0; bi < 8; bi += 1) {
          var a = bi * Math.PI / 4;
          var x = e.x + Math.cos(a) * tryD[ti];
          var y = e.y + Math.sin(a) * tryD[ti];
          if (!walkable(x, y)) continue;
          __roamDebug.teleport(x, y);
          return true;
        }
      }
      __roamDebug.teleport(e.x, e.y);
      return true;
    }
    function face(e) { __roamDebug.setAimExact(Math.atan2(e.y - state.player.y, e.x - state.player.x)); }
    /* 该版本武器总闸门默认关闭，主输出是施法：__roamDebug.cast() 等价于 castPrimary() */
    function attackNow() { try { return !!__roamDebug.cast(); } catch (e) { return false; } }
    function reachOf() { return 320; }
    function nearest(list) {
      var best = null, bd = 1e9;
      for (var i = 0; i < list.length; i += 1) {
        var d = Math.hypot(list[i].x - state.player.x, list[i].y - state.player.y);
        if (d < bd) { bd = d; best = list[i]; }
      }
      return { e: best, d: bd };
    }
    function buildAdj() {
      var adj = {};
      state.doors.forEach(function (d) {
        if (d.targetRoomId == null || d.targetRoomId < 0 || !roomById(d.targetRoomId)) return;
        (adj[d.roomId] = adj[d.roomId] || []).push({ next: d.targetRoomId, door: d });
        (adj[d.targetRoomId] = adj[d.targetRoomId] || []).push({ next: d.roomId, door: d });
      });
      return adj;
    }
    function firstDoor(fromId, toId) {
      if (fromId === toId) return null;
      var adj = window.__e2e.adj;
      if (!adj || !adj[fromId]) return null;
      var seen = {}, prev = {}, q = [fromId];
      seen[fromId] = true;
      var found = null;
      while (q.length) {
        var cur = q.shift();
        var list = adj[cur] || [];
        for (var i = 0; i < list.length; i += 1) {
          var nx = list[i].next;
          if (seen[nx]) continue;
          seen[nx] = true; prev[nx] = { from: cur, edge: list[i] };
          if (nx === toId) { found = nx; q = []; break; }
          q.push(nx);
        }
      }
      if (found == null) return null;
      var node = prev[found], d = node.edge.door;
      while (node && prev[node.from]) { d = prev[node.from].edge.door; node = prev[node.from]; }
      return d;
    }
    function walkTo(x, y, maxFrames) {
      var frames = 0, lastX = state.player.x, lastY = state.player.y, still = 0, falls = 0;
      while (frames < maxFrames) {
        if (state.mode !== 'playing' || state.status !== 'playing') break;
        var dx = x - state.player.x, dy = y - state.player.y;
        if (Math.hypot(dx, dy) < 22) break;
        steer(x, y);
        var near = nearest(alive().filter(function (e) {
          return Math.hypot(e.x - state.player.x, e.y - state.player.y) < 150;
        }));
        if (near.e) { face(near.e); if (near.d <= reachOf() + (near.e.radius || 14) - 2) attackNow(); }
        update(1 / 60); frames += 1;
        if (frames % 60 === 0) {
          if (Math.abs(state.player.x - lastX) + Math.abs(state.player.y - lastY) < 4) still += 1; else still = 0;
          lastX = state.player.x; lastY = state.player.y;
          if (still >= 3) { __roamDebug.teleport(x, y); update(1 / 60); falls += 1; fallback += 1; still = 0; }
        }
      }
      stop();
      return { frames: frames, fallback: falls };
    }
    function fight(roomId, maxFrames) {
      var frames = 0, quiet = 0, hpStart = state.player.hp, hpMin = state.player.hp;
      var lastX = state.player.x, lastY = state.player.y, still = 0, tps = 0;
      var lastHp = -1, stale = 0, atkTries = 0, atkOk = 0, failSample = null;
      while (frames < maxFrames) {
        if (state.mode !== 'playing' || state.status !== 'playing') break;
        var es = roomEnemies(roomId);
        if (es.length === 0) { quiet += 1; if (quiet >= 90) break; } else { quiet = 0; }
        var near = nearest(es);
        if (near.e) {
          var ex = near.e.x - state.player.x;
          var ey = near.e.y - state.player.y;
          face(near.e);
          if (near.d <= reachOf() + (near.e.radius || 14) - 2) {
            atkTries += 1;
            if (attackNow()) atkOk += 1;
            else if (!failSample) failSample = { lock: !!state.transitionLock, cd: state.weapon ? state.weapon.cd : -1, mode: state.mode, floor: state.floor };
            if (near.d < reachOf() * 0.45) setKeys(ex > 5, ex < -5, ey > 5, ey < -5);
            else stop();
          } else {
            steer(near.e.x, near.e.y);
          }
          var ehp = Math.round(near.e.hp);
          if (ehp === lastHp) stale += 1; else { stale = 0; lastHp = ehp; }
        } else {
          stop();
        }
        if (state.player.hp <= state.player.hpMax * safeFrac) heal();
        update(1 / 60); frames += 1;
        if (state.player.hp < hpMin) hpMin = state.player.hp;
        if (frames % 60 === 0) {
          if (Math.abs(state.player.x - lastX) + Math.abs(state.player.y - lastY) < 4) still += 1; else still = 0;
          lastX = state.player.x; lastY = state.player.y;
          if (still >= 2 && near.e && near.d > reachOf()) { placeNear(near.e); update(1 / 60); tps += 1; fallbackCombat += 1; fallback += 1; still = 0; }
          else if (stale >= 180) { var cur = nearest(roomEnemies(roomId)); if (cur.e) { placeNear(cur.e); update(1 / 60); tps += 1; fallbackCombat += 1; fallback += 1; } stale = 0; }
        }
      }
      stop();
      return { frames: frames, hpStart: hpStart, hpMin: hpMin, remaining: roomEnemies(roomId).length, timedOut: frames >= maxFrames, assist: tps, failSample: failSample, atkTries: atkTries, atkOk: atkOk,
        rest: roomEnemies(roomId).slice(0, 6).map(function (e) { return { id: e.id, kind: e.kind || e.type || null, hp: Math.round(e.hp), hpMax: Math.round(e.hpMax), d: Math.round(Math.hypot(e.x - state.player.x, e.y - state.player.y)), room: e.roomId, stateName: e.state || null }; }),
        diag: (function () {
          var e0 = roomEnemies(roomId)[0];
          return {
            magic: state.activeMagicId, owned: (state.ownedMagic || []).slice(0, 8),
            proj: (state.projectiles || []).length, aimMode: state.aim ? state.aim.mode : null,
            aether: Math.round(state.player.aether), aetherMax: Math.round(state.player.aetherMax),
            keys: e0 ? Object.keys(e0).slice(0, 30) : [],
            flags: e0 ? { armor: e0.armor, shield: e0.shield, immune: e0.immune, elite: e0.elite, defId: e0.defId, name: e0.name, kind: e0.kind, phase: e0.phase, hidden: e0.hidden, alive: e0.hp > 0 } : null
          };
        })() };
    }
    return {
      prepare: function () { window.__e2e.adj = buildAdj(); fallback = 0; fallbackDoor = 0; fallbackCombat = 0; },
      info: function () {
        return {
          floor: state.floor, mode: state.mode, status: state.status,
          hp: state.player.hp, hpMax: state.player.hpMax, kills: state.kills,
          cleared: !!state.floorCleared, rooms: state.rooms.length,
          roomTypes: state.rooms.map(function (r) { return r.type; }),
          region: (typeof regionOf === 'function') ? regionOf(state.floor).name : String(state.floor),
          voidRift: state.voidRift ? { x: state.voidRift.x, y: state.voidRift.y, used: state.voidRift.used } : null
        };
      },
      gotoRoom: function (id, maxFrames) {
        var room = roomById(id);
        if (!room) return { frames: 0, fallback: 0, missing: true };
        var frames = 0, falls = 0, guard = 0;
        while (frames < (maxFrames || 3600) && guard < 200) {
          guard += 1;
          var lap0 = frames;
          if (state.mode !== 'playing') break;
          if (state.currentRoomId === id) break;
          var cur = roomById(state.currentRoomId);
          var door = firstDoor(state.currentRoomId, id);
          if (!door) { var s0 = walkTo(room.cx, room.cy, 900); frames += s0.frames; falls += s0.fallback; break; }
          var step = walkTo(door.x, door.y, 600);
          frames += step.frames; falls += step.fallback;
          var dx = door.x - (cur ? cur.cx : state.player.x);
          var dy = door.y - (cur ? cur.cy : state.player.y);
          var len = Math.hypot(dx, dy) || 1;
          var s1 = walkTo(door.x + (dx / len) * 80, door.y + (dy / len) * 80, 240);
          frames += s1.frames; falls += s1.fallback;
          if (frames - lap0 < 10) {
            __roamDebug.teleport(door.x + (dx / len) * 90, door.y + (dy / len) * 90);
            update(1 / 60); falls += 1; fallback += 1; fallbackDoor += 1;
          }
        }
        stop();
        return { frames: frames, fallback: falls, room: state.currentRoomId };
      },
      walkTo: function (x, y, maxFrames) { return walkTo(x, y, maxFrames || 1200); },
      fight: function (roomId, maxFrames) { return fight(roomId, maxFrames || 900); },
      interact: function () {
        var used = [];
        if (typeof tryEventRoomInteract === 'function' && tryEventRoomInteract()) used.push('event');
        if (typeof tryBossChestInteract === 'function' && tryBossChestInteract()) used.push('chest');
        if (typeof tryVoidRiftInteract === 'function' && tryVoidRiftInteract()) used.push('rift');
        if (typeof trySurvivalInteract === 'function' && trySurvivalInteract()) used.push('survival');
        update(1 / 60);
        return used;
      },
      heal: function () { heal(); },
      descend: function () {
        var f0 = state.floor;
        if (typeof __roamDebug.descend === 'function') __roamDebug.descend();
        update(1 / 60);
        return { from: f0, to: state.floor };
      },
      fallback: function () { return fallback; },
      fallbackCombat: function () { return fallbackCombat; },
      aliveCount: function () { return alive().length; }
    };
  })();
  return true;
})()`;
}

/**
 * 等转场锁释放（真实事件循环里才会触发的 setTimeout）
 * @param {Object} h 句柄
 * @param {number} [ms] 最长等待
 * @returns {Promise<boolean>} 是否自然释放
 */
async function waitUnlock(h, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await h.ev('(() => !!state.transitionLock)()'))) return true;
    await sleep(50);
  }
  await h.ev('(() => { try { state.transitionLock = false; return true; } catch (e) { return false; } })()');
  return false;
}

/**
 * 采样一段真实帧：让 rAF 自由跑 ms 毫秒，然后取回样本
 * @param {Object} h 句柄
 * @param {string} tag 动作标签
 * @param {number} [ms] 采样时长
 * @returns {Promise<Object>} {frames,spikes,stat}
 */
async function sampleFrames(h, tag, ms = 1400) {
  await h.ev(`__hb.setTag(${JSON.stringify(tag)})`);
  await h.ev('__hb.clearFrames()');
  await sleep(ms);
  const got = await h.ev('__hb.takeFrames()');
  const stat = summarizeFrames(got.frames);
  const rec = { tag, floor: stat.floor, mode: stat.mode, enemies: stat.enemies, frames: stat.n, p50: stat.p50, p95: stat.p95, max: stat.max, over20: stat.over20, list: got.frames.slice(0, 12) };
  report.perf.push(rec);
  flush();
  return got;
}

/**
 * 帧样本汇总
 * @param {Array} frames 帧样本
 * @returns {Object} 统计
 */
function summarizeFrames(frames) {
  const n = frames.length;
  if (!n) return { n: 0, p50: null, p95: null, max: null, over20: 0, floor: 0, mode: '', enemies: 0 };
  const ds = frames.map((f) => f.dt).sort((a, b) => a - b);
  return {
    n,
    p50: ds[Math.floor(n * 0.5)], p95: ds[Math.floor(n * 0.95)], max: ds[n - 1],
    over20: ds.filter((d) => d > 20).length,
    floor: frames[frames.length - 1].floor, mode: frames[frames.length - 1].mode,
    enemies: frames[frames.length - 1].enemies
  };
}

/**
 * 做一次 UI 审计并截图，问题写进报告
 * @param {Object} h 句柄
 * @param {string} stage 阶段名
 * @returns {Promise<Object>} 审计结果
 */
async function audit(h, stage) {
  const res = await h.ev(`__hb.auditUI(${JSON.stringify(stage)})`);
  report.meta[stage] = res.meta;
  const file = await shot(h, 'audit-' + stage);
  if (res.issues.length) {
    res.issues.forEach((it) => {
      it.file = file;
      pushIssue(it);
    });
    console.log('  ! UI[' + stage + '] ' + res.issues.length + ' 条 → ' + file);
    res.issues.slice(0, 6).forEach((it) => console.log('    - ' + it.kind + ' ' + it.selector + ' 「' + (it.text || '') + '」'));
  }
  return res;
}

/**
 * 处理奖励弹窗：真实点击第一张卡，最多 3 次；失败则记录并走调试口兜底
 * @param {Object} h 句柄
 * @param {string} tag 场景标签
 * @returns {Promise<Object>} {picked,fails,stages}
 */
async function handleReward(h, tag) {
  const out = { picked: 0, fails: 0, stages: [] };
  for (let i = 0; i < 6; i += 1) {
    const mode = await h.ev('(() => state.mode)()');
    if (mode !== 'reward') break;
    const stageName = await h.ev('(() => { const s = state.rewardStage; if (typeof s === "string") return s; if (s === null || s === undefined) return "none"; try { return "obj:" + JSON.stringify(s).slice(0, 30); } catch (e) { return "obj"; } })()');
    out.stages.push(stageName);
    await audit(h, tag + '-reward-' + stageName);
    await sampleFrames(h, tag + '-reward-' + stageName, 900);
    const beforeStage = stageName;
    const c = await clickUntil(h, '[data-reward-key]', '(() => state.mode !== "reward" || state.rewardStage !== ' + JSON.stringify(beforeStage) + ')');
    if (!c.ok) {
      out.fails += 1;
      report.clicks.push({ where: 'reward-card', stage: stageName, ok: false, tries: c.tries, why: c.why });
      console.log('  ! 奖励卡点击无反应（' + JSON.stringify(c.why) + '），走兜底');
      await h.ev('(() => { try { __roamDebug.xp.chooseFirst(); return true; } catch (e) { return false; } })()');
      await sleep(120);
    } else {
      out.picked += 1;
      report.clicks.push({ where: 'reward-card', stage: stageName, ok: true, tries: c.tries });
    }
    flush();
  }
  return out;
}

/**
 * 分块战斗：每块结束后让 rAF 真跑一段，采集"战斗中的帧时间"
 * @param {Object} h 句柄
 * @param {number} roomId 房间 id
 * @param {string} label 标签
 * @param {number} maxChunks 最多块数
 * @returns {Promise<Object>} 汇总
 */
async function fightRoom(h, roomId, label, maxChunks) {
  const agg = { frames: 0, hpMin: 0, hpStart: 0, remaining: 0, timedOut: false, chunks: 0, failSample: null, rewards: 0 };
  let first = true;
  for (let i = 0; i < maxChunks; i += 1) {
    await h.ev('__hb.setTag(' + JSON.stringify(label + ':step') + ')');
    const r = await h.ev(`__e2e.fight(${roomId}, ${CHUNK})`);
    let mode = await h.ev('(() => state.mode)()');
    /* 战斗中弹出升级 / 清层奖励：先真实点掉，再继续打，否则这间房会被半途丢弃 */
    if (mode === 'reward') {
      await handleReward(h, label);
      agg.rewards += 1;
      mode = await h.ev('(() => state.mode)()');
      if (mode !== 'playing') break;
    }
    agg.chunks += 1;
    agg.frames += r.frames;
    if (!agg.hpStart) agg.hpStart = Math.round(r.hpStart);
    const m = Math.round(r.hpMin);
    if (!agg.hpMin || m < agg.hpMin) agg.hpMin = m;
    agg.remaining = r.remaining;
    if (r.failSample) agg.failSample = r.failSample;
    agg.rest = r.rest || agg.rest;
    agg.diag = r.diag || agg.diag;
    agg.atkTries = (agg.atkTries || 0) + (r.atkTries || 0);
    agg.atkOk = (agg.atkOk || 0) + (r.atkOk || 0);
    if (r.timedOut && r.remaining > 0) agg.timedOut = true;
    if (first && r.frames > 0) {
      first = false;
      await sampleFrames(h, label + '-combat', 1300);
      await shot(h, label + '-combat');
    }
    if (mode !== 'playing') break;
    if (r.remaining === 0) break;
  }
  return agg;
}

/* ---------------- 标题页检查 ---------------- */
/**
 * 标题页：截图 / 审计 / 入口按钮可点性
 * @param {Object} h 句柄
 * @returns {Promise<void>}
 */
async function checkTitle(h) {
  const a = await audit(h, 'title');
  console.log('标题页 meta:', JSON.stringify(a.meta));
  const checks = [
    ['#btnTitleHelp', '(() => state.mode === "rules")'],
    ['#btnTitleCodex', '(() => state.mode === "codex")'],
    ['#btnTitleTalents', '(() => !document.getElementById("talentLayer").classList.contains("hidden") || state.mode === "talents")']
  ];
  for (const [sel, check] of checks) {
    const c = await clickUntil(h, sel, check);
    report.clicks.push({ where: 'title:' + sel, ok: c.ok, tries: c.tries, why: c.why });
    await audit(h, 'title-open-' + sel.replace('#', ''));
    if (c.ok) {
      /* 关掉，避免挡住后续操作 */
      if (sel === '#btnTitleTalents') await h.ev('(() => { try { closeTalentsPage(); return true; } catch (e) { return false; } })()');
      else await h.ev('(() => { try { closeActivePanel(); return true; } catch (e) { return false; } })()');
    }
    await sleep(120);
  }
  /* 存档槽：判定必须看"实际可见高度"是否变化；只看 class 会被无样式的 hidden 骗过 */
  const savesH = `(() => { const el = document.getElementById("titleSaveSlots"); if (!el) return 0; const cs = getComputedStyle(el); const vis = cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; return vis ? Math.round(el.getBoundingClientRect().height) : 0; })()`;
  const h0 = await h.ev(savesH);
  const sc = await clickUntil(h, '#btnTitleSaves', `(() => { const now = ${savesH}(); return Math.abs(now - ${Number(h0)}) > 8; })()`, 3);
  report.clicks.push({ where: 'title:#btnTitleSaves', ok: sc.ok, tries: sc.tries, why: sc.why, before: h0, after: await h.ev(savesH) });
  await audit(h, 'title-open-btnTitleSaves');
  /* 难度切换：易→普通，验证三档都有反应 */
  for (const d of ['easy', 'normal', 'nightmare', 'normal']) {
    const sel = `[data-difficulty="${d}"]`;
    const c = await clickUntil(h, sel, `(() => document.querySelector('${sel}').getAttribute('aria-pressed') === "true")`);
    report.clicks.push({ where: 'title:difficulty:' + d, ok: c.ok, tries: c.tries, why: c.why });
  }
  await audit(h, 'title-after-toggle');
}

/* ---------------- 主流程 ---------------- */
/**
 * 入口
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  flush();
  const h = await boot();
  try {
    await h.ev(installAll());
    await h.ev(installBot());
    await h.ev(`__hb.setTag('title')`);
    await checkTitle(h);

    /* 真实点击开始 */
    const start = await clickUntil(h, '#btnStart', '(() => state.mode !== "title" && state.status === "playing")', 3);
    report.clicks.push({ where: 'title:#btnStart', ok: start.ok, tries: start.tries, why: start.why });
    if (!start.ok) {
      console.log('! 开始按钮 3 次无反应，用调试口兜底开局');
      await h.ev('(() => { try { startRun(); return true; } catch (e) { return false; } })()');
    }
    await sleep(1200);
    await waitUnlock(h);
    await h.ev('(() => { state.mods.hpBonus = Math.max(state.mods.hpBonus || 0, 140); state.player.hpMax = Math.max(state.player.hpMax, 240); state.player.hp = state.player.hpMax; return state.player.hpMax; })()');
    if (STARTFLOOR > 1) {
      await h.ev(`__roamDebug.setFloor(${STARTFLOOR})`);
      await sleep(400);
      await waitUnlock(h);
    }

    for (let floorGuard = 0; floorGuard < 24; floorGuard += 1) {
      const before = await h.ev('__e2e.info()');
      if (before.mode === 'result' || before.status === 'won') break;
      if (before.floor > MAXFLOOR) break;
      await h.ev('__e2e.prepare()');
      const info = await h.ev('__e2e.info()');
      const floorStart = { floor: info.floor, region: info.region, roomTypes: info.roomTypes, segments: [], startedAt: Date.now() };

      await h.ev(`__hb.setTag('f${info.floor}-hud')`);
      await shot(h, 'f' + String(info.floor).padStart(2, '0') + '-hud');
      await audit(h, 'f' + info.floor + '-hud');
      await sampleFrames(h, 'f' + info.floor + '-hud-idle', 1100);

      /* F1 首层：四个常驻面板点的通断（真实点击） */
      if (info.floor === 1) {
        await h.ev('__hb.setTag("f1-panels")');
        await clickUntil(h, '#btnMapDock', '(() => state.mode === "map")');
        await audit(h, 'panel-map');
        await clickUntil(h, '#mapClose', '(() => state.mode === "playing")');
        await clickUntil(h, '#btnSkillDock', '(() => state.mode === "skilltree")');
        await audit(h, 'panel-skilltree');
        await clickUntil(h, '#skillTreeClose', '(() => state.mode === "playing")');
        await clickUntil(h, '#btnRules', '(() => state.mode === "rules")');
        await audit(h, 'panel-rules');
        await clickUntil(h, '#rulesClose', '(() => state.mode === "playing")');
        await clickUntil(h, '#btnSettings', '(() => state.mode === "settings")');
        await audit(h, 'panel-settings');
        await clickUntil(h, '#settingsClose', '(() => state.mode === "playing")');
        const muteBefore = await h.ev('(() => document.getElementById("btnMute").getAttribute("aria-pressed"))');
        const mute = await clickUntil(h, '#btnMute', `(() => document.getElementById("btnMute").getAttribute("aria-pressed") !== ${JSON.stringify(muteBefore)})`);
        report.clicks.push({ where: 'btnMute', ok: mute.ok, tries: mute.tries, why: mute.why });
        await clickUntil(h, '#btnMute', `(() => document.getElementById("btnMute").getAttribute("aria-pressed") === ${JSON.stringify(muteBefore)})`, 1);
        await h.ev('__hb.setTag("f1-post-panels")');
      }

      const ids = await h.ev(`(() => {
        var out = {};
        state.rooms.forEach(function (r) { (out[r.type] = out[r.type] || []).push(r.id); });
        return out;
      })()`);
      const order = ['start', 'battle', 'elite', 'shop', 'chest', 'event', 'survival', 'boss'];
      const queue = [];
      order.forEach((t) => { (ids[t] || []).forEach((id) => queue.push({ id, type: t })); });

      for (const item of queue) {
        await h.ev('__e2e.heal()');
        await waitUnlock(h);
        await h.ev('__hb.setTag(' + JSON.stringify('f' + info.floor + '-go-' + item.type) + ')');
        let go = { frames: 0, fallback: 0 };
        for (let tr = 0; tr < 3; tr += 1) {
          go = await h.ev(`__e2e.gotoRoom(${item.id}, 3000)`);
          await waitUnlock(h);
          if (await h.ev('(() => state.mode)()') === 'reward') { await handleReward(h, 'f' + info.floor + '-go'); continue; }
          break;
        }
        let fight = { frames: 0, hpStart: 0, hpMin: 0, remaining: 0, timedOut: false, chunks: 0, failSample: null };
        let interact = [];
        if (item.type !== 'start' && item.type !== 'shop') {
          fight = await fightRoom(h, item.id, 'f' + info.floor + '-' + item.type, item.type === 'boss' ? 34 : 10);
          await handleReward(h, 'f' + info.floor + '-' + item.type);
          if (['event', 'chest', 'survival'].indexOf(item.type) >= 0) {
            await h.ev('__hb.setTag(' + JSON.stringify('f' + info.floor + '-interact') + ')');
            interact = await h.ev('__e2e.interact()');
            if (interact.length) {
              await waitUnlock(h);
              await audit(h, 'f' + info.floor + '-' + item.type + '-panel');
              await handleReward(h, 'f' + info.floor + '-' + item.type + '-after');
              fight = await fightRoom(h, item.id, 'f' + info.floor + '-' + item.type + '-after', 10);
            }
          }
        }
        /* boss 房：战斗中段截图 + 帧采样 */
        if (item.type === 'boss') {
          await shot(h, 'f' + String(info.floor).padStart(2, '0') + '-boss');
          await audit(h, 'f' + info.floor + '-boss');
          await sampleFrames(h, 'f' + info.floor + '-boss-fight', 1300);
        }
        floorStart.segments.push({
          type: item.type, room: item.id,
          travelFrames: go.frames, travelFallback: go.fallback,
          fightFrames: fight.frames, hpStart: fight.hpStart, hpMin: fight.hpMin,
          remaining: fight.remaining, timedOut: fight.timedOut, chunks: fight.chunks,
          failSample: fight.failSample, interact,
          atkTries: fight.atkTries, atkOk: fight.atkOk, rewards: fight.rewards, rest: fight.rest, diag: fight.diag
        });
        if (fight.timedOut) console.log('  ! F' + info.floor + ' ' + item.type + ' 房 15s 未清（剩余 ' + fight.remaining + '）');
        flush();
        if (await h.ev('(() => state.status)()') !== 'playing') break;
      }

      const after = await h.ev('__e2e.info()');
      floorStart.cleared = after.cleared;
      floorStart.hp = Math.round(after.hp);
      floorStart.hpMax = Math.round(after.hpMax);
      floorStart.enemiesLeft = await h.ev('__e2e.aliveCount()');
      floorStart.fallbacks = floorStart.segments.reduce((a, s) => a + (s.travelFallback || 0), 0);
      floorStart.errors = h.runtimeErrors.length;
      report.floors.push(floorStart);
      const lastPerf = report.perf.filter((p) => p.floor === info.floor);
      const worst = lastPerf.reduce((a, p) => (p.max && (!a || p.max > a.max) ? p : a), null);
      console.log('F' + info.floor + ' · ' + info.region + ' · 房 ' + floorStart.segments.length
        + ' · ' + (floorStart.cleared ? 'CLEAR' : 'UNCLEARED') + ' · 敌剩 ' + floorStart.enemiesLeft
        + ' · 最差帧 ' + (worst ? worst.max + 'ms@' + worst.tag : '-')
        + ' · 报错 ' + h.runtimeErrors.length);
      flush();

      if (info.floor >= MAXFLOOR) break;
      /* 楼层转场（真实 rAF 采样） */
      await h.ev('__hb.setTag(' + JSON.stringify('f' + info.floor + '-descend') + ')');
      await h.ev('__hb.clearFrames()');
      const down = await h.ev('__e2e.descend()');
      const unlock = await waitUnlock(h, 6000);
      const trans = await h.ev('__hb.takeFrames()');
      const tstat = summarizeFrames(trans.frames);
      report.perf.push({ tag: 'descend-f' + info.floor + '->' + down.to, floor: down.to, mode: 'transition', enemies: 0, frames: tstat.n, p50: tstat.p50, p95: tstat.p95, max: tstat.max, over20: tstat.over20, naturalUnlock: unlock, list: trans.frames.slice(0, 10) });
      await shot(h, 'f' + String(down.to).padStart(2, '0') + '-wipe');
      if (down.to <= down.from) {
        report.floors.push({ floor: info.floor, stuckOnStairs: true });
        flush();
        break;
      }
      await sleep(150);
    }

    /* 结算页（若已到 20 层通关） */
    const fin = await h.ev('(() => ({ floor: state.floor, status: state.status, mode: state.mode }))()');
    report.final = fin;
    if (fin.mode === 'result') {
      await h.ev('__hb.setTag("result")');
      await shot(h, 'result');
      await audit(h, 'result');
      await sampleFrames(h, 'result', 900);
      const rb = await clickUntil(h, '[data-action="restart"]', '(() => state.mode !== "result")');
      report.clicks.push({ where: 'result:restart', ok: rb.ok, tries: rb.tries, why: rb.why });
    }
    report.errors = h.runtimeErrors.slice();
    report.finishedAt = new Date().toISOString();
    flush();

    /* 汇总打印 */
    const allPerf = report.perf.filter((p) => p.n);
    const worstFrames = allPerf.slice().sort((a, b) => (b.max || 0) - (a.max || 0)).slice(0, 8);
    console.log('\n===== 最差单帧 TOP8 =====');
    worstFrames.forEach((p) => console.log('  ' + (p.max || 0) + 'ms · ' + p.tag + ' · F' + p.floor + ' · ' + p.mode + ' · 敌 ' + p.enemies + ' · n=' + p.n));
    console.log('\n===== 分段统计 =====');
    const byRegion = {};
    report.perf.filter((p) => p.n && p.mode !== 'transition' && p.mode !== 'result').forEach((p) => {
      const k = Math.floor((p.floor - 1) / 5) * 5 + 1;
      const b = byRegion[k] = byRegion[k] || { p95: 0, max: 0, over20: 0, n: 0 };
      b.p95 = Math.max(b.p95, p.p95 || 0); b.max = Math.max(b.max, p.max || 0); b.over20 += p.over20 || 0; b.n += p.n;
    });
    Object.keys(byRegion).forEach((k) => {
      const b = byRegion[k];
      console.log('  F' + k + '-' + (Number(k) + 4) + ' · p95≤' + b.p95 + 'ms · max ' + b.max + 'ms · >20ms ' + b.over20 + '/' + b.n);
    });
    console.log('\nUI 问题 ' + report.ui.length + ' 条 · 点击问题 ' + report.clicks.filter((c) => !c.ok).length + ' 条 · 控制台报错 ' + report.errors.length + ' 条');
    console.log('RESULT → ' + RESULT);
  } finally {
    h.ws.close();
    try { spawnSync('taskkill', ['/PID', String(h.edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 忽略 */ }
    setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); } catch (e) { /* profile 占用，忽略 */ } }, 500);
  }
}

main().catch((e) => { console.error('FATAL', e); try { flush(); } catch (x) { /* 忽略 */ } process.exit(1); });
