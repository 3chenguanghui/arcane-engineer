/**
 * 锚点唯一性校验：统计每个补丁锚点在主文件中的命中次数（必须 = 1）
 * 用法：node tools/_anchor_check.js
 * @returns {void}
 */
function main() {
  const fs = require('fs');
  const P = 'D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html';
  const t = fs.readFileSync(P, 'utf8');
  console.log('bytes', t.length, 'crlf', t.split('\r\n').length, 'lf', t.split('\n').length);
  const A = {
    A1: "    desc: '以自身为中心炸开冰霜环，命中敌人并减速。'\n  }\n];",
    A2: "  frostRing: { shape: 'selfring', radius: 140, slow: 1.6, damageMul: 1 }\n};",
    A3: "  else if (magic.id === 'frostRing') castFrostRing(magic, fusion);\n  else castHeal(magic, fusion);",
    A4: "/**\n * 生成一个持续区域（奥术雷池 / 熔雷带 / 坍缩 / 霜焰延迟爆）",
    A5: "    MAGIC_CONFIG.forEach((magic) => {\n      if (state.ownedMagic.includes(magic.id)) return;",
    A6: "  if (magic.id === 'bolt' && !findNearestEnemy(state.player.x, state.player.y, 520)) {",
    A7: 'player.invuln',
    A11: "const REWARD_ICON_MAP = {\n  /* 魔法 */\n  'magic:fireball': 'i-flame',",
    A8: 'function findNearestEnemy',
    A9: 'function applyExplosion',
    A10: 'function floorHealAmount'
  };
  Object.keys(A).forEach((k) => {
    console.log(k, t.split(A[k]).length - 1);
  });
}
main();
