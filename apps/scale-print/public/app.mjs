import {FLAVORS, validateLabel, requestPrinter, recoverHistory, activeUncertain} from './transport.mjs';
import {initialConnection, connectionEvent, connectionView} from './connection.mjs';
import {WEIGHT_RULE} from './config.mjs';
import {assessWeight, formatManufacturedAt, weightLimits} from './production.mjs';
import {CLOUD_CONFIG} from './cloud-config.mjs';
import {createCloudClient, createLogSync, markLogChanged, logSyncView, prepareSheetLogs} from './cloud.mjs';
import {createScaleSession, createFtdiScale} from './scale.mjs';

const $ = id => document.getElementById(id);
const android = /Android/i.test(navigator.userAgent);
const prefix = 'imo-scale-test-v1';
let demo = false, busy = false, checking = false, storageOK = true;
let records = [], demoRecords = [];
let connection = initialConnection();
let cloudClient = null, cloudSync = null, cloudAuthBusy = false;
const text = (id, value) => { $(id).textContent = value; };
const scaleSession = createScaleSession();
let scaleMode = 'usb', scaleConnecting = false, scaleDiagnostic = 'まだ受信していません。';
const scaleDevice = createFtdiScale({usb:navigator.usb,
  onReading:value=>{
    scaleDiagnostic = `${new Date().toLocaleTimeString('ja-JP')} ${value.raw}`;
    const accepted = !busy && !demo && scaleMode==='usb' && scaleSession.accept(value);
    renderScale({preview:!!accepted});
  },
  onInvalid:message=>{scaleDiagnostic=message;scaleSession.invalidate(message);renderScale({preview:true});},
  onStatus:()=>{scaleSession.connect();if(demo||scaleMode!=='usb')scaleSession.pause('USBで自動取得を選んでください。');renderScale();},
  onDisconnect:message=>{scaleSession.disconnect(message);renderScale();},
});

function usingScale() { return !demo && scaleMode==='usb'; }
function usableScaleWeight() { try { scaleSession.snapshot(); return true; } catch { return false; } }
function renderScale({preview = false} = {}) {
  text('scale-diagnostics',scaleDiagnostic);
  $('scale-card').dataset.state=scaleSession.connected ? 'connected' : 'disconnected';
  text('scale-title',scaleConnecting ? 'スケールに接続しています…' : demo ? '画面確認モード' : scaleSession.connected ? 'スケール接続済み' : 'スケール未接続');
  text('scale-message',demo ? 'USBの受信値は使用せず、重量を手入力して画面を確認できます。' : scaleMode==='manual' ? '手入力で発行します。スケールの受信値は採用しません。' : scaleSession.reason);
  text('scale-tare',scaleSession.reading ? `風袋 ${scaleSession.reading.tareG} g ／ ${new Date(scaleSession.reading.receivedAt).toLocaleTimeString('ja-JP')} 受信` : '受信したWgを正味重量として使用します。');
  if (busy) { updateControls(); return; }
  if (usingScale() && !busy) $('weight').value=usableScaleWeight() ? String(scaleSession.reading.weightG) : '';
  $('weight').readOnly=usingScale();
  $('weight').placeholder=usingScale()?'スケールから取得':'例：2000';
  text('weight-source-label',demo ? '画面確認・手入力' : scaleMode==='usb' ? '必須・スケール自動取得' : '必須・手入力');
  text('weight-help',usingScale() ? '空ケースを風袋引きしてから計量してください。表示が安定すると自動反映します。' : 'ケースの重量を除いた、ジェラートの重量を入力してください。');
  if (preview) updatePreview(); else renderWeight();
}

function renderConnection() {
  const view = connectionView(connection, {android, demo});
  text('connection-title', view.title);
  text('connection-detail', view.detail);
  $('connection-card').dataset.state = view.kind;
  $('printer-chip').dataset.state = view.kind;
}
function setConnection(event, details) {
  connection = connectionEvent(connection, event, details);
  renderConnection();
}

function save(key, data) {
  try { localStorage.setItem(`${prefix}:${key}`, JSON.stringify(data)); return true; }
  catch { storageOK = false; $('storage-note').hidden = false; return false; }
}
function read(key, fallback) {
  try { const raw = localStorage.getItem(`${prefix}:${key}`); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function currentRows() { return demo ? demoRecords : records; }
function persist() { return save('history', records); }
function parseXml(raw) {
  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  const valid = !doc.querySelector('parsererror') && doc.documentElement?.localName === 'response';
  return {valid, result: doc.querySelector('result')?.textContent?.trim() || '', code: doc.querySelector('code')?.textContent?.trim() || ''};
}
function result(title, detail, kind = '') {
  $('result').className = `result ${kind}`;
  text('result-title', title); text('result-detail', detail);
  $('result').setAttribute('aria-busy', String(busy));
  text('result-icon', kind === 'success' ? '✓' : kind === 'unknown' || kind === 'error' ? '!' : '○');
}
// The result-icon is a class in the HTML; assign its ID once for consistent updates.
document.querySelector('.result-icon').id = 'result-icon';

function updateControls() {
  const unresolved = activeUncertain(currentRows());
  $('print-button').disabled = busy || checking || scaleConnecting || !!unresolved || !assessWeight($('weight').value).accepted || (usingScale() && !usableScaleWeight()) || (!demo && (!android || !storageOK));
  $('check-button').disabled = busy || checking;
  $('demo-toggle').disabled = busy || checking || !!activeUncertain(records);
  $('export-button').disabled = busy || currentRows().length === 0;
  for (const id of ['flavor','staff','copies','weight']) $(id).disabled = busy;
  for (const id of ['scale-connect','scale-disconnect','scale-arm','weight-mode']) $(id).disabled=busy||checking||scaleConnecting||demo;
  $('scale-connect').disabled ||= scaleSession.connected || !scaleDevice.supported;
  $('scale-disconnect').disabled ||= !scaleSession.connected;
  $('scale-arm').disabled ||= !scaleSession.connected || scaleMode!=='usb' || !!unresolved;
  $('weight-mode').disabled ||= !!unresolved;
  text('scale-support',scaleDevice.supported ? 'FTDI 0403:6001 ／ 9600bps・8N1 ／ ChromeへのUSB許可が必要です。' : 'このブラウザではUSB接続を利用できません。AndroidのChromeで開いてください。PCでは「画面を試す」を利用できます。');
  $('reconcile').hidden = !unresolved || busy;
  text('print-button-text', busy ? '印刷中…' : demo ? '画面で発行を試す' : 'ラベルを印刷');
  text('button-note', demo ? '画面確認のみ。実際のラベルは出ません。' : '印刷結果は、この画面に表示されます。');
  document.querySelectorAll('.retry-button').forEach(b => { b.disabled = busy || checking || !!unresolved || (!demo && (!android || !storageOK)); });
}
function snapshot() {
  const measured = usingScale() ? scaleSession.snapshot() : {weightG:$('weight').value, weightSource:'manual'};
  if (usingScale() && String(measured.weightG)!==$('weight').value) throw new Error('表示重量が受信値と一致しません。再計量してください。');
  return {flavor: $('flavor').value, staff: $('staff').value, copies: $('copies').value, ...measured};
}
function renderWeight() {
  const judgment = assessWeight($('weight').value);
  $('weight-judgment').dataset.state = judgment.status;
  text('weight-judgment', usingScale() && judgment.status==='empty' ? 'スケールから重量を取得してください。' : judgment.message);
  updateControls();
}
function updatePreview() {
  text('preview-caption', '入力内容の確認用です。製造日時は発行時に確定します。');
  text('preview-flavor', $('flavor').value || 'フレーバー');
  text('preview-staff', $('staff').value.trim() || '未入力');
  text('preview-copies', $('copies').value || '—');
  const judgment = assessWeight($('weight').value);
  text('preview-weight', judgment.weightG == null ? '未入力' : `${judgment.weightG} g`);
  text('preview-manufactured-at', '発行時に自動取得');
  if (!demo) save('preferences', {flavor: $('flavor').value, staff: $('staff').value});
  renderWeight();
}
const statusNames = {pending:'印刷中', success:'印刷完了', confirmed:'現物で確認済み', failed:'未完了', unknown:'要確認'};
function formatTime(value) {
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? '日時不明' : new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}).format(d);
}
function renderHistory() {
  const container = $('history-list'); container.replaceChildren();
  if (!currentRows().length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = demo ? '画面確認モードの発行履歴は、ここに表示されます。' : 'まだ発行履歴はありません。'; container.append(p); }
  for (const row of currentRows().slice(0, 20)) {
    const item = document.createElement('div'); item.className = 'history-item';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = row.flavor;
    const detail = document.createElement('small'); detail.textContent = `${row.manufacturedAt ? formatManufacturedAt(row.manufacturedAt) : formatTime(row.createdAt)} / ${row.staff} / ${row.weightG == null ? '重量未記録（旧形式）' : `${row.weightG}g・${row.weightSource==='scale-usb'?'スケール':'手入力'}`} / ${row.copies}枚${row.attempts > 1 ? ` / 発行操作${row.attempts}回` : ''}${demo ? ' / 画面確認' : ''}`;
    info.append(title, detail);
    const actions = document.createElement('div'); actions.className = 'history-actions';
    const state = document.createElement('span'); state.className = `history-state ${row.status}`; state.textContent = statusNames[row.status]; actions.append(state);
    if (!demo) {
      const syncState = document.createElement('small'); syncState.className = 'history-sync';
      syncState.textContent = logSyncView(row, cloudProject());
      syncState.dataset.state = row.sheets && row.sheets.syncedRevision >= row.sheets.revision ? 'saved' : 'pending';
      actions.append(syncState);
    }
    if (row.status === 'failed') { const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button retry-button'; retry.textContent = '同じ内容を再発行'; retry.addEventListener('click', () => print(row)); actions.append(retry); }
    item.append(info, actions); container.append(item);
  }
  updateControls();
}

async function print(existing = null) {
  if (busy || checking || activeUncertain(currentRows())) return;
  if (!demo && !android) { result('Android端末で開いてください', 'PCでは「画面を試す」で操作を確認できます。', 'error'); return; }
  let label;
  try { label = validateLabel(existing || snapshot()); }
  catch (e) { result('入力内容を確認してください', e.message, 'error'); return; }
  busy = true;
  if (!existing && usingScale()) scaleSession.pause('この重量は発行に使用しました。ケースを載せ替え、「次の計量を開始」を押してください。');
  const now = new Date().toISOString();
  const row = existing || {id: crypto.randomUUID(), ...label, createdAt: now, manufacturedAt:now, attempts: 0};
  // Freeze the timestamp, weight and rule before saving or sending; retries use this same record.
  label = row;
  if (!existing) currentRows().unshift(row);
  row.status = 'pending'; row.attempts += 1; row.lastAttemptAt = new Date().toISOString(); row.detail = '';
  if (!demo) markLogChanged(row, cloudProject());
  if (!demo && !persist()) {
    row.status = 'failed'; row.detail = '履歴の保存に失敗したため、プリンタには送信していません。';
    busy = false; result('保存できなかったため印刷を停止しました', row.detail, 'error'); renderScale(); renderHistory(); return;
  }
  if (!demo) setConnection('printing');
  text('preview-flavor', row.flavor);
  text('preview-staff', row.staff);
  text('preview-weight', `${row.weightG} g`);
  text('preview-copies', row.copies);
  text('preview-manufactured-at', formatManufacturedAt(row.manufacturedAt));
  result(demo ? '画面で発行を確認しています' : 'ラベルを印刷しています', 'そのままお待ちください。続けて押す必要はありません。', demo ? 'demo' : '');
  renderHistory();
  try {
    if (demo) await new Promise(resolve => setTimeout(resolve, 700));
    else await requestPrinter('print', label, {parseXml});
    if (!demo) setConnection('print-success');
    row.status = 'success'; row.detail = demo ? '画面確認のみ。プリンタには送信していません。' : '印刷サービスから成功の応答を受信しました。';
    $('weight').value = '';
    renderWeight();
    text('preview-caption', '直前に発行した内容です。次の入力で更新します。');
    result(demo ? '画面確認が完了しました' : 'ラベルの印刷が完了しました', `${row.detail} ${usingScale()?'次のケースは「次の計量を開始」から計量してください。':'次のケースの重量を入力してください。'}`, demo ? 'demo' : 'success');
  } catch (e) {
    if (!demo) setConnection('print-failure', {detail: e.message, code: e.code});
    row.status = 'unknown'; row.detail = `${e.message}${e.code ? ` (${e.code})` : ''}`;
    result('印刷結果を確認してください', `${row.detail} 自動では再送しません。`, 'unknown');
  } finally {
    busy = false;
    if (!demo && scaleMode==='usb') renderScale();
    if (!demo) markLogChanged(row, cloudProject());
    if (!demo && !persist()) result('履歴を更新できませんでした', 'ラベルが出たか確認してください。履歴のCSVを保存し、保存先を確認してください。', 'unknown');
    renderHistory();
    scheduleCloudSync();
  }
}

$('label-form').addEventListener('submit', async e => { e.preventDefault(); await print(); });
for (const id of ['flavor','staff','copies','weight']) $(id).addEventListener('input', updatePreview);
async function checkConnection() {
  if (busy || checking) return;
  if (demo || !android) { renderConnection(); return; }
  checking = true; updateControls(); setConnection('checking');
  try {
    await requestPrinter('status', null, {parseXml, timeoutMs: 8000});
    setConnection('status-success');
  } catch (e) {
    setConnection('status-failure', {detail: e.message, code: e.code});
  } finally { checking = false; updateControls(); }
}
$('check-button').addEventListener('click', checkConnection);
$('demo-toggle').addEventListener('click', () => {
  if (busy || checking || activeUncertain(records)) return;
  demo = !demo; $('demo-note').hidden = !demo; $('demo-toggle').setAttribute('aria-pressed', String(demo));
  scaleSession.pause('「次の計量を開始」から再計量してください。'); $('weight').value='';
  text('demo-toggle', demo ? '実機印刷に戻る' : '画面を試す');
  text('history-title', demo ? '画面確認モードの発行履歴' : 'この端末の発行履歴');
  renderConnection();
  result(demo ? '画面確認モード' : '印刷の準備', demo ? 'フレーバーと担当者を入力して、発行の流れを試せます。' : '実機印刷はAndroidで行います。最初に接続確認をしてください。', demo ? 'demo' : '');
  renderHistory();
  renderScale();
  scheduleCloudSync();
});
function reconcile(status) {
  const row = activeUncertain(currentRows()); if (!row || busy) return;
  row.status = status; row.detail = status === 'confirmed' ? '作業者が必要枚数の印刷を確認しました。' : '作業者が未完了と確認しました。';
  if (!demo) { markLogChanged(row, cloudProject()); persist(); }
  if (status === 'confirmed') { $('weight').value = ''; renderWeight(); }
  result(status === 'confirmed' ? '印刷済みとして記録しました' : '未完了として記録しました', status === 'confirmed' ? '次のラベルを発行できます。' : '再発行する場合は、履歴の「同じ内容を再発行」を押してください。', status === 'confirmed' ? 'success' : 'error');
  renderHistory();
  scheduleCloudSync();
}
$('confirm-printed').addEventListener('click', () => reconcile('confirmed'));
$('confirm-not-printed').addEventListener('click', () => reconcile('failed'));
$('export-button').addEventListener('click', () => {
  const cell = value => { let s = String(value ?? ''); if (/^\s*[=+@-]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"','""')}"`; };
  const rows = [['記録ID','登録日時UTC','製造日時_日本時間','製造日時UTC','フレーバー','担当者','正味重量g','重量取得方法','基準重量g','許容上限率％','判定','ラベル枚数','状態','発行操作回数','最終発行操作日時UTC','詳細','風袋量g','重量受信日時UTC'], ...currentRows().map(r => [r.id,r.createdAt,r.manufacturedAt ? formatManufacturedAt(r.manufacturedAt) : '',r.manufacturedAt,r.flavor,r.staff,r.weightG,r.weightSource,r.weightRule?.baseWeightG,r.weightRule?.upperTolerancePercent,r.judgment,r.copies,statusNames[r.status],r.attempts,r.lastAttemptAt,r.detail,r.tareG,r.weightReceivedAt])];
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${demo ? '画面確認' : 'ラベル発行履歴'}_${formatManufacturedAt(new Date().toISOString()).slice(0,10).replaceAll('/','-')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
});
const preferences = read('preferences', {});
if (preferences && typeof preferences === 'object') { if (FLAVORS.includes(preferences.flavor)) $('flavor').value = preferences.flavor; if (typeof preferences.staff === 'string') $('staff').value = preferences.staff.slice(0,40); }
const storedHistory = read('history', []);
records = recoverHistory(storedHistory);
prepareSheetLogs(records,cloudProject());
// A recovered interrupted print has a new outcome that must also reach the DB.
for (const row of records) if (row.sheets && Array.isArray(storedHistory) && storedHistory.some(old => old?.id === row.id && old.status === 'pending')) markLogChanged(row, cloudProject());
save('storage-check', true); persist();
$('device-note').hidden = android;
updatePreview(); renderHistory(); renderConnection();
renderScale();
const {minG, maxG} = weightLimits(WEIGHT_RULE);
text('weight-range', `1ケース＝1B ／ ${minG}〜${maxG}g（基準${minG}g・＋${WEIGHT_RULE.upperTolerancePercent}％まで）`);
if (activeUncertain(records)) result('前回の印刷結果を確認してください', activeUncertain(records).detail || '必要枚数のラベルが出たか確認してから、次の印刷に進んでください。', 'unknown');
initializeCloud();
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    scaleSession.pause('画面を離れたため重量を解除しました。「次の計量を開始」から再計量してください。');
    if (!busy) renderScale();
    if (!busy && !checking) setConnection('stale');
  } else if (!busy && !checking && android && !demo) {
    // Returning from Smooth Print only reads status; it never re-sends a label.
    scheduleCloudSync();
    return checkConnection();
  }
});

$('scale-connect').addEventListener('click',async()=>{
  if(busy||checking||scaleConnecting||demo)return;
  scaleConnecting=true;renderScale();
  try { await scaleDevice.connect(); }
  catch(error){scaleDiagnostic=error.message;scaleSession.disconnect(error.message);}
  finally {scaleConnecting=false;renderScale();}
});
$('scale-disconnect').addEventListener('click',()=>{if(!busy&&!demo)return scaleDevice.disconnect();});
$('scale-arm').addEventListener('click',()=>{if(busy||demo||activeUncertain(currentRows()))return;scaleDevice.resetFrame();scaleSession.arm();renderScale();});
$('weight-mode').addEventListener('change',()=>{
  if(busy||demo||activeUncertain(currentRows()))return;
  scaleMode=$('weight-mode').value==='manual'?'manual':'usb';$('weight').value='';
  scaleDevice.resetFrame();scaleSession.pause('「次の計量を開始」から計量してください。');renderScale({preview:true});
});
setInterval(()=>{if(scaleSession.expire()&&!busy)renderScale({preview:true});},500);

function cloudProject() { return `google-sheets:${CLOUD_CONFIG.spreadsheetId}`; }
function renderCloud() {
  const queued = records.filter(row => row.sheets?.project === cloudProject() && row.sheets.syncedRevision < row.sheets.revision);
  text('cloud-count', `未同期 ${queued.length}件`);
  text('cloud-status', cloudSync?.busy ? '印刷ログをスプレッドシートに保存しています…'
    : cloudClient?.ready() ? '保存先：ジェラート_ラベル印刷ログ ／ 接続設定済み'
    : '接続設定は未完了です。印刷は継続し、記録を端末に保持します。');
  $('cloud-logout').hidden = !cloudClient?.ready();
  $('cloud-save-settings').disabled = cloudAuthBusy || !!cloudSync?.busy;
  $('cloud-logout').disabled = cloudAuthBusy || !!cloudSync?.busy;
  $('cloud-check').disabled = cloudAuthBusy || !!cloudSync?.busy || !cloudClient?.ready();
  $('sync-button').disabled = cloudAuthBusy || !!cloudSync?.busy || !cloudClient?.ready() || demo;
}
function scheduleCloudSync() {
  renderCloud();
  // Cloud promises are never awaited by the printing code.
  if (cloudSync && !demo) setTimeout(() => { void cloudSync.flush(); },0);
}
function initializeCloud() {
  try {
    let sessionStore; try { sessionStore=window.sessionStorage; } catch {}
    cloudClient=createCloudClient(CLOUD_CONFIG,{sessionStore,persistentStore:localStorage,fetchImpl:fetch});
    $('cloud-endpoint').value=cloudClient.endpoint();
    cloudSync=createLogSync({client:cloudClient,rows:()=>records,persist,canRun:()=>!demo&&!busy&&storageOK,
      onChange:()=>{
        renderCloud(); renderHistory();
        const error=records.find(row=>row.sheets?.project===cloudProject()&&row.sheets.error)?.sheets.error;
        if(error){text('cloud-message',error);$('cloud-message').dataset.kind='error';}
        else if($('cloud-message').dataset.kind==='error') text('cloud-message','');
      }});
    $('cloud-settings-form').addEventListener('submit',async event=>{
      event.preventDefault(); if(cloudAuthBusy||cloudSync.busy)return;
      cloudAuthBusy=true;
      const key=$('cloud-key').value; $('cloud-key').value='';
      try {
        cloudClient.configure($('cloud-endpoint').value,key,$('cloud-remember').checked);
        renderCloud();
        await cloudClient.check();
        text('cloud-message','スプレッドシートへの接続・書き込みを確認できました。'); $('cloud-message').dataset.kind='success';
        $('cloud-settings-panel').open=false; scheduleCloudSync();
      }catch(error){text('cloud-message',error.message);$('cloud-message').dataset.kind='error';}
      finally{cloudAuthBusy=false;renderCloud();}
    });
    $('cloud-logout').addEventListener('click',()=>{
      if(cloudAuthBusy||cloudSync.busy)return;
      cloudClient.disconnect(); text('cloud-message','接続設定を解除しました。未同期の記録は端末に残っています。');
      $('cloud-message').dataset.kind='success'; renderCloud();
    });
    $('sync-button').addEventListener('click',()=>{if(!demo)return cloudSync.flush();});
    $('cloud-check').addEventListener('click',async()=>{
      if(cloudAuthBusy||cloudSync.busy)return;
      cloudAuthBusy=true;renderCloud();
      try{await cloudClient.check();text('cloud-message','スプレッドシートへの接続・書き込みを確認できました。');$('cloud-message').dataset.kind='success';}
      catch(error){text('cloud-message',error.message);$('cloud-message').dataset.kind='error';}
      finally{cloudAuthBusy=false;renderCloud();}
    });
    window.addEventListener('online',scheduleCloudSync);
    setInterval(()=>{if(document.visibilityState==='visible')scheduleCloudSync();},60000);
    scheduleCloudSync();
  }catch{
    text('cloud-message','シート保存を初期化できませんでした。印刷は継続できます。');renderCloud();
  }
}
