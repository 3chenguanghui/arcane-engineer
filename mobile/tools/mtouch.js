/**
 * 触控闭环验证（工作副本专用）
 * ------------------------------------------------------------
 * 验证四件事，全部给出数字：
 *   1) 每个触控目标的实际 CSS 尺寸（是否 ≥44×44）；
 *   2) 摇杆是否在拇指可及区（离屏幕左下角距离 / 是否完整在屏内）；
 *   3) 真实触摸拖动摇杆后，state.touch 轴与角色坐标是否变化；松手是否归零；
 *   4) 技能键连点 10 次，登记了几次输入、真正放出几次技能（受冷却限制）。
 * 另外专门验证投诉点：提示"摇杆移动"出现时，摇杆是否同时在屏幕上。
 * 用法：node mobile/tools/mtouch.js [--force]
 * 产物：mobile/shots/touch.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_touch');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9563;
const SNAP = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const OUT_DIR = path.join(MOBILE_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 Edge 并返回 CDP 封装
 * @returns {Promise<{send:Function, ev:Function, close:Function}>}
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/**
 * 触摸按下 / 移动 / 抬起
 * @param {Object} cdp CDP
 * @param {'touchStart'|'touchMove'|'touchEnd'} type 类型
 * @param {number} x CSS x
 * @param {number} y CSS y
 * @returns {Promise<void>}
 */
async function touch(cdp, type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }]
  });
}

/** 主流程 */
async function main() {
  if (!process.argv.includes('--force')) {
    const cpu = Number(require('child_process').execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"', { encoding: 'utf8' }).trim()) || 0;
    if (cpu >= 60) { console.log(`CPU=${cpu}% 高负载，加 --force 继续`); process.exitCode = 3; return; }
  }
  const bytes = fs.statSync(SNAP).size;
  const md5 = require('crypto').createHash('md5').update(fs.readFileSync(SNAP)).digest('hex').toUpperCase();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { snapshot: { bytes, md5 }, viewport: '844x390 dpr3', steps: {} };

  const cdp = await bootEdge();
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Page.navigate', { url: 'file:///' + SNAP.replace(/\\/g, '/') + '?touchtest=1' });
    for (let i = 0; i < 100; i += 1) {
      if (await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`)) break;
      await sleep(200);
    }
    await sleep(800);
    await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
    await sleep(500);
    if (!(await cdp.ev(`state.mode === 'playing'`))) {
      await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
    }
    for (let i = 0; i < 80; i += 1) {
      if (await cdp.ev(`state.mode === 'playing'`)) break;
      await sleep(200);
    }
    /* 0) 卡住"摇杆移动"提示出现的那一刻，证明摇杆同时在场（本次投诉的核心） */
    /* 老档可能已跳过教学；触屏文案也要显式切到触控版，否则提示会写成"WASD 移动" */
    await cdp.ev(`(function(){
      try{state.onboardSkipAll=false;}catch(e){}
      try{state.meta.hintsSeen=0;}catch(e){}
      try{state.elapsed=0;}catch(e){}
      try{if(typeof applyTouchUi==='function')applyTouchUi();}catch(e){}
      return true;
    })()`);
    out.steps.touchUiClass = await cdp.ev(`document.body.className`);
    let hintMoment = null;
    let firstHint = null;
    let hintShot = false;
    for (let i = 0; i < 100; i += 1) {
      const h = await cdp.ev(`(function(){
        var h=document.getElementById('contextHint');
        if(!h) return {text:'',visible:false};
        var cs=getComputedStyle(h);var r=h.getBoundingClientRect();
        return {text:(h.innerText||'').replace(/\\s+/g,' ').trim(),
                visible:!h.classList.contains('hidden')&&parseFloat(cs.opacity)>0.05&&r.width>0,
                rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
      })()`);
      if (h.visible && h.text && !firstHint) firstHint = { atSec: Math.round(i * 0.1 * 10) / 10, text: h.text.slice(0, 60) };
      if (h.visible && /摇杆/.test(h.text)) {
        const stickOn = await cdp.ev(`(function(){var s=document.getElementById('arcmStick');var r=s.getBoundingClientRect();return getComputedStyle(s).display!=='none'&&r.width>0;})()`);
        hintMoment = { atSec: Math.round(i * 0.1 * 10) / 10, text: h.text.slice(0, 60), hintVisible: true, stickVisible: stickOn, hintRect: h.rect };
        if (!hintShot) {
          const s = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
          fs.writeFileSync(path.join(OUT_DIR, 'touch_hint.jpg'), Buffer.from(s.data, 'base64'));
          hintShot = true;
        }
        break;
      }
      await sleep(100);
    }
    out.steps.hintMoment = hintMoment || { hintVisible: false, note: '10 秒内未捕捉到含"摇杆"的提示', firstVisibleHint: firstHint };
    await sleep(600);

    /* 1) 触控目标尺寸 */
    out.steps.targets = await cdp.ev(`(function(){
      function r(el){var b=el.getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height),label:(el.getAttribute('aria-label')||el.innerText||'').trim().slice(0,8)};}
      var list=[];
      document.querySelectorAll('#arcmPad .arcm-act').forEach(function(b){list.push(r(b));});
      ['arcmStick','arcmDeckBtn','btnMapDock','ashBurnBtn'].forEach(function(id){var e=document.getElementById(id);if(e&&getComputedStyle(e).display!=='none')list.push(r(e));});
      document.querySelectorAll('.hud-top .hud-actions .btn').forEach(function(b){list.push(r(b));});
      var bad=list.filter(function(t){return t.w<44||t.h<44;});
      return {count:list.length, minSide:list.reduce(function(m,t){return Math.min(m,t.w,t.h);},999), tooSmall:bad, all:list};
    })()`);

    /* 2) 摇杆可达性 */
    out.steps.reach = await cdp.ev(`(function(){
      var b=document.getElementById('arcmStick').getBoundingClientRect();
      var cx=b.left+b.width/2, cy=b.top+b.height/2;
      var dl=Math.sqrt(cx*cx+(innerHeight-cy)*(innerHeight-cy));
      return {cx:Math.round(cx),cy:Math.round(cy),bottomGap:Math.round(innerHeight-b.bottom),leftGap:Math.round(b.left),
              insideScreen:(b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight),
              cornerDist:Math.round(dl), thumbReach: dl<=160};
    })()`);

    /* 投诉点：提示"摇杆移动"出现时，摇杆是否同时可见 */
    out.steps.hintVsStick = await cdp.ev(`(function(){
      var hint=document.getElementById('onboardHint');
      var stick=document.getElementById('arcmStick');
      var hs=hint?getComputedStyle(hint):null;
      var ss=getComputedStyle(stick);
      var sr=stick.getBoundingClientRect();
      return {
        hintText:(hint?hint.innerText:'').replace(/\\s+/g,' ').trim().slice(0,40),
        hintVisible:!!(hs&&hs.display!=='none'&&hs.visibility!=='hidden'&&parseFloat(hs.opacity)>0.05),
        stickVisible:ss.display!=='none'&&sr.width>0,
        stickRect:{x:Math.round(sr.x),y:Math.round(sr.y),w:Math.round(sr.width),h:Math.round(sr.height)}
      };
    })()`);

    /* 3) 真实拖动摇杆 */
    const stickBox = await cdp.ev(`(function(){var b=document.getElementById('arcmStick').getBoundingClientRect();return {cx:b.left+b.width/2,cy:b.top+b.height/2};})()`);
    const before = await cdp.ev(`(function(){return {px:state.player.x,py:state.player.y,axisX:state.touch.axisX,axisY:state.touch.axisY};})()`);
    await touch(cdp, 'touchStart', stickBox.cx, stickBox.cy);
    await sleep(80);
    await touch(cdp, 'touchMove', stickBox.cx, stickBox.cy - 44);
    await sleep(900);
    const during = await cdp.ev(`(function(){return {px:state.player.x,py:state.player.y,axisX:state.touch.axisX,axisY:state.touch.axisY,moveId:state.touch.moveId};})()`);
    await touch(cdp, 'touchEnd', 0, 0);
    await sleep(300);
    const after = await cdp.ev(`(function(){return {px:state.player.x,py:state.player.y,axisX:state.touch.axisX,axisY:state.touch.axisY,moveId:state.touch.moveId};})()`);
    out.steps.stickDrag = {
      before, during, after,
      movedPx: Math.round(Math.hypot(during.px - before.px, during.py - before.py) * 10) / 10,
      axisAfterReleaseZero: after.axisX === 0 && after.axisY === 0 && after.moveId === null
    };

    /* 4) 连点 10 次主技能 */
    const btnBox = await cdp.ev(`(function(){var b=document.querySelector('.arcm-act[data-act="primary"]').getBoundingClientRect();return {cx:b.left+b.width/2,cy:b.top+b.height/2};})()`);
    const p0 = await cdp.ev(`(function(){return {presses:window.__arcm.info().presses, casts:window.__arcm.info().casts, aether:state.aether, cd:(state.cooldowns&&state.cooldowns[state.activeMagicId])||0, mode:state.mode};})()`);
    let hits = 0;
    for (let i = 0; i < 10; i += 1) {
      await touch(cdp, 'touchStart', btnBox.cx, btnBox.cy);
      await sleep(45);
      await touch(cdp, 'touchEnd', 0, 0);
      await sleep(145);
      const now = await cdp.ev(`window.__arcm.info().presses`);
      if (now > p0.presses + i) hits += 1;
    }
    const p1 = await cdp.ev(`(function(){return {presses:window.__arcm.info().presses, casts:window.__arcm.info().casts, aether:state.aether, cd:(state.cooldowns&&state.cooldowns[state.activeMagicId])||0, mode:state.mode};})()`);
    out.steps.tenTaps = { taps: 10, registered: hits, pressesDelta: p1.presses - p0.presses, castsDelta: p1.casts - p0.casts,
                          aetherBefore: p0.aether, aetherAfter: p1.aether, cooldownAfter: p1.cd };

    /* 5) 卡组开合 */
    await cdp.ev(`document.getElementById('arcmDeckBtn').click(); true`);
    await sleep(250);
    out.steps.deckOpen = await cdp.ev(`(function(){var d=document.querySelector('.hud-deck');var r=d.getBoundingClientRect();return {open:d.classList.contains('arcm-open'),visible:getComputedStyle(d).display!=='none',rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};})()`);
    await cdp.ev(`document.getElementById('arcmDeckBtn').click(); true`);
    await sleep(200);
    out.steps.deckClosed = await cdp.ev(`document.querySelector('.hud-deck').classList.contains('arcm-open')`);

    /* 截图：拖动后 + 卡组打开 */
    await cdp.ev(`document.getElementById('arcmDeckBtn').click(); true`);
    await sleep(300);
    let shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    fs.writeFileSync(path.join(OUT_DIR, 'touch_deck.jpg'), Buffer.from(shot.data, 'base64'));
    await cdp.ev(`document.getElementById('arcmDeckBtn').click(); true`);
  } finally {
    cdp.close();
  }
  fs.writeFileSync(path.join(OUT_DIR, 'touch.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.steps.targets, null, 1));
  console.log('reach:', JSON.stringify(out.steps.reach));
  console.log('hintMoment:', JSON.stringify(out.steps.hintMoment));
  console.log('stickDrag:', JSON.stringify({ movedPx: out.steps.stickDrag.movedPx, axisAfterReleaseZero: out.steps.stickDrag.axisAfterReleaseZero, duringAxis: { x: out.steps.stickDrag.during.axisX, y: out.steps.stickDrag.during.axisY } }));
  console.log('tenTaps:', JSON.stringify(out.steps.tenTaps));
  console.log('deckOpen:', JSON.stringify(out.steps.deckOpen), 'closed:', out.steps.deckClosed);
  console.log('已写出 shots/touch.json');
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exit(1);
});
