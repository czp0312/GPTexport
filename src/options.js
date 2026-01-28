/* Options page logic. Keep ASCII-only to avoid encoding/mojibake issues. */

const DEFAULT_SETTINGS = {
  defaultFormat: 'json',
  fileNamePrefix: 'gpt_conversation',
  autoOpenAfterExport: false,
  enableChatGPT: true,
  enableGemini: true,
  enableBing: true
};

function showStatus(message, type) {
  const statusEl = document.getElementById('statusMessage');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status ${type || ''}`.trim();
  statusEl.style.display = 'block';
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, items => {
    document.getElementById('defaultFormat').value = items.defaultFormat;
    document.getElementById('fileNamePrefix').value = items.fileNamePrefix;
    document.getElementById('autoOpenAfterExport').checked = !!items.autoOpenAfterExport;
    document.getElementById('enableChatGPT').checked = !!items.enableChatGPT;
    document.getElementById('enableGemini').checked = !!items.enableGemini;
    document.getElementById('enableBing').checked = !!items.enableBing;
  });
}

function saveSettings() {
  const settings = {
    defaultFormat: document.getElementById('defaultFormat').value,
    fileNamePrefix: document.getElementById('fileNamePrefix').value,
    autoOpenAfterExport: !!document.getElementById('autoOpenAfterExport').checked,
    enableChatGPT: !!document.getElementById('enableChatGPT').checked,
    enableGemini: !!document.getElementById('enableGemini').checked,
    enableBing: !!document.getElementById('enableBing').checked
  };

  chrome.storage.sync.set(settings, () => {
    if (chrome.runtime.lastError) {
      showStatus('\u4fdd\u5b58\u5931\u8d25: ' + chrome.runtime.lastError.message, 'error');
      return;
    }
    showStatus('\u8bbe\u7f6e\u5df2\u4fdd\u5b58', 'success');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('saveSettings')?.addEventListener('click', saveSettings);
});