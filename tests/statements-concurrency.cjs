const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
function sql(query){return new Promise(resolve=>{const p=spawn('docker',['exec','-i','support-statements-test','psql','-U','postgres','-At','-v','ON_ERROR_STOP=1']);let out='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>out+=x);p.on('close',code=>resolve({code,out}));p.stdin.end(query);});}
(async()=>{
 const preview=await sql("set test.role='DIRECTOR';select preview_statement(1,1,'2026-01-02','2026-01-02')->>'preview_hash';");
 assert.equal(preview.code,0);const hash=preview.out.trim().split('\n').at(-1);
 const query=key=>`begin;set test.role='DIRECTOR';select save_statement(1,1,'2026-01-02','2026-01-02','${hash}','${key}');select pg_sleep(1);commit;`;
 const result=await Promise.all([sql(query('concurrent-1')),sql(query('concurrent-2'))]);
 assert.equal(result.filter(r=>r.code===0).length,1);assert(result.some(r=>r.out.includes('Los datos cambiaron')));
 const count=await sql('select count(*) from statement_operations where operation_id=2 and active;');assert.equal(count.out.trim(),'1');
 console.log('PASS: concurrent generation reserves operation exactly once');
})().catch(e=>{console.error(e);process.exitCode=1});
