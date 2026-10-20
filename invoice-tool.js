// ===================================================================
// 發票放大(暫時頁面):丟電子發票證明聯 PDF(熱感紙那種小張),重新排版成「主要 QRcode 放大」的 PDF 給你下載。
// 做法:pdf.js 用高解析度把第 1 頁畫出來 → jsQR 找出兩個 QRcode(左邊是主要的、右邊是補充的)
//       → 上半部(店名/期別/發票號碼/條碼)整塊保留 → 主要 QRcode 放最大、補充 QRcode 放中等 → 存成新 PDF。
// 全部在瀏覽器裡跑,檔案不會上傳。pdf.js / jsQR 第一次用到才從 CDN 載。
// ===================================================================
const INV_PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const INV_PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
const INV_JSQR = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
const INV_PAGE_W = 100;      // 新 PDF 寬(mm)
const INV_MARGIN = 5;
const INV_MAIN_W = 84;       // 主要 QRcode 寬(mm)
const INV_SUB_W = 56;        // 補充 QRcode 寬(mm)
const INV_HEAD_W = 90;       // 上半部寬(mm)
const invResults = [];       // { name, url(blob pdf), previewUrl, warn } 或 { name, error }

function invLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("載入失敗:" + src));
    document.head.appendChild(s);
  });
}

let invLibsPromise = null;
function invEnsureLibs() {
  if (!invLibsPromise) {
    invLibsPromise = (async () => {
      if (!window.pdfjsLib) await invLoadScript(INV_PDFJS);
      if (!window.jsQR) await invLoadScript(INV_JSQR);
      // worker 在別的網域不能直接 new Worker,先抓下來變成 blob 網址
      const code = await (await fetch(INV_PDFJS_WORKER)).text();
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    })().catch(e => { invLibsPromise = null; throw e; });
  }
  return invLibsPromise;
}

// 找一個 QRcode,回傳外框(像素);找不到回 null
function invFindQr(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const r = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
  if (!r) return null;
  const pts = [r.location.topLeftCorner, r.location.topRightCorner, r.location.bottomRightCorner, r.location.bottomLeftCorner];
  const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x));
  const y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function invCrop(src, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.min(src.width - x, Math.round(w)));
  h = Math.max(1, Math.min(src.height - y, Math.round(h)));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

async function invProcess(file) {
  await invEnsureLibs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(10, Math.max(4, 2400 / base.width));   // 寬度約 2400px,QRcode 夠細緻
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  // 找兩個 QRcode:找到第一個就塗白,再找第二個
  const W = canvas.width, H = canvas.height;
  const found = [];
  const work = invCrop(canvas, 0, 0, W, H).getContext("2d", { willReadFrequently: true });
  for (let i = 0; i < 2; i++) {
    const q = invFindQr(work, W, H);
    if (!q) break;
    found.push(q);
    const pad = q.w * 0.15;
    work.fillStyle = "#fff";
    work.fillRect(q.x - pad, q.y - pad, q.w + pad * 2, q.h + pad * 2);
  }
  if (!found.length) throw new Error("找不到 QRcode,這個 PDF 可能不是電子發票證明聯");

  let warn = "";
  found.sort((a, b) => a.x - b.x);
  const main = found[0];
  let sub = found[1];
  if (!sub) {
    // 只讀到一個:補充 QRcode 通常很密,讀不出來時就依位置推一個框,照樣裁下來
    sub = { x: main.x + W * 0.465, y: main.y, w: main.w, h: main.h };
    if (sub.x + sub.w > W) sub = null;
    warn = "補充 QRcode(右邊那個)沒辦法自動辨識,已依位置裁切,請掃掃看確認";
  }

  const K = 0.14;   // 留白(QRcode 要有安靜區才好掃)
  const crop = q => invCrop(canvas, q.x - q.w * K, q.y - q.h * K, q.w * (1 + 2 * K), q.h * (1 + 2 * K));
  const topY = Math.min(main.y, sub ? sub.y : main.y) - main.h * K;
  const head = invCrop(canvas, 0, 0, W, topY - main.h * 0.02);
  const mainC = crop(main);
  const subC = sub ? crop(sub) : null;

  // 排版:上半部 → 主要 QRcode(大) → 補充 QRcode(中)
  const gap = 4;
  const headH = INV_HEAD_W * head.height / head.width;
  const mainH = INV_MAIN_W * mainC.height / mainC.width;
  const subH = subC ? INV_SUB_W * subC.height / subC.width : 0;
  const pageH = INV_MARGIN + headH + gap + mainH + (subC ? gap + subH : 0) + INV_MARGIN;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: [INV_PAGE_W, pageH], orientation: "portrait" });
  const cx = w => (INV_PAGE_W - w) / 2;
  let y = INV_MARGIN;
  doc.addImage(head.toDataURL("image/png"), "PNG", cx(INV_HEAD_W), y, INV_HEAD_W, headH); y += headH + gap;
  doc.addImage(mainC.toDataURL("image/png"), "PNG", cx(INV_MAIN_W), y, INV_MAIN_W, mainH); y += mainH + gap;
  if (subC) doc.addImage(subC.toDataURL("image/png"), "PNG", cx(INV_SUB_W), y, INV_SUB_W, subH);

  // 預覽圖(縮小版 jpg)
  const pv = document.createElement("canvas");
  const pvW = 360, k = pvW / INV_PAGE_W;
  pv.width = pvW; pv.height = Math.round(pageH * k);
  const pg = pv.getContext("2d");
  pg.fillStyle = "#fff"; pg.fillRect(0, 0, pv.width, pv.height);
  y = INV_MARGIN;
  pg.drawImage(head, cx(INV_HEAD_W) * k, y * k, INV_HEAD_W * k, headH * k); y += headH + gap;
  pg.drawImage(mainC, cx(INV_MAIN_W) * k, y * k, INV_MAIN_W * k, mainH * k); y += mainH + gap;
  if (subC) pg.drawImage(subC, cx(INV_SUB_W) * k, y * k, INV_SUB_W * k, subH * k);

  return {
    name: file.name.replace(/\.pdf$/i, "") + "-放大.pdf",
    url: URL.createObjectURL(doc.output("blob")),
    previewUrl: pv.toDataURL("image/jpeg", 0.9),
    warn,
  };
}

async function handleInvoiceFiles(files) {
  const status = document.getElementById("invStatus");
  const list = Array.from(files || []).filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (!list.length) { status.textContent = "請選 PDF 檔"; return; }
  for (const f of list) {
    status.textContent = `處理中:${f.name} …`;
    try {
      invResults.unshift(await invProcess(f));
    } catch (e) {
      console.error(e);
      invResults.unshift({ name: f.name, error: e.message || String(e) });
    }
    renderInvoiceResults();
  }
  status.textContent = "";
  document.getElementById("invFile").value = "";
}

function renderInvoiceResults() {
  const box = document.getElementById("invResult");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  box.innerHTML = invResults.map(r => r.error
    ? `<section class="card"><div class="card-label">${esc(r.name)}</div><p style="color:#c0392b;margin:0;">${esc(r.error)}</p></section>`
    : `<section class="card">
        <div class="card-label">${esc(r.name)}</div>
        ${r.warn ? `<p style="color:#b9770e;font-size:13px;margin:0 0 8px;">${esc(r.warn)}</p>` : ""}
        <img src="${r.previewUrl}" alt="" style="max-width:360px;width:100%;border:1px solid var(--border,#ddd);border-radius:6px;display:block;margin-bottom:10px;">
        <a class="btn btn-primary btn-small" href="${r.url}" download="${esc(r.name)}">下載放大版 PDF</a>
      </section>`).join("");
}

function setupInvoiceDrop() {
  const zone = document.getElementById("invDrop");
  if (!zone) return;
  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.style.borderColor = "#06C755"; }));
  ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.style.borderColor = ""; }));
  zone.addEventListener("drop", e => handleInvoiceFiles(e.dataTransfer.files));
}
document.addEventListener("DOMContentLoaded", setupInvoiceDrop);
