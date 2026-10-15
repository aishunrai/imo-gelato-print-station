import test from 'node:test';
import assert from 'node:assert/strict';
import {initialConnection, connectionEvent, connectionView} from '../public/connection.mjs';
import {interpretReply} from '../public/transport.mjs';

const now = '2026-10-15T01:23:45.000Z';
test('successful printing replaces a failed status check with confirmed print evidence', () => {
  let state = connectionEvent(initialConnection(), 'status-failure', {detail: 'Failed to fetch'});
  assert.equal(connectionView(state).kind, 'unknown');
  state = connectionEvent(state, 'print-success', {now});
  assert.equal(connectionView(state).kind, 'confirmed');
  assert.equal(connectionView(state).title, '印刷応答を確認しました');
  assert.match(connectionView(state).detail, /10\/15 10:23:45/);
});
test('later status failure retains last successful evidence without claiming current connection', () => {
  let state = connectionEvent(initialConnection(), 'print-success', {now});
  state = connectionEvent(state, 'status-failure', {detail: '状態取得がタイムアウトしました。'});
  const view = connectionView(state);
  assert.equal(view.kind, 'unknown');
  assert.match(view.detail, /前回の応答確認/);
  assert.match(view.detail, /未接続とは限りません/);
});
test('printer errors are visible, and a later normal status clears the error', () => {
  let state = connectionEvent(initialConnection(), 'print-failure', {detail: '用紙切れ', code: 'PrinterStatusErrorNoPaper'});
  assert.equal(connectionView(state).kind, 'warning');
  assert.match(connectionView(state).detail, /用紙切れ/);
  state = connectionEvent(state, 'status-success', {now});
  assert.equal(connectionView(state).kind, 'confirmed');
});
test('returning from demo restores real evidence; page reload never restores old online state', () => {
  const state = connectionEvent(initialConnection(), 'print-success', {now});
  assert.equal(connectionView(state, {demo:true}).kind, 'demo');
  assert.equal(connectionView(state).kind, 'confirmed');
  assert.equal(connectionView(connectionEvent(state, 'stale')).kind, 'unverified');
  assert.equal(connectionView(initialConnection()).kind, 'unverified');
});
test('unknown or Japanese failure text cannot accidentally become a connected state', () => {
  for (const result of ['未接続', 'プリンターに接続できません', 'unknown', 'Failure']) {
    assert.throws(() => interpretReply({result}, 'status'));
  }
  assert.equal(interpretReply({result:'SUCCESS', code:'SUCCESS'}, 'status').result, 'SUCCESS');
  assert.equal(interpretReply({result:'SUCCESS', code:'SUCCESS'}, 'print').result, 'SUCCESS');
});
