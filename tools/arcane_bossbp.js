// G 项目 · Boss 蓝图装配验收（B0–B8）
// 覆盖：配置完整性 / 真实击败首领→开箱掉蓝图 / 一局一次去重 / 基础配方优先 /
//       装配后实战真的打出效果 / 帮助页可发现性 / 总开关回滚
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9796;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const SHOT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'bossbp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });

const results = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {any} [detail] 证据
 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : ''));
}

(async () => {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--allow-file-access-from-files', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起来 */ }
    await sleep(250);
  }
  if (!target) { console.error('no target'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  /**
   * 页面内求值（异常直接抛出，失败日志更好定位）
   * @param {string} expr 表达式
   * @returns {Promise<any>} 结果
   */
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT, name), Buffer.from(r.data, 'base64'));
  };
  /**
   * 关掉当前所有奖励弹窗（升级四选一 / 首领三选一），回到 playing
   * ------------------------------------------------------------
   * reward 模式下世界不推进：融合会被 tryFuse 的模式闸门挡住、
   * 宝箱的 grantTimer 也不会走。所以每条"战后断言"前都要先清干净。
   */
  const clearReward = async () => {
    for (let i = 0; i < 8; i += 1) {
      const mode = await ev(`state.mode`);
      if (mode !== 'reward') return mode;
      const clicked = await ev(`(() => {
        const b = document.querySelector('[data-reward-key]');
        if (b) { b.click(); return 'click'; }
        return __roamDebug.xp.chooseFirst() ? 'xp' : 'none';
      })()`);
      if (clicked === 'none') return await ev(`state.mode`);
      await sleep(350);
    }
    return await ev(`state.mode`);
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  await ev(`window.__roamDebug.xp.setEnabled(false); true`);
  await ev(`window.__roamDebug.unlocks.grant('fusion'); true`);
  await sleep(900);
  const st = await ev(`window.__roamDebug.getState()`);
  check('开局进入 playing', st.mode === 'playing' && st.status === 'playing', `mode=${st.mode}/${st.status}`);

  // ---------- B0 配置完整性 ----------
  const info0 = await ev(`window.__roamDebug.blueprints.info()`);
  const bossCfg = await ev(`window.__roamDebug.bossConfig()`);
  check('蓝图 3 条（每种首领 1 张）', info0.count === 3, `${info0.count} 条`);
  const fieldsOk = info0.list.every((bp) => bp.id && bp.boss && bp.magic && bp.tech && bp.resultId
    && bp.resultName && bp.radius > 0 && bp.windup > 0 && bp.damage > 0);
  check('三条蓝图字段齐全（材料/产物/半径/前摇/伤害）', fieldsOk, info0.list.map((b) => b.id));
  const fusionCat = await ev(`window.__roamDebug.fuseState().catalog.length`);
  check('基础融合仍是 13 条（未被挤占）', fusionCat === 13, `${fusionCat} 条`);
  const basicPairs = await ev(`window.__roamDebug.fuseState().catalog.map(f => f.magic + '+' + f.tech)`);
  const bpPairs = info0.list.map((b) => b.magic + '+' + b.tech);
  check('蓝图材料组合不与基础 13 条重复', bpPairs.every((p) => basicPairs.indexOf(p) < 0),
    { bpPairs, clash: bpPairs.filter((p) => basicPairs.indexOf(p) >= 0) });
  // 预警几何必须与首领重招一致（玩家看到的是同一套圈）
  const geomOk = info0.list.every((bp) => {
    const kind = (bossCfg.kinds || []).find((k) => k.id === bp.boss);
    return kind && Math.abs(bp.radius - kind.heavyRadius) < 0.01
      && bp.windup >= bossCfg.heavyTelegraphMin - 0.01
      && bp.windup <= bossCfg.heavyTelegraphMax + 0.01;
  });
  check('蓝图预警半径/前摇与首领重招一致', geomOk,
    info0.list.map((b) => ({ boss: b.boss, r: b.radius, w: b.windup })));

  // ---------- B1 帮助页（before：全未解锁） ----------
  await ev(`window.__roamDebug.openPanel('rules'); window.__roamDebug.help.switchTab('fusion'); true`);
  await sleep(400);
  await shot('bossbp_help_before.png');
  const helpBefore = await ev(`window.__roamDebug.help.data()`);
  check('打开帮助时暂停', helpBefore.paused === true, helpBefore.mode);
  check('融合页签基础行仍为 13', helpBefore.fusionRows === 13, helpBefore.fusionRows);
  const bpRowsBefore = await ev(`document.querySelectorAll('[data-blueprint-id]').length`);
  check('融合页签出现 3 行蓝图', bpRowsBefore === 3, bpRowsBefore);
  await ev(`window.__roamDebug.closePanel(); true`);
  await sleep(300);

  // ---------- B2 融合：基础优先，蓝图作为第 14 条独立路径 ----------
  await ev(`(() => {
    const d = __roamDebug;
    d.blueprints.resetRun();
    d.setFusions([]);
    /* 第 12 项起"起始卡"随机（fireball / bolt / frost…），resetRun 后会带进一张基础卡，
       可能与 grant 的四件组成另一条基础配方，抢在蓝图之前被 fuse() 选中。
       这里先清空本局技能与科技，保证候选集合只由下面四件决定。 */
    state.ownedMagic.length = 0;
    state.ownedTech.length = 0;
    state.ownedMagic.push('fireball'); state.ownedTech.push('concentrator');
    state.ownedMagic.push('frostRing'); state.ownedTech.push('nanite');
    d.blueprints.grant('mech');
    return d.blueprints.fuseCandidates();
  })()`);
  await sleep(200);
  const cand = await ev(`__roamDebug.blueprints.fuseCandidates()`);
  check('同时满足基础与蓝图时，蓝图进入候选', cand.indexOf('bp_overload') >= 0, cand);
  const fusedBasic = await ev(`__roamDebug.blueprints.fuse()`);
  const afterBasic = await ev(`window.__roamDebug.fuseState()`);
  check('基础配方优先：先融合火球+聚能', fusedBasic === true
    && afterBasic.fusions.indexOf('homingFireball') >= 0, afterBasic.fusions);
  const bpStillOwned = await ev(`window.__roamDebug.blueprints.info().runOwned`);
  check('基础融合不消耗蓝图', bpStillOwned.length === 1 && bpStillOwned[0] === 'bp_overload', bpStillOwned);
  const fusedBp = await ev(`__roamDebug.blueprints.fuse()`);
  const info2 = await ev(`window.__roamDebug.blueprints.info()`);
  check('蓝图装配成功（霜环 → 过载新星）', fusedBp === true
    && info2.fused.frostRing === 'bpOverloadNova', info2.fused);
  check('装配后本局不再持有该蓝图', info2.runOwned.indexOf('bp_overload') < 0, info2.runOwned);

  // ---------- B3 实战：★ 断言"融合后技能真的打出效果" ----------
  const setup = await ev(`(() => {
    const d = __roamDebug;
    state.enemies.length = 0;
    for (let i = 0; i < 3; i += 1) d.enemies.spawn('wanderer', state.player.x + 78 + i * 24, state.player.y, {});
    state.player.aether = state.player.aetherMax;
    d.setAimExact(0);
    return state.enemies.length;
  })()`);
  await sleep(400);
  check('实战场地准备 3 只敌人', setup === 3, setup);
  const hpBefore = await ev(`state.enemies.reduce((s, e) => s + e.hp, 0)`);
  await ev(`__roamDebug.blueprints.cast('frostRing')`);
  await sleep(60);
  const fx1 = await ev(`__roamDebug.blueprints.info().effects`);
  check('施放霜环后生成"过载新星"', fx1.length >= 1 && fx1[0].name === '过载新星', fx1);
  check('蓝图伤害不超过 damageCap(46)', fx1.length > 0 && fx1[0].dmg <= 46, fx1[0] && fx1[0].dmg);
  await shot('bossbp_combat_after.png');
  const tapped = await ev(`__roamDebug.blueprints.tick(0.9)`);
  await sleep(120);
  const hpAfter = await ev(`state.enemies.reduce((s, e) => s + e.hp, 0)`);
  check('通过 tick 引爆后敌人实际掉血', hpBefore - hpAfter > 0, { hpBefore, hpAfter, left: tapped.length });

  // 三环刻印：3 枚、沿朝向依次排开
  // 前置条件：蓝图只在"基础 13 条都吃不下"时才生效，所以先把材料已齐的基础配方标成已融合
  const modeBeforeRune = await clearReward();
  check('清掉战后奖励弹窗后回到 playing', modeBeforeRune === 'playing', modeBeforeRune);
  const runeFused = await ev(`(() => { const d = __roamDebug; d.blueprints.resetRun();
    d.grantMagic('bolt'); d.grantTech('magnet');
    const ownedM = state.ownedMagic, ownedT = state.ownedTech;
    d.setFusions(d.fuseState().catalog.filter((f) => ownedM.indexOf(f.magic) >= 0 && ownedT.indexOf(f.tech) >= 0).map((f) => f.id));
    d.blueprints.grant('rune');
    const fused = d.blueprints.fuse();
    return { fused, mode: state.mode, status: state.status, run: (state.bossBlueprints || []).slice(),
      cands: d.blueprints.fuseCandidates(), fusions: (state.fusions || []).slice(),
      bossF: Object.assign({}, state.bossFusions || {}) }; })()`);
  await sleep(150);
  check('三环刻印蓝图装配成功', runeFused.fused === true && runeFused.bossF.bolt === 'bpRuneChain', runeFused);
  await ev(`(() => { const d = __roamDebug;
    state.enemies.length = 0;
    for (let i = 0; i < 3; i += 1) d.enemies.spawn('wanderer', state.player.x + 60 + i * 30, state.player.y, {});
    state.player.aether = state.player.aetherMax; d.setAimExact(0); return true; })()`);
  const hpB2 = await ev(`state.enemies.reduce((s, e) => s + e.hp, 0)`);
  await ev(`__roamDebug.blueprints.cast('bolt')`);
  await sleep(50);
  const fx2 = await ev(`__roamDebug.blueprints.info().effects`);
  const xs = fx2.map((f) => f.x).sort((a, b) => a - b);
  check('三环刻印生成 3 枚', fx2.length === 3, fx2.length);
  check('三环刻印沿朝向依次排开（x 递增）', xs.length === 3 && xs[1] > xs[0] && xs[2] > xs[1], xs);
  await ev(`__roamDebug.blueprints.tick(2.1)`);
  await sleep(120);
  const hpA2 = await ev(`state.enemies.reduce((s, e) => s + e.hp, 0)`);
  check('三环刻印多段引爆造成伤害', hpB2 - hpA2 > 0, { hpB2, hpA2 });

  // 湮灭奇点：前摇期间把敌人拽向中心
  const modeBeforeVoid = await clearReward();
  check('奇点测试前仍处于 playing', modeBeforeVoid === 'playing', modeBeforeVoid);
  const voidFused = await ev(`(() => { const d = __roamDebug; d.blueprints.resetRun();
    d.grantMagic('collapseHole'); d.grantTech('amp');
    const ownedM = state.ownedMagic, ownedT = state.ownedTech;
    d.setFusions(d.fuseState().catalog.filter((f) => ownedM.indexOf(f.magic) >= 0 && ownedT.indexOf(f.tech) >= 0).map((f) => f.id));
    d.blueprints.grant('void');
    const fused = d.blueprints.fuse();
    return { fused, mode: state.mode, status: state.status, run: (state.bossBlueprints || []).slice(),
      cands: d.blueprints.fuseCandidates(), fusions: (state.fusions || []).slice(),
      bossF: Object.assign({}, state.bossFusions || {}) }; })()`);
  await sleep(150);
  check('湮灭奇点蓝图装配成功', voidFused.fused === true && voidFused.bossF.collapseHole === 'bpSingularity', voidFused);
  await ev(`(() => { const d = __roamDebug;
    state.enemies.length = 0;
    for (let i = 0; i < 3; i += 1) d.enemies.spawn('wanderer', state.player.x + 210 + i * 6, state.player.y + i * 8, {});
    state.player.aether = state.player.aetherMax; d.setAimExact(0); return true; })()`);
  await ev(`__roamDebug.blueprints.cast('collapseHole')`);
  await sleep(50);
  const fx3 = await ev(`__roamDebug.blueprints.info().effects`);
  const center = fx3[0] || { x: 0, y: 0 };
  const distBefore = await ev(`state.enemies.map(e => Math.round(Math.hypot(e.x - ${center.x}, e.y - ${center.y})))`);
  await ev(`__roamDebug.blueprints.tick(0.35)`);
  const distAfter = await ev(`state.enemies.map(e => Math.round(Math.hypot(e.x - ${center.x}, e.y - ${center.y})))`);
  check('奇点前摇把敌人拽向中心', distBefore.some((d0, i) => d0 - distAfter[i] > 8),
    { before: distBefore, after: distAfter });

  // ---------- B4 真实路径：击败第 6 层首领 → 开箱 → 掉蓝图 ----------
  await ev(`(__roamDebug.enemies.floor(6), true)`);
  await sleep(500);
  const bossRoom = await ev(`(() => {
    const room = state.rooms.find((r) => r.type === 'boss');
    if (room) __roamDebug.setPlayerPos(room.cx, room.cy);
    return !!room;
  })()`);
  await sleep(2200);
  const bs = await ev(`__roamDebug.bossState()`);
  check('第 6 层首领已生成', !!bs && !!bs.enemy, bs && bs.enemy ? bs.enemy.kind : null);
  await ev(`__roamDebug.defeatBoss(); true`);
  await sleep(700);
  const chestInfo = await ev(`__roamDebug.bossChest.info()`);
  check('首领死亡后生成宝箱', chestInfo.exists === true, chestInfo);
  // 真实玩家路径：首领死亡 → 三选一弹窗 → 选一项回到 playing → 再按 E 开箱。
  const chestMode = await clearReward();
  check('吃完首领奖励后回到 playing（宝箱计时器才会走）', chestMode === 'playing', chestMode);
  await ev(`__roamDebug.blueprints.resetRun(); true`);
  const opened = await ev(`__roamDebug.bossChest.interact()`);
  check('按 E 交互成功开箱', opened === true, opened);
  await sleep(1600);
  const info1 = await ev(`window.__roamDebug.blueprints.info()`);
  const runOwned = info1.runOwned;
  check('开箱后本局拿到 1 张蓝图', runOwned.length === 1 && info0.list.some((b) => b.id === runOwned[0]), runOwned);
  check('蓝图写入跨局图鉴', runOwned.length === 1 && info1.metaOwned.indexOf(runOwned[0]) >= 0, info1.metaOwned);
  const lastBp = await ev(`state.lastBlueprint || null`);
  check('宝箱奖励提示记录了蓝图', !!lastBp && lastBp === runOwned[0], lastBp);
  const openedBossKind = await ev(`(() => { const b = BOSS_BLUEPRINT_BY_ID[${JSON.stringify(runOwned[0] || '')}]; return b ? b.boss : null; })()`);
  const dup = await ev(`__roamDebug.blueprints.grant(${JSON.stringify(openedBossKind)})`);
  check('同种首领重复击败不重复发', dup === null, { second: dup });
  const otherKind = await ev(`__roamDebug.blueprints.grant('rune')`);
  check('打另一种首领仍能拿到不同蓝图', typeof otherKind === 'string', otherKind);

  // ---------- B5 重开后帮助页（after：蓝图已解锁） ----------
  await ev(`__roamDebug.restart(); true`);
  await sleep(900);
  const st2 = await ev(`window.__roamDebug.getState()`);
  check('重开后回到 playing', st2.mode === 'playing' && st2.status === 'playing', `mode=${st2.mode}/${st2.status}`);
  await ev(`window.__roamDebug.openPanel('rules'); window.__roamDebug.help.switchTab('fusion'); true`);
  await sleep(400);
  const helpAfter = await ev(`window.__roamDebug.help.data()`);
  check('帮助页打开时游戏暂停', helpAfter.paused === true, helpAfter.mode);
  check('融合页签基础行数仍与 FUSION_CONFIG 一致', helpAfter.fusionRows === 13, helpAfter.fusionRows);
  const bpRows = await ev(`document.querySelectorAll('[data-blueprint-id]').length`);
  check('融合页签蓝图表 3 行', bpRows === 3, bpRows);
  const unlockedRows = await ev(`document.querySelectorAll('[data-blueprint-id].is-owned').length`);
  check('跨局图鉴让已解锁蓝图高亮', unlockedRows >= 1, unlockedRows);
  const usageText = await ev(`(() => {
    const card = document.querySelector('[data-help-card="blueprint-usage"]');
    return card ? card.innerText.replace(/\\s+/g, ' ').trim() : '';
  })()`);
  check('规则页有"首领蓝图怎么用"且写了按 F 装配', /按 F|按F|F 装配/.test(usageText)
    && usageText.indexOf('宝箱') >= 0, usageText.slice(0, 90));
  await ev(`window.__roamDebug.help.switchTab('rules'); true`);
  await sleep(200);
  await shot('bossbp_help_after.png');

  // ---------- B6 总开关回滚 ----------
  await ev(`window.__roamDebug.closePanel(); true`);
  await ev(`__roamDebug.blueprints.set({ enabled: false }); __roamDebug.blueprints.resetRun(); true`);
  const offGrant = await ev(`__roamDebug.blueprints.grant('mech')`);
  const offCand = await ev(`__roamDebug.blueprints.fuseCandidates()`);
  check('总开关关闭后不再掉落', offGrant === null, offGrant);
  check('总开关关闭后蓝图不再进入候选', offCand.length === 0, offCand);
  await ev(`__roamDebug.blueprints.set({ enabled: true }); true`);

  const fails = results.filter((r) => !r.ok);
  console.log('\n===== 汇总 =====');
  console.log(`PASS ${results.length - fails.length}/${results.length}`);
  if (fails.length) console.log('FAIL: ' + fails.map((f) => f.name).join(' | '));
  fs.writeFileSync(path.join(SHOT, 'bossbp.log'),
    results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${JSON.stringify(r.detail)}`).join('\n'));

  ws.close();
  killEdge(edge);
  process.exitCode = fails.length ? 1 : 0;
})();
