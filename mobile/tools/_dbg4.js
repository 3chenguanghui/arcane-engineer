const fs=require('fs');
const L=fs.readFileSync('D:/其他/TRAE宝/奥术工程师/mobile/index_arcane_v2_mobile.html','utf8').split('\n');
for(let i=64000;i<70610;i++){
  const l=L[i]||'';
  if(/^\s*(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\{\s*$/.test(l) || /window\.[A-Za-z_$][\w$]*\s*=/.test(l)) console.log((i+1)+': '+l.trim().slice(0,140));
}
