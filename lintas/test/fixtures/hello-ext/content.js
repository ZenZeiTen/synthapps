const p = document.createElement('p'); p.textContent = 'Added by a Chrome extension.'; document.body.appendChild(p);
chrome.runtime.sendMessage('lintas-sw-check', (r) => { document.documentElement.dataset.lintasSw = JSON.stringify(r || { error: String(chrome.runtime.lastError && chrome.runtime.lastError.message) }); });
