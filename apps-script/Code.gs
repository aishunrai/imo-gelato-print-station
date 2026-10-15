// This receiver writes only to this spreadsheet. No log-reading API is exposed.
var LOG_SPREADSHEET_ID = '1pou8BV6owyOgC71Xp7p86lzsTMsLAgz-MXr0PktsCNo';
var LOG_HEADERS = ['製造日時（日本時間）','フレーバー','担当者','正味重量（g）','ラベル枚数','印刷結果','記録ID','発行操作回数','最終発行操作日時（日本時間）','基準重量（g）','許容上限率（％）','重量取得方法','詳細','最終同期日時（日本時間）','更新番号'];
function onOpen() { SpreadsheetApp.getUi().createMenu('ラベル印刷の接続').addItem('新しい保存用キーを作成','createConnectionKey').addToUi(); }
// Run by the operator. Re-running rotates the key for every device.
function createConnectionKey() {
  var book = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
  if (!book.getSheetByName('印刷ログ')) throw new Error('印刷ログのシートがありません。');
  var key = (Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'');
  PropertiesService.getScriptProperties().setProperty('WRITE_KEY_HASH',hashKey_(key));
  var html = '<html><body style="font-family:sans-serif;padding:16px"><h3>保存用キー</h3><p>アプリの「接続設定」にコピーしてください。チャットやGitHubには貼り付けません。</p><p>閉じると再表示できません。再作成すると以前の端末のキーは無効になります。</p><input id="key" type="password" readonly style="width:100%;font-size:14px" value="'+key+'"><p><button onclick="document.getElementById(\'key\').type=\'text\';document.getElementById(\'key\').select()">表示して選択</button></p><p>選択後にコピーし、設定が完了したら閉じてください。</p></body></html>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(310),'ラベル印刷の保存設定');
}
function hashKey_(key) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,key,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join(''); }
function doGet() { return jsonReply_({protocol:'imo-print-logs/v1',service:'gelato-log-receiver'}); }
function doPost(event) {
  var input = {}, base = {protocol:'imo-print-logs/v1',spreadsheetId:LOG_SPREADSHEET_ID};
  try {
    if (!event || !event.postData || event.postData.contents.length>32768) throw new Error('VALIDATION');
    input = JSON.parse(event.postData.contents);
    if (!input || typeof input !== 'object') throw new Error('VALIDATION');
    base.requestId = typeof input.requestId === 'string' ? input.requestId.slice(0,80) : '';
    var expected = PropertiesService.getScriptProperties().getProperty('WRITE_KEY_HASH');
    if (!expected || typeof input.key !== 'string' || !/^[a-f0-9]{64}$/.test(input.key) || hashKey_(input.key)!==expected) throw new Error('AUTH');
    if (input.protocol!==base.protocol || input.spreadsheetId!==LOG_SPREADSHEET_ID || !base.requestId) throw new Error('CONFIG');
    var book = SpreadsheetApp.openById(LOG_SPREADSHEET_ID), sheet = book.getSheetByName('印刷ログ');
    if (!sheet) throw new Error('CONFIG');
    if (JSON.stringify(sheet.getRange(1,1,1,15).getValues()[0])!==JSON.stringify(LOG_HEADERS)) throw new Error('HEADERS');
    if (input.action==='check') {
      // Connectivity checks update the guide, never a production record.
      var guide = book.getSheetByName('項目説明');
      if (guide) { guide.getRange('A25:B25').setValues([['最終接続確認（日本時間）',new Date()]]); guide.getRange('B25').setNumberFormat('yyyy/mm/dd hh:mm:ss'); }
      SpreadsheetApp.flush(); return jsonReply_(Object.assign(base,{ok:true}));
    }
    if (input.action!=='upsert') throw new Error('VALIDATION');
    var data = validateRecord_(input.record), lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) throw new Error('BUSY');
    try {
      var last=sheet.getLastRow(),target=last+1,matches=[];
      if (last>1) { var ids=sheet.getRange(2,7,last-1,1).getValues(); for(var i=0;i<ids.length;i++) if(ids[i][0]===data.id) matches.push(i+2); }
      if(matches.length>1) throw new Error('DUPLICATE');
      var previous=null;
      if(matches.length) {
        target=matches[0]; previous=sheet.getRange(target,1,1,15).getValues()[0];
        if(Number(previous[14])>=data.client_revision) return jsonReply_(Object.assign(base,{ok:true,id:data.id,revision:Number(previous[14])}));
      }
      var values=[new Date(data.manufactured_at),safeText_(data.flavor),safeText_(data.staff),data.weight_g,data.copies,data.print_status,data.id,data.attempts,new Date(data.last_attempt_at),data.weight_rule.baseWeightG,data.weight_rule.upperTolerancePercent,safeText_(data.weight_source),safeText_(data.detail),new Date(),data.client_revision];
      if(previous) for(var c=0;c<5;c++) values[c]=typeof previous[c]==='string'?safeText_(previous[c]):previous[c];
      if(target>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),100);
      var formats=['yyyy/mm/dd hh:mm:ss','@','@','#,##0','#,##0','@','@','#,##0','yyyy/mm/dd hh:mm:ss','#,##0','0.##','@','@','yyyy/mm/dd hh:mm:ss','#,##0'];
      sheet.getRange(target,1,1,15).setNumberFormats([formats]).setValues([values]);
      SpreadsheetApp.flush(); return jsonReply_(Object.assign(base,{ok:true,id:data.id,revision:data.client_revision}));
    } finally { lock.releaseLock(); }
  } catch(error) {
    var code=['AUTH','BUSY','HEADERS','VALIDATION','DUPLICATE','CONFIG'].indexOf(error.message)>=0 ? error.message : 'SAVE_FAILED';
    return jsonReply_(Object.assign(base,{ok:false,code:code}));
  }
}
function validateRecord_(r) {
  function integer(v,min,max){return Number.isSafeInteger(v)&&v>=min&&v<=max;}
  function text(v,max){return typeof v==='string'&&v.trim().length>0&&v.length<=max;}
  function instant(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(new Date(v).getTime());}
  if(!r || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.id||'') || !text(r.flavor,80)||!text(r.staff,40)||!integer(r.weight_g,1,1000000)||!integer(r.copies,1,50)||!integer(r.attempts,1,1000000)||!integer(r.client_revision,1,Number.MAX_SAFE_INTEGER)||!instant(r.manufactured_at)||!instant(r.last_attempt_at)||['pending','success','confirmed','failed','unknown'].indexOf(r.print_status)<0||!r.weight_rule||!integer(r.weight_rule.baseWeightG,1,1000000)||!Number.isFinite(r.weight_rule.upperTolerancePercent)||r.weight_rule.upperTolerancePercent<0||r.weight_rule.upperTolerancePercent>100||!text(r.weight_source,40)||typeof r.detail!=='string'||r.detail.length>2000) throw new Error('VALIDATION');
  return r;
}
function safeText_(value){return /^\s*[=+@-]/.test(value)?"'"+value:value;}
function jsonReply_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
