const fs=require('fs');
const L=fs.readFileSync('D:/其他/TRAE宝/奥术工程师/mobile/index_arcane_v2_mobile.html','utf8').split('\n');
for(let i=70400;i<70780;i++){
  const l=L[i];
  if(/window\.|__|const .*=\s*\{|function /.test(l) && /(debug|Debug|arcane|ARCANE|__)/.test(l)) console.log((i+1)+': '+l.trim().slice(0,160));
}
