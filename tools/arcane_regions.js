/**
 * 第 13 项 · 三大区 + 深度模式验收（R1–R10）
 * ------------------------------------------------------------
 * 覆盖"结构"这一层的硬判据，和量尺（arcane_ladder.js）互补：
 *   量尺   → 总血曲线是否单调、台阶是否落在允许区间；
 *   本脚本 → 大区是否正确成块、各区是否真的"换了一个世界"、
 *             深层封顶后是否只加机制、切区演出能否跳过、存档能否迁移。
 *
 * R1  大区分配正确（F1–6 机械 / F7–12 符文 / F13–18 虚空 / F19+ 深度）
 * R2  各区敌池不同（1/2/3 区两两不重叠；深度 = 三族全量并集）
 * R3  各区专属首领不同（F6 机械 / F12 符文 / F18 虚空；深层三首轮换）
 * R4  主题色 / 家具语言 / 房间素材 / 音乐层四件套逐区独立
 * R5  区末首领标记（6/12/18 为区域首领，其余为守卫首领）
 * R6  深层难度单调 + 封顶（F44 起血量 1.60 恒定，之后只加横向机制）
 * R7  切区演出可跳过（点击 / ESC）且可在设置里整体关闭
 * R8  存档含大区/深度字段、读回一致；旧档缺字段能按层数补齐
 * R9  三档难度在三大区与深层都可切换（F7/F13/F19/F30 强度序正确）
 * R10 单文件零依赖（唯一 <script> 无 src、无外链样式、无 @import）
 *
 * 用法：
 *   node tools\arcane_regions.js
 *   node tools\arcane_regions.js <主文件路径> <截图输出目录>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9574;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'regions');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;
let ws = null;

/** 记录一条断言并打印（与量尺脚本统一 PASS/FAIL 口径） */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/** 只打印、不计入断言（用于记录观测值） */
function note(name, detail) {
  results.push({ name, ok: true, note: true, detail });
  console.log(`NOTE  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/** 两个字符串数组的交集大小 */
function overlap(a, b) {
  const set = new Set(b);
  return a.filter((x) => set.has(x)).length;
}

/** 数组是否两两不同（按 JSON 文本比较） */
function allDistinct(list) {
  return new Set(list.map((x) => JSON.stringify(x))).size === list.length;
}

/** 主流程：起无头 Edge → 结构断言 → 演出/存档/难度 → 截图 → 落盘 */
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

  // ---- 等调试端口就绪 ----
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  ws = new WebSocket(target.webSocketDebuggerUrl);
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
  /** 在页面里求值（异常时把文本带回来，便于定位） */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  /** 截图 */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);
  await ev('window.__roamDebug.xp.setEnabled(false); true');
  await ev('__roamDebug.enemies.setAdaptive(false); true');

  // ============================================================
  // R1–R4：纯配置断言（一次求值取回所有需要的快照）
  // ============================================================
  const floors = [1, 5, 6, 7, 11, 12, 13, 17, 18, 19, 20, 21, 24, 30, 60, 120];
  const snap = await ev(`(() => {
    const cfg = __roamDebug.region.config();
    const info = {};
    [${floors.join(',')}].forEach((f) => { info[f] = __roamDebug.region.info(f); });
    const pools = {};
    cfg.regions.forEach((r) => { pools[r.pool] = __roamDebug.region.pool(r.from); });
    const bosses = {};
    [${floors.join(',')}].forEach((f) => { bosses[f] = __roamDebug.region.boss(f); });
    const themes = {};
    ['mech', 'rune', 'void', 'deep'].forEach((id) => {
      const t = THEME_CONFIG.themes[id] || {};
      themes[id] = { id, name: t.name, floorBase: t.floorBase, prop: t.prop,
        accent: t.accent, wash: t.floorWash ? t.floorWash.color : null };
    });
    const bgm = {};
    ['mech', 'rune', 'void', 'deep'].forEach((id) => {
      const b = BGM_CONFIG.themes[id];
      bgm[id] = b ? { pad: b.padFreqs.slice(), lowpass: b.lowpass, lfo: b.lfoRate } : null;
    });
    const templates = {};
    ['mech', 'rune', 'void', 'deep'].forEach((id) => {
      templates[id] = (ROOM_TEMPLATE_CONFIG.templates[id] || []).map((x) => x.id);
    });
    return { cfg, info, pools, bosses, themes, bgm, templates,
      poolOrigins: __roamDebug.region.pool(1).concat([]) };
  })()`);

  // ---- R1 大区分配 ----
  const expect = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 2,
    13: 3, 14: 3, 15: 3, 16: 3, 17: 3, 18: 3, 19: 4, 20: 4, 21: 4, 24: 4, 30: 4, 60: 4, 120: 4 };
  const expectName = { 1: '机械熔炉', 2: '符文回廊', 3: '虚空深渊', 4: '深层回廊' };
  const badRegion = floors.filter((f) => !expect[f] || snap.info[f].index !== expect[f]
    || snap.info[f].name !== expectName[expect[f]]);
  check('R1 大区分配正确（F1–6 机械 / F7–12 符文 / F13–18 虚空 / F19+ 深度）',
    badRegion.length === 0 && snap.cfg.regions.length === 4, badRegion.length ? badRegion : 'F1–F120 全部匹配');

  // ---- R2 敌池 ----
  const p1 = snap.pools[1] || [];
  const p2 = snap.pools[2] || [];
  const p3 = snap.pools[3] || [];
  const p4 = snap.pools[4] || [];
  const disjoint123 = overlap(p1, p2) === 0 && overlap(p1, p3) === 0 && overlap(p2, p3) === 0;
  const deepIsUnion = p1.every((x) => p4.indexOf(x) >= 0)
    && p2.every((x) => p4.indexOf(x) >= 0)
    && p3.every((x) => p4.indexOf(x) >= 0);
  check('R2a 三区敌池两两不重叠且各 ≥5 只',
    disjoint123 && p1.length >= 5 && p2.length >= 5 && p3.length >= 5,
    { p1: p1.length, p2: p2.length, p3: p3.length, overlap: [overlap(p1, p2), overlap(p1, p3), overlap(p2, p3)] });
  check('R2b 深度敌池 = 三族全量并集（混合压力，不是换色区）',
    deepIsUnion && p4.length === p1.length + p2.length + p3.length,
    { deep: p4.length, sum: p1.length + p2.length + p3.length });

  // ---- R3 专属首领 ----
  const b6 = snap.bosses[6];
  const b12 = snap.bosses[12];
  const b18 = snap.bosses[18];
  check('R3a 区末首领逐区不同（F6 机械 / F12 符文 / F18 虚空）',
    b6 === 'mech' && b12 === 'rune' && b18 === 'void' && allDistinct([b6, b12, b18]),
    { F6: b6, F12: b12, F18: b18 });
  const b19 = snap.bosses[19];
  const b20 = snap.bosses[20];
  const b21 = snap.bosses[21];
  check('R3b 深层三首轮换（F19/F20/F21 各不相同）',
    allDistinct([b19, b20, b21]) && [b19, b20, b21].every((id) => ['mech', 'rune', 'void'].indexOf(id) >= 0),
    { F19: b19, F20: b20, F21: b21 });
  check('R3c 区域首领标记只在 6/12/18（深层不设区末）',
    snap.info[6].regionBoss === true && snap.info[12].regionBoss === true
    && snap.info[18].regionBoss === true && snap.info[19].regionBoss === false
    && snap.info[5].regionBoss === false && snap.info[11].regionBoss === false,
    [6, 12, 18, 19, 5, 11].map((f) => `${f}:${snap.info[f].regionBoss}`));

  // ---- R4 主题色 / 家具 / 房型 / 音乐 ----
  const themeIds = ['mech', 'rune', 'void', 'deep'];
  const t = snap.themes;
  check('R4a 四区主题底色 / 洗色 / 强调色全部不同',
    allDistinct(themeIds.map((id) => t[id].floorBase))
    && allDistinct(themeIds.map((id) => t[id].wash))
    && allDistinct(themeIds.map((id) => t[id].accent)),
    themeIds.map((id) => `${id}:${t[id].floorBase}/${t[id].wash}`));
  check('R4b 家具语言逐区独立（pipes / runes / debris / deep）',
    allDistinct(themeIds.map((id) => t[id].prop))
    && themeIds.every((id, i) => t[id].prop === (['pipes', 'runes', 'debris', 'deep'][i])),
    themeIds.map((id) => t[id].prop));
  const tpl = snap.templates;
  const allTplIds = tpl.mech.concat(tpl.rune, tpl.void, tpl.deep);
  check('R4c 房间素材逐区独立（每区 2 套、跨区不重名）',
    themeIds.every((id) => tpl[id].length >= 2)
    && allDistinct(allTplIds)
    && allDistinct([tpl.mech[0], tpl.rune[0], tpl.void[0], tpl.deep[0]]),
    tpl);
  check('R4d 音乐层四套独立（低频垫 / 低通 / LFO 均不同）',
    themeIds.every((id) => snap.bgm[id] && snap.bgm[id].pad.length >= 2)
    && allDistinct(themeIds.map((id) => snap.bgm[id].pad))
    && allDistinct(themeIds.map((id) => snap.bgm[id].lowpass + '|' + snap.bgm[id].lfo)),
    themeIds.map((id) => `${id}:${snap.bgm[id] ? snap.bgm[id].pad.join(',') : 'null'}`));

  // ============================================================
  // R5：区末首领的真实生成标记（不只读配置）
  // ============================================================
  const bossRows = [];
  for (const f of [5, 6, 11, 12, 17, 18, 19, 25]) {
    /* eslint-disable no-await-in-loop */
    const row = await ev(`(() => {
      __roamDebug.enemies.floor(${f});
      const boss = state.boss;
      const room = state.rooms.find((r) => r.type === 'boss');
      return {
        f: ${f}, regionId: state.regionId, tier: state.depthTier,
        boss: boss ? { isRegionBoss: boss.isRegionBoss, regionId: boss.regionId, title: boss.title, hpMax: boss.hpMax, kind: boss.kind } : null,
        room: room ? { isRegionBoss: room.isRegionBoss, regionId: room.regionId } : null
      };
    })()`);
    bossRows.push(row);
  }
  const regionBossRows = bossRows.filter((r) => [6, 12, 18].indexOf(r.f) >= 0);
  const guardRows = bossRows.filter((r) => [5, 11, 17, 19, 25].indexOf(r.f) >= 0);
  check('R5a F6/F12/F18 生成后首领与首领房都带区域首领标记',
    regionBossRows.length === 3
    && regionBossRows.every((r) => r.boss && r.boss.isRegionBoss === true && r.room && r.room.isRegionBoss === true)
    && regionBossRows.every((r) => String(r.boss.title || '').indexOf('区域首领') >= 0),
    regionBossRows.map((r) => `${r.f}:${r.boss && r.boss.title}`));
  check('R5b 其余楼层是守卫首领（F19+ 显示深层首领）',
    guardRows.every((r) => r.boss && r.boss.isRegionBoss === false && r.room && r.room.isRegionBoss === false),
    guardRows.map((r) => `${r.f}:${r.boss && r.boss.title}`));

  // ============================================================
  // R6：深层档位曲线（单调 + 封顶 + 横向机制）
  // ============================================================
  const deepCurve = await ev(`(() => {
    const rows = [];
    for (let f = 19; f <= 200; f += 1) {
      const i = __roamDebug.region.info(f);
      rows.push({ f, tier: i.tier, hp: i.hpMul, h: i.horizontal,
        dmg: i.mods.damageMul, spd: i.mods.speedMul, hz: i.mods.hazardMul });
    }
    return rows;
  })()`);
  const tierUp = deepCurve.every((r, i) => i === 0 || r.tier >= deepCurve[i - 1].tier);
  const hpUp = deepCurve.every((r, i) => i === 0 || r.hp >= deepCurve[i - 1].hp);
  const capRow = deepCurve.find((r) => r.tier === 6);
  const capFloor = capRow ? capRow.f : -1;
  const capHeld = deepCurve.filter((r) => r.f >= capFloor).every((r) => Math.abs(r.hp - 1.60) < 1e-9);
  const maxHp = Math.max.apply(null, deepCurve.map((r) => r.hp));
  check('R6a 深层档位单调不降、血量倍率单调不降',
    tierUp && hpUp, { tierAt19: deepCurve[0].tier, tierAt200: deepCurve[deepCurve.length - 1].tier, maxHp });
  check(`R6b 血量封顶生效（F${capFloor} 起恒为 1.60，F200 仍 1.60）`,
    capHeld && maxHp <= 1.60 + 1e-9, { capFloor, maxHp });
  const hAfter = deepCurve.filter((r) => r.f >= 49);
  const hGrows = hAfter.length > 1
    && hAfter[hAfter.length - 1].h > hAfter[0].h
    && hAfter.every((r, i) => i === 0 || r.h >= hAfter[i - 1].h);
  const hCapped = hAfter.every((r) => r.dmg <= 2.0 + 1e-9 && r.spd <= 1.5 + 1e-9 && r.hz <= 1.6 + 1e-9);
  check('R6c 封顶后转为横向加机制（伤害/移速/危险地形，且有各自上限）',
    hGrows && hCapped,
    { from49: hAfter[0], to200: hAfter[hAfter.length - 1] });
  check('R6d 深层不设区末、层数不封顶（F120/F200 仍归深度且档位有效）',
    snap.info[120].index === 4 && snap.info[120].tier === 6
    && deepCurve[deepCurve.length - 1].f === 200,
    { F120: snap.info[120].tier, last: deepCurve[deepCurve.length - 1] });

  // ============================================================
  // R7：切区演出（可跳过 + 可关闭）
  // ============================================================
  const trans1 = await ev(`(() => {
    playFloorTransition(7, true);
    const el = document.getElementById('floorWipe');
    return {
      on: el.classList.contains('is-on'),
      region: el.classList.contains('region'),
      name: (document.getElementById('wipeRegionText') || {}).textContent,
      kicker: (document.getElementById('wipeKicker') || {}).textContent,
      accent: el.style.getPropertyValue('--wipe-accent'),
      skippable: REGION_CONFIG.transition.skippable !== false
    };
  })()`);
  check('R7a 跨区时播区域演出（区域名 + 主题色 + REGION kicker）',
    trans1.on && trans1.region && String(trans1.name).indexOf('符文回廊') >= 0
    && String(trans1.kicker).indexOf('REGION') >= 0,
    trans1);
  const trans2 = await ev(`(() => {
    skipFloorWipe();
    const el = document.getElementById('floorWipe');
    return { on: el.classList.contains('is-on'), region: el.classList.contains('region') };
  })()`);
  check('R7b 点击/ESC 跳过演出立即收尾', trans2.on === false && trans2.region === false, trans2);
  const trans3 = await ev(`(() => {
    playFloorTransition(13, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const el = document.getElementById('floorWipe');
    return { on: el.classList.contains('is-on'), region: el.classList.contains('region') };
  })()`);
  check('R7c ESC 键可跳过区域演出', trans3.on === false && trans3.region === false, trans3);
  const trans4 = await ev(`(() => {
    setRegionFx(false);
    playFloorTransition(19, true);
    const el = document.getElementById('floorWipe');
    const out = {
      region: el.classList.contains('region'),
      name: (document.getElementById('wipeRegionText') || {}).textContent,
      fx: state.meta && state.meta.regionFx
    };
    setRegionFx(true);
    return out;
  })()`);
  check('R7d 关闭演出后跨区不再弹区域全屏（普通下楼仍保留）',
    trans4.region === false && String(trans4.name || '') === '' && trans4.fx === false,
    trans4);

  // ============================================================
  // R8：存档字段 + 旧档迁移
  // ============================================================
  await ev('__roamDebug.setFloor(13); true');
  const save = await ev(`(() => {
    const snapState = (typeof snapshotRunState === 'function') ? snapshotRunState() : null;
    const stateKeys = {
      floor: state.floor, regionId: state.regionId, regionIndex: state.regionIndex,
      regionName: state.regionName, depthTier: state.depthTier, depthHorizontal: state.depthHorizontal
    };
    const snapKeys = snapState ? {
      floor: snapState.floor, regionId: snapState.regionId, regionIndex: snapState.regionIndex,
      regionName: snapState.regionName, depthTier: snapState.depthTier, depthHorizontal: snapState.depthHorizontal
    } : null;
    // 旧档：没有大区/深度字段，只靠 floor 迁移
    const oldSave = { floor: 7, hp: 100 };
    const migrated = ensureRegionState(oldSave);
    // 错位档：字段与 floor 不一致，必须以 floor 为准
    const wrongSave = { floor: 13, regionId: 'foundry', regionIndex: 1, depthTier: 5 };
    const fixed = ensureRegionState(wrongSave);
    return { stateKeys, snapKeys, hasSnap: !!snapState,
      migrated: { regionId: migrated.regionId, regionIndex: migrated.regionIndex, tier: migrated.depthTier },
      fixed: { regionId: fixed.regionId, regionIndex: fixed.regionIndex, tier: fixed.depthTier } };
  })()`);
  check('R8a 存档快照含大区/深度字段且与运行态一致',
    save.hasSnap && JSON.stringify(save.snapKeys) === JSON.stringify(save.stateKeys),
    save.snapKeys);
  check('R8b 旧档（无大区字段）按 floor 迁移：F7→符文区、深度档 0',
    save.migrated.regionId === 'gallery' && save.migrated.regionIndex === 2 && save.migrated.tier === 0,
    save.migrated);
  check('R8c 字段与 floor 错位时以 floor 为准（F13→虚空区）',
    save.fixed.regionId === 'abyss' && save.fixed.regionIndex === 3 && save.fixed.tier === 0,
    save.fixed);

  // ============================================================
  // R9：三档难度在三大区与深层都可用（强度序 nightmare > normal > easy）
  // ============================================================
  const modes = ['easy', 'normal', 'nightmare'];
  const diffFloors = [1, 6, 7, 13, 19, 30, 60];
  /* 第 13 项：难度序改成"固定敌人 + 固定层"对照，绕开掷房噪声。
     掷房每层只出 5–6 只，且每轮的敌种组合不同；普通/困难的血倍率只差 3.8%（2.60→2.70），
     用 6 次掷房的均值比大小会被 5% 的样本噪声直接翻盘。这里直接调 spawnEnemy
     生成同一敌种，hpMax 公式是确定性的（conf.hp × floorScale^f × diff.hpMul × 精英/词缀），
     所以三档大小关系必须严格成立。 */
  const diffProbe = await ev(`(() => {
    const floors = [${diffFloors.join(',')}];
    const modes = ${JSON.stringify(modes)};
    const out = { available: {}, perEnemy: {} };
    floors.forEach((f) => {
      state.floor = f;
      out.available[f] = {};
      out.perEnemy[f] = {};
      const typeId = regionPoolForFloor(f)[0];
      const keep = state.enemies.length;
      modes.forEach((m) => {
        state.difficulty = m;
        out.available[f][m] = difficultyId() === m;
        const probe = spawnEnemy(typeId, state.player.x + 140, state.player.y, f);
        out.perEnemy[f][m] = probe.hpMax;
      });
      state.enemies.length = keep; // 只回收探针怪，id 计数器保持单调以免撞号
    });
    state.difficulty = 'normal';
    return out;
  })()`);
  const availOk = diffFloors.every((f) => modes.every((m) => diffProbe.available[f][m] === true));
  check('R9a 三档难度在 F1/F6/F7/F13/F19/F30/F60 都能被选中',
    availOk, diffProbe.available);
  const orderFloors = [7, 13, 19, 30];
  const orderRows = orderFloors.map((f) => ({
    f,
    easy: diffProbe.perEnemy[f].easy,
    normal: diffProbe.perEnemy[f].normal,
    nightmare: diffProbe.perEnemy[f].nightmare
  }));
  check('R9b 三档在每个大区与深层都保持 困难 > 普通 > 简单',
    orderRows.every((r) => r.nightmare > r.normal && r.normal > r.easy),
    orderRows);

  // ============================================================
  // R10：单文件零依赖（直接读文件文本，不依赖页面状态）
  // ============================================================
  const html = fs.readFileSync(FILE, 'utf8');
  const scriptTags = (html.match(/<script\b[^>]*>/gi) || []);
  const hasSrc = scriptTags.some((tag) => /\bsrc\s*=/i.test(tag));
  const styleLinks = (html.match(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi) || []);
  const cssImports = (html.match(/@import\s+[^;]+;/gi) || []);
  check('R10 单文件零依赖（唯一 <script> 无 src、无外链样式、无 @import）',
    scriptTags.length === 1 && !hasSrc && styleLinks.length === 0 && cssImports.length === 0,
    { scripts: scriptTags.length, hasSrc, styleLinks: styleLinks.length, cssImports: cssImports.length });

  // ============================================================
  // 截图（≤4 张：区域首领 / 虚空区 / 深层）
  // ============================================================
  /** 把玩家摆到当前层第一个战斗房，便于截到"主题 + 敌人" */
  const pose = `(() => {
    state.mode = 'playing'; state.status = 'playing';
    const r = state.rooms.find((x) => x.type === 'battle') || state.rooms[0];
    if (!r) return false;
    const p = state.player;
    p.x = r.cx; p.y = r.cy + 40; p.vx = 0; p.vy = 0;
    p.invuln = 9;
    return true;
  })()`;
  await ev('__roamDebug.enemies.floor(6); true');
  await ev(pose);
  await sleep(700);
  await shot('regions-f6-regionboss.png');
  await ev('__roamDebug.enemies.floor(12); true');
  await ev(pose);
  await sleep(500);
  await shot('regions-f12-gallery.png');
  await ev('__roamDebug.enemies.floor(13); true');
  await ev(pose);
  await sleep(500);
  await shot('regions-f13-abyss.png');
  await ev('__roamDebug.enemies.floor(19); true');
  await ev(pose);
  await sleep(500);
  await shot('regions-f19-deep.png');

  // ---- 产出 JSON ----
  const outPath = path.join(OUT, 'regions-report.json');
  fs.writeFileSync(outPath, JSON.stringify({
    at: new Date().toISOString(),
    floors, snap, bossRows, deepCurve, capFloor, diffProbe, checks: results
  }, null, 2));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS · ${outPath}`);
  ws.close();
  killEdge(EDGE_PROC);
  EDGE_PROC = null;
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((err) => {
  console.error('FATAL', err);
  if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
  if (EDGE_PROC) killEdge(EDGE_PROC);
  process.exit(1);
});
