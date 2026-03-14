function escapeHtml(unsafeText) {
  return String(unsafeText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function looksLikeRichHtml(html) {
  if (!html || typeof html !== 'string') return false;
  const trimmed = html.trim();
  return /<(p|div|span|pre|code|ul|ol|li|h[1-6]|blockquote|table|img|a)\b/i.test(trimmed);
}

function sanitizeHtmlFragment(html) {
  if (!looksLikeRichHtml(html)) return `<div class="plain">${escapeHtml(html || '')}</div>`;

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body;

  const removeSelectors = [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'link',
    'meta',
    'button',
    'textarea',
    'input',
    'select',
    'svg',
    '[role="button"]',
    '[data-testid="copy-button"]'
  ];
  root.querySelectorAll(removeSelectors.join(',')).forEach(el => el.remove());

  const isSafeUrl = url => {
    const u = String(url || '').trim().toLowerCase();
    if (!u) return false;
    return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:image/') || u.startsWith('blob:');
  };

  // Remove inline event handlers / unsafe URLs; keep style only for math elements (needed for layout)
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if (name === 'srcdoc') el.removeAttribute(attr.name);
      if (name === 'href' && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
      if (name === 'src' && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
    }

    const cls = el.getAttribute('class') || '';
    const inKatex = cls.includes('katex') || el.closest?.('.katex, .katex-display');
    const isMjx = el.tagName.toLowerCase() === 'mjx-container';
    const inMjx = isMjx || el.closest?.('mjx-container');
    if (!inKatex && !inMjx) el.removeAttribute('style');

    // Reduce dependence on site CSS (avoid flex/spacing quirks) while preserving math/code semantics
    el.removeAttribute('id');
    if (el.hasAttribute('class')) {
      const keep =
        inKatex ||
        inMjx ||
        /\blanguage-[a-z0-9_-]+\b/i.test(cls) ||
        /\bhljs\b/i.test(cls);
      if (!keep) el.removeAttribute('class');
    }
  }

  // Keep KaTeX/MathJax markup; remove only annotation noise
  root.querySelectorAll('annotation').forEach(a => a.remove());
  return root.innerHTML;
}

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getCurrentTabAsync() {
  return new Promise((resolve, reject) => {
    chrome.tabs.getCurrent(tab => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function debuggerAttachAsync(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerDetachAsync(tabId) {
  return new Promise(resolve => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

async function debuggerAttachEnsured(tabId) {
  try {
    await debuggerAttachAsync(tabId);
    return;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Another debugger is already attached|already attached/i.test(msg)) {
      await debuggerDetachAsync(tabId);
      await debuggerAttachAsync(tabId);
      return;
    }
    throw e;
  }
}

function debuggerSendAsync(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(label || `Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function debuggerSendEnsured(tabId, method, params) {
  try {
    return await debuggerSendAsync(tabId, method, params);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Debugger is not attached to the tab/i.test(msg)) {
      await debuggerAttachAsync(tabId);
      return await debuggerSendAsync(tabId, method, params);
    }
    throw e;
  }
}

function downloadsDownloadAsync(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, downloadId => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(downloadId);
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

function getJobId() {
  const url = new URL(window.location.href);
  return url.searchParams.get('job') || '';
}

function buildHtml(dialogues) {
  let html = `<div style="margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;font-size:11pt;font-weight:600;color:#374151;">GPT \u5bf9\u8bdd\u8bb0\u5f55</div>`;

  dialogues.forEach((d, index) => {
    const body = sanitizeHtmlFragment(d.html || d.text || '');
    const roleLower = String(d.role || '').toLowerCase();
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
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('vendor/html2pdf.bundle.min.js');
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load html2pdf bundle'));
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      reject(e);
    }
  });

  return html2pdfLoadPromise;
}

async function generatePdfBlob(element) {
  await loadHtml2Pdf();
  if (typeof html2pdf === 'undefined') throw new Error('html2pdf is not loaded');

  // 绛夊緟瀛椾綋鍔犺浇锛岄伩鍏嶅瓧绗﹂噸鍙?闂磋窛寮傚父锛堝挨鍏舵槸CJK鍜屾暟瀛﹀瓧浣擄級
  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    await document.fonts.ready;
  }
  await new Promise(r => setTimeout(r, 50));

  const opt = {
    margin: [8, 8, 8, 8],
    filename: `gpt_dialogues_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`,
    image: { type: 'jpeg', quality: 0.92 },
    enableLinks: true,
    pagebreak: {
      mode: ['avoid-all', 'css', 'legacy'],
      avoid: ['pre', 'blockquote', 'table', 'img']
    },
    html2canvas: {
      scale: 1.5,
      useCORS: true,
      // letterRendering 鍦ㄩ儴鍒嗗瓧浣?璇█浼氬鑷村瓧闂磋窛寮傚父鎴栭噸鍙?      letterRendering: false,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  const worker = html2pdf().set(opt).from(element).toContainer().toPdf();
  const pdf = await worker.get('pdf');
  return { blob: pdf.output('blob'), filename: opt.filename };
}

async function prepareSourcePrintDom(tabId, dialogues) {
  const results = await executeScriptAsync({
    target: { tabId },
    func: ds => {
      const escapeHtml = unsafeText =>
        String(unsafeText)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\"/g, '&quot;')
          .replace(/'/g, '&#39;');

      const looksLikeRichHtml = html => /<(p|div|span|pre|code|ul|ol|li|h[1-6]|blockquote|table|img|a)\b/i.test(String(html || ''));
      const isSafeUrl = url => {
        const u = String(url || '').trim().toLowerCase();
        if (!u) return false;
        return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:image/') || u.startsWith('blob:');
      };

      const sanitizeFragment = html => {
        if (!looksLikeRichHtml(html)) return `<div class="gpt-export-plain">${escapeHtml(html || '')}</div>`;
        const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
        const root = doc.body;

        const removeTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'];
        root.querySelectorAll(removeTags.join(',')).forEach(el => el.remove());

        const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
          const el = walker.currentNode;
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) el.removeAttribute(attr.name);
            if (name === 'srcdoc') el.removeAttribute(attr.name);
            if (name === 'href' && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
            if (name === 'src' && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
          }

          const cls = el.getAttribute('class') || '';
          const inKatex = cls.includes('katex') || el.closest?.('.katex, .katex-display');
          const isMjx = el.tagName.toLowerCase() === 'mjx-container';
          const inMjx = isMjx || el.closest?.('mjx-container');
          if (!inKatex && !inMjx) el.removeAttribute('style');

          el.removeAttribute('id');
          if (el.hasAttribute('class')) {
            const keep =
              inKatex ||
              inMjx ||
              /\\blanguage-[a-z0-9_-]+\\b/i.test(cls) ||
              /\\bhljs\\b/i.test(cls);
            if (!keep) el.removeAttribute('class');
          }
        }

        root.querySelectorAll('annotation').forEach(a => a.remove());
        return root.innerHTML;
      };

      const rootId = 'gpt-export-print-root';
      const styleId = 'gpt-export-print-style';

      let root = document.getElementById(rootId);
      if (!root) {
        root = document.createElement('div');
        root.id = rootId;
        (document.body || document.documentElement).appendChild(root);
      }

      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        (document.head || document.documentElement).appendChild(style);
      }

      style.textContent = `
        #${rootId} { position: fixed; left: 0; top: 0; width: 980px; max-width: 98vw; opacity: 0; pointer-events: none; contain: layout paint style; }
        @media print {
          @page { size: A4; margin: 8mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body > * { display: none !important; }
          body > #${rootId} { display: block !important; }
          #${rootId} { position: static !important; width: auto !important; max-width: none !important; opacity: 1 !important; pointer-events: auto !important; }

          #${rootId}, #${rootId} * { box-sizing: border-box; }
          #${rootId} { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif; color: #111827; line-height: 1.4; font-size: 9pt; letter-spacing: normal; word-spacing: normal; text-rendering: optimizeLegibility; }
          #${rootId} * { letter-spacing: normal !important; word-spacing: normal !important; transform: none !important; filter: none !important; }
          #${rootId} p, #${rootId} li { orphans: 3; widows: 3; }
          #${rootId} p, #${rootId} li, #${rootId} blockquote, #${rootId} table { overflow-wrap: break-word; word-break: normal; hyphens: auto; }
          #${rootId} .doc-title { font-size: 11pt; font-weight: 600; margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; color: #111827; }
          #${rootId} .role-label { font-size: 7.5pt; font-weight: 600; color: #6b7280; margin: 0 0 2px; }
          #${rootId} h1 { font-size: 12pt; font-weight: 700; margin: 12px 0 5px; page-break-after: avoid; break-after: avoid; }
          #${rootId} h2 { font-size: 10.5pt; font-weight: 600; margin: 10px 0 4px; page-break-after: avoid; break-after: avoid; }
          #${rootId} h3 { font-size: 9.5pt; font-weight: 600; margin: 8px 0 3px; page-break-after: avoid; break-after: avoid; }
          #${rootId} h4 { font-size: 9pt; font-weight: 600; margin: 6px 0 2px; page-break-after: avoid; break-after: avoid; }
          #${rootId} h5, #${rootId} h6 { font-size: 9pt; font-weight: 600; margin: 6px 0 2px; color: #555; }
          #${rootId} p { margin: 3px 0; }
          #${rootId} ul, #${rootId} ol { padding-left: 16px; margin: 2px 0; }
          #${rootId} li { margin: 1px 0; }
          #${rootId} code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 8pt; }
          #${rootId} pre { background: #f6f8fa; padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
          #${rootId} blockquote { margin: 4px 0; padding-left: 8px; border-left: 3px solid #ddd; color: #555; }
          #${rootId} table, #${rootId} img { break-inside: avoid; page-break-inside: avoid; }
          #${rootId} .katex-display, #${rootId} mjx-container { break-inside: avoid; page-break-inside: avoid; }
          #${rootId} .katex, #${rootId} .katex *, #${rootId} mjx-container, #${rootId} mjx-container * { overflow-wrap: normal !important; word-break: normal !important; }
          #${rootId} .katex, #${rootId} .katex-display { white-space: nowrap !important; }
          #${rootId} hr { margin: 6px 0; border: 0; border-top: 1px solid #eee; }
          #${rootId} a { color: #111827; text-decoration: underline; }
          #${rootId} .gpt-export-plain { white-space: pre-wrap; word-break: break-word; }
          #${rootId} section { margin: 8px 0 4px; }
          #${rootId} section.user-section { background: #f9fafb; padding: 6px 8px; border-radius: 4px; }
        }
      `;

      const safeDialogues = Array.isArray(ds) ? ds : [];
      let html = `<div class="doc-title" style="font-size:11pt;font-weight:600;margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;color:#111827;">GPT \u5bf9\u8bdd\u8bb0\u5f55</div>`;
      for (let i = 0; i < safeDialogues.length; i++) {
        const d = safeDialogues[i] || {};
        const roleLower = String(d.role || '').toLowerCase();
        const isUser = roleLower === 'user' || roleLower === 'human';
        const roleLabel = isUser ? '\u7528\u6237' : '\u52a9\u624b';
        const sectionCls = isUser ? 'user-section' : '';
        const roleBg = isUser ? 'background:#f9fafb;padding:6px 8px;border-radius:4px;' : '';
        const body = sanitizeFragment(d.html || d.text || '');
        html += `<section class="${sectionCls}" style="margin:8px 0 4px;${roleBg}"><div class="role-label" style="font-size:7.5pt;font-weight:600;color:#6b7280;margin:0 0 2px;">${roleLabel}</div><div style="font-size:9pt;line-height:1.5;">${body}</div></section>`;
      }
      root.innerHTML = html;

      window.__gptExportCleanupPrint = () => {
        document.getElementById(rootId)?.remove();
        document.getElementById(styleId)?.remove();
        delete window.__gptExportCleanupPrint;
      };

      return { ok: true };
    },
    args: [dialogues]
  });

  return results?.[0]?.result;
}

async function cleanupSourcePrintDom(tabId) {
  try {
    await executeScriptAsync({
      target: { tabId },
      func: () => {
        try { window.__gptExportCleanupPrint?.(); } catch (_) {}
      }
    });
  } catch (_) {
    // ignore
  }
}

async function printToPdfAndDownload(sourceTabId, dialogues, filename, report) {
  const tabId = Number(sourceTabId);
  if (!Number.isFinite(tabId)) throw new Error('\u7f3a\u5c11\u6e90\u9875\u9762\u6807\u7b7e\u9875');

  let debuggerAttached = false;
  const reportSafe = typeof report === 'function' ? report : () => {};
  try {
    reportSafe('\u6b63\u5728\u51c6\u5907...');
    await withTimeout(debuggerAttachEnsured(tabId), 5000, 'Attach timed out');
    debuggerAttached = true;

    reportSafe('\u6b63\u5728\u6392\u7248...\uff08\u9876\u90e8\u8c03\u8bd5\u63d0\u793a\u4e3a\u6b63\u5e38\u6d41\u7a0b\uff09');
    // Prepare DOM and enable debugger domains in parallel
    const [prepared] = await Promise.all([
      withTimeout(prepareSourcePrintDom(tabId, dialogues), 8000, 'Preparing print DOM timed out'),
      withTimeout(Promise.all([
        debuggerSendEnsured(tabId, 'Page.enable'),
        debuggerSendEnsured(tabId, 'Runtime.enable')
      ]), 6000, 'Enable timed out')
    ]);
    if (!prepared?.ok) throw new Error('Failed to prepare print content');

    // Brief font/layout stabilization
    try {
      await withTimeout(debuggerSendEnsured(tabId, 'Runtime.evaluate', {
        expression:
          '(async()=>{try{if(document.fonts&&document.fonts.ready)await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,500))])}catch(_){}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()',
        awaitPromise: true,
        returnByValue: true
      }), 2000, 'Font wait timed out');
    } catch (_) {
      // ignore: printing will still proceed
    }

    reportSafe('\u6b63\u5728\u751f\u6210 PDF...');
    const result = await withTimeout(debuggerSendEnsured(tabId, 'Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      scale: 1,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4
    }), 60000, 'printToPDF timed out');

    const bytes = fromBase64(result.data);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const finalName = filename || `gpt_dialogues_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
    try {
      await withTimeout(
        downloadsDownloadAsync({
          url,
          filename: finalName,
          saveAs: false
        }),
        8000,
        'Download did not start'
      );
    } catch (e) {
      // Some Chrome builds reject blob: URLs in chrome.downloads.download. Fall back to <a download>.
      const a = document.createElement('a');
      a.href = url;
      a.download = finalName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } finally {
    if (debuggerAttached) {
      await withTimeout(debuggerDetachAsync(tabId), 3000, 'Detach timed out');
    }
    await cleanupSourcePrintDom(tabId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const jobId = getJobId();
  const subtitle = document.getElementById('subtitle');
  const openBtn = document.getElementById('openPdfBtn');
  const printToPdfBtn = document.getElementById('printToPdfBtn');
  const closeBtn = document.getElementById('closeBtn');
  const container = document.getElementById('pdf-content');
  let isGenerating = false;

  closeBtn.addEventListener('click', () => window.close());

  if (!jobId) {
    setStatus('缂哄皯浠诲姟ID');
    openBtn.disabled = true;
    subtitle.textContent = '閿欒';
    return;
  }

  const storageKey = `pdfJob:${jobId}`;
  chrome.storage.local.get(storageKey, result => {
    const job = result?.[storageKey];
    const dialogues = job?.dialogues || [];
    const sourceTabId = job?.sourceTabId;

    if (!Array.isArray(dialogues) || dialogues.length === 0) {
      setStatus('No dialogues found.');
      openBtn.disabled = true;
      subtitle.textContent = 'Empty';
      chrome.storage.local.remove(storageKey);
      return;
    }

    subtitle.textContent = `\u5171 ${dialogues.length} \u6761\u5bf9\u8bdd`;
    container.innerHTML = buildHtml(dialogues);
    if (openBtn) openBtn.style.display = 'none';
    setStatus('\u6b63\u5728\u51c6\u5907\u81ea\u52a8\u751f\u6210 PDF...');

    printToPdfBtn.addEventListener('click', async () => {
      if (isGenerating) return;
      isGenerating = true;
      printToPdfBtn.disabled = true;
      openBtn.disabled = true;
      setStatus('\u6b63\u5728\u751f\u6210\u9ad8\u8d28\u91cf PDF...');
      try {
        const filename = `gpt_dialogues_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
        const tabId = Number(sourceTabId);
        if (!Number.isFinite(tabId)) throw new Error('Missing source tab id');
        await printToPdfAndDownload(tabId, dialogues, filename, setStatus);
        chrome.storage.local.remove(storageKey);
        printToPdfBtn.disabled = true;
        setStatus('\u4e0b\u8f7d\u5df2\u5f00\u59cb');
      } catch (e) {
        if (openBtn) openBtn.style.display = '';
        setStatus('Failed: ' + (e?.message || String(e)));
      } finally {
        isGenerating = false;
        if (!printToPdfBtn.disabled) printToPdfBtn.disabled = false;
        openBtn.disabled = false;
      }
    });

    // Auto-start PDF generation with html2pdf after a brief render delay
    setTimeout(async () => {
      if (isGenerating) return;
      isGenerating = true;
      printToPdfBtn.disabled = true;
      openBtn.disabled = true;
      setStatus('\u6b63\u5728\u81ea\u52a8\u751f\u6210 PDF...');
      try {
        const { blob, filename } = await generatePdfBlob(container);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'gpt_dialogues.pdf';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        chrome.storage.local.remove(storageKey);
        setStatus('\u4e0b\u8f7d\u5df2\u5f00\u59cb');
      } catch (e) {
        setStatus('\u81ea\u52a8\u751f\u6210\u5931\u8d25: ' + (e?.message || String(e)));
        if (openBtn) openBtn.style.display = '';
      } finally {
        isGenerating = false;
        openBtn.disabled = false;
        printToPdfBtn.disabled = false;
      }
    }, 600);

    openBtn.addEventListener('click', async () => {
      if (isGenerating) return;
      isGenerating = true;
      openBtn.disabled = true;
      printToPdfBtn.disabled = true;
      setStatus('\u6b63\u5728\u751f\u6210\u5feb\u901f PDF...');
      try {
        const { blob, filename } = await generatePdfBlob(container);
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'gpt_dialogues.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        chrome.storage.local.remove(storageKey);

        setStatus('\u4e0b\u8f7d\u5df2\u5f00\u59cb');
      } catch (e) {
        setStatus('Failed: ' + (e?.message || String(e)));
      } finally {
        isGenerating = false;
        openBtn.disabled = false;
        if (!printToPdfBtn.disabled) printToPdfBtn.disabled = false;
      }
    });
  });
});




