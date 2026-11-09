/* 合并审查线 · 补丁 D（文案 + 共享函数 + 面板调用）临时验收
 * 只读主文件与 ach-panel.js，写 .merge_audit 副本；不改任何交付文件。
 * 用法：node tools/merge_audit/apply_itemD.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const PANEL = path.join(ROOT, 'ach-panel.js');
const OUT_DIR = path.join(ROOT, '.merge_audit');
const OUT_HTML = path.join(OUT_DIR, 'index_itemD.html');
const OUT_PANEL = path.join(OUT_DIR, 'ach-panel_patched.js');

/**
 * 断言替换，锚点缺失直接失败，避免静默不合并
 * @param {string} text 源文本
 * @param {string} from 锚点
 * @param {string} to 替换文本
 * @param {string} label 补丁名
 * @returns {string} 替换后文本
 */
function replaceOnce(text, from, to, label) {
  const i = text.indexOf(from);
  if (i < 0) throw new Error('锚点缺失：' + label);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

/* ---------------- 主文件：D-2 ---------------- */
let html = fs.readFileSync(SRC, 'utf8');

const SHARED = `/**
 * 成就奖励文案（主文件与面板共用，纯函数，不读取任何闭包状态）
 * @param {string} id 成就 id
 * @param {number} granted 本次实际到账的奥能；未达成或未结算传 null
 * @param {number} [cap] 奥能叠加上限；缺省读 META_PROGRESS_CONFIG.maxAetherReward
 * @returns {string} 有卡给卡，有实得给数字，其余统一「已记入档案」
 */
function achRewardText(id, granted, cap) {
  const item = META_PROGRESS_CONFIG.byId[id];
  const reward = (item && item.reward) || {};
  if (reward.cards) return '开局多一张卡';
  if (!reward.aether) return '已记入档案';
  const limit = Number.isFinite(cap) ? cap : META_PROGRESS_CONFIG.maxAetherReward;
  const actual = Math.max(0, Math.min(Math.floor(Number(granted) || 0), limit));
  return actual > 0 ? '初始奥能 +' + actual : '已记入档案';
}
window.achRewardText = achRewardText;   // 面板是独立 IIFE，必须挂 window 才能单独调用

`;

html = replaceOnce(
  html,
  '/**\n * 第 5 轮 · 成就：轻量提示（一句 toast + 一圈金环，不抢战斗视野）',
  SHARED + '/**\n * 第 5 轮 · 成就：轻量提示（一句 toast + 一圈金环，不抢战斗视野）',
  '共享函数插入点'
);

const OLD_BODY = `  const reward = item.reward || {};
  /* C1-12：提示按"实际到账差额"显示。旧写法直接读 reward.aether，
     一旦累加被 maxAetherReward 夹住就会显示"初始奥能 +0"；
     现在由调用方传入实际差额，到账 0 时显示"初始奥能已满"或"无奖励"。 */
  let rewardText;
  if (reward.cards) {
    rewardText = '开局多一张卡';
  } else if (reward.aether) {
    rewardText = aetherGained > 0 ? ('初始奥能 +' + aetherGained) : '初始奥能已满';
  } else {
    rewardText = '无奖励';
  }`;
const NEW_BODY = `  /* 与面板同一口径：实得 > 0 报数字，夹成 0 或无奖励统一「已记入档案」 */
  const rewardText = achRewardText(item.id, aetherGained, META_PROGRESS_CONFIG.maxAetherReward);`;
html = replaceOnce(html, OLD_BODY, NEW_BODY, 'announceAchievement 文案块');

/* ---------------- 面板：rewardText 整函数替换 ---------------- */
let panel = fs.readFileSync(PANEL, 'utf8');
const OLD_PANEL_FN = `  function rewardText(item, row) {
    var r = item.reward || {};
    if (r.cards) {
      var cards = row ? (row.done ? row.cardGain : row.cardProjected) : nominalCardsOf(item);
      if (cards == null) cards = nominalCardsOf(item);
      return cards > 0 ? '起手卡 +' + cards : '起手卡已满';
    }
    if (r.aether) {
      var gain = row ? (row.done ? row.aetherGain : row.aetherProjected) : nominalAetherOf(item);
      if (gain == null) gain = nominalAetherOf(item);
      if (gain <= 0) return '奥能已满 · 实得 0';
      var nominal = nominalAetherOf(item);
      return '奥能 +' + gain + (gain < nominal ? '（上限内）' : '');
    }
    return '';
  }`;
const NEW_PANEL_FN = `  function rewardText(item, row) {
    var gain = null;
    if (item.reward && item.reward.aether) {
      gain = row ? (row.done ? row.aetherGain : row.aetherProjected) : null;
    }
    /* 游戏内必须走主文件共享函数；预览页没有主文件时才走下面的同规则兜底 */
    if (typeof window.achRewardText === 'function') {
      return window.achRewardText(item.id, gain, MAX_AETHER_REWARD);
    }
    if (item.reward && item.reward.cards) return '开局多一张卡';
    if (item.reward && item.reward.aether) {
      return gain > 0 ? ('初始奥能 +' + gain) : '已记入档案';
    }
    return '已记入档案';
  }`;
panel = replaceOnce(panel, OLD_PANEL_FN, NEW_PANEL_FN, '面板 rewardText');
panel = replaceOnce(panel,
  '   * 奖励文案：只显示实际到手值；被上限夹住的显示「已满」，不报名义 +N。\n' +
  '   * @param {Object} item 成就配置\n' +
  '   * @param {Object} row 行数据（含 settleRewards 写入的 gain / projected）\n' +
  '   * @returns {string} 例如「奥能 +2」「起手卡 +1」「奥能已满 · 实得 0」；无奖励返回空串',
  '   * 奖励文案：只显示实际到手值；被上限夹住或无奖励统一显示「已记入档案」。\n' +
  '   * @param {Object} item 成就配置\n' +
  '   * @param {Object} row 行数据（含 settleRewards 写入的 gain / projected）\n' +
  '   * @returns {string} 例如「初始奥能 +2」「开局多一张卡」「已记入档案」',
  '面板 rewardText JSDoc');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_HTML, html, 'utf8');
fs.writeFileSync(OUT_PANEL, panel, 'utf8');

const a = fs.readFileSync(SRC, 'utf8');
console.log('主文件 lines ' + a.split('\n').length + ' -> ' + html.split('\n').length
  + ' (+' + (html.split('\n').length - a.split('\n').length) + ')');
console.log('主文件 bytes ' + Buffer.byteLength(a, 'utf8') + ' -> ' + Buffer.byteLength(html, 'utf8')
  + ' (+' + (Buffer.byteLength(html, 'utf8') - Buffer.byteLength(a, 'utf8')) + ')');
console.log('面板 lines ' + panel.split('\n').length + ' · bytes ' + Buffer.byteLength(panel, 'utf8'));
