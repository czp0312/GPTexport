(() => {
  if (window.__gptExportContentScriptLoaded) return;
  window.__gptExportContentScriptLoaded = true;

  const LOG_PREFIX = '[GPT Export]';
  const DEFAULT_SETTINGS = {
    enableChatGPT: true,
    enableGemini: true,
    enableBing: true,
    enableCopilot: true
  };
  const PLATFORM_SETTING_KEYS = {
    chatgpt: 'enableChatGPT',
    gemini: 'enableGemini',
    bing: 'enableBing',
    copilot: 'enableCopilot'
  };

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

  function extractChatGPTTitle() {
    // ChatGPT title is usually in the page title or a specific element
    var titleSelectors = [
      'h1[data-testid="conversation-title"]',
      '.truncate-title',
      '[class*="conversation-title"]',
      'nav[aria-label="Chat history"] button[data-state="active"] span'
    ];
    for (var i = 0; i < titleSelectors.length; i++) {
      var el = document.querySelector(titleSelectors[i]);
      if (el && el.textContent) {
        var t = el.textContent.trim();
        if (t && t.length > 0 && t.length < 200) return t;
      }
    }
    // Fallback: extract from page title (usually "Title - ChatGPT")
    var pageTitle = document.title || '';
    var cleanTitle = pageTitle.replace(/\s*[-|]\s*(ChatGPT|OpenAI)\s*$/i, '').trim();
    if (cleanTitle && cleanTitle.length > 0 && cleanTitle.length < 200) return cleanTitle;
    return '';
  }

  function extractGeminiTitle() {
    // Get current conversation ID from URL
    var currentPath = location.pathname || '';
    var match = currentPath.match(/\/app\/([a-f0-9]+)/i);
    var currentId = match ? match[1] : null;

    // Find the active conversation in sidebar by matching URL
    if (currentId) {
      var links = document.querySelectorAll('a[data-test-id="conversation"]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        if (href.indexOf(currentId) !== -1) {
          var titleEl = links[i].querySelector('.conversation-title');
          if (titleEl && titleEl.textContent) {
            var t = titleEl.textContent.trim();
            if (t && t.length > 0 && t.length < 200) return t;
          }
        }
      }
    }

    // Fallback: try to find active/highlighted conversation
    var activeSelectors = [
      '.conversation-items-container.active .conversation-title',
      '.conversation.active .conversation-title',
      '[data-test-id="conversation"].active .conversation-title'
    ];
    for (var j = 0; j < activeSelectors.length; j++) {
      var el = document.querySelector(activeSelectors[j]);
      if (el && el.textContent) {
        var t = el.textContent.trim();
        if (t && t.length > 0 && t.length < 200) return t;
      }
    }

    // Last fallback: page title
    var pageTitle = document.title || '';
    var cleanTitle = pageTitle.replace(/\s*[-|]\s*(Gemini|Google|Bard)\s*$/i, '').trim();
    if (cleanTitle && cleanTitle.length > 0 && cleanTitle.length < 200) {
      return cleanTitle;
    }
    return '';
  }

  function extractBingTitle() {
    var pageTitle = document.title || '';
    var cleanTitle = pageTitle.replace(/\s*[-|]\s*(Bing|Copilot|Microsoft)\s*$/i, '').trim();
    if (cleanTitle && cleanTitle.length > 0 && cleanTitle.length < 200) return cleanTitle;
    return '';
  }

  function extractTitle() {
    var platform = detectPlatform();
    try {
      switch (platform) {
        case 'chatgpt': return extractChatGPTTitle();
        case 'gemini': return extractGeminiTitle();
        case 'bing':
        case 'copilot': return extractBingTitle();
        default: return '';
      }
    } catch (e) {
      return '';
    }
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
    let containers = [];
    for (const sel of htmlSelectors) {
      const els = Array.from(turnEl.querySelectorAll(sel));
      const topLevel = els.filter(el => !els.some(o => o !== el && o.contains(el)));
      if (topLevel.length) { containers = topLevel; break; }
    }
    if (!containers.length) containers = [turnEl];
    const parts = containers.map(target => {
      const clone = target.cloneNode(true);
      clone.querySelectorAll('button, [role=\"button\"], svg, textarea, input, select, [data-testid=\"copy-button\"]').forEach(el => el.remove());
      return clone.innerHTML || '';
    });
    return parts.filter(Boolean).join('\n');
  }

  function extractTextForTurn(turnEl) {
    const textSelectors = ['.markdown', '[class*="markdown"]', '.prose', '.whitespace-pre-wrap'];
    for (const sel of textSelectors) {
      const els = Array.from(turnEl.querySelectorAll(sel));
      const topLevel = els.filter(el => !els.some(o => o !== el && o.contains(el)));
      if (topLevel.length) {
        const parts = topLevel.map(el => normalizeExtractedText(el.innerText || el.textContent, 20000));
        const combined = parts.filter(Boolean).join('\n\n');
        if (combined) return combined;
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
    // Gemini uses custom elements for conversation turns
    var geminiSelectors = [
      'model-response, user-query',
      'message-content',
      '[data-message-id]',
      '.conversation-turn'
    ];

    var turns = [];
    for (var si = 0; si < geminiSelectors.length; si++) {
      var found = Array.from(document.querySelectorAll(geminiSelectors[si]));
      var topLevel = found.filter(function(el) {
        return !found.some(function(o) { return o !== el && o.contains(el); });
      });
      if (topLevel.length) { turns = topLevel; break; }
    }

    // Fallback: article/listitem but skip sidebar/nav areas
    if (!turns.length) {
      turns = Array.from(document.querySelectorAll('[role=\"article\"], [role=\"listitem\"], .conversation-container'))
        .filter(function(el) {
          if (el.closest('nav, [role=\"navigation\"], aside, [role=\"complementary\"], [role=\"tablist\"]')) return false;
          var txt = (el.innerText || el.textContent || '').trim();
          return txt.length >= 1 && txt.length <= 8000;
        });
    }

    var dialogues = [];
    for (var i = 0; i < turns.length; i++) {
      var el = turns[i];
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      var role = 'unknown';
      if (tag === 'user-query') role = 'user';
      else if (tag === 'model-response') role = 'assistant';

      var text = extractTextForTurn(el);
      if (!text) continue;
      // Remove "你说" prefix from user messages in Gemini
      if (role === 'user' && text.startsWith('\u4f60\u8bf4')) {
        text = text.slice(2).trim();
      }
      var html = extractHtmlForTurn(el) || text;
      dialogues.push({ role: role, text: text, html: html });
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
      if (t.length < 1) return false;
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
      extractDialoguesWithRetry(10, 800).then(dialogues => sendResponse({ dialogues: dialogues, title: extractTitle() }));
      return true;
    }
    if (request?.action === 'getSelectedDialogues') {
      extractDialoguesWithRetry(10, 800).then(dialogues => sendResponse({ selectedDialogues: dialogues, title: extractTitle() }));
      return true;
    }
  });

  // Floating export button (bottom-right)
  let injectScheduled = false;
  let buttonObserver = null;

  function getCurrentPlatformSettingKey() {
    return PLATFORM_SETTING_KEYS[detectPlatform()] || null;
  }

  function isCurrentPlatformEnabled() {
    return new Promise(resolve => {
      const settingKey = getCurrentPlatformSettingKey();
      if (!settingKey) {
        resolve(true);
        return;
      }

      chrome.storage.sync.get(DEFAULT_SETTINGS, items => {
        if (chrome.runtime.lastError) {
          warn('Failed to read settings:', chrome.runtime.lastError.message);
          resolve(true);
          return;
        }
        resolve(items[settingKey] !== false);
      });
    });
  }

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
      'right:20px',
      'bottom:80px',
      'z-index:2147483646',
      'padding:9px 20px',
      'border-radius:20px',
      'border:none',
      'background:#4f46e5',
      'color:#fff',
      'font-weight:600',
      'box-shadow:0 2px 8px rgba(79,70,229,0.3),0 1px 3px rgba(0,0,0,0.08)',
      'cursor:pointer',
      'font-size:13px',
      'line-height:1',
      'user-select:none',
      '-webkit-font-smoothing:antialiased',
      'transition:all 0.25s ease',
      'letter-spacing:0.01em'
    ].join(';');

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#4338ca';
      btn.style.transform = 'translateY(-1px)';
      btn.style.boxShadow = '0 4px 12px rgba(79,70,229,0.35),0 2px 4px rgba(0,0,0,0.08)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#4f46e5';
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 2px 8px rgba(79,70,229,0.3),0 1px 3px rgba(0,0,0,0.08)';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({
          action: 'openPopup',
          sw: screen.availWidth,
          sh: screen.availHeight
        }, (resp) => {
          if (chrome.runtime.lastError || !resp?.ok) {
            btn.textContent = '\u5237\u65b0\u91cd\u8bd5';
            btn.style.background = '#dc2626';
            btn.style.boxShadow = '0 2px 8px rgba(220,38,38,0.3),0 1px 3px rgba(0,0,0,0.08)';
            setTimeout(() => { btn.textContent = '\u5bfc\u51fa'; btn.style.background = '#4f46e5'; btn.style.boxShadow = '0 2px 8px rgba(79,70,229,0.3),0 1px 3px rgba(0,0,0,0.08)'; }, 2500);
          }
        });
      } catch (_) {
        btn.textContent = '\u5237\u65b0\u91cd\u8bd5';
        btn.style.background = '#dc2626';
        btn.style.boxShadow = '0 2px 8px rgba(220,38,38,0.3),0 1px 3px rgba(0,0,0,0.08)';
        setTimeout(() => { btn.textContent = '\u5bfc\u51fa'; btn.style.background = '#4f46e5'; btn.style.boxShadow = '0 2px 8px rgba(79,70,229,0.3),0 1px 3px rgba(0,0,0,0.08)'; }, 2500);
      }
    });

    (document.body || document.documentElement).appendChild(btn);
  }

  async function syncFloatingExportButton() {
    const enabled = await isCurrentPlatformEnabled();
    const existingBtn = document.querySelector('#gpt-export-extension-button');

    if (!enabled) {
      existingBtn?.remove();
      if (buttonObserver) {
        buttonObserver.disconnect();
        buttonObserver = null;
      }
      return;
    }

    if (!buttonObserver) {
      buttonObserver = new MutationObserver(() => scheduleInject());
      buttonObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    scheduleInject();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!Object.keys(changes).some(key => Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key))) return;
    syncFloatingExportButton();
  });

  syncFloatingExportButton();
})();
