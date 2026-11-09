/**
 * C7 专项验收：祝福 / 诅咒契约（端口 9506）
 * 用法：node tools/arcane_c7.js
 * 输出：.screenshots/art/c7-pact-cards.png、c7-pact-taken.png、c7-result.json
 *
 * 断言：卡进池 / 祝福收益与代价 / 诅咒收益与代价 / 一局一次 / 重开复位 / 帧率与截图。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9506;
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
  await sleep(2000);

  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1100);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);

  // ---------- C7-0 基线：无契约时的受伤数值 ----------
  const baseline = await ev(`(function(){
    var d = window.__roamDebug;
    var s = state;
    s.player.invuln = 0;                 // 关掉无敌帧，否则伤害会被整段挡掉
    s.player.hp = s.player.hpMax;
    s.mods.pactTakenMul = 1;             // 确保基线干净
    var r = d.damagePlayer(20);
    s.player.hp = s.player.hpMax;
    s.player.invuln = 9999;
    return { applied: r.applied, pacts: d.pacts() };
  })()`);
  ok('C7-0 基线：无契约时 20 点伤害原样结算（applied=20）',
    baseline.applied === 20 && baseline.pacts.pactTakenMul === 1,
    baseline);

  // ---------- C7-1 两条契约进池 + 卡面标签「契约」 ----------
  const poolScan = await ev(`(function(){
    var seen = { 'pact:overclock': null, 'pact:greed': null };
    var tries = 0;
    while (tries < 60 && (!seen['pact:overclock'] || !seen['pact:greed'])) {
      tries += 1;
      var keys = window.__roamDebug.openReward('skill');
      keys.forEach(function(key){
        if (key in seen && !seen[key]) {
          var card = document.querySelector('[data-reward-key="' + key + '"]');
          seen[key] = {
            tag: card ? card.querySelector('.r-tag').textContent : null,
            name: card ? card.querySelector('.r-name').textContent : null,
            rarity: card ? card.querySelector('.r-rarity').textContent : null
          };
        }
      });
    }
    return { tries: tries, seen: seen, current: state.upgradeOptions.map(function(o){ return o.key; }) };
  })()`);
  await shot('c7-pact-cards.png');
  ok('C7-1 两条契约能进三选一池，卡面标签为「契约」',
    !!poolScan.seen['pact:overclock'] && !!poolScan.seen['pact:greed']
    && poolScan.seen['pact:overclock'].tag === '契约' && poolScan.seen['pact:greed'].tag === '契约',
    poolScan);

  // ---------- C7-2 / C7-3 祝福 · 锋刃协议 ----------
  const bless = await ev(`(function(){
    var d = window.__roamDebug;
    var tries = 0;
    while (tries < 60 && !state.upgradeOptions.some(function(o){ return o.key === 'pact:overclock'; })) {
      tries += 1; d.openReward('skill');
    }
    var before = d.pacts();
    var picked = d.chooseReward('pact:overclock');
    var after = d.pacts();
    return { tries: tries, picked: picked, before: before, after: after };
  })()`);
  ok('C7-2 祝福收益：选后伤害倍率 ×1.12、标记已取',
    bless.picked === true && bless.after.pactBlessTaken === true
    && Math.abs(bless.after.damageMul - bless.before.damageMul * 1.12) < 1e-6,
    bless);

  const blessCost = await ev(`(function(){
    var d = window.__roamDebug;
    d.skipPassive();                       // 结束本次奖励流程回到 playing
    var s = state;
    s.player.invuln = 0;
    s.player.hp = s.player.hpMax;
    var r = d.damagePlayer(20);
    s.player.hp = s.player.hpMax;
    s.player.invuln = 9999;
    return { applied: r.applied, pacts: d.pacts(), mode: s.mode };
  })()`);
  ok('C7-3 祝福代价：受到伤害 +10%（20 → 22）',
    blessCost.applied === 22 && Math.abs(blessCost.pacts.pactTakenMul - 1.10) < 1e-6,
    blessCost);

  // ---------- C7-4 / C7-5 诅咒 · 贪婪回路 ----------
  const curse = await ev(`(function(){
    var d = window.__roamDebug;
    var tries = 0;
    while (tries < 60 && !state.upgradeOptions.some(function(o){ return o.key === 'pact:greed'; })) {
      tries += 1; d.openReward('skill');
    }
    var before = { crystals: state.meta.crystals, hpMax: state.player.hpMax, hp: state.player.hp, hpBonus: state.mods.hpBonus };
    var picked = d.chooseReward('pact:greed');
    var after = { crystals: state.meta.crystals, hpMax: state.player.hpMax, hp: state.player.hp, hpBonus: state.mods.hpBonus };
    var key = GAME_CONFIG.metaKey;
    var raw = window.localStorage.getItem(key);
    var saved = raw ? JSON.parse(raw) : null;
    return {
      tries: tries, picked: picked, before: before, after: after,
      savedCrystals: saved ? saved.crystals : null,
      pacts: d.pacts()
    };
  })()`);
  await shot('c7-pact-taken.png');
  ok('C7-4 诅咒收益：永久结晶 +2 且已写盘',
    curse.picked === true && curse.after.crystals === curse.before.crystals + 2
    && curse.savedCrystals === curse.after.crystals,
    curse);
  ok('C7-5 诅咒代价：最大生命 −8，当前血量被夹回新上限内且 ≥1',
    curse.after.hpMax === curse.before.hpMax - 8
    && curse.after.hp >= 1 && curse.after.hp <= curse.after.hpMax,
    curse);

  // ---------- C7-6 一局各一次 ----------
  const onceOnly = await ev(`(function(){
    var d = window.__roamDebug;
    d.skipPassive();
    var seen = [];
    for (var i = 0; i < 60; i += 1) {
      var keys = d.openReward('skill');
      keys.forEach(function(k){ if (k.indexOf('pact:') === 0) seen.push(k); });
    }
    return { seen: seen, pacts: d.pacts() };
  })()`);
  ok('C7-6 一局一次：取过后 60 次生成里不再出现契约卡',
    onceOnly.seen.length === 0 && onceOnly.pacts.pactBlessTaken && onceOnly.pacts.pactCurseTaken,
    onceOnly);

  // ---------- C7-7 重开复位 ----------
  await ev(`window.__roamDebug.restart()`);
  await sleep(900);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);
  const reset = await ev(`window.__roamDebug.pacts()`);
  ok('C7-7 重开复位：两个标记 false、pactTakenMul 与伤害倍率回 1',
    reset.pactBlessTaken === false && reset.pactCurseTaken === false
    && reset.pactTakenMul === 1 && reset.damageMul === 1,
    reset);

  // ---------- C7-8 帧率 / 异常 / 截图 ----------
  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  const names = ['c7-pact-cards.png', 'c7-pact-taken.png'];
  const sizes = names.map((n) => {
    try { return fs.statSync(path.join(OUT_DIR, n)).size; } catch (e) { return 0; }
  });
  const mode = await ev(`state.mode`);
  ok('C7-8 帧率 ≥90 / 无脚本错误 / 2 张截图 >10KB / 仍在游戏中',
    fps >= 90 && errors === 0 && sizes.every((s) => s > 10240) && mode === 'playing',
    { fps, errors, sizes, mode });

  fs.writeFileSync(path.join(OUT_DIR, 'c7-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== c7 ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
