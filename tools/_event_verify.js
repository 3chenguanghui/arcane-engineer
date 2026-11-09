/**
 * B1 事件扩容 · 副本验证（只读主文件，不写字节）
 * ------------------------------------------------------------
 * 验四件事：
 *   1. 事件池 12 → 17（新 5 条全部进入 legacy 池）
 *   2. 每条新事件的数值真的按"代价/收益"结算（走 applyRoomReward 真路径）
 *   3. ashpawn 按结算次数限 2 次/局，第 3 次被换成别的旧事件
 *   4. 全程无控制台报错
 * 用法：node tools/_event_verify.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9534;
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const WORK = path.join(ROOT, '.seedwork', 'eventprobe');
const COPY = path.join(WORK, 'main.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 复制主文件并按需打补丁，返回字节/字符/MD5 与"原始事件表条数"
 * @returns {Object} 快照信息
 */
function snapshot(patched) {
  fs.mkdirSync(WORK, { recursive: true });
  fs.copyFileSync(SRC, COPY);
  let text = fs.readFileSync(COPY, 'utf8');
  if (!text.trimEnd().endsWith('</html>')) throw new Error('副本不完整（主文件正在被写入），中止');
  const rawRows = (text.match(/\{ id: '[a-z0-9]+', (effect|text):/g) || []).length;
  if (patched) {
    const { applyEventPatch } = require('./_event_patch');
    text = applyEventPatch(text);
    fs.writeFileSync(COPY, text, 'utf8');
  }
  return {
    bytes: Buffer.byteLength(text, 'utf8'),
    chars: text.length,
    md5: crypto.createHash('md5').update(text).digest('hex').toUpperCase(),
    rawRows,
    patched
  };
}

async function main() {
  const base = snapshot(false);
  const after = snapshot(true);
  console.log('原始快照: ' + JSON.stringify(base));
  console.log('补丁快照: ' + JSON.stringify(after));

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
  /* 主文件已 2.85MB，脚本执行时间变长：轮询到关键函数就绪再继续 */
  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const t = await send('Runtime.evaluate', {
        expression: "typeof u11cEventPool === 'function' && typeof applyRoomReward === 'function'",
        returnByValue: true
      });
      if (t.result && t.result.value === true) { ready = true; break; }
    } catch (e) { /* 还没就绪 */ }
  }
  if (!ready) throw new Error('游戏脚本未就绪（u11cEventPool 不存在）');
  await ev(`(function(){ var b=document.querySelector('#btnStart'); if(b) b.click(); return true; })()`);
  await sleep(1200);

  const result = await ev(`(function(){
    var out = { pool: u11cEventPool().length, ids: u11cEventPool().map(function(e){ return e.id; }), cases: [] };
    var targets = ['ashpawn','scavenger','hollow','ledger','frugal'];
    var origPick = u11cPickEvent;
    targets.forEach(function(id){
      var evt = ROOM_TYPE_CONFIG.eventTable.filter(function(x){ return x.id === id; })[0];
      if (!evt) { out.cases.push({ id: id, ok: false, why: 'not in table' }); return; }
      u11cPickEvent = function(){ return evt; };
      state.player.hp = 100; state.player.hpMax = 240;
      state.player.aether = 100; state.player.aetherMax = 120;
      state.embers = 50; state.meta.crystals = 10;
      var before = { hp: state.player.hp, aether: state.player.aether, embers: state.embers, crystals: state.meta.crystals };
      var room = { id: 9900, cx: 300, cy: 300, type: 'event', rewarded: false };
      applyRoomReward(room);
      out.cases.push({
        id: id, ok: true, before: before,
        after: { hp: state.player.hp, aether: state.player.aether, embers: state.embers, crystals: state.meta.crystals },
        delta: {
          hp: state.player.hp - before.hp, aether: state.player.aether - before.aether,
          embers: state.embers - before.embers, crystals: state.meta.crystals - before.crystals
        }
      });
    });
    /* ashpawn 限额：连结算 3 次，第 3 次应被换掉 */
    var ash = ROOM_TYPE_CONFIG.eventTable.filter(function(x){ return x.id === 'ashpawn'; })[0];
    u11cPickEvent = function(){ return ash; };
    state.eventSettleCounts = {};
    state.embers = 200; state.meta.crystals = 0;
    var hits = 0;
    for (var i = 0; i < 3; i += 1) {
      var e0 = state.embers;
      applyRoomReward({ id: 9910 + i, cx: 320, cy: 320, type: 'event', rewarded: false });
      if (state.embers === e0 - 15) hits += 1;
    }
    out.ashpawn = { hits: hits, counts: JSON.parse(JSON.stringify(state.eventSettleCounts)) };
    u11cPickEvent = origPick;
    out.errors = (window.__errors || []).length;
    return out;
  })()`);

  console.log(JSON.stringify(result, null, 1));
  ws.close();
  killEdge(edge);
  try { fs.unlinkSync(COPY); } catch (e) { /* ignore */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
