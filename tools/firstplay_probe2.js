/**
 * 首玩复现探针 2（只读）
 * ------------------------------------------------------------
 * 专查两件事：
 *   1) 「选房选不了 / 不跳转」：门禁、点击、E 放行、真正跨房；
 *   2) 融合解锁前/后的界面提示 + 迷雾 alpha 剖面（换一块已探索房的边界采样）。
 *
 * 仍然只做真实点击 / 真实按键 / 只读快照，不改源码。
 * 输出：.screenshots/firstplay/report2.json
 * 用法：node tools/firstplay_probe2.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.resolve(__dirname, '..', 'delivery', '烬-奥术工程师-试玩版.html');
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动并连上调试端口
 * @returns {Promise<{edge:any, ws:WebSocket, send:Function, ev:Function, shot:Function}>} 会话
 */
async function connect() {
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 5 && !target; attempt += 1) {
    const port = 9960 + Math.floor(Math.random() * 120);
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
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');

  /**
   * 页面求值
   * @param {string} expression JS 表达式
   * @returns {Promise<any>} 可序列化结果
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') };
    return r.result.value;
  };
  /**
   * 截图
   * @param {string} name 文件名
   * @param {Object} [clip] 可选裁剪（原尺寸 1:1）
   * @returns {Promise<void>}
   */
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip: Object.assign({ scale: 1 }, clip) } : {}));
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, shot };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot } = await connect();
  const report = { steps: {} };

  /**
   * 真实鼠标点（含移动/按下/抬起），会触发焦点与 canvas 的点击施法
   * @param {number} x 屏幕 x
   * @param {number} y 屏幕 y
   * @returns {Promise<void>}
   */
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(150);
  };

  /**
   * 按住一组键一段时间（移动用）
   * @param {string[]} keys 键名数组（w/a/s/d）
   * @param {number} ms 按住时长
   * @returns {Promise<void>}
   */
  const holdKeys = async (keys, ms) => {
    const map = { w: 87, a: 65, s: 83, d: 68 };
    for (const k of keys) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: map[k], nativeVirtualKeyCode: map[k] });
    }
    await sleep(ms);
    for (const k of keys) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: map[k], nativeVirtualKeyCode: map[k] });
    }
    await sleep(120);
  };

  /* 打开并进入 playing（真实点击路径） */
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

  /* ---------- 1. 键盘里被"点亮"却没反应的键 ---------- */
  /**
   * 读 toast 原文（用于判断按键有没有反馈）
   * @returns {Promise<string>} toast 文本
   */
  const toastText = () => ev(`((document.getElementById('toast')||{}).innerText||'').replace(/\\s+/g,' ').trim()`);
  const tBeforeK = await toastText();
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 });
  await sleep(250);
  const tAfterK = await toastText();
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 });
  await sleep(250);
  const tAfterF = await toastText();
  report.steps.lockedKeys = await ev(`({ device: !!state.meta.unlocks.device, fusion: !!state.meta.unlocks.fusion,
      overdrive: !!state.meta.unlocks.overdrive, parallel: !!state.meta.unlocks.parallel,
      techCount: (state.ownedTech||[]).length, magicCount: (state.ownedMagic||[]).length })`);
  report.steps.lockedKeys.toast = { beforeK: tBeforeK, afterK: tAfterK, afterF: tAfterF };

  /* ---------- 2. 门禁：点门 vs 按 E vs 走过去 ---------- */
  const doorInfo = await ev(`(function(){
    if (!state.doors || !state.doors.length) return { err:'no-doors' };
    var p=state.player, best=null, bd=1e9;
    state.doors.forEach(function(d){
      if (d.targetRoomId == null || d.targetRoomId < 0) return;
      var dd=Math.hypot(d.x-p.x,d.y-p.y); if(dd<bd){bd=dd;best=d;}
    });
    if(!best) return { err:'no-valid-door' };
    var zoom=(typeof cameraZoom==='function')?cameraZoom():1;
    var c=document.getElementById('game'); var cr=c.getBoundingClientRect();
    return {
      door:{ x:Math.round(best.x), y:Math.round(best.y), side:best.side, targetRoomId:best.targetRoomId,
             roomId:best.roomId, closed:!!best.closed },
      player:{ x:Math.round(p.x), y:Math.round(p.y) },
      dist:Math.round(bd), currentRoomId:state.currentRoomId,
      targetRoom: (function(){ var r=state.rooms[best.targetRoomId]; return r?{x:Math.round(r.x+r.w/2),y:Math.round(r.y+r.h/2)}:null; })(),
      screen:{ x: Math.round(cr.x + (best.x - state.cam.x)*zoom),
               y: Math.round(cr.y + (best.y - state.cam.y)*zoom) },
      entry: JSON.parse(JSON.stringify(state.roomEntry||{}))
    };
  })()`);
  report.steps.door = doorInfo;

  if (doorInfo && doorInfo.door && !doorInfo.err) {
    // 2a. 把玩家放到门内侧 36px（沿门法线朝房间里），不按 E
    await ev(`(function(){
      var d=${JSON.stringify(doorInfo.door)};
      var room=state.rooms[state.currentRoomId];
      var cx=room.x+room.w/2, cy=room.y+room.h/2;
      var vx=cx-d.x, vy=cy-d.y, len=Math.hypot(vx,vy)||1;
      state.player.x=d.x+vx/len*36; state.player.y=d.y+vy/len*36;
      state.player.vx=0; state.player.vy=0;
      if(typeof snapCamera==='function') snapCamera();
      return {x:state.player.x,y:state.player.y};
    })()`);
    await sleep(300);
    const beforeClick = await ev(`({ roomId: state.currentRoomId, armed: state.roomEntry.armedUntil })`);
    // 2b. 真实点击门所在屏幕位置（新人最直觉的动作）
    await clickAt(doorInfo.screen.x, doorInfo.screen.y);
    await sleep(350);
    report.steps.door.afterClick = await ev(`({ roomId: state.currentRoomId, mode: state.mode,
      armed: state.roomEntry.armedUntil, player:{x:Math.round(state.player.x),y:Math.round(state.player.y)} })`);
    report.steps.door.afterClick.before = beforeClick;
    // 2c. 按 E → 看放行窗口
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 });
    await sleep(200);
    report.steps.door.afterE = await ev(`({ roomId: state.currentRoomId, elapsed: Number(state.elapsed.toFixed(2)),
      armedUntil: Number((state.roomEntry.armedUntil||0).toFixed(2)), armedRoomId: state.roomEntry.armedRoomId })`);
    // 2d. 朝门的方向按住方向键走出房间
    const keys = [];
    if (doorInfo.door.side === 'left') keys.push('a'); else if (doorInfo.door.side === 'right') keys.push('d');
    else if (doorInfo.door.side === 'top') keys.push('w'); else keys.push('s');
    await holdKeys(keys, 1600);
    report.steps.door.afterWalk = await ev(`({ roomId: state.currentRoomId, mode: state.mode,
      player:{x:Math.round(state.player.x),y:Math.round(state.player.y)},
      armedUntil: Number((state.roomEntry.armedUntil||0).toFixed(2)) })`);
    await shot('50-door-after-walk.png');
  }

  /* ---------- 3. 融合解锁前 ---------- */
  report.steps.fusionBefore = await ev(`(function(){
    var h=document.getElementById('fusionHint'), n=document.getElementById('fusionNote');
    var vis=h?getComputedStyle(h):null, r=h?h.getBoundingClientRect():null;
    return { unlocked: !!state.meta.unlocks.fusion, available: (typeof getAvailableFusions==='function')?getAvailableFusions().length:null,
      hintVisible: !!h && vis.display!=='none' && Number(vis.opacity)>0.05 && r.width>1,
      hintText: h?h.innerText.replace(/\\s+/g,' ').trim():'', noteText: n?n.innerText.replace(/\\s+/g,' ').trim():'' };
  })()`);
  await shot('20-fusion-before.png');

  /* ---------- 4. 清房 → 融合解锁？三选一？ ---------- */
  await ev(`window.__roamDebug.killAllEnemies()`);
  await sleep(1500);
  report.steps.afterClear = await ev(`(function(){
    var h=document.getElementById('fusionHint'), n=document.getElementById('fusionNote');
    var vis=h?getComputedStyle(h):null, r=h?h.getBoundingClientRect():null;
    var rew=document.getElementById('rewardLayer');
    return { mode: state.mode, floorCleared: !!state.floorCleared, stairsActive: !!(state.stairs&&state.stairs.active),
      unlocked: !!state.meta.unlocks.fusion,
      available: (typeof getAvailableFusions==='function')?getAvailableFusions().map(function(f){return f.id;}):null,
      hintVisible: !!h && vis.display!=='none' && Number(vis.opacity)>0.05 && r.width>1,
      hintText: h?h.innerText.replace(/\\s+/g,' ').trim():'',
      noteText: n?n.innerText.replace(/\\s+/g,' ').trim():'',
      rewardOpen: !!rew && !rew.classList.contains('hidden'),
      toast: ((document.getElementById('toast')||{}).innerText||'').replace(/\\s+/g,' ').trim() };
  })()`);
  await shot('21-after-clear.png');

  /* 关掉三选一（按 1），再看融合提示是否常驻 */
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, nativeVirtualKeyCode: 49 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, nativeVirtualKeyCode: 49 });
  await sleep(700);
  report.steps.fusionAfter = await ev(`(function(){
    var h=document.getElementById('fusionHint');
    var vis=h?getComputedStyle(h):null, r=h?h.getBoundingClientRect():null;
    return { mode: state.mode, unlocked: !!state.meta.unlocks.fusion,
      hintVisible: !!h && vis.display!=='none' && Number(vis.opacity)>0.05 && r.width>1,
      hintText: h?h.innerText.replace(/\\s+/g,' ').trim():'',
      noteText: ((document.getElementById('fusionNote')||{}).innerText||'').replace(/\\s+/g,' ').trim() };
  })()`);
  await shot('22-fusion-after.png');

  /* ---------- 5. 楼梯：站在楼梯上按 E 是否真的下一层 ---------- */
  report.steps.stairs = await ev(`(function(){
    if(!state.stairs) return { err:'no-stairs' };
    var s=state.stairs, p=state.player;
    p.x=s.x; p.y=s.y; p.vx=0; p.vy=0;
    if(typeof snapCamera==='function') snapCamera();
    return { beforeFloor: state.floor, stairs:{x:Math.round(s.x),y:Math.round(s.y),active:!!s.active},
      floorCleared: !!state.floorCleared };
  })()`);
  await sleep(250);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 });
  await sleep(1200);
  report.steps.stairs.afterE = await ev(`({ floor: state.floor, mode: state.mode,
    toast: ((document.getElementById('toast')||{}).innerText||'').replace(/\\s+/g,' ').trim() })`);
  await shot('60-stairs.png');

  /* ---------- 6. 迷雾 alpha 剖面：采样"已探索房"的上边界 ---------- */
  report.steps.fog = await ev(`(function(){
    if (typeof fogCtx === 'undefined' || !fogCtx) return { err:'no-fog-ctx' };
    var fs=(typeof fogScaleFactor!=='undefined')?fogScaleFactor:1;
    var seen=null;
    for (var i=0;i<state.rooms.length;i+=1){ var r=state.rooms[i];
      if (state.fog.seenRooms[r.id] && r.y>60) { seen=r; break; } }
    if(!seen) return { err:'no-seen-room' };
    var cx=Math.round((seen.x+seen.w/2)*fs);
    var y0=Math.round((seen.y-30)*fs), y1=Math.round((seen.y+30)*fs);
    var img=fogCtx.getImageData(cx,y0,1,Math.max(2,y1-y0));
    var a=[]; for(var j=0;j<img.data.length;j+=4) a.push(img.data[j+3]);
    var mx=0, at=-1; for(var k=1;k<a.length;k+=1){ var d=Math.abs(a[k]-a[k-1]); if(d>mx){mx=d;at=k;} }
    return { room:{id:seen.id,x:Math.round(seen.x),y:Math.round(seen.y),w:Math.round(seen.w),h:Math.round(seen.h)},
      feather:FOG_CONFIG.feather, secondPass:FOG_CONFIG.secondPass, fogScaleFactor:fs,
      worldW:fogWorldW, worldH:fogWorldH,
      alphaProfile:a, maxAdjacentStep:mx, stepIndex:at,
      screenStepPx: (typeof cameraZoom==='function') ? Number((mx/255*FOG_CONFIG.feather*cameraZoom()).toFixed(2)) : null };
  })()`);
  if (report.steps.fog && report.steps.fog.room) {
    const r = report.steps.fog.room;
    const zoom = await ev(`(typeof cameraZoom==='function')?cameraZoom():1`);
    const cam = await ev(`({x:state.cam.x,y:state.cam.y})`);
    const canvasRect = await ev(`(function(){var c=document.getElementById('game').getBoundingClientRect();return {x:c.x,y:c.y};})()`);
    const clip = {
      x: Math.max(0, Math.round(canvasRect.x + (r.x + r.w / 2 - cam.x) * zoom - 180)),
      y: Math.max(0, Math.round(canvasRect.y + (r.y - cam.y) * zoom - 90)),
      width: 360, height: 180
    };
    await shot('32-fog-edge-1to1.png', clip);
    report.steps.fog.crop = clip;
  }

  fs.writeFileSync(path.join(OUT, 'report2.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  try { ws.close(); } catch (e) { /* 已关闭 */ }
  killEdge(edge);
}

main().catch((e) => { console.error('FAILED', e && e.stack || e); process.exitCode = 1; });
