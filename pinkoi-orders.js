// ===================================================================
// Pinkoi 訂單(後台匯出的訂單報表,例如 20261019-0901-cement-niyan.csv)
//
// 檔案其實是 UTF-16、用 Tab 分隔(副檔名寫 .csv),一列一個商品,同一筆訂單有幾個商品就幾列。
// 出貨單跟官網同一個版面(buildOrderLabelsPdf,在 web-orders.js),送貨方式前面掛「Pinkoi」。
//
// 發票規則(使用者 2026-10-19 指定):
//   - 有「電子發票載具」→ 不印金額
//   - 有「統編」→ 把統編(和發票抬頭)印在出貨單上
// 全額退款 / 訂單類型是取消的 → 擋下來不印。
// ===================================================================
const PINKOI_TAG = "Pinkoi";
const PINKOI_SENDER_NAME = "Pinkoi-泥研製所";   // 黑貓單上的寄件人,跟 LINE、官網分得開
const PINKOI_BCAT_RE = /黑貓|宅配|宅急便/;       // 這些送貨方式要產黑貓上傳表
let pinkoiOrders = [];
let pinkoiFormat = "bcat";

function setPinkoiFormat(fmt) {
  if (!WEB_FORMATS[fmt]) return;
  pinkoiFormat = fmt;
  setFormatPills("pinkoiFormatPills", fmt);
  try { localStorage.setItem("pinkoiFormat", fmt); } catch (e) {}
}

// UTF-16(有 BOM)或 UTF-8 都吃
function pinkoiDecode(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder("utf-16le").decode(b);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder("utf-16be").decode(b);
  return new TextDecoder("utf-8").decode(b).replace(/^﻿/, "");
}

// Tab 分隔、欄位可能用 "…" 包起來(裡面可能有逗號或換行)
function pinkoiParseTsv(text) {
  const delim = text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur.replace(/\r$/, "")); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(v => String(v).trim()))
             .map(r => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? "").trim()])));
}

// 「+886 0938 267 228」→「0938267228」(黑貓表要台灣格式)
function pinkoiPhone(s) {
  let d = String(s || "").replace(/[^\d]/g, "");
  if (d.startsWith("886")) d = d.slice(3);
  if (/^9\d{8}$/.test(d)) d = "0" + d;
  if (d.startsWith("00")) d = d.slice(1);
  return d;
}

// 「超商名稱：旺泰, 超商代碼：207399」→「旺泰門市(207399)」;宅配的地址就不印(那是黑貓單的事)
function pinkoiStore(addr) {
  const name = (addr.match(/超商名稱[:：]\s*([^,，]+)/) || [])[1];
  const code = (addr.match(/超商代碼[:：]\s*(\w+)/) || [])[1];
  if (!name) return "";
  return name.trim() + "門市" + (code ? "(" + code + ")" : "");
}

function pinkoiYes(v) { return /^(是|y|yes|true|1)$/i.test(String(v || "").trim()); }

function parsePinkoiRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const id = r["訂單編號"];
    if (!id) continue;
    let o = map.get(id);
    if (!o) {
      o = {
        id,
        status: r["訂單類型"] || "",
        ship: r["運送方式"] || "",
        payMethod: r["付款方式"] || "",
        name: r["收件人姓名"] || "",
        phone: pinkoiPhone(r["收件人電話"]),
        address: r["收件人地址"] || "",
        store: pinkoiStore(r["收件人地址"] || ""),
        note: r["購買人備註"] || "",
        total: 0,
        carrier: r["電子發票載具"] || "",
        taxId: r["統編"] || "",
        taxTitle: r["發票抬頭"] || "",
        refunded: pinkoiYes(r["全額退款"]) || pinkoiYes(r["已完成退款"]),
        items: [],
      };
      map.set(id, o);
    }
    if (!o.total) o.total = webNum(r["總金額"]);
    if (!o.carrier) o.carrier = r["電子發票載具"] || "";
    if (!o.taxId) o.taxId = r["統編"] || "";
    if (r["購買品項"]) {
      const qty = Number(r["數量"]) || 1;
      const code = buildShortCode({ "商品名稱": r["購買品項"], "規格設定": r["商品規格"] || "", "數量": qty });
      o.items.push({ ...code, name: r["購買品項"], option: r["商品規格"] || "" });
    }
  }
  const orders = [...map.values()];
  orders.forEach(o => {
    o.cod = WEB_COD_RE.test(o.ship) || WEB_COD_RE.test(o.payMethod);
    o.isBcat = PINKOI_BCAT_RE.test(o.ship);
    o.hideAmount = !!o.carrier;   // 有載具 → 不印金額
    o.blocked = o.refunded ? "已全額退款" : (/取消/.test(o.status) ? "訂單" + o.status : "");
    o.unknown = o.items.some(i => i.unknown);
  });
  return orders;
}

async function onPinkoiFile(file) {
  if (!file) return;
  setStatus("pinkoiStatus", "loading", "讀取中…");
  try {
    const rows = pinkoiParseTsv(pinkoiDecode(await file.arrayBuffer()));
    if (!rows.length) throw new Error("報表沒有資料");
    const need = ["訂單編號", "運送方式", "購買品項", "數量"];
    const missing = need.filter(c => !(c in rows[0]));
    if (missing.length) throw new Error("這不像 Pinkoi 訂單報表,缺少欄位:" + missing.join("、"));
    pinkoiOrders = parsePinkoiRows(rows);
    const d = document.getElementById("pinkoiFileDisplay");
    d.textContent = file.name + "(" + pinkoiOrders.length + " 筆訂單)";
    d.classList.remove("empty"); d.classList.add("has-file");
    preloadShopeeFont();
    renderPinkoiPreview();
  } catch (e) {
    pinkoiOrders = [];
    renderPinkoiPreview();
    setStatus("pinkoiStatus", "error", "✗ 讀取失敗:" + e.message);
  }
}

function renderPinkoiPreview() {
  const box = document.getElementById("pinkoiPreview");
  const ok = pinkoiOrders.filter(o => !o.blocked);
  document.getElementById("pinkoiLabelBtn").disabled = !ok.length;
  document.getElementById("pinkoiBcatBtn").disabled = !ok.some(o => o.isBcat);
  if (!box) return;
  box.innerHTML = pinkoiOrders.map(o => {
    const cls = o.blocked ? "shopee-row miss" : (o.unknown ? "shopee-row unknown" : "shopee-row");
    const flag = o.blocked ? "⛔" : (o.unknown ? "⚠" : "");
    const codes = o.blocked ? "擋下:" + o.blocked + ",不印出貨單" : o.items.map(i => i.code).join("　");
    const inv = [o.carrier ? "載具(不印金額)" : "", o.taxId ? "統編 " + o.taxId : ""].filter(Boolean).join("・");
    return "<div class=\"" + cls + "\">"
      + "<span class=\"shopee-flag\">" + flag + "</span>"
      + "<span class=\"shopee-sn\">" + escapeHtml(o.id) + "</span>"
      + "<span class=\"web-ship\">" + escapeHtml(o.ship) + "<br><small>" + escapeHtml(o.store || o.payMethod) + "</small></span>"
      + "<span class=\"shopee-code\">" + escapeHtml(codes)
      +   (inv ? "<br><small class=\"pk-inv\">" + escapeHtml(inv) + "</small>" : "") + "</span>"
      + "<span class=\"shopee-total" + (o.hideAmount ? " muted" : "") + "\">$" + o.total + "</span>"
      + "</div>";
  }).join("");

  if (!pinkoiOrders.length) {
    setStatus("pinkoiStatus", "", "把 Pinkoi 訂單報表丟進來…");
    return;
  }
  const blocked = pinkoiOrders.filter(o => o.blocked).length;
  const unknown = ok.filter(o => o.unknown).length;
  const carrier = ok.filter(o => o.carrier).length;
  const tax = ok.filter(o => o.taxId).length;
  const bits = [pinkoiOrders.length + " 筆訂單", "黑貓 " + ok.filter(o => o.isBcat).length + " 筆", "出貨單 " + ok.length + " 張"];
  if (carrier) bits.push(carrier + " 筆有載具(不印金額)");
  if (tax) bits.push(tax + " 筆有統編(會印上去)");
  if (blocked) bits.push(blocked + " 筆退款/取消已擋下");
  if (unknown) bits.push(unknown + " 筆有品項認不出來(請看一下)");
  setStatus("pinkoiStatus", (blocked || unknown) ? "warn" : "success", bits.join("、"));
}

// 宅配(黑貓)的訂單 → 黑貓上傳表,格式跟 LINE、官網同一個(writeBcatFiles)
function downloadPinkoiBcat() {
  const rows = pinkoiOrders.filter(o => !o.blocked && o.isBcat).map(o => ({
    "訂單編號": o.id,
    "收件人姓名": o.name,
    "收件人聯絡電話": o.phone,
    "配送地址": o.address,
    "_備註": o.items.map(i => i.compact).join("、"),
    "_代收金額": o.cod ? o.total : "",
    "_類別": null,
  }));
  if (!rows.length) return;
  try {
    const { fileCount } = writeBcatFiles(rows, "Pinkoi黑貓出貨表", { senderName: PINKOI_SENDER_NAME });
    const cod = rows.filter(r => r["_代收金額"] !== "").length;
    setStatus("pinkoiStatus", "success",
      "✓ 已下載 Pinkoi 黑貓出貨表(" + rows.length + " 筆" + (fileCount > 1 ? "、分 " + fileCount + " 個檔" : "")
      + (cod ? "、其中 " + cod + " 筆貨到付款已填代收金額" : "") + ")");
  } catch (e) {
    setStatus("pinkoiStatus", "error", "✗ 匯出失敗:" + e.message);
  }
}

async function generatePinkoiLabels() {
  const btn = document.getElementById("pinkoiLabelBtn");
  const jobs = pinkoiOrders.filter(o => !o.blocked);
  if (!jobs.length) return;
  if (btn) { btn.disabled = true; btn.textContent = "產生中…"; }
  try {
    const { bytes, overflow } = await buildOrderLabelsPdf(jobs, PINKOI_TAG, pinkoiFormat);
    const name = "Pinkoi出貨單_" + (pinkoiFormat === "4x6" ? "4x6_" : "") + todayStr("") + ".pdf";
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
    const skipped = pinkoiOrders.length - jobs.length;
    setStatus("pinkoiStatus", overflow ? "warn" : "success",
      "✓ 已產生 " + name + "(" + jobs.length + " 張)"
      + (skipped ? "、" + skipped + " 筆退款/取消沒有印" : "")
      + (overflow ? "、" + overflow + " 張品項太多印不完,請檢查" : ""));
  } catch (e) {
    setStatus("pinkoiStatus", "error", "✗ 產生失敗:" + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "產生出貨單 PDF"; }
  }
}
