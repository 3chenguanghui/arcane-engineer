/**
 * U11a「商店房 + 局内货币余烬」验收脚本（端口 9501）
 * 用法：node tools/arcane_u11.js
 * 输出：.screenshots/art/u11-*.png + u11-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9501;
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
  /**
   * 整屏截图
   * @param {string} name 文件名
   */
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

  // ---------- 0. 进游戏 ----------
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1200);
  const mode = await ev(`(function(){ var l = document.querySelector('#titleLayer'); return l && l.classList.contains('hidden') ? 'playing' : 'title'; })()`);
  ok('进入游戏', mode === 'playing', mode);

  // ---------- 1. 商店房覆盖：大房间层必有、每层最多 1 间、整体至少 2 层 ----------
  let audit = await ev(`window.__roamDebug.shopAudit()`);
  let shopFloor = -1;
  const multi = [];
  const bigWithoutShop = [];
  const covered = [];
  for (let f = 2; f <= 12; f += 1) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(390);
    const a = await ev(`window.__roamDebug.shopAudit()`);
    if (a.counts.shopRooms > 1) multi.push({ floor: f, n: a.counts.shopRooms });
    if (a.counts.shopRooms >= 1) covered.push(f);
    // 6 间房及以上时，"让位房"必然存在（保底三保证有宝箱/事件），所以商店必须出现
    if (a.roomCount >= 6 && a.counts.shopRooms === 0) bigWithoutShop.push({ floor: f, rooms: a.roomCount });
  }
  ok('第 2 层起至少 2 层有商店房（11 层抽样）', covered.length >= 2, { covered: covered });
  ok('每层最多 1 间商店房', multi.length === 0, { offending: multi });
  ok('房间数 ≥6 的层必生成商店房', bigWithoutShop.length === 0, { offending: bigWithoutShop });

  // 注意：setFloor 会重新生成整层（房型随机），所以"统计用的那层"不能拿来继续测。
  // 这里重新滚一遍，命中商店房就停在这一层，后续测试都在这个活地图上做。
  for (let f = 2; f <= 12 && shopFloor < 0; f += 1) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(390);
    const a = await ev(`window.__roamDebug.shopAudit()`);
    if (a.roomId >= 0 && a.counts.pedestals === 3) { shopFloor = f; audit = a; }
  }
  const peds = (audit.pedestals || []);
  const midX = peds.length ? Math.round(peds.reduce((s, p) => s + p.x, 0) / peds.length) : 0;
  const midY = peds.length ? Math.round(peds.reduce((s, p) => s + p.y, 0) / peds.length) : 0;

  // ---------- 2. 商店房不刷怪、不上闸 ----------
  ok('商店房不刷怪、不上闸', audit.roomType === 'shop' && audit.roomEnemies === 0 && audit.roomLocked === false,
    { roomType: audit.roomType, enemies: audit.roomEnemies, locked: audit.roomLocked });

  // ---------- 3. 展台 3 座且落点合法 ----------
  const farOk = (v, min) => v === null || v >= min;   // Infinity 经 CDP 序列化会变成 null
  const spacingOk = peds.every((p, i) => peds.every((q, j) => (
    i === j || Math.hypot(p.x - q.x, p.y - q.y) >= 51.5
  )));
  const pedsLegal = peds.length === 3
    && peds.every((p) => p.walkable === true && p.blocked === false && farOk(p.doorGap, 40))
    && spacingOk;
  ok('展台 3 座且落点合法（可走 / 不堵门 / 间距 ≥52）', pedsLegal,
    { count: peds.length, spacingOk: spacingOk, sample: peds[0] || null });

  // ---------- 4. 走进商店房：展台全景截图 + 靠近提示 ----------
  await ev(`window.__roamDebug.teleport(${midX}, ${midY})`);
  await sleep(340);
  await ev(`window.__roamDebug.addEmbers(40)`);
  // 关掉"首局三步"提示（0–15s 的移动/施法/影步教学优先级最高，会把商店提示盖掉）
  await ev(`(function(){ state.meta.hintsSeen = 1; return true; })()`);
  await sleep(300);
  const shotShop = await shot('u11-shop.png');
  // 贴到第一座展台旁，才进 60px 交互半径（房心到展台通常 >60）
  await ev(`window.__roamDebug.teleport(${peds.length ? peds[0].x + 22 : midX}, ${peds.length ? peds[0].y + 4 : midY})`);
  await sleep(260);
  const hint = await ev(`(function(){
    var el = document.querySelector('#contextHint');
    return el ? { text: el.innerText, key: el.dataset.key || '' } : null;
  })()`);
  ok('#contextHint 出现"按 E 购买"提示', !!hint && /按 E 购买/.test(hint.text), hint);

  // ---------- 5. 买不起：不扣钱、不改属性 ----------
  await ev(`window.__roamDebug.setEmbers(0)`);
  await ev(`window.__roamDebug.teleport(${midX}, ${midY})`);
  await sleep(160);
  const poor = await ev(`window.__roamDebug.buyAtShop(0)`);
  ok('余烬不足时购买失败且不扣钱', poor && poor.ok === false && poor.reason === 'poor' && poor.embers === 0,
    { reason: poor ? poor.reason : null, embers: poor ? poor.embers : null });

  // ---------- 7~9. 三件商品各买一次 ----------
  await ev(`window.__roamDebug.setEmbers(40)`);
  const base = await ev(`({
    aetherMax: window.__roamDebug.getState().aetherMax,
    hpMax: window.__roamDebug.getState().hpMax,
    hp: window.__roamDebug.getState().hp,
    damageMul: window.__roamDebug.getState().damageMul
  })`);

  const buyCell = await ev(`window.__roamDebug.buyAtShop(0)`);
  ok('买奥能电池：扣 8 余烬 + 奥能上限 +12 并回满',
    buyCell.ok === true && buyCell.embers === 32 && buyCell.aetherMax === base.aetherMax + 12
    && buyCell.aether === buyCell.aetherMax, buyCell);

  await sleep(110);
  const shotBuy = await shot('u11-buy.png');   // 只买第一件时截，画面不会三条飘字叠在一起

  const buyRune = await ev(`window.__roamDebug.buyAtShop(1)`);
  ok('买护心符文：扣 9 余烬 + 生命上限 +10 并回血',
    buyRune.ok === true && buyRune.embers === 23 && buyRune.hpMax === base.hpMax + 10
    && buyRune.hp >= Math.min(base.hp + 10, buyRune.hpMax), buyRune);

  const buyPrism = await ev(`window.__roamDebug.buyAtShop(2)`);
  const prismOk = buyPrism.ok === true && buyPrism.embers === 11
    && Math.abs(buyPrism.damageMul - base.damageMul * 1.05) < 1e-6;
  ok('买棱镜透镜：扣 12 余烬 + 本局伤害 ×1.05', prismOk, buyPrism);

  // ---------- 10. 售罄不可重复 ----------
  const rebuy = await ev(`window.__roamDebug.buyAtShop(0)`);
  ok('售罄后不可重复购买（余烬不变）',
    rebuy && rebuy.ok === false && rebuy.reason === 'sold' && rebuy.embers === 11,
    { reason: rebuy ? rebuy.reason : null, embers: rebuy ? rebuy.embers : null });

  // ---------- 余烬来源：击杀掉余烬（放在截图之后，避免"暴击/拾取"飘字糊住商店画面） ----------
  await ev(`window.__roamDebug.setEmbers(0)`);
  for (let k = 0; k < 3; k += 1) {
    await ev(`window.__roamDebug.spawnEnemyAt('chaser', ${midX + 40 + k * 16}, ${midY + 40}, { roomId: -1 })`);
  }
  await sleep(120);
  const countBefore = await ev(`window.__roamDebug.enemyCount()`);
  for (let k = 0; k < 3; k += 1) await ev(`window.__roamDebug.hitNearest(999)`);
  await sleep(320);
  const embersAfterKill = await ev(`window.__roamDebug.embers()`);
  const countAfter = await ev(`window.__roamDebug.enemyCount()`);
  const killed = countBefore - countAfter;
  ok('击杀发余烬（每个普通敌人 +1）', killed >= 3 && embersAfterKill >= killed,
    { killed: killed, embers: embersAfterKill });

  // ---------- 11. E 键在展台旁被吞掉（不会误下楼） ----------
  const nearPed = peds[0] || { x: midX, y: midY };
  await ev(`window.__roamDebug.teleport(${nearPed.x + 20}, ${nearPed.y + 6})`);
  await sleep(220);
  const floorBeforeE = await ev(`window.__roamDebug.getState().floor`);
  const press = await ev(`window.__roamDebug.pressE()`);
  await sleep(260);
  const floorAfterE = await ev(`window.__roamDebug.getState().floor`);
  ok('展台旁按 E 只触发购买链路，不会下楼', press.floor === floorBeforeE && floorAfterE === floorBeforeE,
    { before: floorBeforeE, after: floorAfterE });

  // ---------- 12. A/B 关闭：整层没有商店 ----------
  const oldRoom = audit.roomId;
  await ev(`window.__roamDebug.setU11(false)`);
  await sleep(120);
  const offNow = await ev(`window.__roamDebug.shopAudit()`);
  await ev(`window.__roamDebug.setFloor(${shopFloor + 1})`);
  await sleep(480);
  const offAudit = await ev(`window.__roamDebug.shopAudit()`);
  const offOk = offNow.enabled === false && offNow.counts.pedestals === 0
    && offAudit.enabled === false && offAudit.roomId === -1 && offAudit.counts.shopRooms === 0;
  ok('A/B 关闭后不生成商店房、展台 0', offOk,
    { immediate: offNow.counts, nextFloor: offAudit.counts });
  const shotOff = await shot('u11-off.png');

  // ---------- 13. 换层清理 ----------
  await ev(`window.__roamDebug.setU11(true)`);
  await sleep(120);
  let reAudit = null;
  for (let f = 2; f <= 12 && (!reAudit || reAudit.roomId < 0); f += 1) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(390);
    reAudit = await ev(`window.__roamDebug.shopAudit()`);
  }
  ok('A/B 重开后恢复生成', !!reAudit && reAudit.enabled === true && reAudit.roomId >= 0
    && reAudit.counts.pedestals === 3, { roomId: reAudit ? reAudit.roomId : null, counts: reAudit ? reAudit.counts : null });

  await ev(`window.__roamDebug.setFloor(${shopFloor + 2})`);
  await sleep(480);
  const nextAudit = await ev(`window.__roamDebug.shopAudit()`);
  const newRoom = nextAudit.roomId;
  const staleBuy = await ev(`window.__roamDebug.buyAtShop(0)`);
  // 换层后玩家在出生房，旧展台坐标一律失效：要么该层没有商店，要么"不在商店房"直接拒绝
  ok('换层后旧商店失效（展台重建 / 旧房不可买）',
    nextAudit.floor === shopFloor + 2 && staleBuy.ok === false && staleBuy.reason === 'noRoom',
    { oldRoom: oldRoom, newRoom: newRoom, buy: staleBuy });

  // ---------- 14. 性能 + 错误 ----------
  await ev(`window.__roamDebug.clearEnemies()`);
  const perf = await ev(`(function(){
    return new Promise(function(resolve){
      var frames = 0;
      var t0 = performance.now();
      function tick(){
        frames += 1;
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
        else resolve({ fps: frames / ((performance.now() - t0) / 1000), errors: (window.__errors || []).slice(0, 6) });
      }
      requestAnimationFrame(tick);
    });
  })()`);
  ok('帧率 ≥ 60', perf.fps >= 60, { fps: Math.round(perf.fps * 10) / 10 });
  ok('运行期无脚本错误', (perf.errors || []).length === 0, perf.errors);

  // ---------- 15. 截图体积 ----------
  const names = ['u11-shop.png', 'u11-buy.png', 'u11-off.png'];
  const sizes = names.map((n) => {
    const p = path.join(OUT_DIR, n);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  });
  ok('3 张截图均 > 10KB', sizes.every((s) => s > 10240), sizes);

  const passed = asserts.filter((a) => a.pass).length;
  console.log('----------------------------------------');
  console.log('U11 · ' + passed + '/' + asserts.length + ' PASS');
  console.log('PERF ' + JSON.stringify({ avgFps: Math.round(perf.fps * 10) / 10, errors: perf.errors.length }));
  fs.writeFileSync(path.join(OUT_DIR, 'u11-result.json'),
    JSON.stringify({ passed: passed, total: asserts.length, asserts: asserts, perf: perf }, null, 2));

  void shotShop;
  void shotBuy;
  void shotOff;
  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (passed < asserts.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
});
