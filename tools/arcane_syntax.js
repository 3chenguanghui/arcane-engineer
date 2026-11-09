// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// 语法检查：把 HTML 里的内联 <script> 逐块抽出来，用 vm.Script 编译（不执行）
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const html = fs.readFileSync(file, 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
let idx = 0;
let bad = 0;
while ((m = re.exec(html))) {
  const code = m[1];
  if (!code.trim()) { idx += 1; continue; }
  try {
    new vm.Script(code, { filename: 'chunk_' + idx + '.js' });
    console.log('chunk ' + idx + ' OK  (' + code.split('\n').length + ' lines)');
  } catch (e) {
    bad += 1;
    console.log('chunk ' + idx + ' SYNTAX ERROR: ' + e.message);
  }
  idx += 1;
}
console.log(bad ? 'RESULT: FAIL (' + bad + ')' : 'RESULT: PASS');
process.exit(bad ? 1 : 0);
