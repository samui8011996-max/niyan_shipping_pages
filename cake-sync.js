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

// 廠商對照的複製文字:同一張訂單的品項併在同一個收件人底下,訂單之間空一行
function buildCakeVendorText(rows) {
  const byOrder = new Map();
  rows.filter(isCakeRow).forEach(r => {
    const id = String(r["訂單編號"] ?? "").trim();
    if (!byOrder.has(id)) byOrder.set(id, { r, items: [] });
    byOrder.get(id).items.push(`${cakeItemLabel(r)} x${cakeQty(r)}`);
  });
  return [...byOrder].map(([id, o]) => [
    `姓名:${o.r["收件人姓名"] ?? ""}`,
    `電話:${o.r["收件人聯絡電話"] ?? ""}`,
    `地址:${o.r["配送地址"] ?? ""}`,
    `訂單編號:${id}`,
    ...o.items,
  ].join("\n")).join("\n\n");
}

// 統計字卡 → 讀 D1 的清單(新的日期在上面),沿用注意品項那個小視窗
async function openCakeList() {
  document.getElementById("attnTitle").textContent = CAKE_CATEGORY;
  const hintEl = document.getElementById("attnHint");
  hintEl.textContent = "起士公爵出貨,按「上傳包貨平台與試算表」時存進來的。收件人資料在下面「廠商對照」複製。";
  hintEl.hidden = false;
  document.getElementById("attnCount").textContent = "";
  document.getElementById("attnLabelBtn").hidden = true;
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
    box.innerHTML = orders.length ? orders.map(o => `
      <div class="attn-row">
        <span class="attn-date">${escapeHtml(o.date)}</span>
        <span class="attn-sn">${escapeHtml(o.orderId)}</span>
        <span class="attn-note">${escapeHtml(o.item)} x${escapeHtml(o.qty)}</span>
      </div>`).join("") : `<div class="attn-empty">還沒有${CAKE_CATEGORY}訂單</div>`;
  } catch (e) {
    box.innerHTML = `<div class="attn-empty">讀取失敗:${escapeHtml(e.message)}</div>`;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { cakeItemLabel, buildCakeRows, buildCakeVendorText };
}
