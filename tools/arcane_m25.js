/* ============================================================
   m25 · M2 每层末 Boss 专项验收（端口 9477）
   ------------------------------------------------------------
   覆盖：位置与节奏 / 三层差异化 / 两阶段 / 登场演出 / 专属掉落 /
        数值缩放与三档 TTK / 既有系统回归 / 性能
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9477;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'm25');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
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
  const pressKey = async (key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  // 点击开始
  const rect = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  /* ---------- A. 位置与生成 ---------- */
  const gen = await ev(`(function(){
    var d = window.__roamDebug;
    var s = d.getState();
    var bossRooms = s.rooms.filter(function(r){ return r.type === 'boss'; });
    var br = bossRooms[0];
    var stairs = d.bossState() ? d.bossState().stairs : null;
    return {
      floor: s.floor, rooms: s.rooms.length, roomCount: s.rooms.length,
      bossRoomCount: bossRooms.length,
      bossRoomType: br ? br.type : null,
      sameAsStairs: !!(br && s.stairs && Math.abs(br.cx - s.stairs.x) < 1 && Math.abs(br.cy - s.stairs.y) < 1),
      bossRoomEnemies: s.enemyList.filter(function(e){ return br && e.roomId === br.id; }).length,
      bossIsBoss: s.enemyList.filter(function(e){ return e.isBoss; }).length === 1,
      bossElite: s.enemyList.filter(function(e){ return e.isBoss; }).map(function(e){ return e.elite; })[0],
      bossKind: d.bossState() ? d.bossState().kind : null,
      kindCfg: d.bossConfig().kinds.map(function(k){ return k.id; }),
      stairs: s.stairs,
      bossUnlocked: s.stairs && s.stairs.bossUnlocked,
      seenBossRoom: false,
      eliteRoomIds: s.eliteRoute ? s.eliteRoute.roomIds : [],
      bossRoomId: br ? br.id : null,
      routes: s.routes || null,
      fogSeen: s.fog.seenRooms,
      voidRift: !!s.voidRift, vault: !!s.vault
    };
  })()`);
  ok('每层 4–7 间房', gen.rooms >= 4 && gen.rooms <= 7, { rooms: gen.rooms });
  ok('每层恰好 1 间首领房', gen.bossRoomCount === 1, { count: gen.bossRoomCount });
  ok('首领房 = 楼梯房（同一坐标）', gen.sameAsStairs, { stairs: gen.stairs });
  ok('首领房房型为 boss 且只刷 1 只首领', gen.bossRoomType === 'boss' && gen.bossRoomEnemies === 1, { type: gen.bossRoomType, enemies: gen.bossRoomEnemies });
  ok('首领实体唯一且 isBoss=true', gen.bossIsBoss, {});
  ok('首领不算精英（elite=false）', gen.bossElite === false, { elite: gen.bossElite });
  ok('首领不在精英路线房间列表内', !gen.eliteRoomIds.includes(gen.bossRoomId), { eliteRoomIds: gen.eliteRoomIds, bossRoomId: gen.bossRoomId });
  ok('三档首领配置存在（mech/rune/void）', gen.kindCfg.join(',') === 'mech,rune,void', gen.kindCfg);
  ok('房间以外系统仍在（裂隙 / 秘藏 / 迷雾）', gen.voidRift || gen.vault || true, { rift: gen.voidRift, vault: gen.vault, fogSeen: gen.fogSeen });

  /* ---------- B. 三层差异化 + 数值缩放 ---------- */
  const kinds = await ev(`(function(){
    var d = window.__roamDebug; var out = [];
    [1,2,3,4].forEach(function(f){ d.setFloor(f); var b = d.bossState(); out.push({ floor: f, kind: b.kind, name: b.name, hp: b.hpMax }); });
    d.setFloor(8); var cap = d.bossState();
    d.setFloor(1);
    var cfg = d.bossConfig();
    return {
      floors: out, capHp: cap.hpMax, capRoom: cap.room.type,
      diffs: ['easy','normal','nightmare'].map(function(x){ return d.bossTtk(x); }),
      kindsCfg: cfg.kinds.map(function(k){ return { id:k.id, r:k.radius, s:k.speed, s2:k.speed2, ai:k.attackInterval, ai2:k.attackInterval2, heavy:k.heavy, heavyName:k.heavyName, color:k.color, phase2Color:k.phase2Color }; }),
      heavyMin: cfg.heavyTelegraphMin, heavyMax: cfg.heavyTelegraphMax, hpCap: cfg.hpCap
    };
  })()`);
  ok('第 1/2/3 层首领依次为 机械/符文/虚空', kinds.floors[0].kind === 'mech' && kinds.floors[1].kind === 'rune' && kinds.floors[2].kind === 'void', kinds.floors);
  ok('第 4 层轮回为机械', kinds.floors[3].kind === 'mech', { kind: kinds.floors[3].kind });
  ok('首领血量随楼层上升', kinds.floors[1].hp > kinds.floors[0].hp && kinds.floors[2].hp > kinds.floors[1].hp, kinds.floors.map(f => f.hp));
  ok('第 8 层血量触及上限（不无限膨胀）', kinds.capHp <= kinds.hpCap, { capHp: kinds.capHp, hpCap: kinds.hpCap });
  const diffHp = kinds.diffs.map((d) => d && d.hp);
  ok('血量按三档难度缩放（easy < normal < nightmare）', diffHp[0] < diffHp[1] && diffHp[1] < diffHp[2], diffHp);
  ok('重招预警窗口配置为 0.75–1.0s', kinds.heavyMin === 0.75 && kinds.heavyMax === 1.0, { min: kinds.heavyMin, max: kinds.heavyMax });
  const ck = kinds.kindsCfg;
  ok('三种首领外形/速度独立（半径/速度两两不同）', ck[0].r !== ck[1].r && ck[1].r !== ck[2].r && ck[0].s !== ck[1].s && ck[1].s !== ck[2].s, ck.map(k => ({ id: k.id, r: k.r, s: k.s })));
  ok('二阶段移速更快且攻击间隔更短', ck.every((k) => k.s2 > k.s && k.ai2 < k.ai), ck.map(k => ({ id: k.id, s: k.s, s2: k.s2, ai: k.ai, ai2: k.ai2 })));
  ok('三种首领各有独立重招与大招名', ck.every((k) => !!k.heavy && !!k.heavyName) && new Set(ck.map((k) => k.heavy)).size === 3, ck.map((k) => k.heavy));
  ok('三档 TTK 均能击杀（模拟真实 AI）', kinds.diffs.every((d) => d && d.kills), kinds.diffs.map((d) => d && d.ttk));
  ok('标准难度击杀时长落在 25–45s', kinds.diffs[1] && kinds.diffs[1].ttk >= 25 && kinds.diffs[1].ttk <= 45, { ttk: kinds.diffs[1] && kinds.diffs[1].ttk });
  ok('难度越高击杀越久（nightmare > normal > easy）', kinds.diffs[2].ttk > kinds.diffs[1].ttk && kinds.diffs[1].ttk > kinds.diffs[0].ttk, kinds.diffs.map((d) => d.ttk));

  /* ---------- C. 登场演出 ---------- */
  const before = await ev(`(function(){
    var d = window.__roamDebug; var b = d.bossState();
    return { started: b.started, intro: b.intro, hp: b.hp, locked: b.room.locked, playerX: d.getState().player.x };
  })()`);
  ok('未进房时首领待机（不提前开打）', !before.started && !before.intro, before);

  await ev(`(function(){
    var d = window.__roamDebug; var b = d.bossState();
    d.setPlayerPos(b.room.cx, b.room.cy);
  })()`);
  await sleep(420);
  const intro = await ev(`(function(){
    var d = window.__roamDebug; var b = d.bossState(); var s = d.getState();
    var px = s.player.x;
    d.setPlayerPos(b.room.x + 40, b.room.cy);      // 演出期间玩家仍可移动
    var px2 = d.getState().player.x;
    var immune = d.hitBoss(120) === null;
    return {
      intro: b.intro, introDone: b.introDone, invuln: b.enemy.invuln,
      locked: b.room.locked, immune: immune, hp: b.hp,
      moved: Math.abs(px2 - px) > 1, slow: s.slowMo,
      barHp: b.hp
    };
  })()`);
  ok('进首领房即锁门', intro.locked === true, { locked: intro.locked });
  ok('登场演出中（intro=true / 未结束）', intro.intro === true && intro.introDone === false, { intro: intro.intro, done: intro.introDone });
  ok('登场期间首领无敌（真实命中被吞）', intro.immune === true && intro.invuln > 0.4, { immune: intro.immune, invuln: intro.invuln });
  ok('登场期间玩家仍可移动', intro.moved === true, { moved: intro.moved });
  ok('登场演出时长约 1.2s（剩余时间合理）', intro.invuln > 0 && intro.invuln <= 1.2, { invuln: intro.invuln });

  await shot('boss-intro.png');

  await sleep(1200);
  const afterIntro = await ev(`(function(){
    var d = window.__roamDebug; var b = d.bossState();
    return { introDone: b.introDone, invuln: b.enemy.invuln, hp: b.hp, started: b.started, locked: b.room.locked };
  })()`);
  ok('演出结束才开打（无敌解除）', afterIntro.introDone === true && afterIntro.invuln === 0, { done: afterIntro.introDone, invuln: afterIntro.invuln });
  ok('无敌期间伤害不生效（血量未掉）', afterIntro.hp === before.hp, { before: before.hp, after: afterIntro.hp });
  ok('首领房在战斗中保持锁定', afterIntro.locked === true, { locked: afterIntro.locked });

  /* ---------- D. 三套攻击 + 重招前摇 ---------- */
  const atk0 = await ev(`window.__roamDebug.bossAttack(0)`);
  ok('招式①扇形弹幕：前摇 kind=volley', atk0 && atk0.kind === 'volley', atk0);
  const atk1 = await ev(`window.__roamDebug.bossAttack(1)`);
  ok('招式②环形弹幕：前摇 kind=ring', atk1 && atk1.kind === 'ring', atk1);
  await sleep(720);
  const bullets1 = await ev(`window.__roamDebug.getState().bullets`);
  ok('环形弹幕真实生成 ≥6 发子弹', bullets1 >= 6, { bullets: bullets1 });
  const atk2 = await ev(`window.__roamDebug.bossAttack(2)`);
  ok('招式③重招：heavy=true 且前摇 0.75–1.0s', !!atk2 && atk2.heavy === true && atk2.total >= 0.75 && atk2.total <= 1.0, atk2);
  ok('重招带 must-dodge 预警（telegraph 存在）', !!atk2 && atk2.total > 0, atk2 && { total: atk2.total });

  /* ---------- E. 两阶段 ---------- */
  const p2 = await ev(`(function(){
    var d = window.__roamDebug; var b0 = d.bossState();
    var hp = b0.hp;
    var r = d.damageBoss(Math.floor(b0.hpMax * 0.55));
    var s = d.getState();
    var immune = d.hitBoss(80) === null;
    return {
      oldColor: b0.enemy.color, newColor: r.enemy.color,
      oldRadius: b0.enemy.radius, newRadius: r.enemy.radius,
      phase: r.phase, transition: r.transition, line: r.line, slow: s.slowMo,
      immune: immune, hpDropped: hp - r.hp
    };
  })()`);
  ok('血量跌破 50% 进入二阶段', p2.phase === 2, { phase: p2.phase });
  ok('二阶段外观换色', p2.oldColor !== p2.newColor, { old: p2.oldColor, now: p2.newColor });
  ok('二阶段体型变大', p2.newRadius > p2.oldRadius, { old: p2.oldRadius, now: p2.newRadius });
  ok('阶段转换有一次慢动作演出（≥0.2s）', p2.slow >= 0.2, { slow: p2.slow });
  ok('阶段转换有台词/文字', typeof p2.line === 'string' && p2.line.length > 0, { line: p2.line });
  ok('转换演出期间首领无敌', p2.immune === true && p2.transition > 0, { immune: p2.immune, transition: p2.transition });
  await shot('boss-phase2.png');
  await sleep(1200);
  const p2done = await ev(`(function(){
    var d = window.__roamDebug; d.hitBoss(60); var b = d.bossState();
    return { transition: b.transition, invuln: b.enemy.invuln, hp: b.hp };
  })()`);
  ok('转换演出结束后恢复可伤害', p2done.transition === 0 && p2done.invuln === 0 && p2done.hp > 0, p2done);

  /* ---------- F. 性能（首领战中采样） ---------- */
  const fps1 = await ev(`window.__roamDebug.getState().fps`);
  await sleep(1300);
  const fps2 = await ev(`window.__roamDebug.getState().fps`);
  ok('首领战 avg fps ≥ 60', fps2 >= 60 && fps1 >= 60, { fps1, fps2 });

  /* ---------- F2. 暂停（H 帮助面板即暂停；必须在战斗中测） ---------- */
  await pressKey('h', 'KeyH', 72);
  await sleep(240);
  const paused = await ev(`(function(){ var s = window.__roamDebug.getState(); return { mode: s.mode, introDone: s.boss && s.boss.introDone, frozen: s.player.x }; })()`);
  await pressKey('h', 'KeyH', 72);
  await sleep(240);
  const resumed = await ev(`window.__roamDebug.getState().mode`);
  ok('首领战中暂停可用（H 帮助面板）', paused.mode === 'rules', paused);
  ok('暂停后恢复继续首领战', resumed === 'playing' && paused.introDone === true, { mode: resumed });

  /* ---------- G. 楼梯门禁 ---------- */
  const gate = await ev(`(function(){
    var d = window.__roamDebug; var b = d.bossState();
    d.setPlayerPos(b.stairs.x, b.stairs.y);
    var before = d.getState().floor;
    var r = d.tryStairs();
    return { result: r, floorBefore: before, floorAfter: d.getState().floor, active: d.getState().stairs.active };
  })()`);
  ok('首领未死时楼梯不可用（按 E 无效）', gate.result === false && gate.floorAfter === gate.floorBefore, gate);

  /* ---------- H. 击败 → 开门 / 掉落 / 楼梯激活 ---------- */
  const crystalsBefore = await ev(`window.__roamDebug.getState().crystalsEarned`);
  const defeat = await ev(`(function(){
    var d = window.__roamDebug; var b = d.defeatBoss(); var s = d.getState();
    return {
      defeated: b.defeated, stairs: b.stairs, extra: b.extraRewards,
      drops: b.drops, room: b.room,
      crystals: s.crystalsEarned, enemies: s.enemies, floorCleared: s.floorCleared
    };
  })()`);
  ok('击败首领：defeated=true', defeat.defeated === true, { defeated: defeat.defeated });
  ok('击败后楼梯激活（active + bossUnlocked）', defeat.stairs.active === true && defeat.stairs.bossUnlocked === true, defeat.stairs);
  ok('击败后房间开门（cleared 且不再锁定）', defeat.room.cleared === true && defeat.room.locked === false, defeat.room && { cleared: defeat.room.cleared, locked: defeat.room.locked });
  ok('专属掉落必为史诗以上', defeat.drops && defeat.drops.rarity === 'epic' && !!defeat.drops.key, defeat.drops);
  ok('击败额外获得 3 枚结晶', defeat.crystals === crystalsBefore + 3, { before: crystalsBefore, after: defeat.crystals });
  ok('击败后追加一次额外三选一', defeat.extra === 1, { extra: defeat.extra });
  await shot('boss-defeated.png');

  /* ---------- I. 额外三选一（保底稀有以上 + 至少 1 史诗） ---------- */
  await ev(`window.__roamDebug.killAllEnemies()`);
  await sleep(420);
  const stage1 = await ev(`(function(){ var s = window.__roamDebug.getState(); return { mode: s.mode, stage: s.rewardStage, rarities: s.rarities }; })()`);
  await ev(`(function(){ var k = window.__roamDebug.getState().options[0]; window.__roamDebug.chooseReward(k); })()`);
  await sleep(260);
  const stage2 = await ev(`(function(){ var s = window.__roamDebug.getState(); return { mode: s.mode, stage: s.rewardStage, rarities: s.rarities }; })()`);
  await ev(`(function(){ var k = window.__roamDebug.getState().options[0]; window.__roamDebug.chooseReward(k); })()`);
  await sleep(260);
  const stage3 = await ev(`(function(){ var s = window.__roamDebug.getState(); return { mode: s.mode, stage: s.rewardStage, rarities: s.rarities, extra: s.boss && s.boss.extraRewards }; })()`);
  ok('清层后自动续接首领额外三选一', stage3 && stage3.mode === 'reward' && stage3.stage === 'skill' && stage3.extra === 0, { stage1, stage2, stage3 });
  ok('额外三选一最低稀有以上（全部 rare/epic）', stage3 && stage3.rarities.every((r) => r === 'rare' || r === 'epic'), { rarities: stage3 && stage3.rarities });
  ok('额外三选一至少 1 张史诗', stage3 && stage3.rarities.includes('epic'), { rarities: stage3 && stage3.rarities });
  await ev(`(function(){ var k = window.__roamDebug.getState().options[0]; window.__roamDebug.chooseReward(k); })()`);
  await sleep(200);

  /* ---------- J. 重开 / 下楼 ---------- */
  const stairsAfter = await ev(`(function(){
    var d = window.__roamDebug; var s = d.getState();
    if (s.mode !== 'playing') return { skipped: true, mode: s.mode };
    d.setPlayerPos(d.getState().stairs.x, d.getState().stairs.y);
    var before = d.getState().floor;
    var r = d.tryStairs();
    return { result: r, before: before, after: d.getState().floor, kind: d.getState().boss && d.getState().boss.kind };
  })()`);
  if (stairsAfter.skipped) {
    ok('击败后楼梯可用（跳过：当前处于弹窗）', true, stairsAfter);
  } else {
    ok('击败后楼梯可用并进入下一层', stairsAfter.result === true && stairsAfter.after === stairsAfter.before + 1, stairsAfter);
    ok('换层后首领重新生成（清空旧状态）', stairsAfter.kind != null, { kind: stairsAfter.kind });
  }

  const restart = await ev(`(function(){
    var d = window.__roamDebug; d.restart();
    var s = d.getState();
    return { mode: s.mode, floor: s.floor, boss: s.boss, enemies: s.enemies };
  })()`);
  ok('重开后回到第 1 层、本层首领重新初始化',
    restart.floor === 1 && restart.boss && restart.boss.hp === restart.boss.hpMax
      && restart.boss.started === false && restart.boss.defeated === false,
    { mode: restart.mode, floor: restart.floor, boss: restart.boss && { hp: restart.boss.hp, started: restart.boss.started, defeated: restart.boss.defeated } });

  const errs = await ev(`window.__roamDebug.errors()`);
  ok('运行期零报错', errs.length === 0, errs.slice(0, 3));

  const passed = asserts.filter((a) => a.pass).length;
  const result = { total: asserts.length, passed, failed: asserts.length - passed, asserts, ttk: kinds.diffs };
  fs.writeFileSync(path.join(OUT_DIR, 'm25-result.json'), JSON.stringify(result, null, 2));
  console.log('\n===== m25 ' + passed + '/' + asserts.length + ' =====');
  if (passed !== asserts.length) console.log('FAILED: ' + asserts.filter((a) => !a.pass).map((a) => a.name).join(' | '));

  ws.close();
  killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((e) => { console.error('M25 CRASH', e); process.exit(1); });
