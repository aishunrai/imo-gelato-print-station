import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLabel, printUrl, requestPrinter, interpretReply, recoverHistory, activeUncertain} from '../public/transport.mjs';
const label = {flavor:'ピスタチオ', staff:'試験 & + = 担当', copies:1, weightG:2000, manufacturedAt:'2026-10-15T05:35:00.000Z'};
test('keeps existing template, paper and exact Unicode field values', () => {
  const url = new URL(printUrl(label));
  assert.equal(url.origin, 'http://localhost:8088'); assert.equal(url.pathname, '/print');
  assert.equal(url.searchParams.get('filename'), 'gelato-label-v3.lbx');
  assert.equal(url.searchParams.get('size'), 'DieCutW62H29');
  assert.equal(url.searchParams.get('text_STAFF'), `担当：${label.staff}`);
  assert.equal(url.searchParams.get('text_FLAVOR'), label.flavor);
  assert.equal(url.searchParams.get('text_MANUFACTURED_AT'), '2026/10/15 14:35');
  assert.equal(url.searchParams.get('text_WEIGHT'), '正味：2000 g');
});

test('Smooth Print percent-only decoding receives spaces and preserves literal plus, ampersand and equals',()=>{
  const query=new URL(printUrl(label)).search.slice(1);
  assert.ok(!query.includes('+'));
  assert.match(query,/%20/);assert.match(query,/%2B/);
  const values=Object.fromEntries(query.split('&').map(pair=>pair.split('=').map(decodeURIComponent)));
  assert.equal(values.text_FLAVOR,label.flavor);
  assert.equal(values.text_STAFF,`担当：${label.staff}`);
  assert.equal(values.text_MANUFACTURED_AT,'2026/10/15 14:35');
  assert.equal(values.text_WEIGHT,'正味：2000 g');
});
test('rejects blank, fractional and out-of-range counts before any print request', () => {
  for (const copies of ['', '1.5', 0, 51, '1abc']) assert.throws(() => validateLabel({...label,copies}));
  assert.throws(() => validateLabel({...label,staff:' '}));
  assert.throws(() => validateLabel({...label,flavor:'未登録'}));
  assert.equal(validateLabel({...label,copies:50}).copies,50);
});
test('sends exactly one readable CORS request without navigation or custom headers', async () => {
  let count=0;
  const r = await requestPrinter('print', label, {fetchImpl:async (url, opts) => {
    count++; assert.equal(new URL(url).pathname,'/print'); assert.equal(opts.mode,'cors');
    assert.equal(opts.targetAddressSpace,'loopback'); assert.equal(opts.headers,undefined);
    return {ok:true,type:'cors',text:async()=>'<response><result>SUCCESS</result></response>'};
  },parseXml:()=>({result:'SUCCESS'})});
  assert.equal(r.result,'SUCCESS'); assert.equal(count,1);
});
test('network, timeout and opaque responses are uncertain and never automatically retried', async () => {
  for (const fetchImpl of [async()=>{throw new TypeError('Failed to fetch');},async()=>({ok:true,type:'opaque'}),async()=>({ok:false})]) {
    let count=0;
    await assert.rejects(requestPrinter('print', label, {fetchImpl:async(...a)=>{count++;return fetchImpl(...a);},parseXml:()=>({result:'SUCCESS'})}),e=>e.uncertain===true);
    assert.equal(count,1);
  }
  await assert.rejects(requestPrinter('print',label,{timeoutMs:5,fetchImpl:(_u,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'})))),parseXml:()=>({result:'SUCCESS'})}),e=>e.uncertain===true);
});
test('requires explicit SUCCESS and reconciles even partial printer failures',()=> {
  for (const reply of [{result:''},{result:'SUCCESS',valid:false},{result:'カバーが開いています',code:'PrinterStatusErrorCoverOpen'},{result:'SUCCESS',code:'ERROR_COMMUNICATION_ERROR'},{result:'Failure'}]) assert.throws(()=>interpretReply(reply,'print'),e=>e.uncertain===true);
  assert.equal(interpretReply({result:'Ready'},'status').result,'Ready');
});
test('status check never calls print and cannot itself print a label',async()=> {
  await requestPrinter('status',null,{fetchImpl:async url=>{assert.equal(new URL(url).pathname,'/getstatus');return {ok:true,text:async()=>'<response/>'};},parseXml:()=>({result:'Ready'})});
});
test('interrupted print stays locked after reload until operator reconciliation',()=> {
  const rows=recoverHistory([{id:'record-1',...label,status:'pending'}, {id:'record-2',...label,status:'success'}]);
  assert.equal(rows[0].status,'unknown'); assert.equal(activeUncertain(rows).id,'record-1');
  rows[0].status='confirmed'; assert.equal(activeUncertain(rows),undefined);
  assert.deepEqual(recoverHistory(null),[]);
});
