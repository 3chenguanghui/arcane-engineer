// 路虚影补丁预算：只读主文件、在内存里套用两处补丁，报「行数 / 字节 / MD5」变化。
// 用法：node tools/merge_audit/apron_patch_budget.js
// 不写主文件；不写任何副本。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', '..', 'index_arcane_v2.html');

/** 计算字符串的行数与 UTF-8 字节数 */
function stat(text) {
  return {
    lines: text.split('\n').length,
    bytes: Buffer.byteLength(text, 'utf8'),
    md5: crypto.createHash('md5').update(text, 'utf8').digest('hex').toUpperCase()
  };
}

/**
 * 套用补丁：两处精确字符串替换，命中数不为 1 就报错（防止锚点漂移）
 * @param {string} src 主文件全文
 * @returns {string} 套用后的全文
 */
function apply(src) {
  const a1 = '  apron: { width: 120, alpha: 0.26, scale: 0.5 },';
  const b1 = '  apron: { width: 120, alpha: 0.26, scale: 0.5, clipToFloors: true },';
  if (src.split(a1).length - 1 !== 1) throw new Error('锚点 1 命中数 != 1');

  const a2 = '  // 注意：rooms 只统计正式房间（不含秘藏房），方便和 state.rooms.length 对齐\n  state.parallax.apron = {';
  const b2 = [
    '  // 修复「路的虚影」：延伸带只允许存在于任何地面矩形之外（总开关 cfg.apron.clipToFloors）',
    '  // 走廊腿的左右 120px 渐变条必然整段压进它两端连接的房间；延伸带在 fog 之后',
    '  // 以地板色叠上去，而探索过的房间雾是透明的 → 房间上留下半透明竖带 + 接缝高光。',
    '  // 烘焙期抠一次，运行时零成本；开关置 false 即回到旧行为，供 A/B 复查。',
    '  if (cfg.apron.clipToFloors !== false) {',
    '    const punchFloor = (rect) => {',
    '      if (!rect || !rect.w || !rect.h) return;',
    '      g.clearRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2));',
    '    };',
    '    state.rooms.forEach(punchFloor);',
    '    (state.corridorRects || []).forEach(punchFloor);',
    '    punchFloor(state.hiddenRoom);',
    '  }',
    '  // 注意：rooms 只统计正式房间（不含秘藏房），方便和 state.rooms.length 对齐',
    '  state.parallax.apron = {'
  ].join('\n');
  if (src.split(a2).length - 1 !== 1) throw new Error('锚点 2 命中数 != 1');
  return src.replace(a1, b1).replace(a2, b2);
}

const src = fs.readFileSync(SRC, 'utf8');
const s0 = stat(src);
const out = apply(src);
const s1 = stat(out);
console.log(JSON.stringify({
  before: s0,
  after: s1,
  delta: {
    lines: s1.lines - s0.lines,
    bytes: s1.bytes - s0.bytes
  },
  untouched: s0.md5 === stat(fs.readFileSync(SRC, 'utf8')).md5
}, null, 2));
