// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// M1-1 融合专项验收：10 条融合、演出时序、专属色、慢动作、形态效果、HUD 标识、技能树
const { spawn } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9781;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const SHOT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'fusion');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '   ' + detail : ''));
}

(async () => {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--allow-file-access-from-files', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) { console.error('no target'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq++; pending.set(seq, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT, name), Buffer.from(r.data, 'base64'));
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  // H2 上线后清房发经验而非技能卡；本套件只验证融合目录与合成，关闭成长开关避免奖励弹窗打断
  await ev(`window.__roamDebug.xp.setEnabled(false); true`);
  // D1 渐进解锁：融合在第 1 层默认是锁着的，本套件直接验证融合系统，先解锁
  await ev(`window.__roamDebug.unlocks.grant('fusion'); true`);
  // X 批：武器系统默认关闭（两输入）。本套件验证的是三输入/18 条目录，
  // 先临时打开代码闸门；关闭路径由 arcane_weapons.js 的 X-B1 单独覆盖。
  await ev(`window.__roamDebug.weapons.setCode(true); window.__roamDebug.weapons.setEnabled(true); true`);
  await sleep(900);
  let st = await ev(`window.__roamDebug.getState()`);
  check('开局进入 playing', st.mode === 'playing' && st.status === 'playing', `mode=${st.mode}/${st.status}`);

  // ---------- 1. 目录完整性 ----------
  const snap0 = await ev(`window.__roamDebug.fuseState()`);
  // A 批扩到 13 条；W 批再加 5 条「武器标签配方」→ 18 条。断言口径不变，只是数字跟着功能走
  check('融合目录 18 条', snap0.catalog.length === 18, `${snap0.catalog.length} 条`);
  const colors = snap0.catalog.map(f => f.color);
  check('18 条主色全不同', new Set(colors).size === 18, colors.join(' '));
  const rates = snap0.catalog.map(f => f.rate);
  check('18 条音阶全不同', new Set(rates).size === 18, rates.join(' '));

  // 清空已融合，准备逐条触发
  /* 正式融合槽上限 6，而本轮要一次性验证 18 条 + 5 条武器配方：
     只抬高"验收运行"的上限，玩法默认值不变（详见 RECTIFY_PLAN.md 说明） */
  await ev(`window.__roamDebug.setFusions([]); window.__roamDebug.fusion.setSlotLimit(20); true`);

  const pairs = [
    ['fireball', 'concentrator', 'homingFireball'],
    ['frost', 'field', 'frostField'],
    ['bolt', 'capacitor', 'chainBolt'],
    ['heal', 'nanite', 'regenField'],
    ['fireball', 'field', 'novaBurst'],
    ['bolt', 'field', 'chainSpread'],
    ['fireball', 'capacitor', 'piercingBeam'],
    ['bolt', 'nanite', 'droneSwarm'],
    ['frost', 'concentrator', 'gravityWell'],
    ['heal', 'field', 'shieldNova']
  ];

  let hudCount = 0;
  for (let i = 0; i < pairs.length; i += 1) {
    const [magicId, techId, expectId] = pairs[i];
    await ev(`window.__roamDebug.grantMagic('${magicId}'); window.__roamDebug.grantTech('${techId}'); true`);
    await sleep(120);
    const fused = await ev(`window.__roamDebug.fuse()`);
    check(`融合 ${expectId} 触发成功`, fused === true, `fuse()=${fused}`);
    // 慢动作峰值只有 0.30s，先立刻采样一次峰值，再等 100ms 采完整快照（避免只采到衰减后的 0）
    await sleep(35);
    const peakSnap = await ev(`window.__roamDebug.fuseState()`);
    await sleep(105);
    const snap = await ev(`window.__roamDebug.fuseState()`);
    const cat = snap.catalog.find(f => f.id === expectId);
    check(`融合 ${expectId} 演出在播`, !!snap.fx && snap.fx.fusion === expectId, snap.fx ? snap.fx.fusion : 'null');
    check(`融合 ${expectId} 名字横幅`, snap.bannerOn && snap.bannerName === cat.name, `banner=${snap.bannerOn}/${snap.bannerName}`);
    check(`融合 ${expectId} 专属色注入`, snap.bannerColor === cat.color, `css=${snap.bannerColor} cfg=${cat.color}`);
    const slowVal = Math.max(peakSnap.slow || 0, snap.slow || 0);
    check(`融合 ${expectId} 慢动作生效`, slowVal > 0.05 && slowVal <= 0.31, `slow=${slowVal}`);
    hudCount = snap.fusions.length;
    check(`融合 ${expectId} HUD 标识 ${hudCount}/18`, snap.hudPips.indexOf(hudCount + ' / 18') === 0, `pips="${snap.hudPips}"`);

    // 第一条融合时截一张"演出中"的图，作为 A 符文合体的证据
    if (i === 0) { await sleep(120); await shot('fusion_cinematic_01.png'); }
    await sleep(950);
  }

  // ---------- 2. 演出时序：0.78s 内结束、慢动作 0.3s 内结束 ----------
  // 先清空已融合，否则这条组合已经用过、fuse() 会返回 false
  await ev(`window.__roamDebug.setFusions([]); window.__roamDebug.grantMagic('fireball'); window.__roamDebug.grantTech('concentrator'); true`);
  await sleep(100);
  await ev(`window.__roamDebug.fuse()`);
  await sleep(60);
  const early = await ev(`window.__roamDebug.fuseState()`);
  check('演出进度随时间推进', !!early.fx && early.fx.progress > 0 && early.fx.progress < 0.4, early.fx ? 'progress=' + early.fx.progress : 'null');
  await sleep(800);
  const late = await ev(`window.__roamDebug.fuseState()`);
  check('演出 0.86s 内收尾', late.fx === null, late.fx ? 'progress=' + late.fx.progress : 'null');

  // ---------- 3. 贯光矛：一条直线穿透多个敌人 ----------
  await ev(`window.__roamDebug.setFusions(['piercingBeam']); window.__roamDebug.selectMagic('fireball'); window.__roamDebug.setAether(100); window.__roamDebug.setMouseAim(0); true`);
  await ev(`window.__roamDebug.spawnEnemy('crawler', 90, 0); window.__roamDebug.spawnEnemy('crawler', 155, 0); window.__roamDebug.spawnEnemy('crawler', 220, 0); true`);
  await sleep(120);
  const hpBefore = (await ev(`window.__roamDebug.getState()`)).enemyList.map(e => ({ id: e.id, hp: e.hp }));
  await ev(`window.__roamDebug.cast()`);
  await sleep(80);
  const beamSnap = await ev(`window.__roamDebug.getState()`);
  check('贯光矛生成光束弹', beamSnap.projectilesInfo.some(p => p.beam), JSON.stringify(beamSnap.projectilesInfo));
  await sleep(420);
  const hpAfter = (await ev(`window.__roamDebug.getState()`)).enemyList;
  // 按 id 比对：穿透可能直接打死第一只，数组会缩短，按位置比对会错位
  const damaged = hpBefore.filter((before) => {
    const after = hpAfter.find(e => e.id === before.id);
    return !after || after.hp < before.hp;
  }).length;
  check('贯光矛一次穿透 ≥2 个敌人', damaged >= 2, `damaged=${damaged}`);
  await sleep(1100);

  // ---------- 4. 雷暴无人机 ----------
  await ev(`window.__roamDebug.setFusions(['droneSwarm']); window.__roamDebug.selectMagic('bolt'); window.__roamDebug.setAether(100); true`);
  await ev(`window.__roamDebug.spawnEnemy('crawler', 120, 0); true`);
  await sleep(120);
  const droneHpBefore = (await ev(`window.__roamDebug.getState()`)).enemyList.map(e => ({ id: e.id, hp: e.hp }));
  await ev(`window.__roamDebug.cast()`);
  await sleep(120);
  const droneSnap = await ev(`window.__roamDebug.fuseState()`);
  check('雷暴无人机生成 2 架', droneSnap.drones.length === 2, `drones=${droneSnap.drones.length}`);
  await sleep(900);
  const droneListAfter = (await ev(`window.__roamDebug.getState()`)).enemyList;
  // 按 id 比对：敌人被打死会从列表消失，按位置比对会错位
  const droneHit = droneHpBefore.some((before) => {
    const after = droneListAfter.find(e => e.id === before.id);
    return !after || after.hp < before.hp;
  });
  check('无人机自动电击敌人', droneHit, `before=${droneHpBefore.map(e => e.hp).join(',')} after=${droneListAfter.map(e => e.hp).join(',')}`);
  await shot('fusion_drones_02.png');
  await sleep(1200);

  // ---------- 5. 引力井 ----------
  await ev(`window.__roamDebug.setFusions(['gravityWell']); window.__roamDebug.selectMagic('frost'); window.__roamDebug.setAether(100); true`);
  await ev(`window.__roamDebug.spawnEnemy('warden', 180, 0); true`);
  await sleep(120);
  const wellListBefore = (await ev(`window.__roamDebug.getState()`)).enemyList;
  const wellEnemy = wellListBefore[wellListBefore.length - 1];
  await ev(`window.__roamDebug.cast()`);
  await sleep(100);
  const wellListAfter = (await ev(`window.__roamDebug.getState()`)).enemyList;
  const wellEnemyAfter = wellListAfter.find(e => e.id === wellEnemy.id);
  const dx = wellEnemyAfter ? Math.abs(wellEnemyAfter.x - wellEnemy.x) : 0;
  check('引力井把敌人拉向中心', dx >= 20, `dx=${dx}`);
  check('引力井附带减速', wellEnemyAfter && wellEnemyAfter.slow > 0, wellEnemyAfter ? 'slow=' + wellEnemyAfter.slow : 'null');
  await sleep(1200);

  // ---------- 6. 护盾爆轰 ----------
  await ev(`window.__roamDebug.setFusions(['shieldNova']); window.__roamDebug.selectMagic('heal'); window.__roamDebug.setAether(100); true`);
  await ev(`window.__roamDebug.spawnEnemy('crawler', 90, 0); true`);
  await sleep(120);
  const shieldHpBefore = (await ev(`window.__roamDebug.getState()`)).enemyList.map(e => ({ id: e.id, hp: e.hp }));
  await ev(`window.__roamDebug.cast()`);
  await sleep(150);
  const shieldState = await ev(`window.__roamDebug.getState()`);
  check('护盾爆轰给出 8 秒护盾', shieldState.shield >= 7.5, 'shield=' + shieldState.shield);
  const shieldHit = shieldHpBefore.some((before) => {
    const after = shieldState.enemyList.find(e => e.id === before.id);
    return !after || after.hp < before.hp;
  });
  check('护盾爆轰造成范围伤害', shieldHit, `before=${shieldHpBefore.map(e => e.hp).join(',')} after=${shieldState.enemyList.map(e => e.hp).join(',')}`);
  await shot('fusion_shield_03.png');

  // ---------- 7. HUD / 技能树自动长出 18 条 ----------
  await ev(`window.__roamDebug.setFusions(['homingFireball','frostField','chainBolt','regenField','novaBurst','chainSpread','piercingBeam','droneSwarm','gravityWell','shieldNova','lavaBand','drainRing','frostFlame','railArc','moltenTrace','resonantEcho','mirrorSplit','phaseLance']); true`);
  await sleep(120);
  const full = await ev(`window.__roamDebug.fuseState()`);
  check('HUD 显示 18 / 18', full.hudPips.indexOf('18 / 18') === 0, `pips="${full.hudPips}"`);
  await ev(`window.__roamDebug.openPanel('skilltree'); true`);
  await sleep(300);
  const tree = await ev(`window.__roamDebug.treeState()`);
  check('技能树融合节点 18 条', tree.fusions && tree.fusions.length === 18, tree.fusions ? tree.fusions.length : 'missing');
  await shot('fusion_tree_04.png');
  await ev(`window.__roamDebug.closePanel(); true`);
  await sleep(200);

  // ---------- W. 武器标签 = 融合第三输入 ----------
  const tagSnap = await ev(`window.__roamDebug.fusion.tags()`);
  const wantTags = { dagger: 'conductive', longsword: 'scorching', hammer: 'resonant', twin: 'mirror', spear: 'phase' };
  check('W1 五把武器各挂一个标签（数据层）',
    tagSnap.byWeapon.length === 5 && tagSnap.byWeapon.every(w => wantTags[w.id] === w.tagId),
    JSON.stringify(tagSnap.byWeapon));
  const wantNames = ['导电', '灼热', '震荡', '镜像', '穿透'];
  check('W2 标签表 5 条且名称正确',
    Object.keys(tagSnap.tags).length === 5
      && wantNames.every(n => tagSnap.byWeapon.some(w => tagSnap.tags[w.tagId].name === n)),
    Object.keys(tagSnap.tags).map(k => tagSnap.tags[k].name).join(','));

  await ev(`window.__roamDebug.fusion.reset(); window.__roamDebug.weapons.set('longsword', true); true`);
  const curTag = await ev(`window.__roamDebug.fusion.currentTag()`);
  check('W3 当前武器 → 标签跟随（长刀 = 灼热）', curTag && curTag.id === 'scorching', JSON.stringify(curTag));

  await ev(`window.__roamDebug.fusion.grantMagic('lavaFissure'); window.__roamDebug.fusion.grantTech('amp'); true`);
  const availLong = await ev(`window.__roamDebug.fusion.available()`);
  check('W4 三输入命中：长刀 + 熔岩裂变 + 增幅 → moltenTrace',
    availLong.includes('moltenTrace'), availLong.join(','));
  await ev(`window.__roamDebug.weapons.set('dagger', true); true`);
  const availDagger = await ev(`window.__roamDebug.fusion.available()`);
  check('W5 换短刃后 moltenTrace 从可融合列表消失',
    !availDagger.includes('moltenTrace'), availDagger.join(','));

  await ev(`window.__roamDebug.fusion.grantMagic('fireball'); window.__roamDebug.fusion.grantTech('concentrator'); true`);
  const a1 = await ev(`window.__roamDebug.fusion.available()`);
  await ev(`window.__roamDebug.weapons.set('hammer', true); true`);
  const a2 = await ev(`window.__roamDebug.fusion.available()`);
  check('W6 回退契约：无 weaponTag 的旧配方不随武器变化',
    a1.includes('homingFireball') && a2.includes('homingFireball'),
    a1.join(',') + ' | ' + a2.join(','));

  for (const [wid, ids] of Object.entries({
    dagger: ['railArc'], longsword: ['moltenTrace'], hammer: ['resonantEcho'], twin: ['mirrorSplit'], spear: ['phaseLance']
  })) {
    const rec = await ev(`window.__roamDebug.fusion.recipes('${wid}')`);
    check(`W7 ${wid} 专属配方 ${ids.join('/')}`,
      rec.length === ids.length && ids.every(id => rec.some(r => r.id === id)), JSON.stringify(rec));
  }

  const bridge = await ev(`window.__roamDebug.fusion.bridge()`);
  const rowCount = (bridge.match(/wb-row/g) || []).length;
  check('W8 面板自解释：当前武器 + 5 个标签行 + 换武器对比句',
    bridge.includes('当前武器') && rowCount === 5 && bridge.includes('换用') && bridge.includes('可多出'),
    `rows=${rowCount} len=${bridge.length}`);

  await ev(`window.__roamDebug.weapons.set('hammer', true); window.__roamDebug.fusion.grantMagic('bolt'); true`);
  const hintSnap = await ev(`window.__roamDebug.fusion.hint({kind:'tech', id:'field'})`);
  check('W9 选卡提示：战锤 + 已有雷击 + 力场 → 与战锤可融合（≤12 字）',
    hintSnap && hintSnap.fusion.id === 'resonantEcho' && hintSnap.text.length <= 12,
    JSON.stringify(hintSnap));
  const hintNone = await ev(`window.__roamDebug.fusion.hint({kind:'tech', id:'magnet'})`);
  check('W10 无关卡不显示武器融合提示', !hintNone, JSON.stringify(hintNone));

  /**
   * 量一条标签配方的附加伤害：同一武器、同一假人，拿融合前后各挥一次。
   * @param {string} weaponId 武器
   * @param {string} fusionId 融合
   * @param {string} spawns 假人生成语句（相对玩家偏移）
   * @param {number} swings 挥击次数（共振回响要 3 次）
   * @returns {Promise<{base:number, after:number, rider:number, byFusion:Object}>}
   */
  const riderCase = async (weaponId, fusionId, spawns, swings, respawnEach) => {
    const times = swings || 1;
    /* respawnEach：每次挥击前清场并补一只假人，保证"每挥必中"且伤害基数可比 */
    const perSwing = respawnEach ? 'd.killAllEnemies();' + spawns + ';' : '';
    await ev(`window.__roamDebug.killAllEnemies(); window.__roamDebug.fusion.reset(); window.__roamDebug.weapons.set('${weaponId}', true); true`);
    await sleep(60);
    await ev(`(function(){var d=window.__roamDebug;${spawns};return true;})()`);
    const base = await ev(`(function(){var d=window.__roamDebug;var r=0;for(var i=0;i<${times};i++){${perSwing}d.fusion.resetWeaponCd();r+=d.weapons.swing({angle:0}).damage;}return r;})()`);
    await ev(`window.__roamDebug.killAllEnemies(); true`);
    await ev(`(function(){var d=window.__roamDebug;${spawns};return true;})()`);
    await ev(`window.__roamDebug.fusion.grant('${fusionId}'); true`);
    const after = await ev(`(function(){var d=window.__roamDebug;var r=0;for(var i=0;i<${times};i++){${perSwing}d.fusion.resetWeaponCd();r+=d.weapons.swing({angle:0}).damage;}return r;})()`);
    const stats = await ev(`window.__roamDebug.fusion.riderStats()`);
    return { base: base, after: after, rider: after - base, stats: stats };
  };

  const rc1 = await riderCase('dagger', 'railArc', `d.spawnEnemy('wanderer',40,0);d.spawnEnemy('wanderer',120,60)`, 1);
  check('W11 导轨电弧：命中后弹射出真实附加伤害',
    rc1.stats.byFusion.railArc > 0 && rc1.stats.damage > 0,
    `base=${rc1.base} after=${rc1.after} rider=${rc1.rider} stats=${rc1.stats.damage}`);

  const rc2 = await riderCase('longsword', 'moltenTrace', `d.spawnEnemy('wanderer',40,0)`, 1);
  check('W12 熔核裂爆：落点爆炸产生真实附加伤害',
    rc2.stats.byFusion.moltenTrace > 0 && rc2.stats.damage > 0,
    `base=${rc2.base} after=${rc2.after} rider=${rc2.rider} stats=${rc2.stats.damage}`);

  /* 每次挥击前补一只假人：保证 6 次调用都有命中，第 3 次必然触发共振环 */
  const rc3 = await riderCase('hammer', 'resonantEcho', `d.spawnEnemy('wanderer',40,0)`, 6, true);
  check('W13 共振回响：第 3 击触发共振环',
    rc3.stats.byFusion.resonantEcho > 0 && rc3.stats.damage > 0,
    `base=${rc3.base} after=${rc3.after} rider=${rc3.rider} stats=${rc3.stats.damage}`);

  /* 假人放在 105° 方向：既在"背后 ±110°"里，又不在双刃主挥击的两个扇区里 */
  const rc4 = await riderCase('twin', 'mirrorSplit', `d.spawnEnemy('wanderer',40,0);d.spawnEnemy('wanderer',-27,90)`, 1);
  check('W14 镜像分裂：背后目标额外挨刀',
    rc4.stats.byFusion.mirrorSplit > 0 && rc4.stats.damage > 0,
    `base=${rc4.base} after=${rc4.after} rider=${rc4.rider} stats=${rc4.stats.damage}`);

  const rc5 = await riderCase('spear', 'phaseLance', `d.spawnEnemy('wanderer',40,0);d.spawnEnemy('wanderer',110,0)`, 1);
  check('W15 相位贯穿：命中后方敌人被贯穿',
    rc5.stats.byFusion.phaseLance > 0 && rc5.stats.damage > 0,
    `base=${rc5.base} after=${rc5.after} rider=${rc5.rider} stats=${rc5.stats.damage}`);

  fs.writeFileSync(path.join(SHOT, 'fusion_w_damage.json'), JSON.stringify({
    railArc: rc1, moltenTrace: rc2, resonantEcho: rc3, mirrorSplit: rc4, phaseLance: rc5
  }, null, 2));

  // ---------- 8. 帧率与报错 ----------
  await sleep(1500);
  const final = await ev(`window.__roamDebug.getState()`);
  check('帧率 ≥ 60', final.fps >= 60, 'fps=' + final.fps);
  const errors = await ev(`window.__roamDebug.errors()`);
  check('运行期无报错', Array.isArray(errors) && errors.length === 0, JSON.stringify(errors).slice(0, 300));

  const passed = results.filter(r => r.ok).length;
  console.log(`\nRESULT: ${passed}/${results.length} PASS`);
  fs.writeFileSync(path.join(SHOT, 'fusion_report.json'), JSON.stringify(results, null, 2));
  ws.close(); killEdge(edge);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => { console.error('CRASH', err); process.exit(1); });
