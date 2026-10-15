import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {printUrl, TEMPLATE} from '../public/transport.mjs';

function readZipEntry(zip, target) {
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset+8), size = zip.readUInt32LE(offset+18);
    const nameSize = zip.readUInt16LE(offset+26), extraSize = zip.readUInt16LE(offset+28);
    const name = zip.subarray(offset+30,offset+30+nameSize).toString('utf8');
    const start = offset+30+nameSize+extraSize;
    if (name === target) {
      const data = zip.subarray(start,start+size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    offset = start+size;
  }
  throw new Error(`Missing ${target}`);
}
test('shipped Brother template has every object addressed by the print request', async () => {
  const data = await readFile(new URL(`../public/assets/labels/${TEMPLATE}`, import.meta.url));
  const xml = readZipEntry(data,'label.xml');
  const fields = [...xml.matchAll(/objectName="([^"]+)"/g)].map(match=>match[1]).sort();
  const url = new URL(printUrl({flavor:'ミルク',staff:'試験',copies:1,weightG:2100,manufacturedAt:'2026-10-15T00:00:00.000Z'}));
  const addressed = [...url.searchParams.keys()].filter(key=>key.startsWith('text_')).map(key=>key.slice(5)).sort();
  assert.deepEqual(fields, addressed);
  assert.deepEqual(fields,['FLAVOR','MANUFACTURED_AT','STAFF','WEIGHT']);
  assert.doesNotMatch(xml, /text:datetime|atPrint="true"/);
  assert.match(xml, /width="175\.7pt" height="81\.8pt"/);
});
