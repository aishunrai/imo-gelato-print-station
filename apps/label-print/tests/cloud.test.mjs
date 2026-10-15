import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudClient,createLogSync,markLogChanged,prepareSheetLogs,logSyncView} from '../public/cloud.mjs';
const config={spreadsheetId:'test-sheet'}, project='google-sheets:test-sheet';
const endpoint='https://script.google.com/macros/s/test-deployment/exec', key='a'.repeat(64);
const when='2026-10-15T00:00:00.000Z';
function record(id='record-1') {const r={id,flavor:'ミルク',staff:'担当',weightG:2050,copies:1,manufacturedAt:when,lastAttemptAt:when,weightSource:'manual',weightRule:{baseWeightG:2000,upperTolerancePercent:5},status:'success',attempts:1,detail:''};markLogChanged(r,project);return r;}
const store=()=>{const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};};
test('simple CORS POST keeps key out of URL; only a matching receipt is success',async()=>{
 const calls=[],client=createCloudClient(config,{requestId:()=> 'request-1',fetchImpl:async(url,options)=>{
  calls.push({url,options});const e=JSON.parse(options.body);return {ok:true,type:'cors',json:async()=>({ok:true,protocol:e.protocol,requestId:e.requestId,spreadsheetId:e.spreadsheetId,id:e.record.id,revision:e.record.client_revision})};
 }});
 client.configure(endpoint,key);await client.upsert({id:'record-1',client_revision:1});
 assert.equal(calls[0].url,endpoint);assert.equal(calls[0].options.mode,'cors');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.headers['Content-Type'],'text/plain;charset=utf-8');
 assert.equal(JSON.parse(calls[0].options.body).key,key);
});
test('wrong key, wrong destination, stale receipt and opaque responses remain failures',async()=>{
 for(const reply of [{ok:false,code:'AUTH'},{ok:true,spreadsheetId:'other'},{ok:true,id:'other',revision:1},{ok:true,id:'r',revision:0}]) {
  const client=createCloudClient(config,{requestId:()=> 'rq',fetchImpl:async()=>({ok:true,type:'cors',json:async()=>({protocol:'imo-print-logs/v1',requestId:'rq',spreadsheetId:'test-sheet',...reply})})});
  client.configure(endpoint,key);await assert.rejects(client.upsert({id:'r',client_revision:1}));
 }
 const client=createCloudClient(config,{fetchImpl:async()=>({ok:true,type:'opaque'})});client.configure(endpoint,key);await assert.rejects(client.check());
});
test('settings persist only in selected storage, and disconnect removes both',()=>{
 const sessionStore=store(),persistentStore=store();const client=createCloudClient(config,{sessionStore,persistentStore});
 client.configure(endpoint,key);assert.equal(sessionStore.m.size,1);assert.equal(persistentStore.m.size,0);
 client.configure(endpoint,key,true);assert.equal(sessionStore.m.size,0);assert.equal(persistentStore.m.size,1);
 assert.equal(createCloudClient(config,{sessionStore,persistentStore}).ready(),true);
 assert.throws(()=>client.configure('https://example.com/exec',key));client.disconnect();assert.equal(persistentStore.m.size,0);
});
test('complete Supabase-era local logs migrate once with their UUID and metadata preserved',()=>{
 const r=record();delete r.sheets;r.cloud={project:'old',revision:2,syncedRevision:0};const legacy={...r,id:'legacy',weightG:null};
 assert.equal(prepareSheetLogs([r,legacy],project),true);assert.equal(r.id,'record-1');assert.equal(r.cloud.project,'old');
 assert.equal(r.sheets.syncedRevision,0);assert.equal(prepareSheetLogs([r],project),false);assert.equal(logSyncView(legacy,project),'端末内のみ（旧形式）');
});
test('lost acknowledgment retries the same UUID and never prints',async()=>{
 const r=record(),calls=[];let fail=true;
 const q=createLogSync({client:{project,ready:()=>true,upsert:async p=>{calls.push(p);if(fail)throw Error('Lost reply');}},rows:()=>[r],persist:()=>true});
 await q.flush();assert.equal(r.sheets.syncedRevision,0);fail=false;await q.flush();assert.equal(calls[0].id,calls[1].id);assert.equal(r.sheets.syncedRevision,1);
});
test('in-flight result only acknowledges the sent revision; concurrent flushes coalesce',async()=>{
 const r=record();let release;const calls=[];
 const q=createLogSync({client:{project,ready:()=>true,upsert:async p=>{calls.push(p);await new Promise(resolve=>release=resolve);}},rows:()=>[r],persist:()=>true});
 const first=q.flush();assert.equal(q.flush(),first);r.status='confirmed';markLogChanged(r,project);release();await first;
 assert.equal(r.sheets.syncedRevision,1);assert.equal(r.sheets.revision,2);const second=q.flush();release();await second;assert.equal(calls[1].print_status,'confirmed');
});
test('not configured, demo/printing and pending records cannot send',async()=>{
 const r=record();let configured=false,allowed=true,calls=0;
 const q=createLogSync({client:{project,ready:()=>configured,upsert:async()=>calls++},rows:()=>[r],persist:()=>true,canRun:()=>allowed});
 await q.flush();configured=true;allowed=false;await q.flush();allowed=true;r.status='pending';await q.flush();assert.equal(calls,0);
 r.status='unknown';await q.flush();assert.equal(calls,1);
});
