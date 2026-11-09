/**
 * P1 符文刻印台验收：A1–A6
 * 用法：node tools/arcane_engrave.js
 * 端口：9512
 * 输出：.screenshots/art/p1-engrave.png、p1-engrave-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9512;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1400);
  await ev(`(function(){ state.player.invuln = 9999; state.embers = 0; state.tagPatches = {}; state.engrave.count = {}; state.engrave.usedFloor = -1; return true; })()`);

  // ---------- A0：每层至少 1 台（休整房固定，落点合法） ----------
  const a0 = await ev(`(function(){
    var st = window.__roamDebug.engrave.stations();
    var bad = st.filter(function(s){
      var room = state.rooms.find(function(r){ return r.id === s.roomId; });
      return !room || !isWalkableCircle(s.x, s.y, ENGRAVE_CONFIG.radius + 2);
    });
    return { stations: st, badCount: bad.length, cost: window.__roamDebug.engrave.info().cost };
  })()`);
  ok('A0 本层生成 ≥1 台刻印台且落点可走',
    a0.stations.length >= 1 && a0.badCount === 0, a0);

  // ---------- A1：0 余烬 → 拒绝，状态完全不变 ----------
  const a1 = await ev(`(function(){
    var before = JSON.stringify(state.tagPatches || {});
    var r = window.__roamDebug.engrave.apply('fireball', 'projectile', 'thunder');
    return { r: r, before: before, after: JSON.stringify(state.tagPatches || {}), embers: state.embers };
  })()`);
  ok('A1 余烬不足时拒绝（reason=embers / tagPatches 不变 / 余烬不变）',
    a1.r && a1.r.ok === false && a1.r.reason === 'embers'
      && a1.before === a1.after && a1.embers === 0, a1);

  // ---------- A2：付 3 余烬把 fireball 的 projectile 改成 thunder ----------
  const a2 = await ev(`(function(){
    state.embers = 3;
    state.relics.ember = 1;
    state.relics.conductor = 0;
    var mulBefore = tagDamageMul('fireball');
    var r = window.__roamDebug.engrave.apply('fireball', 'projectile', 'thunder');
    state.relics.conductor = 1;
    var mulAfter = tagDamageMul('fireball');
    return {
      r: r, tags: getAbilityTags('fireball').slice(), mulBefore: mulBefore, mulAfter: mulAfter,
      embers: state.embers, seq: state.tagPatchSeq, usedFloor: state.engrave.usedFloor,
      count: state.engrave.count.fireball
    };
  })()`);
  ok('A2 刻印生效（标签 fire+thunder / 乘算 1.2→1.44 / 扣 3 余烬 / seq+1）',
    a2.r.ok === true && a2.tags.indexOf('fire') >= 0 && a2.tags.indexOf('thunder') >= 0
      && a2.tags.indexOf('projectile') < 0
      && Math.abs(a2.mulBefore - 1.2) < 0.02 && Math.abs(a2.mulAfter - 1.44) < 0.02
      && a2.embers === 0 && a2.seq >= 1 && a2.count === 1, a2);

  // ---------- A5：下层后标签改写仍生效，标签条重绘出「雷」 ----------
  const a5 = await ev(`(function(){
    state.floor += 1;
    renderTagBar();
    var hud = document.getElementById('hudTags');
    return {
      tags: getAbilityTags('fireball').slice(),
      mul: tagDamageMul('fireball'),
      seq: state.tagPatchSeq,
      hudText: hud ? hud.textContent : '',
      floor: state.floor
    };
  })()`);
  ok('A5 跨楼层保留 + 标签条重绘（仍含 thunder / HUD 出现「雷」）',
    a5.tags.indexOf('thunder') >= 0 && a5.hudText.indexOf('雷') >= 0 && a5.seq >= 1, a5);

  // ---------- A3：同一能力第 3 次刻印被拒，count 停在 2，不再扣费 ----------
  const a3 = await ev(`(function(){
    state.embers = 9;
    state.engrave.usedFloor = -1;
    var second = window.__roamDebug.engrave.apply('fireball', 'fire', 'ice');
    var embersAfterSecond = state.embers;
    var tagsAfterSecond = getAbilityTags('fireball').slice();
    var third = window.__roamDebug.engrave.apply('fireball', 'ice', 'area');
    return {
      second: second, third: third, count: state.engrave.count.fireball,
      embersAfterSecond: embersAfterSecond, embersAfterThird: state.embers,
      tagsAfterSecond: tagsAfterSecond
    };
  })()`);
  ok('A3 每卡 2 次上限（第 3 次 reason=limitAbility / 不扣费 / count=2）',
    a3.second.ok === true && a3.third.ok === false && a3.third.reason === 'limitAbility'
      && a3.count === 2 && a3.embersAfterThird === a3.embersAfterSecond, a3);

  // ---------- A4：只给 1 个标签的输入被拒 ----------
  const a4 = await ev(`(function(){
    var before = JSON.stringify(state.tagPatches || {});
    var r = window.__roamDebug.engrave.applyTags('fireball', ['ice']);
    return { r: r, before: before, after: JSON.stringify(state.tagPatches || {}) };
  })()`);
  ok('A4 少于 2 个标签被拒（reason=minTags / tagPatches 不变）',
    a4.r.ok === false && a4.r.reason === 'minTags' && a4.before === a4.after, a4);

  // ---------- A6：面板可开关 + 三列渲染 + 无错误 + 帧率 + 截图 ----------
  const panel = await ev(`(function(){
    var opened = window.__roamDebug.engrave.open();
    var mode = state.mode;
    var cols = document.querySelectorAll('#engravePanel .engrave-col').length;
    var visible = document.getElementById('engravePanel').classList.contains('is-open');
    var info = window.__roamDebug.engrave.info();
    return { opened: opened, mode: mode, cols: cols, visible: visible, info: info };
  })()`);
  await shot('p1-engrave.png');
  const closed = await ev(`(function(){ var okClose = closePanel('engrave'); return { ok: okClose, mode: state.mode }; })()`);

  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  const size = (() => { try { return fs.statSync(path.join(OUT_DIR, 'p1-engrave.png')).size; } catch (e) { return 0; } })();
  ok('A6 面板三列可开关 / 无脚本错误 / 帧率 ≥ 60 / 截图 > 10KB',
    panel.opened === true && panel.mode === 'engrave' && panel.cols === 3 && panel.visible === true
      && closed.ok === true && closed.mode === 'playing'
      && errors === 0 && fps >= 60 && size > 10240, { panel, closed, fps, errors, size });

  fs.writeFileSync(path.join(OUT_DIR, 'p1-engrave-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== p1-engrave ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
