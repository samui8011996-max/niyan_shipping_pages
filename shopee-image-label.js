// ===================================================================
// 蝦皮全家寄件單(圖片版)(2026-11-16)
//
// 蝦皮全家的「列印寄件單」下載下來是一張圖(.gif),不是 PDF:A4 用虛線切成 2×2 四格,
// 標籤畫在格子裡,上面的字是點陣圖、沒有文字可以讀。
// 但標籤右上角的 QR code 內容最後一段就是蝦皮訂單編號
//   例:"A3||1797…||…||5490582210084076|| 261115CEQ7VX3C          "
// 所以每一格讀 QR code → 拿到訂單編號 → 把那一格的標籤裁下來,跟 PDF 的標籤走同一條路。
//
// 讀不到 QR code 的格子當空格跳過(全家一張圖不一定四格都有東西);整張圖都讀不到會在狀態列講。
// 7-ELEVEN 還沒有樣本,先不處理。
// ===================================================================

const SHOPEE_JSQR_SRC = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";

let shopeeImgLabels = [];   // [{ name, labels: [{ orderSn, png: Uint8Array, w, h }] }]

// 蝦皮訂單編號:6 碼日期 + 8 碼英數(例 261115CEQ7VX3C)
const SHOPEE_SN_RE = /\b(\d{6}[0-9A-Z]{8})\b/;

function shopeeSnFromQr(text) {
  const parts = String(text || "").split("||").map(s => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (/^\d{6}[0-9A-Z]{8}$/.test(last)) return last;
  const m = String(text || "").match(SHOPEE_SN_RE);
  return m ? m[1] : "";
}

// 一塊區域裡「黑色像素」的外框(灰階 < 160 算黑)。全白回傳 null
function shopeeInkBox(img, x0, y0, x1, y1) {
  const { data, width } = img;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y += 2) {        // 隔一列看就夠準,快一倍
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      const g = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      if (g < 160 && data[i + 3] > 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  return {
    x: Math.max(x0, minX - pad), y: Math.max(y0, minY - pad),
    x2: Math.min(x1, maxX + pad), y2: Math.min(y1, maxY + pad),
  };
}

function shopeeCropCanvas(src, box) {
  const c = document.createElement("canvas");
  c.width = box.x2 - box.x; c.height = box.y2 - box.y;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, box.x, box.y, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

async function shopeeReadImageLabels(file) {
  const bmp = await createImageBitmap(file);
  const full = document.createElement("canvas");
  full.width = bmp.width; full.height = bmp.height;
  const fctx = full.getContext("2d");
  fctx.fillStyle = "#fff"; fctx.fillRect(0, 0, full.width, full.height);   // GIF 透明的地方當白紙
  fctx.drawImage(bmp, 0, 0);
  const img = fctx.getImageData(0, 0, full.width, full.height);
  const W = full.width, H = full.height;

  // 2×2 四格;中間的虛線各讓開 30px 才不會被當成標籤的一部分
  const m = 30, hw = Math.floor(W / 2), hh = Math.floor(H / 2);
  const cells = [
    [0, 0, hw - m, hh - m], [hw + m, 0, W, hh - m],
    [0, hh + m, hw - m, H], [hw + m, hh + m, W, H],
  ];
  const tryCell = (x0, y0, x1, y1) => {
    const box = shopeeInkBox(img, x0, y0, x1, y1);
    if (!box || box.x2 - box.x < 100 || box.y2 - box.y < 100) return null;
    const crop = shopeeCropCanvas(full, box);
    const cd = crop.getContext("2d").getImageData(0, 0, crop.width, crop.height);
    const qr = window.jsQR(cd.data, cd.width, cd.height, { inversionAttempts: "dontInvert" });
    if (!qr) return null;
    const orderSn = shopeeSnFromQr(qr.data);
    if (!orderSn) return null;
    return { orderSn, canvas: crop };
  };

  let found = cells.map(c => tryCell(...c)).filter(Boolean);
  if (!found.length) {                       // 不是 2×2 排法的圖:整張當一張試試
    const one = tryCell(0, 0, W, H);
    if (one) found = [one];
  }
  const labels = [];
  for (const f of found) {
    const blob = await new Promise(r => f.canvas.toBlob(r, "image/png"));
    labels.push({ orderSn: f.orderSn, png: new Uint8Array(await blob.arrayBuffer()),
                  w: f.canvas.width, h: f.canvas.height });
  }
  return labels;
}

async function onShopeeImageFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  preloadShopeeFont();
  shopeePdfLoading = true;                   // 讀圖要幾秒,鎖住「產生出貨單」
  renderShopeePreview();
  const bad = [];
  try {
    if (!window.jsQR) await shopeeLoadScript(SHOPEE_JSQR_SRC);
    for (const file of list) {
      const labels = await shopeeReadImageLabels(file);
      if (!labels.length) bad.push(file.name);
      shopeeImgLabels = shopeeImgLabels.filter(x => x.name !== file.name);
      shopeeImgLabels.push({ name: file.name, labels });
    }
  } catch (e) {
    shopeePdfLoading = false;
    setShopeeStatus("寄件單圖片讀取失敗:" + e.message, "error");
    renderShopeePreview();
    return;
  }
  shopeePdfLoading = false;
  renderShopeeFileList();
  renderShopeePreview();
  if (bad.length) {
    setShopeeStatus("這幾張圖讀不到寄件單的 QR code:" + bad.join("、") + "(圖片要是原檔,不能是截圖縮小過的)", "warn");
  }
}
