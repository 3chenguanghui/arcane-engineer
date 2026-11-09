/**
 * 汇总对照：基线 vs 扩容臂（bot / mix 两个 profile）
 * 用法：node tools/_pool_report.js
 * @returns {void}
 */
function main() {
  const fs = require('fs');
  const dir = 'D:/其他/TRAE宝/奥术工程师/tools/sim_panel/';
  const pairs = [
    ['bot', 'probe_basepool_bot.json', 'probe_skillpool_bot_only_pulseShock-pierceLance-skyfall-hammer-brand.json'],
    ['mix', 'probe_basepool_mix.json', 'probe_skillpool_mix_only_pulseShock-pierceLance-skyfall-hammer-brand.json']
  ];
  pairs.forEach((p) => {
    const b = JSON.parse(fs.readFileSync(dir + p[1], 'utf8'));
    const n = JSON.parse(fs.readFileSync(dir + p[2], 'utf8'));
    console.log('==== profile ' + p[0] + ' ====');
    Object.keys(n.scenarios).forEach((k) => {
      const s = n.scenarios[k];
      const t = b.scenarios[k];
      console.log('[' + k + ']');
      console.log('  10层 ' + t.pass10Pct + '% -> ' + s.pass10Pct + '%   通关 ' + t.clear20Pct + '% -> ' + s.clear20Pct + '%');
      console.log('  F1-3 P50 基线 ' + [1, 2, 3].map((i) => t.floors[i].time.p50).join('/')
        + '  扩容 ' + [1, 2, 3].map((i) => s.floors[i].time.p50).join('/'));
      console.log('  全层 P50 基线 ' + Array.from({ length: 20 }, (_, i) => t.floors[i + 1].time.p50).join(','));
      console.log('  全层 P50 扩容 ' + Array.from({ length: 20 }, (_, i) => s.floors[i + 1].time.p50).join(','));
      console.log('  凹点 基线 ' + (t.concavity || []).length + ' : ' + (t.concavity || []).map((h) => 'F' + h.from + '→F' + h.to + '=' + h.diff).join(' | '));
      console.log('  凹点 扩容 ' + (s.concavity || []).length + ' : ' + (s.concavity || []).map((h) => 'F' + h.from + '→F' + h.to + '=' + h.diff).join(' | '));
    });
  });
}
main();
