const j=require('D:/其他/TRAE宝/奥术工程师/mobile/shots/fix.json');
const C=j.scenarios.C_mobile_moff;
console.log('C overlaps:');
C.overlaps.forEach(o=>console.log(' ',o.a,'×',o.b,o.w+'x'+o.h,'=',o.area));
console.log('C textOverlaps:');
C.textOverlaps.forEach(o=>console.log(' ',JSON.stringify(o.a),'×',JSON.stringify(o.b),o.w+'x'+o.h));
console.log('C blocks(top/minimap/deck/ash/dock):');
['top','minimap','deck','ash','dockMap','dockSkill','floor','readouts','goal','stick'].forEach(k=>{const b=C.blocks[k];console.log(' ',k,b&&b.visible?b.x+','+b.y+' '+b.w+'x'+b.h:'不可见');});
