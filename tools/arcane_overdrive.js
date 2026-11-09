/**
 * P2 合体过载验收：A1–A6
 * 用法：node tools/arcane_overdrive.js
 * 端口：9513
 * 输出：.screenshots/art/p2-overdrive.png、p2-overdrive-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9513;
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
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1400);
  await ev(`(function(){
    state.player.invuln = 9999;
    state.overdrive = { window: 0, fusionId: null, buffTime: 0, used: 0, last: null };
    if (state.ownedTech.indexOf('amp') < 0) state.ownedTech.push('amp');
    return true;
  })()`);

  // ---------- A1：融合成功即开窗口 ----------
  const a1 = await ev(`(function(){
    state.fusions = [];
    state.ownedMagic = ['fireball'];
    var fused = window.__roamDebug.overdrive.fuse();
    var info = window.__roamDebug.overdrive.info();
    return { fused: fused, info: info, fusions: state.fusions.slice() };
  })()`);
  ok('A1 融合成功 → 窗口 0.45s、fusionId 有值',
    a1.fused === true && a1.info.window > 0.3 && a1.info.window <= 0.46 && !!a1.info.fusionId, a1);

  // ---------- A2：奥能 0 时按 F → 拒绝并立刻关窗 ----------
  const a2 = await ev(`(function(){
    state.player.aether = 0;
    var r = window.__roamDebug.overdrive.press();
    var info = window.__roamDebug.overdrive.info();
    return { r: r, info: info };
  })()`);
  ok('A2 奥能不足 → reason=aether / 窗口归零 / 不产生超频',
    a2.r.ok === false && a2.r.reason === 'aether' && a2.info.window === 0
      && a2.info.buffTime === 0 && a2.info.aether === 0, a2);

  // ---------- A3：奥能满 → 成功过载，扣 35% 最大奥能，伤害 1.5× ----------
  const a3 = await ev(`(function(){
    state.fusions = [];
    window.__roamDebug.overdrive.fuse();
    var dmgBefore = window.__roamDebug.overdrive.damage('fireball');
    var maxAether = state.player.aetherMax;
    window.__roamDebug.overdrive.fillAether();
    var r = window.__roamDebug.overdrive.press();
    var dmgAfter = window.__roamDebug.overdrive.damage('fireball');
    return {
      r: r, dmgBefore: dmgBefore, dmgAfter: dmgAfter,
      ratio: dmgBefore ? dmgAfter / dmgBefore : 0,
      expectedCost: Math.max(1, Math.round(maxAether * OVERDRIVE_CONFIG.costRatio)),
      aether: state.player.aether, info: window.__roamDebug.overdrive.info()
    };
  })()`);
  ok('A3 过载生效（扣 35% 最大奥能 / used=1 / buff≈8s / 伤害 ×1.5）',
    a3.r.ok === true && a3.r.cost === a3.expectedCost
      && a3.aether === a3.info.aetherMax - a3.expectedCost
      && a3.info.used === 1 && a3.info.buffTime > 7.9
      && Math.abs(a3.ratio - 1.5) < 0.03, a3);

  // ---------- A4：超频期冷却 ×0.8 ----------
  const a4 = await ev(`(function(){
    state.cooldowns = {};
    state.activeMagicId = 'fireball';
    state.player.aether = state.player.aetherMax;
    var base = MAGIC_BY_ID.fireball.cooldown * state.mods.cooldownMul;
    var cast = castPrimary();
    var cd = state.cooldowns.fireball;
    return { cast: cast, cd: cd, base: base, ratio: cd / base };
  })()`);
  ok('A4 超频期冷却 ×0.8',
    a4.cast === true && Math.abs(a4.ratio - 0.8) < 0.02, a4);

  // ---------- A5：真实时间递减（窗口与超频都会到期，伤害回基准） ----------
  const a5a = await ev(`(function(){
    var od = state.overdrive;
    od.window = 0.1;
    od.buffTime = 0.25;
    return { window: od.window, buffTime: od.buffTime };
  })()`);
  await sleep(700);
  const a5b = await ev(`(function(){
    return {
      info: window.__roamDebug.overdrive.info(),
      dmg: window.__roamDebug.overdrive.damage('fireball')
    };
  })()`);
  const dmgBase = a3.dmgBefore;
  ok('A5 真实时间递减（window/buff 双双归零，伤害回基准）',
    a5b.info.window === 0 && a5b.info.buffTime === 0
      && Math.abs(a5b.dmg - dmgBase) < 0.5, { before: a5a, after: a5b, dmgBase });

  // ---------- A6：次数用尽 + HUD 细条 + 无错误 + 帧率 + 截图 ----------
  const a6 = await ev(`(function(){
    var od = state.overdrive;
    od.used = OVERDRIVE_CONFIG.maxPerRun;
    od.window = 0.45;
    od.fusionId = state.fusions[state.fusions.length - 1];
    window.__roamDebug.overdrive.fillAether();
    var r = window.__roamDebug.overdrive.press();
    // 手动点亮超频，检查细条（截图要在亮的时候拍）
    od.buffTime = 2.5;
    update(0.01);
    var bar = document.getElementById('overdriveBar');
    var visible = bar.classList.contains('is-on');
    var buff = bar.classList.contains('is-buff');
    var label = document.getElementById('overdriveLabel').textContent;
    return { r: r, visible: visible, buff: buff, label: label, info: window.__roamDebug.overdrive.info() };
  })()`);
  await shot('p2-overdrive.png');
  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  let size = 0;
  try { size = fs.statSync(path.join(OUT_DIR, 'p2-overdrive.png')).size; } catch (e) { size = 0; }
  ok('A6 第 4 次拒绝(usedUp) / HUD 细条点亮 / 无错误 / fps≥60 / 截图>10KB',
    a6.r.ok === false && a6.r.reason === 'usedUp' && a6.info.used === 3
      && a6.visible === true && a6.buff === true && a6.label.indexOf('过载') >= 0
      && errors === 0 && fps >= 60 && size > 10240,
    { a6, fps, errors, size });

  fs.writeFileSync(path.join(OUT_DIR, 'p2-overdrive-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== p2-overdrive ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
