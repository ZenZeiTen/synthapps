// Answers the content script with the chrome.* APIs this background worker has, and tries the
// ones Lintas adds. Used by the end-to-end test.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg !== 'lintas-sw-check') return;
  const out = {
    windows: typeof chrome.windows, contextMenus: typeof chrome.contextMenus, identity: typeof chrome.identity,
    pageCapture: typeof chrome.pageCapture, userScripts: typeof chrome.userScripts,
    captureVisibleTab: typeof (chrome.tabs && chrome.tabs.captureVisibleTab),
  };
  (async () => {
    try {
      if (out.identity === 'object') out.redirect = chrome.identity.getRedirectURL('cb');
      if (out.captureVisibleTab === 'function') out.capture = (await chrome.tabs.captureVisibleTab()).slice(0, 23);
      if (out.pageCapture === 'object') out.mhtml = (await chrome.pageCapture.saveAsMHTML({ tabId: sender.tab.id })).type;
    } catch (e) { out.error = String((e && e.message) || e); }
    reply(out);
  })();
  return true;
});
