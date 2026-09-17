// ===================================================================
// 分區列印:黑貓託運單 PDF 分頁
// ===================================================================
// 舊流程是「每組下載一份黑貓出貨表 xlsx → 一份一份丟進黑貓系統」,很花時間。
// 新流程改成:訂單一次全部倒進黑貓系統 → 黑貓吐回一份含全部託運單的 PDF →
// 丟進這裡,依照跟 xlsx 完全一樣的撿貨分組,把 PDF 拆成「每組一個檔」。
//
// 對應方式:每頁託運單上都印著訂單編號(18 碼),用它跟今天的 LINE 訂單表對。
// 實測 76 頁的檔案是一頁一個訂單編號、沒有重複,但程式仍支援同一訂單占多頁(多件)。
//
// 兩個函式庫都是「用到才載」,不放在 <head>:光 pdf.js 的 worker 就 1MB,
// 沒要分 PDF 的人不該為它付載入時間。
// ===================================================================

const PDFJS_SRC    = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const PDFLIB_SRC   = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";

let zonedPdfBytes = null;         // 原始 PDF(給 pdf-lib 重組用,不能是被 pdf.js 吃掉的那份)
let zonedPdfName = "";
let zonedPdfPages = [];           // [{ index(0起), orderId, trackNo }]
let zonedPdfByOrder = new Map();  // 訂單編號 → [頁 index,...]
let zonedPdfSrcDoc = null;        // pdf-lib 載好的來源文件,重複使用不用每次重讀

const zonedScriptCache = new Map();
function loadScriptOnce(src) {
  if (zonedScriptCache.has(src)) return zonedScriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("函式庫載入失敗:" + src));
    document.head.appendChild(el);
  });
  zonedScriptCache.set(src, p);
  return p;
}

async function ensurePdfLibs() {
  if (!window.pdfjsLib) {
    await loadScriptOnce(PDFJS_SRC);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  if (!window.PDFLib) await loadScriptOnce(PDFLIB_SRC);
}

// 從一頁的文字裡挖出訂單編號。
// 託運單上「訂單編號」會出現兩次,下半截那個是被截掉的 17 碼,所以:
//   1. 先找「訂單編號」標籤後面那串,長度剛好 18 碼的才算數
//   2. 找不到才退回「全頁任何一串獨立的 18 碼數字」
// pdf.js 給的文字是一小段一小段的,數字可能被切開,所以比對前先把空白全部拿掉。
function extractOrderId(text) {
  const flat = String(text).replace(/\s+/g, "");
  const labelled = flat.match(/訂單編號[:：]?(\d{18})(?!\d)/);
  if (labelled) return labelled[1];
  const any = flat.match(/(?<!\d)\d{18}(?!\d)/);
  return any ? any[0] : "";
}

function extractTrackNo(text) {
  const m = String(text).replace(/\s+/g, "").match(/(\d{4}-\d{4}-\d{4})/);
  return m ? m[1] : "";
}

async function handleZonedPdf(file) {
  setStatus("zonedStatus", "loading", "載入 PDF 函式庫…");
  try {
    await ensurePdfLibs();
    const buf = await file.arrayBuffer();
    // pdf.js 會把傳進去的 ArrayBuffer 吃掉(detach),所以另外留一份給 pdf-lib
    zonedPdfBytes = new Uint8Array(buf.slice(0));

    setStatus("zonedStatus", "loading", "解析託運單…");
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

    zonedPdfPages = [];
    zonedPdfByOrder = new Map();
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map(it => it.str).join(" ");
      const orderId = extractOrderId(text);
      zonedPdfPages.push({ index: i - 1, orderId: orderId, trackNo: extractTrackNo(text) });
      if (orderId) {
        if (!zonedPdfByOrder.has(orderId)) zonedPdfByOrder.set(orderId, []);
        zonedPdfByOrder.get(orderId).push(i - 1);
      }
      if (i % 20 === 0) setStatus("zonedStatus", "loading", "解析託運單… " + i + "/" + doc.numPages);
    }

    zonedPdfSrcDoc = await PDFLib.PDFDocument.load(zonedPdfBytes);
    zonedPdfName = file.name;

    renderZonedPdfSummary();
    refreshZonedListsForPdf();

    const noId = zonedPdfPages.filter(p => !p.orderId).length;
    let msg = "✓ 已讀取 " + zonedPdfPages.length + " 頁託運單";
    if (noId > 0) msg += ",其中 " + noId + " 頁抓不到訂單編號";
    setStatus("zonedStatus", noId > 0 ? "warn" : "success", msg);
  } catch (e) {
    zonedPdfBytes = null; zonedPdfSrcDoc = null;
    zonedPdfPages = []; zonedPdfByOrder = new Map();
    renderZonedPdfSummary();
    setStatus("zonedStatus", "error", "✗ PDF 讀取失敗:" + e.message);
    console.error(e);
  }
}

// 載入 PDF 後清單上要多出「⬇ 託運單」按鈕,所以重畫一次(清單本身的內容不變)
function refreshZonedListsForPdf() {
  if (typeof zonedGroupsCache !== "undefined" && zonedGroupsCache) {
    renderZonedGroupList(zonedGroupsCache);
  }
  if (typeof zonedMergedRowsCache !== "undefined" && zonedMergedRowsCache) {
    renderZonedMergedBlock(zonedMergedRowsCache, getZonedOptions().threshold);
  }
}

function zonedPdfReady() { return !!zonedPdfSrcDoc && zonedPdfPages.length > 0; }

// 一組訂單 → 要抽哪幾頁。頁序照訂單在組內的順序(也就是撿貨順序),
// 找不到託運單的訂單另外回報,不靜靜吞掉。
function pagesForRows(rows) {
  const pages = [];
  const missing = [];
  const seen = new Set();
  (rows || []).forEach(r => {
    const id = String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim();
    const hit = zonedPdfByOrder.get(id);
    if (!hit || hit.length === 0) { missing.push(id); return; }
    hit.forEach(p => { if (!seen.has(p)) { seen.add(p); pages.push(p); } });
  });
  return { pages: pages, missing: missing };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function savePagesAsPdf(pageIndexes, filename) {
  const out = await PDFLib.PDFDocument.create();
  const copied = await out.copyPages(zonedPdfSrcDoc, pageIndexes);
  copied.forEach(p => out.addPage(p));
  const bytes = await out.save();
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), filename);
}

// 清單上每一列的「⬇ 託運單」按鈕(沒載 PDF 就不顯示,避免按了才說沒資料)
function zonedPdfGroupButton(kind, idx) {
  if (!zonedPdfReady()) return "";
  return '<button class="btn btn-lavender btn-small" onclick="downloadZonedGroupPdf(\'' +
         kind + '\', ' + idx + ')">⬇ 託運單</button>';
}

async function downloadZonedGroupPdf(kind, idx) {
  if (!zonedPdfReady()) { setStatus("zonedStatus", "warn", "請先選擇黑貓託運單 PDF"); return; }
  const g = kind === "merged"
    ? { label: "其他合併", rows: zonedMergedRowsCache }
    : zonedGroupsCache[idx];
  if (!g || !g.rows || g.rows.length === 0) return;

  try {
    const r = pagesForRows(g.rows);
    if (r.pages.length === 0) {
      setStatus("zonedStatus", "warn", "「" + g.label + "」這組在 PDF 裡找不到任何託運單");
      return;
    }
    await savePagesAsPdf(r.pages, "託運單_" + sanitizeFilenamePart(g.label) + ".pdf");
    let msg = "✓ 已下載「" + g.label + "」託運單 " + r.pages.length + " 頁";
    if (r.missing.length > 0) msg += " · ⚠ " + r.missing.length + " 筆訂單在 PDF 裡沒有對應的單";
    setStatus("zonedStatus", r.missing.length > 0 ? "warn" : "success", msg);
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 託運單下載失敗:" + e.message);
    console.error(e);
  }
}

// 目前清單上每一組各出一個 PDF 檔;瀏覽器對「連續觸發下載」很敏感,所以中間留間隔
async function downloadAllZonedPdfs() {
  if (!zonedPdfReady()) { setStatus("zonedStatus", "warn", "請先選擇黑貓託運單 PDF"); return; }

  const jobs = [];
  (zonedGroupsCache || []).forEach(g => jobs.push({ label: g.label, rows: g.rows }));
  if (zonedMergedRowsCache && zonedMergedRowsCache.length > 0) {
    jobs.push({ label: "其他合併", rows: zonedMergedRowsCache });
  }
  zonedPdfExtraBuckets().forEach(b => jobs.push(b));

  if (jobs.length === 0) { setStatus("zonedStatus", "warn", "目前沒有可下載的組別"); return; }

  let files = 0, pageTotal = 0, missTotal = 0;
  try {
    for (const job of jobs) {
      const r = job.pageIndexes
        ? { pages: job.pageIndexes, missing: [] }
        : pagesForRows(job.rows);
      missTotal += r.missing.length;
      if (r.pages.length === 0) continue;
      await savePagesAsPdf(r.pages, "託運單_" + sanitizeFilenamePart(job.label) + ".pdf");
      files++;
      pageTotal += r.pages.length;
      await new Promise(res => setTimeout(res, 300));
    }
    let msg = "✓ 已下載 " + files + " 個託運單 PDF,共 " + pageTotal + " 頁";
    if (missTotal > 0) msg += " · ⚠ " + missTotal + " 筆訂單找不到對應的託運單";
    setStatus("zonedStatus", missTotal > 0 ? "warn" : "success", msg);
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 批次下載失敗:" + e.message);
    console.error(e);
  }
}

// 分區清單裝不下的頁另外歸類,不能讓它們消失:
//   1. 訂單表裡有、但被分區排除的(黑熊/盆景公仔組/離島)→ 依類別各出一檔
//   2. 訂單表裡根本找不到的 → 「未對應」一檔,連同抓不到訂單編號的頁
function zonedPdfExtraBuckets() {
  const inZoned = new Set();
  (zonedGroupsCache || []).forEach(g => (g.rows || []).forEach(
    r => inZoned.add(String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim())));
  (zonedMergedRowsCache || []).forEach(
    r => inZoned.add(String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim()));

  const rowByOrder = new Map();
  (typeof loadedRows !== "undefined" && loadedRows ? loadedRows : []).forEach(
    r => rowByOrder.set(String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim(), r));

  const byLabel = new Map();
  zonedPdfPages.forEach(p => {
    if (p.orderId && inZoned.has(p.orderId)) return;
    const row = p.orderId ? rowByOrder.get(p.orderId) : null;
    let label = "未對應";
    if (row) label = row["_離島"] ? "離島郵局" : (row["_類別"] || "未分類");
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(p.index);
  });

  return Array.from(byLabel, ([label, pageIndexes]) => ({
    label: label, pageIndexes: pageIndexes, rows: [],
  }));
}

function renderZonedPdfSummary() {
  const el = document.getElementById("zonedPdfSummary");
  if (!el) return;
  if (!zonedPdfReady()) { el.innerHTML = ""; return; }

  const rows = (typeof loadedRows !== "undefined" && loadedRows) ? loadedRows : [];
  const known = new Set(rows.map(r => String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim()));
  const matched = zonedPdfPages.filter(p => p.orderId && known.has(p.orderId)).length;
  const unmatched = zonedPdfPages.length - matched;

  const extras = zonedPdfExtraBuckets().map((b, i) =>
    '<button class="btn btn-secondary btn-small" onclick="downloadZonedExtraPdf(' + i + ')">⬇ ' +
    escapeHtml(b.label) + "(" + b.pageIndexes.length + " 頁)</button>").join("");

  el.innerHTML =
    '<div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 12px;">' +
      '<div class="stat-card lavender">' +
        '<div class="stat-label">託運單頁數</div>' +
        '<div><span class="stat-number">' + zonedPdfPages.length + '</span><span class="stat-unit">頁</span></div>' +
        '<div class="stat-sub">' + escapeHtml(zonedPdfName) + '</div>' +
      '</div>' +
      '<div class="stat-card green">' +
        '<div class="stat-label">對到今天訂單</div>' +
        '<div><span class="stat-number">' + matched + '</span><span class="stat-unit">頁</span></div>' +
        '<div class="stat-sub">用訂單編號比對</div>' +
      '</div>' +
      '<div class="stat-card ' + (unmatched > 0 ? "orange" : "gray") + '">' +
        '<div class="stat-label">沒對到</div>' +
        '<div><span class="stat-number">' + unmatched + '</span><span class="stat-unit">頁</span></div>' +
        '<div class="stat-sub">會歸到下面的分類檔,不會漏掉</div>' +
      '</div>' +
    '</div>' +
    '<div class="actions" style="margin-bottom: 0;">' +
      '<button class="btn btn-lavender" onclick="downloadAllZonedPdfs()" ' +
      'title="清單上每一組各出一個 PDF 檔">▶ 全部下載託運單(每組一檔)</button>' +
      extras +
    '</div>';
}

async function downloadZonedExtraPdf(i) {
  const b = zonedPdfExtraBuckets()[i];
  if (!b) return;
  try {
    await savePagesAsPdf(b.pageIndexes, "託運單_" + sanitizeFilenamePart(b.label) + ".pdf");
    setStatus("zonedStatus", "success", "✓ 已下載「" + b.label + "」" + b.pageIndexes.length + " 頁");
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 下載失敗:" + e.message);
    console.error(e);
  }
}
