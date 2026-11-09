// P5 专项验收：Boss 实体宝箱（原地生成 / 按 E 打开 / 只发一次 / A/B 关闭）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9536;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p5boss');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const pressKey = (key) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  const base = await ev('__roamDebug.bossChest.info()');
  const baseCrystals = base.crystalsEarned;

  // ---- 模拟首领死亡（真实走 onBossDefeated，不是直接调调试接口） ----
  const killed = await ev(`(() => {
    const px = state.player.x + 70;
    const py = state.player.y;
    state.boss = { x: px, y: py, radius: 34, color: '#ff3d6e', accent: '#ffc247',
      hp: 0, defeated: false, intro: false, transition: 0, telegraph: null, hazards: [] };
    onBossDefeated(state.boss);
    return __roamDebug.bossChest.info();
  })()`);
  check('Boss 死亡后原地生成实体宝箱（坐标 = 死亡点）',
    killed.exists === true && Math.abs(killed.x - (await ev('state.boss.x'))) < 2
    && Math.abs(killed.y - (await ev('state.boss.y'))) < 2,
    { chest: killed, boss: await ev('({x: state.boss.x, y: state.boss.y})') });
  check('宝箱生成时不再直接发结晶（延迟到开箱）',
    killed.crystalsEarned === baseCrystals && killed.opened === false, { crystals: killed.crystalsEarned, base: baseCrystals });
  check('宝箱生成后仍处于游戏态（可以走过去，不弹面板）',
    killed.mode === 'playing', { mode: killed.mode });
  await shot('boss-chest-closed.png');

  // ---- 距离：远处按 E 不生效 ----
  const far = await ev(`(() => {
    state.player.x = state.bossChest.x + 200;
    state.player.y = state.bossChest.y;
    const ok = __roamDebug.bossChest.interact();
    return { ok, info: __roamDebug.bossChest.info() };
  })()`);
  check('距离 200px 时按 E 打不开宝箱', far.ok === false && far.info.opened === false,
    { ok: far.ok, dist: far.info.playerDist });

  // ---- 走近按 E：打开 + 演出开始，奖品仍未结算 ----
  await ev(`(() => { state.player.x = state.bossChest.x + 26; state.player.y = state.bossChest.y; return true; })()`);
  await pressKey('e');
  await sleep(320);
  const opening = await ev('__roamDebug.bossChest.info()');
  await shot('boss-chest-open.png');
  check('走到宝箱旁按 E 成功打开，且演出期间奖品尚未发放',
    opening.opened === true && opening.granted === false && opening.crystalsEarned === baseCrystals,
    { opened: opening.opened, granted: opening.granted, crystals: opening.crystalsEarned, showT: opening.showT });
  check('开箱演出有进度（光柱/扇形散开靠 showT 驱动）',
    opening.showT > 0 && opening.showT < 1.2 && opening.fanCount === 6,
    { showT: opening.showT, fanCount: opening.fanCount });

  // ---- 演出结束：发奖一次（史诗 + 结晶） ----
  await sleep(1400);
  const granted = await ev('__roamDebug.bossChest.info()');
  /* 第 12 项节奏收口后 dropCrystals 从 3 → 1：断言改为读配置，语义不变（"只发一次、A/B 关闭即刻发"） */
  const dropCrystals = await ev('BOSS_CONFIG.dropCrystals');
  check('演出结束后结算：结晶 +' + (granted.crystalsEarned - baseCrystals),
    granted.granted === true && granted.crystalsEarned === baseCrystals + dropCrystals,
    { granted: granted.granted, crystals: granted.crystalsEarned, base: baseCrystals });
  check('宝箱只发一次：重复按 E 不会再次结算', await (async () => {
    const r = await ev(`(() => { const before = __roamDebug.bossChest.info(); __roamDebug.bossChest.interact(); const after = __roamDebug.bossChest.info(); return { before, after }; })()`);
    return r.after.crystalsEarned === granted.crystalsEarned && r.after.openCount === 1;
  })(), { openCount: granted.openCount, crystals: granted.crystalsEarned });

  // ---- A/B：关掉实体宝箱 → 回到"死亡即发奖" ----
  const beforeOff = await ev(`(() => {
    __roamDebug.bossChest.set({ enabled: false });
    state.bossChest = null;
    const before = __roamDebug.bossChest.info().crystalsEarned;
    state.boss = { x: state.player.x + 60, y: state.player.y, radius: 34, color: '#ff3d6e',
      accent: '#ffc247', hp: 0, defeated: false, intro: false, transition: 0, telegraph: null, hazards: [] };
    onBossDefeated(state.boss);
    return { before, after: __roamDebug.bossChest.info() };
  })()`);
  check('A/B 关闭：Boss 死亡即刻发结晶（不再生成宝箱）',
    beforeOff.after.crystalsEarned === beforeOff.before + dropCrystals && beforeOff.after.exists === false,
    { before: beforeOff.before, after: beforeOff.after.crystalsEarned, exists: beforeOff.after.exists });
  await ev(`__roamDebug.bossChest.set({ enabled: true }); true`);

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'p5-result.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
