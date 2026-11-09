/**
 * B2-b 回响房 · 副本验证（只读主文件，不写字节）
 * ------------------------------------------------------------
 * 验六件事：
 *   1. 快照结构：F1–F4 逐层生成后 lastFloorWave 非空、层号正确
 *   2. 深拷贝：快照里的敌人对象与 state.enemies 不共享引用
 *   3. 首次回响：F4 出现 1 间 echo 房，且敌人构成来自 F3
 *   4. 老档 / 跳层兼容：lastFloorWave 为 null 时 echo 房降级为 battle，不报错
 *   5. 掉落：回响房基础奥能 ×2、余烬补一份（合计 = 击杀量 ×2）
 *   6. 主文件字节未被改动
 * 用法：node tools/_echo_verify.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9536;
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const WORK = path.join(ROOT, '.seedwork', 'echoprobe');
const COPY = path.join(WORK, 'main.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 读取文件快照（字节 / 字符 / MD5）
 * @param {string} file 路径
 * @returns {{bytes:number, chars:number, md5:string}}
 */
function fileSnapshot(file) {
  const buf = fs.readFileSync(file);
  return {
    bytes: buf.length,
    chars: fs.readFileSync(file, 'utf8').length,
    md5: crypto.createHash('md5').update(buf).digest('hex').toUpperCase()
  };
}

/**
 * 复制主文件到工作副本并打补丁
 * @returns {Object} 补丁后副本的快照信息
 */
function buildCopy() {
  fs.mkdirSync(WORK, { recursive: true });
  fs.copyFileSync(SRC, COPY);
  let text = fs.readFileSync(COPY, 'utf8');
  if (!text.trimEnd().endsWith('</html>')) throw new Error('副本不完整（主文件正在被写入），中止');
  const { applyEchoPatch } = require('./_echo_patch');
  text = applyEchoPatch(text);
  fs.writeFileSync(COPY, text, 'utf8');
  return { bytes: Buffer.byteLength(text, 'utf8'), chars: text.length,
    md5: crypto.createHash('md5').update(text).digest('hex').toUpperCase() };
}

async function main() {
  const before = fileSnapshot(SRC);
  console.log('主文件（补丁前）: ' + JSON.stringify(before));
  const copy = buildCopy();
  console.log('副本（已打补丁）: ' + JSON.stringify(copy));

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

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
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + COPY.replace(/\\/g, '/') });

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const t = await send('Runtime.evaluate', {
        expression: "typeof generateFloor === 'function' && typeof captureFloorWaveSnapshot === 'function' && typeof ECHO_ROOM_CONFIG !== 'undefined'",
        returnByValue: true
      });
      if (t.result && t.result.value === true) { ready = true; break; }
    } catch (e) { /* 还没就绪 */ }
  }
  if (!ready) throw new Error('游戏脚本未就绪（captureFloorWaveSnapshot 不存在）');
  await ev(`(function(){ var b=document.querySelector('#btnStart'); if(b) b.click(); return true; })()`);
  await sleep(1200);

  const result = await ev(`(function(){
    var out = { floors: [], errors0: (window.__errors || []).length };

    /** 切到指定层并记录快照 / 回响房状态 */
    function step(n) {
      state.floor = n;
      generateFloor(n);
      var snap = state.lastFloorWave;
      var echoRooms = state.rooms.filter(function(r){ return r.type === 'echo'; });
      var row = {
        floor: n,
        snapFloor: snap ? snap.floor : null,
        snapVersion: snap ? snap.version : null,
        snapRooms: snap ? snap.rooms.length : 0,
        snapEnemies: snap ? snap.rooms.reduce(function(s, r){ return s + r.enemies.length; }, 0) : 0,
        echoCount: echoRooms.length,
        echo: echoRooms.map(function(r){
          return { roomId: r.id, enemyCount: r.enemyCount,
            types: (r.enemyTypes || []).slice(0, 3),
            srcFloor: r.echoSourceFloor, srcType: r.echoSourceType };
        })
      };
      out.floors.push(row);
      return echoRooms;
    }

    step(1); step(2); step(3);
    var echoF4 = step(4);

    /* —— 深拷贝：快照里的敌人对象绝不能与 state.enemies 共享引用 —— */
    var snap = state.lastFloorWave;
    var liveEnemies = (state.enemies || []).filter(function(e){ return e && e.roomId >= 0; });
    var sharedRefs = 0;
    var sampleBefore = null;
    if (snap && snap.rooms.length && liveEnemies.length) {
      var s0 = snap.rooms[0].enemies[0];
      sampleBefore = s0.typeId;
      liveEnemies.forEach(function(e){ if (s0 === e) sharedRefs += 1; });
      s0.typeId = '__MUTATED__';
      var leaked = liveEnemies.filter(function(e){ return e.typeId === '__MUTATED__'; }).length;
      s0.typeId = sampleBefore;
      out.deepCopy = { sharedRefs: sharedRefs, leaked: leaked, sample: sampleBefore };
    } else {
      out.deepCopy = { sharedRefs: -1, leaked: -1, sample: null, why: 'snapshot or enemies empty' };
    }

    /* —— F4 回响源应来自 F3 —— */
    var echoInfo = out.floors[3].echo[0] || null;
    out.echoSourceOk = !!(echoInfo && echoInfo.srcFloor === 3 && echoInfo.enemyCount > 0);

    /* —— 老档兼容：快照缺失 → 降级为 battle，不报错 —— */
    var errBefore = (window.__errors || []).length;
    state.lastFloorWave = null;
    state.floor = 4;
    generateFloor(4);
    out.degrade = {
      echoRooms: state.rooms.filter(function(r){ return r.type === 'echo'; }).length,
      downgraded: state.rooms.filter(function(r){ return r.echoDowngraded; }).length,
      rooms: state.rooms.length,
      errors: (window.__errors || []).length - errBefore
    };

    /* —— 快照版本不符也要降级 —— */
    state.lastFloorWave = { version: 999, floor: 3, rooms: [{ roomId: 1, type: 'battle', enemies: [{ typeId: 'x' }] }] };
    state.floor = 4;
    generateFloor(4);
    out.badVersion = {
      echoRooms: state.rooms.filter(function(r){ return r.type === 'echo'; }).length,
      downgraded: state.rooms.filter(function(r){ return r.echoDowngraded; }).length
    };

    /* —— 掉落：重建 F4（快照已恢复为 F3）后清一间回响房 —— */
    state.floor = 3; generateFloor(3);
    state.floor = 4; generateFloor(4);
    var er = state.rooms.filter(function(r){ return r.type === 'echo'; })[0];
    var reward = null;
    if (er) {
      er.cleared = false; er.rewarded = false;
      state.player.aether = 0; state.player.aetherMax = 999;
      state.embers = 0;
      var b = { aether: state.player.aether, embers: state.embers };
      onRoomCleared(er);
      reward = {
        kills: (er.enemyTypes || []).length,
        aether: state.player.aether - b.aether,
        embers: state.embers - b.embers,
        expectAether: 48,
        expectEmbers: (er.enemyTypes || []).length
      };
    }
    out.reward = reward;

    out.errors = (window.__errors || []).length;
    out.errorList = (window.__errors || []).slice(0, 5);
    return out;
  })()`);

  console.log(JSON.stringify(result, null, 1));

  ws.close();
  killEdge(edge);
  try { fs.unlinkSync(COPY); } catch (e) { /* ignore */ }

  const after = fileSnapshot(SRC);
  console.log('主文件（补丁后）: ' + JSON.stringify(after));
  console.log('主文件未被写入: ' + (after.md5 === before.md5 && after.bytes === before.bytes));
}

main().catch((e) => { console.error(e); process.exit(1); });
