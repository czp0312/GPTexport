// background.js (MV3 service worker)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[gpt-export] installed');
});

function openAsWindow(sender, request) {
  const tabId = sender.tab?.id;
  const popupUrl = chrome.runtime.getURL(
    'pages/popup.html' + (tabId ? '?tab=' + tabId : '')
  );
  const sw = request.sw || 1920;
  const sh = request.sh || 1080;
  const pw = 384;
  const ph = 580;
  chrome.windows.create({
    url: popupUrl,
    type: 'popup',
    width: pw,
    height: ph,
    left: Math.max(0, sw - pw - 16),
    top: Math.max(20, Math.floor((sh - ph) / 3))
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'openPopup') {
    // Try native extension popup first (Chrome 127+)
    if (chrome.action && chrome.action.openPopup) {
      chrome.action.openPopup().then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        openAsWindow(sender, request);
        sendResponse({ ok: true });
      });
      return true; // keep message channel open for async response
    }
    openAsWindow(sender, request);
    sendResponse({ ok: true });
    return;
  }

  // keep channel behavior consistent
  sendResponse({ ok: false });
});
