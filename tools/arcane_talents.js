/**
 * 第 11 项 · 永久天赋 v2 验收（A1–A15）
 * 用法：node tools/arcane_talents.js
 * 端口：9542
 * 覆盖：配置结构 / 互斥 / 前置 / 封顶实测 / 洗点 75%+手续费 / 进阶对冲 /
 *       旧档迁移 / 五态 UI / 悬停文案与配置一致 / 节奏 8–14 与 20–25 局 / 入口不破坏
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9542;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name
    + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1600);
  // 干净档：清掉元存档后再载入
  await ev("(function(){ localStorage.clear(); return true; })()");
  await send('Page.reload');
  await sleep(1500);
  await ev("(function(){ var b=document.querySelector('#btnStart'); if(b) b.click(); return state.mode; })()");
  await sleep(700);

  // ---------- A1 配置结构 ----------
  const cfg = await ev('__talentDebug.config()');
  const groups = {};
  cfg.items.forEach((it) => { if (it.group) groups[it.group] = (groups[it.group] || 0) + 1; });
  const cats = cfg.items.reduce((acc, it) => { acc[it.cat] = (acc[it.cat] || 0) + 1; return acc; }, {});
  ok('A1 配置结构：30 项 / 四类 / ≥6 互斥排 / 三层价 3-5-6',
    cfg.items.length >= 28 && cfg.items.length <= 34 &&
    cats.survival > 0 && cats.output > 0 && cats.economy > 0 && cats.unlock > 0 &&
    Object.keys(groups).length >= 6 &&
    cfg.tiers[1].cost === 3 && cfg.tiers[2].cost === 5 && cfg.tiers[3].cost === 6 &&
    cfg.tiers[2].prereq && cfg.tiers[3].prereq,
    { count: cfg.items.length, cats, groups: Object.keys(groups).length });

  // ---------- A2 总开关：关闭后与旧行为一致（所有加成归零、买不了） ----------
  const offProbe = await ev(`(function(){
    TALENT_V2_CONFIG.enabled = false;
    var before = __talentDebug.eff('damage');
    var bought = __talentDebug.buy('hp');
    TALENT_V2_CONFIG.enabled = true;
    return { eff: before, bought: bought, reason: buyTalent.lastReason, count: TALENT_CONFIG.length };
  })()`);
  ok('A2 总开关关闭：加成归零 / 购买被拒 / 配置仍在',
    offProbe.eff === 0 && offProbe.bought === false && offProbe.reason === 'disabled',
    offProbe);

  // ---------- A3 前置不足 ----------
  const pre1 = await ev(`(function(){
    __talentDebug.setCrystals(9999);
    __talentDebug.resetTalents();
    var r = __talentDebug.buy('regen');
    return { ok: r, reason: buyTalent.lastReason, state: __talentDebug.info().states.regen,
      crystals: __talentDebug.info().crystals };
  })()`);
  ok('A3 前置不足：T2 未买 T1 时不可买',
    pre1.ok === false && pre1.reason === 'prereq' && pre1.state === 'prereq',
    pre1);

  // ---------- A4 按层价格扣费 ----------
  const price1 = await ev(`(function(){
    var c0 = __talentDebug.info().crystals;
    var ok1 = __talentDebug.buy('hp');        // T1 = 3
    var c1 = __talentDebug.info().crystals;
    return { ok1: ok1, spent: c0 - c1, level: __talentDebug.info().levels.hp };
  })()`);
  ok('A4 按层价格：T1 扣 3 结晶且等级 +1',
    price1.ok1 === true && price1.spent === 3 && price1.level === 1, price1);

  // ---------- A5 互斥：真锁 + 状态 + 文案 ----------
  const excl = await ev(`(function(){
    var a = __talentDebug.buy('armor');
    var b = __talentDebug.buy('swift');
    return { a: a, b: b, reason: buyTalent.lastReason,
      swiftState: __talentDebug.info().states.swift,
      armorTip: __talentDebug.hover('armor'),
      swiftTip: __talentDebug.hover('swift') };
  })()`);
  ok('A5 互斥：买坚壁后疾影被锁（状态 exclusive / 购买被拒）',
    excl.a === true && excl.b === false && excl.reason === 'exclusive' && excl.swiftState === 'exclusive',
    { a: excl.a, b: excl.b, reason: excl.reason, swiftState: excl.swiftState });
  ok('A5b 互斥文案从配置反解：互相点名',
    /疾影/.test(excl.armorTip) && /坚壁/.test(excl.swiftTip),
    { armorTip: excl.armorTip, swiftTip: excl.swiftTip });

  // ---------- A6 洗点 75% + 手续费 + 日志 + 复原 ----------
  const respec = await ev(`(function(){
    var i0 = __talentDebug.info();
    var spent = i0.spent.survival;             // hp 3 + armor 3 = 6
    var c0 = i0.crystals;
    var r = __talentDebug.respec('survival');
    var i1 = __talentDebug.info();
    var c1 = i1.crystals;
    var undo = __talentDebug.undo();
    var i2 = __talentDebug.info();
    return { spent: spent, c0: c0, c1: c1, r: r,
      delta: c1 - c0, levelsAfter: i1.levels.hp, logLen: i1.respecLog.length,
      undo: undo, levelsRestored: i2.levels.hp, crystalsRestored: i2.crystals };
  })()`);
  const expectRefund = Math.floor(respec.spent * cfg.respec.refund);
  ok('A6 洗点：返还 75% 且扣手续费（净额 = 返还 − 手续费）',
    respec.r.ok === true && respec.r.refund === expectRefund &&
    respec.r.fee === cfg.respec.feeCategory &&
    respec.delta === expectRefund - cfg.respec.feeCategory &&
    respec.levelsAfter === 0,
    { spent: respec.spent, refund: respec.r.refund, fee: respec.r.fee, delta: respec.delta });
  ok('A6b 洗点日志可复原：undo 后等级与结晶回滚',
    respec.undo === true && respec.levelsRestored === 1 &&
    respec.crystalsRestored === respec.c0,
    { levels: respec.levelsRestored, crystals: respec.crystalsRestored, origin: respec.c0 });

  // ---------- A7 封顶实测：伤害 / 减伤 / 经济 ----------
  // 输出类拉满 → 关掉暴击随机 → 真实 damageEnemy 前后对比
  const capProbe = await ev(`(function(){
    var out = TALENT_CONFIG.filter(function(t){ return t.cat === 'output'; });
    if (!state.enemies.length) spawnEnemyNearPlayer(ENEMY_CONFIG.list[0].id, 60, 0);
    var target = state.enemies[0];
    var critBackup = FEEL_CONFIG.critChance;
    var relicBackup = state.relics.firstStrike;
    FEEL_CONFIG.critChance = 0;          // 去掉暴击随机
    state.relics.firstStrike = 0;        // 去掉"先手 ×1.8"，否则第二次会吃到首击加成
    /** 打 5 次取均值：抹平 ±伤害浮动，且每次重置破防/裂印等状态 */
    var measure = function(){
      var sum = 0;
      for (var i = 0; i < 5; i += 1) {
        target.hp = 1000000; target.hpMax = 1000000; target.shield = 0;
        target.mark = null; target.breakWindow = 0; target.coreOpen = 0; target.breakBar = 0;
        var h = target.hp;
        damageEnemy(target, 100, 0, { noCrit: true });
        sum += h - target.hp;
      }
      return sum / 5;
    };
    out.forEach(function(t){ __talentDebug.setLevel(t.id, t.maxLevel); });
    var modsSnapshot = JSON.parse(JSON.stringify(state.mods || {}));   // 冻结同一套随机词条
    var full = measure();
    out.forEach(function(t){ __talentDebug.setLevel(t.id, 0); });
    state.mods = JSON.parse(JSON.stringify(modsSnapshot));              // 复原词条后再测基线
    var base = measure();
    out.forEach(function(t){ __talentDebug.setLevel(t.id, t.maxLevel); });
    FEEL_CONFIG.critChance = critBackup;
    state.relics.firstStrike = relicBackup;
    return { full: full, base: base, ratio: base ? full / base : 0,
      raw: __talentDebug.raw('damage'), capped: __talentDebug.capped('damage'),
      totals: __talentDebug.info().totals };
  })()`);
  const cap = cfg.caps.damage;
  ok('A7 伤害类封顶：类别原始合计超额 → 折算到 +35%，实测伤害 ≤ 1.35 倍',
    capProbe.totals.damage.raw > cap &&
    Math.abs(capProbe.totals.damage.capped - cap) < 1e-6 &&
    capProbe.ratio > 1 && capProbe.ratio <= 1 + cap + 0.02,
    { categoryRaw: capProbe.totals.damage.raw, categoryCapped: capProbe.totals.damage.capped,
      ratio: capProbe.ratio, cap: cap });

  const mitProbe = await ev(`(function(){
    var sur = TALENT_CONFIG.filter(function(t){ return t.stat === 'mitigation'; });
    sur.forEach(function(t){ __talentDebug.setLevel(t.id, 4); });
    var hp0 = state.player.hp;
    state.player.hp = 1000; state.player.hpMax = 1000;
    state.player.invuln = 0; state.player.shield = 0;
    var before = state.player.hp;
    damagePlayer(100, 'test', 'test', null);
    var applied = before - state.player.hp;
    var raw = __talentDebug.raw('mitigation');
    var capped = __talentDebug.capped('mitigation');
    state.player.hp = hp0;
    return { applied: applied, raw: raw, capped: capped,
      totals: __talentDebug.info().totals.mitigation };
  })()`);
  ok('A7b 减伤类封顶：类别原始合计超额 → 折算到 −30%，实测扣血 ≤ 70',
    mitProbe.totals.raw > cfg.caps.mitigation &&
    Math.abs(mitProbe.totals.capped - cfg.caps.mitigation) < 1e-6 &&
    mitProbe.applied <= 70.01 && mitProbe.applied >= 55,
    { categoryRaw: mitProbe.totals.raw, categoryCapped: mitProbe.totals.capped,
      applied: mitProbe.applied });

  const ecoProbe = await ev(`(function(){
    var ecos = TALENT_CONFIG.filter(function(t){ return TALENT_CATEGORY_CONFIG[t.cat].cap === 'economy'; });
    ecos.forEach(function(t){ __talentDebug.setLevel(t.id, 0); });
    __talentDebug.setLevel('greed', 3);                 // 单点：结晶 +30%
    var c0 = state.meta.crystals;
    var cappedAlone = __talentDebug.capped('crystal');   // 必须在"只点结晶"时读
    var g1 = grantRunCrystals(10, 'probe1');
    var c1 = state.meta.crystals;
    ecos.forEach(function(t){ __talentDebug.setLevel(t.id, t.maxLevel); });
    var sum = 0;
    ['crystal','shopDiscount','wagerDiscount','altarDiscount','chestRarity','eventChance']
      .forEach(function(s){ sum += __talentDebug.capped(s); });
    return { alone: c1 - c0, granted: g1, cappedAlone: cappedAlone,
      total: __talentDebug.info().totals.economy, sum: sum };
  })()`);
  ok('A7c 经济类封顶：单点 +30% 实测入账 13；满配合计折算到 +60%',
    ecoProbe.alone === 13 && ecoProbe.granted === 13 &&
    Math.abs(ecoProbe.cappedAlone - 0.30) < 1e-6 &&
    ecoProbe.total.raw > cfg.caps.economy &&
    Math.abs(ecoProbe.total.capped - cfg.caps.economy) < 1e-6 &&
    Math.abs(ecoProbe.sum - cfg.caps.economy) < 1e-6,
    { alone: ecoProbe.alone, categoryRaw: ecoProbe.total.raw,
      categoryCapped: ecoProbe.total.capped, sumOfStats: ecoProbe.sum });

  // ---------- A8 进阶对冲 ----------
  const ascProbe = await ev(`(function(){
    __talentDebug.setLevel('startPool', 2);   // 解锁类：确保有可观测的加成
    state.meta.ascensionUnlocked = 4;
    setAscension(4);
    var mul = __talentDebug.info().ascMul;
    var dmg = __talentDebug.eff('damage');
    var unlock = __talentDebug.eff('startPool');
    var capped = __talentDebug.capped('damage');
    setAscension(0);
    return { mul: mul, dmg: dmg, unlock: unlock, capped: capped };
  })()`);
  ok('A8 进阶对冲：4 级 → 0.68，输出类按 0.68 折算，解锁类豁免',
    Math.abs(ascProbe.mul - 0.68) < 1e-6 &&
    Math.abs(ascProbe.dmg - ascProbe.capped * 0.68) < 1e-6 &&
    ascProbe.unlock > 0,
    ascProbe);

  // ---------- A9 五态 UI + 互斥带 + 悬停一致 ----------
  const page = await ev(`(function(){
    __talentDebug.setCrystals(9999);
    __talentDebug.open();
    return __talentDebug.page();
  })()`);
  const texts = new Set(page.cards.map((c) => c.stateText.trim()));
  const groupCards = page.cards.filter((c) => c.group);
  ok('A9 天赋页：30 张卡 / 五态文字编码 / 互斥卡带 data-group',
    page.open === true && page.cards.length === cfg.items.length &&
    page.cards.every((c) => c.cls.indexOf('is-') >= 0 && c.stateText.trim().length > 0) &&
    texts.size >= 3 && groupCards.length === cfg.items.filter((i) => i.group).length,
    { cards: page.cards.length, states: Array.from(texts), groupCards: groupCards.length });

  // 悬停文案 vs 配置：同组互相点名，且不能点到别组的人
  const hoverBad = [];
  page.cards.forEach((card) => {
    if (!card.group) return;
    const groupItems = cfg.items.filter((i) => i.group === card.group);
    const others = groupItems.filter((i) => i.id !== card.id);
    const missing = others.filter((o) => card.tip.indexOf(o.name) < 0);
    const outsider = cfg.items.filter((i) => i.group !== card.group && card.tip.indexOf(i.name) >= 0);
    if (missing.length || outsider.length) hoverBad.push({ id: card.id, tip: card.tip, missing: missing.map((m) => m.name), outsider: outsider.map((m) => m.name) });
  });
  ok('A9b 悬停说明与配置一致：同桌互相点名、不误伤别组', hoverBad.length === 0, hoverBad.slice(0, 4));

  // 封顶进度条：三类都在头部
  ok('A9c 顶部封顶进度条：三类合计 + 上限可见',
    /伤害类/.test(page.caps) && /减伤类/.test(page.caps) && /经济类/.test(page.caps)
    && /上限/.test(page.caps), { caps: page.caps.slice(0, 120) });

  // ---------- A10 标题 / 结算入口不破坏 ----------
  const entry = await ev(`(function(){
    __talentDebug.close();
    var bodies = document.querySelectorAll('[data-talent-body]');
    var rows = document.querySelectorAll('[data-talent-body] .talent-row');
    var openBtns = document.querySelectorAll('[data-talent-open]');
    return { bodies: bodies.length, rows: rows.length, openBtns: openBtns.length };
  })()`);
  ok('A10 小面板保持 3 行速览 + 打开天赋页按钮',
    entry.bodies > 0 && entry.rows === 3 && entry.openBtns > 0, entry);

  // ---------- A11 节奏：28–40/局、买满 7–9 局（C1 重标定） ----------
  const pace = await ev('__talentDebug.info().pace');
  ok('A11 节奏：每局 28–40 结晶 / 买满 7–9 局',
    pace.ok === true && pace.total === 229 && pace.perRun >= 28 && pace.perRun <= 40 &&
    pace.runs >= 7 && pace.runs <= 9,
    { total: pace.total, perRun: pace.perRun, runs: pace.runs });

  // ---------- A12 每局结晶实测（复用探针链路：逐房间清场 + 下楼） ----------
  await ev("(function(){ localStorage.clear(); return true; })()");
  await send('Page.reload');
  await sleep(1500);
  await ev("(function(){ var b=document.querySelector('#btnStart'); if(b) b.click(); return state.mode; })()");
  await sleep(700);
  /* R · 开局随机化后：节奏测量必须可复现 → 固定 3 颗种子各跑一局机器人清场 */
  const paceSeeds = [9713, 4207, 8831];
  const paceRuns = [];
  for (let s = 0; s < paceSeeds.length; s += 1) {
    await ev(`(function(){
      __roamDebug.openRandom.setSeed(${paceSeeds[s]});
      state = createInitialState();
      generateFloor(1);
      state.mode = 'playing';
      state.status = 'playing';
      state.player.invuln = 1e9;
      renderDeck();
      if (!window.__origGrant) {
        window.__origGrant = grantRunCrystals;
        grantRunCrystals = function(a, r) {
          var g = window.__origGrant(a, r);
          window.__crysLog.push([r, g]);
          return g;
        };
      }
      window.__crysLog = [];
      return state.openRandom.card;
    })()`);
    await sleep(400);
    const floorTypes = [];
    let guard = 0;
    /* 一局 = GAME_CONFIG.finalFloor 层（5 层）。踩到楼梯会自动下楼，
       所以按"实际 state.floor"推进，不能用循环下标（否则会跳过一层、记成 0）。 */
    while (guard < 8) {
      guard += 1;
      const fl = await ev('state.floor');
      if (fl > 5) break;
      /* 第 5 层首领被打败后整局结束（mode 变 result）；商店 / 事件是临时弹窗（mode 会短暂变化），不算结束 */
      const md = await ev('state.mode');
      if (md === 'result' || md === 'title') break;
      const roomCount = await ev('state.rooms.length');
      floorTypes.push(await ev('state.rooms.map(function(r){ return r.type; }).join(",")'));
      let advanced = false;
      for (let i = 0; i < roomCount && !advanced; i += 1) {
        /* 落点避开房间正中的楼梯（踩上去会自动下楼，导致本层没杀完就换层）；
           顺手补满血与无敌，避免机器人踩陷阱被秒（真人会走位，这不改变结算口径） */
        await ev(`(function(){ var r=state.rooms[${i}]; state.player.x=r.cx-r.w*0.22; state.player.y=r.cy-r.h*0.22; state.player.hp=state.player.hpMax; state.player.invuln=1e9; snapCamera(); return r.type; })()`);
        await sleep(180);
        /* 等房间真正刷怪（进房刷怪有 1 帧延迟，过早 killAllEnemies 会漏整层） */
        for (let w = 0; w < 10; w += 1) {
          if (await ev('state.enemies.length') > 0) break;
          await sleep(140);
        }
        await ev('__roamDebug.killAllEnemies()');
        /* 完整一局必须算上首领宝箱（真实玩家按 E 打开；机器人直接结算，避免遗漏） */
        await ev("(function(){ if (state.bossChest && !state.bossChest.granted && typeof grantBossTreasure === 'function') { grantBossTreasure(state.bossChest); return true; } return false; })()");
        await ev("(function(){ var b=document.querySelector('#modal [data-reward-key]'); if(b) b.click(); return null; })()");
        await sleep(90);
        if (await ev('state.floor') !== fl) advanced = true;
      }
      if (!advanced) {
        await ev('(function(){ if (typeof descendFloor === "function") { return descendFloor(); } return "no"; })()');
        for (let w = 0; w < 12; w += 1) {
          if (await ev('state.floor') > fl) break;
          await sleep(150);
        }
      }
    }
    const log = await ev('window.__crysLog');
    /* 口径：常规一局 = 全部入账减去"放血契约"这类可选取舍（以血换结晶，玩家主动选择才发生） */
    const total = log.reduce((a, e) => a + (e[0] === 'pactGreed' ? 0 : e[1]), 0);
    const greed = log.reduce((a, e) => a + (e[0] === 'pactGreed' ? e[1] : 0), 0);
    paceRuns.push({
      seed: paceSeeds[s],
      card: await ev('state.openRandom.card'),
      floors: floorTypes,
      perRun: total,
      greed: greed,
      log: log
    });
  }
  const paceOk = paceRuns.every((r) => r.perRun >= cfg.pace.crystalsPerRunMin && r.perRun <= cfg.pace.crystalsPerRunMax);
  ok('A12 实测每局结晶：3 颗种子、5 层完整一局均落在 28–40（不含放血契约）', paceOk, { runs: paceRuns });

  // ---------- A13 旧档迁移（v6 → v7） ----------
  const migrated = await ev(`(function(){
    var key = GAME_CONFIG.metaKey;
    var old = {
      version: 6, runs: 3, bestFloor: 4, crystals: 10,
      talents: { vitality: 2, aether: 3, fusionMastery: 4 },
      startCard: 'fireball'
    };
    localStorage.setItem(key, JSON.stringify(old));
    return true;
  })()`);
  await send('Page.reload');
  await sleep(1500);
  const mig = await ev(`(function(){
    var m = loadMeta();
    var maxs = { hp: TALENT_BY_ID.hp.maxLevel, aether: TALENT_BY_ID.aether.maxLevel,
      fusion: TALENT_BY_ID.fusion.maxLevel };
    var ref = Math.max(0, 3 - maxs.aether) + Math.max(0, 4 - maxs.fusion);
    return { levels: { hp: m.talents.hp, aether: m.talents.aether, fusion: m.talents.fusion },
      maxs: maxs, refund: ref, migrated: m.talentsMigrated,
      info: m.talentsMigration, crystals: m.crystals, version: m.version,
      /* 第 13 项：存档 schema 升到 8（新增大区/深度字段），迁移目标版本不能再写死 7 */
      expectedVersion: META_SCHEMA_VERSION };
  })()`);
  const expectCrystals = 10 + mig.refund;
  ok('A13 旧档迁移（v6→v7）：三件旧天赋不丢失、超额按旧价返还一次',
    mig.levels.hp === Math.min(2, mig.maxs.hp) &&
    mig.levels.aether === Math.min(3, mig.maxs.aether) &&
    mig.levels.fusion === Math.min(4, mig.maxs.fusion) &&
    mig.migrated === true && mig.crystals === expectCrystals && mig.version === mig.expectedVersion,
    { levels: mig.levels, maxs: mig.maxs, crystals: mig.crystals, expect: expectCrystals,
      version: mig.version, expectedVersion: mig.expectedVersion, info: mig.info });

  // 再写一次档，确认不重复返还
  await ev('(function(){ saveMeta(); return true; })()');
  const mig2 = await ev(`(function(){
    var m = loadMeta();
    var raw = JSON.parse(localStorage.getItem(GAME_CONFIG.metaKey) || '{}');
    return { crystals: m.crystals, migrated: m.talentsMigrated,
      stateFlag: state.meta.talentsMigrated, rawFlag: raw.talentsMigrated, version: m.version };
  })()`);
  ok('A13b 迁移只发一次：二次保存不重复返还',
    mig2.crystals === expectCrystals && mig2.migrated === true, mig2);

  // ---------- A14 满配封顶后的 UI 状态 ----------
  const uiCap = await ev(`(function(){
    __talentDebug.setCrystals(9999);
    // 先把输出类全部拉满，再把 steady 降回 1 级：类别仍超上限，但它自己没满 → 应显示"已达上限"
    TALENT_CONFIG.filter(function(t){ return t.cat === 'output'; }).forEach(function(t){ __talentDebug.setLevel(t.id, t.maxLevel); });
    __talentDebug.setLevel('steady', 1);
    __talentDebug.open();
    var page = __talentDebug.page();
    var dmgCard = page.cards.filter(function(c){ return c.id === 'steady'; })[0];
    return { cls: dmgCard.cls, text: dmgCard.stateText, disabled: dmgCard.disabled,
      caps: page.caps };
  })()`);
  ok('A14 已达上限状态：卡片显示 capped 且有文字标记',
    /is-capped/.test(uiCap.cls) && /上限/.test(uiCap.text) && uiCap.disabled === true,
    uiCap);

  // ---------- A15 进阶对冲说明：选难度页的文案从配置反解 ----------
  const hedge = await ev(`(function(){
    state.meta.ascensionUnlocked = 4;
    setAscension(3);
    var txt = (document.getElementById('ascensionNote') || {}).textContent || '';
    var step = Math.round(TALENT_ASCENSION_CONFIG.stepPerLevel * 100);
    var floor = TALENT_ASCENSION_CONFIG.minMul;
    var mul = Math.round(Math.max(floor, 1 - step / 100 * 3) * 100) / 100;
    var lv1 = (function(){ setAscension(1); return (document.getElementById('ascensionNote')||{}).textContent || ''; })();
    var mul1 = Math.round(Math.max(floor, 1 - step / 100 * 1) * 100) / 100;
    return { txt: txt, step: step, floor: floor, mul: mul, lv1: lv1, mul1: mul1,
      hasStep: txt.indexOf('−' + step + '%') !== -1,
      hasFloor: txt.indexOf('×' + floor) !== -1,
      hasMul3: txt.indexOf('×' + mul) !== -1,
      hasMul1: lv1.indexOf('×' + mul1) !== -1,
      hasExempt: txt.indexOf('豁免') !== -1 };
  })()`);
  ok('A15 进阶对冲说明：每阶 −8% / 下限 ×0.68 / 解锁类豁免，文案与配置一致',
    hedge.hasStep && hedge.hasFloor && hedge.hasMul3 && hedge.hasMul1 && hedge.hasExempt,
    hedge);

  // ---------- A16 出口汇总 ----------
  const passCount = asserts.filter((a) => a.pass).length;
  console.log('RESULT: ' + (passCount === asserts.length ? 'PASS' : 'FAIL')
    + ' (' + passCount + '/' + asserts.length + ')');
  if (passCount !== asserts.length) {
    console.log(JSON.stringify(asserts.filter((a) => !a.pass), null, 2));
  }

  ws.close();
  edge.kill();
  process.exit(passCount === asserts.length ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
