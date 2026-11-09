/* 合并审查线 · 第 1 项静态验收：语法 + 注册数量 + 口径分支
 * 用法：node tools/merge_audit/verify_item1.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, '.merge_audit', 'index_item1.html');
const TMP = path.join(ROOT, '.merge_audit', 'syntax');
const html = fs.readFileSync(FILE, 'utf8');

/* 1) 抽取内联脚本，逐段 node --check */
fs.mkdirSync(TMP, { recursive: true });
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, ok = true;
while ((m = re.exec(html))) {
  const code = m[1];
  if (!code.trim()) continue;
  const p = path.join(TMP, 'chunk' + (++i) + '.js');
  fs.writeFileSync(p, code, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
  } catch (e) {
    ok = false;
    console.log('SYNTAX FAIL · chunk' + i + '\n' + e.stderr.toString().slice(0, 800));
  }
}
console.log((ok ? 'PASS' : 'FAIL') + ' · 内联脚本语法（' + i + ' 段）');

/* 2) 静态计数 */
const achBlock = html.slice(html.indexOf('const META_PROGRESS_CONFIG'), html.indexOf('META_PROGRESS_CONFIG.byId = {}'));
const achCount = (achBlock.match(/\{ id: '/g) || []).length;
console.log((achCount === 38 ? 'PASS' : 'FAIL') + ' · 成就条目 = ' + achCount + '（期望 38）');

const cases = ['dailyCleared', 'codexEnemies', 'codexRelics', 'codexCards', 'talentLevels',
  'wagerWins', 'sacrifices', 'barrelKills', 'challenge10Clears'];
const missing = cases.filter((c) => html.indexOf("case '" + c + "'") < 0);
console.log((missing.length === 0 ? 'PASS' : 'FAIL') + ' · 9 条新口径缺失 = ' + JSON.stringify(missing));

const barrelStat = html.indexOf('barrelKills: Math.max(0') >= 0 && html.indexOf('barrelKills: 0') >= 0;
console.log((barrelStat ? 'PASS' : 'FAIL') + ' · barrelKills 默认值 + 读档兜底');

const bump = html.indexOf("if (kind === 'barrel') metaBumpStat('barrelKills', 1);") >= 0;
console.log((bump ? 'PASS' : 'FAIL') + ' · terrainBump 爆桶计数');

const honest = html.indexOf('item.grantedAether') >= 0 && html.indexOf("'已记入档案'") >= 0;
console.log((honest ? 'PASS' : 'FAIL') + ' · 奖励超上限后的报数口径');

const byIdWrite = html.indexOf('META_PROGRESS_CONFIG.byId[item.id] = item;') >= 0;
console.log((byIdWrite ? 'PASS' : 'FAIL') + ' · byId 双写仍由末尾 forEach 统一生成');
