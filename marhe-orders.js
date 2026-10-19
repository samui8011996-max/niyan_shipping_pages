// ===================================================================
// 瑪黑家居訂單(後台「下載訂單」匯出的報表,例如 2026-10-19-13-18-11(下載訂單).xlsx)
//
// 報表格式跟官網(Shopline)很像:一列一個商品,同一筆訂單有幾個商品就佔幾列,
// 收件人/地址每一列都重複寫(不像官網只寫在第一列)。這裡用「訂單編號」併回
// 一筆一筆的訂單,寫成黑貓上傳表(writeBcatFiles,在 shipping-core.js)。
//
// 這份報表目前沒有「配送方式」欄位 —— 使用者 2026-10-19 說明,目前拿到的這份
// 報表本來就只會是黑貓的單(瑪黑家居這份報表類型只匯出宅配訂單),所以沒有像
// 官網那樣過濾「是不是黑貓」,全部都當黑貓單處理。如果之後瑪黑家居也会匯出
// 非黑貓的訂單,要先問清楚報表裡哪個欄位能分辨,再加判斷,不要用猜的。
//
// 也沒有「付款狀態」欄位(「出貨狀態」是倉儲流程,不是付款),所以沒有 web 那邊
// 「未付款就擋下來」的邏輯 —— 這份報表看起來本來就是「已經確認要出貨」的訂單才會被匯出。
// ===================================================================

const MARHE_SENDER_NAME = "瑪黑家居-泥研製所";   // 黑貓單上的寄件人,跟 LINE、官網分得開

let marheOrders = [];
let marheFileName = "";

function marhePhone(s) {
  const d = String(s ?? "").replace(/[^\d]/g, "");
  // 被 Excel 當成數字吃掉開頭的 0
  return /^9\d{8}$/.test(d) ? "0" + d : d;
}

function marheNum(s) {
  return Number(String(s ?? "").replace(/[^0-9.\-]/g, "")) || 0;
}

function parseMarheRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const sn = String(r["訂單編號"] ?? "").trim();
    if (!sn) continue;
    let o = map.get(sn);
    if (!o) {
      o = {
        sn,
        id: sn,
        name: String(r["收件人姓名"] ?? "").trim(),
        phone: marhePhone(r["收件人電話"]),
        address: String(r["收件人地址"] ?? "").trim(),
        note: String(r["訂單備註"] ?? "").trim(),
        total: 0,
        items: [],
        blocked: "",
      };
      map.set(sn, o);
    }
    if (!o.name) o.name = String(r["收件人姓名"] ?? "").trim();
    if (!o.phone) o.phone = marhePhone(r["收件人電話"]);
    if (!o.address) o.address = String(r["收件人地址"] ?? "").trim();
    if (!o.note) o.note = String(r["訂單備註"] ?? "").trim();
    o.total += marheNum(r["小計"]) || marheNum(r["總金額"]);
    if (String(r["產品名稱"] ?? "").trim()) {
      // 保留原始貨號+數量,除了印在黑貓單上的簡稱,物流回填表也要用(一個商品一列)
      const sku = String(r["瑪黑家居新版商品編號"] ?? r["供應商商品編號"] ?? "").trim();
      const qty = Number(r["數量"] ?? 1) || 1;
      o.items.push({ ...buildMarheShortCode(r), sku, rawQty: qty });
    }
  }

  const orders = [...map.values()];
  orders.forEach(o => {
    if (!o.address) o.blocked = "沒有收件地址";
    o.unknown = o.items.some(i => i.unknown);
  });
  orders.sort((a, b) => a.id.localeCompare(b.id));
  return orders;
}

async function onMarheFile(file) {
  if (!file) return;
  setStatus("marheStatus", "loading", "讀取中…");
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: "" });
    if (!rows.length) throw new Error("報表沒有資料");
    const need = ["訂單編號", "產品名稱", "數量", "收件人姓名", "收件人地址"];
    const missing = need.filter(c => !(c in rows[0]));
    if (missing.length) throw new Error("這不像瑪黑家居訂單報表,缺少欄位:" + missing.join("、"));
    marheOrders = parseMarheRows(rows);
    clearOrderEdits("marhe");
    marheFileName = file.name;
    const d = document.getElementById("marheFileDisplay");
    d.textContent = file.name + "(" + marheOrders.length + " 筆訂單)";
    d.classList.remove("empty"); d.classList.add("has-file");
    preloadShopeeFont();
    renderMarhePreview();
  } catch (e) {
    marheOrders = [];
    renderMarhePreview();
    setStatus("marheStatus", "error", "✗ 讀取失敗:" + e.message);
  }
}

function renderMarhePreview() {
  const box = document.getElementById("marhePreview");
  const ok = marheOrders.filter(o => !o.blocked);
  const blocked = marheOrders.filter(o => o.blocked);
  const unknown = ok.filter(o => o.unknown);

  const btn = document.getElementById("marheBcatBtn");
  if (btn) btn.disabled = !ok.length;
  if (!box) return;

  box.innerHTML = marheOrders.map(o => {
    const cls = o.blocked ? "shopee-row miss" : (o.unknown ? "shopee-row unknown" : "shopee-row");
    const flag = o.blocked ? "⛔" : (o.unknown ? "⚠" : "");
    const blockedText = o.blocked ? "擋下:" + o.blocked + ",不出黑貓單" : "";
    return "<div class=\"" + cls + "\">"
      + "<span class=\"shopee-flag\">" + flag + "</span>"
      + "<span class=\"shopee-sn\">" + escapeHtml(o.id) + "</span>"
      + "<span class=\"web-ship\">" + escapeHtml(o.name) + "<br><small>" + escapeHtml(o.phone) + "</small></span>"
      + orderEditCell("marhe", o, blockedText)
      + "<span class=\"shopee-total\">$" + o.total + "</span>"
      + "</div>";
  }).join("");

  renderMarheTrackStatus();   // 訂單筆數變了,物流回填那邊的配對數字、按鈕狀態也要跟著更新

  if (!marheOrders.length) {
    setStatus("marheStatus", "", "把瑪黑家居的「下載訂單」報表丟進來…");
    return;
  }
  const bits = [marheOrders.length + " 筆訂單", "黑貓 " + ok.length + " 筆"];
  if (blocked.length) bits.push(blocked.length + " 筆缺收件地址已擋下");
  if (unknown.length) bits.push(unknown.length + " 筆有品項認不出來(照品名印,請看一下)");
  setStatus("marheStatus", (blocked.length || unknown.length) ? "warn" : "success", bits.join("、"));
}

function downloadMarheBcat() {
  const rows = withOrderEdits("marhe", marheOrders.filter(o => !o.blocked)).map(o => ({
    "訂單編號": o.id,
    "收件人姓名": o.name,
    "收件人聯絡電話": o.phone,
    "配送地址": o.address,
    "_備註": orderLines("marhe", o).join("、") + (o.note ? "・" + o.note : ""),
    "_代收金額": "",   // 這份報表沒看到貨到付款的資訊,先留空;真的遇到再補
    "_類別": null,
  }));
  if (!rows.length) return;
  try {
    const { fileCount } = writeBcatFiles(rows, "瑪黑家居黑貓出貨表", { senderName: MARHE_SENDER_NAME });
    setStatus("marheStatus", "success",
      "✓ 已下載瑪黑家居黑貓出貨表(" + rows.length + " 筆" + (fileCount > 1 ? "、分 " + fileCount + " 個檔" : "") + ")");
  } catch (e) {
    setStatus("marheStatus", "error", "✗ 匯出失敗:" + e.message);
  }
}

// ===================================================================
// 物流單號回填:瑪黑家居要求的「批次填入物流單號」格式(範本「2026-10-19-13-24-38
// (批次填入物流單號範例).xlsx」)欄位是 訂單編號/瑪黑SKU/數量/物流廠商/物流單號/物流追蹤網址,
// 一個商品一列(同一張單有幾個商品就幾列,訂單編號重複,方便瑪黑那邊自己對)。
//
// 做法跟既有的「LINE 物流單號回填」(logistics-match.js)同一套:
// 讀黑貓自己匯出的出貨明細(訂單編號 + 託運單號),用訂單編號對應這份瑪黑的訂單,
// 一張單裡的每個商品都填同一個託運單號(黑貓一張單只會有一個包裹、一個號碼)。
// 對不到的訂單(還沒出貨/黑貓明細還沒匯出)留空,排在最後面並標紅,不會悄悄漏掉。
// ===================================================================

const MARHE_BCAT_TRACK_URL = "https://www.t-cat.com.tw/inquire/trace.aspx";   // 黑貓官網查詢頁,固定網址
const MARHE_TRACK_HEADERS = ["訂單編號", "瑪黑SKU", "數量", "物流廠商", "物流單號", "物流追蹤網址"];

let marheBcDetailData = null;   // Map(訂單編號 → 託運單號),跟 logistics-match.js 的 bcDetailData 是各自獨立的一份

async function onMarheBcDetail(file) {
  if (!file) return;
  setStatus("marheTrackStatus", "loading", "讀取黑貓出貨明細中…");
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // 表頭不一定在第一列(黑貓匯出的明細上面常有說明列),跟 logistics-match.js 同一招:
    // 掃前幾列找「訂單編號」+「託運單號」同時出現的那一列當表頭
    let headerRow = -1;
    for (let i = 0; i < Math.min(10, aoa.length); i++) {
      const row = aoa[i].map(v => String(v ?? ""));
      if (row.some(v => v.includes("訂單編號")) && row.some(v => v.includes("託運單號"))) {
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) throw new Error("找不到「訂單編號」+「託運單號」的表頭列");

    const headers = aoa[headerRow].map(v => String(v ?? "").trim());
    const orderIdCol = headers.findIndex(h => h.includes("訂單編號"));
    const trackingCol = headers.findIndex(h => h.includes("託運單號"));

    const map = new Map();
    for (let i = headerRow + 1; i < aoa.length; i++) {
      const oid = String(aoa[i][orderIdCol] ?? "").trim();
      const track = String(aoa[i][trackingCol] ?? "").trim();
      if (oid && track) map.set(oid, track);
    }
    marheBcDetailData = map;
    const d = document.getElementById("marheBcDetailDisplay");
    if (d) { d.textContent = file.name + "(" + map.size + " 筆託運單號)"; d.classList.remove("empty"); d.classList.add("has-file"); }
    renderMarheTrackStatus();
  } catch (e) {
    marheBcDetailData = null;
    setStatus("marheTrackStatus", "error", "✗ 黑貓明細讀取失敗:" + e.message);
  }
}

function renderMarheTrackStatus() {
  const btn = document.getElementById("marheTrackBtn");
  if (!marheOrders.length) {
    setStatus("marheTrackStatus", "", "先在上面載入瑪黑訂單,再把黑貓出貨明細丟進來…");
    if (btn) btn.disabled = true;
    return;
  }
  if (!marheBcDetailData) {
    setStatus("marheTrackStatus", "", "把黑貓出貨明細(含「訂單編號」+「託運單號」)丟進來…");
    if (btn) btn.disabled = true;
    return;
  }
  const ok = marheOrders.filter(o => !o.blocked);
  const matched = ok.filter(o => marheBcDetailData.has(o.id)).length;
  const unmatched = ok.length - matched;
  if (btn) btn.disabled = !ok.length;
  const bits = [`配對成功 ${matched} 筆訂單`];
  if (unmatched) bits.push(`${unmatched} 筆還沒出貨/對不到`);
  setStatus("marheTrackStatus", unmatched ? "warn" : "success", bits.join("、"));
}

function downloadMarheTracking() {
  if (!marheBcDetailData) return;
  const ok = withOrderEdits("marhe", marheOrders.filter(o => !o.blocked));
  // 品項被手改過的話,withOrderEdits 回傳的 items 只剩 {code,compact},沒有 sku/rawQty 了,
  // 回填表要的是原始商品資料,不是手改過的列印文字,所以這裡一律用原始的 marheOrders 找 items
  const byId = new Map(marheOrders.map(o => [o.id, o]));

  const matchedRows = [];
  const unmatchedRows = [];
  ok.forEach(o => {
    const orig = byId.get(o.id);
    const track = marheBcDetailData.get(o.id);
    (orig.items.length ? orig.items : [{ sku: "", rawQty: "" }]).forEach(it => {
      const row = [o.id, it.sku || "", it.rawQty || "", track ? "黑貓" : "", track || "", track ? MARHE_BCAT_TRACK_URL : ""];
      (track ? matchedRows : unmatchedRows).push(row);
    });
  });

  if (!matchedRows.length && !unmatchedRows.length) return;

  const aoa = [MARHE_TRACK_HEADERS, ...matchedRows, ...unmatchedRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const redFill = { patternType: "solid", fgColor: { rgb: "FFCDD2" } };
  const redFont = { color: { rgb: "B71C1C" }, bold: true };
  for (let i = 0; i < unmatchedRows.length; i++) {
    const excelRow = matchedRows.length + 1 + i;
    for (let c = 0; c < MARHE_TRACK_HEADERS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: excelRow, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      ws[addr].s = { fill: redFill, font: redFont };
    }
  }
  ws["!cols"] = MARHE_TRACK_HEADERS.map(h => h === "物流追蹤網址" ? { wch: 42 } : { wch: 14 });
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "物流單號");
  const filename = "瑪黑物流回填_" + todayStr() + ".xlsx";
  XLSX.writeFile(wb, filename, { cellStyles: true, bookType: "xlsx" });

  let msg = "✓ 已下載:" + filename + "(填入 " + matchedRows.length + " 列)";
  if (unmatchedRows.length) msg += "、另有 " + unmatchedRows.length + " 列未對應(已紅色反白排在最下面)";
  setStatus("marheTrackStatus", unmatchedRows.length ? "warn" : "success", msg);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseMarheRows };
}
