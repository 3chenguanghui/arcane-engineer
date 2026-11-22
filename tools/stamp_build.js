/**
 * 构建标识盖章脚本
 * ------------------------------------------------------------
 * 从实际文件计算 BUILD_INFO 的数值，写回同一文件：
 *   · date / builtAt：本机当前时间
 *   · bytes：盖章后文件的真实字节数
 *   · md5：内容 MD5 —— 把 bytes / md5 两个字段归一为占位值后，对整份文件取 MD5
 *     （文件无法包含自己的最终 MD5；内容指纹可复算、能区分版本）
 * 用法：node tools/stamp_build.js [目标文件]
 * 输出：contentMd5 / bytes / finalMd5（finalMd5 才是 Get-FileHash 看到的那一串）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const MD5_PLACEHOLDER = '00000000000000000000000000000000';

/** 两位补零 */
const pad2 = (n) => String(n).padStart(2, '0');

/** 取本机当前构建时间，格式 2026-11-10 21:30 */
function buildStamp(now) {
  const date = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  return { date, builtAt: date + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) };
}

const src = fs.readFileSync(FILE, 'utf8');
const start = src.indexOf('const BUILD_INFO = {');
const end = src.indexOf('};', start);
if (start < 0 || end < 0) throw new Error('找不到 BUILD_INFO 定义');

const stamp = buildStamp(new Date());
const fileName = path.basename(FILE);
let block = src.slice(start, end + 2);

/** 只改 BUILD_INFO 块内的字段，避免误伤其它代码 */
block = block
  .replace(/file:\s*'[^']*'/, `file: '${fileName}'`)
  .replace(/date:\s*'[^']*'/, `date: '${stamp.date}'`)
  .replace(/builtAt:\s*'[^']*'/, `builtAt: '${stamp.builtAt}'`)
  .replace(/bytes:\s*\d+/, 'bytes: 0')
  .replace(/md5:\s*'[^']*'/, `md5: '${MD5_PLACEHOLDER}'`);

const normalized = src.slice(0, start) + block + src.slice(end + 2);
const contentMd5 = crypto.createHash('md5').update(normalized, 'utf8').digest('hex').toUpperCase();

/* bytes 写真实字节数：先按占位长度估算，再迭代到稳定（数字位数会影响总长） */
let filled = normalized;
for (let i = 0; i < 4; i += 1) {
  const bytes = Buffer.byteLength(filled, 'utf8');
  filled = normalized.replace('bytes: 0', 'bytes: ' + bytes);
}
const out = filled.replace(`md5: '${MD5_PLACEHOLDER}'`, `md5: '${contentMd5}'`);
fs.writeFileSync(FILE, out, 'utf8');

console.log(JSON.stringify({
  file: FILE,
  fileName: fileName,
  date: stamp.date,
  builtAt: stamp.builtAt,
  contentMd5: contentMd5,
  bytes: Buffer.byteLength(out, 'utf8'),
  finalMd5: crypto.createHash('md5').update(out, 'utf8').digest('hex').toUpperCase()
}, null, 2));
