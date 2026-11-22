/**
 * 端到端前置探针：验证"摇杆推动 → 角色真的位移"与"技能键 → 敌人真的掉血"
 * 只读状态、不改数值，用于定位 me2e.js 战斗阶段为什么推进缓慢。
 * 用法：node mobile/tools/_e2e_probe.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_probe');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9571;
const SNAP = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并返回最小 CDP 封装
 * @returns {Promise<Object>} { send, ev, shot, close }
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 240));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    fs.writeFileSync(path.join(MOBILE_DIR, 'shots', name), Buffer.from(r.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/** 单指触摸按下 / 移动 / 抬起 */
async function touch(cdp, type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }]
  });
}

/**
 * 摇杆按住不放，期间连续发 touchMove（模拟真人手指持续按压）
 * @param {Object} cdp CDP
 * @param {{cx:number,cy:number}} stick 摇杆中心
 * @param {number} dx 方向 x
 * @param {number} dy 方向 y
 * @param {number} holdMs 按压时长
 * @returns {Promise<void>}
 */
async function holdStick(cdp, stick, dx, dy, holdMs) {
  const len = Math.hypot(dx, dy) || 1;
  const tx = stick.cx + (dx / len) * 38;
  const ty = stick.cy + (dy / len) * 38;
  await touch(cdp, 'touchStart', stick.cx, stick.cy);
  await sleep(60);
  const t0 = Date.now();
  while (Date.now() - t0 < holdMs) {
    await touch(cdp, 'touchMove', tx, ty);
    await sleep(60);
  }
  await touch(cdp, 'touchEnd');
}

/**
 * 主流程
 */
async function main() {
  const cdp = await bootEdge();
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + SNAP.replace(/\\/g, '/') + '?probe=1' });
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
    await sleep(4600);

    const env = await cdp.ev(`({
      mode: state.mode, px: state.player.x, py: state.player.y,
      speed: state.player.speed || null,
      touch: JSON.parse(JSON.stringify(state.touch)),
      casts: state.casts || 0,
      stickRect: (function(){var r=document.getElementById('arcmStick').getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height};})(),
      hasTouchLayer: document.body.classList.contains('arcm-on'),
      touchEnabled: typeof touchEnabled === 'function' ? touchEnabled() : null
    })`);
    console.log('[环境]', JSON.stringify(env));

    /* 朝最近敌人的方向每 20px 采一格，看"谁在报挡住" */
    const probe = await cdp.ev(`(function(){
      var s=state,p=s.player,r=null,bd=1e9;
      for(var i=0;i<s.enemies.length;i++){var e=s.enemies[i];if(!e||e.hp<=0)continue;var d=Math.hypot(e.x-p.x,e.y-p.y);if(d<bd){bd=d;r=e;}}
      var dx=(r.x-p.x)/bd, dy=(r.y-p.y)/bd, out=[];
      for(var k=1;k<=18;k++){
        var x=p.x+dx*20*k, y=p.y+dy*20*k;
        out.push({k:k,x:Math.round(x),y:Math.round(y),
          blocked12:isWalkBlocked(x,y,12),
          blocked2:isWalkBlocked(x,y,2),
          walkCircle:isWalkableCircle(x,y,12),
          point:isPointWalkable(x,y),
          roomBlock:roomEntryBlocksMove(p.x,p.y,x,y,p.radius)});
      }
      return {p:{x:Math.round(p.x),y:Math.round(p.y),r:p.radius}, enemy:{x:Math.round(r.x),y:Math.round(r.y),d:Math.round(bd)}, ray:out};
    })()`);
    console.log('[视线探针]', JSON.stringify(probe, null, 0));
    await cdp.shot('probe_nav.jpg');

    /* 2) 点火 6 次，看消耗 / 冷却 / dual 计数 */
    const fire = await cdp.ev(`(function(){var r=document.querySelector('[data-act="primary"]').getBoundingClientRect();var el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {cx:r.left+r.width/2,cy:r.top+r.height/2,top:el?el.tagName+'.'+(el.className||''):null};})()`);
    console.log('[火球键]', JSON.stringify(fire));
    for (let i = 0; i < 6; i += 1) {
      await touch(cdp, 'touchStart', fire.cx, fire.cy);
      await sleep(60);
      await touch(cdp, 'touchEnd');
      await sleep(420);
      const st = await cdp.ev(`({aether:Math.round(state.player.aether), cd:JSON.parse(JSON.stringify(state.cooldowns)), dualCasts:(state.dual&&state.dual.stats)?state.dual.stats.casts:null, touchCasts:TOUCH_STATS.casts, presses:(document.getElementById('arcmPad')?1:0)})`);
      console.log(`[点火#${i + 1}]`, JSON.stringify(st));
    }
    await cdp.shot('probe_state.jpg');
  } finally {
    cdp.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
