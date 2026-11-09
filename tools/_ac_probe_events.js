// 临时探针：统计"每层是否有正式路径的干净候选房"，用于回答脏层概率 + 校验夹具预检是否过严
// 只读状态，不改主文件。跑完即删。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./_ac_freeze_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9697;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1536,900', 'about:blank'
  ], { stdio: 'ignore' });
  const kill = () => { try { edge.kill(); } catch (e) {} };
  process.on('exit', kill);

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('Edge CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(1600);
  await ev(`(function(){ try { state.onboardSkipAll = true; hideIntroHint(true); } catch (e) {} ; document.getElementById('btnStart').click(); return true; })()`);
  await sleep(2600);
  await ev(`(function(){ state.mode='playing'; state.status='playing'; return true; })()`);

  // 每层采样 3 次（同一层号重复生成会产生不同布局），统计"正式路径是否有干净候选"
  const scan = await ev(`(function(){
    __roamDebug.event.setEnabled(true);
    __roamDebug.event.setChance(1);
    var out = [];
    for (var rep = 0; rep < 3; rep += 1) {
      for (var n = 2; n <= 21; n += 1) {
        var d0 = __roamDebug.event.newFloor(n);
        var genRoom = d0.room ? d0.room.roomId : -1;   // 生成期自己装的事件房（chance=1）
        resetEventRoomState();
        var spawn = state.rooms[state.spawnRoomId] || state.rooms[0];
        var stair = state.rooms.find(function(r){ return r.type === 'boss'; })
          || state.rooms[state.rooms.length - 1];
        var cand = eventRoomCandidate(spawn, stair);
        var candSpot = !!(cand && findEventRoomSpot(cand));
        var alt = [];
        if (cand && !candSpot) {
          alt = state.rooms.filter(function(r){
            return r && r.id !== cand.id && !r.challenge
              && ['battle','elite','chest','rest','event'].indexOf(r.type) >= 0
              && findEventRoomSpot(r);
          }).map(function(r){ return r.id; });
        }
        out.push({
          rep: rep, floor: n, genRoom: genRoom,
          rooms: state.rooms.map(function(r){
            return r.id + ':' + r.type
              + (r.challenge ? '/CH' : '')
              + (r.hasKey && !r.keyTaken ? '/KEY' : '')
              + (state.dualAltar && state.dualAltar.roomId === r.id ? '/DUAL' : '');
          }).join(' '),
          cand: cand ? cand.id : -1, candSpot: candSpot, alt: alt,
          clean: candSpot || alt.length > 0
        });
      }
    }
    return out;
  })()`);

  const total = scan.length;
  const dirty = scan.filter((x) => !x.clean);
  const genOk = scan.filter((x) => x.genRoom >= 0);
  console.log('SCAN total=' + total + ' dirty=' + dirty.length
    + ' (' + (Math.round((dirty.length / total) * 1000) / 10) + '%)'
    + ' generationWithEventRoom=' + genOk.length);
  const byFloor = {};
  scan.forEach((x) => { byFloor[x.floor] = byFloor[x.floor] || { c: 0, d: 0 }; byFloor[x.floor].c += 1; if (!x.clean) byFloor[x.floor].d += 1; });
  console.log('BY-FLOOR ' + JSON.stringify(byFloor));
  console.log('SAMPLE-DIRTY ' + JSON.stringify(dirty.slice(0, 6), null, 1));
  console.log('SAMPLE-CLEAN ' + JSON.stringify(scan.filter((x) => x.clean).slice(0, 6), null, 1));

  ws.close();
  kill();
}

main().then(() => process.exit(0)).catch((e) => { console.error('PROBE ERROR', e && e.message); process.exit(1); });
