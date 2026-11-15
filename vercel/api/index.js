const fs=require("fs"),path=require("path");
const code=["p1","p2","p3","p4","p5","p6"].map(n=>fs.readFileSync(path.join(process.cwd(),"parts",n+".txt"),"utf8")).join("");
const m={exports:{}};
new Function("require","module","exports","__dirname","__filename",code)(require,m,m.exports,__dirname,__filename);
module.exports=m.exports;
