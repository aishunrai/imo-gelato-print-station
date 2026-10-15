import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FLAVORS} from '../public/transport.mjs';
import {renderBundle} from '../../../scripts/bundle.mjs';

test('all original flavors are present before JavaScript runs, without duplicates', async () => {
  const html = await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const select = html.match(/<select id="flavor"[^>]*>([\s\S]*?)<\/select>/)[1];
  const values = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)];
  assert.deepEqual(values.map(match=>match[1]),FLAVORS);
  assert.deepEqual(values.map(match=>match[2]),FLAVORS);
  assert.equal(new Set(values.map(match=>match[1])).size,15);
  assert.match(html, /<script defer src="app\.bundle\.js"><\/script>/);
});
test('committed classic script matches every authored module', async () => {
  const actual = await readFile(new URL('../public/app.bundle.js',import.meta.url),'utf8');
  assert.equal(actual,await renderBundle());
});
