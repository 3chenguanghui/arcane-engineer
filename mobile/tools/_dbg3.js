const fs=require('fs');
const L=fs.readFileSync('D:/其他/TRAE宝/奥术工程师/mobile/index_arcane_v2_mobile.html','utf8').split('\n');
for(let i=70900;i>70400;i--){
  const l=L[i]||'';
  if(/=\s*\{\s*$/.test(l) || /window\./.test(l)) console.log((i+1)+': '+l.trim().slice(0,180));
}
