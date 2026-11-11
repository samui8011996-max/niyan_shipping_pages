// ===================================================================
// 星座貓X蛋糕(起士公爵聯名,2026-10-30 上架)
// 廠商直接出貨(跟黑熊一樣不進我們的黑貓出貨表),但不寫試算表(使用者 2026-10-30):
//   1. 按「上傳包貨平台與試算表」時,訂單編號 + 品項 + 數量存進 D1 的 cake_orders(不存個資)
//   2. 點統計字卡「星座貓X蛋糕」→ 小視窗讀 D1 列出來
//   3. 廠商對照區多一張卡:姓名/電話/地址/訂單編號/品項 x數量,按複製貼給廠商
//      —— 這張卡的個資只從這次載入的訂單表拿,不經過伺服器
//
// 品項寫法:星座貓X蛋糕 規格:天蠍-敢愛敢恨
//   星座看規格(「敢愛敢恨|天蠍座(10/24-11/22)」「天蠍座開運胖胖貓」),規格沒有才看品名(「天蠍生日開運禮」)
//   蛋糕款式:閃耀無比 / 敢愛敢恨 / 情感滿溢 / 經典LOGO(經典LOGO 不分星座)
// ===================================================================
const CAKE_CATEGORY = "星座貓X蛋糕";
const CAKE_STYLES = ["閃耀無比", "敢愛敢恨", "情感滿溢", "經典LOGO"];
// 廠商(起士公爵)統計數量用的試算表,小視窗裡放一顆捷徑(使用者 2026-10-30)
const CAKE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1omoym5muBdAYd4gBmAvwt5vtUoOoaV_ZPXk7HdJvsjk/edit?gid=41937453#gid=41937453";

function openCakeSheet() { window.open(CAKE_SHEET_URL, "_blank"); }

function isCakeRow(r) {
  return (r["_類別列表"] || []).includes(CAKE_CATEGORY);
}

// 星座只取前兩個字(天蠍座 → 天蠍),品名「天蠍生日開運禮」也是兩個字,才對得到
function cakeZodiac(text) {
  const s = String(text ?? "");
  let best = "", bestPos = Infinity;
  ZODIAC_SIGNS.forEach(z => {
    const pos = s.indexOf(z.slice(0, 2));
    if (pos !== -1 && pos < bestPos) { bestPos = pos; best = z.slice(0, 2); }
  });
  return best;
}

function cakeStyle(spec) {
  const known = CAKE_STYLES.find(x => spec.toUpperCase().includes(x.toUpperCase()));
  if (known) return known;
  // 新款式:抓「XXXX|天蠍座」的 XXXX
  const m = spec.match(/([^\s:：,，|｜]+)\s*[|｜]\s*\S{2}座/);
  return m ? m[1] : "";
}

function cakeItemLabel(r) {
  const spec = [r["規格設定"] ?? "", r["客製刻印選項"] ?? ""].map(String).join(" ");
  const zodiac = cakeZodiac(spec) || cakeZodiac(r["商品名稱"]);
  const style = cakeStyle(spec);
  const detail = [zodiac, style].filter(Boolean).join("-");
  return CAKE_CATEGORY + (detail ? " 規格:" + detail : (spec.trim() ? " 規格:" + spec.trim() : ""));
}

const cakeQty = r => parseInt(r["數量"], 10) || 1;

function buildCakeRows(rows, date) {
  return rows.filter(isCakeRow).map(r => ({
    key: String(r["商品訂單編號"] || "").trim() || (String(r["訂單編號"] || "") + "|" + cakeItemLabel(r)),
    orderId: String(r["訂單編號"] || "").trim(),
    item: cakeItemLabel(r),
    qty: cakeQty(r),
    date,
  }));
}

// 回傳一行給狀態列用的摘要(失敗不擋後面的試算表/字卡上傳)
async function uploadCakeOrders(cakeRows) {
  if (!cakeRows.length) return "";
  try {
    const res = await fetch(getGsUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "addCakeOrders", rows: cakeRows }),
    });
    const data = await res.json();
    console.log("[星座貓X蛋糕上傳回應]", data);
    return data.ok ? `${CAKE_CATEGORY} ${data.count}` : `${CAKE_CATEGORY}上傳失敗(${data.error || "未知錯誤"})`;
  } catch (e) {
    return `${CAKE_CATEGORY}上傳失敗(${e.message})`;
  }
}

// 廠商對照的複製文字:同一張訂單的品項併在同一個收件人底下;訂單編號放第一行加 ■,
// 訂單之間用一條粗線隔開(貼到 LINE 給廠商也看得出哪裡換單,使用者 2026-10-30)
function buildCakeVendorText(rows) {
  const byOrder = new Map();
  rows.filter(isCakeRow).forEach(r => {
    const id = String(r["訂單編號"] ?? "").trim();
    if (!byOrder.has(id)) byOrder.set(id, { r, items: [] });
    byOrder.get(id).items.push(`${cakeItemLabel(r)} x${cakeQty(r)}`);
  });
  return [...byOrder].map(([id, o]) => [
    `■ 訂單編號:${id}`,
    `姓名:${o.r["收件人姓名"] ?? ""}`,
    `電話:${o.r["收件人聯絡電話"] ?? ""}`,
    `地址:${o.r["配送地址"] ?? ""}`,
    ...o.items,
  ].join("\n")).join("\n━━━━━━━━━━━━━━━━\n");
}

// ---- 起士公爵出貨試算表的貼上格式(使用者 2026-11-11)----
// 對方的試算表我們沒辦法直接寫,改成「一筆一列、欄位用 Tab 隔開」,在對方試算表點 A 欄第一個空白列 Ctrl+V 就會自動分到各欄。
// 欄位順序照對方表頭(41 欄),起士填寫的欄位(小精靈單號/宅配單號/到貨日)跟用不到的欄位都留空。
// 個資只從這次載入的訂單表拿,只放剪貼簿,不經伺服器、不存 D1。
const CAKE_SHEET_HEADERS = [
  "拋單日期", "小精靈單號(起士填寫)", "宅配單號(起士填寫)", "到貨日(起士填寫)", "總金額(單品免運)", "星座",
  "訂單編號", "商品訂單編號", "訂單狀態", "商品名稱", "規格設定", "客製刻印選項", "商品編號", "賣家商品代碼",
  "規格管理代碼", "品牌編號", "品牌名稱", "數量", "價格", "每個商品的折扣", "成本", "商品總金額",
  "訂單優惠券折抵金額", "合計運費", "訂單下單日期", "完成付款日", "地址填寫日", "訂單確認日期", "出貨日期",
  "寄送完成日期", "配送方式", "貨運業者", "物流單編號", "合併運送群組編號", "運費類型", "寄件人", "寄件人電話",
  "收件人姓名", "收件人聯絡電話", "配送地址", "備註",
];
const CAKE_UNIT_PRICE = 660;   // 單品免運價,對方表「總金額」欄 = 660 x 數量

// 欄位裡如果有 Tab / 換行會把格子拆歪,換成空白
const cakeCell = v => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();

function buildCakeSheetTsv(rows, now = new Date()) {
  const date = `${now.getMonth() + 1}/${now.getDate()}`;
  return rows.filter(isCakeRow).map(r => {
    const label = cakeItemLabel(r);
    const detail = label.replace(CAKE_CATEGORY, "").replace(/^\s*規格:/, "").trim();   // 天蠍-閃耀無比
    const qty = cakeQty(r);
    const v = {
      "拋單日期": date,
      "總金額(單品免運)": CAKE_UNIT_PRICE * qty,
      "星座": /經典LOGO/i.test(detail) ? "經典LOGO" : detail,
      "訂單編號": r["訂單編號"],
      "數量": qty,
      "寄件人": SENDER_NAME,
      "寄件人電話": OFFSHORE_SENDER.phone,
      "收件人姓名": r["收件人姓名"],
      "收件人聯絡電話": r["收件人聯絡電話"],
      "配送地址": r["配送地址"],
      "備註": `${detail || label} x${qty}`,
    };
    return CAKE_SHEET_HEADERS.map(h => cakeCell(v[h])).join("\t");
  }).join("\n");
}

// 統計字卡 → 讀 D1 的清單(新的日期在上面),沿用注意品項那個小視窗
async function openCakeList() {
  document.getElementById("attnTitle").textContent = CAKE_CATEGORY;
  const hintEl = document.getElementById("attnHint");
  hintEl.textContent = "起士公爵出貨,按「上傳包貨平台與試算表」時存進來的。收件人資料在下面「廠商對照」複製。";
  hintEl.hidden = false;
  document.getElementById("attnCount").textContent = "";
  document.getElementById("attnLabelBtn").hidden = true;
  document.getElementById("attnSheetBtn").hidden = false;
  const delBtn = document.getElementById("attnDeleteBtn");
  delBtn.hidden = false;
  delBtn.disabled = true;
  delBtn.textContent = "刪除勾選";
  const box = document.getElementById("attnBody");
  box.innerHTML = `<div class="attn-empty">讀取中…</div>`;
  document.getElementById("attnModal").classList.add("show");
  try {
    const res = await fetch(getGsUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "getCakeOrders" }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "未知錯誤");
    const orders = data.orders || [];
    document.getElementById("attnCount").textContent = orders.length ? `${orders.length} 筆` : "";
    box.innerHTML = orders.length
      ? `<div class="attn-checkall" onclick="cakeRowClick(event, this)"><input type="checkbox" id="cakeCheckAll" onchange="cakeCheckAll(this.checked)">全選</div>` +
        orders.map(o => `
      <div class="attn-row checkable" onclick="cakeRowClick(event, this)">
        <input type="checkbox" class="cake-check" value="${escapeHtml(o.key)}" onchange="cakeCheckChanged()">
        <span class="attn-date">${escapeHtml(o.date)}</span>
        <span class="attn-sn">${escapeHtml(o.orderId)}</span>
        <span class="attn-note">${escapeHtml(o.item)} x${escapeHtml(o.qty)}</span>
      </div>`).join("")
      : `<div class="attn-empty">還沒有${CAKE_CATEGORY}訂單</div>`;
  } catch (e) {
    box.innerHTML = `<div class="attn-empty">讀取失敗:${escapeHtml(e.message)}</div>`;
  }
}

// ---- 勾選刪除(使用者 2026-10-30)----
// 整列都能點(用 div 不用 label:.modal label 有全域樣式會把版面弄亂)
function cakeRowClick(ev, row) {
  if (ev.target.tagName === "INPUT") return;
  const box = row.querySelector("input");
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change"));
}

function cakeCheckedKeys() {
  return [...document.querySelectorAll("#attnBody .cake-check:checked")].map(x => x.value);
}

function cakeCheckChanged() {
  document.querySelectorAll("#attnBody .cake-check").forEach(x => x.closest(".attn-row").classList.toggle("checked", x.checked));
  const n = cakeCheckedKeys().length;
  const btn = document.getElementById("attnDeleteBtn");
  btn.disabled = n === 0;
  btn.textContent = n ? `刪除勾選(${n})` : "刪除勾選";
}

function cakeCheckAll(on) {
  document.querySelectorAll("#attnBody .cake-check").forEach(x => { x.checked = on; });
  cakeCheckChanged();
}

async function deleteCheckedCakes() {
  const keys = cakeCheckedKeys();
  if (!keys.length) return;
  if (!confirm(`確定刪除 ${keys.length} 筆${CAKE_CATEGORY}訂單?刪掉就救不回來。`)) return;
  const btn = document.getElementById("attnDeleteBtn");
  btn.disabled = true;
  btn.textContent = "刪除中…";
  try {
    const res = await fetch(getGsUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "deleteCakeOrders", keys }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "未知錯誤");
  } catch (e) {
    alert("刪除失敗:" + e.message);
  }
  openCakeList();   // 重新讀一次,畫面跟 D1 對齊
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { cakeItemLabel, buildCakeRows, buildCakeVendorText, buildCakeSheetTsv };
}
