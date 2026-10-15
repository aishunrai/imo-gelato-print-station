import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const source=await readFile(new URL('../../../apps-script/Code.gs',import.meta.url),'utf8');
const key='a'.repeat(64),id='00000000-0000-4000-8000-000000000001';
function fixture(){
 let rows=[],opens=0,releases=0,locked=true;
 const guide={getRange:()=>({setValues(){return this;},setNumberFormat(){return this;}})};
 const sheet={getLastRow:()=>rows.length,getMaxRows:()=>1000,getRange:(r,c,n=1,m=1)=>({getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r+i-1]?.[c+j-1]??'')),setNumberFormats(){return this;},setValues(v){for(let i=0;i<v.length;i++){rows[r+i-1]??=[];for(let j=0;j<v[i].length;j++)rows[r+i-1][c+j-1]=v[i][j];}return this;}})};
 const context=vm.createContext({Utilities:{DigestAlgorithm:{SHA_256:'sha'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()]},PropertiesService:{getScriptProperties:()=>({getProperty:()=>createHash('sha256').update(key).digest('hex')})},SpreadsheetApp:{openById:()=>{opens++;return {getSheetByName:name=>name==='印刷ログ'?sheet:guide};},flush(){}},LockService:{getScriptLock:()=>({tryLock:()=>locked,releaseLock:()=>releases++})},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}});
 vm.runInContext(source,context);rows.push([...context.LOG_HEADERS]);
 const send=(record,extra={})=>context.doPost({postData:{contents:JSON.stringify({protocol:'imo-print-logs/v1',spreadsheetId:context.LOG_SPREADSHEET_ID,requestId:'rq',key,action:'upsert',record,...extra})}});
 return {rows,send,opens:()=>opens,releases:()=>releases,unlock:()=>locked=false};
}
const record=()=>({id,manufactured_at:'2026-10-15T01:00:00.000Z',last_attempt_at:'2026-10-15T01:00:00.000Z',flavor:'ミルク',staff:'=1+1',weight_g:2050,copies:1,weight_source:'manual',weight_rule:{baseWeightG:2000,upperTolerancePercent:5},print_status:'success',attempts:1,detail:'',client_revision:1});
test('receiver writes typed dates/numbers, escapes formulas, and maps all 15 columns',()=>{const f=fixture();assert.equal(f.send(record()).ok,true);assert.equal(f.rows.length,2);assert.equal(f.rows[1][0].toISOString(),record().manufactured_at);assert.equal(f.rows[1][2],"'=1+1");assert.equal(f.rows[1][3],2050);assert.equal(f.rows[1][6],id);assert.equal(f.rows[1][14],1);assert.equal(f.releases(),1);});
test('receiver updates same UUID, ignores stale versions and retains original label fields',()=>{const f=fixture(),r=record();f.send(r);f.send({...r,client_revision:2,print_status:'confirmed',weight_g:2100});f.send(r);assert.equal(f.rows.length,2);assert.equal(f.rows[1][3],2050);assert.equal(f.rows[1][5],'confirmed');assert.equal(f.rows[1][14],2);});
test('literal formula text read back from Sheets stays escaped during later updates',()=>{const f=fixture(),r=record();f.send(r);f.rows[1][2]='=1+1';f.send({...r,client_revision:2});assert.equal(f.rows[1][2],"'=1+1");});
test('invalid key cannot open the sheet; malformed records, changed headers and lock contention do not write',()=>{
 const f=fixture();assert.equal(f.send(record(),{key:'b'.repeat(64)}).code,'AUTH');assert.equal(f.opens(),0);assert.equal(f.send({...record(),weight_g:0}).code,'VALIDATION');
 f.unlock();assert.equal(f.send(record()).code,'BUSY');assert.equal(f.rows.length,1);
 const g=fixture();g.rows[0][0]='changed';assert.equal(g.send(record()).code,'HEADERS');assert.equal(g.rows.length,1);
});
