export class CloudError extends Error {
  constructor(message) { super(message); this.name = 'CloudError'; }
}
export function createCloudClient(config, {fetchImpl = fetch, sessionStore, persistentStore, requestId = () => crypto.randomUUID()} = {}) {
  const project = `google-sheets:${config.spreadsheetId}`, storageKey = `imo-sheets-connection:${config.spreadsheetId}`;
  let connection = null;
  function validate(value) {
    const endpoint = new URL(value.endpoint);
    if (endpoint.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname) || endpoint.search || endpoint.hash) throw new CloudError('Apps ScriptのウェブアプリURL（末尾 /exec）を確認してください。');
    if (typeof value.key !== 'string' || !/^[a-f0-9]{64}$/.test(value.key)) throw new CloudError('保存用キーを確認してください。');
    return {endpoint:endpoint.href,key:value.key};
  }
  try { const raw = sessionStore?.getItem(storageKey) || persistentStore?.getItem(storageKey); if (raw) connection = validate(JSON.parse(raw)); } catch {}
  async function request(action, record) {
    if (!connection) throw new CloudError('接続設定をすると同期できます。印刷は継続できます。');
    const current = connection, id = requestId(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),15000);
    try {
      const response = await fetchImpl(current.endpoint,{method:'POST',mode:'cors',credentials:'omit',redirect:'follow',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({protocol:'imo-print-logs/v1',requestId:id,spreadsheetId:config.spreadsheetId,key:current.key,action,...(record ? {record} : {})})});
      if (!response.ok || response.type === 'opaque') throw new CloudError('保存先の応答を読み取れませんでした。');
      const reply = await response.json();
      if (reply.protocol !== 'imo-print-logs/v1' || reply.requestId !== id || reply.spreadsheetId !== config.spreadsheetId) throw new CloudError('保存先の応答を確認できません。未同期のまま保持します。');
      if (!reply.ok) {
        const messages = {AUTH:'保存用キーが一致しません。接続設定を確認してください。',BUSY:'保存先が処理中です。後から再送します。',HEADERS:'シートの列名・列順が変わっています。',VALIDATION:'記録の内容を確認してください。',DUPLICATE:'同じ記録IDの行が複数あります。',CONFIG:'保存先の設定を確認してください。'};
        throw new CloudError(messages[reply.code] || 'スプレッドシートへの保存を確認できません。');
      }
      return reply;
    } catch (error) {
      if (error instanceof CloudError) throw error;
      throw new CloudError('スプレッドシートに接続できません。記録は端末に残っています。');
    } finally { clearTimeout(timer); }
  }
  return {
    project, ready:() => !!connection, endpoint:() => connection?.endpoint || config.webAppUrl || '',
    configure(endpoint,key,remember = false) {
      const next = validate({endpoint:endpoint.trim(),key:key.trim()});
      try {
        if (remember) { persistentStore?.setItem(storageKey,JSON.stringify(next)); sessionStore?.removeItem(storageKey); }
        else { sessionStore?.setItem(storageKey,JSON.stringify(next)); persistentStore?.removeItem(storageKey); }
      } catch { throw new CloudError('接続設定を保存できません。このブラウザの保存設定を確認してください。'); }
      connection = next;
    },
    disconnect() { connection = null; try { sessionStore?.removeItem(storageKey); persistentStore?.removeItem(storageKey); } catch {} },
    async check() { await request('check'); },
    async upsert(record) {
      const reply = await request('upsert',record);
      if (reply.id !== record.id || !Number.isSafeInteger(reply.revision) || reply.revision < record.client_revision) throw new CloudError('記録の保存結果を確認できません。');
    },
  };
}
export function logPayload(row) {
  return {id:row.id,manufactured_at:row.manufacturedAt,flavor:row.flavor,staff:row.staff,
    weight_g:row.weightG,copies:row.copies,weight_source:row.weightSource,weight_rule:row.weightRule,
    print_status:row.status,attempts:row.attempts,last_attempt_at:row.lastAttemptAt,detail:row.detail || '',client_revision:row.sheets.revision};
}
export function markLogChanged(row, project) {
  if (!row.sheets) row.sheets = {project,revision:0,syncedRevision:0};
  row.sheets.revision += 1; row.sheets.error = '';
}
export function prepareSheetLogs(rows, project) {
  let changed = false;
  for (const row of rows) {
    // Preserve UUIDs and the old cloud metadata. Demo records never enter rows.
    if (!row.sheets && row.manufacturedAt && row.lastAttemptAt && Number.isInteger(row.weightG) && row.weightRule && row.attempts > 0) {
      markLogChanged(row,project); changed = true;
    }
  }
  return changed;
}
export function logSyncView(row, project) {
  if (!row.sheets) return '端末内のみ（旧形式）';
  if (row.sheets.project !== project) return '別の保存先の記録';
  return row.sheets.syncedRevision >= row.sheets.revision ? 'シート保存済み' : '未同期';
}
export function createLogSync({client,rows,persist,onChange = () => {},canRun = () => true,now = () => new Date().toISOString()}) {
  let running = null;
  return {
    get busy() { return !!running; },
    flush() {
      if (running) return running;
      running = (async () => {
        if (!client.ready() || !canRun()) return;
        for (const id of rows().map(row => row.id).reverse()) {
          if (!client.ready() || !canRun()) break;
          const row = rows().find(item => item.id === id), meta = row?.sheets;
          if (!meta || meta.project !== client.project || meta.syncedRevision >= meta.revision || row.status === 'pending') continue;
          const payload = logPayload(row), revision = meta.revision;
          try {
            await client.upsert(payload);
            meta.syncedRevision = Math.max(meta.syncedRevision,revision); meta.syncedAt = now(); meta.error = '';
          } catch (error) { meta.error = error.message || '同期できませんでした。'; persist(); onChange(); return; }
          if (!persist()) return;
          onChange();
        }
      })().catch(() => {}).finally(() => { running = null; onChange(); });
      onChange(); return running;
    },
  };
}
