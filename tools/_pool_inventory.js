/**
 * 现场导出：MAGIC_CONFIG / AOE_SKILL_CONFIG / TACTIC 的数值，用于盘点表
 * 用法：node tools/_pool_inventory.js
 * @returns {void}
 */
function main() {
  const fs = require('fs');
  const t = fs.readFileSync('D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html', 'utf8');
  const i = t.indexOf('const MAGIC_CONFIG = [');
  const j = t.indexOf('\n];', i);
  const block = t.slice(i, j);
  // 逐条按 id 切
  const parts = block.split(/\n  \{\n/).slice(1);
  parts.forEach((p) => {
    const g = (k) => {
      const m = p.match(new RegExp(k + ":\\s*'([^']*)'"));
      return m ? m[1] : '';
    };
    const n = (k) => {
      const m = p.match(new RegExp(k + ':\\s*([-0-9.]+)'));
      return m ? m[1] : '';
    };
    console.log([g('id'), g('name'), g('rarity'), g('tag'), 'cost=' + n('cost'),
      'cd=' + n('cooldown'), 'dmg=' + n('damage'), g('desc').slice(0, 24)].join(' | '));
  });
}
main();
