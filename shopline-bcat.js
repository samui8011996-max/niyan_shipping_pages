// ======================================================================
// Shopline 黑貓託運單 → 黑貓熱感應(95x193mm)(官網分頁,2026-11-17)
// ----------------------------------------------------------------------
// Shopline 後台印出來的黑貓單是 A4 PDF,一張標籤只佔上面一截,左右兩聯並排:
//   左 = 黏貼聯(包裹查詢號碼條碼、收寄件人、客戶代號)
//   右 = 配送聯(大字轉運碼、收寄件人、QR code、包裹條碼)+ 最右邊直排「常溫 / 契約月結 三方集貨」
// 這裡把兩聯原樣裁下來(pdf-lib embedPage,向量/原圖直接搬,條碼不會糊),
// 改排成黑貓熱感應紙的直式:上面黏貼聯、中間預印區留白、下面配送聯,
// 最底下照黑貓 HotPrint.pdf 的樣子再印一行大字查詢號碼。
//
// 位置怎麼找:每張標籤都有「包裹查詢號碼 xxxxxxxxxxxx」這行字,用 pdf.js 讀它的基線當錨點,
// 兩聯的框都是相對這條基線量的(樣本 1117-1.pdf 量出來)。一頁有幾個錨點就切幾張,
// 所以 Shopline 之後如果一頁塞兩三張也照樣切得開。
// ======================================================================

// 相對「包裹查詢號碼」那行基線(距頁面上緣)的框,單位 pt。左右多留 2pt 白邊避免切到線。
const SLB_STUB  = { x0: 10,  x1: 270, top: -43, bottom: 221 };   // 黏貼聯
const SLB_SHIP  = { x0: 276, x1: 578, top: -43, bottom: 221 };   // 配送聯(含直排字)

// 黑貓熱感應紙 95x193mm:中間 185~212pt 是紙上的預印區/分割線,不能印(跟蝦皮、官網出貨單同一種紙)
const SLB_PAGE = { w: 95 * 72 / 25.4, h: 193 * 72 / 25.4 };       // 269.3 x 547.1
const SLB_TOP_AREA    = { top: 4,   bottom: 181 };                // 上段:放黏貼聯
const SLB_BOTTOM_AREA = { top: 216, bottom: 543 };                // 下段:放配送聯 + 大字號碼
const SLB_SIDE = 4;                                               // 左右邊界
const SLB_TRACK_SIZE = 30;                                        // 最底下大字查詢號碼

let slbFiles = [];   // [{ name, bytes }]

function slbSetStatus(msg, kind) {
  setStatus("slbStatus", kind || "", msg);   // ui-utils.js
}

// 一頁裡找出所有標籤:回傳 [{ base, track }],base = 錨點基線距頁面上緣(pt)
async function slbFindLabels(pdfPage) {
  const pageH = pdfPage.view[3] - pdfPage.view[1];
  const tc = await pdfPage.getTextContent();
  const items = tc.items.filter(it => it.str && it.str.trim());
  const found = [];
  for (const it of items) {
    if (!it.str.includes("包裹查詢號碼")) continue;
    const baseY = it.transform[5];                       // 基線,左下角原點
    // 號碼可能跟「包裹查詢號碼」同一段,也可能被拆成同一行的下一段
    let m = it.str.match(/\d{10,}/);
    if (!m) {
      const sameLine = items.filter(o => o !== it && Math.abs(o.transform[5] - baseY) < 3
                                      && o.transform[4] > it.transform[4]);
      for (const o of sameLine) { m = o.str.match(/\d{10,}/); if (m) break; }
    }
    found.push({ base: pageH - (baseY - pdfPage.view[1]), track: m ? m[0] : "" });
  }
  found.sort((a, b) => a.base - b.base);
  return found;
}

// 9079826433 02 → 9079-8264-3302(黑貓 HotPrint 底下大字就是這樣四碼一組)
function slbFormatTrack(t) {
  return t.length === 12 ? t.replace(/(\d{4})(\d{4})(\d{4})/, "$1-$2-$3") : t;
}

async function slbHandleFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => /\.pdf$/i.test(f.name));
  const disp = document.getElementById("slbFileDisplay");
  if (!files.length) {
    slbFiles = [];
    if (disp) { disp.textContent = "尚未選擇檔案…"; disp.classList.add("empty"); }
    document.getElementById("slbBtn").disabled = true;
    slbSetStatus("請選 Shopline 印出來的黑貓單 PDF", "warn");
    return;
  }
  slbFiles = [];
  for (const f of files) slbFiles.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  if (disp) { disp.textContent = files.map(f => f.name).join("、"); disp.classList.remove("empty"); }
  document.getElementById("slbBtn").disabled = false;
  slbSetStatus(`已選 ${files.length} 個檔案,按「轉成黑貓熱感應」`);
}

async function generateShoplineBcat() {
  if (!slbFiles.length) return;
  const btn = document.getElementById("slbBtn");
  btn.disabled = true;
  slbSetStatus("轉換中…", "loading");
  try {
    await ensureShopeeLibs();   // pdf.js + pdf-lib(蝦皮那邊已經有載入器,共用)
    const out = await PDFLib.PDFDocument.create();
    const bold = await out.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const missing = [];   // 找不到標籤的頁
    let count = 0;

    for (const file of slbFiles) {
      // pdf.js 會把傳進去的 buffer 轉移走,給它一份複本
      const jsDoc = await pdfjsLib.getDocument({ data: file.bytes.slice() }).promise;
      const libDoc = await PDFLib.PDFDocument.load(file.bytes);
      for (let p = 1; p <= jsDoc.numPages; p++) {
        const jsPage = await jsDoc.getPage(p);
        const labels = await slbFindLabels(jsPage);
        if (!labels.length) { missing.push(`${file.name} 第 ${p} 頁`); continue; }
        const srcPage = libDoc.getPage(p - 1);
        const { x: mx, y: my, height: mh } = srcPage.getMediaBox();
        // 「距上緣」→ pdf-lib 的左下角原點
        const box = (r, base) => ({
          left: mx + r.x0, right: mx + r.x1,
          top: my + mh - (base + r.top), bottom: my + mh - (base + r.bottom),
        });

        for (const lab of labels) {
          const page = out.addPage([SLB_PAGE.w, SLB_PAGE.h]);
          const fromTop = y => SLB_PAGE.h - y;
          const availW = SLB_PAGE.w - SLB_SIDE * 2;

          // 上段:黏貼聯,縮到塞得進預印區上面,水平置中
          const stub = await out.embedPage(srcPage, box(SLB_STUB, lab.base));
          const sW = SLB_STUB.x1 - SLB_STUB.x0, sH = SLB_STUB.bottom - SLB_STUB.top;
          const sScale = Math.min(availW / sW, (SLB_TOP_AREA.bottom - SLB_TOP_AREA.top) / sH);
          page.drawPage(stub, {
            x: (SLB_PAGE.w - sW * sScale) / 2,
            y: fromTop(SLB_TOP_AREA.top + sH * sScale),
            xScale: sScale, yScale: sScale,
          });

          // 下段:配送聯,寬度撐滿
          const ship = await out.embedPage(srcPage, box(SLB_SHIP, lab.base));
          const dW = SLB_SHIP.x1 - SLB_SHIP.x0, dH = SLB_SHIP.bottom - SLB_SHIP.top;
          const dScale = Math.min(availW / dW, (SLB_BOTTOM_AREA.bottom - SLB_BOTTOM_AREA.top) / dH);
          const shipBottom = SLB_BOTTOM_AREA.top + dH * dScale;
          page.drawPage(ship, {
            x: (SLB_PAGE.w - dW * dScale) / 2,
            y: fromTop(shipBottom),
            xScale: dScale, yScale: dScale,
          });

          // 最底下:大字查詢號碼(剩下的空間放得下才印;太寬就縮)
          if (lab.track) {
            const text = slbFormatTrack(lab.track);
            let size = SLB_TRACK_SIZE;
            while (size > 12 && bold.widthOfTextAtSize(text, size) > availW) size -= 1;
            const room = SLB_BOTTOM_AREA.bottom - shipBottom;
            if (room >= size) {
              const w = bold.widthOfTextAtSize(text, size);
              page.drawText(text, {
                x: (SLB_PAGE.w - w) / 2,
                y: fromTop(shipBottom + (room + size * 0.72) / 2),
                size, font: bold, color: PDFLib.rgb(0, 0, 0),
              });
            }
          }
          count++;
        }
      }
    }

    if (!count) {
      slbSetStatus("❌ 沒找到黑貓標籤(找不到「包裹查詢號碼」這行字)。是 Shopline 印出來的黑貓單 PDF 嗎?", "error");
      return;
    }
    const bytes = await out.save();
    const d = new Date(), z = n => String(n).padStart(2, "0");
    const name = `Shopline黑貓熱感應_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.pdf`;
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
    let msg = `✅ 轉好 ${count} 張,已下載 ${name}。從資料夾用 Adobe 開來印(跟 HotPrint.pdf 一樣的設定)`;
    if (missing.length) msg += `\n⚠️ 這些頁沒找到標籤,沒有轉:${missing.join("、")}`;
    slbSetStatus(msg, missing.length ? "warn" : "success");
  } catch (e) {
    console.error(e);
    slbSetStatus("❌ 轉換失敗:" + (e && e.message ? e.message : e), "error");
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("slbInput");
  if (input) input.addEventListener("change", e => slbHandleFiles(e.target.files));
});
