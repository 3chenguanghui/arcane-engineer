/**
 * 首玩复现探针 4（只读）
 * ------------------------------------------------------------
 * 专查：
 *   1) 键位说明到底看不看得见（.deck-keys / .deck-title 的 computed display，解锁前后各一次）；
 *   2) "黑雾硬边"到底在哪一层：沿房间上边缘做 1px 亮度剖面 + 1:1 裁剪；
 *   3) 输入法场景：key='Process' + code='KeyA' 时角色是否移动（中文输入法的典型表现）。
 *
 * 输出：.screenshots/firstplay/report4.json
 * 用法：node tools/firstplay_probe4.js
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
    const port = 10240 + Math.floor(Math.random() * 120);
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
  await sleep(600);

  /* ---------- 1. 键位说明的可见性 ---------- */
  /**
   * 读三处键位说明的 computed 状态
   * @returns {Promise<Object>} 可见性快照
   */
  const legendState = () => ev(`(function(){
    var keys=document.querySelector('.deck-keys:not(#padLegend)');
    var title=document.querySelector('.deck-title');
    var note=document.getElementById('fusionNote');
    var info=function(el){ if(!el) return null; var cs=getComputedStyle(el); var r=el.getBoundingClientRect();
      return { display:cs.display, opacity:cs.opacity, visibility:cs.visibility,
        rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
        cls:el.className, text:el.innerText.replace(/\\s+/g,' ').trim() }; };
    return { bodyClass:document.body.className, keys:info(keys), title:info(title), note:info(note) };
  })()`);
  report.steps.legendLocked = await legendState();
  await ev(`(function(){ if(state.meta.unlocks && !state.meta.unlocks.fusion){ unlock('fusion','探针'); } return state.meta.unlocks.fusion; })()`);
  await sleep(300);
  report.steps.legendUnlocked = await legendState();
  await shot('71-key-legend.png');

  /* ---------- 2. 输入法场景：key=Process + code=KeyA ---------- */
  const before = await ev(`({x:state.player.x,y:state.player.y,active:document.activeElement?(document.activeElement.id||document.activeElement.tagName):'none'})`);
  // 模拟中文输入法：逻辑键是 Process，物理键仍是 KeyA
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
  await sleep(450);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
  await sleep(150);
  const after = await ev(`({x:state.player.x,y:state.player.y,left:!!state.keys.left,up:!!state.keys.up})`);
  report.steps.imeKey = { before, after,
    movedPx: Math.round(Math.hypot(after.x - before.x, after.y - before.y) * 10) / 10 };

  /* ---------- 3. 房间上边缘的亮度剖面（真正找硬边） ---------- */
  report.steps.edge = await ev(`(function(){
    var room=null;
    for(var i=0;i<state.rooms.length;i+=1){ if(state.fog.seenRooms[state.rooms[i].id]){ room=state.rooms[i]; break; } }
    if(!room) return {err:'no-seen-room'};
    state.player.x=room.x+room.w/2; state.player.y=room.y+room.h*0.5;
    state.player.vx=0; state.player.vy=0;
    if(typeof snapCamera==='function') snapCamera();
    var zoom=cameraZoom();
    var c=document.getElementById('game');
    var ctx2=c.getContext('2d');
    var sx=Math.round((room.x+room.w/2-state.cam.x)*zoom);
    var yTop=Math.round((room.y-70-state.cam.y)*zoom);
    var yBot=Math.round((room.y+70-state.cam.y)*zoom);
    var y0=Math.max(0,yTop), y1=Math.min(c.height,yBot);
    var img=ctx2.getImageData(sx,y0,1,Math.max(2,y1-y0));
    var lum=[];
    for(var j=0;j<img.data.length;j+=4){ lum.push(Math.round(0.2126*img.data[j]+0.7152*img.data[j+1]+0.0722*img.data[j+2])); }
    var mx=0,at=-1;
    for(var k=1;k<lum.length;k+=1){ var d=Math.abs(lum[k]-lum[k-1]); if(d>mx){mx=d;at=k;} }
    // 找第一处"亮度掉到 8 以下"的位置（即进入纯黑雾）
    var blackAt=-1; for(var q=0;q<lum.length;q+=1){ if(lum[q]<=8){ blackAt=q; break; } }
    return { room:{id:room.id,x:Math.round(room.x),y:Math.round(room.y),w:Math.round(room.w),h:Math.round(room.h)},
      zoom:Number(zoom.toFixed(2)), sx:sx, sampleY0:y0, sampleCount:lum.length,
      roomTopScreenY: Math.round((room.y-state.cam.y)*zoom),
      luminance:lum, maxAdjacentJump:mx, jumpIndex:at, blackAt:blackAt,
      cam:{x:Math.round(state.cam.x),y:Math.round(state.cam.y)} };
  })()`);
  if (report.steps.edge && !report.steps.edge.err) {
    const e2 = report.steps.edge;
    await shot('33-edge-full.png');
    // 正确裁剪：以房间上边缘为中心，x 以房间中心为基准
    const clip = {
      x: Math.max(0, e2.sx - 160),
      y: Math.max(0, e2.roomTopScreenY - 70),
      width: 320, height: 160
    };
    await shot('34-edge-1to1.png', clip);
    report.steps.edge.crop = clip;
  }

  /* ---------- 4. 雾层 alpha 与渲染亮度的对照 ---------- */
  report.steps.fogAlpha = await ev(`(function(){
    var room=null;
    for(var i=0;i<state.rooms.length;i+=1){ if(state.fog.seenRooms[state.rooms[i].id]){ room=state.rooms[i]; break; } }
    if(!room||typeof fogCtx==='undefined') return {err:'no-room-or-fog'};
    var fs=fogScaleFactor;
    var cx=Math.round((room.x+room.w/2)*fs);
    var y0=Math.round((room.y-40)*fs), y1=Math.round((room.y+40)*fs);
    var img=fogCtx.getImageData(cx,y0,1,Math.max(2,y1-y0));
    var a=[]; for(var j=0;j<img.data.length;j+=4) a.push(img.data[j+3]);
    var mx=0,at=-1; for(var k=1;k<a.length;k+=1){ var d=Math.abs(a[k]-a[k-1]); if(d>mx){mx=d;at=k;} }
    return { feather:FOG_CONFIG.feather, secondPass:FOG_CONFIG.secondPass, fogScaleFactor:fs,
      alpha:a, maxAdjacentStep:mx, stepIndex:at };
  })()`);

  fs.writeFileSync(path.join(OUT, 'report4.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  try { ws.close(); } catch (e) { /* 已关闭 */ }
  killEdge(edge);
}

main().catch((e) => { console.error('FAILED', e && e.stack || e); process.exitCode = 1; });
