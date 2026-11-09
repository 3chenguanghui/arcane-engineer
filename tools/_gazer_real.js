/**
 * 真机抽样 · 单角色生存跑（默认观星）
 * ------------------------------------------------------------
 * 目的：sim 对观星只有"回能 + 奥能池"参与、`aetherFlat / 逐层成长` 刚接进去，
 *       解释力仍然有限。这个脚本用真实主文件、真实入口、**不给额外血、不每房回满、不触发保命回血**，
 *       跑一次完整生存，用真机结果去证伪 sim。
 *
 * 口径：
 *   · 角色走游戏自己的 `chooseCharacter(id)`，不手改 state 字段；
 *   · 全程不补血（setSafe(-1)），不叠 hpBonus；
 *   · 每层记录 hp / aetherMax / aether 的实际值，用来对账 sim 公式；
 *   · 死亡即停，记录死在第几层、哪间房。
 *
 * 用法：
 *   node tools/_gazer_real.js --char=gazer --floors=10
 *   node tools/_gazer_real.js --char=gazer --floors=20
 */
const fs = require('fs');
const path = require('path');
const { boot, installBot, waitUnlock } = require('./_e2e20');

const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'gazer-real');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 读命令行参数
 * @param {string} name 参数名（不带 --）
 * @param {string} def 默认值
 * @returns {string} 参数值
 */
function arg(name, def) {
  const hit = process.argv.find((a) => a.indexOf('--' + name + '=') === 0);
  return hit ? hit.split('=').slice(1).join('=') : def;
}

/**
 * 读一次真实游戏状态快照
 * @param {Function} ev 求值函数
 * @returns {Promise<Object>} 快照
 */
async function snap(ev) {
  return ev(`(() => ({
    floor: state.floor,
    mode: state.mode,
    status: state.status,
    hp: Math.round(state.player.hp),
    hpMax: Math.round(state.player.hpMax),
    aether: Math.round(state.player.aether),
    aetherMax: Math.round(state.player.aetherMax),
    characterId: state.characterId,
    rooms: state.rooms ? state.rooms.length : 0,
    enemies: state.enemies ? state.enemies.filter(function (e) { return e && e.hp > 0; }).length : 0
  }))()`);
}

/**
 * 主流程：真机跑一局，记录逐层生存与资源
 * @returns {Promise<void>}
 */
async function main() {
  const charId = arg('char', 'gazer');
  const maxFloor = Number(arg('floors', '10'));
  fs.mkdirSync(OUT, { recursive: true });

  const h = await boot('file:///' + FILE.replace(/\\/g, '/'), 1600, 900, 1);
  const report = { charId, maxFloor, floors: [], death: null, errors: [] };
  try {
    await h.ev(installBot());
    /* 真实入口：游戏自己的角色选择函数（内部会 applyMetaStats 回满 + 发本命卡 + startGame） */
    const ok = await h.ev(`(() => { try { return chooseCharacter('${charId}') ? 'started' : 'rejected'; } catch (e) { return 'ERR:' + e.message; } })()`);
    if (ok !== 'started') throw new Error('角色未能开局：' + ok);
    await sleep(1500);
    /* 关键：确认没有任何 hpBonus 放水；safeFrac 由 --safe 控制
       （-1 = 完全关闭，给"纯生存"口径；>0 = 给机器人最低保命，只为把样本拉到目标层数，生存结论不采信） */
    await h.ev(`__e2e.setSafe(${Number(arg('safe', '-1'))})`);
    const s0 = await snap(h.ev);
    console.log('开局 · ' + s0.characterId + ' · HP ' + s0.hp + '/' + s0.hpMax + ' · 奥能 ' + s0.aether + '/' + s0.aetherMax);

    for (let f = 0; f < maxFloor + 2; f += 1) {
      const info = await h.ev(`__e2e.info()`);
      if (info.mode === 'result' || info.status === 'dead' || info.status === 'won') {
        report.death = { floor: info.floor, status: info.status, mode: info.mode };
        break;
      }
      await h.ev(`__e2e.prepare()`);
      const before = await snap(h.ev);
      const ids = await h.ev(`(() => {
        var out = {};
        state.rooms.forEach(function (r) { (out[r.type] = out[r.type] || []).push(r.id); });
        return out;
      })()`);
      const order = ['start', 'battle', 'elite', 'shop', 'chest', 'event', 'survival', 'boss'];
      const queue = [];
      order.forEach((t) => { (ids[t] || []).forEach((id) => queue.push({ id, type: t })); });

      let hpMin = before.hp;
      let dmgTaken = 0;
      let dead = null;
      const segments = [];
      /* --heal=1：每房开始回满（真实 hpMax，不叠 hpBonus）。
         用途：让机器人能走完全程，同时用"单房承伤 vs hpMax"证伪
         —— 若某房承伤 ≥ hpMax，则不放水时该房必死。 */
      const healEach = arg('heal', '0') === '1';
      for (const item of queue) {
        if (healEach) await h.ev(`__e2e.topUp()`);
        await waitUnlock(h);
        const go = await h.ev(`__e2e.gotoRoom(${item.id}, 3000)`);
        await waitUnlock(h);
        let fight = { frames: 0, kills: 0, remaining: 0, dmg: 0, midHeals: 0, hpStart: 0, hpMin: 0, hpEnd: 0 };
        /* --ff：单房战斗帧上限。机器人在后期房间经常"打不动"，不设上限会单房跑满 9000 帧（≈150s 游戏时间），
           一份 10 层样本能跑半小时。设小一点只影响"能不能打完"，不影响已记录的数值对账。 */
        const ff = Number(arg('ff', '0')) || 9000;
        if (item.type !== 'start' && item.type !== 'shop') {
          fight = await h.ev(`__e2e.fight(${item.id}, ${item.type === 'boss' ? Math.max(ff, 6000) : ff})`);
        }
        if (['event', 'chest', 'survival'].indexOf(item.type) >= 0) {
          const used = await h.ev(`__e2e.interact()`);
          if (used.length) {
            await waitUnlock(h);
            const extra = await h.ev(`__e2e.fight(${item.id}, 9000)`);
            fight.frames += extra.frames;
            fight.hpEnd = extra.hpEnd;
            fight.kills += extra.kills;
            fight.remaining = extra.remaining;
            fight.dmg = (fight.dmg || 0) + (extra.dmg || 0);
          }
        }
        if (fight.hpMin) hpMin = Math.min(hpMin, fight.hpMin);
        dmgTaken += fight.dmg || 0;
        segments.push({
          room: item.id, type: item.type, dmg: Math.round(fight.dmg || 0),
          hpEnd: fight.hpEnd || 0, kills: fight.kills || 0, remaining: fight.remaining || 0
        });
        const now = await snap(h.ev);
        if (now.hp <= 0 || now.mode === 'result' || now.status === 'dead') {
          dead = { room: item.id, type: item.type, floor: now.floor };
          break;
        }
        if (fight.midHeals) dead = dead; // 保命回血已关闭，出现即说明有隐藏回血源，留给报告核对
      }

      const after = await snap(h.ev);
      report.floors.push({
        floor: before.floor,
        characterId: before.characterId,
        hpStart: before.hp, hpEnd: after.hp, hpMax: after.hpMax, hpMin,
        aetherMax: after.aetherMax, aetherEnd: after.aether,
        dmgTaken: Math.round(dmgTaken),
        rooms: segments.length,
        segments,
        cleared: !dead
      });
      console.log('F' + before.floor + ' · HP ' + before.hp + '→' + after.hp + '/' + after.hpMax
        + ' · 奥能上限 ' + after.aetherMax + ' · 承伤 ' + Math.round(dmgTaken)
        + ' · 房 ' + segments.length + ' · ' + (dead ? 'DEAD@' + dead.room : 'CLEAR'));

      if (dead) { report.death = dead; break; }
      if (before.floor >= maxFloor) break;

      const down = await h.ev(`__e2e.descend()`);
      await sleep(150);
      if (!down || down.to <= down.from) {
        report.errors.push('F' + before.floor + ' 下楼失败');
        break;
      }
    }
  } finally {
    try { h.ws.close(); } catch (e) { /* ignore */ }
    if (h.edge) { try { h.edge.kill(); } catch (e) { /* ignore */ } }
  }

  const file = path.join(OUT, 'gazer-real-' + maxFloor + '.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('\n结果写入 ' + file);
  if (report.death) console.log('死亡：F' + (report.death.floor || '-') + ' ' + (report.death.type || '') + ' ' + (report.death.room || ''));
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
