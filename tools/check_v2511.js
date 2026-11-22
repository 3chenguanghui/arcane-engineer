/**
 * v2.5.11 配置核对脚本（正反向 + 不变量 + 语法闸门）
 * ------------------------------------------------------------
 * 用法：node tools/check_v2511.js [目标文件]
 * 退出码：0 = 全绿；1 = 有断言失败（打印每条明细）
 *
 * 三类断言：
 *   正向  新值必须在位（6 行配置 + 版本号 + 承伤挂载代码）
 *   反向  旧值必须消失（防止"改了一处忘了另一处"，或被回滚覆盖）
 *   不变量 首领血量公式 / 玩家输出成长曲线 / 破防参数 一个字节都不许动
 * 另附语法闸门：把每个内联 <script> 交给 new Function 编译一次（只编译不执行）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const target = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const src = fs.readFileSync(target, 'utf8');

const results = [];
/**
 * 记一条断言结果
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {string} [detail] 失败时的证据
 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
}

/* ---------- 1) 正向：新值必须在位 ---------- */
const forward = [
  ['版本号 v2.5.11', /version: '2\.5\.11',/],
  ['transitionTime = 0.35', /transitionTime: 0\.35,/],
  ['phase2DamageTakenMul = 1.85', /phase2DamageTakenMul: 1\.85,/],
  ['damageScale = 1.125', /damageScale: 1\.125,/],
  ['mech.attackInterval2 = 1.64', /attackInterval: 2\.6, attackInterval2: 1\.64,/],
  ['rune.attackInterval2 = 1.51', /attackInterval: 2\.4, attackInterval2: 1\.51,/],
  ['void.attackInterval2 = 1.38', /attackInterval: 2\.2, attackInterval2: 1\.38,/],
  ['承伤挂载 enemy.isBoss && enemy.phase2', /enemy\.isBoss && enemy\.phase2/],
  ['承伤挂载乘 BOSS_CONFIG.phase2DamageTakenMul', /breakMul \*= BOSS_CONFIG\.phase2DamageTakenMul;/],
  ['transitionGuard = 0.35（否则 transitionTime 被 max 覆盖失效）', /transitionGuard: 0\.35,/]
];
forward.forEach(([name, re]) => check('正向 · ' + name, re.test(src)));

/* ---------- 2) 反向：旧值必须消失 ---------- */
const back = [
  ['版本号不再是 2.5.10', /version: '2\.5\.10',/],
  ['transitionTime 不再是 0.9', /transitionTime: 0\.9,/],
  ['damageScale 不再是 0.9', /damageScale: 0\.9,/],
  ['mech.attackInterval2 不再是 1.9', /attackInterval: 2\.6, attackInterval2: 1\.9,/],
  ['rune.attackInterval2 不再是 1.75', /attackInterval: 2\.4, attackInterval2: 1\.75,/],
  ['void.attackInterval2 不再是 1.6', /attackInterval: 2\.2, attackInterval2: 1\.6,/],
  ['transitionGuard 不再是 1.0', /transitionGuard: 1\.0,/]
];
back.forEach(([name, re]) => check('反向 · ' + name, !re.test(src)));

/* ---------- 3) 不变量：血量与玩家输出一个字没动 ---------- */
const invariants = [
  ['首领血量 hpBase 1250', /hpBase: 1250,/],
  ['首领血量 hpFloorMul 1.30', /hpFloorMul: 1\.30,/],
  ['首领血量 hpCap 8320', /hpCap: 8320,/],
  ['首领血量 hpCapRampPerFloor 0.04', /hpCapRampPerFloor: 0\.04,/],
  ['首层血量系数 0.90', /1: 0\.9[0,\s]/],
  ['第二层血量系数 0.945', /2: 0\.945/],
  ['第三层血量系数 0.99', /3: 0\.99/],
  ['第四层血量系数 1.035', /4: 1\.035/],
  ['第五层血量系数 1.08', /5: 1\.08/],
  ['科技 amp passiveMul 1.08', /passiveMul: 1\.08/],
  ['遗物 power 伤害 +12%', /id: 'power',[\s\S]{0,240}?damageMul \*= 1\.12/],
  ['融合 damageMul 1.25', /TAG_FUSION_CONFIG[\s\S]{0,200}?damageMul: 1\.25/],
  ['破防窗口 bossBreakDuration 5.0', /bossBreakDuration: 5\.0,/],
  ['破防倍率 bossBreakDamageMul 1.25', /bossBreakDamageMul: 1\.25/],
  ['破防阈值 bossThreshold 0.35', /bossThreshold: 0\.35,/],
  ['一阶段 attackInterval 2.6/2.4/2.2 未动', /attackInterval: 2\.6, |attackInterval: 2\.4, |attackInterval: 2\.2, /]
];
invariants.forEach(([name, re]) => check('不变量 · ' + name, re.test(src)));

/* ---------- 4) 语法闸门：内联脚本只编译不执行 ---------- */
let scriptCount = 0;
let syntaxOk = true;
let syntaxDetail = '';
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRe.exec(src)) !== null) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;      // 外链脚本不归本脚本管
  const body = m[2];
  if (!body.trim()) continue;
  scriptCount += 1;
  try {
    // eslint-disable-next-line no-new-func
    new Function(body);
  } catch (err) {
    syntaxOk = false;
    syntaxDetail = '第 ' + scriptCount + ' 段内联脚本：' + err.message;
    break;
  }
}
check('语法 · 内联脚本可编译（共 ' + scriptCount + ' 段）', syntaxOk, syntaxDetail);

/* ---------- 5) 出报表 ---------- */
const failed = results.filter((r) => !r.ok);
const w = Math.max(...results.map((r) => r.name.length));
console.log('目标文件：' + target + '（' + Buffer.byteLength(src, 'utf8') + ' B）');
results.forEach((r) => {
  console.log((r.ok ? '  PASS ' : '  FAIL ') + r.name.padEnd(w) + (r.ok ? '' : '  ← ' + r.detail));
});
console.log('\n合计 ' + results.length + ' 条，失败 ' + failed.length + ' 条。');
process.exit(failed.length ? 1 : 0);
