const fs=require('fs');
const L=fs.readFileSync('D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html','utf8').split('\n');
const pats={
  'function castSlot':/function castSlot/,
  'function handleKeyDown':/function handleKeyDown/,
  'function handleKeyUp':/function handleKeyUp/,
  'function touchAxisStrength':/function touchAxisStrength/,
  'function touchMoveVector':/function touchMoveVector/,
  'function applyTouchUi':/function applyTouchUi/,
  'function updateContextHints':/function updateContextHints/,
  '.hud-top CSS':/^\s*\.hud-top\s*\{/,
  '.hud-deck CSS':/^\s*\.hud-deck\s*\{/,
  '.minimap-panel CSS':/^\s*\.minimap-panel\s*\{/,
  '.floor-panel display none':/\.floor-panel[^{]*\{[^}]*display:\s*none/,
  '.hud-readouts CSS':/^\s*\.hud-readouts\s*\{/
};
for(const k in pats){const h=[];L.forEach((l,i)=>{if(pats[k].test(l))h.push(i+1)});console.log(k,'=>',h.join(','));}
