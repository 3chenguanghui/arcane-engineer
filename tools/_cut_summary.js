/**
 * C0/C1 汇总脚本：把 cut-result.json 的分层/分房秒数汇总成报告要用的数字
 * 用法：node tools\_cut_summary.js [文件名]
 *       默认读 .screenshots/cut/cut-result.json；可传 cut-result-v150-before.json 做改前/改后对比
 * @returns {void}
 */
const fs = require('fs');
const path = require('path');

const ARG = process.argv[2] || 'cut-result.json';
const FILE = path.isAbsolute(ARG) ? ARG : path.join(__dirname, '..', '.screenshots', 'cut', ARG);
if (!fs.existsSync(FILE)) {
  console.error('找不到 ' + FILE + '，请先跑 tools/_cut_run.js');
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const floors = j.floors.filter((f) => f.segments);

/**
 * 按房型汇总：次数 / 总秒 / 平均 / 最长
 * @param {Array} fs 楼层数组
 * @returns {Object} 汇总
 */
function byType(fs) {
  const out = {};
  fs.forEach((f) => f.segments.forEach((s) => {
    const k = s.type;
    if (!out[k]) out[k] = { n: 0, sec: 0, max: 0, kills: 0 };
    out[k].n += 1;
    out[k].sec += (s.seconds || 0);
    out[k].max = Math.max(out[k].max, s.seconds || 0);
    out[k].kills += (s.kills || 0);
  }));
  return out;
}

/**
 * 打印一行
 * @param {string} k 房型
 * @param {Object} v 汇总值
 * @returns {void}
 */
function printType(k, v) {
  console.log('  ' + k.padEnd(9) + ' 次数 ' + String(v.n).padStart(2)
    + '  平均 ' + (v.sec / v.n).toFixed(1) + 's  最长 ' + v.max.toFixed(1) + 's  击杀 ' + v.kills);
}

console.log('===== 总览 =====');
console.log('楼层数 ' + floors.length + ' · 总时长 ' + j.totalSeconds.toFixed(1) + 's = '
  + (j.totalSeconds / 60).toFixed(2) + ' 分钟');
if (j.firstBossEnterSeconds != null) {
  console.log('第一场首领 F' + j.firstBossFloor + '：进门 ' + j.firstBossEnterSeconds + 's（'
    + (j.firstBossEnterSeconds / 60).toFixed(2) + ' 分）；打完 ' + j.firstBossClearSeconds + 's（'
    + (j.firstBossClearSeconds / 60).toFixed(2) + ' 分）');
}
console.log('\n===== 逐层 =====');
let gapTotal = 0;
let travelWalkTotal = 0;
/* C1：把"未计入"再拆一层——机器人从一间房走到下一间房的帧数（travelFrames）
   是唯一有游戏内时间成本的部分；弹窗/转场在探针里是 0 游戏秒（脚本瞬时点选）。 */
let gapOtherTotal = 0;
floors.forEach((f) => {
  const combat = f.segments.filter((s) => s.type !== 'start').reduce((a, s) => a + (s.seconds || 0), 0);
  const boss = f.segments.filter((s) => s.type === 'boss').reduce((a, s) => a + (s.seconds || 0), 0);
  const segSum = f.segments.reduce((a, s) => a + (s.seconds || 0), 0);
  const gap = f.seconds - segSum;   // 换房走路 / 转场 / 奖励弹窗等没被分段覆盖的时间
  const travel = f.segments.reduce((a, s) => a + (s.travelFrames || 0), 0) / 60;
  gapTotal += gap;
  travelWalkTotal += travel;
  gapOtherTotal += Math.max(0, gap - travel);
  console.log('  F' + String(f.floor).padStart(2) + ' ' + String(f.seconds).padStart(6) + 's'
    + '  房 ' + f.segments.length + '  非走图 ' + combat.toFixed(1) + 's  首领 ' + boss.toFixed(1) + 's'
    + '  未计入(换房/转场) ' + gap.toFixed(1) + 's'
    + '  [其中走路 ' + travel.toFixed(1) + 's / 其他 ' + Math.max(0, gap - travel).toFixed(1) + 's]');
});
const roomCount = floors.reduce((a, f) => a + f.segments.length, 0);
console.log('\n===== 换房时间拆解（每间房） =====');
console.log('  房间数 ' + roomCount + ' · 未计入总 ' + gapTotal.toFixed(1) + 's · 每间 '
  + (gapTotal / roomCount).toFixed(2) + 's');
console.log('  · 走路(到门→进门→到下一间) ' + travelWalkTotal.toFixed(1) + 's = 每间 '
  + (travelWalkTotal / roomCount).toFixed(2) + 's（占未计入 '
  + (travelWalkTotal / Math.max(1, gapTotal) * 100).toFixed(1) + '%）');
console.log('  · 其他(裂隙绕路 / 楼层切换 / 等怪出生) ' + gapOtherTotal.toFixed(1) + 's = 每间 '
  + (gapOtherTotal / roomCount).toFixed(2) + 's（占未计入 '
  + (gapOtherTotal / Math.max(1, gapTotal) * 100).toFixed(1) + '%）');
console.log('  · 三选一弹窗 / 清房结算 / 门淡入淡出：探针内 0 游戏秒（chooseReward 同步瞬时执行）');
console.log('\n===== 按房型 =====');
const agg = byType(floors);
Object.keys(agg).sort((a, b) => agg[b].sec - agg[a].sec).forEach((k) => printType(k, agg[k]));
const bossTotal = (agg.boss ? agg.boss.sec : 0);
const battleTotal = (agg.battle ? agg.battle.sec : 0);
const eliteTotal = (agg.elite ? agg.elite.sec : 0);
const travelTotal = (agg.start ? agg.start.sec : 0);
console.log('\n===== 占比 =====');
console.log('  首领 ' + (bossTotal / j.totalSeconds * 100).toFixed(1) + '%'
  + ' · 普通战斗 ' + (battleTotal / j.totalSeconds * 100).toFixed(1) + '%'
  + ' · 精英 ' + (eliteTotal / j.totalSeconds * 100).toFixed(1) + '%'
  + ' · 层内走图 ' + (travelTotal / j.totalSeconds * 100).toFixed(1) + '%'
  + ' · 未计入(换房/转场/奖励) ' + (gapTotal / j.totalSeconds * 100).toFixed(1) + '%'
  + '（' + gapTotal.toFixed(1) + 's）');
console.log('\n===== C1-5b 新手前 90 秒爽点 =====');
console.log('  到首杀：' + (j.firstKillAt === null || j.firstKillAt === undefined ? '未达成' : j.firstKillAt.toFixed(1) + 's'));
console.log('  到首个三杀（0.5s 内 3 杀）：'
  + (j.firstTripleAt === null || j.firstTripleAt === undefined ? '未达成' : j.firstTripleAt.toFixed(1) + 's'));

console.log('\n===== 首领战逐层 =====');
(j.bossFights || []).forEach((b) => console.log('  F' + b.floor + ' 战 ' + b.fightSeconds + 's'));

/* ============================================================
   C1-5b：疾跑归因 + 进门→接战距离 + 出生点挪动量
   ------------------------------------------------------------
   全部来自 _cut_run.js 每帧记账（walk.move / blockOld / blockBoth…），
   秒数 = 帧数 / 60。可回收秒数按"1x 变 2.8x"折算：sec × (1 − 1/2.8)。
   ============================================================ */
const walkAgg = { move: 0, sprint: 0, blockOld: 0, blockBoth: 0, bossLock: 0, still: 0, dist: 0 };
const combatSegs = [];
floors.forEach((f) => f.segments.forEach((s) => {
  const w = s.walk || {};
  Object.keys(walkAgg).forEach((k) => { walkAgg[k] += Number(w[k] || 0); });
  if (['battle', 'elite', 'survival'].indexOf(s.type) >= 0) combatSegs.push(s);
}));
const fps = 60;
const sec = (frames) => frames / fps;
const sprintSec = sec(walkAgg.sprint);
const blockOldSec = sec(walkAgg.blockOld);
const blockBothSec = sec(walkAgg.blockBoth);
const bossLockSec = sec(walkAgg.bossLock);
const moveSec = sec(walkAgg.move);
const recoverableSec = blockOldSec * (1 - 1 / 2.8);
const newWalkSec = sprintSec + blockOldSec / 2.8 + blockBothSec;

console.log('\n===== C1-5b 疾跑归因（换房走图期间） =====');
console.log('  走路帧 ' + walkAgg.move + '（' + moveSec.toFixed(1) + 's）· 其中实际疾跑 '
  + sprintSec.toFixed(1) + 's（' + (sprintSec / Math.max(1, moveSec) * 100).toFixed(1) + '%）');
console.log('  · 旧口径拦下、新口径放行 ' + blockOldSec.toFixed(1) + 's（' + (blockOldSec / Math.max(1, moveSec) * 100).toFixed(1)
  + '%）→ 按 2.8× 折算可回收 ' + recoverableSec.toFixed(1) + 's');
console.log('  · 新旧口径都拦（血厚且在追） ' + blockBothSec.toFixed(1) + 's · 首领登场禁跑 '
  + bossLockSec.toFixed(1) + 's · 原地帧 ' + sec(walkAgg.still).toFixed(1) + 's');
console.log('  · 若新口径生效，走图预计 ' + newWalkSec.toFixed(1) + 's（比当前 '
  + moveSec.toFixed(1) + 's 少 ' + (moveSec - newWalkSec).toFixed(1) + 's）');
if (combatSegs.length) {
  const ds = combatSegs.map((s) => Number(s.enterD)).filter((v) => v > 0).sort((a, b) => a - b);
  const mid = ds.length ? ds[Math.floor(ds.length / 2)] : -1;
  const avg = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : -1;
  const shifts = combatSegs.map((s) => Number(s.spawnShift) || 0).filter((v) => v > 0);
  console.log('\n===== C1-5b 进门→接战距离（战斗 / 精英 / 生存房） =====');
  console.log('  样本 ' + ds.length + ' 间 · 平均 ' + avg.toFixed(0) + 'px · 中位 ' + mid
    + 'px · 最近 ' + (ds[0] || -1) + 'px · 最远 ' + (ds[ds.length - 1] || -1) + 'px');
  if (shifts.length) {
    console.log('  出生点平均挪动 ' + (shifts.reduce((a, b) => a + b, 0) / shifts.length).toFixed(0)
      + 'px（' + shifts.length + ' 间有记录）');
  } else {
    console.log('  出生点挪动 0px（前移未启用）');
  }
  const avgSpeed = walkAgg.dist / Math.max(0.001, moveSec);
  console.log('  走图平均步速 ' + Math.round(avgSpeed) + ' px/s（含疾跑段；用于折算每 100px 的秒数）');
}

