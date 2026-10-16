// ===================================================================
// 離島出貨貼紙 PDF(寄件人固定、收件人放大放下面)
// 多筆訂單時壓成同一個 PDF,一筆一頁
//
// 兩種紙(膠囊鈕切換,預設黑貓熱感應):
//   bcat = 黑貓熱感應紙 95x193mm。中間 64~77mm 是紙上原本的印刷區,不能印字,
//          所以上半印寄件人+備註(小字),下半印收件人(大字)
//   4x6  = 原本的 100x150mm 貼紙,版面跟以前一樣
// ===================================================================
const OFFSHORE_FORMATS = {
  bcat: { w: 95, h: 193, gapTop: 64, gapBottom: 77 },
  "4x6": { w: 100, h: 150 },
};
let offshoreFormat = "bcat";

function setOffshoreFormat(fmt) {
  if (!OFFSHORE_FORMATS[fmt]) return;
  offshoreFormat = fmt;
  setFormatPills("offshoreFormatPills", fmt);
  try { localStorage.setItem("offshoreFormat", fmt); } catch (e) {}
}
function wrapCanvasText(ctx, text, maxWidth) {
  const chars = String(text ?? "").split("");
  const lines = [];
  let line = "";
  for (const ch of chars) {
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

async function ensureFontsLoaded() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('400 100px "Noto Sans TC"'),
      document.fonts.load('700 100px "Noto Sans TC"'),
    ]);
    await document.fonts.ready;
  } catch (_) { /* 字型載入失敗就用瀏覽器預設字型,不擋流程 */ }
}

function drawOffshoreLabel(row, fmt) {
  const DPI = 300;
  const mmToPx = mm => Math.round(mm / 25.4 * DPI);
  const W = mmToPx(fmt.w);
  const H = mmToPx(fmt.h);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  const marginX = mmToPx(8);
  const contentW = W - marginX * 2;
  let y = mmToPx(8);

  // ---- 寄件人(固定資訊,字較小) ----
  const drawSender = () => {
    const senderFontPx = mmToPx(3.6);
    ctx.font = `${senderFontPx}px "Noto Sans TC", sans-serif`;
    [
      "寄件人",
      OFFSHORE_SENDER.name,
      `${OFFSHORE_SENDER.zip} ${OFFSHORE_SENDER.address}`,
      OFFSHORE_SENDER.phone,
    ].forEach(line => {
      wrapCanvasText(ctx, line, contentW).forEach(l => {
        ctx.fillText(l, marginX, y);
        y += senderFontPx * 1.35;
      });
    });
  };

  const drawLine = () => {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = mmToPx(0.3);
    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(W - marginX, y);
    ctx.stroke();
  };

  // ---- 收件人(放大) ----
  const drawRecipient = () => {
    const recvLabelFontPx = mmToPx(6);
    const recvFontPx = mmToPx(8.5);

    ctx.font = `bold ${recvLabelFontPx}px "Noto Sans TC", sans-serif`;
    ctx.fillText("收件人", marginX, y);
    y += recvLabelFontPx * 1.4;

    ctx.font = `bold ${recvFontPx}px "Noto Sans TC", sans-serif`;
    const name = String(row["收件人姓名"] ?? "").trim();
    wrapCanvasText(ctx, name, contentW).forEach(l => {
      ctx.fillText(l, marginX, y);
      y += recvFontPx * 1.4;
    });

    y += mmToPx(4);
    const addr = String(row["配送地址"] ?? "").trim();
    const zip = extractOffshoreZip(addr);
    const addrWithZip = zip ? `${zip} ${addr}` : addr;
    wrapCanvasText(ctx, addrWithZip, contentW).forEach(l => {
      ctx.fillText(l, marginX, y);
      y += recvFontPx * 1.4;
    });

    y += mmToPx(4);
    const phone = String(row["收件人聯絡電話"] ?? "").trim();
    wrapCanvasText(ctx, phone, contentW).forEach(l => {
      ctx.fillText(l, marginX, y);
      y += recvFontPx * 1.4;
    });
  };

  // ---- 備註(小字,訂單編號 + 訂購商品,跟黑貓備註同一套 _備註) ----
  const drawNote = () => {
    const noteLabelFontPx = mmToPx(3.6);
    ctx.font = `bold ${noteLabelFontPx}px "Noto Sans TC", sans-serif`;
    ctx.fillText("備註", marginX, y);
    y += noteLabelFontPx * 1.4;

    const noteFontPx = mmToPx(3.2);
    ctx.font = `${noteFontPx}px "Noto Sans TC", sans-serif`;
    const orderId = String(row["訂單編號"] ?? "").trim();
    const productNote = String(row["_備註"] ?? "").trim();
    // 黑貓紙上半只到印刷區為止,品項太多就截掉(訂單編號在第一行,一定印得到)
    const limit = fmt.gapTop ? mmToPx(fmt.gapTop - 2) : H;
    [
      `訂單編號:${orderId}`,
      `${productNote}`,
    ].forEach(line => {
      wrapCanvasText(ctx, line, contentW).forEach(l => {
        if (y + noteFontPx > limit) return;
        ctx.fillText(l, marginX, y);
        y += noteFontPx * 1.35;
      });
    });
  };

  if (fmt.gapTop) {
    // 黑貓紙:上半 寄件人 → 備註;中間印刷區留白;下半 收件人
    drawSender();
    y += mmToPx(3);
    drawLine();
    y += mmToPx(3);
    drawNote();
    y = mmToPx(fmt.gapBottom + 6);
    drawRecipient();
  } else {
    // 4x6:跟以前一樣 寄件人 → 分隔線 → 收件人 → 備註
    drawSender();
    y += mmToPx(6);
    drawLine();
    y += mmToPx(10);
    drawRecipient();
    y += mmToPx(6);
    drawNote();
  }

  return canvas;
}

async function generateOffshorePdf() {
  if (!loadedRows) return;
  const rows = loadedRows.filter(r => r["_離島"]);
  if (rows.length === 0) {
    setStatus("status", "warn", "目前沒有離島•郵局的訂單");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    setStatus("status", "error", "✗ PDF 產生元件載入失敗,請檢查網路連線後重新整理頁面");
    return;
  }

  const btn = document.getElementById("offshorePdfBtn");
  btn.disabled = true;
  setStatus("status", "loading", `產生離島貼紙 PDF 中(${rows.length} 筆)…`);

  try {
    await ensureFontsLoaded();

    const fmt = OFFSHORE_FORMATS[offshoreFormat];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [fmt.w, fmt.h],
    });

    rows.forEach((row, idx) => {
      if (idx > 0) doc.addPage([fmt.w, fmt.h], "portrait");
      const canvas = drawOffshoreLabel(row, fmt);
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      doc.addImage(imgData, "JPEG", 0, 0, fmt.w, fmt.h);
    });

    doc.save(`離島出貨貼紙_${offshoreFormat === "4x6" ? "4x6_" : ""}${todayStr()}.pdf`);
    setStatus("status", "success", `✓ 已產生離島貼紙 PDF(共 ${rows.length} 頁)`);
  } catch (e) {
    setStatus("status", "error", `✗ 產生 PDF 失敗:${e.message}`);
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}
