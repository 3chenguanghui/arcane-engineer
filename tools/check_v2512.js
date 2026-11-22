/**
 * v2.5.12 配置核对脚本（正反向 + 不变量 + 语法闸门）
 * ------------------------------------------------------------
 * 本轮只改四行：三个招牌的一阶段冷却 + 首个招牌初值。
 * 用法：node tools/check_v2512.js [目标文件]
 * 退出码：0 = 全绿；1 = 有断言失败（打印每条明细）
 *
 * 三类断言：
 *   正向  新值必须在位（4 行配置 + 版本号 + 二阶段参数原样）
 *   反向  旧值必须消失（防止改漏一处，或被回滚覆盖）
 *   不变量 首领血量 / 五层系数 / 玩家输出成长 / 二阶段参数 一个字节都不许动
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
 * @returns {void}
 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
}

/* ---------- 1) 正向：新值必须在位 ---------- */
const forward = [
  ['版本号 v2.5.12', /version: '2\.5\.12',/],
  ['mech 招牌冷却 5.7', /id: 'overload',[\s\S]{0,200}?cooldown: 5\.7,/],
  ['rune 招牌冷却 5.6', /id: 'runeChain',[\s\S]{0,120}?cooldown: 5\.6,/],
  ['void 招牌冷却 6.5', /id: 'gravityWell',[\s\S]{0,160}?cooldown: 6\.5,/],
  ['首个招牌 sigTimer 3.0', /sigTimer: 3\.0,/],
  /* 招牌入口修复：enemy.started 必须在真实进房流程里被置真，否则计时器永远早退 */
  ['进房同步 enemy.started', /function startBossIntro\(room\) \{[\s\S]{0,1200}?boss\.started = true;/],
  ['招牌只在一阶段启用（二阶段闸）', /if \(!boss\.started \|\| boss\.phase2 \|\| boss\.telegraph \|\| state\.bossSigV1 === false\) return;/],
  /* 二阶段：v2.5.11 刚验完，必须原样（只由 0.75 乘算跟着变密） */
  ['二阶段招牌乘数 0.75', /phase2CooldownMul: 0\.75,/],
  ['transitionTime = 0.35', /transitionTime: 0\.35,/],
  ['transitionGuard = 0.35', /transitionGuard: 0\.35,/],
  ['phase2DamageTakenMul = 1.85', /phase2DamageTakenMul: 1\.85,/],
  ['damageScale = 1.125', /damageScale: 1\.125,/],
  ['mech.attackInterval2 = 1.64', /attackInterval: 2\.6, attackInterval2: 1\.64,/],
  ['rune.attackInterval2 = 1.51', /attackInterval: 2\.4, attackInterval2: 1\.51,/],
  ['void.attackInterval2 = 1.38', /attackInterval: 2\.2, attackInterval2: 1\.38,/],
  ['二阶段承伤挂载代码仍在', /breakMul \*= BOSS_CONFIG\.phase2DamageTakenMul;/]
];
forward.forEach(([name, re]) => check('正向 · ' + name, re.test(src)));

/* ---------- 2) 反向：旧值必须消失 ---------- */
const back = [
  ['版本号不再是 2.5.11', /version: '2\.5\.11',/],
  ['mech 冷却不再是 9.0', /id: 'overload',[\s\S]{0,200}?cooldown: 9\.0,/],
  ['rune 冷却不再是 8.0', /id: 'runeChain',[\s\S]{0,120}?cooldown: 8\.0,/],
  ['void 冷却不再是 10.0', /id: 'gravityWell',[\s\S]{0,160}?cooldown: 10\.0,/],
  ['sigTimer 初值不再是 6.5', /sigTimer: 6\.5,/],
  ['进房不再漏设 enemy.started', /if \(boss\) boss\.invulnTimer = BOSS_CONFIG\.introTime;/],
  ['二阶段不再被招牌计时器侵入', /if \(!boss\.started \|\| boss\.telegraph \|\| state\.bossSigV1 === false\) return;/]
];
back.forEach(([name, re]) => check('反向 · ' + name, !re.test(src)));

/* ---------- 3) 不变量：血量、系数、玩家成长、一阶段节拍一个字没动 ---------- */
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
  ['一阶段 attackInterval 2.6/2.4/2.2 未动', /attackInterval: 2\.6, |attackInterval: 2\.4, |attackInterval: 2\.2, /],
  ['一阶段机械减伤 armorMul 0.70 未动', /armorMul: 0\.70\b/]
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
