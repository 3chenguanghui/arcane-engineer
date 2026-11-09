/* 合并审查线 · 第 1 项（成就 38 条）预算实测脚本
 * ------------------------------------------------------------
 * 只读主文件，写出一份临时副本 .merge_audit/index_item1.html，
 * 用于量"合并后行数 / 字节 / 语法"，绝不修改 index_arcane_v2.html。
 * 用法：node tools/merge_audit/apply_item1.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.merge_audit');
const OUT = path.join(OUT_DIR, 'index_item1.html');

/**
 * 断言替换：找不到锚点就直接失败，避免"静默不合并"
 * @param {string} text 源文本
 * @param {string} from 锚点
 * @param {string} to 替换文本
 * @param {string} label 补丁名（报错用）
 * @param {boolean} once 是否只替换第一处
 * @returns {string} 替换后文本
 */
function replaceOnce(text, from, to, label, once) {
  const idx = text.indexOf(from);
  if (idx < 0) throw new Error('锚点缺失：' + label);
  if (!once) return text.split(from).join(to);
  return text.slice(0, idx) + to + text.slice(idx + from.length);
}

const src = fs.readFileSync(SRC, 'utf8');

/* ---- 补丁 1：16 条新成就并入 META_PROGRESS_CONFIG.achievements ---- */
const ACH_ANCHOR = "    { id: 'deaths_5', name: '屡败屡战', desc: '累计死亡 5 次', metric: 'deaths', target: 5, reward: { aether: 1 } }\n  ]";
const ACH_NEW = "    { id: 'deaths_5', name: '屡败屡战', desc: '累计死亡 5 次', metric: 'deaths', target: 5, reward: { aether: 1 } },\n" +
  "    /* ---- v1.5.6 合并审查线 · 扩展 16 条（来源 achievements.json，reward 统一留空） ---- */\n" +
  "    { id: 'kills_1000', name: '千机散架', desc: '累计击杀 1000 只构装', metric: 'kills', target: 1000, reward: {} },\n" +
  "    { id: 'elite_200', name: '精英坟场', desc: '累计击杀 200 只精英', metric: 'eliteKills', target: 200, reward: {} },\n" +
  "    { id: 'boss_20', name: '首领名录', desc: '累计击败 20 名首领', metric: 'bossKills', target: 20, reward: {} },\n" +
  "    { id: 'combo_50', name: '连锁成瘾', desc: '单次连击峰值达到 50', metric: 'comboPeak', target: 50, reward: {} },\n" +
  "    { id: 'floor_12', name: '塔心回响', desc: '最高到达第 12 层', metric: 'bestFloor', target: 12, reward: {} },\n" +
  "    { id: 'floor_20', name: '深井尽头', desc: '最高到达第 20 层', metric: 'bestFloor', target: 20, reward: {} },\n" +
  "    { id: 'daily_clear', name: '今日签收', desc: '通关任意一次每日挑战', metric: 'dailyCleared', target: 1, reward: {} },\n" +
  "    { id: 'codex_enemies_all', name: '名录补全', desc: '图鉴敌人条目全部解锁', metric: 'codexEnemies', target: 33, reward: {} },\n" +
  "    { id: 'relics_10', name: '拾荒成性', desc: '图鉴遗物解锁 10 件', metric: 'codexRelics', target: 10, reward: {} },\n" +
  "    { id: 'cards_all', name: '卡池见底', desc: '图鉴卡牌条目全部解锁', metric: 'codexCards', target: 20, reward: {} },\n" +
  "    { id: 'talents_30', name: '天赋满墙', desc: '累计投入 30 级天赋', metric: 'talentLevels', target: 30, reward: {} },\n" +
  "    { id: 'single_school_3', name: '一路到底', desc: '同一流派通关 3 次', metric: 'singleSchoolClears', target: 3, reward: {} },\n" +
  "    { id: 'wager_3', name: '三押三中', desc: '赌注房累计获胜 3 次', metric: 'wagerWins', target: 3, reward: {} },\n" +
  "    { id: 'sacrifice_5', name: '血本无归', desc: '献祭房累计献祭 5 次', metric: 'sacrifices', target: 5, reward: {} },\n" +
  "    { id: 'barrel_20', name: '桶边常客', desc: '累计用爆桶击杀 20 只敌人', metric: 'barrelKills', target: 20, reward: {} },\n" +
  "    { id: 'challenge_10', name: '无阶可退', desc: '以挑战等级 10 通关一次', metric: 'challenge10Clears', target: 1, reward: {} }\n  ]";
let text = replaceOnce(src, ACH_ANCHOR, ACH_NEW, '成就数组末尾', true);

/* ---- 补丁 2：metaMetricValue 补 9 条读取口径 ---- */
const METRIC_ANCHOR = "    case 'runRecipes': return Math.max(0, Math.floor(Number(m.bestRunRecipes) || 0));\n    default: return 0;";
const METRIC_NEW = "    case 'runRecipes': return Math.max(0, Math.floor(Number(m.bestRunRecipes) || 0));\n" +
  "    /* v1.5.6 合并审查线 · 扩展 9 条口径：字段都已存在，这里只补读取分支 */\n" +
  "    case 'dailyCleared': {\n" +
  "      const runs = m.seedRuns && typeof m.seedRuns === 'object' ? m.seedRuns : {};\n" +
  "      return Object.keys(runs).some((k) => runs[k] && runs[k].daily === true && runs[k].cleared === true) ? 1 : 0;\n" +
  "    }\n" +
  "    case 'codexEnemies': return m.codex && Array.isArray(m.codex.enemies) ? m.codex.enemies.length : 0;\n" +
  "    case 'codexRelics': return m.codex && Array.isArray(m.codex.relics) ? m.codex.relics.length : 0;\n" +
  "    case 'codexCards': return m.codex && Array.isArray(m.codex.cards) ? m.codex.cards.length : 0;\n" +
  "    case 'talentLevels': {\n" +
  "      const talents = m.talents && typeof m.talents === 'object' ? m.talents : {};\n" +
  "      return Object.keys(talents).reduce((sum, k) => sum + Math.max(0, Math.floor(Number(talents[k]) || 0)), 0);\n" +
  "    }\n" +
  "    case 'wagerWins': return Math.max(0, Math.floor(Number(m.eventStats && m.eventStats.wagerWins) || 0));\n" +
  "    case 'sacrifices': return Math.max(0, Math.floor(Number(m.eventStats && m.eventStats.sacrifice) || 0));\n" +
  "    case 'barrelKills': return Math.max(0, Math.floor(Number(m.stats && m.stats.barrelKills) || 0));\n" +
  "    case 'challenge10Clears': return Math.max(0, Math.floor(Number(m.challengeCleared && m.challengeCleared['10']) || 0));\n" +
  "    default: return 0;";
text = replaceOnce(text, METRIC_ANCHOR, METRIC_NEW, 'metaMetricValue 末尾', true);

/* ---- 补丁 3：defaultMeta().stats 补 barrelKills ---- */
text = replaceOnce(text,
  "      hiddenRooms: 0, voidRifts: 0, singleSchoolClears: 0\n    },",
  "      hiddenRooms: 0, voidRifts: 0, singleSchoolClears: 0,\n      barrelKills: 0\n    },",
  'defaultMeta.stats', true);

/* ---- 补丁 4：normalizeMeta().stats 补 barrelKills ---- */
text = replaceOnce(text,
  "    singleSchoolClears: Math.max(0, Math.floor(Number(rawStats.singleSchoolClears) || 0))\n  };",
  "    singleSchoolClears: Math.max(0, Math.floor(Number(rawStats.singleSchoolClears) || 0)),\n    barrelKills: Math.max(0, Math.floor(Number(rawStats.barrelKills) || 0))\n  };",
  'normalizeMeta.stats', true);

/* ---- 补丁 5：terrainBump 里爆桶计入 barrelKills ---- */
text = replaceOnce(text,
  "  state.terrainKills[kind] = (state.terrainKills[kind] || 0) + 1;\n}",
  "  state.terrainKills[kind] = (state.terrainKills[kind] || 0) + 1;\n  // 成就口径：爆桶击杀单独计数（metaBumpStat 内部已做存档/开关保护）\n  if (kind === 'barrel') metaBumpStat('barrelKills', 1);\n}",
  'terrainBump', true);

/* ---- 补丁 6：奖励提示按"实际到手"报数（超上限 12 不再谎报 +N） ---- */
text = replaceOnce(text,
  "    const reward = item.reward || {};\n    meta.rewards = meta.rewards && typeof meta.rewards === 'object' ? meta.rewards : { aether: 0, cards: 0 };",
  "    const reward = item.reward || {};\n    meta.rewards = meta.rewards && typeof meta.rewards === 'object' ? meta.rewards : { aether: 0, cards: 0 };\n    const aetherBefore = Math.max(0, Math.floor(Number(meta.rewards.aether) || 0));",
  'checkMetaAchievements 奖励前', true);

text = replaceOnce(text,
  "    unlocked.push(item);",
  "    /* 实际到手 = 夹上限后的增量；announceAchievement 用它报数，避免超上限后仍显示 +N */\n    item.grantedAether = Math.max(0, (Math.floor(Number(meta.rewards.aether) || 0)) - aetherBefore);\n    unlocked.push(item);",
  'checkMetaAchievements 入列', true);

text = replaceOnce(text,
  "  const rewardText = reward.cards ? '开局多一张卡' : ('初始奥能 +' + (reward.aether || 0));",
  "  const grantedAether = Math.max(0, Math.floor(Number(item.grantedAether) || 0));\n  const rewardText = reward.cards ? '开局多一张卡'\n    : (grantedAether > 0 ? '初始奥能 +' + grantedAether : '已记入档案');",
  'announceAchievement 文案', true);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, text, 'utf8');

const oldLines = src.split('\n').length;
const newLines = text.split('\n').length;
const oldBytes = Buffer.byteLength(src, 'utf8');
const newBytes = Buffer.byteLength(text, 'utf8');
console.log('merged -> ' + OUT);
console.log('lines ' + oldLines + ' -> ' + newLines + ' (+' + (newLines - oldLines) + ')');
console.log('bytes ' + oldBytes + ' -> ' + newBytes + ' (+' + (newBytes - oldBytes) + ')');
