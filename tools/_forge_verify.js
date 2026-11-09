/**
 * B2-a 熔炉房 · 副本验证
 * ------------------------------------------------------------
 * 验五件事：
 *   1. 房型已注册（ROOM_TYPE_CONFIG.types.forge）+ 门牌图标/提示存在
 *   2. 层计划表第 4 / 13 层真的排出了 forge 房
 *   3. 熔炉房里生成了 forge:true 的刻印台
 *   4. 本房第一次刻印扣 4 余烬、第二次扣 6（阶梯按本房计）
 *   5. 全程 0 控制台错误
 * 用法：node tools/_forge_verify.js
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
const WORK = path.join(ROOT, '.seedwork', 'forgeprobe');
const COPY = path.join(WORK, 'main.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 复制主文件并叠加 B1 + B2 补丁
 * @returns {Object} 快照信息
 */
function snapshot() {
  fs.mkdirSync(WORK, { recursive: true });
  fs.copyFileSync(SRC, COPY);
  let text = fs.readFileSync(COPY, 'utf8');
  if (!text.trimEnd().endsWith('</html>')) throw new Error('副本不完整（主文件正在被写入），中止');
  const { applyEventPatch } = require('./_event_patch');
  const { applyForgePatch } = require('./_forge_patch');
  // GB-01 批次只含熔炉：设 ARCANE_NO_EVENT=1 时跳过 B1 事件补丁，验证"熔炉单独可贴"
  if (!process.env.ARCANE_NO_EVENT) text = applyEventPatch(text);
  text = applyForgePatch(text);
  fs.writeFileSync(COPY, text, 'utf8');
  return {
    chars: text.length,
    md5: crypto.createHash('md5').update(text).digest('hex').toUpperCase()
  };
}

async function main() {
  console.log('副本: ' + JSON.stringify(snapshot()));
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
    const t = await send('Runtime.evaluate', {
      expression: "typeof applyEngrave === 'function' && typeof spawnEngraveStations === 'function'",
      returnByValue: true
    });
    if (t.result && t.result.value === true) { ready = true; break; }
  }
  if (!ready) throw new Error('游戏脚本未就绪');
  await ev(`(function(){ var b=document.querySelector('#btnStart'); if(b) b.click(); return true; })()`);
  await sleep(1200);

  const result = await ev(`(function(){
    var out = { type: !!(ROOM_TYPE_CONFIG.types.forge), color: ROOM_TYPE_CONFIG.types.forge && ROOM_TYPE_CONFIG.types.forge.color,
      tip: DOOR_INFO_CONFIG.tipByType.forge, icon: DOOR_VIS_CONFIG.icons.forge, ladder: ENGRAVE_CONFIG.forgeLadder, plans: {} };
    [4, 13].forEach(function(f){
      var sig = window.__roamDebug.p2.probeFloor('20261101', f);
      out.plans['F' + f] = sig.rooms.map(function(r){ return r.type; });
    });

    /* 把当前层的战斗房改成熔炉房，重跑刻印台生成，确认出现 forge:true 台座 */
    var battle = state.rooms.find(function(r){ return r.type === 'battle'; });
    if (!battle) return { error: '没有战斗房' };
    battle.type = 'forge';
    var spawnRoom = state.rooms[state.spawnRoomId];
    var stair = state.rooms.find(function(r){ return r.type === 'boss'; }) || state.rooms[state.rooms.length - 1];
    spawnEngraveStations(spawnRoom, stair);
    var st = (state.engrave.stations || []).filter(function(s){ return s.forge; })[0];
    out.station = st ? { roomId: st.roomId, hasForge: true } : null;
    if (!st) return out;

    /* 站到台座旁，连续两次刻印，验阶梯 4 → 6 */
    state.player.x = st.x; state.player.y = st.y;
    state.currentRoomId = st.roomId;
    state.embers = 50;
    state.engrave.usedFloor = -1; state.engrave.freeFloor = -1; state.engrave.forgeUses = 0; state.engrave.forgeRoomId = null;
    state.engrave.count = {};
    var id = (state.ownedMagic || [])[0] || (Object.keys(TAG_CONFIG)[0]);
    var tagKeys = Object.keys(TAG_CONFIG);
    function tagsFor(a){ var t = getAbilityTags(a).slice(); return t.length ? t : [tagKeys[0]]; }
    var e0 = state.embers;
    var r1 = applyEngrave(id, tagsFor(id));
    var e1 = state.embers;
    var r2 = applyEngrave(id, tagsFor(id));
    var e2 = state.embers;
    out.cost = { first: e0 - e1, second: e1 - e2, ok1: !!(r1 && r1.ok), ok2: !!(r2 && r2.ok), reason2: r2 && r2.reason };
    out.errors = (window.__errors || []).length;
    return out;
  })()`);

  console.log(JSON.stringify(result, null, 1));
  ws.close();
  killEdge(edge);
  try { fs.unlinkSync(COPY); } catch (e) { /* ignore */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
