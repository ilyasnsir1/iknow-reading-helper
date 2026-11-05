(() => {
  'use strict';
  const pending = new Map(), cache = new Map(), readings = new Map();
  const readingCodes = new Set(['noji_reading_failed','noji_reading_busy','noji_reading_timeout','noji_reading_unavailable','noji_reading_superseded','noji_reading_invalid','component_installing','update_in_progress']);
  globalThis.IKnowReaderNeuralActivity = () => pending.size > 0;
  let port = null, bytes = 0;
  const validReading = text => typeof text === 'string' && text.length > 0 && text.length <= 80 && /^[\u3041-\u3096\u3099\u309a\u30a1-\u30faー]+$/u.test(text);
  const validJapanese = text => text === undefined || typeof text === 'string' && text.length > 0 && text.length <= 160 && /^[\u3041-\u3096\u3099\u309a\u30a1-\u30fa\u3400-\u9fff\uf900-\ufaffー々〆〇ヶ0-9 ]+$/u.test(text);
  function validWave(message, rate) {
    if (typeof message.data !== 'string' || message.data.length < 64 || message.data.length > 950000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data) || message.data.length % 4) return false;
    try {
      const wave = atob(message.data), data = new DataView(Uint8Array.from(wave, value => value.charCodeAt(0)).buffer);
      return wave.length >= 46 && wave.length % 2 === 0 && wave.startsWith('RIFF') && wave.slice(8, 16) === 'WAVEfmt ' && wave.slice(36, 40) === 'data' &&
        data.getUint32(4, true) + 8 === wave.length && data.getUint32(16, true) === 16 && data.getUint16(20, true) === 1 &&
        data.getUint16(22, true) === 1 && data.getUint32(24, true) === rate && data.getUint32(28, true) === rate * 2 &&
        data.getUint16(32, true) === 2 && data.getUint16(34, true) === 16 && data.getUint32(40, true) === wave.length - 44 &&
        Math.abs((wave.length - 44) / (rate * 2) - message.duration) <= 1 / rate;
    } catch { return false; }
  }
  function trusted(sender, sentence, reading) {
    if (sender.id !== chrome.runtime.id || (sender.frameId ?? 0) !== 0) return false;
    try {
      const url = new URL(sender.url || sender.tab?.url || '');
      if (reading || (sentence && url.protocol === 'chrome-extension:')) return url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id && url.pathname === '/study.html';
      return url.protocol === 'https:' && /^(?:(?:en|ja)\.)?iknow\.jp$/.test(url.hostname) && !url.port && /^\/courses\/\d+(?:\/|$)/.test(url.pathname);
    } catch { return false; }
  }
  function connect() {
    if (port) return port;
    const current = chrome.runtime.connectNative('de.iknow.lesehilfe'); port = current;
    current.onMessage.addListener(message => {
      const request = pending.get(message?.requestId); if (!request) return;
      if (request.reading) {
        if (message.type !== 'noji-reading-result' && message.type !== 'error') return;
        pending.delete(message.requestId); clearTimeout(request.timer);
        const romaji = message.romaji;
        if (message.ok === true && typeof romaji === 'string' && romaji.length <= 2000 && /[a-z]/i.test(romaji) && /^[a-z0-9 ,.!?;:'()"-]+$/i.test(romaji)) {
          const value={ok:true,romaji};readings.delete(request.key);readings.set(request.key,value);
          while(readings.size>256)readings.delete(readings.keys().next().value);
          request.resolve(value);
        } else request.resolve({ ok:false, code: readingCodes.has(message.code) ? message.code : 'noji_reading_failed' });
        return;
      }
      if (message.type !== 'word-neural-result') return;
      pending.delete(message.requestId); clearTimeout(request.timer);
      const rate = request.sentence ? 24000 : 44100;
      if (message.ok && message.voice === request.voice && message.sampleRate === rate && Number.isFinite(message.duration) && message.duration > 0 && message.duration <= (request.sentence ? 14 : 8) && validWave(message, rate)) {
        const value = { ok:true, data:message.data, sampleRate:message.sampleRate, duration:message.duration, voice:String(message.voice || '').slice(0, 80), voiceVersion:String(message.voiceVersion || '').slice(0, 100), cached:message.cached === true };
        if (cache.has(request.key)) bytes -= cache.get(request.key).data.length;
        cache.delete(request.key); cache.set(request.key, value); bytes += value.data.length;
        while (cache.size > 192 || bytes > 12 * 1024 * 1024) { const first = cache.keys().next().value; bytes -= cache.get(first).data.length; cache.delete(first); }
        request.resolve(value);
      } else request.resolve({ ok:false, code:String(message.code || 'word_neural_failed'), error:String(message.error || '').slice(0, 200) });
    });
    current.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message || 'Local neural voice disconnected.';
      if (port === current) port = null;
      for (const [id, request] of pending) { clearTimeout(request.timer); request.resolve({ ok:false, code:'word_neural_missing', error:reason }); pending.delete(id); }
    });
    return current;
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    const sentence = message?.type === 'ikr:sentence:neural';
    const reading = message?.type === 'ikr:noji:reading';
    if (!reading && !sentence && message?.type !== 'ikr:word:neural') return;
    const text = sentence || reading ? globalThis.IKnowReaderCore?.neuralSentenceText(message.text) : message.text;
    const validText = sentence || reading ? Boolean(text) : validReading(text) && validJapanese(message.japanese);
    const validVoice = reading || (['female','male'].includes(message.voice) && [.7,.85,1].includes(message.speed));
    if (!trusted(sender, sentence, reading) || !validText || !validVoice) { respond({ok:false,code:reading?'invalid_reading':sentence?'invalid_sentence':'invalid_word'}); return; }
    if (globalThis.IKnowReaderUpdates?.busy || globalThis.IKnowReaderComponents?.busy) { respond({ok:false,code:'update_in_progress',error:'Reading Helper is installing an update or model.'}); return; }
    const key = reading ? JSON.stringify(['reading', text]) : JSON.stringify([sentence, message.voice, message.speed, text, sentence ? '' : message.japanese || '']);
    if(reading&&readings.has(key)){const value=readings.get(key);readings.delete(key);readings.set(key,value);respond({...value,cached:true});return;}
    if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); respond({...value,cached:true}); return; }
    const existing = [...pending.values()].find(value => value.key === key);
    if (existing) { void existing.work.then(respond); return true; }

    while (pending.size >= 8) {
      const id = pending.keys().next().value, old = pending.get(id);
      clearTimeout(old.timer); pending.delete(id); old.resolve({ok:false,code:old.reading?'noji_reading_superseded':'word_neural_superseded'});
    }
    const requestId = crypto.randomUUID(); let resolve;
    const work = new Promise(done => { resolve = done; });
    const request = {key,sentence,reading,voice:message.voice,work,resolve,timer:setTimeout(() => { pending.delete(requestId); resolve({ok:false,code:reading?'noji_reading_timeout':'word_neural_timeout'}); },reading?14000:120000)};
    pending.set(requestId,request);
    try { connect().postMessage(reading ? {type:'noji-reading',requestId,text} : {type:'word-neural',requestId,text,...(sentence?{sentence:true}:{japanese:message.japanese}),speed:message.speed,voice:message.voice}); }
    catch { pending.delete(requestId); clearTimeout(request.timer); resolve({ok:false,code:'word_neural_missing'}); }
    void work.then(value => {
      if (!value.ok && !['word_neural_superseded','noji_reading_superseded'].includes(value.code)) globalThis.IKnowReaderDiagnostics?.record('word-audio', value.code || (reading?'noji_reading_failed':'word_neural_failed'), reading?undefined:globalThis.IKnowReaderCore?.courseIdFromUrl(sender.url || sender.tab?.url || ''));
      respond(value);
    }); return true;
  });
})();
