export const FLAVORS = ['ピスタチオ','チョコ','白桃','伊勢抹茶','ほうじ茶','ほし芋','ほし芋ﾌﾟﾚﾐｱﾑ','レモン','ミルク','苺','小倉餡','さくら','マンゴー','和栗','黒胡麻きなこ'];
import {WEIGHT_RULE} from './config.mjs';
import {assessWeight, formatManufacturedAt} from './production.mjs';
export const ENDPOINT = 'http://localhost:8088';
export const TEMPLATE = 'gelato-label-v3.lbx';

export function validateLabel({flavor, staff, copies, weightG, weightRule = WEIGHT_RULE, manufacturedAt, weightSource = 'manual', tareG, weightReceivedAt}) {
  if (!FLAVORS.includes(flavor)) throw new Error('フレーバーを選択してください。');
  if (typeof staff !== 'string' || !staff.trim()) throw new Error('担当者名を入力してください。');
  if (staff.trim().length > 40) throw new Error('担当者名は40文字以内で入力してください。');
  const n = Number(copies);
  if (String(copies).trim() === '' || !Number.isInteger(n) || n < 1 || n > 50) throw new Error('印刷枚数は1〜50の整数で入力してください。');
  const assessment = assessWeight(weightG, weightRule);
  if (!assessment.accepted) throw new Error(assessment.message);
  if (manufacturedAt !== undefined) formatManufacturedAt(manufacturedAt);
  if (!['manual','scale-usb'].includes(weightSource)) throw new Error('重量の取得方法が不正です。');
  if (weightSource==='scale-usb' && (!Number.isInteger(tareG) || tareG<0 || !Number.isFinite(Date.parse(weightReceivedAt)))) throw new Error('重量の受信情報がありません。再計量してください。');
  return {flavor, staff: staff.trim(), copies: n, weightG:assessment.weightG,
    weightSource, weightRule:{...weightRule}, judgment:'pass',
    ...(weightSource==='scale-usb'?{tareG,weightReceivedAt}:{}),
    ...(manufacturedAt === undefined ? {} : {manufacturedAt})};
}

export function printUrl(label) {
  const data = validateLabel(label);
  const url = new URL('/print', ENDPOINT);
  const manufactured = formatManufacturedAt(data.manufacturedAt);
  url.search = new URLSearchParams({filename: TEMPLATE, size: 'DieCutW62H29', copies: String(data.copies),
    text_FLAVOR:data.flavor, text_STAFF:`担当：${data.staff}`,
    text_MANUFACTURED_AT:manufactured, text_WEIGHT:`正味：${data.weightG} g`}).toString().replace(/\+/g, '%20');
  // Smooth Print decodes percent escapes; form-style '+' would print literally.
  // Replacing only raw '+' preserves a real plus sign encoded as %2B.
  return url.toString();
}

export class PrintError extends Error {
  constructor(message, uncertain = false, code = '') {
    super(message); this.name = 'PrintError'; this.uncertain = uncertain; this.code = code;
  }
}

// No XML outcome or unreadable cross-origin response can prove that no label printed.
export function interpretReply({result, code = '', valid = true}, operation) {
  if (!valid || !result) throw new PrintError('応答を確認できませんでした。ラベルが出たか確認してください。', operation === 'print');
  const noError = !code || code === 'SUCCESS';
  if (operation === 'print' && result === 'SUCCESS' && noError) return {result, code};
  if (operation === 'status' && noError && ['SUCCESS', 'Ready'].includes(result)) return {result, code};
  const known = {
    PrinterStatusErrorCoverOpen: 'プリンタのカバーを閉じてください。',
    PrinterStatusErrorNoPaper: 'ラベル用紙を補充してください。',
    PrinterStatusErrorPaperEmpty: 'ラベル用紙を補充してください。',
    ERROR_PRINTER_NO_SETTING: 'Smooth Printでプリンタを設定してください。',
    ERROR_COMMUNICATION_ERROR: 'プリンタとの通信に失敗しました。',
  };
  // Even a printer error may follow partial multi-copy output. Require physical reconciliation.
  throw new PrintError(known[code] || result, operation === 'print', code);
}

export async function requestPrinter(operation, label, {fetchImpl = fetch, parseXml, timeoutMs = 30000} = {}) {
  if (!['print','status'].includes(operation)) throw new Error('Unsupported operation');
  const url = operation === 'print' ? printUrl(label) : new URL('/getstatus', ENDPOINT).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
      signal: controller.signal, targetAddressSpace: 'loopback', redirect: 'error',
    });
    if (!response.ok || response.type === 'opaque') throw new PrintError('印刷サービスの応答を読み取れませんでした。', operation === 'print');
    return interpretReply(parseXml(await response.text()), operation);
  } catch (error) {
    if (error instanceof PrintError) throw error;
    const text = error.name === 'AbortError'
      ? '応答が時間内に届きませんでした。'
      : '端末内の印刷サービスに接続できませんでした。';
    throw new PrintError(text, operation === 'print');
  } finally { clearTimeout(timer); }
}

export function recoverHistory(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(r => r && typeof r.id === 'string' && typeof r.flavor === 'string' && typeof r.staff === 'string' && Number.isInteger(r.copies) && ['pending','success','confirmed','failed','unknown'].includes(r.status))
    .map(r => r.status === 'pending' ? {...r, status: 'unknown', detail: '画面が閉じられたため、印刷結果を確認してください。'} : {...r});
}

export function activeUncertain(rows) { return rows.find(r => ['pending','unknown'].includes(r.status)); }
