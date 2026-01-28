(() => {
  if (window.__gptExportContentScriptLoaded) return;
  window.__gptExportContentScriptLoaded = true;

  const LOG_PREFIX = '[GPT Export]';

  function log(...args) {
    try {
      console.log(LOG_PREFIX, ...args);
    } catch (_) {}
  }

  function warn(...args) {
    try {
      console.warn(LOG_PREFIX, ...args);
    } catch (_) {}
  }

  function error(...args) {
    try {
      console.error(LOG_PREFIX, ...args);
    } catch (_) {}
  }

  window.addEventListener('error', e => {
    error('Unhandled error:', e?.message || e, e?.error);
  });
  window.addEventListener('unhandledrejection', e => {
    error('Unhandled rejection:', e?.reason || e);
  });

  function normalizeExtractedText(text, maxLength = 20000) {
    let out = String(text || '');
    out = out.replace(/\u00a0/g, ' ');
    out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    out = out.replace(/[ \t]+\n/g, '\n');
    out = out.replace(/\n{3,}/g, '\n\n');
    out = out.trim();
    if (Number.isFinite(maxLength) && out.length > maxLength) out = out.slice(0, maxLength).trim();
    return out;
  }

  function detectPlatform() {
    const host = String(location.hostname || '').toLowerCase();
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('bing.com')) return 'bing';
    if (host.includes('copilot.microsoft.com')) return 'copilot';
    return 'generic';
  }

  function extractHtmlForTurn(turnEl) {
    const htmlSelectors = ['.markdown', '[class*="markdown"]', '.prose', '.whitespace-pre-wrap'];
    let container = null;
    for (const sel of htmlSelectors) {
      const el = turnEl.querySelector(sel);
      if (el) {
        container = el;
        break;
      }
    }
    const target = container || turnEl;
    const clone = target.cloneNode(true);
    clone.querySelectorAll('button, [role=\"button\"], svg, textarea, input, select, [data-testid=\"copy-button\"]').forEach(el => el.remove());
    return clone.innerHTML || '';
  }

  function extractTextForTurn(turnEl) {
    const textSelectors = ['.markdown', '[class*="markdown"]', '.prose', '.whitespace-pre-wrap'];
    for (const sel of textSelectors) {
      const el = turnEl.querySelector(sel);
      if (el) {
        const txt = normalizeExtractedText(el.innerText || el.textContent, 20000);
        if (txt) return txt;
      }
    }
    const clone = turnEl.cloneNode(true);
    clone.querySelectorAll('button, [role=\"button\"], svg, textarea, input, select, [data-testid=\"copy-button\"]').forEach(el => el.remove());
    return normalizeExtractedText(clone.innerText || clone.textContent, 20000);
  }

  function extractChatGPTDialogues() {
    const selectors = [
      'article[data-testid^=\"conversation-turn\"][data-message-author-role]',
      'article[data-testid^=\"conversation-turn\"]',
      '[data-testid=\"conversation-turn\"]',
      'div[data-message-author-role]'
    ];

    let turns = [];
    for (const sel of selectors) {
      turns = Array.from(document.querySelectorAll(sel));
      if (turns.length) break;
    }
    if (!turns.length) return [];

    const dialogues = [];
    for (const turn of turns) {
      const roleAttr =
        turn.getAttribute('data-message-author-role') ||
        turn.querySelector?.('[data-message-author-role]')?.getAttribute?.('data-message-author-role') ||
        '';
      const role = String(roleAttr || 'unknown').toLowerCase();
      const text = extractTextForTurn(turn);
      if (!text) continue;
      const html = extractHtmlForTurn(turn) || text;
      dialogues.push({ role, text, html });
    }

    return dialogues;
  }

  function extractGeminiDialogues() {
    const candidates = Array.from(document.querySelectorAll('[role=\"article\"], [role=\"listitem\"], .conversation-container, main'));
    const dialogues = [];
    for (const el of candidates) {
      const txt = normalizeExtractedText(el.innerText || el.textContent, 8000);
      if (txt.length < 20 || txt.length > 8000) continue;
      dialogues.push({ role: 'unknown', text: txt, html: el.innerHTML || txt });
    }
    return dialogues.slice(0, 200);
  }

  function extractBingDialogues() {
    const turns = Array.from(document.querySelectorAll('.cib-message-group, [data-testid=\"internal-conversation-turn\"], .chat-component'));
    const dialogues = [];
    for (const el of turns) {
      const txt = normalizeExtractedText(el.innerText || el.textContent, 12000);
      if (txt.length < 10) continue;
      dialogues.push({ role: 'unknown', text: txt, html: el.innerHTML || txt });
    }
    return dialogues;
  }

  function extractCopilotDialogues() {
    const turns = Array.from(document.querySelectorAll('[data-testid*=\"message\"], [class*=\"message\"], [role=\"article\"]'));
    const dialogues = [];
    for (const el of turns) {
      const txt = normalizeExtractedText(el.innerText || el.textContent, 12000);
      if (txt.length < 10) continue;
      dialogues.push({ role: 'unknown', text: txt, html: el.innerHTML || txt });
    }
    return dialogues.slice(0, 200);
  }

  function extractGenericDialogues() {
    const blocks = Array.from(document.querySelectorAll('article, [role=\"article\"], [class*=\"message\"], [class*=\"chat\"]'));
    const dialogues = [];
    for (const el of blocks) {
      const txt = normalizeExtractedText(el.innerText || el.textContent, 8000);
      if (txt.length < 30 || txt.length > 8000) continue;
      dialogues.push({ role: 'unknown', text: txt, html: el.innerHTML || txt });
    }
    return dialogues.slice(0, 200);
  }

  function extractDialogues() {
    const platform = detectPlatform();
    let dialogues = [];
    try {
      switch (platform) {
        case 'chatgpt':
          dialogues = extractChatGPTDialogues();
          break;
        case 'gemini':
          dialogues = extractGeminiDialogues();
          break;
        case 'bing':
          dialogues = extractBingDialogues();
          break;
        case 'copilot':
          dialogues = extractCopilotDialogues();
          break;
        default:
          dialogues = extractGenericDialogues();
      }
    } catch (e) {
      error('extractDialogues failed:', e?.message || e);
      dialogues = [];
    }

    // Filter: non-empty and avoid consecutive duplicates
    const filtered = dialogues.filter((d, idx, arr) => {
      const t = String(d?.text || '').trim();
      if (t.length < 5) return false;
      const prev = idx > 0 ? String(arr[idx - 1]?.text || '').trim() : '';
      return t !== prev;
    });

    log('Platform:', platform, 'Dialogues:', filtered.length);
    return filtered;
  }

  function extractDialoguesWithRetry(maxAttempts = 10, delayMs = 800) {
    return new Promise(resolve => {
      let attempt = 0;
      const run = () => {
        const dialogues = extractDialogues();
        if (dialogues.length > 0 || attempt >= maxAttempts - 1) {
          resolve(dialogues);
          return;
        }
        attempt += 1;
        setTimeout(run, delayMs);
      };
      run();
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === 'getDialogues') {
      extractDialoguesWithRetry(10, 800).then(dialogues => sendResponse({ dialogues }));
      return true;
    }
    if (request?.action === 'getSelectedDialogues') {
      extractDialoguesWithRetry(10, 800).then(dialogues => sendResponse({ selectedDialogues: dialogues }));
      return true;
    }
  });

  // Floating export button (bottom-right)
  let injectScheduled = false;
  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    setTimeout(() => {
      injectScheduled = false;
      injectExportButton();
    }, 400);
  }

  function injectExportButton() {
    if (document.querySelector('#gpt-export-extension-button')) return;
    const btn = document.createElement('button');
    btn.id = 'gpt-export-extension-button';
    btn.type = 'button';
    btn.setAttribute('aria-label', '\u5bfc\u51fa\u5bf9\u8bdd');
    btn.textContent = '\u5bfc\u51fa';
    btn.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:86px',
      'z-index:2147483646',
      'padding:10px 14px',
      'border-radius:999px',
      'border:1px solid rgba(17,24,39,0.16)',
      'background:linear-gradient(135deg,#2563eb,#7c3aed)',
      'color:#fff',
      'font-weight:700',
      'box-shadow:0 12px 26px rgba(17,24,39,0.22)',
      'cursor:pointer',
      'font-size:14px',
      'line-height:1',
      'user-select:none',
      '-webkit-font-smoothing:antialiased'
    ].join(';');

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'linear-gradient(135deg,#1d4ed8,#6d28d9)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'linear-gradient(135deg,#2563eb,#7c3aed)';
    });
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openPopup' });
    });

    (document.body || document.documentElement).appendChild(btn);
  }

  const observer = new MutationObserver(() => scheduleInject());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleInject();
})();
