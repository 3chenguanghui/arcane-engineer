/* ============================================================================
 * 技能池扩容数值门（只读叠加层，不修改 sim.js / config.js / 主文件）
 * ----------------------------------------------------------------------------
 * 目的：在既有的 F10/F11 模拟器上，把"待评估的 6 张新基础技能"临时注入
 *       `C.MAGIC` 数组（内存级 push，进程结束即消失），再用同一个 seed / 局数
 *       跑一遍 `probe_f1011.js`，从而回答两条红线：
 *         ① 前 3 层通关率有没有跳；
 *         ② 全曲线凹点数量有没有变多。
 *
 * 三条必须知道的口径（结论里要照抄，不能当成真机数据）：
 *   1. 这是**上界口径**：新卡从第 1 层就进池，而实际补丁用 `minFloor` 把它们
 *      压到 F3–F6 才出现。闸门只会让早期更弱，所以"上界都不跳 = 实际更不会跳"。
 *   2. sim 只建模 `damage / cost / cooldown / aoe` 四个字段，**不建模**击退、
 *      护盾、持续时间、延迟落点。所以 AoE 的形状优势被低估（sim 统一按
 *      aoeBonus=0.42 折算群体），结论只能用来判"是否越红线"，不能用来判强度手感。
 *   3. 三选一权重稀释（+6 张卡会让每张好卡出现概率下降）sim 不建模，另行论证。
 *
 * 用法：
 *   node tools/sim_panel/probe_skillpool.js --runs 10000 --profile bot
 *   node tools/sim_panel/probe_skillpool.js --runs 300            # 冒烟
 *
 * 产物：
 *   tools/sim_panel/probe_skillpool_<profile>.json
 *   tools/sim_panel/probe_f1011_<profile>_base.json   （自动留一份基线对照）
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

/* 待注入的卡表：字段与 config.js 的 MAGIC 完全同构，sim.js 只读这四个数。
   damage 口径 = "单体面板伤害"（与主文件 MAGIC_CONFIG.damage 一致），
   群体收益由 sim 的 aoe 标记统一折算，保证与旧卡同一把尺。

   v3 修正（关键）：sim 的选卡指标是 `damage / cost`（不含冷却），而结算用的是
   `damage / cooldown`。两张口径不一致，导致"高单发、长冷却"的爆发卡会被误选进主槽，
   再以 13 dps 实际出手，把 10 层通关率砸掉 5.8pp（见 _pool5.log 的实测）。
   所以新卡统一压到 `damage/cost ≤ 1.6`（= 火球效率），让模型不去选它们，
   爆发卡的真实强度交给"覆盖面积/清怪比例"的解析口径来量化，而不是靠模型误选。
   `ward` 在 sim 里没有护盾字段（只有 heal），用它测出的 50.1% 是模型伪影，不参与数值门。 */
const NEW_CARDS = [
  // ---- 3 条范围（AoE）----
  { id: 'pulseShock',  name: '斥力脉冲',   cost: 30, cooldown: 3.40, damage: 26, aoe: true,  tag: '范围' },
  { id: 'pierceLance', name: '贯流长枪',   cost: 30, cooldown: 3.60, damage: 38, aoe: true,  tag: '贯穿' },
  { id: 'skyfall',     name: '天陨',       cost: 50, cooldown: 6.00, damage: 78, aoe: true,  tag: '范围' },
  // ---- 3 条非范围（单体 / 功能）----
  { id: 'hammer',      name: '符文重锤',   cost: 34, cooldown: 3.00, damage: 52, aoe: false, tag: '重击' },
  { id: 'brand',       name: '灼痕烙印',   cost: 23, cooldown: 1.40, damage: 36, aoe: false, tag: '灼烧' },
  { id: 'ward',        name: '护身符阵',   cost: 24, cooldown: 5.00, damage: 0,  heal: 12, aoe: false, tag: '守护' }
];

/**
 * 解析命令行参数（与 probe_f1011 同形，直接把同一份 argv 透传下去）
 * @returns {Object} { runs, profile, seed }
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { runs: 10000, profile: 'bot', seed: null, only: null };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Math.max(100, parseInt(a[++i], 10));
    else if (a[i] === '--profile') o.profile = a[++i];
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
    else if (a[i].indexOf('--only=') === 0) o.only = a[i].slice(7).split(',').filter(Boolean);
  }
  return o;
}

/**
 * 往内存里的 MAGIC 表追加新卡（幂等：重复调用不会重复追加）
 * @param {Object} C config 模块（其 MAGIC 数组与 sim.js 共享同一引用）
 * @param {Object[]} cards 待注入的卡
 * @returns {number} 本次实际追加的数量
 */
function injectCards(C, cards) {
  if (!Array.isArray(C.MAGIC)) throw new Error('config.MAGIC 不是数组，注入失败');
  let added = 0;
  cards.forEach((card) => {
    if (C.MAGIC.some((m) => m.id === card.id)) return;
    C.MAGIC.push(card);
    added += 1;
  });
  return added;
}

/**
 * 备份 probe_f1011 的产物文件（只在第一次运行时备份，避免覆盖真正的基线）
 * @param {string} file 基线产物路径
 * @returns {void}
 */
function backupBaseline(file) {
  const baseFile = file.replace(/\.json$/, '_base.json');
  if (fs.existsSync(baseFile)) return;
  if (!fs.existsSync(file)) return;
  fs.copyFileSync(file, baseFile);
}

/**
 * 主流程：备份基线 → 注入新卡 → 复用 probe_f1011 全流程 → 把产物改名成本轮名字
 * @returns {void}
 */
function main() {
  const o = parseArgs();
  const tag = o.only ? '_only_' + o.only.join('-') : '';
  const probeJson = path.join(__dirname, 'probe_f1011_' + o.profile + '.json');
  const outJson = path.join(__dirname, 'probe_skillpool_' + o.profile + tag + '.json');

  backupBaseline(probeJson);

  const cards = o.only ? NEW_CARDS.filter((c) => o.only.indexOf(c.id) >= 0) : NEW_CARDS;
  const C = require('./config');
  const added = injectCards(C, cards);
  console.log('[skillpool] 注入新卡 ' + added + ' 张（' + cards.map((c) => c.id).join(',')
    + '），MAGIC 现有 ' + C.MAGIC.length + ' 张');

  // 透传 argv：probe_f1011 在 require 时就会跑完 main() 并落盘
  require('./probe_f1011');

  if (fs.existsSync(probeJson)) {
    fs.renameSync(probeJson, outJson);
    // 把基线还回去，保证后续别的探针看到的是原口径文件
    const baseFile = probeJson.replace(/\.json$/, '_base.json');
    if (fs.existsSync(baseFile)) fs.copyFileSync(baseFile, probeJson);
  }
  console.log('[skillpool] 产物: ' + outJson);
}

main();
