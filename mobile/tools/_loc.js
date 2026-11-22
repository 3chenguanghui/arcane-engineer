const fs=require('fs');
const f='D:/其他/TRAE宝/奥术工程师/mobile/index_arcane_v2_mobile.html';
const s=fs.readFileSync(f,'utf8');
function loc(sub){let i=s.indexOf(sub);return i<0?'NOT FOUND':(i+' / line '+s.slice(0,i).split('\n').length);}
[['arcm-style'],['id="arcmStick"'],['window.__arcm'],['id="arcmPad"'],['id="arcmGoal"']].forEach(([k])=>console.log(k,'=>',loc(k)));
console.log('total lines',s.split('\n').length);
