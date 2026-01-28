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
  let html = `
    <div style="margin-bottom: 10px;">
      <h1>GPT \u5bf9\u8bdd\u8bb0\u5f55</h1>
    </div>
  `;

  dialogues.forEach((d, index) => {
    const body = sanitizeHtmlFragment(d.html || d.text || '');
    html += `
      <section class="dialogue">
        <h2>\u5bf9\u8bdd ${index + 1}</h2>
        ${d.role ? `<p style="font-weight: bold; color: #2196F3;">Role: ${escapeHtml(d.role)}</p>` : ''}
        <div>${body}</div>
        <hr />
      </section>
    `;
  });

  html += `
    <div style="margin-top: 18px; text-align: center; color: #888; font-size: 0.9em;">
      \u5bfc\u51fa\u4e8e ${escapeHtml(new Date().toLocaleString('zh-CN'))}
    </div>
  `;

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
    margin: [10, 10, 10, 10],
    filename: `gpt_dialogues_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    enableLinks: true,
    pagebreak: {
      mode: ['avoid-all', 'css', 'legacy'],
      avoid: ['pre', 'blockquote', 'table', 'img', 'h1', 'h2', 'h3', '.katex', '.katex-display', 'mjx-container']
    },
    html2canvas: {
      scale: 2,
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
          @page { size: A4; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body > * { display: none !important; }
          body > #${rootId} { display: block !important; }
          #${rootId} { position: static !important; width: auto !important; max-width: none !important; opacity: 1 !important; pointer-events: auto !important; }

          #${rootId}, #${rootId} * { box-sizing: border-box; }
          #${rootId} { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif; color: #111827; line-height: 1.6; font-size: 12pt; letter-spacing: normal; word-spacing: normal; text-rendering: optimizeLegibility; }
          #${rootId} * { letter-spacing: normal !important; word-spacing: normal !important; transform: none !important; filter: none !important; }
          #${rootId} p, #${rootId} li { orphans: 3; widows: 3; }
          #${rootId} p, #${rootId} li, #${rootId} blockquote, #${rootId} table { overflow-wrap: break-word; word-break: normal; hyphens: auto; }
          #${rootId} h1 { margin: 0 0 18px; padding-bottom: 10px; border-bottom: 2px solid #4CAF50; }
          #${rootId} h2 { margin: 18px 0 10px; page-break-after: avoid; break-after: avoid; }
          #${rootId} p { margin: 10px 0; }
          #${rootId} ul, #${rootId} ol { padding-left: 24px; margin: 8px 0; }
          #${rootId} li { margin: 4px 0; }
          #${rootId} code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 10.5pt; }
          #${rootId} pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
          #${rootId} blockquote { margin: 10px 0; padding-left: 12px; border-left: 4px solid #ddd; color: #555; }
          #${rootId} table, #${rootId} img { break-inside: avoid; page-break-inside: avoid; }
          #${rootId} .katex-display, #${rootId} mjx-container { break-inside: avoid; page-break-inside: avoid; }
          #${rootId} .katex, #${rootId} .katex *, #${rootId} mjx-container, #${rootId} mjx-container * { overflow-wrap: normal !important; word-break: normal !important; }
          #${rootId} .katex, #${rootId} .katex-display { white-space: nowrap !important; }
          #${rootId} hr { margin: 18px 0; border: 0; border-top: 1px solid #eee; }
          #${rootId} a { color: #1976D2; text-decoration: none; }
          #${rootId} .gpt-export-plain { white-space: pre-wrap; word-break: break-word; }
        }
      `;

      const safeDialogues = Array.isArray(ds) ? ds : [];
      let html = `<div style="margin-bottom: 10px;"><h1>GPT \u5bf9\u8bdd\u8bb0\u5f55</h1></div>`;
      for (let i = 0; i < safeDialogues.length; i++) {
        const d = safeDialogues[i] || {};
        const role = d.role ? escapeHtml(d.role) : '';
        const body = sanitizeFragment(d.html || d.text || '');
        html += `
          <section>
            <h2>\u5bf9\u8bdd ${i + 1}</h2>
            ${role ? `<p style="font-weight: bold; color: #2563eb;">Role: ${role}</p>` : ''}
            <div>${body}</div>
            <hr />
          </section>
        `;
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
  if (!Number.isFinite(tabId)) throw new Error('缂哄皯婧愰〉闈㈡爣绛鹃〉');


  let debuggerAttached = false;
  const reportSafe = typeof report === 'function' ? report : () => {};
  try {
    reportSafe('Attaching to source tab...');
    await withTimeout(debuggerAttachEnsured(tabId), 9000, 'Attach timed out');
    debuggerAttached = true;

    reportSafe('Preparing print content...');
    const prepared = await withTimeout(
      prepareSourcePrintDom(tabId, dialogues),
      15000,
      'Preparing print DOM timed out'
    );
    if (!prepared?.ok) throw new Error('Failed to prepare print content');


    reportSafe('Initializing print engine...');
    await withTimeout(debuggerSendEnsured(tabId, 'Page.enable'), 6000, 'Page.enable timed out');
    await withTimeout(debuggerSendEnsured(tabId, 'Runtime.enable'), 6000, 'Runtime.enable timed out');
    try {
      await withTimeout(debuggerSendEnsured(tabId, 'Runtime.evaluate', {
        expression:
          '(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); try { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(2500)]); } catch (_) {} await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(2500)]); return true; })()',
        awaitPromise: true,
        returnByValue: true
      }), 7000, 'Waiting for fonts/layout timed out');
    } catch (_) {
      // ignore: printing will still proceed
    }
    reportSafe('Printing to PDF...');
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
    }), 120000, 'printToPDF timed out');

    const bytes = fromBase64(result.data);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    reportSafe('Starting download...');
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
      reportSafe('Downloads API failed; falling back...');
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
      await withTimeout(debuggerDetachAsync(tabId), 6000, 'Detach timed out');
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

    subtitle.textContent = `Total: ${dialogues.length}`;
    container.innerHTML = buildHtml(dialogues);
    // Hide the quick mode by default; only show it when print-to-PDF fails.
    if (openBtn) openBtn.style.display = 'none';
    setStatus("Preview ready. Click High-quality download to generate and download the PDF.");

    printToPdfBtn.addEventListener('click', async () => {
      if (isGenerating) return;
      isGenerating = true;
      printToPdfBtn.disabled = true;
      openBtn.disabled = true;
      setStatus('Generating PDF (high quality)...');
      try {
        const filename = `gpt_dialogues_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
        const tabId = Number(sourceTabId);
        if (!Number.isFinite(tabId)) throw new Error('Missing source tab id');
        await printToPdfAndDownload(tabId, dialogues, filename, setStatus);
        chrome.storage.local.remove(storageKey);
        printToPdfBtn.disabled = true;
        setStatus('Download started (high quality).');
      } catch (e) {
        if (openBtn) openBtn.style.display = '';
        setStatus('Failed: ' + (e?.message || String(e)));
      } finally {
        isGenerating = false;
        if (!printToPdfBtn.disabled) printToPdfBtn.disabled = false;
        openBtn.disabled = false;
      }
    });

    // Note: Do not auto-start PDF generation. Some Chrome APIs behave better with a user gesture,
    // and users may want to review before generating.

    openBtn.addEventListener('click', async () => {
      if (isGenerating) return;
      isGenerating = true;
      openBtn.disabled = true;
      printToPdfBtn.disabled = true;
      setStatus('Generating PDF (quick mode)...');
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

        setStatus('Download started.');
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




