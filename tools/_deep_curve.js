/**
 * v1.5.5 · F20 深层回血 A/B 曲线分析器（打磨轮扩充版）
 * ------------------------------------------------------------
 * 输入：`_cut_run.js`（E2E_DEEP_AB=1）产出的 `.screenshots/cut/deep-ab.json`
 * 现在支持三组：off（关闭深层回血=基线）/ shield（溢出转护盾）/ bank（溢出存蓄能）。
 * 输出：
 *   1) 逐房表：承伤 / 单次峰值 / 起血 / 终血 / 实际回复
 *   2) 全场合计：总承伤 / 总回复 / 终点血量 / 首领段最低血
 *   3) 判定：D1 基线完整、D2 B 组首领段最低血 ≥ 60、D3 B 终点 ≥ A+50、
 *      D4 有真实回复、D5 溢出方式实测择优（shield / bank 谁的首领段最低血更高）
 *      ——B 组一律取 D5 的择优结果，避免"脚本选一组、结论写另一组"的自相矛盾。
 *
 * 用法：node tools\_deep_curve.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, '.screenshots', 'cut', 'deep-ab.json');
const OUT = path.join(ROOT, '.screenshots', 'cut', 'deep-curve-summary.json');

/**
 * 把「每秒血量 + 每秒累计承伤」还原成「每秒实际回复」
 * 公式：heal = (本秒血量 - 上秒血量) + (本秒累计承伤 - 上秒累计承伤)
 * @param {Array<{t:number,hp:number}>} hpTrail 每秒血量
 * @param {Array<{t:number,dmg:number}>} dmgTrail 每秒累计承伤
 * @returns {number} 本房实际回复合计（只算正数；被 hpMax 截断的部分不计）
 */
function healedOf(hpTrail, dmgTrail) {
  const h = hpTrail || [];
  const d = dmgTrail || [];
  let healed = 0;
  let prevHp = null;
  let prevDmg = null;
  for (let i = 0; i < h.length; i += 1) {
    const hp = h[i].hp;
    const dm = (d[i] && d[i].dmg) || 0;
    if (prevHp !== null) {
      const diff = (hp - prevHp) + (dm - prevDmg);
      if (diff > 0) healed += diff;
    }
    prevHp = hp;
    prevDmg = dm;
  }
  return Math.round(healed);
}

/**
 * 单组（off / shield / bank）的汇总
 * @param {Object} step deep-ab.json 里的一组
 * @returns {Object} 汇总结果
 */
function summarize(step) {
  const rooms = (step.segments || []).map((s) => ({
    type: s.type,
    room: s.room,
    seconds: s.seconds,
    dmg: s.dmg,
    dmgPeak: s.dmgPeak,
    hpStart: s.hpStart,
    hpMin: s.hpMin,
    hpEnd: s.hpEnd,
    healed: healedOf(s.hpTrail, s.dmgTrail),
    endStatus: s.endStatus
  }));
  const totalDmg = rooms.reduce((a, r) => a + (r.dmg || 0), 0);
  const totalHeal = rooms.reduce((a, r) => a + (r.healed || 0), 0);
  const last = rooms.length ? rooms[rooms.length - 1] : null;
  const bossRooms = rooms.filter((r) => r.type === 'boss');
  return {
    mode: step.mode || (step.deepHeal ? 'on' : 'off'),
    deepHeal: !!step.deepHeal,
    startHp: step.start ? step.start.hp : null,
    hpMax: step.start ? step.start.hpMax : null,
    totalDmg,
    totalHeal,
    finalHp: last ? last.hpEnd : null,
    bossMinHp: bossRooms.length ? Math.min.apply(null, bossRooms.map((r) => r.hpMin)) : null,
    shieldEnd: step.shieldEnd || 0,
    bankEnd: step.bankEnd || 0,
    dead: !!step.dead,
    rooms
  };
}

/**
 * 打印一张逐房表
 * @param {Object} s summarize() 的结果
 * @returns {void}
 */
function printTable(s) {
  const title = s.mode === 'off' ? 'A 关闭（等价 v1.5.4）' : ('B · 溢出方式 ' + s.mode);
  console.log('\n' + title + ' · 起点 hp ' + s.startHp + '/' + s.hpMax);
  console.log('  ' + ['房间', '承伤', '峰值', '起血', '终血', '最低', '实际回复', '秒'].join(' | '));
  s.rooms.forEach((r) => {
    console.log('  ' + ['F20-' + r.type + '#' + r.room, r.dmg, r.dmgPeak, r.hpStart, r.hpEnd, r.hpMin, r.healed, r.seconds].join(' | '));
  });
  console.log('  合计：承伤 ' + s.totalDmg + ' · 实际回复 ' + s.totalHeal
    + ' · 终点 hp ' + s.finalHp + ' · 首领段最低 ' + s.bossMinHp + ' · 死亡 ' + s.dead
    + ' · 收尾盾 ' + s.shieldEnd + ' · 收尾蓄 ' + s.bankEnd);
}

/**
 * 主流程
 * @returns {void}
 */
function main() {
  if (!fs.existsSync(IN)) {
    console.error('缺少 deep-ab.json，请先跑：$env:E2E_DEEP_AB=\'1\'; node tools\\_cut_run.js');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const steps = (data.steps || []).map(summarize);
  const a = steps.find((s) => s.mode === 'off');
  const shield = steps.find((s) => s.mode === 'shield');
  const bank = steps.find((s) => s.mode === 'bank');
  /* 打磨轮第 1 项：先按「首领段最低血 ×10 + 终点血」加权择优，再用择优结果当 B 组；
     阵亡组记 -9999，保证"活下来的那一组"一定排前面 */
  const scoreOf = (g) => (g.bossMinHp || 0) * 10 + (g.finalHp || 0) + (g.dead ? -9999 : 0);
  let pick = null;
  if (shield && bank) pick = scoreOf(shield) >= scoreOf(bank) ? 'shield' : 'bank';
  const b = pick === 'shield' ? shield
    : (pick === 'bank' ? bank : (bank || shield || steps.find((s) => s.deepHeal)));
  if (!a || !b) {
    console.error('deep-ab.json 里缺少 A（off）或 B（shield/bank）组');
    process.exit(1);
  }
  steps.forEach(printTable);

  const checks = [];
  const ok = (name, pass, detail) => {
    checks.push({ name, pass: !!pass, detail });
    console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
  };
  ok('D1 A 组（改前）不做每房回满/不兜底，血量曲线完整', a.rooms.length > 0, { rooms: a.rooms.length });
  ok('D2 B 组首领段最低血 ≥ 60（用户口径：从"剩 9 血"提到 60 以上）', (b.bossMinHp || 0) >= 60,
    { mode: b.mode, bossMinHp: b.bossMinHp, finalHp: b.finalHp });
  ok('D3 B 组终点血量 ≥ A 组 + 50', (b.finalHp - a.finalHp) >= 50,
    { a: a.finalHp, b: b.finalHp, diff: b.finalHp - a.finalHp });
  ok('D4 B 组实际回复 > 0（说明节奏确实触发）', b.totalHeal > 0, { heal: b.totalHeal });

  /* D5 打磨轮第 1 项：溢出护盾 vs 蓄能，用实测首领段最低血 / 终点血择优
     （pick 已在上面算出，B 组也按它选，这里只负责把对比结果打印出来） */
  if (shield && bank) {
    ok('D5 溢出方式择优（shield vs bank，按首领最低血加权）', true, {
      pick,
      shield: { bossMinHp: shield.bossMinHp, finalHp: shield.finalHp, dead: shield.dead },
      bank: { bossMinHp: bank.bossMinHp, finalHp: bank.finalHp, dead: bank.dead }
    });
  }

  fs.writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(),
    a, b, shield, bank, pick, checks,
    pass: checks.filter((c) => c.pass).length, total: checks.length
  }, null, 2));
  console.log('\nRESULT: ' + (checks.every((c) => c.pass) ? 'PASS' : 'FAIL')
    + '  ' + checks.filter((c) => c.pass).length + '/' + checks.length
    + (pick ? (' · 溢出方式择优：' + pick) : ''));
  if (!checks.every((c) => c.pass)) process.exitCode = 1;
}

main();
