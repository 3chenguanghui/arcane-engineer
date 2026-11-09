/**
 * U10「爆炸桶 + 可破坏墙」验收脚本（端口 9500）
 * 用法：node tools/arcane_u10.js
 * 输出：.screenshots/art/u10-*.png + u10-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500;
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

  // ---------- 1. 找到同时有桶和墙的层 ----------
  let audit = await ev(`window.__roamDebug.u10Audit()`);
  for (let f = 2; f <= 8 && (audit.counts.barrels < 1 || audit.counts.breakables < 1); f += 1) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(420);
    audit = await ev(`window.__roamDebug.u10Audit()`);
  }
  const farOk = (v, min) => v === null || v >= min;   // Infinity 经 CDP 序列化会变成 null
  const barrelsLegal = audit.barrels.length >= 1 && audit.barrels.every((b) => (
    b.walkable === true && b.blocked === false && farOk(b.runeGap, 42) && farOk(b.doorGap, 46)
  ));
  ok('每层有桶且落点合法', barrelsLegal, {
    count: audit.counts.barrels,
    sample: audit.barrels[0] || null
  });

  // ---------- 2. 砖墙已注册进 walkBlockers ----------
  const wall = audit.breakables[0];
  const wallOk = !!wall && audit.counts.wallBlockers >= 1 && wall.centerBlocked === true;
  ok('墙初始不可走（已注册到 walkBlockers）', wallOk, {
    count: audit.counts.breakables, wallBlockers: audit.counts.wallBlockers,
    centerBlocked: wall ? wall.centerBlocked : null
  });

  // ---------- 3. 桶旁截图 ----------
  const barrel = audit.barrels[0];
  await ev(`window.__roamDebug.teleport(${barrel.x + 34}, ${barrel.y + 8})`);
  await sleep(320);
  const shotBarrel = await shot('u10-barrel.png');

  // ---------- 4. 打 10 点：掉血但不爆 ----------
  const hpBefore10 = barrel.hp;
  const r10 = await ev(`window.__roamDebug.hitBarrel('${barrel.uid}', 10)`);
  ok('打 10 点掉血但没爆', r10 && r10.hp === hpBefore10 - 10 && r10.exploded === false,
    { before: hpBefore10, after: r10 ? r10.hp : null, exploded: r10 ? r10.exploded : null });

  // ---------- 5. 打爆伤敌 ----------
  const spawnInfo = await ev(`window.__roamDebug.spawnEnemyAt('chaser', ${barrel.x + 26}, ${barrel.y}, { roomId: -1 })`);
  await sleep(80);
  const enemyBefore = await ev(`window.__roamDebug.enemyHpOf(${spawnInfo.id})`);
  await ev(`window.__roamDebug.hitBarrel('${barrel.uid}', 999)`);
  await sleep(220);
  const enemyAfter = await ev(`window.__roamDebug.enemyHpOf(${spawnInfo.id})`);
  const enemyHurt = !enemyAfter || enemyAfter.hp < enemyBefore.hp;
  ok('打爆伤敌', enemyHurt, {
    before: enemyBefore ? enemyBefore.hp : null,
    after: enemyAfter ? enemyAfter.hp : null
  });
  const shotBlast = await shot('u10-blast.png');

  // ---------- 6. 打爆伤己（死因 = barrel，U5 台词能接住） ----------
  await ev(`window.__roamDebug.setFloor(${audit.counts.barrels > 1 ? '1' : '4'})`);
  await sleep(420);
  await ev(`window.__roamDebug.setHp(100)`);
  const audit2 = await ev(`window.__roamDebug.u10Audit()`);
  const barrel2 = audit2.barrels[0];
  if (barrel2) {
    // 先把同房敌人清掉：否则 200ms 内又被接触打一下，lastHit 会被覆盖成 contact，测不到 barrel
    await ev(`window.__roamDebug.clearEnemies()`);
    // 桶附近可能贴着墙/柱，按候选偏移挑一个真正可站立的位置（否则传送到墙里会静默失败）
    const spot = await ev(`(() => {
      const b = ${JSON.stringify(barrel2)};
      const offs = [[18, 0], [-18, 0], [0, 18], [0, -18], [22, 10], [-22, -10], [10, 22], [-10, -22]];
      for (const o of offs) {
        if (window.__roamDebug.walkableAt(b.x + o[0], b.y + o[1], 11)) {
          return { x: b.x + o[0], y: b.y + o[1] };
        }
      }
      return { x: b.x + 18, y: b.y };
    })()`);
    await ev(`window.__roamDebug.teleport(${spot.x}, ${spot.y})`);
    await sleep(260);
    // 进房保护（0.8s）会整段吃掉爆炸，先把无敌帧清零再测"死因 = barrel"
    await ev('window.__roamDebug.resetPlayerInvuln()');
    const hpBefore = await ev(`window.__roamDebug.playerHitInfo()`);
    await ev(`window.__roamDebug.hitBarrel('${barrel2.uid}', 999)`);
    await sleep(60);
    const hpAfter = await ev(`window.__roamDebug.playerHitInfo()`);
    const hurt = hpAfter.hp < hpBefore.hp && hpAfter.lastKind === 'barrel';
    ok('打爆伤己且死因 = barrel', hurt,
      { before: hpBefore.hp, after: hpAfter.hp, lastKind: hpAfter.lastKind, lastAmount: hpAfter.lastAmount });
  } else {
    ok('打爆伤己且死因 = barrel', false, '该层没有桶，无法测试');
  }

  // ---------- 7. 链式有上限：一次爆炸不可能清空本层所有桶 ----------
  const total = audit2.counts.barrels;
  await sleep(320);
  const afterChain = await ev(`window.__roamDebug.propsCount()`);
  const chainOk = total < 2 ? true : afterChain.barrels >= total - 1 - 2;
  ok('链式引爆有上限（单次事件最多连锁 2）', chainOk, { total: total, remaining: afterChain.barrels });

  // ---------- 8. 墙：打穿后可走 + 真的开出捷径 ----------
  await ev(`window.__roamDebug.setFloor(${audit.breakables.length ? '2' : '5'})`);
  await sleep(420);
  let auditWall = await ev(`window.__roamDebug.u10Audit()`);
  for (let f = 3; f <= 8 && auditWall.breakables.length === 0; f += 1) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(420);
    auditWall = await ev(`window.__roamDebug.u10Audit()`);
  }
  const wall2 = auditWall.breakables[0];
  if (wall2) {
    const cx = wall2.x + wall2.w / 2;
    const cy = wall2.y + wall2.h / 2;
    const normalIsX = wall2.w <= wall2.h;    // 薄的那一维就是法线方向
    const pIn = normalIsX ? { x: cx - 22, y: cy } : { x: cx, y: cy + 22 };
    const pOut = normalIsX ? { x: cx + 22, y: cy } : { x: cx, y: cy - 22 };
    const before = await ev(`({
      blocked: window.__roamDebug.walkBlockedAt(${cx}, ${cy}, 6),
      walkable: window.__roamDebug.walkableAt(${cx}, ${cy}, 6)
    })`);
    // isWalkableCircle 内部已包含 isWalkBlocked，所以墙心必然是 blocked=true / walkable=false；
    // "墙确实砌在真地板（走廊）上、不是悬在虚空"这点由下一步"打穿后 walkable 变 true"反证。
    ok('墙心初始不可走', before.blocked === true && before.walkable === false, before);

    // 打穿前先站到墙这一侧拍一张，作为"before / after"对比里的 before
    await ev(`window.__roamDebug.teleport(${pIn.x}, ${pIn.y})`);
    await sleep(300);
    const shotWallBefore = await shot('u10-wall-intact.png');
    void shotWallBefore;

    const broke = await ev(`window.__roamDebug.breakWallTest()`);
    await sleep(260);
    const after = await ev(`({
      blocked: window.__roamDebug.walkBlockedAt(${cx}, ${cy}, 6),
      walkable: window.__roamDebug.walkableAt(${cx}, ${cy}, 6),
      counts: window.__roamDebug.propsCount()
    })`);
    ok('打穿后可走（blocker 已摘掉）',
      after.blocked === false && after.walkable === true && after.counts.wallBlockers === 0,
      { broke: broke, after: after });

    const path = await ev(`({
      pIn: window.__roamDebug.walkableAt(${pIn.x}, ${pIn.y}, 6),
      pOut: window.__roamDebug.walkableAt(${pOut.x}, ${pOut.y}, 6)
    })`);
    ok('破坏后真的开出捷径（交界两侧都能走）', path.pIn === true && path.pOut === true,
      { in: path.pIn, out: path.pOut, points: { pIn: pIn, pOut: pOut } });

    await ev(`window.__roamDebug.teleport(${pIn.x}, ${pIn.y})`);
    await sleep(260);
    const shotWall = await shot('u10-wall-broken.png');
    void shotWall;
  } else {
    const wa = await ev(`window.__roamDebug.wallAudit()`);
    ok('墙心初始不可走', false, { reason: '没找到可破坏墙', corridors: wa });
    ok('打穿后可走（blocker 已摘掉）', false, '没找到可破坏墙');
    ok('破坏后真的开出捷径（交界两侧都能走）', false, '没找到可破坏墙');
  }

  // ---------- 9. 换层清零 ----------
  // uid 是"本层内序号"，换层后会重新从 b1 开始；所以断言口径是：
  // 新层桶数 ≥1 且序号从 b1 起（说明 props 数组重建，而不是旧对象残留）
  const oldCount = auditWall.counts.barrels;
  await ev(`window.__roamDebug.setFloor(6)`);
  await sleep(420);
  const auditNext = await ev(`window.__roamDebug.u10Audit()`);
  const nextUids = auditNext.barrels.map((b) => b.uid);
  const rebuilt = nextUids.length >= 1 && nextUids[0] === 'b1' && auditNext.counts.breakables <= 1;
  ok('换层清零（新层重新生成）', rebuilt,
    { oldCount: oldCount, next: nextUids, breakables: auditNext.counts.breakables });

  // ---------- 10. A/B 关闭 ----------
  await ev(`window.__roamDebug.setU10(false)`);
  const off = await ev(`window.__roamDebug.propsCount()`);
  await ev(`window.__roamDebug.setFloor(7)`);
  await sleep(420);
  const offAudit = await ev(`window.__roamDebug.u10Audit()`);
  const offOk = off.barrels === 0 && off.breakables === 0 && off.wallBlockers === 0 &&
    offAudit.counts.barrels === 0 && offAudit.counts.wallBlockers === 0;
  ok('A/B 关闭后桶 0 / 墙 0', offOk, { immediate: off, nextFloor: offAudit.counts });

  await ev(`window.__roamDebug.setU10(true)`);
  await ev(`window.__roamDebug.setFloor(1)`);
  await sleep(420);
  const backAudit = await ev(`window.__roamDebug.u10Audit()`);
  ok('A/B 重新开启后恢复生成', backAudit.counts.barrels >= 1, backAudit.counts);

  // ---------- 11. 性能 + 错误 ----------
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

  // ---------- 12. 截图体积 ----------
  const sizes = ['u10-barrel.png', 'u10-blast.png', 'u10-wall-intact.png', 'u10-wall-broken.png']
    .map((n) => { const p = path.join(OUT_DIR, n); return fs.existsSync(p) ? fs.statSync(p).size : 0; });
  ok('4 张截图均 > 10KB', sizes.every((s) => s > 10240), sizes);

  const passed = asserts.filter((a) => a.pass).length;
  console.log('----------------------------------------');
  console.log('U10 · ' + passed + '/' + asserts.length + ' PASS');
  console.log('PERF ' + JSON.stringify({ avgFps: Math.round(perf.fps * 10) / 10, errors: perf.errors.length }));
  fs.writeFileSync(path.join(OUT_DIR, 'u10-result.json'),
    JSON.stringify({ passed: passed, total: asserts.length, asserts: asserts, perf: perf }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (passed < asserts.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
});
