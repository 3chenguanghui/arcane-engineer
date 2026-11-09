/* 补丁 D 静态验收：主文件语法 + panel 语法 + 文案收口检查
 * 用法：node tools/merge_audit/verify_itemD.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const HTML = path.join(ROOT, '.merge_audit', 'index_itemD.html');
const PANEL = path.join(ROOT, '.merge_audit', 'ach-panel_patched.js');
const TMP = path.join(ROOT, '.merge_audit', 'syntaxD');
const html = fs.readFileSync(HTML, 'utf8');

fs.mkdirSync(TMP, { recursive: true });
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, ok = true;
while ((m = re.exec(html))) {
  if (!m[1].trim()) continue;
  const p = path.join(TMP, 'c' + (++i) + '.js');
  fs.writeFileSync(p, m[1], 'utf8');
  try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
  catch (e) { ok = false; console.log('FAIL chunk' + i + '\n' + e.stderr.toString().slice(0, 600)); }
}
console.log((ok ? 'PASS' : 'FAIL') + ' · 主文件内联脚本语法（' + i + ' 段）');

try { execFileSync(process.execPath, ['--check', PANEL], { stdio: 'pipe' }); console.log('PASS · 面板脚本语法'); }
catch (e) { console.log('FAIL · 面板脚本语法\n' + e.stderr.toString().slice(0, 600)); }

const shared = html.indexOf('function achRewardText(id, granted, cap)') >= 0
  && html.indexOf('window.achRewardText = achRewardText;') >= 0;
console.log((shared ? 'PASS' : 'FAIL') + ' · 共享函数已定义并挂 window');

const noOld = html.indexOf('初始奥能已满') < 0 && html.indexOf("'无奖励'") < 0;
console.log((noOld ? 'PASS' : 'FAIL') + ' · 旧文案已清除');

const wired = html.indexOf('achRewardText(item.id, aetherGained, META_PROGRESS_CONFIG.maxAetherReward)') >= 0;
console.log((wired ? 'PASS' : 'FAIL') + ' · announceAchievement 已改调共享函数');

const panelWired = fs.readFileSync(PANEL, 'utf8').indexOf('window.achRewardText(item.id, gain, MAX_AETHER_REWARD)') >= 0
  && fs.readFileSync(PANEL, 'utf8').indexOf('奥能已满 · 实得 0') < 0;
console.log((panelWired ? 'PASS' : 'FAIL') + ' · 面板已改调共享函数且清除旧文案');
