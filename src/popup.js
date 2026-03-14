/* Popup logic (MV3). Keep this file ASCII-only to avoid encoding/mojibake issues. */

const SUPPORTED_HOSTS = [
  'chat.openai.com',
  'chatgpt.com',
  'gemini.google.com',
  'www.bing.com',
  'bing.com',
  'copilot.microsoft.com'
];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showStatus(message, type, duration) {
  const statusEl = document.getElementById('statusMessage');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status ${type || ''}`.trim();
  statusEl.style.display = 'block';
  clearTimeout(showStatus._t);
  if (duration !== 0) {
    showStatus._t = setTimeout(() => {
      statusEl.style.display = 'none';
    }, typeof duration === 'number' ? duration : 2000);
  }
}

function buildCompactPreviewText(dialogue, maxLen = 120) {
  const raw = String(dialogue?.text || '');
  const compact = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length <= maxLen) return compact;
  return compact.slice(0, maxLen) + '...';
}

function getRoleInfo(role) {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'user' || normalized === 'human') return { label: '\u7528\u6237', className: 'role-user' };
  if (normalized === 'assistant' || normalized === 'gpt' || normalized === 'ai') return { label: '\u52a9\u624b', className: 'role-assistant' };
  if (role) return { label: String(role), className: '' };
  return { label: '\u672a\u77e5', className: '' };
}

function populateDialogueList(dialogues) {
  const dialogueList = document.getElementById('dialogueList');
  const noDialoguesMsg = document.getElementById('noDialogues');
  if (!dialogueList || !noDialoguesMsg) return;
  dialogueList.innerHTML = '';

  if (!Array.isArray(dialogues) || dialogues.length === 0) {
    noDialoguesMsg.textContent = '\u672a\u68c0\u6d4b\u5230\u5bf9\u8bdd\u5185\u5bb9';
    dialogueList.appendChild(noDialoguesMsg);
    return;
  }

  for (let index = 0; index < dialogues.length; index++) {
    const dialogue = dialogues[index];
    const dialogueItem = document.createElement('div');
    dialogueItem.className = 'dialogue-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'dialogue-checkbox';
    checkbox.id = `dialogue-${index}`;
    checkbox.checked = true;

    const contentLabel = document.createElement('label');
    contentLabel.htmlFor = `dialogue-${index}`;
    contentLabel.className = 'dialogue-content';

    const roleInfo = getRoleInfo(dialogue?.role);
    const previewText = buildCompactPreviewText(dialogue);

    const metaRow = document.createElement('div');
    metaRow.className = 'dialogue-meta';

    const roleBadge = document.createElement('span');
    roleBadge.className = `role-badge ${roleInfo.className}`.trim();
    roleBadge.textContent = roleInfo.label;
    metaRow.appendChild(roleBadge);

    const previewEl = document.createElement('div');
    previewEl.className = 'preview-text';
    previewEl.textContent = previewText;

    contentLabel.appendChild(metaRow);
    contentLabel.appendChild(previewEl);
    contentLabel.title = `${roleInfo.label}\n\n${String(dialogue?.text || '')}`.trim();

    dialogueItem.className = `dialogue-item ${roleInfo.className ? roleInfo.className + '-item' : ''}`.trim();

    dialogueItem.appendChild(checkbox);
    dialogueItem.appendChild(contentLabel);
    dialogueList.appendChild(dialogueItem);
  }
}

let _sourceTab = null;

async function getSourceTab() {
  if (_sourceTab) return _sourceTab;
  const urlParams = new URLSearchParams(window.location.search);
  const tabIdParam = urlParams.get('tab');
  if (tabIdParam) {
    const tabId = parseInt(tabIdParam, 10);
    if (Number.isFinite(tabId)) {
      const tab = await new Promise(resolve => {
        chrome.tabs.get(tabId, t => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(t);
        });
      });
      if (tab) { _sourceTab = tab; return tab; }
    }
  }
  const tabs = await new Promise(resolve =>
    chrome.tabs.query({ active: true, currentWindow: true }, resolve)
  );
  _sourceTab = tabs?.[0] || null;
  return _sourceTab;
}

/* --- PDF generation (html2pdf.js, no debugger banner) --- */

function looksLikeRichHtml(html) {
  if (!html || typeof html !== 'string') return false;
  return /<(p|div|span|pre|code|ul|ol|li|h[1-6]|blockquote|table|img|a)\b/i.test(html.trim());
}

function sanitizeHtmlFragment(html) {
  if (!looksLikeRichHtml(html)) return '<div class="plain">' + escapeHtml(html || '') + '</div>';
  const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
  const root = doc.body;
  root.querySelectorAll('script,style,iframe,object,embed,link,meta,button,textarea,input,select,svg,[role="button"],[data-testid="copy-button"]').forEach(el => el.remove());
  const isSafeUrl = u => { const s = String(u || '').trim().toLowerCase(); return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:image/') || s.startsWith('blob:'); };
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || n === 'srcdoc') el.removeAttribute(attr.name);
      if (n === 'href' && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
      if (n === 'src' && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
    }
    const cls = el.getAttribute('class') || '';
    const inKatex = cls.includes('katex') || el.closest?.('.katex,.katex-display');
    const inMjx = el.tagName.toLowerCase() === 'mjx-container' || el.closest?.('mjx-container');
    if (!inKatex && !inMjx) el.removeAttribute('style');
    el.removeAttribute('id');
    if (el.hasAttribute('class') && !inKatex && !inMjx && !/\blanguage-[a-z0-9_-]+\b/i.test(cls) && !/\bhljs\b/i.test(cls)) el.removeAttribute('class');
  }
  root.querySelectorAll('annotation').forEach(a => a.remove());
  return root.innerHTML;
}

function buildPdfHtml(dialogues) {
  const safe = Array.isArray(dialogues) ? dialogues : [];
  const css = [
    '* { box-sizing: border-box; }',
    '.doc-title { font-size: 11pt; font-weight: 600; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 1px solid #e5e7eb; color: #111827; }',
    '.role-label { font-size: 8pt; font-weight: 600; color: #6b7280; margin: 0 0 3px; }',
    'section { margin: 10px 0 5px; }',
    'section.user-section { background: #f9fafb; padding: 8px 10px; border-radius: 4px; }',
    '.content { font-size: 9.5pt; line-height: 1.6; }',
    'h1 { font-size: 13pt; font-weight: 700; margin: 14px 0 6px; }',
    'h2 { font-size: 11pt; font-weight: 600; margin: 12px 0 5px; }',
    'h3 { font-size: 10pt; font-weight: 600; margin: 10px 0 4px; }',
    'h4 { font-size: 9.5pt; font-weight: 600; margin: 8px 0 3px; }',
    'h5, h6 { font-size: 9.5pt; font-weight: 600; margin: 8px 0 3px; color: #555; }',
    'p { margin: 4px 0; }',
    'ul, ol { padding-left: 18px; margin: 3px 0; }',
    'li { margin: 2px 0; }',
    'code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 8.5pt; }',
    'pre { background: #f6f8fa; padding: 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; border: 1px solid #e5e7eb; }',
    ':not(pre) > code { background: #f6f8fa; padding: 1px 4px; border-radius: 3px; }',
    'blockquote { margin: 5px 0; padding-left: 10px; border-left: 3px solid #d1d5db; color: #555; }',
    'hr { margin: 8px 0; border: 0; border-top: 1px solid #e5e7eb; }',
    'a { color: #111827; text-decoration: underline; }',
    'img { max-width: 100%; height: auto; }',
    '.plain { white-space: pre-wrap; word-break: break-word; }',
    'table { border-collapse: collapse; width: 100%; margin: 6px 0; }',
    'th, td { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; font-size: 9pt; }',
    'th { background: #f9fafb; font-weight: 600; }',
    '.footer { margin-top: 14px; text-align: center; color: #9ca3af; font-size: 8pt; }',
    '.katex, .katex-display { white-space: nowrap; }',
    '.katex { display: inline-block; font: normal 1.1em serif; line-height: 1.2; }',
    '.katex-display { display: block; margin: 10px 0; text-align: center; }'
  ].join('\n');

  let h = '<style>' + css + '</style>';
  h += '<div class="doc-title">GPT \u5bf9\u8bdd\u8bb0\u5f55</div>';
  for (let i = 0; i < safe.length; i++) {
    const d = safe[i] || {};
    const rl = String(d.role || '').toLowerCase();
    const isUser = rl === 'user' || rl === 'human';
    const roleLabel = isUser ? '\u7528\u6237' : '\u52a9\u624b';
    const sectionCls = isUser ? ' class="user-section"' : '';
    const body = sanitizeHtmlFragment(d.html || d.text || '');
    h += '<section' + sectionCls + '><div class="role-label">' + roleLabel + '</div><div class="content">' + body + '</div></section>';
  }
  h += '<div class="footer">\u5bfc\u51fa\u4e8e ' + escapeHtml(new Date().toLocaleString('zh-CN')) + '</div>';
  return h;
}

let _html2pdfLoadPromise = null;

function loadHtml2Pdf() {
  if (typeof html2pdf !== 'undefined') return Promise.resolve();
  if (_html2pdfLoadPromise) return _html2pdfLoadPromise;
  _html2pdfLoadPromise = new Promise((resolve, reject) => {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('vendor/html2pdf.bundle.min.js');
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load html2pdf'));
      (document.head || document.documentElement).appendChild(script);
    } catch (e) { reject(e); }
  });
  return _html2pdfLoadPromise;
}

function sendMessageAsync(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function executeScriptAsync(details) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(details, results => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(results);
    });
  });
}

async function ensureContentScriptInjected(tabId) {
  await executeScriptAsync({ target: { tabId }, files: ['src/content.js'] });
}

async function sendMessageWithAutoInject(tabId, message, retries = 3) {
  try {
    return await sendMessageAsync(tabId, message);
  } catch (e) {
    const msg = String(e?.message || e);
    const looksLikeNoReceiver =
      /Receiving end does not exist|Could not establish connection|The message port closed before a response was received/i.test(msg);
    if (!looksLikeNoReceiver) throw e;
    try {
      await ensureContentScriptInjected(tabId);
    } catch (_) {}
    let lastError = e;
    for (let i = 0; i < retries; i++) {
      await delay(250 + i * 250);
      try {
        return await sendMessageAsync(tabId, message);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}

function sanitizeForMarkdown(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeMarkdown(md) {
  return String(md || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tryExtractMathMarkdown(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = el.tagName.toLowerCase();

  if (tag === 'annotation') return '';

  const cls = el.getAttribute('class') || '';
  const isKatexDisplay = cls.includes('katex-display');
  const isKatex = cls.includes('katex');
  if (isKatexDisplay) {
    const inner = el.querySelector('.katex') || el;
    const ann = inner.querySelector('annotation[encoding=\"application/x-tex\"], annotation');
    const tex = sanitizeForMarkdown(ann?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!tex) return '';
    return `\n\n$$\n${tex}\n$$\n\n`;
  }
  if (isKatex) {
    if (el.closest('.katex-display')) return '';
    const ann = el.querySelector('annotation[encoding=\"application/x-tex\"], annotation');
    const tex = sanitizeForMarkdown(ann?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!tex) return '';
    return `$${tex}$`;
  }

  if (tag === 'mjx-container') {
    const aria = el.getAttribute('aria-label') || '';
    const tex = sanitizeForMarkdown(aria).replace(/\s+/g, ' ').trim();
    if (tex) return `$${tex}$`;
  }

  return null;
}

function wrapInlineCode(code) {
  const text = String(code || '');
  const ticks = text.match(/`+/g) || [];
  const maxTicks = ticks.reduce((m, t) => Math.max(m, t.length), 0);
  const fence = '`'.repeat(Math.max(1, maxTicks + 1));
  const needsPadding = text.startsWith(' ') || text.endsWith(' ') || text.includes('\n');
  return needsPadding ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

function renderInline(nodes) {
  let out = '';
  for (const node of nodes) out += renderNode(node, { mode: 'inline' });
  return out.replace(/\s+/g, ' ').trim();
}

function indentLines(text, indent) {
  return String(text || '')
    .split('\n')
    .map(line => (line.length ? indent + line : line))
    .join('\n');
}

function renderTable(tableEl) {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  if (!rows.length) return '';
  const matrix = rows.map(row =>
    Array.from(row.children)
      .filter(cell => cell.tagName && /^(TH|TD)$/i.test(cell.tagName))
      .map(cell => renderInline(Array.from(cell.childNodes)) || (cell.textContent || '').trim())
  );
  const header = matrix[0] || [];
  const body = matrix.slice(1);
  const cols = Math.max(1, ...matrix.map(r => r.length));

  const normRow = row => {
    const out = row.slice();
    while (out.length < cols) out.push('');
    return out.map(v => String(v).replace(/\|/g, '\\|').trim());
  };

  const headerRow = normRow(header);
  const sepRow = Array.from({ length: cols }, () => '---');
  const bodyRows = body.map(normRow);

  let md = `| ${headerRow.join(' | ')} |\n| ${sepRow.join(' | ')} |\n`;
  for (const row of bodyRows) md += `| ${row.join(' | ')} |\n`;
  return md + '\n';
}

function renderList(listEl, listStack) {
  const isOrdered = listEl.tagName.toLowerCase() === 'ol';
  const startAttr = parseInt(listEl.getAttribute('start') || '1', 10);
  const state = { type: isOrdered ? 'ol' : 'ul', index: Number.isFinite(startAttr) ? startAttr : 1 };
  listStack.push(state);

  let out = '';
  const items = Array.from(listEl.children).filter(el => el.tagName && el.tagName.toLowerCase() === 'li');
  for (const li of items) out += renderListItem(li, listStack);

  listStack.pop();
  return out + '\n';
}

function renderListItem(li, listStack) {
  const depth = Math.max(0, listStack.length - 1);
  const indent = '  '.repeat(depth);
  const current = listStack[listStack.length - 1];
  const marker = current.type === 'ol' ? `${current.index++}.` : '-';

  const children = Array.from(li.childNodes).filter(n => {
    if (n.nodeType === Node.TEXT_NODE) return n.nodeValue && n.nodeValue.trim() !== '';
    return true;
  });
  const nestedLists = children.filter(n => n.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes(n.tagName));
  const contentNodes = children.filter(n => !(n.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes(n.tagName)));

  const content = normalizeMarkdown(renderNodes(contentNodes, { mode: 'block', inListItem: true }));
  let out = '';
  if (!content) {
    out += `${indent}${marker}\n`;
  } else {
    const startsWithBlock = /^(```|>|\|)/.test(content);
    if (startsWithBlock) {
      out += `${indent}${marker}\n`;
      out += indentLines(content, indent + '  ') + '\n';
    } else {
      const lines = content.split('\n');
      out += `${indent}${marker} ${lines[0]}\n`;
      for (const line of lines.slice(1)) out += `${indent}  ${line}\n`;
    }
  }

  for (const nested of nestedLists) out += renderNode(nested, { mode: 'block', listStack });
  return out;
}

function renderNodes(nodes, state) {
  let out = '';
  for (const node of nodes) out += renderNode(node, state);
  return out;
}

function renderNode(node, state) {
  const mode = state?.mode || 'block';
  const listStack = state?.listStack || [];

  if (node.nodeType === Node.TEXT_NODE) {
    const text = sanitizeForMarkdown(node.nodeValue || '');
    if (!text.trim()) return mode === 'inline' ? ' ' : '';
    return mode === 'inline' ? text.replace(/\s+/g, ' ') : text;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const math = tryExtractMathMarkdown(node);
  if (math !== null) return math;

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return mode === 'inline' ? '<br>' : '\n';
  if (tag === 'hr') return '\n---\n\n';

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const text = renderInline(Array.from(node.childNodes));
    if (!text) return '';
    return `\n\n${'#'.repeat(level)} ${text}\n\n`;
  }

  if (tag === 'strong' || tag === 'b') {
    const text = renderInline(Array.from(node.childNodes));
    return text ? `**${text}**` : '';
  }
  if (tag === 'em' || tag === 'i') {
    const text = renderInline(Array.from(node.childNodes));
    return text ? `*${text}*` : '';
  }
  if (tag === 'code') {
    if (node.parentElement && node.parentElement.tagName && node.parentElement.tagName.toLowerCase() === 'pre') return '';
    const text = sanitizeForMarkdown(node.textContent || '');
    return text ? wrapInlineCode(text) : '';
  }
  if (tag === 'pre') {
    const codeEl = node.querySelector('code');
    const langMatch = (codeEl?.className || '').match(/language-([a-z0-9_-]+)/i);
    const lang = langMatch ? langMatch[1] : '';
    const codeText = sanitizeForMarkdown((codeEl ? codeEl.textContent : node.textContent) || '');
    const cleaned = codeText.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
    return `\n\n\`\`\`${lang}\n${cleaned}\n\`\`\`\n\n`;
  }
  if (tag === 'blockquote') {
    const inner = normalizeMarkdown(renderNodes(Array.from(node.childNodes), { mode: 'block', listStack }));
    if (!inner) return '';
    const quoted = inner
      .split('\n')
      .map(line => (line.length ? `> ${line}` : '>'))
      .join('\n');
    return `\n\n${quoted}\n\n`;
  }
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    const text = renderInline(Array.from(node.childNodes)) || href;
    return href ? `[${text}](${href})` : text;
  }
  if (tag === 'img') {
    const src = node.getAttribute('src') || '';
    const alt = node.getAttribute('alt') || '';
    return src ? `![${sanitizeForMarkdown(alt)}](${src})` : '';
  }
  if (tag === 'ul' || tag === 'ol') {
    return renderList(node, listStack);
  }
  if (tag === 'li') {
    return renderListItem(node, listStack);
  }
  if (tag === 'table') {
    return `\n\n${renderTable(node)}`;
  }
  if (tag === 'p') {
    const text = renderInline(Array.from(node.childNodes));
    if (!text) return '';
    if (state?.inListItem) return `${text}\n`;
    return `\n\n${text}\n\n`;
  }
  if (tag === 'div' || tag === 'section' || tag === 'article') {
    return renderNodes(Array.from(node.childNodes), { ...state, listStack });
  }
  if (tag === 'span') {
    return renderNodes(Array.from(node.childNodes), { ...state, mode: 'inline', listStack });
  }

  return renderNodes(Array.from(node.childNodes), { ...state, listStack });
}

function htmlToMarkdown(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';
  if (!/<[a-z][\s\S]*>/i.test(raw)) return raw;
  const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html');
  const root = doc.body;
  const md = renderNodes(Array.from(root.childNodes), { mode: 'block', listStack: [] });
  return normalizeMarkdown(md);
}

function downloadTextFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function getSelectedDialoguesFromResponse(response) {
  const dialogues = response?.selectedDialogues || [];
  const checkboxes = Array.from(document.querySelectorAll('.dialogue-checkbox'));
  const selected = [];
  for (let i = 0; i < checkboxes.length; i++) {
    if (!checkboxes[i].checked) continue;
    const d = dialogues[i];
    if (!d) continue;
    selected.push({ role: d.role || '', text: d.text || '', html: d.html || '' });
  }
  return selected;
}

function exportAsJSON(dialogues) {
  const data = JSON.stringify(dialogues, null, 2);
  const filename = `gpt_dialogues_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  downloadTextFile(filename, 'application/json;charset=utf-8', data);
  showStatus(`\u5df2\u5bfc\u51fa ${dialogues.length} \u6761\u5bf9\u8bdd (JSON)`, 'success');
}

function exportAsMarkdown(dialogues) {
  let md = '# GPT \u5bf9\u8bdd\u8bb0\u5f55\n\n';
  dialogues.forEach((d, idx) => {
    const roleLabel = d.role ? ` (${d.role})` : '';
    md += `## \u5bf9\u8bdd ${idx + 1}${roleLabel}\n\n`;
    md += d.html && d.html !== d.text ? htmlToMarkdown(d.html) : sanitizeForMarkdown(d.text);
    md += '\n\n';
  });
  md = normalizeMarkdown(md) + '\n';
  const filename = `gpt_dialogues_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.md`;
  downloadTextFile(filename, 'text/markdown;charset=utf-8', md);
  showStatus(`\u5df2\u5bfc\u51fa ${dialogues.length} \u6761\u5bf9\u8bdd (MD)`, 'success');
}

async function exportAsPDF(dialogues) {
  showStatus('\u6b63\u5728\u51c6\u5907 PDF...', 'success', 0);
  try {
    const tab = await getSourceTab();
    const jobId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const storageKey = 'pdfJob:' + jobId;
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({
        [storageKey]: { dialogues: dialogues, sourceTabId: tab?.id }
      }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    const previewUrl = chrome.runtime.getURL('pages/pdf_preview.html?job=' + jobId);
    chrome.tabs.create({ url: previewUrl });
    showStatus('\u5df2\u6253\u5f00 PDF \u9884\u89c8\u9875', 'success');
  } catch (e) {
    showStatus('PDF \u5931\u8d25: ' + String(e?.message || e).slice(0, 100), 'error');
  }
}

async function loadDialoguesForTab(tab) {
  const url = String(tab?.url || '');
  let hostname = '';
  try {
    hostname = new URL(url).hostname || '';
  } catch (_) {}

  if (!hostname || !SUPPORTED_HOSTS.includes(hostname)) {
    showStatus('\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301\u5bfc\u51fa', 'error');
    return;
  }

  showStatus('\u6b63\u5728\u8bfb\u53d6\u5bf9\u8bdd...', 'success');
  try {
    const resp = await sendMessageWithAutoInject(tab.id, { action: 'getDialogues' }, 3);
    const dialogues = resp?.dialogues || [];
    populateDialogueList(dialogues);
    showStatus(`\u5df2\u8bc6\u522b ${dialogues.length} \u6761\u5bf9\u8bdd`, 'success');
  } catch (e) {
    console.warn('[gpt-export] load dialogues failed:', e);
    const detail = String(e?.message || '').slice(0, 160);
    showStatus(
      `\u65e0\u6cd5\u8fde\u63a5\u5230\u9875\u9762\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u540e\u91cd\u8bd5${detail ? ` (${detail})` : ''}`,
      'error'
    );
  }
}

async function exportSelected(format) {
  const tab = await getSourceTab();
  if (!tab?.id) {
    showStatus('Cannot get current tab.', 'error');
    return;
  }

  let response;
  try {
    response = await sendMessageWithAutoInject(tab.id, { action: 'getSelectedDialogues' }, 3);
  } catch (_) {
    showStatus('\u65e0\u6cd5\u8fde\u63a5\u5230\u9875\u9762\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u540e\u91cd\u8bd5', 'error');
    return;
  }

  const selected = getSelectedDialoguesFromResponse(response);
  if (!selected.length) {
    showStatus('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u6761\u5bf9\u8bdd', 'error');
    return;
  }

  if (format === 'json') return exportAsJSON(selected);
  if (format === 'md') return exportAsMarkdown(selected);
  if (format === 'pdf') return exportAsPDF(selected);
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('selectAllBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.dialogue-checkbox').forEach(cb => (cb.checked = true));
  });
  document.getElementById('unselectAllBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.dialogue-checkbox').forEach(cb => (cb.checked = false));
  });

  document.getElementById('exportJsonBtn')?.addEventListener('click', () => exportSelected('json'));
  document.getElementById('exportMdBtn')?.addEventListener('click', () => exportSelected('md'));
  document.getElementById('exportPdfBtn')?.addEventListener('click', () => exportSelected('pdf'));

  const tab = await getSourceTab();
  if (!tab?.id) {
    showStatus('Cannot get current tab.', 'error');
    return;
  }
  await loadDialoguesForTab(tab);
});
