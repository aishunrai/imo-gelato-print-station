import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as transport from '../public/transport.mjs';
import * as connection from '../public/connection.mjs';
import * as production from '../public/production.mjs';
import {WEIGHT_RULE} from '../public/config.mjs';
import {CLOUD_CONFIG} from '../public/cloud-config.mjs';
import * as cloud from '../public/cloud.mjs';

const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const bundle = await readFile(new URL('../public/app.bundle.js', import.meta.url), 'utf8');
const success = '<response><result>SUCCESS</result></response>';

// Minimal DOM/response fixtures: execute the actual app handlers, not copies of them.
function setup(fetchImpl, {bundled = false, cloudSession = null, initialRows = null} = {}) {
  const downloads = []; let exportedBlob;
  class Element {
    value = ''; textContent = ''; hidden = false; disabled = false;
    children = []; dataset = {}; listeners = {};
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click() { downloads.push(this); }
  }
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id]) => [id, new Element()]));
  elements.set('result-icon', new Element());
  const get = id => { assert.ok(elements.has(id), `Missing HTML id: ${id}`); return elements.get(id); };
  get('copies').value = '1';
  const documentListeners = {};
  const document = {
    visibilityState: 'visible',
    getElementById: get,
    querySelector: selector => { assert.equal(selector, '.result-icon'); return get('result-icon'); },
    querySelectorAll: () => [],
    createElement: () => new Element(),
    addEventListener: (name, callback) => { documentListeners[name] = callback; },
  };
  class FixtureDOMParser {
    parseFromString(raw) {
      const valid = /^<response>[\s\S]*<\/response>$/.test(raw);
      return {
        documentElement: {localName: valid ? 'response' : 'parsererror'},
        querySelector: tag => tag === 'parsererror' ? (valid ? null : {})
          : raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.slice(1).map(textContent => ({textContent}))[0] || null,
      };
    }
  }
  const storage = new Map();
  if (initialRows) storage.set('imo-print-station-v1:history',JSON.stringify(initialRows));
  const sessions = new Map();
  if (cloudSession) sessions.set(`imo-sheets-connection:${CLOUD_CONFIG.spreadsheetId}`,JSON.stringify({endpoint:'https://script.google.com/macros/s/test-deployment/exec',key:'a'.repeat(64)}));
  class ExportURL extends URL {
    static createObjectURL(blob) { exportedBlob = blob; return 'blob:test'; }
    static revokeObjectURL() {}
  }
  let nextRecordId = 0;
  const context = vm.createContext({
    ...transport, ...connection, ...production, ...cloud, WEIGHT_RULE, CLOUD_CONFIG, document, navigator: {userAgent: 'Android'},
    window: {addEventListener() {},sessionStorage:{getItem:k=>sessions.get(k),setItem:(k,v)=>sessions.set(k,v),removeItem:k=>sessions.delete(k)}}, localStorage: {setItem:(k,v)=>storage.set(k,v), getItem:k=>storage.get(k) || null,removeItem:k=>storage.delete(k)},
    DOMParser: FixtureDOMParser, crypto: {randomUUID: () => `test-record-${++nextRecordId}`}, fetch:fetchImpl,
    setTimeout:(fn,ms)=>ms===5000 ? 0 : setTimeout(fn,ms), setInterval:()=>0, clearTimeout, URL:ExportURL, URLSearchParams, Blob, Intl, Date, AbortController,
    // requestPrinter lives in the real module and receives this fetch explicitly below.
    requestPrinter: (operation, label, options) => transport.requestPrinter(operation, label, {...options, fetchImpl}),
  });
  vm.runInContext(bundled ? bundle : source.replace(/^import .*;\r?\n/gm, ''), context);
  return {
    get,
    click: id => get(id).listeners.click(),
    print: () => get('label-form').listeners.submit({preventDefault(){}}),
    fill: () => { get('flavor').value='ピスタチオ'; get('staff').value='製造担当'; get('weight').value='2000'; },
    visibility: async state => { document.visibilityState=state; await documentListeners.visibilitychange(); },
    rows: () => JSON.parse(storage.get('imo-print-station-v1:history')),
    input: id => get(id).listeners.input(),
    history: () => get('history-list').children,
    exportFile: async () => { get('export-button').listeners.click(); return {filename:downloads.at(-1).download, text:await exportedBlob.text()}; },
  };
}
function reply(raw = success) { return {ok:true, type:'cors', text:async()=>raw}; }

test('classic browser bundle runs the actual weight/print flow without ES module loading', async () => {
  const requests = [];
  const app = setup(async url => { requests.push(new URL(url)); return reply(); }, {bundled:true});
  app.fill(); app.get('weight').value='2050'; await app.print();
  assert.equal(requests.length,1);
  assert.equal(requests[0].searchParams.get('text_FLAVOR'),'ピスタチオ');
  assert.equal(requests[0].searchParams.get('text_WEIGHT'),'正味 2050 g');
  assert.equal(app.rows()[0].status,'success');
});

test('actual print handler fixes a stale failed connection display and sends exactly one print', async () => {
  const requests = [];
  const app = setup(async url => {
    const route = new URL(url).pathname; requests.push(route);
    if (route === '/getstatus') throw new TypeError('Failed to fetch');
    return reply();
  });
  await app.click('check-button');
  assert.equal(app.get('connection-title').textContent, '状態を確認できません');
  app.fill(); await app.print();
  assert.equal(app.get('connection-title').textContent, '印刷応答を確認しました');
  assert.equal(app.get('printer-chip').dataset.state, 'confirmed');
  assert.equal(app.rows()[0].status, 'success');
  assert.deepEqual(requests, ['/getstatus','/print']);
});
test('returning from Smooth Print checks only status and does not lose prior print evidence on failure', async () => {
  const requests = [];
  const app = setup(async url => {
    const route = new URL(url).pathname; requests.push(route);
    if (route === '/getstatus') throw new TypeError('Failed to fetch');
    return reply();
  });
  app.fill(); await app.print();
  await app.visibility('hidden');
  assert.equal(app.get('printer-chip').dataset.state, 'unverified');
  await app.visibility('visible');
  assert.equal(app.get('printer-chip').dataset.state, 'unknown');
  assert.match(app.get('connection-detail').textContent, /前回の応答確認/);
  assert.equal(app.rows()[0].status, 'success');
  assert.deepEqual(requests, ['/print','/getstatus']);
});
test('demo does not contact the printer or overwrite actual connection evidence', async () => {
  let count = 0;
  const app = setup(async () => { count++; return reply(); });
  await app.click('check-button');
  await app.click('demo-toggle');
  app.fill(); await app.print();
  await app.click('check-button');
  await app.visibility('hidden'); await app.visibility('visible');
  assert.equal(count, 1);
  assert.equal(app.get('connection-card').dataset.state, 'demo');
  await app.click('demo-toggle');
  assert.equal(app.get('printer-chip').dataset.state, 'unverified');
  assert.deepEqual(app.rows(), []);
});
test('printer errors update the card while leaving uncertain print locked against duplicate submission', async () => {
  let count = 0;
  const app = setup(async () => {
    count++;
    return reply('<response><result>用紙切れ</result><code>PrinterStatusErrorNoPaper</code></response>');
  });
  app.fill(); await app.print();
  assert.equal(app.get('connection-card').dataset.state, 'warning');
  assert.match(app.get('connection-detail').textContent, /用紙/);
  assert.equal(app.rows()[0].status, 'unknown');
  assert.equal(app.get('print-button').disabled, true);
  await app.print();
  assert.equal(count, 1);
});

test('out-of-range or invalid manual weight cannot be saved or sent even by direct submit', async () => {
  let count = 0;
  const app = setup(async () => { count++; return reply(); });
  app.fill();
  for (const weight of ['', '1999', '2101', '-2000', '2000.5', '2e3']) {
    app.get('weight').value = weight; app.input('weight');
    assert.equal(app.get('print-button').disabled, true);
    await app.print();
  }
  assert.equal(count, 0); assert.deepEqual(app.rows(), []);
  app.get('weight').value = '2100'; app.input('weight');
  assert.equal(app.get('print-button').disabled, false);
  await app.print();
  assert.equal(count, 1);
  assert.equal(app.rows()[0].weightG, 2100);
});

test('a single frozen timestamp and weight are used in print, history and preview; next weight is blank', async () => {
  let printed;
  const app = setup(async url => { printed = new URL(url); return reply(); });
  app.fill(); app.get('weight').value = '2050'; await app.print();
  const row = app.rows()[0];
  assert.equal(row.weightG, 2050); assert.equal(row.weightSource, 'manual');
  assert.deepEqual(row.weightRule, {baseWeightG:2000,upperTolerancePercent:5});
  assert.equal(row.judgment, 'pass');
  assert.equal(row.manufacturedAt, row.createdAt);
  assert.equal(printed.searchParams.get('text_MANUFACTURED_AT'), `製造 ${production.formatManufacturedAt(row.manufacturedAt)}`);
  assert.equal(printed.searchParams.get('text_WEIGHT'), '正味 2050 g');
  assert.equal(app.get('preview-manufactured-at').textContent, production.formatManufacturedAt(row.manufacturedAt));
  assert.equal(app.get('weight').value, '');
  assert.equal(app.get('print-button').disabled, true);
});

test('operator-confirmed missing print retries the same timestamp and weight rather than new form values', async () => {
  const requests = [];
  const app = setup(async url => {
    requests.push(new URL(url));
    if (requests.length === 1) throw new TypeError('Lost response');
    return reply();
  });
  app.fill(); app.get('weight').value = '2090'; await app.print();
  const original = app.rows()[0];
  await app.click('confirm-not-printed');
  app.get('weight').value = '2000';
  const retry = app.history()[0].children[1].children.find(node => node.textContent === '同じ内容を再発行');
  await retry.listeners.click();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].href, requests[1].href);
  assert.equal(app.rows()[0].id, original.id);
  assert.equal(app.rows()[0].manufacturedAt, original.manufacturedAt);
  assert.equal(app.rows()[0].weightG, 2090);
  assert.equal(app.rows()[0].attempts, 2);
});

test('CSV includes the frozen manufacture time, manual weight and rule; name uses the JST day', async () => {
  const app = setup(async () => reply());
  app.fill(); app.get('weight').value='2080'; app.get('staff').value='=1+1'; await app.print();
  const row = app.rows()[0], csv = await app.exportFile();
  assert.match(csv.text, /製造日時_日本時間/);
  assert.match(csv.text, /正味重量g/);
  assert.ok(csv.text.includes(production.formatManufacturedAt(row.manufacturedAt)));
  assert.ok(csv.text.includes(row.manufacturedAt));
  assert.match(csv.text, /"2080","manual","2000","5","pass"/);
  assert.ok(csv.text.includes('"\'=1+1"'));
  assert.equal(csv.filename, `ラベル発行履歴_${production.formatManufacturedAt(new Date().toISOString()).slice(0,10).replaceAll('/','-')}.csv`);
});

const cloudSession = {user:{id:'operator-1',email:'operator@example.test'},access_token:'fake-access',refresh_token:'fake-refresh',expires_at:Math.floor(Date.now()/1000)+3600};
const settleCloud = () => new Promise(resolve => setTimeout(resolve,30));

test('cloud failure does not block successive real print handlers; reload retains the queue', async () => {
  const routes = [];
  const fetchImpl = async url => {
    const target = new URL(url); routes.push(target);
    if (target.hostname !== 'localhost') throw new TypeError('Cloud offline');
    return reply();
  };
  const app = setup(fetchImpl,{bundled:true,cloudSession});
  app.fill(); await app.print(); await settleCloud();
  assert.equal(app.rows()[0].status,'success');
  assert.equal(app.rows()[0].sheets.syncedRevision,0);
  assert.equal(app.get('cloud-count').textContent,'未同期 1件');
  app.fill(); await app.print(); await settleCloud();
  assert.equal(routes.filter(url=>url.pathname==='/print').length,2);
  assert.ok(app.rows().every(row=>row.status==='success'));
  const reloaded = setup(fetchImpl,{bundled:true,cloudSession,initialRows:app.rows()});
  await settleCloud();
  assert.equal(reloaded.rows().length,2);
  assert.equal(reloaded.get('cloud-count').textContent,'未同期 2件');
  assert.equal(routes.filter(url=>url.pathname==='/print').length,2);
});

test('DB replay after outage sends only a log with original timestamp and weight', async () => {
  let offline = true, prints = 0; const payloads = [];
  const app = setup(async (url,options) => {
    if (new URL(url).hostname === 'localhost') { prints++; return reply(); }
    if (offline) throw new TypeError('Offline');
    const envelope=JSON.parse(options.body), body=envelope.record; payloads.push(body);
    return {ok:true,status:201,json:async()=>({ok:true,protocol:envelope.protocol,spreadsheetId:envelope.spreadsheetId,requestId:envelope.requestId,id:body.id,revision:body.client_revision})};
  },{bundled:true,cloudSession});
  app.fill(); await app.print(); await settleCloud();
  const original = app.rows()[0];
  offline = false; await app.click('sync-button');
  assert.equal(prints,1); assert.equal(payloads.length,1);
  assert.equal(payloads[0].id,original.id);
  assert.equal(payloads[0].manufactured_at,original.manufacturedAt);
  assert.equal(payloads[0].weight_g,2000);
  assert.equal(payloads[0].print_status,'success');
  assert.equal(app.get('cloud-count').textContent,'未同期 0件');
  await app.click('sync-button');
  assert.equal(payloads.length,1); assert.equal(prints,1);
});

test('demo rows never enter the cloud queue, including with a signed-in session', async () => {
  let cloudRequests = 0;
  const app = setup(async () => { cloudRequests++; throw new Error('Must not call'); },{bundled:true,cloudSession});
  await app.click('demo-toggle'); app.fill(); await app.print(); await settleCloud();
  assert.deepEqual(app.rows(),[]);
  assert.equal(cloudRequests,0);
});

test('a stalled cloud upload does not hold the next print button or delay a second label', async () => {
  let release, prints = 0, hold = true;
  const app = setup(async (url,options) => {
    if (new URL(url).hostname === 'localhost') { prints++; return reply(); }
    const envelope=JSON.parse(options.body), payload=envelope.record;
    if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
    return {ok:true,status:201,json:async()=>({ok:true,protocol:envelope.protocol,spreadsheetId:envelope.spreadsheetId,requestId:envelope.requestId,id:payload.id,revision:payload.client_revision})};
  },{bundled:true,cloudSession});
  app.fill(); await app.print(); await settleCloud();
  assert.equal(typeof release,'function');
  app.fill(); app.input('weight');
  assert.equal(app.get('print-button').disabled,false);
  await app.print();
  assert.equal(prints,2);
  release(); await settleCloud();
});
