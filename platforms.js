// ===================================================================
// 平台分頁(2026-10-16 改版:給新人用,一打開就能照平台找到「後台連結 + 印單功能 + 要不要印發票」)
//
// 每個平台一個分頁;分頁最上面那條「平台資訊列」由這裡的設定畫出來,
// 要改網址、改發票規則、加平台,都只動 PLATFORMS 這張表。
//   panel   : 下面要顯示哪個功能區塊(tab-xxx);沒有自動印單的平台共用 tab-none
//   subs    : 有好幾個功能的平台(LINE禮物)用膠囊鈕切換子功能
//   invoice : 要不要印發票(蝦皮、Pinkoi、官網要印,其他不印)
//   note    : 資訊列上的補充說明(選填)
//   gmail   : 新訂單會寄信通知,資訊列多一條「新訂單請檢查 Gmail」
// ===================================================================

const INVOICE_URL = "https://web2.einvoice.com.tw/einv/Login/index.action";
const GMAIL_URL = "https://mail.google.com/";
const PACKING_URL = "https://niyan-packing-pages.pages.dev/";

const PLATFORMS = [
  { id: "line", name: "LINE禮物", url: "https://sellercenter.line.biz/giftshop/home", invoice: false,
    subs: [
      { id: "shipping",  name: "出貨單產生" },
      { id: "logistics", name: "物流單號回填" },
      { id: "zoned",     name: "分區列印", beta: true },
    ] },
  { id: "shopee", name: "蝦皮", url: "https://seller.shopee.tw/", invoice: true, panel: "shopee" },
  { id: "pinkoi", name: "Pinkoi", url: "https://www.pinkoi.com/panel/home", invoice: true },   // 自動印單還沒做
  // 官網目前還是舊官網(meepshop);印單功能是給之後的 Shopline 用的,頁面上有「開發中」告示
  { id: "web", name: "官網後台", url: "https://admin.meepshop.tw/login", invoice: true, panel: "web", gmail: true },
  { id: "marais", name: "瑪黑", url: "https://www.storemarais.com/marais-provider/login", invoice: false, gmail: true },   // 自動印單還沒做
  { id: "momo", name: "MO+", url: "https://3p.momo.com.tw/", invoice: false, gmail: true },
  { id: "books", name: "博客來", url: "https://ec-supplier.books.com.tw/", invoice: false, gmail: true },
  // 使用者給的是 Coupang 登入頁的完整網址,但裡面的 state 是一次性的登入參數,放久了會失效;
  // 改連登入後要去的那一頁(出貨管理),沒登入時 Coupang 會自己導去登入頁
  { id: "coupang", name: "酷澎", url: "https://wing.coupang.com/tenants/sfl-portal/delivery/management", invoice: false },
];

// 不屬於任何平台的共用工具分頁(沒有平台資訊列)
const TOOL_TABS = ["problems", "returns"];

const LINE_SUB_IDS = PLATFORMS.find(p => p.id === "line").subs.map(s => s.id);
let lineSub = "shipping";   // LINE禮物 上次看的子功能,切回來時接著看

function switchTab(name) {
  // 舊的呼叫方式(直接給子功能 id,例如 sheet-sync.js 的 switchTab("problems"))照樣能用
  let top = name, panel = name;
  if (LINE_SUB_IDS.includes(name)) { top = "line"; lineSub = name; panel = name; }
  else if (name === "line") panel = lineSub;
  else {
    const p = PLATFORMS.find(x => x.id === name);
    if (p) panel = p.panel || "none";
    else if (!TOOL_TABS.includes(name)) return false;
  }

  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === top);
  });
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.classList.toggle("active", p.id === `tab-${panel}`);
  });
  renderPlatformBar(top);
  try { localStorage.setItem("lastTab", top === "line" ? lineSub : top); } catch (e) {}

  maybeLoadProblemsOnTabSwitch(panel);
  maybeLoadReturnsOnTabSwitch(panel);
  return true;
}

function renderPlatformBar(top) {
  const bar = document.getElementById("platformBar");
  if (!bar) return;
  const p = PLATFORMS.find(x => x.id === top);
  if (!p) { bar.hidden = true; bar.innerHTML = ""; return; }
  bar.hidden = false;
  const btn = document.querySelector(`.tab.plat[data-tab="${top}"]`);
  bar.style.setProperty("--c", btn ? getComputedStyle(btn).getPropertyValue("--c").trim() : "");

  const invoice = p.invoice
    ? `<div class="pb-invoice yes">
         <strong>這個平台要印發票</strong>
         <span>出貨單印完後,記得到電子發票平台開發票。</span>
         <a class="pb-invoice-link" href="${INVOICE_URL}" target="_blank" rel="noopener noreferrer">開啟電子發票平台 ↗</a>
       </div>`
    : `<div class="pb-invoice no"><strong>這個平台不用印發票</strong></div>`;

  const subs = p.subs
    ? `<div class="fmt-pills pb-subs" role="tablist" aria-label="${escapeHtml(p.name)} 功能">
         ${p.subs.map(s => `<button type="button" class="fmt-pill${s.id === lineSub ? " active" : ""}"
             role="tab" aria-selected="${s.id === lineSub}" onclick="switchTab('${s.id}')">${escapeHtml(s.name)}${
             s.beta ? '<span class="pb-beta">BETA</span>' : ""}</button>`).join("")}
       </div>`
    : "";

  bar.innerHTML = `
    <div class="pb-head">
      <h2 class="pb-name">${escapeHtml(p.name)}</h2>
      <a class="btn btn-primary pb-open" href="${p.url}" target="_blank" rel="noopener noreferrer">開啟 ${escapeHtml(p.name.endsWith("後台") ? p.name : p.name + " 後台")} ↗</a>
    </div>
    ${invoice}
    ${p.gmail ? `<div class="pb-gmail">
        <strong>新訂單請檢查 Gmail</strong>
        <span>這個平台有新訂單會寄信通知。</span>
        <a class="pb-gmail-link" href="${GMAIL_URL}" target="_blank" rel="noopener noreferrer">開啟 Gmail ↗</a>
      </div>` : ""}
    ${p.note ? `<p class="pb-note">${escapeHtml(p.note)}</p>` : ""}
    ${subs}`;

  // 沒有自動印單的平台共用一個區塊,文字跟著平台換
  const none = document.getElementById("noneText");
  if (none && (p.panel || "none") === "none" && !p.subs) {
    none.textContent = `${p.name} 目前沒有自動印單,請按上面「開啟 ${p.name} 後台」直接在平台上印單。`;
  }
}
