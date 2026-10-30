// TL-280 (8 kg), FTDI 0403:6001. No serial commands are written to the scale.
export const SCALE_USB_FILTER = Object.freeze({vendorId:0x0403, productId:0x6001});
export const SCALE_MAX_AGE_MS = 30000;

export function parseScaleLine(line) {
  const clean = line.replace(/^\0+/, '').trim();
  const fields = clean.split(',').map(value => value.trim());
  if (fields.length !== 10 || fields[0] !== '{0' || fields[1] !== '16' || fields[2] !== '~0' || fields[3] !== '1'
    || fields[4] !== 'MO' || fields[5] !== '"TL-280"' || fields[6] !== 'Wg' || fields[8] !== 'Pt'
    || !/^\d{1,6}$/.test(fields[7]) || !/^\d{1,6}$/.test(fields[9])) throw new Error('TL-280の重量データを確認できません。載せ直して再計量してください。');
  const weightG = Number(fields[7]), tareG = Number(fields[9]);
  if (weightG + tareG > 8000 || tareG > 4000) throw new Error('8kg仕様の計量範囲を超えるデータです。');
  return {weightG, tareG, raw:clean}; // Wg is already net; never subtract Pt again.
}

export function createScaleFramer(onReading, onInvalid) {
  let pending = '', dropping = false;
  return {
    reset() { pending = ''; dropping = false; },
    push(bytes) {
      for (const byte of bytes) {
        if (byte === 10) {
          if (!dropping && pending.trim()) {
            try { onReading(parseScaleLine(pending)); }
            catch (error) { onInvalid(error.message); }
          }
          pending = ''; dropping = false;
        } else if (!dropping) {
          if ((byte < 32 && byte !== 0 && byte !== 13) || byte > 126 || pending.length >= 512) {
            pending = ''; dropping = true; onInvalid('受信データが不正です。再計量してください。');
          } else pending += String.fromCharCode(byte);
        }
      }
    },
  };
}

export function ftdiPayload(view, packetSize) {
  if (!Number.isInteger(packetSize) || packetSize < 3) throw new Error('USBパケットサイズが不正です。');
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength), payload = [];
  for (let offset = 0; offset < bytes.length; offset += packetSize) {
    const end = Math.min(offset + packetSize, bytes.length);
    if (end - offset < 2 || (bytes[offset+1] & 0x1e)) throw new Error('USBシリアルの受信エラーです。再接続してください。');
    // Every USB packet, not just every transfer, starts with two FTDI status bytes.
    for (let i = offset+2; i < end; i++) payload.push(bytes[i]);
  }
  return new Uint8Array(payload);
}

export function createScaleSession({now = () => Date.now()} = {}) {
  let connected = false, armed = false, reading = null, reason = 'スケールを接続してください。';
  return {
    get connected() { return connected; },
    get armed() { return armed; },
    get reading() { return reading; },
    get reason() { return reason; },
    connect() { connected = true; armed = true; reading = null; reason = '接続済みです。空ケースを風袋引きして計量してください。'; },
    disconnect(message = 'スケールが切断されました。再接続してください。') { connected = false; armed = false; reading = null; reason = message; },
    invalidate(message = '重量を再取得してください。') { reading = null; reason = message; },
    pause(message) { armed = false; reading = null; reason = connected ? message : 'スケールを接続してください。'; },
    arm() {
      reading = null; armed = connected;
      reason = connected ? 'ケースを載せ替えて、風袋引き後に計量してください。' : 'スケールを接続してください。';
    },
    accept(value) {
      if (!connected || !armed) return false;
      reading = {...value, receivedAt:new Date(now()).toISOString(), receivedMs:now()};
      reason = 'スケールから重量を取得しました。'; return true;
    },
    snapshot() {
      const age = reading ? now() - reading.receivedMs : Infinity;
      if (!connected || !armed || !reading || age < 0 || age >= SCALE_MAX_AGE_MS) throw new Error('有効な重量がありません。「次の計量を開始」から再計量してください。');
      return {weightG:reading.weightG, tareG:reading.tareG, weightReceivedAt:reading.receivedAt, weightSource:'scale-usb'};
    },
    expire() {
      if (reading && (now() - reading.receivedMs >= SCALE_MAX_AGE_MS || now() < reading.receivedMs)) {
        reading = null; armed = false; reason = '受信から30秒経過しました。「次の計量を開始」から再計量してください。'; return true;
      }
      return false;
    },
  };
}

export function createFtdiScale({usb, onReading, onInvalid, onStatus, onDisconnect}) {
  let device = null, interfaceNumber = null, generation = 0, opening = false;
  const framer = createScaleFramer(onReading, onInvalid);
  async function closeDevice(target, number) {
    if (!target) return;
    // Closing also cancels a pending transferIn. Do not await the read loop first.
    try { if (target.opened) await target.close(); } catch {}
  }
  async function disconnect(message = 'スケールを切断しました。') {
    generation++; framer.reset();
    const previous = device, previousInterface = interfaceNumber;
    device = null; interfaceNumber = null;
    onDisconnect(message); await closeDevice(previous, previousInterface);
  }
  usb?.addEventListener('disconnect', event => {
    if (event.device === device) void disconnect('USB接続が外れました。再接続してください。');
  });
  return {
    get supported() { return !!usb?.requestDevice; },
    disconnect,
    resetFrame() { framer.reset(); },
    async connect() {
      if (!usb?.requestDevice) throw new Error('このブラウザではUSB接続を利用できません。AndroidのChromeでこのページを開いてください。');
      if (opening || device) return;
      opening = true; const ticket = ++generation;
      let selected, selectedInterface;
      try {
        selected = await usb.requestDevice({filters:[{...SCALE_USB_FILTER}]});
        if (ticket !== generation) return;
        if (selected.vendorId !== SCALE_USB_FILTER.vendorId || selected.productId !== SCALE_USB_FILTER.productId) throw new Error('対象のFTDIケーブルではありません。');
        await selected.open();
        if (!selected.configuration) await selected.selectConfiguration(1);
        const interfaces = selected.configuration.interfaces;
        if (interfaces.length !== 1) throw new Error('このページは1ポートのFTDIケーブル専用です。');
        const iface = interfaces[0];
        const alternate = iface.alternates.find(alt => alt.interfaceClass === 255 && alt.endpoints.some(ep => ep.type === 'bulk' && ep.direction === 'in'));
        if (!alternate) throw new Error('FTDIの受信ポートを確認できません。');
        selectedInterface = iface.interfaceNumber;
        await selected.claimInterface(selectedInterface);
        if (iface.alternate.alternateSetting !== alternate.alternateSetting) await selected.selectAlternateInterface(selectedInterface, alternate.alternateSetting);
        const input = alternate.endpoints.find(ep => ep.type === 'bulk' && ep.direction === 'in');
        if (input.packetSize !== 64) throw new Error('このページで対応していないFTDIパケットサイズです。');
        const control = async (request, value, index = selectedInterface+1) => {
          const result = await selected.controlTransferOut({requestType:'vendor',recipient:'device',request,value,index});
          if (result.status !== 'ok') throw new Error('USBの通信設定に失敗しました。');
        };
        await control(0,0); // FTDI reset (volatile UART state only)
        await control(1,0x0300); // DTR/RTS disabled
        await control(2,0); // no flow control
        await control(3,0x4138,0); // 3MHz / 312.5 = 9600 baud, FT232R
        await control(4,8); // 8 data bits, no parity, 1 stop bit
        await control(0,1); // purge stale RX bytes before accepting a measurement
        if (ticket !== generation) { await closeDevice(selected,selectedInterface); return; }
        device = selected; interfaceNumber = selectedInterface; framer.reset();
        onStatus('connected');
        void (async () => {
          try {
            while (ticket === generation && device === selected) {
              const result = await selected.transferIn(input.endpointNumber,input.packetSize*16);
              if (ticket !== generation || device !== selected) break;
              if (result.status !== 'ok' || !result.data) throw new Error('USBの重量データを受信できません。');
              framer.push(ftdiPayload(result.data,input.packetSize));
            }
          } catch (error) {
            if (ticket === generation) await disconnect(`受信を停止しました。${error.message}`);
          }
        })();
      } catch (error) {
        await closeDevice(selected,selectedInterface);
        if (ticket === generation) {
          onDisconnect(error.name === 'NotFoundError' ? '機器の選択をキャンセルしました。' : '接続できません。Terminalの接続を解除して再試行してください。');
          const detail = error.name === 'NotFoundError' ? '機器の選択をキャンセルしました。' : `接続できません。Terminalを切断し、ChromeへのUSBアクセスを許可してください。解消しない場合は「診断情報」を確認してください。（${error.name || 'Error'}: ${error.message}）`;
          throw new Error(detail);
        }
      } finally { opening = false; }
    },
  };
}
