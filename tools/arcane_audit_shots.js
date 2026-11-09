// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// 审计/迭代截图脚本：开始页 → 开局扫描 → 三层战斗 → 命中 → 击杀/奖励 → 规则 → 下楼转场 → 受伤故障 → 低血 → 结算
// 用法：node arcane_audit_shots.js <html绝对路径> <输出目录>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9681;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'audit_shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push('CONSOLE.ERROR: ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const fpsSample = async () => {
    const list = [];
    for (let i = 0; i < 5; i += 1) {
      list.push(await ev('window.__roamDebug.getState().fps'));
      await sleep(160);
    }
    return list;
  };

  const report = { shots: [], fps: {}, fx: {}, check: null, consoleErrors };

  // 1. 标题页
  await shot('01_title.png');
  report.shots.push('01_title.png');

  // 2. 开局：CRT 扫描演出（约 0.6s）
  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(240);
  await shot('02_start_scan.png');
  report.fx.startScan = await ev(`(window.__roamDebug.getState().fx||{}).scanline`);
  report.shots.push('02_start_scan.png');
  await sleep(700);

  // 3. 第一层战斗
  await ev(`(() => { const d = window.__roamDebug; d.centerPlayer(); d.spawnEnemy('wanderer', 210, -130); d.spawnEnemy('sentinel', -220, 40); d.spawnEnemy('shooter', 40, 220); return d.getState().floor; })()`);
  await sleep(430);
  await shot('03_battle_f1.png');
  report.shots.push('03_battle_f1.png');
  report.fps.battleF1 = await fpsSample();

  // 4. 命中演出：轻击（冲击线）→ 重击
  await ev(`window.__roamDebug.hitNearest ? window.__roamDebug.hitNearest(12) : null`);
  await sleep(55);
  await shot('04_hit_light.png');
  report.fx.impactLight = await ev(`(window.__roamDebug.getState().fx||{}).impacts`);
  report.shots.push('04_hit_light.png');
  await sleep(260);
  await ev(`window.__roamDebug.hitNearest ? window.__roamDebug.hitNearest(46) : null`);
  await sleep(55);
  await shot('05_hit_heavy.png');
  report.fx.impactHeavy = await ev(`(window.__roamDebug.getState().fx||{}).impacts`);
  report.shots.push('05_hit_heavy.png');

  // 5. 击杀（像素崩解）+ 清场奖励
  await ev(`window.__roamDebug.killAllEnemies()`);
  await sleep(120);
  await shot('06_kill_shatter.png');
  report.fx.shards = await ev(`(window.__roamDebug.getState().fx||{}).shards`);
  report.shots.push('06_kill_shatter.png');
  await sleep(520);
  await shot('07_reward.png');
  report.shots.push('07_reward.png');

  // 6. 规则页
  await ev(`(() => { const d = window.__roamDebug; const o = d.getState().options; if (o.length) d.chooseReward(o[0]); return true; })()`);
  await sleep(300);
  await ev(`document.getElementById('btnRules').click(); true`);
  await sleep(560);
  await shot('08_rules.png');
  report.shots.push('08_rules.png');
  await ev(`(() => { const b = document.getElementById('btnCloseRules'); if (b) b.click(); else document.getElementById('btnRules').click(); return true; })()`);
  await sleep(320);

  // 7. 二/三层战斗（主题差异）
  await ev(`(() => { const d = window.__roamDebug; d.setFloor(2); d.centerPlayer(); d.spawnEnemy('wanderer', 215, 60); d.spawnEnemy('shooter', -205, -55); return true; })()`);
  await sleep(430);
  await shot('09_battle_f2.png');
  report.shots.push('09_battle_f2.png');
  await ev(`(() => { const d = window.__roamDebug; d.setFloor(3); d.centerPlayer(); d.spawnEnemy('phaser', 215, -105); d.spawnEnemy('wanderer', -195, 120); return true; })()`);
  await sleep(430);
  await shot('10_battle_f3.png');
  report.shots.push('10_battle_f3.png');
  report.fps.battleF3 = await fpsSample();

  // 8. 下楼像素溶解（0.2s 覆盖期 / 0.55s 散开期各一张）
  await ev(`(() => { const d = window.__roamDebug; d.setFloor(4); d.countFpsReset && d.countFpsReset(); d.descend(); return true; })()`);
  await sleep(190);
  await shot('11_descend_cover.png');
  report.fx.descend = await ev(`(window.__roamDebug.getState().fx||{}).dissolve`);
  report.shots.push('11_descend_cover.png');
  report.fps.descend = await fpsSample();
  await sleep(430);
  await shot('12_descend_reveal.png');
  report.shots.push('12_descend_reveal.png');
  await sleep(300);

  // 9. 玩家重伤故障
  await ev(`(() => { const d = window.__roamDebug; d.setHp(80); d.damagePlayer(34, d.getState().player.x + 40, d.getState().player.y); return true; })()`);
  await sleep(90);
  await shot('13_player_glitch.png');
  report.fx.heavyGlitch = await ev(`(window.__roamDebug.getState().fx||{}).glitch`);
  report.shots.push('13_player_glitch.png');
  await sleep(500);

  // 10. 低血阈值一次演出
  await ev(`(() => { const d = window.__roamDebug; const s = d.getState(); d.setHp(Math.round(s.hpMax * 0.28)); d.damagePlayer(1, s.player.x + 40, s.player.y); return d.getState().fx || null; })()`);
  await sleep(120);
  await shot('14_lowhp.png');
  report.fx.lowHp = await ev(`window.__roamDebug.getState().fx||null`);
  report.shots.push('14_lowhp.png');
  await sleep(700);

  // 11. 结算（死亡故障撕裂）
  await ev(`(() => { const d = window.__roamDebug; d.setHp(d.getState().hpMax); d.forceDeath(); return true; })()`);
  await sleep(120);
  await shot('15_death_glitch.png');
  report.fx.deathGlitch = await ev(`(window.__roamDebug.getState().fx||{}).glitch`);
  report.shots.push('15_death_glitch.png');
  await sleep(600);
  await shot('16_result.png');
  report.shots.push('16_result.png');

  // 12. 布局 / 报错 / 帧率
  report.check = await ev(`(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }; };
    const deck = box('.hud-deck'), map = box('.minimap-panel'), fp = box('.floor-panel'), top = box('.hud-top'), modal = box('.modal');
    const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.b && b.y < a.b;
    return {
      viewW: window.innerWidth, viewH: window.innerHeight,
      deck, map, fp, top, modal,
      deckInView: deck ? (deck.b <= window.innerHeight + 1 && deck.x >= 0) : null,
      mapOverlapsDeck: overlap(map, deck),
      fpOverlapsMap: overlap(fp, map),
      fpOverlapsDeck: overlap(fp, deck),
      modalWithinView: modal ? (modal.y >= 0 && modal.b <= window.innerHeight + 1) : null
    };
  })()`);
  report.injectedErrors = await ev(`window.__roamDebug.errors()`);
  report.fps.result = await fpsSample();

  // 13. 重开是否正常（溶解 + 回到第 1 层）
  await ev(`window.__roamDebug.restart()`);
  await sleep(260);
  await shot('17_restart.png');
  report.fx.restart = await ev(`(window.__roamDebug.getState().fx||{}).dissolve`);
  report.shots.push('17_restart.png');
  await sleep(700);
  report.afterRestart = await ev(`(() => { const s = window.__roamDebug.getState(); return { mode: s.mode, floor: s.floor, hp: s.hp, enemies: s.enemies, dissolve: s.fx ? s.fx.dissolve : null }; })()`);

  console.log(JSON.stringify(report, null, 2));
  ws.close();
  killEdge(edge);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });




