// ===================================================================
// 官網訂單(Shopline 後台匯出的「訂單報表」niyancement_orders_*.xls)
//
// 報表格式:一列一個商品,同一筆訂單有幾個商品就佔幾列;金額欄只寫在每筆的第一列。
// 這裡先用「訂單號碼」併回一筆一筆的訂單,再做兩件事:
//   1. 黑貓出貨表:送貨方式是「黑貓…」的訂單,寫成跟 LINE 一樣的黑貓上傳 xlsx;
//      貨到付款的把付款總金額填進「代收金額或到付」。
//   2. 出貨單 PDF:每筆一張,紙張/版面跟蝦皮出貨單同一種熱感應紙(95x193mm,
//      中間印刷區留白):上半 送貨方式 → 付款方式 → 訂單編號,下半 品項簡稱 → 訂單備註。
//
// 未付款的擋下來(兩樣都不出),但取貨付款/貨到付款本來就是收貨時才付,不算未付款。
// ===================================================================

// 官網寄件人名稱(黑貓單上的寄件人)。照 LINE 那邊 SENDER_NAME「LINE禮物-泥研製所」的寫法,
// 一看就知道是哪個平台的單
const WEB_SENDER_NAME = "官網-泥研製所";
// 出貨單最上面那行的平台註記(接在送貨方式前面)
const WEB_PLATFORM_TAG = "官網";

// 送貨方式/付款方式出現這些字 = 收貨時才付錢,未付款是正常的
const WEB_COD_RE = /取貨付款|貨到付款/;
// 這兩種會被擋:已取消的單、以及付款狀態不是「已付款」的非貨到付款單
const WEB_PAID = "已付款";

// 出貨單版面(pt,距離頁面上緣)。紙張、中間印刷區沿用蝦皮的 SHOPEE_PAGE / SHOPEE_GAP
const WEB_LABEL = {
  x: 22, right: 247,          // 左右邊界
  shipTop: 20, shipSize: 26,  // 送貨方式(最大)
  paySize: 18,                // 付款方式
  snLabelSize: 9, snSize: 14, // 訂單編號
  itemsTop: 226, itemsBottom: 500,
  itemSize: 18, itemMin: 7, lineRatio: 1.45,
  noteSize: 10, noteBottom: 535,
};

let webOrders = [];      // 併好的訂單(含被擋的,UI 要列出來)
let webFileName = "";

function webCol(row, prefix) {
  // 報表欄名有全形括號混半形「郵政編號（如適用)」,用開頭比對比較不怕官方改字
  const k = Object.keys(row).find(k => k.startsWith(prefix));
  return k ? String(row[k] ?? "").trim() : "";
}

function webPhone(s) {
  const d = String(s ?? "").replace(/[^\d]/g, "");
  // 被 Excel 當成數字吃掉開頭的 0(978777086)
  return /^9\d{8}$/.test(d) ? "0" + d : d;
}

function webNum(s) {
  return Number(String(s ?? "").replace(/[^0-9.\-]/g, "")) || 0;
}

// 括號、斜線統一成半形,印在熱感應紙上比較省寬度,也不會因字型缺字變 □
function webNorm(s) {
  return String(s ?? "")
    .replace(/（/g, "(").replace(/）/g, ")").replace(/／/g, "/").replace(/\s+/g, " ").trim();
}

function parseWebRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const sn = String(r["訂單號碼"] ?? "").trim();
    if (!sn) continue;
    let o = map.get(sn);
    if (!o) {
      o = {
        sn,
        id: sn.replace(/^#/, ""),
        status: webCol(r, "訂單狀態"),
        payMethod: webCol(r, "付款方式"),
        payStatus: webCol(r, "付款狀態"),
        ship: webCol(r, "送貨方式"),
        name: webCol(r, "收件人"),
        phone: webPhone(r["收件人電話號碼"]),
        address: [webCol(r, "郵政編號"), webCol(r, "城市"), webCol(r, "地區"),
                  webCol(r, "地址 2"), webCol(r, "地址 1")].join(""),
        store: webCol(r, "門市名稱"),
        note: webCol(r, "訂單備註"),
        total: 0,
        items: [],
      };
      map.set(sn, o);
    }
    // 金額只在第一列有,後面的列是空的 —— 取第一個有值的
    if (!o.total) o.total = webNum(r["付款總金額"]) || webNum(r["訂單合計"]);
    if (!o.note) o.note = webCol(r, "訂單備註");
    if (String(r["商品貨號"] ?? "").trim() || String(r["商品名稱"] ?? "").trim()) {
      o.items.push({ ...buildWebShortCode(r), sku: String(r["商品貨號"] ?? "").trim(),
                     name: String(r["商品名稱"] ?? "").trim(), option: String(r["選項"] ?? "").trim() });
    }
  }

  const orders = [...map.values()];
  orders.forEach(o => {
    o.isBcat = /黑貓/.test(o.ship);
    o.cod = WEB_COD_RE.test(o.ship) || WEB_COD_RE.test(o.payMethod);
    if (/取消/.test(o.status)) o.blocked = "訂單" + o.status;
    else if (!o.cod && o.payStatus !== WEB_PAID) o.blocked = o.payStatus || "付款狀態不明";
    else o.blocked = "";
    o.unknown = o.items.some(i => i.unknown);
  });
  orders.sort((a, b) => a.id.localeCompare(b.id));
  return orders;
}

async function onWebFile(file) {
  if (!file) return;
  setStatus("webStatus", "loading", "讀取中…");
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: "" });
    if (!rows.length) throw new Error("報表沒有資料");
    const need = ["訂單號碼", "送貨方式", "付款狀態", "商品貨號", "數量"];
    const missing = need.filter(c => !(c in rows[0]));
    if (missing.length) throw new Error("這不像官網訂單報表,缺少欄位:" + missing.join("、"));
    webOrders = parseWebRows(rows);
    webFileName = file.name;
    const d = document.getElementById("webFileDisplay");
    d.textContent = file.name + "(" + webOrders.length + " 筆訂單)";
    d.classList.remove("empty"); d.classList.add("has-file");
    preloadShopeeFont();
    renderWebPreview();
  } catch (e) {
    webOrders = [];
    renderWebPreview();
    setStatus("webStatus", "error", "✗ 讀取失敗:" + e.message);
  }
}

function renderWebPreview() {
  const box = document.getElementById("webPreview");
  const ok = webOrders.filter(o => !o.blocked);
  const bcat = ok.filter(o => o.isBcat);
  const blocked = webOrders.filter(o => o.blocked);
  const unknown = ok.filter(o => o.unknown);

  document.getElementById("webBcatBtn").disabled = !bcat.length;
  document.getElementById("webLabelBtn").disabled = !ok.length;
  if (!box) return;

  box.innerHTML = webOrders.map(o => {
    const cls = o.blocked ? "shopee-row miss" : (o.unknown ? "shopee-row unknown" : "shopee-row");
    const flag = o.blocked ? "⛔" : (o.unknown ? "⚠" : "");
    const pay = o.payMethod + (o.cod ? "" : "(" + o.payStatus + ")");
    const codes = o.blocked ? "擋下:" + o.blocked + ",不出黑貓單、不印出貨單"
                            : o.items.map(i => i.code).join("　");
    return "<div class=\"" + cls + "\">"
      + "<span class=\"shopee-flag\">" + flag + "</span>"
      + "<span class=\"shopee-sn\">" + escapeHtml(o.id) + "</span>"
      + "<span class=\"web-ship\">" + escapeHtml(o.ship) + "<br><small>" + escapeHtml(pay) + "</small></span>"
      + "<span class=\"shopee-code\">" + escapeHtml(codes) + "</span>"
      + "<span class=\"shopee-total\">$" + o.total + "</span>"
      + "</div>";
  }).join("");

  if (!webOrders.length) {
    setStatus("webStatus", "", "把官網訂單報表(niyancement_orders_….xls)丟進來…");
    return;
  }
  const bits = [webOrders.length + " 筆訂單", "黑貓 " + bcat.length + " 筆", "出貨單 " + ok.length + " 張"];
  if (blocked.length) bits.push("⛔ " + blocked.length + " 筆未付款/已取消已擋下");
  if (unknown.length) bits.push("⚠ " + unknown.length + " 筆有貨號認不出來(照品名印,請看一下)");
  setStatus("webStatus", (blocked.length || unknown.length) ? "warn" : "success", bits.join("、"));
}

function downloadWebBcat() {
  const rows = webOrders.filter(o => !o.blocked && o.isBcat).map(o => ({
    "訂單編號": o.id,
    "收件人姓名": o.name,
    "收件人聯絡電話": o.phone,
    "配送地址": o.address,
    "_備註": o.items.map(i => i.compact).join(" "),
    "_代收金額": o.cod ? o.total : "",
    "_類別": null,
  }));
  if (!rows.length) return;
  try {
    const { fileCount } = writeBcatFiles(rows, "官網黑貓出貨表", { senderName: WEB_SENDER_NAME });
    const cod = rows.filter(r => r["_代收金額"] !== "").length;
    setStatus("webStatus", "success",
      "✓ 已下載官網黑貓出貨表(" + rows.length + " 筆" + (fileCount > 1 ? "、分 " + fileCount + " 個檔" : "")
      + (cod ? "、其中 " + cod + " 筆貨到付款已填代收金額" : "") + ")");
  } catch (e) {
    setStatus("webStatus", "error", "✗ 匯出失敗:" + e.message);
  }
}

// 一行太寬就縮字,縮到 minSize 還放不下就照最小字印(寧可小也不要被切掉)
function webFitSize(font, text, maxW, size, minSize) {
  for (let s = size; s > minSize; s -= 0.5) {
    if (font.widthOfTextAtSize(text, s) <= maxW) return s;
  }
  return minSize;
}

// 備註可能很長,照寬度自動斷行
function webWrap(font, text, size, maxW) {
  const lines = [];
  let cur = "";
  for (const ch of text) {
    if (font.widthOfTextAtSize(cur + ch, size) > maxW && cur) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function generateWebLabels() {
  const btn = document.getElementById("webLabelBtn");
  const jobs = webOrders.filter(o => !o.blocked);
  if (!jobs.length) return;
  if (btn) { btn.disabled = true; btn.textContent = "產生中…"; }
  try {
    await ensureShopeeLibs();
    const out = await PDFLib.PDFDocument.create();
    out.registerFontkit(window.fontkit);
    const font = await out.embedFont(await ensureShopeeFont(), { subset: false });   // 原因見 shopee-label.js
    const L = WEB_LABEL;
    const W = L.right - L.x;
    const black = PDFLib.rgb(0, 0, 0);
    let overflow = 0;

    for (const o of jobs) {
      const page = out.addPage([SHOPEE_PAGE.w, SHOPEE_PAGE.h]);
      const fromTop = y => SHOPEE_PAGE.h - y;
      const put = (text, top, size) => {
        page.drawText(text, { x: L.x, y: fromTop(top + size), size, font, color: black });
      };

      // ---- 上半:送貨方式(最大)→ 付款方式 → 訂單編號 ----
      let y = L.shipTop;
      const ship = sanitizeCode(WEB_PLATFORM_TAG + " " + webNorm(o.ship));
      const shipSize = webFitSize(font, ship, W, L.shipSize, 12);
      put(ship, y, shipSize);
      y += shipSize + 10;

      const pay = sanitizeCode(webNorm(o.payMethod));
      const paySize = webFitSize(font, pay, W, L.paySize, 10);
      put(pay, y, paySize);
      y += paySize + 8;
      if (o.cod) {
        put(sanitizeCode("代收 $" + o.total), y, L.paySize);
        y += L.paySize + 8;
      }
      // 超商取貨印門市名稱,現場分袋比較好認
      if (o.store) {
        const st = sanitizeCode(webNorm(o.store));
        put(st, y, webFitSize(font, st, W, 12, 8));
        y += 12 + 8;
      }
      y += 4;
      put(sanitizeCode("訂單編號"), y, L.snLabelSize);
      y += L.snLabelSize + 4;
      put(sanitizeCode(o.id), y, L.snSize);
      // SHOPEE_GAP(中間印刷區)刻意留白

      // ---- 下半:品項簡稱 → 訂單備註 ----
      const note = o.note ? sanitizeCode("備註:" + webNorm(o.note)) : "";
      const noteLines = note ? webWrap(font, note, L.noteSize, W) : [];
      const noteH = noteLines.length * L.noteSize * 1.4;
      const itemsBottom = Math.min(L.itemsBottom, L.noteBottom - noteH - 8);
      const lines = o.items.map(i => sanitizeCode(i.compact));
      const avail = itemsBottom - L.itemsTop;
      let size = L.itemSize;
      while (size > L.itemMin && (lines.length * size * L.lineRatio > avail
             || lines.some(t => font.widthOfTextAtSize(t, size) > W))) size -= 0.25;
      const lh = size * L.lineRatio;
      if (lines.length * lh > avail) overflow++;
      lines.forEach((t, i) => {
        const top = L.itemsTop + lh * i;
        if (top + lh > itemsBottom + 0.5) return;
        put(t, top, size);
      });

      let ny = L.noteBottom - noteH;
      noteLines.forEach(t => { put(t, ny, L.noteSize); ny += L.noteSize * 1.4; });
    }

    const bytes = await out.save();
    const name = "官網出貨單_" + todayStr("") + ".pdf";
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
    const skipped = webOrders.length - jobs.length;
    setStatus("webStatus", overflow ? "warn" : "success",
      "✓ 已產生 " + name + "(" + jobs.length + " 張)"
      + (skipped ? "、⛔ " + skipped + " 筆未付款/已取消沒有印" : "")
      + (overflow ? "、⚠ " + overflow + " 張品項太多印不完,請檢查" : ""));
  } catch (e) {
    setStatus("webStatus", "error", "✗ 產生失敗:" + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🖨  產生出貨單 PDF"; }
  }
}
