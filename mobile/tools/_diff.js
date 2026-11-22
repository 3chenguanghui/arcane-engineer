const fs=require('fs');
const A=fs.readFileSync('D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html','utf8').split('\n');
const B=fs.readFileSync('D:/其他/TRAE宝/奥术工程师/mobile/index_arcane_v2_mobile.html','utf8').split('\n');
// 用 LCS 太重，改用逐行相等锚点粗定位：找出共同前后缀
let p=0; while(p<A.length&&p<B.length&&A[p]===B[p]) p++;
let s=0; while(s<A.length-p&&s<B.length-p&&A[A.length-1-s]===B[B.length-1-s]) s++;
console.log('相同前缀行数 =',p,'（A第'+(p+1)+'行 / B第'+(p+1)+'行开始不同）');
console.log('相同后缀行数 =',s);
console.log('A 差异段行数 =',A.length-p-s,' B 差异段行数 =',B.length-p-s);
console.log('A 差异段起止 =',(p+1),'~',(A.length-s));
console.log('B 差异段起止 =',(p+1),'~',(B.length-s));
console.log('--- A 差异段前3行 ---'); A.slice(p,p+3).forEach((l,i)=>console.log((p+1+i)+': '+l.slice(0,160)));
console.log('--- B 差异段前3行 ---'); B.slice(p,p+3).forEach((l,i)=>console.log((p+1+i)+': '+l.slice(0,160)));
console.log('--- A 差异段后3行 ---'); A.slice(A.length-s-3,A.length-s).forEach((l,i)=>console.log((A.length-s-2+i)+': '+l.slice(0,160)));
console.log('--- B 差异段后3行 ---'); B.slice(B.length-s-3,B.length-s).forEach((l,i)=>console.log((B.length-s-2+i)+': '+l.slice(0,160)));
