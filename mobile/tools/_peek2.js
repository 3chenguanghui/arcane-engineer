const j=require('D:/其他/TRAE宝/奥术工程师/mobile/shots/fix.json');
const A=j.scenarios.A_mobile_touch, B=j.scenarios.B_desktop, C=j.scenarios.C_mobile_moff;
console.log('A targets:'); A.targets.forEach(t=>console.log('  ',t.name,t.w+'x'+t.h,'min='+t.min));
console.log('A thumb:',JSON.stringify(A.thumb));
console.log('B overlaps:',JSON.stringify(B.overlaps));
console.log('B blocks:'); Object.keys(B.blocks).forEach(n=>{const b=B.blocks[n]; if(b&&b.visible) console.log('  ',n,b.x+','+b.y,b.w+'x'+b.h);});
console.log('C textOverlaps:',JSON.stringify(C.textOverlaps));
console.log('C overlaps:',JSON.stringify(C.overlaps));
