/**
 * 副本状态验收：三个面板的暂停/摇杆轴残留 + 死亡重开的复位数值
 * ============================================================
 * 为什么单开一个脚本：
 *   me2e.js 验的是"能不能一路打到下一层"（链路），本脚本验的是"状态干不干净"（复位）。
 *   两者都要独占一个 Edge，所以互斥：各用自己的锁文件（.e2e.lock / .mstate.lock）。
 *
 * 时基法（和 me2e 同口径）：
 *   冻结 requestAnimationFrame，改由脚本调 __mfStep(sec) 手动推进 update(1/60)。
 *   __mfStep 调的就是主循环那个 update，所以"面板打开时 __mfStep 推不动 state.elapsed"
 *   等价于"rAF 恢复后面板期间世界也停着"——这是主文件 62551 行
 *   `running = mode==='playing' && status==='playing'` 那条守卫决定的。
 *
 * 两段：
 *   ① 暂停(rules/H) / 设置(settings/O) / 地图(map/M)：开 → 量 Δ游戏时间 → 关 → 量回温
 *      → 再量"摇杆轴有没有停在旧值"
 *   ② 死亡与重开：damagePlayer 打到 0 → 结算 → 重开 → 逐项比对复位前后数值
 *
 * 用法：node mobile/tools/mstate.js --force
 * 产物：mobile/shots/state_<时间戳>/（截图 + state.json）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_state');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9568;                       // 与 me2e 的 9567 错开，避免端口撞车
const PAGE = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const LOCK = path.join(MOBILE_DIR, '.mstate.lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round(n * 100) / 100;

/** 进程是否还活着（并发锁用） */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

/**
 * 启动无头 Edge 并返回 CDP 封装（与 me2e 同款：本机常驻 100+ Edge，冷启动给足 90s）
 * @returns {Promise<Object>} { send, ev, shot, close }
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 360; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('Edge 调试端口未就绪'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP 超时：' + method)); }, 45000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  /* 只读求值统一重试：环境负载导致的偶发超时不该让整轮验收报废 */
  const ev = async (expression) => {
    let lastErr = null;
    for (let k = 0; k < 3; k += 1) {
      try {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 260));
        return r.result.value;
      } catch (e) {
        lastErr = e;
        if (!/CDP 超时/.test(e.message)) throw e;
        await sleep(500);
      }
    }
    throw lastErr;
  };
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/**
 * 下发触摸点（多点一次下发；环境卡顿重试 3 次，仍失败就清空触点并抛 CDP_STALL）
 * @param {Object} cdp CDP 封装
 * @param {string} type touchStart / touchMove / touchEnd / touchCancel
 * @param {Array} pts [{id,x,y}]
 */
async function sendPoints(cdp, type, pts) {
  const payload = {
    type,
    touchPoints: pts.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: p.id }))
  };
  let lastErr = null;
  for (let k = 0; k < 3; k += 1) {
    try { await cdp.send('Input.dispatchTouchEvent', payload); return; } catch (e) {
      lastErr = e;
      if (!/CDP 超时/.test(e.message)) throw e;
      await sleep(600);
    }
  }
  try { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } catch (e) { /* ignore */ }
  throw new Error('CDP_STALL' + (lastErr ? '：' + lastErr.message : ''));
}

/** 单指单击（点不到就放弃这一下，不打断整轮） */
async function tap(cdp, x, y, holdMs) {
  try {
    await sendPoints(cdp, 'touchStart', [{ id: 1, x, y }]);
    await sleep(holdMs || 45);
    await sendPoints(cdp, 'touchEnd', []);
  } catch (e) {
    if (!/CDP_STALL/.test(e.message)) throw e;
  }
}

/** 元素矩形中心 */
const RECT_JS = (sel) => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();var cs=getComputedStyle(e);return {cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height,visible:cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0};})()`;

/** 元素矩形 + 是否真的点得到（在视口内 && 命中测试落在自己身上） */
const HIT_JS = (sel) => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();var cx=r.left+r.width/2,cy=r.top+r.height/2;var inView=cx>=0&&cx<=innerWidth&&cy>=0&&cy<=innerHeight;var top=document.elementFromPoint(cx,cy);return {cx:cx,cy:cy,w:r.width,h:r.height,inView:inView,hit:!!(top&&(top===e||e.contains(top))),topTag:top?top.tagName+'.'+(top.className||''):null};})()`;

/**
 * 完整状态快照：复位前后逐项比对用
 * 覆盖用户点名的六项：血量 / 等级 / 经验 / 卡池 / 摇杆轴 / 楼层（外加敌人数量、模式）
 */
const FULL_JS = `(function () {
  var s = state;
  return {
    floor: s.floor, mode: s.mode, status: s.status || null,
    elapsed: Math.round(s.elapsed * 100) / 100,
    hp: Math.round(s.player.hp), hpMax: Math.round(s.player.hpMax),
    xp: Math.round(s.xp), xpNeed: s.xpNeed, lv: s.xpLevel,
    ownedMagic: s.ownedMagic.slice(), ownedTech: s.ownedTech.slice(),
    activeMagicId: s.activeMagicId || null,
    slots: (s.dual && s.dual.slots) ? s.dual.slots.slice() : null,
    /* 起手额外卡（冰环）来自 meta.rewards.cards>0；把它读出来才能判断"重开少一张"是谁的锅 */
    metaCards: (s.meta && s.meta.rewards) ? (Number(s.meta.rewards.cards) || 0) : -1,
    metaRuns: (s.meta && typeof s.meta.runs === 'number') ? s.meta.runs : -1,
    enemies: s.enemies.filter(function (e) { return e && e.hp > 0; }).length,
    cleared: !!s.floorCleared,
    stairsActive: !!(s.stairs && s.stairs.active),
    px: Math.round(s.player.x), py: Math.round(s.player.y),
    axisX: Math.round((s.touch.axisX || 0) * 100) / 100,
    axisY: Math.round((s.touch.axisY || 0) * 100) / 100,
    moveId: (s.touch.moveId === null || s.touch.moveId === undefined) ? null : s.touch.moveId,
    modalOpen: !document.getElementById('modalLayer').classList.contains('hidden')
  };
})()`;

/** 定步长驱动（把 rAF 换成手动 update） */
const SIM_DEFINE = `(function () {
  window.__mfStep = function (sec) {
    var n = Math.max(1, Math.round(sec * 60));
    for (var i = 0; i < n; i += 1) update(1 / 60);
    try { render(); } catch (e) { /* 渲染失败不影响逻辑 */ }
    return { elapsed: Math.round(state.elapsed * 100) / 100, mode: state.mode, hp: Math.round(state.player.hp) };
  };
  window.__mfRafOff = function () {
    window.requestAnimationFrame = function () { return 0; };
    return true;
  };
  return true;
})()`;

/**
 * 测一个面板：入口可点 → 打开 → 时基法量暂停 → 关闭 → 阳性对照 → 摇杆轴残留
 * @param {Object} cdp CDP 封装
 * @param {Object} p { id, btn, close, panel }
 * @param {Object} ctx { stick, log, out }
 * @returns {Promise<Object>} 该面板的全部读数
 */
async function testPanel(cdp, p, ctx) {
  const { stick, log } = ctx;
  const r = { id: p.id, entry: null, opened: false, pause: null, resume: null, axis: null };
  log(`\n[面板·${p.id}] ----------`);

  const btn = await cdp.ev(HIT_JS(p.btn));
  r.preMode = await cdp.ev('state.mode');
  r.preModal = await cdp.ev(`!document.getElementById('modalLayer').classList.contains('hidden')`);
  r.entry = btn;
  log(`[面板·${p.id}] 入口 ${p.btn}：在视口内=${!!(btn && btn.inView)} 点得到=${!!(btn && btn.hit)} 命中元素=${btn ? btn.topTag : 'null'}`
    + `（开测前 mode=${r.preMode} 弹窗=${r.preModal}）`);
  if (!btn || !btn.inView || !btn.hit) { r.note = '入口不可触摸，跳过（不用 openPanel 作弊）'; log(`[面板·${p.id}] ${r.note}`); return r; }

  await tap(cdp, btn.cx, btn.cy, 45);
  await sleep(420);
  const opened = await cdp.ev(`(function(){var e=document.querySelector(${JSON.stringify(p.panel)});return !!(e&&e.classList.contains('is-open'));})()`);
  r.opened = opened;
  r.modeAfterOpen = await cdp.ev('state.mode');
  log(`[面板·${p.id}] 触摸打开=${opened} state.mode=${r.modeAfterOpen}`);
  if (!opened) { r.note = '触摸未打开面板'; return r; }
  await ctx.shot(`panel_${p.id}_open.jpg`);

  /* ---------- 时基法：面板打开时推进 1.0s 游戏时间 ---------- */
  const b1 = await cdp.ev(FULL_JS);
  const t0 = Date.now();
  await cdp.ev('window.__mfStep(1.0)');
  const realMs = Date.now() - t0;
  const a1 = await cdp.ev(FULL_JS);
  r.pause = {
    realMs,
    elapsedBefore: b1.elapsed, elapsedAfter: a1.elapsed,
    dElapsed: r2(a1.elapsed - b1.elapsed),
    posBefore: [b1.px, b1.py], posAfter: [a1.px, a1.py],
    dPos: Math.round(Math.hypot(a1.px - b1.px, a1.py - b1.py)),
    mode: a1.mode
  };
  log(`[面板·${p.id}] 暂停判定：下发 __mfStep(1.0)，真实耗时 ${realMs}ms；游戏时间 ${b1.elapsed} → ${a1.elapsed}`
    + `（Δ=${r.pause.dElapsed}s）；位置 ${b1.px},${b1.py} → ${a1.px},${a1.py}（Δ=${r.pause.dPos}px）`);

  /* ---------- 关闭 ---------- */
  const closeBtn = await cdp.ev(HIT_JS(p.close));
  r.closeEntry = closeBtn;
  if (closeBtn && closeBtn.hit) { await tap(cdp, closeBtn.cx, closeBtn.cy, 45); await sleep(380); }
  r.closed = await cdp.ev(`(function(){var e=document.querySelector(${JSON.stringify(p.panel)});return !(e&&e.classList.contains('is-open'));})()`);
  r.modeAfterClose = await cdp.ev('state.mode');
  log(`[面板·${p.id}] 触摸关闭=${r.closed}（关闭键点得到=${!!(closeBtn && closeBtn.hit)}）state.mode=${r.modeAfterClose}`);

  /* ---------- 阳性对照：同一把尺子，面板关了就该推进得动 ---------- */
  const b2 = await cdp.ev(FULL_JS);
  const t1 = Date.now();
  await cdp.ev('window.__mfStep(1.0)');
  const a2 = await cdp.ev(FULL_JS);
  r.resume = {
    realMs: Date.now() - t1,
    elapsedBefore: b2.elapsed, elapsedAfter: a2.elapsed,
    dElapsed: r2(a2.elapsed - b2.elapsed), mode: a2.mode
  };
  log(`[面板·${p.id}] 阳性对照：关闭后再 __mfStep(1.0) → 游戏时间 ${b2.elapsed} → ${a2.elapsed}（Δ=${r.resume.dElapsed}s）`);

  /* ---------- 摇杆轴：按住 → 松开 → 开关面板 → 再读 ---------- */
  const ax = { hold: null, afterRelease: null, afterOpenClose: null, moveAfter: null };
  await sendPoints(cdp, 'touchStart', [{ id: 1, x: stick.cx, y: stick.cy }]);
  await sleep(50);
  await sendPoints(cdp, 'touchMove', [{ id: 1, x: stick.cx + 38, y: stick.cy }]);
  await sleep(80);
  ax.hold = await cdp.ev(`({x:Math.round(state.touch.axisX*100)/100,y:Math.round(state.touch.axisY*100)/100,moveId:state.touch.moveId})`);
  const pm0 = await cdp.ev(`({x:state.player.x,y:state.player.y})`);
  await cdp.ev('window.__mfStep(0.3)');
  const pm1 = await cdp.ev(`({x:state.player.x,y:state.player.y})`);
  ax.holdMovePx = Math.round(Math.hypot(pm1.x - pm0.x, pm1.y - pm0.y));
  await sendPoints(cdp, 'touchEnd', []);
  await sleep(80);
  ax.afterRelease = await cdp.ev(`({x:Math.round(state.touch.axisX*100)/100,y:Math.round(state.touch.axisY*100)/100,moveId:state.touch.moveId})`);

  /* 再用同一套顺序走一遍"开 → 关"，看轴里有没有留下旧值 */
  await tap(cdp, btn.cx, btn.cy, 45);
  await sleep(380);
  const p2 = await cdp.ev(HIT_JS(p.close));
  if (p2 && p2.hit) { await tap(cdp, p2.cx, p2.cy, 45); await sleep(380); }
  ax.afterOpenClose = await cdp.ev(`({x:Math.round(state.touch.axisX*100)/100,y:Math.round(state.touch.axisY*100)/100,moveId:state.touch.moveId,mode:state.mode})`);
  /* 连续采样 3 秒：每格 0.1s（6 帧 update），画"无输入位移曲线"。
     判据：若是轴残留，每格都会是接近恒定的几十 px，永不归零；
           若是走位惯性余量，前几格快速衰减，之后整段为 0。 */
  ax.curve = [];
  let prev = await cdp.ev(`({x:state.player.x,y:state.player.y})`);
  for (let i = 0; i < 30; i += 1) {
    await cdp.ev('window.__mfStep(0.1)');
    const cur = await cdp.ev(`({x:state.player.x,y:state.player.y})`);
    ax.curve.push(Math.round(Math.hypot(cur.x - prev.x, cur.y - prev.y)));
    prev = cur;
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  ax.moveAfter = sum(ax.curve.slice(0, 10));
  ax.moveAfter2 = sum(ax.curve.slice(10, 20));
  ax.moveAfter3 = sum(ax.curve.slice(20, 30));
  ax.zeroAt = ax.curve.findIndex((v) => v === 0);
  ax.monotonic = ax.curve.every((v, i) => i === 0 || v <= ax.curve[i - 1]);
  r.axis = ax;
  log(`[面板·${p.id}] 摇杆轴：按住=(${ax.hold.x},${ax.hold.y}) 移动=${ax.holdMovePx}px`
    + ` → 松开后=(${ax.afterRelease.x},${ax.afterRelease.y})`
    + ` → 开面板再关后=(${ax.afterOpenClose.x},${ax.afterOpenClose.y}) mode=${ax.afterOpenClose.mode}`);
  log(`[面板·${p.id}] 无输入位移曲线（每格 0.1s，共 3s）：${ax.curve.join(',')}`);
  log(`[面板·${p.id}] 第1秒=${ax.moveAfter}px 第2秒=${ax.moveAfter2}px 第3秒=${ax.moveAfter3}px`
    + ` 首次归零在第 ${ax.zeroAt < 0 ? '—' : ax.zeroAt + 1} 格 单调不增=${ax.monotonic}`);
  return r;
}

/**
 * 死亡 → 结算 → 重开，逐项比对复位前后的数值
 * @param {Object} cdp CDP 封装
 * @param {Object} ctx { log, out, shot }
 * @returns {Promise<Object>} { before, death, restartPath, after, checks }
 */
async function testDeathRestart(cdp, ctx) {
  const { log, baseline } = ctx;
  log('\n[死亡重开] ----------');
  const before = await cdp.ev(FULL_JS);
  log(`[死亡重开] 死亡前：floor=${before.floor} mode=${before.mode} hp=${before.hp}/${before.hpMax} lv=${before.lv} xp=${before.xp}/${before.xpNeed}`
    + ` 卡池=${before.ownedMagic.length}张[${before.ownedMagic.join(',')}] 科技=${before.ownedTech.length}项 敌人=${before.enemies} 轴=(${before.axisX},${before.axisY})`);

  /* 用游戏自己的伤害入口打死，保证走完整的 loseGame → showResult 链路 */
  const dmg = await cdp.ev(`(function(){try{return damagePlayer(9999, state.player.x+40, state.player.y, {kind:'contact',name:'E2E 造死亡'});}catch(e){return {err:String(e)};}})()`);
  await sleep(300);
  const dead = await cdp.ev(FULL_JS);
  await ctx.shot('death_result.jpg');
  log(`[死亡重开] damagePlayer 返回=${JSON.stringify(dmg).slice(0, 120)}`);
  log(`[死亡重开] 结算态：status=${dead.status} mode=${dead.mode} hp=${dead.hp} 弹窗=${dead.modalOpen}`);

  /* 重开：优先真实触摸结算页按钮，其次头部重开键，最后才键盘 R（并如实记录用了哪条） */
  let restartPath = null;
  const rb = await cdp.ev(HIT_JS('#modal [data-action="restart"]'));
  if (rb && rb.inView && rb.hit) {
    await tap(cdp, rb.cx, rb.cy, 50);
    restartPath = '触摸结算页 [data-action="restart"]';
  } else {
    const hb = await cdp.ev(HIT_JS('#btnRestart'));
    if (hb && hb.inView && hb.hit) {
      await tap(cdp, hb.cx, hb.cy, 50);
      restartPath = '触摸头部 #btnRestart';
    } else {
      await cdp.ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'r',code:'KeyR'}))`);
      restartPath = '键盘 R（结算页按钮与头部键都点不到）';
    }
  }
  log(`[死亡重开] 重开路径：${restartPath}`);

  let after = null;
  for (let i = 0; i < 40; i += 1) {
    after = await cdp.ev(FULL_JS);
    if (after.mode === 'playing' && after.floor === 1) break;
    await sleep(200);
  }
  await sleep(300);
  await cdp.ev('window.__mfStep(0.2)');
  after = await cdp.ev(FULL_JS);
  await ctx.shot('restart_floor1.jpg');
  log(`[死亡重开] 重开后：floor=${after.floor} mode=${after.mode} status=${after.status} hp=${after.hp}/${after.hpMax} lv=${after.lv} xp=${after.xp}/${after.xpNeed}`
    + ` 卡池=${after.ownedMagic.length}张[${after.ownedMagic.join(',')}] 科技=${after.ownedTech.length}项 敌人=${after.enemies} 轴=(${after.axisX},${after.axisY}) moveId=${after.moveId}`
    + ` 主槽=${after.activeMagicId} 副槽=${after.slots ? after.slots.join('/') : '无'} meta.rewards.cards=${after.metaCards} meta.runs=${after.metaRuns}`);

  /* 判定：逐条写死。卡池/科技用"开局基线"作基准——死亡前那几张可能是中途捡的，不能当基准 */
  const checks = {
    floor: { before: before.floor, after: after.floor, ok: after.floor === 1, want: 1 },
    hp: { before: `${before.hp}/${before.hpMax}`, after: `${after.hp}/${after.hpMax}`, ok: after.hp === after.hpMax, want: '满血' },
    lv: { before: before.lv, after: after.lv, ok: after.lv === 1, want: 1 },
    xp: { before: `${before.xp}/${before.xpNeed}`, after: `${after.xp}/${after.xpNeed}`, ok: after.xp === 0, want: 0 },
    cards: {
      before: `${before.ownedMagic.length}张[${before.ownedMagic.join(',')}]`,
      after: `${after.ownedMagic.length}张[${after.ownedMagic.join(',')}]`,
      ok: after.ownedMagic.join(',') === baseline.ownedMagic.join(','),
      want: `开局基线 ${baseline.ownedMagic.length}张[${baseline.ownedMagic.join(',')}]`
    },
    tech: {
      before: before.ownedTech.length,
      after: after.ownedTech.length,
      ok: after.ownedTech.join(',') === baseline.ownedTech.join(','),
      want: `开局基线 ${baseline.ownedTech.length}项`
    },
    axis: { before: `${before.axisX},${before.axisY}`, after: `${after.axisX},${after.axisY}`, ok: after.axisX === 0 && after.axisY === 0 && after.moveId === null, want: '0,0 / moveId=null' },
    mode: { before: before.mode, after: `${after.mode}/${after.status}`, ok: after.mode === 'playing' && after.status === 'playing', want: 'playing/playing' }
  };
  const pass = Object.keys(checks).every((k) => checks[k].ok);
  log(`[死亡重开] 开局基线：floor=${baseline.floor} hp=${baseline.hp}/${baseline.hpMax} lv=${baseline.lv} xp=${baseline.xp}`
    + ` 卡池=${baseline.ownedMagic.length}张[${baseline.ownedMagic.join(',')}] 科技=${baseline.ownedTech.length}项`);
  log(`[死亡重开] 判定 ${pass ? 'PASS' : 'FAIL'}：` + Object.keys(checks).map((k) => `${k} ${checks[k].before}→${checks[k].after}${checks[k].ok ? '✓' : '✗'}`).join('  '));
  return { before, death: dead, dmgResult: dmg, restartPath, after, checks, pass };
}

/**
 * 主流程
 */
async function main() {
  if (fs.existsSync(LOCK)) {
    const old = Number(fs.readFileSync(LOCK, 'utf8').trim());
    if (old && pidAlive(old)) {
      console.error(`已有 mstate 在运行（pid=${old}），先等它结束再跑；本次不启动。`);
      process.exitCode = 4;
      return;
    }
  }
  fs.writeFileSync(LOCK, String(process.pid));

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const RUN_DIR = path.join(MOBILE_DIR, 'shots', `state_${stamp}`);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const md5 = crypto.createHash('md5').update(fs.readFileSync(PAGE)).digest('hex').toUpperCase();
  const out = { run: `state_${stamp}`, snapshot: { bytes: fs.statSync(PAGE).size, md5 }, panels: {}, death: null, log: [] };
  const log = (msg) => { console.log(msg); out.log.push(msg); };

  const cdp = await bootEdge();
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + PAGE.replace(/\\/g, '/') + '?mstate=1' });
    for (let i = 0; i < 120; i += 1) {
      if (await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`)) break;
      await sleep(200);
    }
    await sleep(900);
    await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
    await sleep(600);
    if (!(await cdp.ev(`state.mode === 'playing'`))) {
      await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
    }
    for (let i = 0; i < 80; i += 1) {
      if (await cdp.ev(`state.mode === 'playing'`)) break;
      await sleep(200);
    }
    await sleep(4400);              // 开场仪式（真实时间，rAF 还在跑）
    await cdp.ev(SIM_DEFINE);
    await cdp.ev(`window.__mfRafOff()`);   // 冻结 rAF，改手动定步长
    await sleep(200);
    const e0 = await cdp.ev('state.elapsed');
    await sleep(600);
    const e1 = await cdp.ev('state.elapsed');
    out.timebase = { elapsedBefore: e0, elapsedAfter: e1 };
    log(`[时基] 冻结 rAF 后 0.6s 真实时间 → 游戏时间只走了 ${r2(e1 - e0)}s（≈0 表示已由脚本接管）`);
    await cdp.ev('window.__mfStep(0.3)');

    const stick = await cdp.ev(RECT_JS('#arcmStick'));
    if (!stick) throw new Error('摇杆不可见（arcm 层没起来？）');
    out.stick = stick;
    /* 开局基线：死亡重开的"复位"要跟它比，而不是跟死亡前比（死亡前可能已经捡了卡） */
    out.baseline = await cdp.ev(FULL_JS);
    log(`[基线] floor=${out.baseline.floor} hp=${out.baseline.hp}/${out.baseline.hpMax} lv=${out.baseline.lv} xp=${out.baseline.xp}/${out.baseline.xpNeed}`
      + ` 卡池=${out.baseline.ownedMagic.length}张[${out.baseline.ownedMagic.join(',')}] 科技=${out.baseline.ownedTech.length}项 敌人=${out.baseline.enemies}`
      + ` 主槽=${out.baseline.activeMagicId} 副槽=${out.baseline.slots ? out.baseline.slots.join('/') : '无'} meta.rewards.cards=${out.baseline.metaCards} meta.runs=${out.baseline.metaRuns}`);
    const ctx = { stick, log, out, baseline: out.baseline, shot: (n) => cdp.shot(path.join(RUN_DIR, n)) };

    /* ---------- 第一段：三个面板 ---------- */
    const pre = await cdp.ev(FULL_JS);
    if (pre.mode !== 'playing' || pre.modalOpen) {
      log(`[面板] 前置状态不干净（mode=${pre.mode} 弹窗=${pre.modalOpen}），先清弹窗`);
      await cdp.ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape'}))`);
      await sleep(300);
    }
    const PANELS = [
      { id: 'rules', btn: '#btnRules', close: '#rulesClose', panel: '#rulesPanel' },
      { id: 'settings', btn: '#btnSettings', close: '#settingsClose', panel: '#settingsPanel' },
      { id: 'map', btn: '#btnMapDock', close: '#mapClose', panel: '#mapPanel' }
    ];
    for (const p of PANELS) {
      try { out.panels[p.id] = await testPanel(cdp, p, ctx); }
      catch (e) { out.panels[p.id] = { id: p.id, error: String(e.message || e) }; log(`[面板·${p.id}] 中断：${e.message}`); }
      /* 每个面板之间回一次干净的战斗态 */
      const st = await cdp.ev(FULL_JS);
      if (st.mode !== 'playing') {
        await cdp.ev(`(function(){try{closePanel(state.mode);}catch(e){}return true;})()`);
        await sleep(250);
      }
    }

    /* ---------- 第二段：死亡与重开 ---------- */
    out.death = await testDeathRestart(cdp, ctx);

    /* ---------- 总判定 ---------- */
    const panelList = Object.keys(out.panels).map((k) => out.panels[k]);
    const panelPass = panelList.every((p) => p.error || p.note
      || (p.pause && p.pause.dElapsed === 0 && p.pause.dPos === 0 && p.resume && p.resume.dElapsed > 0.5)
      && (p.axis && p.axis.afterOpenClose && p.axis.afterOpenClose.x === 0 && p.axis.afterOpenClose.y === 0
        && p.axis.moveAfter2 === 0 && p.axis.moveAfter3 === 0));
    out.verdict = {
      pass: !!(panelPass && out.death && out.death.pass),
      panels: panelPass,
      death: !!(out.death && out.death.pass),
      frameRate: '未测（真机不给数字）'
    };
    log(`\n[总判定] 面板=${out.verdict.panels ? 'PASS' : 'FAIL'} 死亡重开=${out.verdict.death ? 'PASS' : 'FAIL'}`
      + ` → 本轮 ${out.verdict.pass ? 'PASS' : 'FAIL'}；真机帧率=未测`);

    fs.writeFileSync(path.join(RUN_DIR, 'state.json'), JSON.stringify(out, null, 1));
    console.log('结果目录：' + RUN_DIR);
  } catch (err) {
    try {
      out.crash = String((err && err.message) || err);
      fs.writeFileSync(path.join(RUN_DIR, 'state.json'), JSON.stringify(out, null, 1));
      console.error('运行中断（' + out.crash + '），已写出部分结果：' + path.join(RUN_DIR, 'state.json'));
    } catch (e2) { /* ignore */ }
    throw err;
  } finally {
    cdp.close();
    try { fs.unlinkSync(LOCK); } catch (e) { /* ignore */ }
  }
}

main().catch((e) => { try { fs.unlinkSync(LOCK); } catch (e2) { /* ignore */ } console.error(e); process.exitCode = 1; });
