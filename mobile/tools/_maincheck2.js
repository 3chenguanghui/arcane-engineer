const fs=require('fs');
const f='D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html';
const L=fs.readFileSync(f,'utf8').split('\n');
const pats={
  hudObjective:/id="hudObjective"/,
  ashCSS:/#ashBurnBtn/,
  skillDockCSS:/#btnSkillDock/,
  floorNone:/\.floor-panel[^{]*\{[^}]*display:\s*none/,
  deckCSS:/\.hud-deck/,
  readouts:/\.hud-readouts/
};
for(const k in pats){const hits=[];L.forEach((l,i)=>{if(pats[k].test(l))hits.push(i+1)});console.log(k, hits.join(','));}
const idx=L.findIndex(l=>/id="hudObjective"/.test(l));
console.log('hudObjective 上下文:');
for(let i=idx-4;i<=idx+2;i++)console.log(' '+(i+1)+': '+L[i].trim().slice(0,140));
