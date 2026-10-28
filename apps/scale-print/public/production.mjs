import {WEIGHT_RULE} from './config.mjs';

export function weightLimits(rule = WEIGHT_RULE) {
  if (!rule || !Number.isSafeInteger(rule.baseWeightG) || rule.baseWeightG <= 0 ||
      !Number.isFinite(rule.upperTolerancePercent) || rule.upperTolerancePercent < 0 || rule.upperTolerancePercent > 100) {
    throw new Error('重量基準の設定を確認してください。');
  }
  return {minG: rule.baseWeightG, maxG: Math.floor(rule.baseWeightG * (100 + rule.upperTolerancePercent) / 100)};
}

export function assessWeight(raw, rule = WEIGHT_RULE) {
  const {minG, maxG} = weightLimits(rule);
  const value = raw == null ? '' : String(raw).trim();
  if (!value) return {status:'empty', accepted:false, message:'正味重量を入力してください。', minG, maxG};
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    return {status:'invalid', accepted:false, message:'重量はg単位の正の整数で入力してください。', minG, maxG};
  }
  const weightG = Number(value);
  if (weightG < minG) return {status:'under', accepted:false, message:`基準未満です。あと${minG - weightG}g必要です。`, weightG, minG, maxG};
  if (weightG > maxG) return {status:'over', accepted:false, message:`上限超過です。${weightG - maxG}g多くなっています。`, weightG, minG, maxG};
  return {status:'pass', accepted:true, message:'基準内です。ラベルを発行できます。', weightG, minG, maxG};
}

export function formatManufacturedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(new Date(value).valueOf())) {
    throw new Error('製造日時がありません。新しいラベルとして発行してください。');
  }
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).format(new Date(value));
}
