/**
 * B1 · 事件扩容（5 条带代价的数值事件 + 配额守卫）
 * ------------------------------------------------------------
 * 设计口径：
 *   · 主文件事件池已有 12 条（6 条旧数值 + 6 条 D2 标签/交易），本批只补"没覆盖的交换方向"。
 *   · 全部走既有 legacy 分支（heal / aether / crystals / embers 四个字段），不新增结算路径。
 *   · ashpawn 按"结算次数"限 2 次/局（用户拍板），超限自动换一条不限额度的旧事件。
 * 约束：函数级锚点，每个替换必须命中 1 次；可整体回退（删掉插入块 + 还原 legacy 行）。
 */
'use strict';

/**
 * 单次替换；命中次数不为 1 立即抛错，避免锚点漂移后静默生成错副本
 * @param {string} src 源码
 * @param {string} from 原片段
 * @param {string} to 新片段
 * @param {string} tag 锚点标签
 * @returns {string} 替换结果
 */
function once(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次（应为 1）：${from.slice(0, 60)}`);
  return src.replace(from, to);
}

/* 5 条新事件：每条都写明代价与收益，单位写清（余烬 / 结晶 / 生命 / 奥能） */
const EVENT_ROWS = `
    /* ===== B1 内容扩容：事件池 12 → 17 =====
       只补现有 12 条没覆盖的交换方向，全部走 legacy 数值分支（零新增结算路径）：
         · ashpawn   ：通胀币（余烬）换紧缩币（结晶），按结算次数限 2 次/局
         · scavenger：反向兑换，结晶换余烬，给"钱多买不到东西"的局兜底
         · hollow    ：奥能换生命上限以外的即时血量，净收益为正但吃资源
         · ledger    ：结晶 +1 / 生命 -10，比 bloodpact（-22 换 +2）更便宜的小额版
         · frugal    ：奥能换余烬，给"这层没商店、余烬又不够"的局一个补口 */
    { id: 'ashpawn', text: '事件 · 灰烬典当：余烬 -15，结晶 +2', embers: -15, crystals: 2, maxPerRun: 2 },
    { id: 'scavenger', text: '事件 · 拾荒者：结晶 -3，余烬 +24', crystals: -3, embers: 24 },
    { id: 'hollow', text: '事件 · 空罐：奥能 -40，生命 +22', aether: -40, heal: 22 },
    { id: 'ledger', text: '事件 · 旧账：结晶 +1，生命 -10', crystals: 1, heal: -10 },
    { id: 'frugal', text: '事件 · 节食：余烬 +12，奥能 -30', embers: 12, aether: -30 }`;

/**
 * 把 B1 事件表与配额守卫应用到源码
 * @param {string} src 主文件源码
 * @returns {string} 打过补丁的源码
 */
function applyEventPatch(src) {
  let out = src;

  // 1) 事件表：插在 aetherforge 之后、数组收尾之前（注意原最后一行没有尾逗号）
  out = once(out,
    "    { id: 'aetherforge', text: '事件 · 奥能熔铸：奥能 -45，生命 +45', aether: -45, heal: 45 }\n  ]",
    "    { id: 'aetherforge', text: '事件 · 奥能熔铸：奥能 -45，生命 +45', aether: -45, heal: 45 }," + EVENT_ROWS + "\n  ]",
    'B1-event-table');

  // 2) 配额守卫：把 const legacy 改成 let，并在应用数值前判限额（按结算次数计）
  out = once(out,
    "      const legacy = (ev && !ev.effect) ? ev : u11cLegacyEvents()[randInt(0, u11cLegacyEvents().length - 1)];",
    `      let legacy = (ev && !ev.effect) ? ev : u11cLegacyEvents()[randInt(0, u11cLegacyEvents().length - 1)];
      /* B1 配额守卫：maxPerRun 按"结算次数"计（同一批结算只算一次），超限换一条不限额的旧事件 */
      if (legacy && legacy.maxPerRun) {
        if (!state.eventSettleCounts) state.eventSettleCounts = {};
        const usedTimes = state.eventSettleCounts[legacy.id] || 0;
        if (usedTimes >= legacy.maxPerRun) {
          const spare = u11cLegacyEvents().filter((x) => !x.maxPerRun
            || (state.eventSettleCounts[x.id] || 0) < x.maxPerRun);
          if (spare.length) legacy = spare[randInt(0, spare.length - 1)];
        } else {
          state.eventSettleCounts[legacy.id] = usedTimes + 1;
        }
      }`,
    'B1-event-limit');

  return out;
}

module.exports = { applyEventPatch, once };
