// Answers the content script with the chrome.* APIs this background worker has, and tries the
// ones Lintas adds. Used by the end-to-end test.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg !== 'lintas-sw-check') return;
  const out = {
    windows: typeof chrome.windows, contextMenus: typeof chrome.contextMenus, identity: typeof chrome.identity,
    pageCapture: typeof chrome.pageCapture, userScripts: typeof chrome.userScripts,
    sidePanel: typeof chrome.sidePanel, offscreen: typeof chrome.offscreen, debugger: typeof chrome.debugger, alarms: typeof chrome.alarms, tabGroups: typeof chrome.tabGroups,
    captureVisibleTab: typeof (chrome.tabs && chrome.tabs.captureVisibleTab),
  };
  (async () => {
    try {
      if (out.identity === 'object') out.redirect = chrome.identity.getRedirectURL('cb');
      if (out.captureVisibleTab === 'function') out.capture = (await chrome.tabs.captureVisibleTab()).slice(0, 23);
      if (out.pageCapture === 'object') out.mhtml = (await chrome.pageCapture.saveAsMHTML({ tabId: sender.tab.id })).type;
      if (out.tabGroups === 'object') out.groupColor = chrome.tabGroups.Color.BLUE;
      if (out.alarms === 'object') out.alarm = await new Promise((res) => { chrome.alarms.onAlarm.addListener((a) => res(a.name)); chrome.alarms.create('tick', { when: Date.now() + 50 }); });
      if (out.debugger === 'object') {
        const target = { tabId: sender.tab.id };
        await chrome.debugger.attach(target, '1.3');
        out.debugger1plus1 = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: '1 + 1' })).result.value;
        await chrome.debugger.detach(target);
      }
    } catch (e) { out.error = String((e && e.message) || e); }
    reply(out);
  })();
  return true;
});
