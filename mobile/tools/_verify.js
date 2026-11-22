const fs=require('fs'),crypto=require('crypto');
const D='D:/其他/TRAE宝/奥术工程师/delivery/烬-奥术工程师-试玩版.html';
const C='D:/其他/TRAE宝/奥术工程师/mobile/index_arcane_v2_mobile.html';
const d=fs.readFileSync(D,'utf8'), c=fs.readFileSync(C,'utf8');
const md5=(s)=>crypto.createHash('md5').update(s).digest('hex').toUpperCase();
console.log('delivery bytes',Buffer.byteLength(d),'md5',md5(d));
console.log('copy     bytes',Buffer.byteLength(c),'md5',md5(c));
// 找出 copy 中不属于 delivery 的插入段：用最长公共前后缀
let p=0; while(p<d.length&&p<c.length&&d[p]===c[p]) p++;
let s=0; while(s<d.length-p&&s<c.length-p&&d[d.length-1-s]===c[c.length-1-s]) s++;
console.log('公共前缀(字符)',p,' line',d.slice(0,p).split('\n').length);
console.log('公共后缀(字符)',s);
console.log('delivery 中段长度',d.length-p-s,' copy 中段长度',c.length-p-s);
console.log('插入段所在行(副本):',c.slice(0,p).split('\n').length);
console.log('--- delivery 中段 ---'); console.log(JSON.stringify(d.slice(p,Math.min(p+120,d.length-s))));
console.log('--- copy 中段头 ---'); console.log(JSON.stringify(c.slice(p,Math.min(p+200,c.length-s))));
console.log('--- copy 中段尾 ---'); console.log(JSON.stringify(c.slice(c.length-s-120,c.length-s)));
console.log('--- delivery 中段尾 ---'); console.log(JSON.stringify(d.slice(d.length-s-120,d.length-s)));
// 插入段是否自包含（以 <style id="arcm-style"> 开头）
const ins=c.slice(p,c.length-s);
console.log('插入段长度',ins.length,'startsWith',JSON.stringify(ins.slice(0,60)),'endsWith',JSON.stringify(ins.slice(-60)));
