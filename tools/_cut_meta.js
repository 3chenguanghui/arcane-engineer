/**
 * C0 只测量 · 卡牌 / 天赋 / 融合使用率探针（一次性，用完可删）
 * ------------------------------------------------------------
 * 目的：给"该删什么"提供数据，不代表真实玩家，口径写在报告里。
 *   1) 卡牌：8 局 × 24 次升级三选一，记录每张卡的"出现次数 / 被选次数"。
 *      选卡策略：75% 选当前打分最高的（优先高 DPS 魔法），25% 随机（模拟随手点）。
 *   2) 天赋：每局结算发 12 结晶（GAME_CONFIG.crystalsPerRunAvg），按"最便宜且合法"贪心购买，
 *      跨局累计每个天赋被买了几次。天赋是永久进度，所以 8 局共用同一份 meta。
 *   3) 融合：每次选完卡后按一次 F（tryFuse），记录本局合出的配方。
 *      武器标签配方（weaponTag）在武器关闭时永远不可合，单独标注。
 *
 * 用法：node tools\_cut_meta.js
 * 端口：9592
 * 环境变量：CUT_RUNS=8（局数）、CUT_ROLLS=24（每局升级次数）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9592;
const RUNS = Number(process.env.CUT_RUNS || 8);
const ROLLS = Number(process.env.CUT_ROLLS || 24);
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'cut');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 Edge 并连接 CDP
 * @param {string} url 地址
 * @returns {Promise<Object>} CDP 句柄
 */
async function boot(url) {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--window-size=1280,800', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待 */ }
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
  /**
   * 发送 CDP 命令
   * @param {string} method 方法
   * @param {Object} [params] 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 页面内执行表达式
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description
        || r.exceptionDetails.text));
    }
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(2600);
  return { ws, send, ev, edge };
}

/**
 * 点击标题页开始按钮
 * @param {Object} h CDP 句柄
 * @returns {Promise<void>}
 */
async function clickStart(h) {
  const btn = await h.ev(`(() => { const b = document.getElementById('btnStart'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await h.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await sleep(900);
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const h = await boot('file:///' + FILE.replace(/\\/g, '/'));
  try {
    const meta = { magic: {}, tech: {}, fusion: {}, talent: {} };
    const cardStats = {};     // key -> { key,kind,id,name,rarity,appear,pick }
    const talentStats = {};   // id -> { runsBought, levels, purchases }
    const fusionStats = {};   // id -> { fusedTimes, runsFused }
    const synthetic = {};     // 保底标签融合（不在 18 条里）
    let perRun = [];

    for (let run = 1; run <= RUNS; run += 1) {
      if (run > 1) {
        await h.send('Page.reload', { ignoreCache: false });
        await sleep(2600);
      }
      await clickStart(h);
      /* 初始化：解锁融合/装置（真人清掉第一间战斗房即解锁融合），并把本局卡池元数据拉出来 */
      const info = await h.ev(`(() => {
        try {
          state.meta.unlocks = state.meta.unlocks || {};
          state.meta.unlocks.fusion = true;
          state.meta.unlocks.device = true;
          state.meta.unlocks.overdrive = true;
        } catch (e) {}
        return {
          magic: MAGIC_CONFIG.map((m) => ({ id: m.id, name: m.name, damage: m.damage, cooldown: m.cooldown, rarity: m.rarity })),
          tech: TECH_CONFIG.map((t) => ({ id: t.id, name: t.name, rarity: t.rarity })),
          fusion: FUSION_CONFIG.map((f) => ({ id: f.id, name: f.name, magic: f.magic, tech: f.tech, weaponTag: f.weaponTag || null })),
          talents: TALENT_CONFIG.map((t) => ({ id: t.id, name: t.name, cat: t.cat, maxLevel: t.maxLevel })),
          crystals: state.meta.crystals || 0
        };
      })()`);
      meta.magic = Object.fromEntries(info.magic.map((m) => [m.id, m]));
      meta.tech = Object.fromEntries(info.tech.map((t) => [t.id, t]));
      meta.fusion = Object.fromEntries(info.fusion.map((f) => [f.id, f]));
      meta.talent = Object.fromEntries(info.talents.map((t) => [t.id, t]));
      info.fusion.forEach((f) => { fusionStats[f.id] = fusionStats[f.id] || { fusedTimes: 0, runsFused: 0 }; });
      info.talents.forEach((t) => { talentStats[t.id] = talentStats[t.id] || { runsBought: 0, levels: 0, purchases: 0 }; });

      let fusedThisRun = new Set();
      let pickedThisRun = 0;

      /* ---- 每局 24 次三选一 ---- */
      for (let roll = 1; roll <= ROLLS; roll += 1) {
        const stage = await h.ev(`(() => {
          if (state.mode !== 'playing') { try { closeRewardFlow(true); } catch (e) {} }
          showRewardStage('skill');
          return (state.upgradeOptions || []).map((o) => ({
            key: o.key, kind: o.kind, id: o.id, name: o.name, rarity: o.rarity
          }));
        })()`);
        if (!stage || !stage.length) break;

        /* 记"出现" */
        stage.forEach((o) => {
          if (!cardStats[o.key]) cardStats[o.key] = { key: o.key, kind: o.kind, id: o.id, name: o.name, rarity: o.rarity, appear: 0, pick: 0 };
          cardStats[o.key].appear += 1;
        });

        /* 选卡：75% 按打分挑最好的，25% 随机（模拟随手点） */
        const rollPick = Math.random();
        let chosen = stage[0];
        if (rollPick < 0.75) {
          let best = -1e9;
          stage.forEach((o) => {
            let s = 0;
            if (o.kind === 'magic') {
              const m = meta.magic[o.id];
              s = 100 + (m && m.damage ? m.damage / Math.max(0.3, m.cooldown || 1) : 0) + ({ common: 1, rare: 2, epic: 3 }[o.rarity] || 0) * 5;
            } else if (o.kind === 'fusion') s = 60;
            else if (o.kind === 'tech') s = 50;
            else if (o.kind === 'pact') s = 40;
            else s = 10;
            if (s > best) { best = s; chosen = o; }
          });
        } else {
          chosen = stage[Math.floor(Math.random() * stage.length)];
        }
        cardStats[chosen.key].pick += 1;
        pickedThisRun += 1;
        await h.ev(`chooseReward(${JSON.stringify(chosen.key)})`);
        /* 被动段直接跳过（本探针只统计技能池） */
        await h.ev(`(() => { if (state.mode === 'reward') closeRewardFlow(true); return state.mode; })()`);

        /* ---- 融合：每次选完卡按一次 F ---- */
        const fz = await h.ev(`(() => {
          if (state.mode !== 'playing') { try { closeRewardFlow(true); } catch (e) {} }
          const before = state.fusions.slice();
          let ok = false;
          try { ok = tryFuse(); } catch (e) { return { error: String(e) }; }
          return { ok: ok, added: state.fusions.filter((id) => before.indexOf(id) < 0) };
        })()`);
        if (fz && fz.added) {
          fz.added.forEach((id) => {
            if (fusionStats[id]) { fusionStats[id].fusedTimes += 1; fusedThisRun.add(id); }
            else synthetic[id] = (synthetic[id] || 0) + 1;
          });
        }
      }
      fusedThisRun.forEach((id) => { fusionStats[id].runsFused += 1; });

      /* ---- 本局结算：发 12 结晶，贪心买天赋 ---- */
      const tal = await h.ev(`(() => {
        state.meta.crystals = Math.max(0, Number(state.meta.crystals) || 0) + 12;
        try { saveMeta(); } catch (e) {}
        const bought = [];
        const skip = {};
        for (let guard = 0; guard < 60; guard += 1) {
          let pick = null;
          TALENT_CONFIG.forEach((t) => {
            if (skip[t.id]) return;
            if (talentLevelOf(t.id) >= t.maxLevel) { skip[t.id] = 1; return; }
            if (talentExclusiveConflict(t.id)) { skip[t.id] = 1; return; }
            if (!talentPrereqMet(t)) return;
            const cost = talentCostOf(t);
            if (state.meta.crystals < cost) return;
            if (!pick || cost < pick.cost) pick = { id: t.id, cost: cost };
          });
          if (!pick) break;
          if (!buyTalent(pick.id)) { skip[pick.id] = 1; continue; }
          bought.push(pick.id);
        }
        return { bought: bought, left: state.meta.crystals, levels: Object.assign({}, state.meta.talents) };
      })()`);
      const boughtSet = new Set(tal.bought);
      tal.bought.forEach((id) => {
        if (!talentStats[id]) talentStats[id] = { runsBought: 0, levels: 0, purchases: 0 };
        talentStats[id].purchases += 1;
      });
      Object.keys(talentStats).forEach((id) => {
        if (boughtSet.has(id)) talentStats[id].runsBought += 1;
        talentStats[id].levels = (tal.levels && tal.levels[id]) || 0;
      });

      perRun.push({
        run: run, rolls: pickedThisRun,
        cardsOwned: await h.ev(`(() => state.ownedMagic.length + state.ownedTech.length)()`),
        fusions: Array.from(fusedThisRun),
        talentBought: tal.bought, crystalsLeft: tal.left
      });
      console.log('RUN ' + run + ' · 选卡 ' + pickedThisRun + ' · 融合 ' + Array.from(fusedThisRun).join(',')
        + ' · 天赋 ' + tal.bought.length + ' 项');
    }

    /* ---- 汇总 ---- */
    const cards = Object.values(cardStats).sort((a, b) => (a.pick / Math.max(1, a.appear)) - (b.pick / Math.max(1, b.appear)));
    const talents = Object.keys(talentStats).map((id) => ({
      id: id, name: (meta.talent[id] && meta.talent[id].name) || id,
      cat: (meta.talent[id] && meta.talent[id].cat) || '',
      maxLevel: (meta.talent[id] && meta.talent[id].maxLevel) || 0,
      runsBought: talentStats[id].runsBought, purchases: talentStats[id].purchases,
      levels: talentStats[id].levels
    })).sort((a, b) => a.purchases - b.purchases);
    const fusions = Object.keys(meta.fusion).map((id) => ({
      id: id, name: meta.fusion[id].name, magic: meta.fusion[id].magic,
      tech: meta.fusion[id].tech, weaponTag: meta.fusion[id].weaponTag,
      fusedTimes: fusionStats[id].fusedTimes, runsFused: fusionStats[id].runsFused
    })).sort((a, b) => a.fusedTimes - b.fusedTimes);

    const summary = {
      at: new Date().toISOString(),
      runs: RUNS, rollsPerRun: ROLLS,
      policy: '75% 选高 DPS 魔法 / 25% 随机；每局 12 结晶贪心买最便宜且合法的天赋；每次选卡后按一次 F',
      cards: cards.map((c) => ({
        key: c.key, kind: c.kind, name: c.name, rarity: c.rarity,
        appear: c.appear, pick: c.pick,
        rate: Number((c.pick / Math.max(1, c.appear)).toFixed(3))
      })),
      talents, fusions,
      syntheticFusions: synthetic,
      perRun
    };
    fs.writeFileSync(path.join(OUT, 'meta-result.json'), JSON.stringify(summary, null, 2));

    console.log('\n===== 卡牌选择率（低→高）=====');
    summary.cards.forEach((c) => console.log('  ' + c.key.padEnd(22) + ' 出现 ' + String(c.appear).padStart(3)
      + '  被选 ' + String(c.pick).padStart(3) + '  ' + (c.rate * 100).toFixed(1) + '%'));
    console.log('\n===== 天赋购买（少→多）=====');
    talents.forEach((t) => console.log('  ' + t.id.padEnd(18) + ' 局数 ' + t.runsBought + '/' + RUNS
      + '  次数 ' + t.purchases + '  等级 ' + t.levels));
    console.log('\n===== 融合合出（少→多）=====');
    fusions.forEach((f) => console.log('  ' + f.id.padEnd(16) + ' 合出 ' + f.fusedTimes + ' 次'
      + (f.weaponTag ? '  [武器标签:' + f.weaponTag + ']' : '')));
    console.log('  保底标签融合（不在 18 条内）：' + JSON.stringify(synthetic));
  } finally {
    h.ws.close();
    killEdge(h.edge);
  }
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
