/* Explicit, extension-page-only controls for durable local word preparation. */
(() => {
 'use strict';
 const pending = new Map(); let port = null;
 globalThis.IKnowReaderWordPreparationActivity = () => pending.size > 0;
 const actions = { 'ikr:word:prepare:start': 'word-neural-prepare', 'ikr:word:prepare:status': 'word-neural-prepare-status', 'ikr:word:prepare:pause': 'word-neural-prepare-pause' };
 const reading = value => typeof value === 'string' && value.length > 0 && value.length <= 80 && /^[\u3041-\u3096\u3099\u309a\u30a1-\u30faー]+$/u.test(value);
 const japanese = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && /^[\u3041-\u3096\u3099\u309a\u30a1-\u30fa\u3400-\u9fff\uf900-\ufaffー々〆〇ヶ0-9 ]+$/u.test(value);
 function trusted(sender) { try { const url = new URL(sender.url || ''), own = new URL(chrome.runtime.getURL('word-voice.html')); return sender.id === chrome.runtime.id && url.protocol === own.protocol && url.host === own.host && url.pathname === '/word-voice.html'; } catch { return false; } }
 function connect() {
  if (port) return port;
  const current = chrome.runtime.connectNative('de.iknow.lesehilfe'); port = current;
  current.onMessage.addListener(message => {
   if (message?.type !== 'word-neural-prepare-result') return;
   const request = pending.get(message.requestId); if (!request) return;
   pending.delete(message.requestId); clearTimeout(request.timer);
   if (message.ok && message.state && typeof message.state === 'object' && JSON.stringify(message.state).length <= 20000) request.resolve({ ok: true, state: message.state });
   else request.resolve({ ok: false, code: String(message.code || 'word_prepare_failed').slice(0,80), error: String(message.error || '').slice(0,300) });
  });
  current.onDisconnect.addListener(() => { const error = chrome.runtime.lastError?.message || 'The local helper disconnected.'; if (port === current) port = null; for (const request of pending.values()) { clearTimeout(request.timer); request.resolve({ok:false,code:'word_neural_missing',error}); } pending.clear(); });
  return current;
 }
 chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const type = actions[message?.type]; if (!type) return;
  const start = type === 'word-neural-prepare';
  if (!trusted(sender) || start && (message.manual !== true || !/^[1-9][0-9]{0,8}$/.test(String(message.courseId)) || !['female','male'].includes(message.voice) || ![1,.85,.7].includes(message.speed) || !/^(?:[a-f0-9]{8}|[a-f0-9]{64})$/.test(message.sourceSignature || '') || !Array.isArray(message.words) || !message.words.length || message.words.length > 2000 || !message.words.every(word => word && reading(word.text) && japanese(word.japanese))) || !start && !/^[a-f0-9]{64}$/.test(message.jobId || '')) { respond({ok:false,code:'invalid_word_prepare'}); return; }
  if (pending.size >= 12) { respond({ok:false,code:'word_prepare_busy'}); return; }
  if (start && globalThis.IKnowReaderUpdates?.busy) { respond({ok:false,code:'update_in_progress',error:'Reading Helper is installing an update.'}); return; }
  const requestId = crypto.randomUUID(); let resolve;
  const work = new Promise(done => { resolve = done; });
  const timer = setTimeout(() => { pending.delete(requestId); resolve({ok:false,code:'word_prepare_timeout'}); },15000);
  pending.set(requestId,{resolve,timer});
  try { connect().postMessage(start ? {type,requestId,manual:true,courseId:String(message.courseId),voice:message.voice,speed:message.speed,sourceSignature:message.sourceSignature,words:message.words.map(({text,japanese})=>({text,japanese}))} : {type,requestId,jobId:message.jobId}); }
  catch { pending.delete(requestId); clearTimeout(timer); resolve({ok:false,code:'word_neural_missing'}); }
  void work.then(value => { if (!value.ok) globalThis.IKnowReaderDiagnostics?.record('word-preparation', value.code || 'word_prepare_failed', message.courseId); respond(value); }); return true;
 });
})();
