import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScaleLine,createScaleFramer,ftdiPayload,createScaleSession,createFtdiScale} from '../public/scale.mjs';
const frame=(weight=702,tare=334)=>`{0,16,~0,1,MO,"TL-280",Wg,${weight},Pt,${tare}`;
const ascii=value=>new TextEncoder().encode(value);

test('actual operator samples use Wg as net weight without subtracting Pt twice',()=>{
  assert.equal(parseScaleLine(frame(702,0)).weightG,702);
  assert.equal(parseScaleLine(frame(334,0)).tareG,0);
  assert.deepEqual(parseScaleLine(frame()),{weightG:702,tareG:334,raw:frame()});
});
test('strict TL-280 frame validation rejects ambiguous numbers and wrong mode/model',()=>{
  for(const line of [frame().replace('TL-280','TL-290'),frame().replace('Wg','Pi'),frame('2e3'),frame('-2'),frame('2.5'),frame(8000,334),frame(100,4001),frame()+',Wg,2000','noise'+frame()]) assert.throws(()=>parseScaleLine(line));
});
test('framing handles split CRLF, coalesced lines and a leading NUL; overlong line resynchronizes',()=>{
  const readings=[],errors=[],framer=createScaleFramer(r=>readings.push(r),e=>errors.push(e));
  framer.push(ascii('\0'+frame().slice(0,20)));framer.push(ascii(frame().slice(20)+'\r'));assert.equal(readings.length,0);
  framer.push(ascii('\n'+frame(2050,334)+'\r\n'));assert.deepEqual(readings.map(r=>r.weightG),[702,2050]);
  framer.push(ascii('x'.repeat(600)+'\n'+frame(2100,0)+'\r\n'));assert.equal(errors.length,1);assert.equal(readings.at(-1).weightG,2100);
  framer.push(ascii(frame().slice(0,10)));framer.reset();framer.push(ascii(frame(2000,0)+'\r\n'));assert.equal(readings.at(-1).weightG,2000);
});
test('FTDI removes status bytes from every packet and refuses line errors and truncated headers',()=>{
  const packet=new Uint8Array([1,0x60,65,66,67,68,69,70,2,0x60,71,72]);
  assert.equal(new TextDecoder().decode(ftdiPayload(new DataView(packet.buffer),8)),'ABCDEFGH');
  assert.equal(ftdiPayload(new DataView(new Uint8Array([1,0x60]).buffer),64).length,0);
  assert.throws(()=>ftdiPayload(new DataView(new Uint8Array([1]).buffer),64));
  assert.throws(()=>ftdiPayload(new DataView(new Uint8Array([1,0x62,65]).buffer),64));
});
test('capture requires a live connection; consumption, reconnect, expiry and clock reversal invalidate old weight',()=>{
  let clock=100000;const session=createScaleSession({now:()=>clock});
  assert.equal(session.accept(parseScaleLine(frame())),false);assert.throws(()=>session.snapshot());
  session.connect();session.accept(parseScaleLine(frame(2050,334)));assert.equal(session.snapshot().weightG,2050);
  session.pause('used');session.accept(parseScaleLine(frame(2100,0)));assert.throws(()=>session.snapshot());
  session.arm();assert.throws(()=>session.snapshot());session.accept(parseScaleLine(frame(2000,0)));
  clock+=29999;assert.equal(session.snapshot().weightG,2000);clock++;assert.throws(()=>session.snapshot());assert.equal(session.expire(),true);
  session.arm();session.accept(parseScaleLine(frame()));clock--;assert.equal(session.expire(),true);
  session.disconnect();session.connect();assert.throws(()=>session.snapshot());
});

function usbFixture() {
  const calls=[],reads=[],listeners={};let waiting=null,closed=false;
  const input={type:'bulk',direction:'in',endpointNumber:1,packetSize:64};
  const alternate={interfaceClass:255,alternateSetting:0,endpoints:[input]};
  const device={vendorId:0x0403,productId:0x6001,opened:false,
    configuration:{interfaces:[{interfaceNumber:0,alternate,alternates:[alternate]}]},
    async open(){this.opened=true;calls.push('open');},
    async claimInterface(n){calls.push(['claim',n]);},
    async releaseInterface(){calls.push('release');},
    async close(){this.opened=false;closed=true;waiting?.reject(new Error('closed'));waiting=null;},
    async controlTransferOut(setup){calls.push(setup);return {status:'ok'};},
    async transferIn(endpoint,size){calls.push(['read',endpoint,size]);if(reads.length)return reads.shift();return await new Promise((resolve,reject)=>waiting={resolve,reject});},
  };
  return {device,calls,listeners,get closed(){return closed;},
    usb:{async requestDevice(options){calls.push(options);return device;},addEventListener(name,fn){listeners[name]=fn;}},
    deliver(bytes){const response={status:'ok',data:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)};if(waiting){waiting.resolve(response);waiting=null;}else reads.push(response);},
  };
}
test('WebUSB driver configures exact FTDI 9600/8N1/no-flow settings and decodes real transfer',async()=>{
  const fixture=usbFixture(),readings=[],messages=[];
  const driver=createFtdiScale({usb:fixture.usb,onReading:r=>readings.push(r),onInvalid:assert.fail,onStatus:m=>messages.push(m),onDisconnect:m=>messages.push(m)});
  await driver.connect();
  assert.deepEqual(fixture.calls[0],{filters:[{vendorId:0x0403,productId:0x6001}]});
  const control=fixture.calls.filter(c=>c?.requestType);
  assert.deepEqual(control.map(c=>[c.request,c.value,c.index]),[[0,0,1],[1,0x0300,1],[2,0,1],[3,0x4138,0],[4,8,1],[0,1,1]]);
  fixture.deliver(new Uint8Array([1,0x60,...ascii(frame()+'\r\n')]));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(readings[0].weightG,702);assert.equal(readings[0].tareG,334);
  fixture.listeners.disconnect({device:fixture.device});await new Promise(resolve=>setImmediate(resolve));assert.equal(fixture.closed,true);
  assert.match(messages.at(-1),/外れました/);
});
test('claim failure, user cancellation and receive errors release USB and report failure',async()=>{
  for(const failure of ['claim','cancel','read']) {
    const fixture=usbFixture(),messages=[];
    if(failure==='claim')fixture.device.claimInterface=async()=>{throw new Error('in use');};
    if(failure==='cancel')fixture.usb.requestDevice=async()=>{const e=new Error('cancel');e.name='NotFoundError';throw e;};
    const driver=createFtdiScale({usb:fixture.usb,onReading:assert.fail,onInvalid:assert.fail,onStatus:()=>{},onDisconnect:m=>messages.push(m)});
    if(failure==='read'){await driver.connect();fixture.deliver(new Uint8Array([1]));await new Promise(resolve=>setImmediate(resolve));}
    else await assert.rejects(driver.connect());
    assert.ok(messages.length);if(failure!=='cancel')assert.equal(fixture.closed,true);
  }
});
