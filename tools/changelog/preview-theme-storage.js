/* Local preview preference only. This file is never part of an extension build. */
(() => {
  'use strict';
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  const key = 'ikr-layout-review:theme', listeners = new Set();
  const read = () => { try { return localStorage.getItem(key) || 'paper'; } catch { return 'paper'; } };
  const notify = (oldValue, newValue) => listeners.forEach(fn => fn({iknowReaderTheme:{oldValue,newValue}}, 'local'));
  globalThis.chrome = {...globalThis.chrome, storage:{local:{
    async get() { return {iknowReaderTheme:read()}; },
    async set(value) { if (!Object.hasOwn(value, 'iknowReaderTheme')) return; const previous=read(); localStorage.setItem(key,value.iknowReaderTheme); notify(previous,value.iknowReaderTheme); }
  }, onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
  const version=document.querySelector('meta[name="ikr-changelog-display-version"]')?.content;
  if(typeof version==='string'&&/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version))globalThis.chrome.runtime={getManifest:()=>({version})};
  addEventListener('storage', event => { if(event.key === key) notify(event.oldValue,event.newValue); });
})();
