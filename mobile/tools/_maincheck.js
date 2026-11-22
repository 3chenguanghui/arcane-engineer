const fs=require('fs');
const f='D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html';
const L=fs.readFileSync(f,'utf8').split('\n');
function show(re,label,ctx){console.log('\n### '+label);let n=0;L.forEach((l,i)=>{if(re.test(l)){n++;if(n<=6){for(let k=Math.max(0,i-ctx);k<=Math.min(L.length-1,i+ctx);k++)console.log((k+1)+': '+L[k].slice(0,150));console.log('---');}}});console.log('命中',n,'行');}
show(/id="hudObjective"/,'hudObjective');
show(/#ashBurnBtn\s*\{/,'ashBurnBtn CSS');
show(/\.floor-panel\s*\{[^}]*display:\s*none/,'floor-panel display none（当前主文件）');
show(/#arcm/,'arcm（应无）');
console.log('\n总行数',L.length);
