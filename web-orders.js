// ===================================================================
// 官網訂單(Shopline 後台匯出的「訂單報表」niyancement_orders_*.xls)
//
// 報表格式:一列一個商品,同一筆訂單有幾個商品就佔幾列;金額欄只寫在每筆的第一列。
// 這裡先用「訂單號碼」併回一筆一筆的訂單,再產黑貓出貨表:
//   送貨方式是「黑貓…」的訂單,寫成跟 LINE 一樣的黑貓上傳 xlsx;
//   貨到付款的把付款總金額填進「代收金額或到付」。
// 官網的撿貨表/出貨單改用 Shopline 後台的按鈕印(2026-11-24),這裡不再產。
// 出貨單版面(buildOrderLabelsPdf)留著,Pinkoi 還在用。
//
// Shopline 送貨方式(2026-11-24):
//   黑貓宅急便(取貨付款) → 黑貓表,填代收金額
//   黑貓宅急便(純寄貨)   → 黑貓表,不代收
//   全家 / 7-11 取貨不付款 (C2C)、取貨付款 (C2C) → 不進黑貓表
//
// 未付款的擋下來(不進黑貓表),但取貨付款/貨到付款本來就是收貨時才付,不算未付款。
// ===================================================================

// 官網寄件人名稱(黑貓單上的寄件人)。照 LINE 那邊 SENDER_NAME「LINE禮物-泥研製所」的寫法,
// 一看就知道是哪個平台的單
const WEB_SENDER_NAME = "官網-泥研製所";

// 送貨方式/付款方式出現這些字 = 收貨時才付錢,未付款是正常的
const WEB_COD_RE = /取貨付款|貨到付款/;
// 這兩種會被擋:已取消的單、以及付款狀態不是「已付款」的非貨到付款單
const WEB_PAID = "已付款";

// 出貨單版面(pt,距離頁面上緣)。預設是黑貓熱感應紙(跟蝦皮同一種 95x193mm,中間有印刷區)
const WEB_LABEL = {
  pageW: 95 * 72 / 25.4, pageH: 193 * 72 / 25.4,
  x: 22, right: 247,          // 左右邊界
  top: 16,
  snLabelSize: 9, snSize: 20, // 訂單編號(最上面;太長會自動縮)
  shipSize: 26,               // 送貨方式(最大)
  paySize: 14,                // 付款方式(使用者 2026-10-15:縮小)
  storeSize: 12,              // 超商門市
  totalSize: 13,              // 訂單金額 / 代收金額(固定右下角,字不要太大)
  itemsTop: 226, itemsBottom: 500,
  itemSize: 18, itemMin: 7, lineRatio: 1.45,
  noteSize: 10,               // 訂單備註(在金額上面)
  bottom: 535,                // 最下面一行(金額)的底線
};

// 紙張格式。4x6 = 101.6x152.4mm 通用熱感應貼紙,沒有中間印刷區,
// 所以品項直接接在上面那段後面(itemsTop: null = 接著排),不用跳過印刷區
const WEB_FORMATS = {
  bcat: { ...WEB_LABEL },
  "4x6": { ...WEB_LABEL, pageW: 4 * 72, pageH: 6 * 72, x: 18, right: 270,
           itemsTop: null, itemsBottom: 400, bottom: 420 },
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
    // 已付款就不代收,免得重複收錢(Shopline 本身有鎖付款方式,這是多一層保險)
    o.cod = o.payStatus !== WEB_PAID && (WEB_COD_RE.test(o.ship) || WEB_COD_RE.test(o.payMethod));
    if (/取消/.test(o.status)) o.blocked = "訂單" + o.status;
    else if (!o.cod && o.payStatus !== WEB_PAID) o.blocked = o.payStatus || "付款狀態不明";
    else o.blocked = "";
    o.unknown = o.items.some(i => i.unknown);
  });
  orders.sort((a, b) => a.id.localeCompare(b.id));
  return orders;
}

// ===================================================================
// 官網出貨單 PDF(Shopline 後台訂單頁「出貨單」按鈕印的 niyancement_PackingSlip.pdf)(2026-11-27)
//
// 使用者改成直接用出貨單產黑貓表,不用再另外匯出訂單報表。
// PDF 有文字層:上面是「訂單編號: / 收件人: / 收件人電話號碼: / 送貨方式: / 地址:」,
// 下面是品項表(序號、商品貨號、商品、數量、價格、商品小計)。
// 商品貨號太長會折成兩行(FAT-YELLO / W-S-GOLD),所以品項用「序號那一欄的 y」切列,
// 同一列範圍內同一欄的字依上下順序接起來。
// 出貨單上沒有付款狀態:送貨方式寫「取貨付款/貨到付款」的才代收,其他當已付款。
// 一筆訂單印一頁;沒有訂單編號的頁當作上一筆的續頁。
// ===================================================================
async function parseWebPackingSlip(file) {
  await ensureShopeeLibs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const orders = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const H = page.getViewport({ scale: 1 }).height;
    const tc = await page.getTextContent();
    const items = tc.items.filter(t => t.str && t.str.trim())
      .map(t => ({ s: t.str.trim(), x: t.transform[4], y: H - t.transform[5] }));   // y:離上緣,往下變大

    // 同一條基線的字併成一行(表頭欄位用)
    const lines = [];
    [...items].sort((a, b) => a.y - b.y || a.x - b.x).forEach(t => {
      const L = lines.find(l => Math.abs(l.y - t.y) < 2.5);
      if (L) L.parts.push(t); else lines.push({ y: t.y, parts: [t] });
    });
    lines.forEach(l => { l.parts.sort((a, b) => a.x - b.x); l.text = l.parts.map(t => t.s).join(" "); });
    const field = (label) => {
      const l = lines.find(l => l.text.includes(label + ":") || l.text.includes(label + "："));
      if (!l) return null;
      return { y: l.y, v: l.text.slice(l.text.search(new RegExp(label + "[:：]")) + label.length + 1).trim() };
    };

    const head = lines.find(l => /序號/.test(l.text) && /商品貨號/.test(l.text));
    const snF = field("訂單編號");
    let o;
    if (snF) {
      const sn = snF.v.split(/\s+/)[0];
      const addrF = field("地址");
      let address = addrF ? addrF.v : "";
      // 地址太長會折行:地址下一行起、到下一個「xxx:」欄位或表頭之前,都接上去
      if (addrF) {
        for (const l of lines) {
          if (l.y <= addrF.y + 1) continue;
          if ((head && l.y >= head.y - 1) || /^[^\s]{2,8}[:：]/.test(l.text)) break;
          address += l.text;
        }
      }
      address = address.replace(/^台灣\s*/, "").replace(/\s+/g, "");
      const ship = field("送貨方式")?.v || "";
      const cod = WEB_COD_RE.test(ship);
      o = {
        sn, id: sn.replace(/^#/, ""), status: "",
        payMethod: cod ? (ship.match(WEB_COD_RE) || [""])[0] : "",
        payStatus: cod ? "" : WEB_PAID,
        ship, name: field("收件人")?.v || "", phone: webPhone(field("收件人電話號碼")?.v),
        address, store: field("取貨門市")?.v || "", note: "",
        deliveryTime: field("指定到貨時間")?.v || "",
        total: 0, items: [],
      };
      orders.push(o);
    } else {
      o = orders[orders.length - 1];
      if (!o) continue;
    }

    // 金額:「訂單合計:」同一行右邊那個 NT$
    const totalLine = lines.find(l => /訂單合計/.test(l.text));
    if (totalLine) o.total = webNum((totalLine.text.match(/NT\$\s*[\d,]+/g) || []).pop());

    if (!head) continue;
    const col = name => head.parts.find(t => t.s === name)?.x;
    const xSku = col("商品貨號"), xName = col("商品"), xQty = col("數量"), xPrice = col("價格");
    if (xSku == null || xName == null || xQty == null) continue;
    const endY = (lines.find(l => l.y > head.y && /^總計/.test(l.text)) || { y: H }).y;
    const body = items.filter(t => t.y > head.y + 2 && t.y < endY - 2);
    const seqs = body.filter(t => t.x < xSku - 2 && /^\d+$/.test(t.s)).sort((a, b) => a.y - b.y);
    seqs.forEach((q, i) => {
      const top = i ? (seqs[i - 1].y + q.y) / 2 : head.y + 2;
      const bot = i < seqs.length - 1 ? (q.y + seqs[i + 1].y) / 2 : endY - 2;
      const cell = (x0, x1) => body.filter(t => t.y > top && t.y <= bot && t.x >= x0 - 2 && t.x < x1 - 2)
        .sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.s);
      const sku = cell(xSku, xName).join("");
      const nameParts = cell(xName, xQty).filter(s => s !== "贈品");   // 贈品下面那個小標籤不要
      const full = nameParts.join("");
      const qty = webNum(cell(xQty, xPrice ?? xQty + 30)[0]) || 1;
      const [pname, ...opt] = full.split(/\s*\/\s*/);
      const row = { "商品貨號": sku, "商品名稱": pname || full, "選項": opt.join(" / "), "數量": qty };
      o.items.push({ ...buildWebShortCode(row), sku, name: row["商品名稱"], option: row["選項"] });
    });
  }
  orders.forEach(o => {
    o.isBcat = /黑貓/.test(o.ship);
    o.cod = WEB_COD_RE.test(o.ship);
    o.blocked = "";
    o.unknown = o.items.some(i => i.unknown);
  });
  orders.sort((a, b) => a.id.localeCompare(b.id));
  return orders;
}

async function onWebFile(file) {
  if (!file) return;
  setStatus("webStatus", "loading", "讀取中…");
  if (/\.pdf$/i.test(file.name)) {
    try {
      const orders = await parseWebPackingSlip(file);
      if (!orders.length) throw new Error("這不像官網出貨單(找不到「訂單編號:」)");
      webOrders = orders;
      clearOrderEdits("web");
      webFileName = file.name;
      const d = document.getElementById("webFileDisplay");
      d.textContent = file.name + "(" + webOrders.length + " 筆訂單)";
      d.classList.remove("empty"); d.classList.add("has-file");
      renderWebPreview();
    } catch (e) {
      webOrders = [];
      renderWebPreview();
      setStatus("webStatus", "error", "✗ 讀取失敗:" + e.message);
    }
    return;
  }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: "" });
    if (!rows.length) throw new Error("報表沒有資料");
    const need = ["訂單號碼", "送貨方式", "付款狀態", "商品貨號", "數量"];
    const missing = need.filter(c => !(c in rows[0]));
    if (missing.length) throw new Error("這不像官網訂單報表,缺少欄位:" + missing.join("、"));
    webOrders = parseWebRows(rows);
    clearOrderEdits("web");
    webFileName = file.name;
    const d = document.getElementById("webFileDisplay");
    d.textContent = file.name + "(" + webOrders.length + " 筆訂單)";
    d.classList.remove("empty"); d.classList.add("has-file");
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

  document.getElementById("webBcatBtn").disabled = !bcat.length;
  if (!box) return;

  box.innerHTML = webOrders.map(o => {
    const cls = o.blocked ? "shopee-row miss" : "shopee-row";
    const flag = o.blocked ? "⛔" : "";   // 預覽旗標保留 emoji(使用者 2026-10-15 指定)
    const pay = o.payMethod + (o.cod ? "" : "(" + o.payStatus + ")");
    const blockedText = o.blocked ? "擋下:" + o.blocked + ",不出黑貓單" : "";
    return "<div class=\"" + cls + "\">"
      + "<span class=\"shopee-flag\">" + flag + "</span>"
      + "<span class=\"shopee-sn\">" + escapeHtml(o.id) + "</span>"
      + "<span class=\"web-ship\">" + escapeHtml(o.ship) + "<br><small>" + escapeHtml(pay) + "</small></span>"
      + "<span class=\"web-recv\">" + (blockedText ? "<b>" + escapeHtml(blockedText) + "</b><br>" : "")
      + escapeHtml(o.name) + " " + escapeHtml(o.phone) + "<br><small>" + escapeHtml(o.address || o.store) + "</small></span>"
      + "<span class=\"shopee-total\">$" + o.total + "</span>"
      + "</div>";
  }).join("");

  if (!webOrders.length) {
    setStatus("webStatus", "", "把官網出貨單(niyancement_PackingSlip.pdf)丟進來…");
    return;
  }
  const bits = [webOrders.length + " 筆訂單", "黑貓 " + bcat.length + " 筆"];
  if (blocked.length) bits.push(blocked.length + " 筆未付款/已取消已擋下");
  setStatus("webStatus", blocked.length ? "warn" : "success", bits.join("、"));
}

function downloadWebBcat() {
  const rows = webOrders.filter(o => !o.blocked && o.isBcat).map(o => ({
    "訂單編號": o.id,
    "收件人姓名": o.name,
    "收件人聯絡電話": o.phone,
    "配送地址": o.address,
    "_備註": "",   // 官網黑貓單不寫品項(使用者 2026-11-27):品項看隨箱的「訂單明細」
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

// ===================================================================
// 熱感應出貨單(Pinkoi 用;官網 2026-11-24 起改用 Shopline 後台印)
//   orders: [{ id, ship, payMethod, cod, store, total, note, items:[{compact}],
//              hideAmount?, taxId?, taxTitle? }]
//   tag   : 送貨方式前面的平台名(Pinkoi)
//   fmt   : "bcat"(黑貓熱感應 95x193) / "4x6"
// hideAmount:有電子發票載具的單不印金額(Pinkoi);taxId:有統編就印在金額上面
// ===================================================================
async function buildOrderLabelsPdf(orders, tag, fmt) {
  await ensureShopeeLibs();
  const out = await PDFLib.PDFDocument.create();
  out.registerFontkit(window.fontkit);
  const font = await out.embedFont(await ensureShopeeFont(), { subset: false });   // 原因見 shopee-label.js
  const L = WEB_FORMATS[fmt] || WEB_FORMATS.bcat;
  const W = L.right - L.x;
  const black = PDFLib.rgb(0, 0, 0);
  let overflow = 0;

  for (const o of orders) {
    const page = out.addPage([L.pageW, L.pageH]);
    const fromTop = y => L.pageH - y;
    const put = (text, top, size) => {
      page.drawText(text, { x: L.x, y: fromTop(top + size), size, font, color: black });
    };

    // ---- 上半:訂單編號 → 送貨方式(最大)→ 付款方式 → 門市 ----
    // 黑貓紙:全部要擠在中間印刷區(SHOPEE_GAP.top=185)以上,最多的情況(超商取貨付款)約排到 172
    let y = L.top;
    put(sanitizeCode("訂單編號"), y, L.snLabelSize);
    y += L.snLabelSize + 3;
    const sn = sanitizeCode(o.id);
    const snSize = webFitSize(font, sn, W, L.snSize, 10);
    put(sn, y + (L.snSize - snSize), snSize);   // 縮小的話底部對齊
    y += L.snSize + 8;

    // 「黑貓-常溫」只寫「黑貓」(常溫是預設,寫了只是佔位置);貨到付款那種保留括號。
    // 超商的「(C2C)」也拿掉:「全家 取貨付款 (C2C)」→「全家 取貨付款」
    const ship = sanitizeCode(tag + " "
      + webNorm(o.ship).replace(/-常溫/, "").replace(/\s*\(C2C\)/i, ""));
    const shipSize = webFitSize(font, ship, W, L.shipSize, 12);
    put(ship, y, shipSize);
    y += shipSize + 8;

    // 付款:已經付過的(Apple Pay、信用卡、轉帳…)一律寫「已付款」,不用管是哪一種(使用者 2026-10-19 指定);
    // 只有取貨付款/貨到付款才寫實際方式(要收錢)。一樣拿掉「C2C」:「全家 C2C 取貨付款」→「全家 取貨付款」
    const pay = sanitizeCode(o.cod ? webNorm(o.payMethod).replace(/\s*C2C\s*/i, " ").trim() : "已付款");
    put(pay, y, webFitSize(font, pay, W, L.paySize, 10));
    y += L.paySize + 6;

    // 超商取貨印門市名稱,現場分袋比較好認
    if (o.store) {
      const st = sanitizeCode(webNorm(o.store));
      put(st, y, webFitSize(font, st, W, L.storeSize, 8));
      y += L.storeSize + 6;
    }

    // 黑貓紙:SHOPEE_GAP(中間印刷區)刻意留白,品項從印刷區下面開始;4x6 直接接著排
    const itemsTop = L.itemsTop ?? (y + 14);

    // ---- 下半:品項簡稱 →(往下)… 訂單備註 → 統編 → 金額(固定右下角) ----
    // 金額固定在右下角、字不要太大(使用者 2026-10-15 指定),備註寫在金額上面。
    // 貨到付款/取貨付款寫「代收金額」—— 要收的錢跟訂單金額是同一個數字,不重複印兩行
    let bottomTop = L.bottom;   // 往上堆:金額 → 統編 → 備註
    if (!o.hideAmount) {
      const amount = sanitizeCode((o.cod ? "代收金額 $" : "訂單金額 $") + o.total);
      page.drawText(amount, {
        x: L.right - font.widthOfTextAtSize(amount, L.totalSize),
        y: fromTop(L.bottom), size: L.totalSize, font, color: black,
      });
      bottomTop = L.bottom - L.totalSize - 8;
    }
    // 有統編:印在金額上面、靠右(開發票要用,一眼要看得到)
    if (o.taxId) {
      const tax = sanitizeCode("統編 " + o.taxId + (o.taxTitle ? " " + webNorm(o.taxTitle) : ""));
      const tSize = webFitSize(font, tax, W, L.totalSize, 9);
      page.drawText(tax, {
        x: L.right - font.widthOfTextAtSize(tax, tSize),
        y: fromTop(bottomTop), size: tSize, font, color: black,
      });
      bottomTop -= tSize + 8;
    }

    const note = o.note ? sanitizeCode("備註:" + webNorm(o.note)) : "";
    const noteLines = note ? webWrap(font, note, L.noteSize, W) : [];
    const noteH = noteLines.length * L.noteSize * 1.4;
    const noteTop = bottomTop - noteH;
    let ny = noteTop;
    noteLines.forEach(t => { put(t, ny, L.noteSize); ny += L.noteSize * 1.4; });

    const itemsBottom = Math.min(L.itemsBottom, noteTop - 8);
    const lines = o.items.map(i => sanitizeCode(i.compact));
    const avail = itemsBottom - itemsTop;
    let size = L.itemSize;
    while (size > L.itemMin && (lines.length * size * L.lineRatio > avail
           || lines.some(t => font.widthOfTextAtSize(t, size) > W))) size -= 0.25;
    const lh = size * L.lineRatio;
    if (lines.length * lh > avail) overflow++;
    lines.forEach((t, i) => {
      const top = itemsTop + lh * i;
      if (top + lh > itemsBottom + 0.5) return;
      put(t, top, size);
    });
  }

  return { bytes: await out.save(), overflow };
}
