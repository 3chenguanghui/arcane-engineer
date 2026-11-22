'use strict';

/**
 * 焚稿配置漂移检查：主文件 `ASH_CONFIG` vs 模拟器 `ASH`。
 * ----------------------------------------------------------------------------
 * 为什么需要它：
 *   2026-11-09 发现 sim.ASH 少了 hpCostPct，而 ashTakenMul 读不到就当 0，
 *   整批模拟静默按"零代价"跑。这类问题不报错、数字也正常，只能靠对账拦住。
 * 规则：
 *   · 主文件有的字段，sim 必须有（`IGNORED` 里的纯表现层字段除外）
 *   · 值必须完全相同（`DEFAULT_DIFF_OK` 里允许不同，例如 enabled 的默认值）
 *   · 任何一处不满足 → 非零退出码 / 抛错，跑分脚本启动即中止
 * 用法：
 *   node tools/_ash_drift_check.js          # 人工检查，FAIL 时退出码 1
 *   require('./_ash_drift_check').assertAshDrift();   # 跑分入口调用
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const HTML_FILE = path.join(ROOT, 'index_arcane_v2.html');
const SIM_FILE = path.join(__dirname, 'sim_panel', 'sim.js');

/* 主文件有、模拟器故意不建模的字段（纯表现层，不参与数值） */
const IGNORED = {
  blastRadius: '灰爆半径（像素），纯表现层，模拟器不建模'
};

/* 同源但默认值故意不同：sim 默认关焚稿，避免全部基线被污染 */
const DEFAULT_DIFF_OK = {
  enabled: 'sim 默认 false（不传 ov.ash 即无焚稿）；主文件线上 true'
};

/**
 * 算文件 MD5（大写）。
 * @param {string} file 绝对路径
 * @returns {string} 32 位大写十六进制
 */
function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 从源码里抠出 `var NAME = { ... };` 的对象字面量并求值。
 * 只支持纯字面量（数字/布尔/字符串），遇到引用其他变量会明确报错，不静默跳过。
 * @param {string} src 源码
 * @param {string} name 变量名（ASH_CONFIG / ASH）
 * @param {string} label 报错用的文件说明
 * @returns {object} 解析出的对象
 */
function readObjLiteral(src, name, label) {
  const re = new RegExp('(?:var|const)\\s+' + name + '\\s*=\\s*\\{');
  const m = re.exec(src);
  if (!m) throw new Error('找不到 ' + name + '（' + label + '）');
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (!depth) break;
    }
  }
  if (depth) throw new Error(name + ' 的对象括号不闭合（' + label + '）');
  const body = src.slice(start, i);
  try {
    return new Function('return ({' + body + '});')();
  } catch (e) {
    throw new Error(name + ' 含非字面量，无法静态求值（' + label + '）：' + e.message);
  }
}

/**
 * 执行一次对账。
 * @returns {{rows: Array, bad: number, checked: number, mainMd5: string, simMd5: string}}
 */
function checkAshDrift() {
  const main = readObjLiteral(fs.readFileSync(HTML_FILE, 'utf8'), 'ASH_CONFIG', 'index_arcane_v2.html');
  const sim = readObjLiteral(fs.readFileSync(SIM_FILE, 'utf8'), 'ASH', 'tools/sim_panel/sim.js');
  const keys = Array.from(new Set(Object.keys(main).concat(Object.keys(sim)))).sort();
  const rows = [];
  let bad = 0;

  keys.forEach(function (k) {
    const inM = Object.prototype.hasOwnProperty.call(main, k);
    const inS = Object.prototype.hasOwnProperty.call(sim, k);

    if (!inS) {
      if (IGNORED[k]) {
        rows.push({ k: k, m: main[k], s: '—', st: '忽略', note: IGNORED[k] });
        return;
      }
      bad++;
      rows.push({ k: k, m: main[k], s: '—', st: 'FAIL 主文件有·sim缺', note: '补进 sim.ASH，否则模拟器按旧口径跑' });
      return;
    }
    if (!inM) {
      bad++;
      rows.push({ k: k, m: '—', s: sim[k], st: 'FAIL sim有·主文件缺', note: '确认主文件是否已删除该字段' });
      return;
    }
    if (DEFAULT_DIFF_OK[k]) {
      rows.push({ k: k, m: main[k], s: sim[k], st: '允许不同', note: DEFAULT_DIFF_OK[k] });
      return;
    }
    if (main[k] !== sim[k]) {
      bad++;
      rows.push({ k: k, m: main[k], s: sim[k], st: 'FAIL 值不同', note: '' });
      return;
    }
    rows.push({ k: k, m: main[k], s: sim[k], st: '一致', note: '' });
  });

  return {
    rows: rows,
    bad: bad,
    checked: keys.length,
    mainMd5: md5(HTML_FILE),
    simMd5: md5(SIM_FILE)
  };
}

/**
 * 把对账结果打印成表。
 * @param {object} r checkAshDrift 的返回值
 */
function printReport(r) {
  console.log('【ASH 漂移检查】主文件 ' + r.mainMd5.slice(0, 8) + ' … | sim ' + r.simMd5.slice(0, 8) + ' …');
  console.log('  字段'.padEnd(16) + '主文件'.padEnd(14) + 'sim'.padEnd(14) + '状态');
  r.rows.forEach(function (row) {
    console.log(('  ' + row.k).padEnd(16) + String(row.m).padEnd(14)
      + String(row.s).padEnd(14) + row.st + (row.note ? '（' + row.note + '）' : ''));
  });
  console.log('  结果：' + r.checked + ' 个字段，' + (r.bad ? r.bad + ' 处 FAIL' : '全部一致'));
}

/**
 * 跑分入口调用：不一致就打印差异并抛错，让跑分直接起不来。
 */
function assertAshDrift() {
  const r = checkAshDrift();
  if (r.bad) {
    printReport(r);
    throw new Error('sim.ASH 与主文件 ASH_CONFIG 漂移（' + r.bad + ' 处），跑分中止');
  }
  console.log('[ASH 漂移检查] OK：' + r.checked + ' 个字段与主文件 ASH_CONFIG 一致');
}

if (require.main === module) {
  let r;
  try {
    r = checkAshDrift();
  } catch (e) {
    console.error('[ASH 漂移检查] 解析失败：' + e.message);
    process.exit(2);
  }
  printReport(r);
  process.exit(r.bad ? 1 : 0);
}

module.exports = { checkAshDrift: checkAshDrift, assertAshDrift: assertAshDrift };
