const DEFAULT_SETTINGS = {
  fileNamePrefix: 'gpt_conversation'
};

function escapeHtml(unsafeText) {
  return String(unsafeText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
}

function buildFilenameBase(title, settings) {
  const prefix = sanitizeFilename(settings?.fileNamePrefix || '');
  const safeTitle = sanitizeFilename(title || '');
  const parts = [prefix, safeTitle].filter(Boolean);
  return (parts.join('_') || 'gpt_dialogues').slice(0, 100);
}

function generateFilename(title, ext, settings) {
  const dateStr = new Date().toISOString().slice(0, 10);
  return `${buildFilenameBase(title, settings)}_${dateStr}.${ext}`;
}

function looksLikeRichHtml(html) {
  if (!html || typeof html !== 'string') return false;
  const trimmed = html.trim();
  return /<(p|div|span|pre|code|ul|ol|li|h[1-6]|blockquote|table|img|a)\b/i.test(trimmed);
}

function sanitizeHtmlFragment(html) {
  if (!looksLikeRichHtml(html)) {
    return `<div class="plain">${escapeHtml(html || '')}</div>`;
  }

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body;
  root
    .querySelectorAll(
      'script,style,iframe,object,embed,link,meta,button,textarea,input,select,svg,[role="button"],[data-testid="copy-button"]'
    )
    .forEach(el => el.remove());

  const isSafeUrl = url => {
    const value = String(url || '').trim().toLowerCase();
    if (!value) return false;
    return (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('data:image/') ||
      value.startsWith('blob:')
    );
  };

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') el.removeAttribute(attr.name);
      if (name === 'href' && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
      if (name === 'src' && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
    }

    const cls = el.getAttribute('class') || '';
    const inKatex = cls.includes('katex') || el.closest?.('.katex, .katex-display');
    const inMjx = el.tagName.toLowerCase() === 'mjx-container' || el.closest?.('mjx-container');
    if (!inKatex && !inMjx) el.removeAttribute('style');
    el.removeAttribute('id');

    if (el.hasAttribute('class')) {
      const keepClass =
        inKatex ||
        inMjx ||
        /\blanguage-[a-z0-9_-]+\b/i.test(cls) ||
        /\bhljs\b/i.test(cls);
      if (!keepClass) el.removeAttribute('class');
    }
  }

  root.querySelectorAll('annotation').forEach(el => el.remove());
  return root.innerHTML;
}

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function getJobId() {
  return new URL(window.location.href).searchParams.get('job') || '';
}

function getSyncSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, items => {
      if (chrome.runtime.lastError) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }
      resolve({ ...DEFAULT_SETTINGS, ...items });
    });
  });
}

function getLocalStorageItem(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function removeLocalStorageItem(key) {
  return new Promise(resolve => {
    chrome.storage.local.remove(key, () => resolve());
  });
}

function buildHtml(dialogues, title) {
  const safeTitle = String(title || '').trim();
  const docTitle = safeTitle || 'GPT \u5bf9\u8bdd\u8bb0\u5f55';
  let html = `<div style="margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;font-size:11pt;font-weight:600;color:#374151;">${escapeHtml(docTitle)}</div>`;

  dialogues.forEach(dialogue => {
    const body = sanitizeHtmlFragment(dialogue.html || dialogue.text || '');
    const roleLower = String(dialogue.role || '').toLowerCase();
    const isUser = roleLower === 'user' || roleLower === 'human';
    const roleLabel = isUser ? '\u7528\u6237' : '\u52a9\u624b';
    const roleBg = isUser ? 'background:#f3f4f6;padding:8px 10px;border-radius:4px;' : '';
    html += `<section style="margin:10px 0 4px;${roleBg}"><div style="font-size:8pt;font-weight:600;color:#6b7280;margin:0 0 3px;">${roleLabel}</div><div style="font-size:9pt;line-height:1.6;">${body}</div></section>`;
  });

  html += `<div style="margin-top:12px;text-align:center;color:#9ca3af;font-size:8pt;">\u5bfc\u51fa\u4e8e ${escapeHtml(new Date().toLocaleString('zh-CN'))}</div>`;
  return html;
}

let html2pdfLoadPromise = null;

function loadHtml2Pdf() {
  if (typeof html2pdf !== 'undefined') return Promise.resolve();
  if (html2pdfLoadPromise) return html2pdfLoadPromise;

  html2pdfLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('vendor/html2pdf.bundle.min.js');
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load html2pdf bundle'));
    (document.head || document.documentElement).appendChild(script);
  });

  return html2pdfLoadPromise;
}

async function generatePdfBlob(element, filename) {
  await loadHtml2Pdf();
  if (typeof html2pdf === 'undefined') throw new Error('html2pdf is not loaded');

  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    await document.fonts.ready;
  }
  await new Promise(resolve => setTimeout(resolve, 50));

  const options = {
    margin: [8, 8, 8, 8],
    filename,
    image: { type: 'jpeg', quality: 0.92 },
    enableLinks: true,
    pagebreak: {
      mode: ['avoid-all', 'css', 'legacy'],
      avoid: ['pre', 'blockquote', 'table', 'img']
    },
    html2canvas: {
      scale: 1.5,
      useCORS: true,
      letterRendering: false,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  const worker = html2pdf().set(options).from(element).toContainer().toPdf();
  const pdf = await worker.get('pdf');
  return { blob: pdf.output('blob'), filename };
}

function triggerPdfDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

document.addEventListener('DOMContentLoaded', async () => {
  const jobId = getJobId();
  const subtitle = document.getElementById('subtitle');
  const downloadBtn = document.getElementById('downloadPdfBtn');
  const closeBtn = document.getElementById('closeBtn');
  const container = document.getElementById('pdf-content');
  const state = {
    dialogues: [],
    title: '',
    settings: { ...DEFAULT_SETTINGS },
    storageKey: '',
    isGenerating: false
  };

  function syncButtons() {
    downloadBtn.disabled = state.isGenerating || state.dialogues.length === 0;
  }

  async function startDownload(manual) {
    if (state.isGenerating || state.dialogues.length === 0) return;

    state.isGenerating = true;
    syncButtons();
    setStatus(manual ? '\u6b63\u5728\u91cd\u65b0\u751f\u6210 PDF...' : '\u6b63\u5728\u751f\u6210 PDF...');

    try {
      const filename = generateFilename(state.title, 'pdf', state.settings);
      const { blob } = await generatePdfBlob(container, filename);
      triggerPdfDownload(blob, filename);
      await removeLocalStorageItem(state.storageKey);
      setStatus('\u4e0b\u8f7d\u5df2\u5f00\u59cb');
      downloadBtn.textContent = '\u91cd\u65b0\u4e0b\u8f7d';
      setTimeout(() => window.close(), 1500);
    } catch (error) {
      setStatus('\u751f\u6210\u5931\u8d25: ' + String(error?.message || error).slice(0, 120));
      downloadBtn.textContent = '\u91cd\u65b0\u4e0b\u8f7d';
    } finally {
      state.isGenerating = false;
      syncButtons();
    }
  }

  closeBtn.addEventListener('click', () => window.close());
  downloadBtn.addEventListener('click', () => startDownload(true));

  if (!jobId) {
    setStatus('\u7f3a\u5c11\u4efb\u52a1 ID');
    subtitle.textContent = '\u9519\u8bef';
    downloadBtn.disabled = true;
    return;
  }

  state.storageKey = `pdfJob:${jobId}`;

  try {
    const [result, settings] = await Promise.all([
      getLocalStorageItem(state.storageKey),
      getSyncSettings()
    ]);
    const job = result?.[state.storageKey];
    state.dialogues = Array.isArray(job?.dialogues) ? job.dialogues : [];
    state.title = String(job?.title || '').trim();
    state.settings = settings;

    if (state.dialogues.length === 0) {
      setStatus('\u672a\u627e\u5230\u53ef\u5bfc\u51fa\u7684\u5bf9\u8bdd');
      subtitle.textContent = '\u7a7a\u5185\u5bb9';
      downloadBtn.disabled = true;
      await removeLocalStorageItem(state.storageKey);
      return;
    }

    subtitle.textContent = state.title
      ? `${state.title} · ${state.dialogues.length} \u6761\u5bf9\u8bdd`
      : `\u5171 ${state.dialogues.length} \u6761\u5bf9\u8bdd`;
    container.innerHTML = buildHtml(state.dialogues, state.title);
    setStatus('\u6b63\u5728\u51c6\u5907\u81ea\u52a8\u4e0b\u8f7d...');
    syncButtons();
    setTimeout(() => startDownload(false), 400);
  } catch (error) {
    setStatus('\u52a0\u8f7d\u5931\u8d25: ' + String(error?.message || error).slice(0, 120));
    subtitle.textContent = '\u9519\u8bef';
    downloadBtn.disabled = true;
  }
});
