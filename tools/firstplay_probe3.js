/**
 * 首玩复现探针 3（只读）
 * ------------------------------------------------------------
 * 专查：
 *   1) 标题页按键是否完全无响应（"快捷键不行"的第一现场）；
 *   2) HUD 是否处于 compact、融合提示到底看不看得见；
 *   3) 注入一张与已有魔法配对的科技 → 融合提示的真实表现（是否一直呼吸/闪烁）；
 *   4) 迷雾"硬边"到底在不在雾层：读渲染画布的亮度剖面 + 1:1 裁剪；
 *   5) 门的目标房里有多少是"已经走过的"（回答"跳转回到走过的房间"）。
 *
 * 只读 + 真实按键；注入科技只用于观察 UI，不写存档。
 * 输出：.screenshots/firstplay/report3.json
 * 用法：node tools/firstplay_probe3.js
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
 * 建连
 * @returns {Promise<Object>} 调试会话
 */
async function connect() {
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 5 && !target; attempt += 1) {
    const port = 10080 + Math.floor(Math.random() * 120);
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
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') };
    return r.result.value;
  };
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
   * 发一次普通键（按下+抬起）
   * @param {string} key 逻辑键名
   * @param {string} code 物理键码
   * @param {number} vk 虚拟键码
   * @returns {Promise<void>}
   */
  const tap = async (key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(120);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(120);
  };

  await send('Page.navigate', { url: pathToFileURL(FILE).href });
  for (let i = 0; i < 60; i += 1) {
    const ok = await ev(`(function(){ var t=document.getElementById('titleLayer'); return document.readyState==='complete' && typeof state!=='undefined' && !!t && !t.classList.contains('hidden'); })()`);
    if (ok) break;
    await sleep(200);
  }

  /* ---------- 1. 标题页：按 A / W 有没有任何反应 ---------- */
  const titleBefore = await ev(`({ mode: state.mode, keys: JSON.parse(JSON.stringify(state.keys||{})),
    bodyClass: document.body.className, active: document.activeElement ? (document.activeElement.id||document.activeElement.tagName) : 'none' })`);
  await tap('a', 'KeyA', 65);
  await tap('w', 'KeyW', 87);
  const titleAfter = await ev(`({ mode: state.mode, keys: JSON.parse(JSON.stringify(state.keys||{})),
    player: state.player ? { x: Math.round(state.player.x), y: Math.round(state.player.y) } : null })`);
  report.steps.titleKeys = { before: titleBefore, after: titleAfter };
  await shot('70-title-keys.png');

  /* ---------- 2. 进入 playing ---------- */
  await ev(`document.getElementById('btnStart').click()`);
  await sleep(350);
  await ev(`document.querySelector('#charGrid .char-card').click()`);
  await sleep(200);
  await ev(`document.getElementById('btnCharConfirm').click()`);
  for (let i = 0; i < 40; i += 1) { if ((await ev(`state.mode`)) === 'playing') break; await sleep(100); }
  await sleep(600);

  /* ---------- 3. HUD / 融合提示到底在哪 ---------- */
  report.steps.hud = await ev(`(function(){
    var f=document.getElementById('fusionHint'), d=document.getElementById('deck'), fb=document.getElementById('fusionBar');
    var fs=f?getComputedStyle(f):null, ds=d?getComputedStyle(d):null;
    var fr=f?f.getBoundingClientRect():null, dr=d?d.getBoundingClientRect():null;
    return { bodyClass: document.body.className, innerWidth: innerWidth, innerHeight: innerHeight,
      deck: d?{ display:ds.display, opacity:ds.opacity, rect:{x:Math.round(dr.x),y:Math.round(dr.y),w:Math.round(dr.width),h:Math.round(dr.height)} } : null,
      fusionHint: f?{ display:fs.display, opacity:fs.opacity, visibility:fs.visibility,
        rect:{x:Math.round(fr.x),y:Math.round(fr.y),w:Math.round(fr.width),h:Math.round(fr.height)},
        className:f.className, animation:fs.animationName, text:f.innerText.replace(/\\s+/g,' ').trim() } : null,
      fusionBar: fb?{ text:fb.innerText.replace(/\\s+/g,' ').trim(), display:getComputedStyle(fb).display } : null };
  })()`);

  /* ---------- 4. 注入配对科技 → 看"可融合"提示 ---------- */
  report.steps.fusionInject = await ev(`(function(){
    var magic = state.ownedMagic[0];
    var cand = (typeof FUSION_CONFIG!=='undefined') ? FUSION_CONFIG.find(function(f){ return f.magic===magic && !state.ownedTech.includes(f.tech); }) : null;
    if(!cand) return { err:'no-candidate', magic:magic };
    state.ownedTech.push(cand.tech);
    if(state.meta.unlocks) state.meta.unlocks.fusion = true;
    try { renderDeck(); } catch(e) {}
    try { updateFusionHint(); } catch(e) {}
    try { renderFusionBar(); } catch(e) {}
    var f=document.getElementById('fusionHint');
    var fs=getComputedStyle(f);
    return { magic:magic, tech:cand.tech, fusionId:cand.id, fusionName:cand.name,
      available: (typeof getAvailableFusions==='function')?getAvailableFusions().map(function(x){return x.id;}):null,
      className:f.className, animation:fs.animationName, animationDuration:fs.animationDuration,
      text:f.innerText.replace(/\\s+/g,' ').trim(),
      rect:(function(){var r=f.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})() };
  })()`);
  await sleep(120);
  const frameA = await ev(`(function(){ var f=document.getElementById('fusionHint');
    return { cls:f.className, border:getComputedStyle(f).borderColor, transform:getComputedStyle(f).transform }; })()`);
  await sleep(700);
  const frameB = await ev(`(function(){ var f=document.getElementById('fusionHint');
    return { cls:f.className, border:getComputedStyle(f).borderColor, transform:getComputedStyle(f).transform }; })()`);
  report.steps.fusionInject.pulseA = frameA;
  report.steps.fusionInject.pulseB = frameB;
  await shot('23-fusion-ready.png', report.steps.fusionInject.rect ? {
    x: Math.max(0, report.steps.fusionInject.rect.x - 20),
    y: Math.max(0, report.steps.fusionInject.rect.y - 20),
    width: Math.min(innerWidthGuess(), report.steps.fusionInject.rect.w + 40),
    height: report.steps.fusionInject.rect.h + 40
  } : null);

  /* ---------- 5. 迷雾/房间边界：亮度剖面 + 1:1 裁剪 ---------- */
  report.steps.fogEdge = await ev(`(function(){
    var room = null;
    for (var i=0;i<state.rooms.length;i+=1){ if(state.fog.seenRooms[state.rooms[i].id]){ room=state.rooms[i]; break; } }
    if(!room) return { err:'no-seen-room' };
    // 把玩家放到房内靠上边界，让"上边缘"进入画面
    state.player.x = room.x + room.w/2;
    state.player.y = room.y + 110;
    state.player.vx = 0; state.player.vy = 0;
    if (typeof snapCamera==='function') snapCamera();
    var zoom = (typeof cameraZoom==='function')?cameraZoom():1;
    var c = document.getElementById('game');
    var cr = c.getBoundingClientRect();
    var ctx2 = c.getContext('2d');
    var sx = Math.round((room.x + room.w/2 - state.cam.x)*zoom);
    var syEdge = Math.round((room.y - state.cam.y)*zoom);
    var y0 = Math.max(0, syEdge-40), y1 = Math.min(c.height, syEdge+40);
    var img = ctx2.getImageData(sx, y0, 1, Math.max(2, y1-y0));
    var lum = [];
    for (var j=0;j<img.data.length;j+=4) lum.push(Math.round(0.2126*img.data[j]+0.7152*img.data[j+1]+0.0722*img.data[j+2]));
    var mx=0, at=-1; for(var k=1;k<lum.length;k+=1){ var d=Math.abs(lum[k]-lum[k-1]); if(d>mx){mx=d;at=k;} }
    return { room:{id:room.id,x:Math.round(room.x),y:Math.round(room.y),w:Math.round(room.w),h:Math.round(room.h)},
      viewport:{w:innerWidth,h:innerHeight}, canvas:{w:c.width,h:c.height}, zoom:Number(zoom.toFixed(2)),
      screenEdgeY: syEdge, sampleY0: y0, sampleCount: lum.length,
      luminance: lum, maxAdjacentJump: mx, jumpIndex: at,
      cam:{x:Math.round(state.cam.x),y:Math.round(state.cam.y)},
      canvasRect:{x:Math.round(cr.x),y:Math.round(cr.y)} };
  })()`);
  if (report.steps.fogEdge && !report.steps.fogEdge.err) {
    const f = report.steps.fogEdge;
    await shot('31-room-edge-full.png');
    await shot('32-room-edge-1to1.png', {
      x: Math.max(0, f.canvasRect.x + Math.round(f.room.w / 2 * f.zoom) - 160),
      y: Math.max(0, f.canvasRect.y + f.screenEdgeY - 90),
      width: 320, height: 180
    });
  }

  /* ---------- 6. 门的目标房：多少是"走过的" ---------- */
  report.steps.doorTargets = await ev(`(function(){
    var out=[];
    (state.doors||[]).forEach(function(d){
      if(d.targetRoomId==null||d.targetRoomId<0) return;
      var r=state.rooms[d.targetRoomId];
      out.push({ from: state.rooms[d.roomId]?state.rooms[d.roomId].type:'?', to: r?r.type:'?',
        targetRoomId:d.targetRoomId, visited: !!state.fog.seenRooms[d.targetRoomId],
        cleared: !!(r&&r.cleared), side:d.side });
    });
    return { currentRoomId: state.currentRoomId, doors: out,
      visitedDoors: out.filter(function(x){return x.visited;}).length, totalDoors: out.length };
  })()`);

  fs.writeFileSync(path.join(OUT, 'report3.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  try { ws.close(); } catch (e) { /* 已关闭 */ }
  killEdge(edge);
}

/** 页面宽度的兜底值（用于截图裁剪） */
function innerWidthGuess() { return 2000; }

main().catch((e) => { console.error('FAILED', e && e.stack || e); process.exitCode = 1; });
