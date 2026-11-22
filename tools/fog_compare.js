/**
 * P4 黑雾硬边 · 改前/改后同机位对照探针（只读）
 * ------------------------------------------------------------
 * 用法：node tools/fog_compare.js <html路径> <before|after>
 * 做两件事：
 *   1) 出生房上边缘：1:1 亮度剖面 + 裁剪截图（看墙顶高光是否还是 1px 硬线）；
 *   2) 同一间房的上墙门洞：同机位截图 + 剖面（看缩进 22px 后门洞有没有新缝）。
 * 输出：.screenshots/firstplay/fog-<tag>-top.png / fog-<tag>-door.png / fog-<tag>.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const TAG = process.argv[3] || 'after';
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 建连并打开指定文件
 * @returns {Promise<Object>} CDP 会话
 */
async function connect() {
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 5 && !target; attempt += 1) {
    const port = 10620 + Math.floor(Math.random() * 120);
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
    const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip: Object.assign({ scale: 1 }, clip) } : { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, shot };
}

/**
 * 读一条竖线的亮度/雾 alpha 剖面
 * @param {string} mode 'lum' 渲染亮度 | 'alpha' 雾层 alpha
 * @returns {Promise<Object>} 剖面数据
 */
function profileExpr(mode) {
  return `(function(){
    var room=null;
    for(var i=0;i<state.rooms.length;i+=1){ if(state.fog.seenRooms[state.rooms[i].id]){ room=state.rooms[i]; break; } }
    if(!room) return {err:'no-seen-room'};
    state.player.x=room.x+room.w/2; state.player.y=room.y+room.h*0.5;
    state.player.vx=0; state.player.vy=0;
    if(typeof snapCamera==='function') snapCamera();
    var zoom=cameraZoom();
    var c=document.getElementById('game');
    var sx=Math.round((room.x+room.w/2-state.cam.x)*zoom);
    var topScreen=Math.round((room.y-state.cam.y)*zoom);
    var arr=[];
    if('${mode}'==='lum'){
      var ctx2=c.getContext('2d');
      var y0=Math.max(0,topScreen-70), y1=Math.min(c.height,topScreen+70);
      var img=ctx2.getImageData(sx,y0,1,Math.max(2,y1-y0));
      for(var j=0;j<img.data.length;j+=4) arr.push(Math.round(0.2126*img.data[j]+0.7152*img.data[j+1]+0.0722*img.data[j+2]));
      var mx=0,at=-1; for(var k=1;k<arr.length;k+=1){ var d=Math.abs(arr[k]-arr[k-1]); if(d>mx){mx=d;at=k;} }
      // 只统计房间上边缘 ±20px（窗口中心 = room top）
      var center=Math.round((topScreen-y0));
      var near=0,nearAt=-1;
      for(var n=Math.max(1,center-20);n<Math.min(arr.length,center+21);n+=1){
        var nd=Math.abs(arr[n]-arr[n-1]); if(nd>near){near=nd;nearAt=n;}
      }
      var atTop=Math.abs(arr[center]-arr[center-1]);
      return { room:{id:room.id,x:Math.round(room.x),y:Math.round(room.y),w:Math.round(room.w),h:Math.round(room.h)},
        zoom:Number(zoom.toFixed(2)), sx:sx, topScreen:topScreen, samples:arr.length,
        maxJump:mx, jumpIndex:at, jumpAtTop:atTop, maxJumpNearTop:near, nearTopIndex:nearAt, profile:arr };
    }
    var fs=fogScaleFactor;
    var cx=Math.round((room.x+room.w/2)*fs);
    var fy0=Math.round((room.y-40)*fs), fy1=Math.round((room.y+40)*fs);
    var fimg=fogCtx.getImageData(cx,fy0,1,Math.max(2,fy1-fy0));
    for(var q=0;q<fimg.data.length;q+=4) arr.push(fimg.data[q+3]);
    var fmx=0,fat=-1; for(var p=1;p<arr.length;p+=1){ var fd=Math.abs(arr[p]-arr[p-1]); if(fd>fmx){fmx=fd;fat=p;} }
    return { feather:FOG_CONFIG.feather, fogScaleFactor:fs, samples:arr.length, maxStep:fmx, stepIndex:fat, profile:arr };
  })()`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot } = await connect();
  const report = { file: FILE, tag: TAG, steps: {} };

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

  /* 1) 出生房上边缘 */
  report.steps.topLum = await ev(profileExpr('lum'));
  report.steps.topFog = await ev(profileExpr('alpha'));
  if (!report.steps.topLum.__err && !report.steps.topLum.err) {
    const t = report.steps.topLum;
    const clip = { x: Math.max(0, t.sx - 160), y: Math.max(0, t.topScreen - 70), width: 320, height: 160 };
    await shot(`fog-${TAG}-top.png`, clip);
    report.steps.topCrop = clip;
  }

  /* 2) 同房间的上墙门洞：把相机对到门上，再取 1:1 裁剪 */
  report.steps.door = await ev(`(function(){
    var room=null;
    for(var i=0;i<state.rooms.length;i+=1){ if(state.fog.seenRooms[state.rooms[i].id]){ room=state.rooms[i]; break; } }
    if(!room) return {err:'no-room'};
    var door=null;
    (state.doors||[]).forEach(function(d){ if(!door && d.roomId===room.id) door=d; });
    if(!door) (state.doors||[]).forEach(function(d){ if(!door) door=d; });
    if(!door) return {err:'no-door'};
    state.player.x=door.x; state.player.y=door.y+70;
    state.player.vx=0; state.player.vy=0;
    if(typeof snapCamera==='function') snapCamera();
    var zoom=cameraZoom();
    var sx=Math.round((door.x-state.cam.x)*zoom);
    var sy=Math.round((door.y-state.cam.y)*zoom);
    return { door:{x:Math.round(door.x),y:Math.round(door.y),targetRoomId:door.targetRoomId},
      sx:sx, sy:sy, zoom:Number(zoom.toFixed(2)) };
  })()`);
  if (!report.steps.door.__err && !report.steps.door.err) {
    const d = report.steps.door;
    const clip = { x: Math.max(0, d.sx - 180), y: Math.max(0, d.sy - 110), width: 360, height: 220 };
    await shot(`fog-${TAG}-door.png`, clip);
    report.steps.doorCrop = clip;
  }

  fs.writeFileSync(path.join(OUT, `fog-${TAG}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    tag: TAG,
    top: { maxJump: report.steps.topLum.maxJump, jumpIndex: report.steps.topLum.jumpIndex },
    topFog: { maxStep: report.steps.topFog.maxStep, stepIndex: report.steps.topFog.stepIndex },
    door: report.steps.door
  }, null, 2));

  try { ws.close(); } catch (e) { /* 已关闭 */ }
  killEdge(edge);
}

main().catch((e) => { console.error(e); process.exit(1); });
