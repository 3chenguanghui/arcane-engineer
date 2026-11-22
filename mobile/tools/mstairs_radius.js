/**
 * 楼梯交互半径（96px）移动端真触摸验收
 * ============================================================
 * 目的：证明"进入 96 半径即可按交互键下楼"，并给出 90 / 96 触发、97 / 100 不触发
 *       的对照读数（阈值判据是 `d > STAIR_INTERACT_RANGE` 才拒绝）。
 *
 * 做法（只读 + 测试口，不改游戏文件）：
 *   1. 打开 mobile/index_arcane_v2_mobile.html，正常开局并选角色；
 *   2. 用 `__roamDebug.floorGraph()` 拿到楼梯房中心，设 `state.stairs.active = true`
 *      （跳过打完首领的前置，只测距离判定）；
 *   3. 用 `__roamDebug.teleport()` 把玩家放到距楼梯 N px 的可站立点；
 *   4. 用 Input.dispatchTouchEvent 点 `[data-act="descend"]`（真触摸），
 *      读数：按前距离、楼层是否 +1、失败 toast 原文。
 *
 * 用法：node mobile/tools/mstairs_radius.js
 * 产物：mobile/shots/stairs_<时间戳>/stairs.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_stairs');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9573;
const PAGE = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const OUT = path.join(MOBILE_DIR, 'shots', 'stairs_' + stamp);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动无头 Edge 并连上 CDP */
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
  /** 求值：返回页面里的值 */
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails));
    return r.result ? r.result.value : undefined;
  };
  return { send, ev, edge };
}

/** 发一次真实触摸（touchStart + touchEnd），坐标为 CSS 像素 */
async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x, y: y, radiusX: 6, radiusY: 6, force: 1, id: 1 }]
  });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
}

/**
 * 给当前层"点亮"楼梯，并把玩家放到距楼梯 dist 的可站立点
 * @param {Object} cdp CDP 封装
 * @param {number} dist 目标距离（游戏世界像素）
 * @returns {Promise<Object>} { ok, floor, stair, actualDist, tried }
 */
async function armAndPlace(cdp, dist) {
  return cdp.ev(`(function(){
    var g = window.__roamDebug.floorGraph();
    var r = state.rooms[g.stairId];
    if (!r) return { ok: false, err: 'no-stair-room' };
    state.stairs = { x: r.cx, y: r.cy, active: true, bossUnlocked: true, locked: false };
    r.cleared = true;
    /* 跳过"打完首领"的前置：只测距离门槛本身 */
    state.floorCleared = true;
    if (state.boss) state.boss.defeated = true;
    if (state.openFloor) state.openFloor.active = false;
    var tried = 0;
    for (var i = 0; i < 32; i += 1) {
      var a = (Math.PI * 2 / 32) * i;
      var x = r.cx + Math.cos(a) * ${dist};
      var y = r.cy + Math.sin(a) * ${dist};
      /* teleport 内部已经做过 isWalkableCircle 校验，放不进去会返回 false */
      tried += 1;
      if (!window.__roamDebug.teleport(x, y)) continue;
      var d = Math.hypot(state.player.x - r.cx, state.player.y - r.cy);
      return { ok: true, floor: state.floor, stair: { x: r.cx, y: r.cy },
               player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
               actualDist: Math.round(d * 10) / 10, tried: tried };
    }
    return { ok: false, err: 'no-walkable-point', tried: tried };
  })()`);
}

/**
 * 关掉当前打开的全屏弹窗（楼层/奖励/提示卡）
 * 实机玩家也必须先点掉它才能继续操作；探针点第一个可点按钮，保持"真触摸"。
 * @returns {Promise<Object|null>} 点到了什么；没有弹窗返回 null
 */
async function dismissModal(cdp) {
  for (let round = 0; round < 3; round += 1) {
    const act = await cdp.ev(`(function(){
      var m = document.querySelector('#modal');
      if (!m || getComputedStyle(m).display === 'none') return null;
      var btns = m.querySelectorAll('[data-action], button');
      for (var i = 0; i < btns.length; i += 1) {
        var b = btns[i], cs = getComputedStyle(b), r = b.getBoundingClientRect();
        if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) {
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                   act: b.getAttribute('data-action') || String(b.textContent || '').trim().slice(0, 12) };
        }
      }
      return { empty: true, text: String(m.textContent || '').trim().slice(0, 80) };
    })()`);
    if (!act) return null;
    if (!act.x) return act;
    await tap(cdp, act.x, act.y);
    await sleep(500);
  }
  return { closed: true };
}

/** 点一次交互键，返回按前距离 / 楼层变化 / toast */
async function pressDescend(cdp) {
  /* 换层后有一小段像素溶解 / 楼层横幅，mode 或 status 会短暂离开 playing；
     此时按键会被 descendFloor 直接 return false，先把状态等回来再点。 */
  for (let i = 0; i < 50; i += 1) {
    const st = await cdp.ev(`({ mode: state.mode, status: state.status })`);
    if (st.mode === 'playing' && st.status === 'playing') break;
    await sleep(200);
  }
  /* 换层后 #modal 会以楼层提示卡形式打开并吞掉点击，先像玩家一样点掉它 */
  const modalClosed = await dismissModal(cdp);
  /* 传送到位后要等主循环跑一帧，让"靠近楼梯"状态与按钮可用态刷新；
     否则按键看似可点，实际仍是上一帧的禁用态，会被吞掉。 */
  await sleep(450);
  const btn = await cdp.ev(`(function(){
    var b = document.querySelector('[data-act="descend"]');
    if (!b) return null;
    var r = b.getBoundingClientRect();
    var cs = getComputedStyle(b);
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
             w: Math.round(r.width), h: Math.round(r.height),
             visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' };
  })()`);
  if (!btn || !btn.visible) return { ok: false, err: 'no-button', btn: btn };
  const before = await cdp.ev(`({floor: state.floor, mode: state.mode, status: state.status, frozen: !!state.frozen, x: Math.round(state.player.x), y: Math.round(state.player.y), sx: state.stairs.x, sy: state.stairs.y, active: !!state.stairs.active})`);
  const dist = Math.round(Math.hypot(before.x - before.sx, before.y - before.sy) * 10) / 10;
  await tap(cdp, btn.x, btn.y);
  await sleep(1400);
  /* 换层后的楼层横幅会把第一下触摸吃掉（实机也一样，玩家会再点一次）。
     第一下没下楼就补第二下，避免把"被横幅吃掉"误判成"半径不够"。 */
  let taps = 1;
  let after = await cdp.ev(`(function(){
    var t = document.querySelector('#toast, .toast');
    return { floor: state.floor, mode: state.mode, toast: t ? String(t.textContent || '').trim() : null };
  })()`);
  if (after.floor === before.floor) {
    await tap(cdp, btn.x, btn.y);
    taps += 1;
    await sleep(1300);
    after = await cdp.ev(`(function(){
      var t = document.querySelector('#toast, .toast');
      return { floor: state.floor, mode: state.mode, toast: t ? String(t.textContent || '').trim() : null };
    })()`);
  }
  let diag = null;
  let mouseOk = null;
  if (after.floor !== before.floor + 1) {
    /* 近距（<=96）但触摸没反应时，用鼠标点击同一点做对照：
       能下 = 触摸模拟/手势层的问题；不能下 = 游戏逻辑拒绝。 */
    if (dist <= 96) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await sleep(1300);
      mouseOk = (await cdp.ev(`state.floor`)) === before.floor + 1;
    }
    /* 触摸 / 鼠标都没生效时做两件事：
       ① 列出覆盖在按钮上方的高 z-index 固定层（判断是不是被弹窗/横幅挡住）；
       ② 直接调 interactStairs()，区分"逻辑拒绝"还是"点击没打到"。 */
    diag = await cdp.ev(`(function(){
      var m = document.querySelector('#modal');
      var hit = document.elementFromPoint(${btn.x}, ${btn.y});
      var hitBtn = hit && hit.closest ? hit.closest('[data-act]') : null;
      var hitInfo = hit ? { tag: hit.tagName, id: hit.id || '', cls: String(hit.className || '').slice(0, 60),
                             pe: getComputedStyle(hit).pointerEvents,
                             act: hitBtn ? hitBtn.getAttribute('data-act') : null,
                             actDisabled: hitBtn ? hitBtn.className.indexOf('is-off') >= 0 : null } : null;
      var tops = [];
      Array.prototype.forEach.call(document.querySelectorAll('body > div, body > section, body > canvas'), function(el){
        var cs = getComputedStyle(el);
        if (cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden' && (parseInt(cs.zIndex, 10) || 0) > 30) {
          var b = el.getBoundingClientRect();
          tops.push((el.id || el.className || el.tagName) + ' z=' + cs.zIndex + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
        }
      });
      var direct = null;
      try { direct = { ret: interactStairs(), floor: state.floor, mode: state.mode, status: state.status }; }
      catch (e) { direct = { err: String(e && e.message || e) }; }
      return { modal: m ? getComputedStyle(m).display : null, modalPE: m ? getComputedStyle(m).pointerEvents : null,
               hit: hitInfo, tops: tops.slice(0, 8), direct: direct };
    })()`);
  }
  return { ok: after.floor === before.floor + 1, taps: taps, mouseOk: mouseOk, btn: btn, dist: dist, before: before, after: after, diag: diag, modalClosed: modalClosed };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const log = (m) => console.log(m);
  const cdp = await bootEdge();
  const out = { page: PAGE, cases: [] };
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + PAGE.replace(/\\/g, '/') });
    for (let i = 0; i < 80; i += 1) {
      await sleep(250);
      const ok = await cdp.ev(`typeof state !== 'undefined' && !!state && !!state.player`).catch(() => false);
      if (ok) break;
    }
    /* 离开标题页 + 选第一个角色（新档首局必须选角色才会进 playing） */
    if (await cdp.ev(`state.mode`) === 'title') {
      await cdp.ev(`startGame()`);
      await sleep(600);
      if (await cdp.ev(`state.mode`) !== 'playing') {
        await cdp.ev(`(function(){ try { chooseCharacter(CHARACTER_CONFIG.ids[0]); return true; } catch (e) { return String(e && e.message || e); } })()`);
        await sleep(1000);
      }
    }
    out.boot = await cdp.ev(`({ mode: state.mode, floor: state.floor, hp: state.player.hp })`);
    log('[启动] ' + JSON.stringify(out.boot));

    /* 90 / 96 应该能下；97 / 100 应该被拒（判据 d > 96）。
       每次成功下楼后层数 +1，需要在新层重新点亮楼梯。 */
    for (const dist of [90, 95, 96.5, 100]) {
      const arm = await armAndPlace(cdp, dist);
      if (!arm.ok) { out.cases.push({ want: dist, arm: arm, verdict: 'PLACE-FAIL' }); log(`[${dist}] 放点失败 ${JSON.stringify(arm)}`); continue; }
      const r = await pressDescend(cdp);
      const rec = { want: dist, arm: arm, press: r, verdict: r.ok ? 'DESCEND' : 'DENY' };
      out.cases.push(rec);
      log(`[${dist}] 实测距离=${r.dist}px 状态=${r.before ? r.before.mode + '/' + r.before.status : '?'} 楼层=${r.before ? r.before.floor : '?'}→${r.after ? r.after.floor : '?'} toast=「${r.after && r.after.toast || ''}」 → ${rec.verdict}${r.modalClosed ? ' 关弹窗=' + JSON.stringify(r.modalClosed) : ''}${r.mouseOk !== null && r.mouseOk !== undefined ? ' 鼠标对照=' + r.mouseOk : ''}${r.diag ? ' 诊断=' + JSON.stringify(r.diag) : ''}`);
      /* 楼层横幅会在这段时间里吃掉触摸（无头环境动画更慢，实测约 5s），
         等它彻底收起再测下一档 */
      await sleep(6000);
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    fs.writeFileSync(path.join(OUT, 'stairs.jpg'), Buffer.from(shot.data, 'base64'));
    fs.writeFileSync(path.join(OUT, 'stairs.json'), JSON.stringify(out, null, 1));
    log('[产物] ' + OUT);
  } catch (err) {
    out.error = String(err && err.message || err);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'stairs.json'), JSON.stringify(out, null, 1));
    log('[异常] ' + out.error);
    process.exitCode = 1;
  } finally {
    killEdge(cdp.edge);
  }
}

main();
