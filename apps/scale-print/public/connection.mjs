// A successful response is evidence at that time, not a permanent online flag.
export function initialConnection() {
  return {phase: 'unverified', lastSuccess: null, detail: ''};
}

export function connectionEvent(state, event, {now = new Date().toISOString(), detail = '', code = ''} = {}) {
  if (event === 'status-success' || event === 'print-success') {
    return {phase: 'confirmed', lastSuccess: {at: now, source: event}, detail};
  }
  if (event === 'checking' || event === 'printing') return {...state, phase: event, detail: ''};
  if (event === 'stale') return {...state, phase: 'unverified', detail: ''};
  if (event === 'status-failure' || event === 'print-failure') {
    return {...state, phase: code ? 'warning' : 'unknown', detail: `${detail}${code ? ` (${code})` : ''}`};
  }
  throw new Error(`Unknown connection event: ${event}`);
}

export function connectionView(state, {android = true, demo = false} = {}) {
  if (demo) return {kind: 'demo', title: '画面確認モードです', detail: 'プリンタには通信しません。'};
  if (!android) return {kind: 'unverified', title: 'Android端末で確認してください', detail: '印刷に使うAndroid端末でこのページを開いてください。'};
  const previous = state.lastSuccess
    ? `前回の応答確認：${new Intl.DateTimeFormat('ja-JP', {timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(state.lastSuccess.at))}。`
    : '';
  switch (state.phase) {
    case 'checking': return {kind: 'checking', title: '接続を確認しています…', detail: '用紙を使わず状態を取得しています。'};
    case 'printing': return {kind: 'checking', title: 'プリンタへ印刷を依頼しています…', detail: '印刷結果の応答を待っています。'};
    case 'confirmed': return {
      kind: 'confirmed',
      title: state.lastSuccess.source === 'print-success' ? '印刷応答を確認しました' : '接続応答を確認しました',
      detail: `${previous}${state.lastSuccess.source === 'print-success' ? '印刷成功の応答を受信しました。' : 'プリンタの正常応答を受信しました。'} 現在の状態は「接続確認」で再確認できます。`,
    };
    case 'warning': return {kind: 'warning', title: 'プリンタの確認が必要です', detail: `${state.detail} ${previous}`.trim()};
    case 'unknown': return {kind: 'unknown', title: '状態を確認できません', detail: `${state.detail} ${previous} 未接続とは限りません。「接続確認」で再確認してください。`.trim()};
    default: return {kind: 'unverified', title: '接続は未確認です', detail: `${previous}「接続確認」で現在の状態を取得できます。`.trim()};
  }
}
