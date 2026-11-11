// Run with esbuild and playwright-core installed in TEMP/support-policy-qa.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {build}=require(path.join(process.env.TEMP,'support-policy-qa/node_modules/esbuild'));
const {chromium}=require(path.join(process.env.TEMP,'support-policy-qa/node_modules/playwright-core'));
(async()=>{
 const root=process.cwd(),out=path.join(root,'tmp/statement-qa/ui.js');fs.mkdirSync(path.dirname(out),{recursive:true});
 await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Screen from './src/components/service-statements';function Calendar(){return null}createRoot(document.getElementById('root')).render(<Screen Calendar={Calendar}/>);`,resolveDir:root,loader:'tsx'},outfile:out,bundle:true,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"','__DEV__':'false'},alias:{'react-native':'react-native-web'},external:['expo-file-system','expo-sharing'],plugins:[{name:'test-rpc',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'rpc',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const supabase={rpc:async(name,args)=>{const response=await fetch('/rpc/'+name,{method:'POST',body:JSON.stringify(args)});return {data:await response.json(),error:null};}};`,loader:'js'}));}}]});
 let saved=null;const requests=[];
 const preview={header:{issuer_name:'SUPPORT COLOMBIA',issuer_nit:'900-1',client_name:'EMPRESA DEMO',service_name:'BODEGA',city:'Bucaramanga'},lines:[{operation_id:1,date:'2026-11-01',kind:'TURNO',unit:'Diurno',auxiliaries:2,quantity:2,unit_price:100,extra_hours:2,extra_price:10,total:220,observations:'BODEGA - Diurno'}],subtotal:220,vat:41.8,total:261.8,preview_hash:'test',excluded:[]};
 const server=http.createServer(async(req,res)=>{if(req.url.startsWith('/rpc/')){let body='';for await(const c of req)body+=c;const a=JSON.parse(body||'{}');const rpc=req.url.split('/').at(-1);requests.push(rpc);let response;
 if(rpc==='statement_settings')response={issuer:{legal_name:'SUPPORT',nit:'900-1'},clients:[{id:1,name:'EMPRESA DEMO',city:'Bucaramanga',next_number:1}],areas:[{id:1,client_id:1,name:'BODEGA'}]};
 else if(rpc==='list_statements')response=saved?[saved]:[];
 else if(rpc==='preview_statement')response=preview;
 else if(rpc==='save_statement'){saved={...preview,id:1,number:1,client_id:1,area_id:1,start_date:a.p_start_date,end_date:a.p_end_date,status:'GENERADA',updated_at:new Date().toISOString(),invoice_number:null,sent_date:null,paid_date:null,days_since_sent:null,audit:[]};response=saved;}
 else if(rpc==='transition_statement'){saved={...saved,status:a.p_action==='ENVIAR'?'ENVIADA':a.p_action==='PAGAR'?'PAGADA':saved.status,invoice_number:a.p_invoice||null,updated_at:new Date().toISOString()};response=saved;}
 else response=saved;
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));return;}
 res.setHeader('Content-Type',req.url==='/ui.js'?'text/javascript':'text/html');res.end(req.url==='/ui.js'?fs.readFileSync(out):'<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root" style="height:100vh"></div><script src="/ui.js"></script></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({channel:'msedge'});const p=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});await p.goto('http://127.0.0.1:'+server.address().port);await p.getByRole('button',{name:'Generar acta',exact:true}).click();
 await p.getByRole('button',{name:'Selecciona cliente',exact:true}).click();await p.getByRole('button',{name:'EMPRESA DEMO',exact:true}).click();await p.getByRole('button',{name:'Selecciona servicio',exact:true}).click();await p.getByRole('button',{name:'BODEGA',exact:true}).click();
 await p.getByRole('button',{name:'Vista previa',exact:true}).click();await p.getByText('PLANILLA DE SERVICIOS',{exact:true}).waitFor();await p.getByRole('button',{name:'Confirmar generacion',exact:true}).click();await p.getByRole('button',{name:'Confirmar',exact:true}).click();await p.getByRole('button',{name:'Registrar envio manual',exact:true}).waitFor();
 await p.screenshot({path:'tmp/statement-qa/mobile.png',fullPage:true});await p.getByRole('button',{name:'Registrar envio manual',exact:true}).click();await p.getByRole('button',{name:'Confirmar',exact:true}).click();await p.getByRole('textbox',{name:'Numero de factura',exact:true}).fill('FE-1');await p.getByRole('button',{name:'Registrar pago completo',exact:true}).click();await p.getByRole('button',{name:'Confirmar',exact:true}).click();await p.getByText('Acta #1 · PAGADA',{exact:true}).waitFor();
 assert.equal(saved.status,'PAGADA');assert.equal(saved.invoice_number,'FE-1');assert.equal(requests.filter(x=>x==='save_statement').length,1);
 await p.setViewportSize({width:1280,height:900});await p.screenshot({path:'tmp/statement-qa/desktop.png',fullPage:true});console.log('PASS: mobile/web selectors, preview, generation, send, invoice and payment');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
