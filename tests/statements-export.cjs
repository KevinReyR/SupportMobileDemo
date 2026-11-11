const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { PDFDocument } = require('pdf-lib');
const filename = path.resolve('src/lib/statement-export.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = new Module(filename, module);
mod.paths = module.paths;
mod.require = name => name === 'react-native' ? { Platform: { OS: 'web' } } : require(name);
mod._compile(compiled, filename);
const statement = {
  id:1,client_id:1,number:1,start_date:'2026-01-01',end_date:'2026-01-31',status:'ENVIADA',invoice_number:'FE-123',
  header:{issuer_name:'SUPPORT COLOMBIA',issuer_nit:'900000000-1',client_name:'EMPRESA CON NOMBRE EXTENSO PARA VERIFICAR AJUSTE',city:'Bucaramanga',service_name:'BODEGA'},
  lines:Array.from({length:75},(_,i)=>({operation_id:i+1,date:'2026-01-01',kind:'TURNO',unit:'Medio Nocturno',auxiliaries:2,quantity:2,unit_price:165000,extra_hours:4,extra_price:16500,total:396000,observations:'BODEGA - Medio Nocturno'})),
  subtotal:29700000,vat:5643000,total:35343000,
};
(async()=>{
  assert.equal(mod.exports.statementServiceLabel('MUELLE'),'AUXILIAR MUELLE');
  assert.equal(mod.exports.statementServiceLabel('AUXILIAR MUELLE'),'AUXILIAR MUELLE');
  assert.equal(mod.exports.statementFileName(statement,'pdf'),'Acta_1_EMPRESA_CON_NOMBRE_EXTENSO_PARA_VERIFICAR_AJUSTE_AUXILIAR_BODEGA2026-01-012026-01-31.pdf');
  assert.equal(mod.exports.statementFileName({...statement,header:{...statement.header,client_name:'Cliente / Norte',service_name:'Turno: Noche'}},'xlsx'),'Acta_1_Cliente_Norte_AUXILIAR_Turno_Noche2026-01-012026-01-31.xlsx');
  const signature=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
  const bytes=await mod.exports.statementPdf(statement,{name:'Gerente de Prueba',imageBytes:signature,imageType:'png'});
  const pdf=await PDFDocument.load(bytes);assert(pdf.getPageCount()>1);
  const size=pdf.getPage(0).getSize();assert(Math.abs(size.width-595.28)<.01);assert(Math.abs(size.height-841.89)<.01);
  assert.equal(mod.exports.statementRows(statement).length,75);
  fs.mkdirSync('tmp/statement-qa',{recursive:true});fs.writeFileSync('tmp/statement-qa/acta-demo.pdf',bytes);
  let blob;
  const old=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return 'blob:test'};
  global.document={createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}};
  const oldTimeout=global.setTimeout;global.setTimeout=()=>0;
  try{await mod.exports.exportStatement(statement,'xlsx');}finally{URL.createObjectURL=old;global.setTimeout=oldTimeout;}
  const ExcelJS=require('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.load(await blob.arrayBuffer());
  assert.equal(book.worksheets[0].getCell('J8').value,396000);assert.equal(book.worksheets[0].getCell('B85').value,35343000);
  fs.writeFileSync('tmp/statement-qa/acta-demo.xlsx',Buffer.from(await blob.arrayBuffer()));
  console.log('PASS: multi-page PDF, complete rows, numeric Excel, exact totals');
})().catch(e=>{console.error(e);process.exitCode=1});
