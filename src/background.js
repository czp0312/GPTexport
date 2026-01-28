// background.js (MV3 service worker)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[gpt-export] installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'openPopup') {
    chrome.action.openPopup();
    sendResponse({ ok: true });
    return;
  }

  if (request && request.action === 'exportComplete') {
    console.log('[gpt-export] export complete');
    sendResponse({ ok: true });
    return;
  }

  // keep channel behavior consistent
  sendResponse({ ok: false });
});

chrome.action.onClicked.addListener(() => {
  chrome.action.openPopup();
});