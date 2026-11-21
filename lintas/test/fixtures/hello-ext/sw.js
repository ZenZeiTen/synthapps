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
      if (out.tabGroups === 'object') {
        out.groupColor = chrome.tabGroups.Color.BLUE;
        const created = new Promise((res) => chrome.tabGroups.onCreated.addListener((g) => res(g.color)));
        const removed = new Promise((res) => chrome.tabGroups.onRemoved.addListener((g) => res(g.title)));
        const gid = await chrome.tabs.group({ tabIds: [sender.tab.id] });
        await chrome.tabGroups.update(gid, { title: 'Test group', color: 'green' });
        const g = await chrome.tabGroups.get(gid);
        out.group = { created: await created, title: g.title, color: g.color, tabInGroup: (await chrome.tabs.get(sender.tab.id)).groupId === gid,
          queried: (await chrome.tabGroups.query({ title: 'Test*' })).length };
        await chrome.tabs.ungroup(sender.tab.id);
        out.group.removed = await removed;
        out.group.after = (await chrome.tabs.get(sender.tab.id)).groupId;
      }
      if (out.sidePanel === 'object') {
        await chrome.sidePanel.setOptions({ tabId: sender.tab.id, path: 'panel.html', enabled: true });
        await chrome.sidePanel.open({ tabId: sender.tab.id });
        const ctx = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
        out.panel = ctx.filter((c) => c.tabId === sender.tab.id && c.documentUrl.endsWith('/panel.html')).length;
        await chrome.sidePanel.close({ tabId: sender.tab.id });
        out.panelAfterClose = (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length;
        out.background = (await chrome.runtime.getContexts({ contextTypes: ['BACKGROUND'] })).length;
      }
      if (out.alarms === 'object') out.alarm = await new Promise((res) => { chrome.alarms.onAlarm.addListener((a) => res(a.name)); chrome.alarms.create('tick', { when: Date.now() + 50 }); });
      if (out.debugger === 'object') {
        const target = { tabId: sender.tab.id };
        await chrome.debugger.attach(target, '1.3');
        out.debugger1plus1 = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: '1 + 1' })).result.value;
        await chrome.debugger.detach(target);
      }
      // Native messaging (how Claude in Chrome talks to Claude Desktop): a message over 64 KB with non-ASCII text, there and back
      if (typeof chrome.runtime.connectNative === 'function') {
        out.native = await new Promise((res) => {
          const port = chrome.runtime.connectNative('com.lintas.test_echo');
          port.onMessage.addListener((m) => { res({ text: m.text, size: m.big.length, by: m.echoedBy, origin: m.args[0] }); port.disconnect(); });
          port.onDisconnect.addListener(() => res({ disconnected: (chrome.runtime.lastError && chrome.runtime.lastError.message) || true }));
          port.postMessage({ text: 'Halo “dunia” ✓', big: 'x'.repeat(300000) });
        });
      }
    } catch (e) { out.error = String((e && e.message) || e); }
    reply(out);
  })();
  return true;
});

// Keyboard shortcut from the manifest's "commands": marks the active page (end-to-end test)
// (chrome.commands exists in the worker only with the sandbox on, as the other extra APIs)
if (chrome.commands && chrome.commands.onCommand) chrome.commands.onCommand.addListener((name, tab) => {
  if (tab && tab.id >= 0) chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (n) => { document.documentElement.dataset.lintasCmd = n; }, args: [name] });
});
