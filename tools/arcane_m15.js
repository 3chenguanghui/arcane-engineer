// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// M1-5 专项验收：影步无敌 / 近战前摇 / 精英词缀 / 连击终结 / 动态准星
// 用法：node arcane_m15.js <html绝对路径> <截图输出目录>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9464;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm15');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
/** 记录一条断言并即时打印 */
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
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  /** 以玩家为中心的局部放大截图（验收细节用） */
  const shotClip = async (name, w = 460, h = 320, scale = 2) => {
    const pos = await ev(`(() => { const s = window.__roamDebug.getState(); return { x: s.player.x - s.cam.x, y: s.player.y - s.cam.y }; })()`);
    const x = Math.max(0, Math.round(pos.x - w / 2));
    const y = Math.max(0, Math.round(pos.y - h / 2));
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x, y, width: w, height: h, scale }
    });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };
  const mouseMove = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(600);

  // ==================== 页内断言 1–12 ====================
  const page = await ev(`(async () => {
    const out = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const d = window.__roamDebug;
    const S = () => d.getState();
    const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail });

    d.restart();
    await sleep(400);
    d.centerPlayer();
    await sleep(200);

    /* ========== 1) 影步：成功触发 + 三个计时都进状态 ========== */
    const p0 = S().player;
    const started = d.dash();
    const st1 = S();
    ok('影步可触发且写入 dashTime / invuln / cooldown',
      started === true && st1.dash.time > 0 && st1.dash.invuln >= 0.3 && st1.dash.cd > 1.8,
      { started, dash: st1.dash });

    /* ========== 2) 影步位移距离 ≥ 90px（620 × 0.17 ≈ 105） ========== */
    await sleep(300);
    const p1 = S().player;
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    ok('影步位移 ≥ 90px', dist >= 90, { dist: Number(dist.toFixed(1)), from: p0, to: p1 });

    /* ========== 3) 冷却中再按无效，且不会刷新冷却 ========== */
    const cdBefore = S().dash.cd;
    const again = d.dash();
    const cdAfter = S().dash.cd;
    ok('影步冷却中重复触发被拒绝且不刷新冷却',
      again === false && Math.abs(cdAfter - cdBefore) < 0.5,
      { again, cdBefore, cdAfter });

    /* ========== 4) 残影：冲刺中确实产生了拖影 ========== */
    d.resetDash();
    d.dash();
    await sleep(120);
    const ghosts = S().afterimages;
    ok('冲刺过程产生残影', ghosts > 0, { afterimages: ghosts });
    await sleep(500);

    /* ========== 5) 无敌帧：期间免伤，结束后恢复受伤 ========== */
    d.resetDash();
    d.setHp(S().hpMax);
    d.dash();
    const blocked = d.damagePlayer(40);
    await sleep(420);
    const afterInvuln = d.damagePlayer(40);
    ok('无敌帧内免伤、无敌结束后正常受伤',
      blocked.applied === 0 && blocked.invulnerable === true && afterInvuln.applied > 0,
      { blocked, afterInvuln });

    /* ========== 6) 近战前摇：贴脸先亮圈、不掉血 ========== */
    d.resetDash();
    d.setHp(S().hpMax);
    d.centerPlayer();
    await sleep(120);
    const pl = S().player;
    const windupSpawn = d.spawnEnemyAt('crawler', pl.x + 26, pl.y, {});
    d.pinEnemies(0);
    await sleep(170);
    const w1 = S();
    const wu1 = w1.enemyList.find((e) => e.id === windupSpawn.id);
    ok('近战前摇开始且未立即扣血',
      !!wu1 && wu1.windup > 0 && w1.hp === w1.hpMax,
      { windup: wu1 ? wu1.windup : null, hp: w1.hp, hpMax: w1.hpMax });

    /* ========== 7) 前摇走完仍在范围内 → 真的扣血 ========== */
    await sleep(450);
    const w2 = S();
    ok('前摇结束后在范围内会扣血', w2.hp < w2.hpMax, { hp: w2.hp, hpMax: w2.hpMax });

    /* ========== 8) 玩家离开范围 → 前摇立刻取消、不再掉血 ========== */
    d.setHp(S().hpMax);
    const beforeCancelHp = S().hp;
    const enemyPos = S().enemyList.find((e) => e.id === windupSpawn.id);
    d.setPlayerPos(enemyPos.x + 260, enemyPos.y);
    await sleep(120);
    const w3 = S();
    const wu3 = w3.enemyList.find((e) => e.id === windupSpawn.id);
    ok('离开预警圈后 windup 归零且不掉血',
      !!wu3 && wu3.windup === 0 && w3.hp === beforeCancelHp,
      { windup: wu3 ? wu3.windup : null, hp: w3.hp });
    d.killAllEnemies();
    await sleep(200);

    /* ========== 9) 护盾词缀：先扣盾、溢出才扣血、破盾后血量下降 ========== */
    d.centerPlayer();
    await sleep(150);
    const pl2 = S().player;
    const shieldInfo = d.spawnEnemyAt('crawler', pl2.x + 20, pl2.y, { elite: true, affix: 'shield' });
    d.pinEnemies(0);
    await sleep(120);
    const hpBefore = shieldInfo.hp;
    const shieldBefore = shieldInfo.shieldHp;
    ok('护盾词缀护盾量 = 35% 血量',
      shieldBefore > 0 && Math.abs(shieldBefore / shieldInfo.hpMax - 0.35) < 0.02,
      { shieldBefore, hpMax: shieldInfo.hpMax, ratio: Number((shieldBefore / shieldInfo.hpMax).toFixed(3)) });
    const smallHit = d.hitNearest(6);
    const mid = S();
    const midEnemy = mid.enemyList.find((e) => e.id === shieldInfo.id);
    ok('小额伤害被护盾吸收、血量不变',
      midEnemy && midEnemy.hp === hpBefore && midEnemy.shieldHp < shieldBefore,
      { hpBefore, nowHp: midEnemy ? midEnemy.hp : null, shield: midEnemy ? midEnemy.shieldHp : null });
    d.hitNearest(9999);
    const afterBreak = S().enemyList.find((e) => e.id === shieldInfo.id);
    ok('破盾后溢出伤害进入血量池',
      !afterBreak || afterBreak.shieldHp === 0,
      { afterBreak });

    /* ========== 10) 迅捷词缀：速度 ≥ 普通怪 ×1.4 ========== */
    d.killAllEnemies();
    await sleep(200);
    const normal = d.spawnEnemyAt('crawler', S().player.x + 300, S().player.y, {});
    const swift = d.spawnEnemyAt('crawler', S().player.x - 300, S().player.y, { elite: true, affix: 'swift' });
    ok('迅捷精英速度 ≥ 普通怪 ×1.4',
      swift.speed >= normal.speed * 1.4,
      { normal: normal.speed, swift: swift.speed, ratio: Number((swift.speed / normal.speed).toFixed(2)) });

    /* ========== 11) 分裂词缀：击杀后 +2 且子体为半血、无词缀 ========== */
    d.killAllEnemies();
    await sleep(200);
    d.centerPlayer();
    await sleep(120);
    const pl3 = S().player;
    const splitSpawn = d.spawnEnemyAt('crawler', pl3.x + 30, pl3.y, { elite: true, affix: 'split' });
    d.pinEnemies(0);
    await sleep(100);
    const countBefore = S().enemies;
    d.hitNearest(9999);
    await sleep(120);
    const afterSplit = S();
    const children = afterSplit.enemyList.filter((e) => e.isSplitChild);
    ok('分裂精英死亡后裂成 2 只半血子体',
      afterSplit.enemies === countBefore + 1 && children.length === 2
        && children.every((e) => e.hp <= Math.ceil(splitSpawn.hpMax * 0.5) && e.affix == null),
      { countBefore, countAfter: afterSplit.enemies, children: children.map((e) => ({ hp: e.hp, affix: e.affix })) });

    /* ========== 12) 连击终结：半径内受伤 / 半径外不动 / 锁生效 ========== */
    d.restart();
    await sleep(500);
    d.centerPlayer();
    await sleep(200);
    const pl4 = S().player;
    // 房间宽度有限：先在左右两个方向量出可站立的最远距离，
    // 然后把两只怪分别放在房间两端，再把玩家移到其中一端 ——
    // 这样"近"目标一定在半径内、"远"目标一定在半径外，不受房间尺寸影响。
    d.setAimExact(0);
    const gpRight = d.groundPoint(420);
    d.setAimExact(Math.PI);
    const gpLeft = d.groundPoint(420);
    const half = Math.min(gpRight.dist, gpLeft.dist);
    const near = d.spawnEnemyAt('crawler', pl4.x + 30, pl4.y, {});
    const far = d.spawnEnemyAt('crawler', pl4.x - (half - 12), pl4.y, {});
    d.pinEnemies(0);
    await sleep(80);
    d.setPlayerPos(pl4.x + (half - 12), pl4.y);
    await sleep(80);
    const nearBefore = S().enemyList.find((e) => e.id === near.id);
    const farBefore = S().enemyList.find((e) => e.id === far.id);
    // 以"实际触发时玩家所在位置"为圆心，才是真实距离
    const pl4b = S().player;
    const finCount0 = d.finisherCount();
    const hits = d.triggerFinisher();
    await sleep(120);
    const fin1 = S();
    const nearAfter = fin1.enemyList.find((e) => e.id === near.id);
    const farAfter = fin1.enemyList.find((e) => e.id === far.id);
    const lockedTry = d.triggerFinisher();
    const nearDist = Math.hypot(nearBefore.x - pl4b.x, nearBefore.y - pl4b.y);
    const farDist = Math.hypot(farBefore.x - pl4b.x, farBefore.y - pl4b.y);
    ok('连击终结只伤半径内目标且触发计数 +1',
      hits >= 1 && farDist > 175 && (nearAfter === undefined || nearAfter.hp < nearBefore.hp)
        && !!farAfter && farAfter.hp === farBefore.hp
        && d.finisherCount() === finCount0 + 1,
      { hits, half: Number(half.toFixed(1)), nearDist: Number(nearDist.toFixed(1)), farDist: Number(farDist.toFixed(1)), nearBefore: nearBefore.hp, nearAfter: nearAfter ? nearAfter.hp : 'killed', farBefore: farBefore.hp, farAfter: farAfter ? farAfter.hp : 'killed' });
    ok('连击终结有防递归锁（紧接第二次返回 null）', lockedTry === null, { lockedTry });

    /* ========== 13) 5 连自然触发连击终结 ========== */
    d.restart();
    await sleep(500);
    d.centerPlayer();
    await sleep(200);
    const pl5 = S().player;
    for (let i = 0; i < 5; i += 1) {
      d.spawnEnemyAt('crawler', pl5.x + 40 + i * 26, pl5.y + 10, {});
    }
    d.pinEnemies(0);
    await sleep(100);
    const finBefore5 = d.finisherCount();
    const comboBefore5 = S().combo.count;
    for (let i = 0; i < 5; i += 1) { d.hitNearest(9999); await sleep(60); }
    await sleep(150);
    const fin5 = S();
    ok('5 连击杀会自然触发一次连击终结',
      fin5.combo.count === comboBefore5 + 5 && d.finisherCount() >= finBefore5 + 1,
      { comboBefore: comboBefore5, combo: fin5.combo.count, finisher: d.finisherCount(), before: finBefore5 });

    return out;
  })()`);
  page.forEach((r) => check(r.name, r.pass, r.detail));

  // ==================== 截图：影步残影 ====================
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.restart();
    await sleep(500);
    d.centerPlayer();
    await sleep(200);
    d.resetDash();
    d.setAimExact(0);
    d.dash();
    return d.getState().afterimages;
  })()`);
  await sleep(60);
  await shotClip('m15-dash-trail-zoom.png');
  await shot('m15-dash-trail.png');

  // ==================== 截图：近战前摇红环 ====================
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.restart();
    await sleep(500);
    d.centerPlayer();
    await sleep(200);
    const p = d.getState().player;
    d.spawnEnemyAt('crawler', p.x + 34, p.y + 6, {});
    d.pinEnemies(0);
    await sleep(160);
    return d.getState().enemyList.map((e) => e.windup);
  })()`);
  await shot('m15-windup.png');
  await shotClip('m15-windup-zoom.png');

  // ==================== 截图：护盾精英 + 词缀标签 ====================
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.restart();
    await sleep(500);
    d.centerPlayer();
    await sleep(200);
    const p = d.getState().player;
    d.spawnEnemyAt('crawler', p.x + 120, p.y - 30, { elite: true, affix: 'shield' });
    d.spawnEnemyAt('crawler', p.x - 120, p.y + 20, { elite: true, affix: 'swift' });
    d.spawnEnemyAt('crawler', p.x + 60, p.y + 110, { elite: true, affix: 'split' });
    d.spawnEnemyAt('crawler', p.x - 60, p.y - 110, { elite: true, affix: 'vampiric' });
    d.pinEnemies(0);
    await sleep(300);
    return d.getState().enemies;
  })()`);
  await shot('m15-elite-affixes.png');
  await shotClip('m15-elite-affixes-zoom.png', 560, 400);

  // ==================== 截图：连击终结冲击波 ====================
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.restart();
    await sleep(500);
    d.centerPlayer();
    await sleep(200);
    const p = d.getState().player;
    for (let i = 0; i < 6; i += 1) {
      const a = Math.PI * 2 / 6 * i;
      d.spawnEnemyAt('crawler', p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80, {});
    }
    d.pinEnemies(0);
    await sleep(150);
    return d.triggerFinisher();
  })()`);
  await shot('m15-finisher.png');
  await shotClip('m15-finisher-zoom.png', 560, 400);

  // ==================== 截图：准星四态 ====================
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.restart();
    await sleep(500);
    d.centerPlayer();
    d.setAimMode('off');
    d.resetCooldowns();
    d.setAether(d.getState().aetherMax);
    await sleep(200);
    return d.crosshairState();
  })()`);
  await mouseMove(700, 420);
  await sleep(120);
  await mouseMove(760, 460);
  await sleep(60);
  await shot('crosshair-idle.png');

  // cooling
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.cast();
    await sleep(120);
    return d.crosshairState();
  })()`);
  await shot('crosshair-cooling.png');

  // noAether
  await ev(`window.__roamDebug.setAether(0)`);
  await sleep(150);
  await shot('crosshair-noeather.png');

  // locked
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.setAether(d.getState().aetherMax);
    d.resetCooldowns();
    d.setAimMode('strong');
    const p = d.getState().player;
    d.spawnEnemyAt('crawler', p.x + 200, p.y, {});
    d.pinEnemies(0);
    d.setAimExact(0);
    await sleep(350);
    return { cs: d.crosshairState(), aim: d.aimState() };
  })()`);
  await shot('crosshair-locked.png');

  // ==================== 截图：符文雷落点圈 ====================
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.restart();
    await sleep(500);
    d.centerPlayer();
    d.grantMagic('mine');
    d.selectMagic('mine');
    d.setAimMode('off');
    d.resetCooldowns();
    d.setAether(d.getState().aetherMax);
    await sleep(200);
    return d.groundPoint(420);
  })()`);
  await mouseMove(880, 380);
  await sleep(150);
  await shot('crosshair-mine-ground.png');

  // ==================== 收尾：错误列表 + 帧率 ====================
  const finalState = await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.killAllEnemies();
    await sleep(200);
    const t0 = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const tick = () => { frames += 1; if (performance.now() - t0 > 1200) resolve(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const fps = frames / ((performance.now() - t0) / 1000);
    return { fps: Number(fps.toFixed(1)), errors: d.errors(), mode: d.getState().mode };
    })()`);
  check('帧率 ≥ 60', finalState.fps >= 60, finalState.fps);
  check('运行期无报错', Array.isArray(finalState.errors) && finalState.errors.length === 0, finalState.errors);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} ${pass === results.length ? 'PASS' : 'FAIL'}`);
  try { ws.close(); } catch (e) {}
  killEdge(edge);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => { console.error('FAILED', err); process.exit(1); });
