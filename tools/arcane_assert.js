/**
 * 断言分类器：把"负载敏感"的性能断言（fps / 帧率 / 帧耗时）与功能断言分开
 * ------------------------------------------------------------
 * 背景：过去 96 个测试脚本里，性能断言（如 "帧率 ≥ 90"）和功能断言用同一套 PASS/FAIL 判红。
 * 结果每次机器忙、串行跑多了、后台在更新，都会被 fps 拖成假红，浪费排查时间。
 *
 * 现在改成两类：
 *   - FUNCTION（功能类）：照旧 PASS/FAIL，失败即判红、退出码 1；
 *   - PERF（负载敏感）：只记录 `OK` / `PENDING`，**永不判失败**，退出码不受影响。
 *
 * 用法（零改动，全局生效）：
 *   `arcane_profile.js` 在被 require 时会自动调用 `installPerfClassifier()`，
 *   所有测试脚本（它们都 require 了 arcane_profile）的输出会被自动重新分类，
 *   无需逐个脚本改 `check()`。
 *
 * 用法（新脚本想显式声明）：
 *   `const { assertPerf } = require('./arcane_assert'); assertPerf('帧率 ≥ 60', fps >= 60, { fps });`
 */
const util = require('util');

/** 断言名里出现这些词 → 视为"负载敏感"的性能类断言（注意：不要用"性能"二字，
 *  否则会把"性能模式总开关"这类功能断言误分类） */
const PERF_NAME_RE = /(fps|FPS|帧率|帧耗时|平均帧|frameMs|frame_ms)/;

/** 断言名里出现这些词 → 该断言是"混合断言"（同时校验功能项），分类时会提示人工复核 */
const MIXED_NAME_RE = /(截图|报错|错误|崩溃|errors|>10KB|>10kb)/;

const stats = {
  fnTotal: 0, fnPass: 0, fnFail: 0,
  perfTotal: 0, perfOk: 0, perfPending: 0,
  perfMixed: 0,
  rewritten: 0
};

let installed = false;
const rawLog = console.log.bind(console);

/**
 * 判断一条断言名是否属于"负载敏感"的性能类断言
 * @param {string} name 断言名
 * @returns {boolean} true = 性能类（不判失败）
 */
function isPerfName(name) {
  return typeof name === 'string' && PERF_NAME_RE.test(name);
}

/**
 * 判断一条性能断言是否"混合断言"（名字里还带了截图/报错等功能项）
 * @param {string} name 断言名
 * @returns {boolean} true = 混合断言，需要人工复核
 */
function isMixedPerfName(name) {
  return isPerfName(name) && MIXED_NAME_RE.test(name);
}

/**
 * 解析一行断言输出（兼容两种历史格式）
 *   A: `PASS  <name>  <detail>`（双空格分隔，m12–m24 系列）
 *   B: `PASS · <name> · <detail>`（中点分隔，u/a/l 系列）
 * @param {string} text 原始行
 * @returns {{status:string,name:string,detail:string,sep:string}|null} 解析结果，非断言行返回 null
 */
function parseAssertLine(text) {
  const m1 = /^(PASS|FAIL)\s{2}(.*)$/.exec(text);
  if (m1) {
    const body = m1[2];
    const idx = body.indexOf('  ');
    return {
      status: m1[1],
      name: (idx < 0 ? body : body.slice(0, idx)).trim(),
      detail: idx < 0 ? '' : body.slice(idx + 2),
      sep: '  '
    };
  }
  const m2 = /^(PASS|FAIL)\s*·\s*(.*)$/.exec(text);
  if (m2) {
    const body = m2[2];
    const idx = body.indexOf(' · ');
    return {
      status: m2[1],
      name: (idx < 0 ? body : body.slice(0, idx)).trim(),
      detail: idx < 0 ? '' : body.slice(idx + 3),
      sep: ' · '
    };
  }
  return null;
}

/**
 * 按分类重写一行断言输出，并累计统计
 * @param {{status:string,name:string,detail:string,sep:string}} parsed 解析结果
 * @returns {string} 重写后的行
 */
function rewriteAssertLine(parsed) {
  const { status, name, detail, sep } = parsed;
  if (!isPerfName(name)) {
    stats.fnTotal += 1;
    if (status === 'PASS') stats.fnPass += 1; else stats.fnFail += 1;
    return `${status}${sep}${name}${detail ? sep + detail : ''}`;
  }
  stats.perfTotal += 1;
  if (status === 'PASS') stats.perfOk += 1; else stats.perfPending += 1;
  const mixed = isMixedPerfName(name);
  if (mixed) stats.perfMixed += 1;
  const label = status === 'PASS' ? 'PERF(负载敏感) OK' : 'PERF(负载敏感) PENDING';
  const tail = mixed ? '（混合断言：含功能项，建议人工复核）' : '';
  return `${label}${sep}${name}${detail ? sep + detail : ''}${tail}`;
}

/**
 * 重写脚本自带的汇总行（如 `RESULT: 39/40 PASS` / `U11 · 20/20 PASS`）
 * 把分数换成"只算功能类"的分数，避免性能类 PENDING 把总分拉难看
 * @param {string} text 原始行
 * @returns {string} 重写后的行（不是汇总行则原样返回）
 */
function rewriteSummaryLine(text) {
  const trimmed = text.trim();
  if (!/(PASS|FAIL)$/.test(trimmed)) return text;
  if (!/\d+\s*\/\s*\d+/.test(trimmed)) return text;
  return text.replace(/\d+\s*\/\s*\d+/, `${stats.fnPass}/${stats.fnTotal}`);
}

/**
 * 输出最终分类汇总，并在"只有性能类 PENDING"时把退出码改回 0
 * @returns {void}
 */
function printSummary() {
  if (stats.fnTotal === 0 && stats.perfTotal === 0) return;
  rawLog('');
  rawLog('===== 断言分类汇总 =====');
  rawLog(`FUNCTION(功能类·判红)      ${stats.fnPass}/${stats.fnTotal} PASS`
    + (stats.fnFail ? `  ← ${stats.fnFail} 条真失败` : ''));
  rawLog(`PERF(负载敏感·只记录)      ${stats.perfOk}/${stats.perfTotal} OK`
    + `  （PENDING ${stats.perfPending} 条不判失败${stats.perfMixed ? `，其中混合断言 ${stats.perfMixed} 条待复核` : ''}）`);
  const verdict = stats.fnFail === 0 ? 'PASS' : 'FAIL';
  rawLog(`VERDICT: ${verdict}${stats.fnFail === 0 && stats.perfPending ? '（性能类 PENDING 已忽略，不计入失败）' : ''}`);
  if (stats.fnFail === 0 && process.exitCode === 1 && stats.perfPending > 0) {
    process.exitCode = 0;
  }
}

/**
 * 安装全局分类器（幂等）：拦截 console.log，自动识别并重写断言行
 * 环境变量 `ARCANE_PERF_STRICT=1` 可关闭（回到旧的"性能和功能一起判红"行为）
 * @returns {boolean} 是否本次安装成功
 */
function installPerfClassifier() {
  if (installed) return false;
  if (process.env.ARCANE_PERF_STRICT === '1') return false;
  installed = true;
  console.log = function patchedLog(...args) {
    const text = args.length === 1 && typeof args[0] === 'string' ? args[0] : util.format(...args);
    const parsed = parseAssertLine(text);
    if (parsed) {
      stats.rewritten += 1;
      rawLog(rewriteAssertLine(parsed));
      return;
    }
    rawLog(rewriteSummaryLine(text));
  };
  process.on('exit', printSummary);
  return true;
}

/**
 * 显式声明一条性能断言（永不判失败，只记录 OK / PENDING）
 * @param {string} name 断言名（含 fps / 帧率 等关键词）
 * @param {boolean} ok 是否达标
 * @param {*} [detail] 附加信息
 * @returns {boolean} 原样返回 ok，便于链式使用
 */
function assertPerf(name, ok, detail) {
  stats.perfTotal += 1;
  if (ok) stats.perfOk += 1; else stats.perfPending += 1;
  if (isMixedPerfName(name)) stats.perfMixed += 1;
  const label = ok ? 'PERF(负载敏感) OK' : 'PERF(负载敏感) PENDING';
  rawLog(`${label}  ${name}${detail == null ? '' : '  ' + JSON.stringify(detail)}`);
  return ok;
}

module.exports = {
  PERF_NAME_RE,
  isPerfName,
  isMixedPerfName,
  parseAssertLine,
  rewriteAssertLine,
  rewriteSummaryLine,
  installPerfClassifier,
  assertPerf,
  stats
};
