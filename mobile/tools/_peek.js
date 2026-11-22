const j=require('D:/其他/TRAE宝/奥术工程师/mobile/shots/fix.json');
for (const k of Object.keys(j.scenarios)) {
  const s=j.scenarios[k];
  console.log('\n===== '+k+' =====');
  console.log('bodyClass:', s.bodyClass);
  console.log('overlaps:', JSON.stringify(s.overlaps));
  console.log('textOverlaps:', JSON.stringify(s.textOverlaps));
  console.log('hudPct', s.hudPct, 'playBand', s.playBand, 'mode', s.mode);
  Object.keys(s.blocks).forEach(n=>{const b=s.blocks[n]; if(b&&b.visible) console.log('  ',n, b.x+','+b.y, b.w+'x'+b.h, JSON.stringify(b.text));});
  if(s.thumb) console.log('thumb:', JSON.stringify(s.thumb));
  if(s.keyboard) console.log('keyboard:', JSON.stringify(s.keyboard).slice(0,300));
  if(s.env) console.log('env:', JSON.stringify(s.env));
}
