// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 诊断 2：直接在页面里复算 applyExplosion 的中间量，找出 NaN 来源
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9735;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  const out = await ev(`(function(){
    var cfg = EXPLOSION_CONFIG;
    var attack = window.__roamDebug.getState();
    var e = state.enemies[0] || null;
    var probe = {
      hasEnemy: !!e,
      enemyX: e ? e.x : null, enemyY: e ? e.y : null, enemyRadius: e ? e.radius : null,
      nova: cfg.nova, fireball: cfg.fireball,
      novaSplash: cfg.nova.splash, novaRadius: cfg.nova.radius,
      clampSrc: clamp.toString().slice(0, 120),
      distSrc: dist.toString().slice(0, 120),
      magicDamage: getMagicDamage(MAGIC_BY_ID['fireball'], null),
      fusionDamage: getMagicDamage(MAGIC_BY_ID['fireball'], FUSION_BY_ID['novaBurst']),
      damageMul: state.mods.damageMul,
      fusionBonus: getFusionDamageBonus(),
      talents: state.meta.talents
    };
    if (e) {
      var d = dist(e.x, e.y, e.x, e.y);
      probe.distResult = d;
      probe.t = clamp(d / Math.max(1, cfg.nova.radius), 0, 1);
      probe.scale = 1 - (1 - cfg.nova.splash) * probe.t;
      probe.amount = Math.max(1, probe.fusionDamage * probe.scale);
    }
    return probe;
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close(); killEdge(edge); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
