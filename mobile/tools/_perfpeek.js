const fs=require('fs');
const dir='D:/其他/TRAE宝/奥术工程师/mobile/shots/';
['perf.json','perf2.json','perf1.json'].forEach(f=>{
  const p=dir+f;
  if(!fs.existsSync(p)) { console.log(f,'不存在'); return; }
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  console.log('\n==== '+f+' ====');
  console.log(JSON.stringify(j).slice(0,3000));
});
