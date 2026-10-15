import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWeight, weightLimits, formatManufacturedAt} from '../public/production.mjs';
import {validateLabel, printUrl} from '../public/transport.mjs';
const input = {flavor:'ミルク', staff:'担当', copies:1, weightG:2000};

test('range boundaries are inclusive and no underweight tolerance is allowed', () => {
  for (const g of [2000,2001,2050,2099,2100]) assert.equal(assessWeight(g).accepted,true);
  for (const g of [1,1900,1999,2101,8000]) assert.equal(assessWeight(g).accepted,false);
});
test('empty, non-whole-gram, non-finite and malformed values are rejected', () => {
  for (const g of [null,undefined,'',' ',NaN,Infinity,'2e3','2000g','2,000',2000.5,0,-1]) assert.equal(assessWeight(g).accepted,false);
});
test('configuration changes calculate an upper bound; record rules can retain the previous standard', () => {
  const nextRule = {baseWeightG:1500, upperTolerancePercent:3};
  assert.deepEqual(weightLimits(nextRule), {minG:1500,maxG:1545});
  assert.equal(assessWeight(1545,nextRule).accepted,true);
  assert.equal(assessWeight(1546,nextRule).accepted,false);
  assert.equal(validateLabel({...input,weightRule:{baseWeightG:2000,upperTolerancePercent:5}}).weightG,2000);
  for (const rule of [null,{baseWeightG:0,upperTolerancePercent:5},{baseWeightG:2000,upperTolerancePercent:-1}]) assert.throws(()=>weightLimits(rule));
});
test('manufacture display uses JST across a UTC date boundary and midnight is 00, not 24', () => {
  assert.equal(formatManufacturedAt('2026-10-14T15:05:00.000Z'),'2026/10/15 00:05');
  assert.equal(formatManufacturedAt('2026-10-15T14:59:00.000Z'),'2026/10/15 23:59');
  assert.throws(()=>printUrl(input));
  assert.throws(()=>formatManufacturedAt('not-a-date'));
});
test('one-case weight has no dependency on the number of duplicate labels', () => {
  assert.equal(validateLabel({...input,copies:5}).weightG,2000);
  assert.throws(()=>validateLabel({...input,weightG:10000,copies:5}));
});
