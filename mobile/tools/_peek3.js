const j=require('D:/其他/TRAE宝/奥术工程师/mobile/shots/fix.json');
const D=j.scenarios.D_mobile_notouch, A=j.scenarios.A_mobile_touch, B=j.scenarios.B_desktop;
console.log('D ctx:', JSON.stringify(D.blocks.ctx&&D.blocks.ctx.text));
console.log('D goal:', JSON.stringify(D.blocks.goal&&D.blocks.goal.text), 'minimap', !!D.blocks.minimap.visible);
console.log('A ctx:', JSON.stringify(A.blocks.ctx&&A.blocks.ctx.text));
console.log('A thumb:', JSON.stringify(A.thumb));
console.log('A targets min:', A.targetMin, 'tooSmall', A.targetTooSmall);
console.log('B overlaps:', JSON.stringify(B.overlaps));
