/**
 * 首玩修复验收探针（只读，验证修复后的 index_arcane_v2.html）
 * ------------------------------------------------------------
 * 对照项：
 *   P0-1 点门：修前 armedUntil=0 / roomId 不变；修后近距点门 armedUntil>0，远距点门有提示。
 *   P0-2 键盘：修前 key='Process'+code='KeyA' 位移 0；修后应 >0；K/F 未解锁应有 toast。
 *   P0-2 可见性：楼层面板新增「进门 / 键位」两行。
 *   P1 融合：凑齐后提示行应为「可融合 · 按 F」，readyGlow 只播 3 次，并弹一次教学 toast。
 *
 * 用法：node tools/firstplay_verify.js
 * 输出：.screenshots/firstplay/verify.json + 截图
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.resolve(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 建连
 * @returns {Promise<Object>} 调试会话
 */
async function connect() {
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 5 && !target; attempt += 1) {
    const port = 10480 + Math.floor(Math.random() * 120);
    const profile = prepareProfile();
    edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !target; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page') || null;
      } catch (e) { /* 等端口 */ }
      if (!target) await sleep(250);
    }
    if (!target) { try { killEdge(edge); } catch (e) { /* 忽略 */ } await sleep(300); }
  }
  if (!target) throw new Error('调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') };
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, shot, events };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot, events } = await connect();
  const report = { steps: {} };

  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(200);
  };
  const readToast = () => ev(`((document.getElementById('toast')||{}).innerText||'').replace(/\\s+/g,' ').trim()`);

  await send('Page.navigate', { url: pathToFileURL(FILE).href });
  for (let i = 0; i < 60; i += 1) {
    const ok = await ev(`(function(){ var t=document.getElementById('titleLayer'); return document.readyState==='complete' && typeof state!=='undefined' && !!t && !t.classList.contains('hidden'); })()`);
    if (ok) break;
    await sleep(200);
  }
  await ev(`document.getElementById('btnStart').click()`);
  await sleep(350);
  await ev(`document.querySelector('#charGrid .char-card').click()`);
  await sleep(200);
  await ev(`document.getElementById('btnCharConfirm').click()`);
  for (let i = 0; i < 40; i += 1) { if ((await ev(`state.mode`)) === 'playing') break; await sleep(100); }
  await sleep(500);

  /* ---------- 首玩修复 · 三步教程 ---------- */
  report.steps.tutorial = {};
  report.steps.tutorial.initial = await ev(`(function(){
    var o=document.getElementById('tutOverlay'); var cs=getComputedStyle(o);
    return { visible: !o.classList.contains('is-hidden') && Number(cs.opacity) > 0.05,
      text: (document.getElementById('tutText')||{}).textContent||'',
      tip: (document.getElementById('tutTip')||{}).textContent||'',
      stepLabel: (document.getElementById('tutStepLabel')||{}).textContent||'',
      stateStep: state.tutorial ? state.tutorial.step : null,
      done: !!(state.tutorial && state.tutorial.done) };
  })()`);
  await shot('79-tutorial-step1.png');

  // 第一步：真实按住 D 移动，位移达标后应自动进入第 2 步
  const tutMove0 = await ev(`({x:state.player.x,y:state.player.y})`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
  await sleep(650);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
  await sleep(200);
  report.steps.tutorial.afterMove = await ev(`(function(){
    return { movedPx: Math.round(Math.hypot(state.player.x - ${tutMove0.x}, state.player.y - ${tutMove0.y}) * 10) / 10,
      moveAcc: state.tutorial ? Math.round(state.tutorial.moveAcc) : null,
      stateStep: state.tutorial ? state.tutorial.step : null,
      text: (document.getElementById('tutText')||{}).textContent||'',
      stepLabel: (document.getElementById('tutStepLabel')||{}).textContent||'' };
  })()`);
  await shot('79b-tutorial-step2.png');

  // 第二步：直接触发击杀钩子（killEnemy 内 state.kills += 1 之后调用），应进入第 3 步
  // 说明：这里不真塞假敌人，避免把起始房误判成已清房而弹出奖励、污染后面的门/输入测试。
  report.steps.tutorial.afterKill = await ev(`(function(){
    try {
      tutorialOnKill();
      return { ok: true, stateStep: state.tutorial ? state.tutorial.step : null,
        text: (document.getElementById('tutText')||{}).textContent||'',
        stepLabel: (document.getElementById('tutStepLabel')||{}).textContent||'' };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  })()`);

  /* ---------- P0-1 可见键位行 ---------- */
  report.steps.helpRows = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.floor-help-row'));
    return rows.map(function(r){ var b=r.querySelector('b'); var cs=getComputedStyle(r);
      return { text:r.innerText.replace(/\\s+/g,' ').trim(), display:cs.display, opacity:cs.opacity,
        visible: cs.display!=='none' && Number(cs.opacity)>0.05 }; });
  })()`);

  /* ---------- P0-1 近距点门 ---------- */
  const door = await ev(`(function(){
    var p=state.player, best=null, bd=1e9;
    (state.doors||[]).forEach(function(d){ if(d.targetRoomId==null||d.targetRoomId<0) return;
      var dd=Math.hypot(d.x-p.x,d.y-p.y); if(dd<bd){bd=dd;best=d;} });
    if(!best) return null;
    var room=state.rooms[state.currentRoomId];
    var cx=room.x+room.w/2, cy=room.y+room.h/2;
    var vx=cx-best.x, vy=cy-best.y, len=Math.hypot(vx,vy)||1;
    state.player.x=best.x+vx/len*55; state.player.y=best.y+vy/len*55;
    state.player.vx=0; state.player.vy=0;
    if(typeof snapCamera==='function') snapCamera();
    var zoom=cameraZoom();
    var cr=document.getElementById('game').getBoundingClientRect();
    return { x:Math.round(best.x), y:Math.round(best.y), targetRoomId:best.targetRoomId,
      screen:{ x:Math.round(cr.x+(best.x-state.cam.x)*zoom), y:Math.round(cr.y+(best.y-state.cam.y)*zoom) },
      player:{ x:Math.round(state.player.x), y:Math.round(state.player.y) } };
  })()`);
  report.steps.door = door;
  if (door) {
    await sleep(250);
    const before = await ev(`({ roomId: state.currentRoomId, armed: Number((state.roomEntry.armedUntil||0).toFixed(2)), toast: (document.getElementById('toast')||{}).innerText||'' })`);
    await clickAt(door.screen.x, door.screen.y);
    const after = await ev(`({ roomId: state.currentRoomId, armed: Number((state.roomEntry.armedUntil||0).toFixed(2)),
      toast: (document.getElementById('toast')||{}).innerText||'' })`);
    report.steps.doorNearClick = { before, after };
    await shot('80-door-click-near.png');
  }

  /* ---------- P0-1 远距点门（应有提示、不应切房） ---------- */
  if (door) {
    // 先等上一次开门的 3s 放行窗口过期，否则会误判成"远距也打开了"
    await sleep(3400);
    const far = await ev(`(function(){
      var p=state.player;
      var best=null, bd=1e9;
      (state.doors||[]).forEach(function(d){ if(d.targetRoomId==null||d.targetRoomId<0) return;
        var dd=Math.hypot(d.x-p.x,d.y-p.y); if(dd<bd){bd=dd;best=d;} });
      if(!best) return null;
      var room=state.rooms[state.currentRoomId];
      var cx=room.x+room.w/2, cy=room.y+room.h/2;
      var vx=cx-best.x, vy=cy-best.y, len=Math.hypot(vx,vy)||1;
      state.player.x=best.x+vx/len*260; state.player.y=best.y+vy/len*260;
      state.player.vx=0; state.player.vy=0;
      if(typeof snapCamera==='function') snapCamera();
      var zoom=cameraZoom();
      var cr=document.getElementById('game').getBoundingClientRect();
      return { dist: Math.round(Math.hypot(best.x-state.player.x,best.y-state.player.y)),
        screen:{ x:Math.round(cr.x+(best.x-state.cam.x)*zoom), y:Math.round(cr.y+(best.y-state.cam.y)*zoom) } };
    })()`);
    await sleep(250);
    await clickAt(far.screen.x, far.screen.y);
    report.steps.doorFarClick = await ev(`({ dist: ${far.dist}, roomId: state.currentRoomId,
      armed: Number((state.roomEntry.armedUntil||0).toFixed(2)),
      toast: (document.getElementById('toast')||{}).innerText||'' })`);
  }

  /* ---------- P0-1 E 键：窗口长度 + 远距失败提示 ---------- */
  /* 说明：这里直接调 tryDoorEntryInteract()，避免 E 键链路上的刻印台 / 商店等
     交互物抢走按键（它们在真实游玩里本来就优先）。 */
  report.steps.eFar = await ev(`(function(){
    var p=state.player, best=null, bd=1e9;
    (state.doors||[]).forEach(function(d){ if(d.targetRoomId==null||d.targetRoomId<0) return;
      var dd=Math.hypot(d.x-p.x,d.y-p.y); if(dd<bd){bd=dd;best=d;} });
    var room=state.rooms[state.currentRoomId];
    var cx=room.x+room.w/2, cy=room.y+room.h/2;
    var vx=cx-best.x, vy=cy-best.y, len=Math.hypot(vx,vy)||1;
    state.player.x=best.x+vx/len*150; state.player.y=best.y+vy/len*150;
    state.player.vx=0; state.player.vy=0; state.roomEntry.armedUntil=0;
    var distPx=Math.round(Math.hypot(best.x-state.player.x,best.y-state.player.y));
    var ret=tryDoorEntryInteract();
    return { dist:distPx, ret:ret, armed:Number((state.roomEntry.armedUntil||0).toFixed(2)),
      toast:(document.getElementById('toast')||{}).innerText||'' };
  })()`);

  /* 近距 E：窗口应等于 armWindow（6s），不再是 3s */
  report.steps.eNear = await ev(`(function(){
    var p=state.player, best=null, bd=1e9;
    (state.doors||[]).forEach(function(d){ if(d.targetRoomId==null||d.targetRoomId<0) return;
      var dd=Math.hypot(d.x-p.x,d.y-p.y); if(dd<bd){bd=dd;best=d;} });
    var room=state.rooms[state.currentRoomId];
    var cx=room.x+room.w/2, cy=room.y+room.h/2;
    var vx=cx-best.x, vy=cy-best.y, len=Math.hypot(vx,vy)||1;
    state.player.x=best.x+vx/len*55; state.player.y=best.y+vy/len*55;
    state.player.vx=0; state.player.vy=0; state.roomEntry.armedUntil=0;
    var before=state.elapsed;
    var ret=tryDoorEntryInteract();
    return { dist:Math.round(Math.hypot(best.x-state.player.x,best.y-state.player.y)),
      ret:ret, armWindow:ROOM_ENTRY.armWindow,
      armedMinusElapsed:Number(((state.roomEntry.armedUntil||0)-before).toFixed(2)),
      toast:(document.getElementById('toast')||{}).innerText||'' };
  })()`);

  /* ---------- P0-2 输入法兜底 ---------- */
  const imeBefore = await ev(`({x:state.player.x,y:state.player.y})`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
  await sleep(450);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
  await sleep(150);
  const imeAfter = await ev(`({x:state.player.x,y:state.player.y,left:!!state.keys.left})`);
  report.steps.ime = { before: imeBefore, after: imeAfter,
    movedPx: Math.round(Math.hypot(imeAfter.x - imeBefore.x, imeAfter.y - imeBefore.y) * 10) / 10 };

  /* ---------- P0-2 未解锁 K / F 反馈 ---------- */
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 });
  await sleep(220);
  const toastK = await readToast();
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 });
  await sleep(220);
  const toastF = await readToast();
  report.steps.lockedToasts = { k: toastK, f: toastF,
    unlocks: await ev(`JSON.parse(JSON.stringify(state.meta.unlocks||{}))`) };

  /* ---------- P1 融合提示 ---------- */
  report.steps.fusion = await ev(`(function(){
    if(!state.meta.unlocks.fusion) unlock('fusion','验收');
    var magic=state.ownedMagic[0];
    var cand=FUSION_CONFIG.find(function(f){ return f.magic===magic && !state.ownedTech.includes(f.tech); });
    if(!cand) return { err:'no-candidate' };
    state.ownedTech.push(cand.tech);
    try { updateFusionHint(); } catch(e) { return { err:'updateFusionHint:'+e.message }; }
    var f=document.getElementById('fusionHint');
    var note=document.getElementById('fusionNote');
    var cs=getComputedStyle(f);
    var r=f.getBoundingClientRect();
    return { fusionId:cand.id, fusionName:cand.name,
      available:(typeof getAvailableFusions==='function')?getAvailableFusions().map(function(x){return x.id;}):null,
      hintClass:f.className, animation:cs.animationName, iteration:cs.animationIterationCount,
      display:cs.display, opacity:cs.opacity,
      rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
      noteText:note?note.innerText.replace(/\\s+/g,' ').trim():'',
      toast:((document.getElementById('toast')||{}).innerText||'').replace(/\\s+/g,' ').trim() };
  })()`);
  await sleep(200);
  await shot('82-fusion-ready.png');
  // 再调一次，确认不会重复弹（toast 已消失后仍保持空）
  await sleep(1800);
  const toastAgain = await readToast();
  await ev(`updateFusionHint()`);
  await sleep(200);
  report.steps.fusion.repeatToast = { before: toastAgain, after: await readToast() };

  /* ---------- 教程第三步：真实 tryFuse 完成并永久收起 ---------- */
  report.steps.tutorial.afterFuse = await ev(`(function(){
    try {
      var ok = tryFuse();
      return { ok: ok,
        stateStep: state.tutorial ? state.tutorial.step : null,
        done: !!(state.tutorial && state.tutorial.done),
        metaDone: state.meta.tutorialDone === true,
        overlayHidden: document.getElementById('tutOverlay').classList.contains('is-hidden'),
        toast: (document.getElementById('toast')||{}).innerText||'' };
    } catch (e) { return { err: String(e && e.message || e) }; }
  })()`);
  await shot('83-tutorial-done.png');

  // 永久收起：再次开局 / 再调 tutorialBegin 都不应重新出现
  report.steps.tutorial.rebegin = await ev(`(function(){
    tutorialBegin();
    var o=document.getElementById('tutOverlay');
    return { visible: !o.classList.contains('is-hidden'), metaDone: state.meta.tutorialDone === true };
  })()`);

  /* ---------- P1 爽感数值 / P2 导航结构 ---------- */
  report.steps.p1 = await ev(`(function(){
    var s0 = (typeof FX_TIER_CONFIG !== 'undefined' && FX_TIER_CONFIG.tiers && FX_TIER_CONFIG.tiers.S0) || {};
    return {
      s0HitStop: s0.hitStop, s0Shake: s0.shake, s0Particles: s0.particles,
      hpScaleF1: ENEMY_BUDGET_CONFIG.rampByFloor[1].hpScale,
      hpScaleF2: ENEMY_BUDGET_CONFIG.rampByFloor[2].hpScale,
      hpScaleF3: ENEMY_BUDGET_CONFIG.rampByFloor[3].hpScale,
      hpScaleF4: ENEMY_BUDGET_CONFIG.rampByFloor[4].hpScale,
      giftCard: OPENING_GIFT_CONFIG.cardId,
      giftDamageMul: OPENING_GIFT_CONFIG.damageMul,
      baseNeed: XP_CONFIG.baseNeed,
      doubleKillReason: fxS2Reason({ kills: 2 })
    };
  })()`);
  report.steps.navigation = await ev(`(function(){
    var normals = { top:[0,-1], bottom:[0,1], left:[-1,0], right:[1,0] };
    var wrong = 0, checked = 0, closePairs = 0, pairs = {};
    (state.doors || []).forEach(function(d){
      var key = d.roomId + ':' + d.side;
      (pairs[key] = pairs[key] || []).push(d);
      if (d.targetRoomId < 0) return;
      checked += 1;
      var r = state.rooms[d.targetRoomId];
      var n = normals[d.side] || [0,1];
      if (!r || (r.cx - d.x) * n[0] + (r.cy - d.y) * n[1] <= 0) wrong += 1;
    });
    Object.keys(pairs).forEach(function(k){
      var a = pairs[k].slice().sort(function(x,y){ return (x.x + x.y) - (y.x + y.y); });
      for (var i = 1; i < a.length; i += 1) {
        if (Math.hypot(a[i].x - a[i-1].x, a[i].y - a[i-1].y) < 64) closePairs += 1;
      }
    });
    return {
      doors: (state.doors || []).length,
      corridorRects: (state.corridorRects || []).length,
      doorsLabelChecked: checked,
      doorsLabelWrongSide: wrong,
      sameWallDoorsWithin64: closePairs,
      spawnSeenRooms: Object.keys((state.fog || {}).seenRooms || {}).length,
      spawnSeenCorridors: Object.keys((state.fog || {}).seenCorridors || {}).length
    };
  })()`);

  /* ---------- P2 指北针：静止 3s 后应出现 ---------- */
  await ev(`(function(){ if(state.player){ state.player.vx=0; state.player.vy=0; } return true; })()`);
  await sleep(3000);
  report.steps.compass = await ev(`(function(){
    var e = document.getElementById('edgeCompass');
    var cs = getComputedStyle(e);
    return { hidden: e.classList.contains('is-hidden'), opacity: cs.opacity,
      left: e.style.left, top: e.style.top,
      label: (document.getElementById('edgeCompassLabel')||{}).textContent||'' };
  })()`);

  /* ---------- 控制台 ---------- */
  report.consoleErrors = events.filter((m) => m.method === 'Runtime.exceptionThrown'
    || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    || (m.method === 'Log.entryAdded' && m.params.entry.level === 'error'))
    .map((m) => m.method === 'Runtime.exceptionThrown'
      ? 'EXC: ' + (m.params.exceptionDetails.text || '')
      : (m.method === 'Log.entryAdded' ? 'ERR: ' + m.params.entry.text
        : 'CONSOLE: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ')));

  fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  try { ws.close(); } catch (e) { /* 已关闭 */ }
  killEdge(edge);
}

main().catch((e) => { console.error('FAILED', e && e.stack || e); process.exitCode = 1; });
