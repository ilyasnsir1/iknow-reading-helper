/* Maintainer drafts never pass through a content script or a course page. */
(() => {
  "use strict";
  const actions = new Set(["status", "load", "save", "image:add", "image:get", "image:remove"]);
  const own = sender => {
    try {
      const actual = new URL(sender?.url || ""), expected = new URL(chrome.runtime.getURL("changelog.html"));
      return sender?.id === chrome.runtime.id && actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && (!sender.frameId || sender.frameId === 0);
    } catch { return false; }
  };
  function request(message) {
    return new Promise(resolve => {
      let port, ended = false;
      const requestId = crypto.randomUUID();
      const finish = value => { if (ended) return; ended = true; clearTimeout(timer); try { port?.disconnect(); } catch {} resolve(value); };
      const timer = setTimeout(() => finish({ ok: false, code: "author_unavailable", error: "The local editor did not respond. Your changelog is unchanged." }), 15000);
      try {
        const payload = { type: "changelog:author", requestId, action: message.action };
        for (const key of ["draft", "expectedRevision", "base64", "fileName", "mime", "src"]) if (message[key] !== undefined) payload[key] = message[key];
        if (["save", "image:add", "image:remove"].includes(message.action)) payload.manual = true;
        if (JSON.stringify(payload).length > 1000000) throw Error("The draft or image is too large.");
        port = chrome.runtime.connectNative("de.iknow.lesehilfe");
        port.onDisconnect.addListener(() => { void chrome.runtime.lastError; finish({ ok: false, code: "author_unavailable", error: "The local changelog editor is unavailable." }); });
        port.onMessage.addListener(value => {
          if (value?.requestId !== requestId) return;
          if (value.type !== "changelog:author:result") { if (value.type === "error") finish({ ok: false, code: "author_unavailable" }); return; }
          if (JSON.stringify(value).length > 1000000) { finish({ ok: false, code: "author_response_invalid" }); return; }
          finish(value);
        });
        port.postMessage(payload);
      } catch (error) { finish({ ok: false, code: "author_unavailable", error: String(error.message || "The local editor is unavailable.").slice(0, 240) }); }
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "ikr:changelog:author") return;
    if (!own(sender) || !actions.has(message.action) || (["save", "image:add", "image:remove"].includes(message.action) && message.manual !== true)) {
      respond({ ok: false, code: "author_forbidden", error: "Open Changelog to edit your local draft." }); return;
    }
    void request(message).then(respond); return true;
  });
})();
