// ===================================================================
// 蝦皮出貨工具:產生「上面出貨明細 + 下面託運標籤」的 95x193mm 出貨單。
//
// 流程:
//   1. 選「裝箱單」(可多選:店到家宅配 / 黑貓宅急便 / …每種寄送方式一份)
//   2. 選「熱感應單 PDF」(可多選,一張訂單一頁)
//   3. 兩邊用訂單編號對起來,shopee-shortcode.js 產生品項代號
//   4. pdf-lib 產生一份合併的 PDF:每筆訂單一頁,上半明細+總金額,中間留白,下半標籤
//
// 蝦皮是「每種寄送方式各出一份熱感應單 + 一份裝箱單」,所以這裡一次收全部再合成一個檔,
// 不用一種一種跑。**黑貓宅急便沒有熱感應條碼**(標籤是黑貓系統自己印的),
// 那些訂單下半部改印大字的物流單號 + 訂單編號,其餘版面一樣。
//
// 為什麼是「貼原標籤」而不是「在原標籤上蓋字」:紙張變成 95x193mm(上面多一截明細),
// 原本 105x148mm 的標籤要縮放後放到下半部。標籤是整塊向量內容原封不動搬過去的,
// 不是重畫也不是轉圖 —— 轉圖會讓條碼在熱感應機上糊掉,掃不出來。
// ===================================================================

const SHOPEE_PDFJS_SRC    = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const SHOPEE_PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const SHOPEE_PDFLIB_SRC   = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
const SHOPEE_FONTKIT_SRC  = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";

// 代號用的中文字型:離線切好的子集(見 build-shopee-font.py),以 base64 內嵌在
// shopee-code-font.js 裡。用內嵌而不是 fetch("shopee-code-font.ttf") 的原因是 ——
// 同事常常直接用檔案總管點開 index.html,那是 file:// ,瀏覽器會擋掉抓同目錄檔案的
// 請求,整個功能就只回一句「Failed to fetch」。內嵌版本地、線上都能跑,也少一次請求。
// 完整 Noto Sans TC 是 9MB,這份切完 33KB(base64 後 45KB)。

const MM = 72 / 25.4;

// ---- 版面 ----------------------------------------------------------
// 全部照使用者給的「蝦皮熱感應輸出範例.pdf」量出來。座標一律用「距離頁面上緣」,
// 跟量測工具一致,畫的時候才用 fromTop() 換成 pdf-lib 的左下角原點。
const SHOPEE_PAGE = { w: 95 * MM, h: 193 * MM };          // 269.3 x 547.1 pt

// 出貨明細:左右邊界各 26.1pt,兩欄時欄寬 93.2pt、中間空 30.7pt
const SHOPEE_ITEMS = {
  x1: 26.1, x2: 150.0, colW: 93.2,
  fullW: 243.2 - 26.1,           // 排成一欄時可以用滿整個寬度
  top: 24, maxBottom: 140,   // 最上面留一行給訂單編號(2026-10-19)
  size: 12, lineRatio: 19.6 / 12, minSize: 5,
};

// 金額列(只印數字,不印「總金額」三個字)。labelX 留著是因為「不印發票」那四個字
// 比數字長,靠右排版一樣是用 valueRight 對齊,不需要左邊的起點
const SHOPEE_TOTAL = {
  top: 150, valueRight: 243.6, valueSize: 14.2,
};

// 金額那一行左邊印的平台註記
const SHOPEE_PLATFORM_TAG = "蝦皮";

// 中間的印刷區/分割線:紙上本來就有東西,這一段什麼都不能印。
// 留這個常數只是為了讓人一眼看到「這段是故意空的」,程式不會往這裡畫。
const SHOPEE_GAP = { top: 185, bottom: 212 };

// 原標籤貼上來的位置。maxH 是標籤最多能佔的高度(黑貓紙下半部夠高,不限);
// x 為 null 時置中(4x6 用)
const SHOPEE_LABEL_BOX = { x: 35.2, w: 199.7, top: 229.9, maxH: Infinity };

// 沒有熱感應標籤時(黑貓宅急便),下半部改印這幾行。
// 「蝦皮黑貓」跟物流單號一樣大 —— 這張紙上沒有任何條碼,得一眼認出是哪家物流的單。
const SHOPEE_NOLABEL = {
  top: 250,
  title: "蝦皮黑貓",
  labelSize: 11,        // 「物流單號」「訂單編號」這幾個字
  trackSize: 26,        // 「蝦皮黑貓」和物流單號本身
  snSize: 14,           // 訂單編號本身
  gap: 14,
};

// ---- 紙張格式(膠囊鈕切換)-------------------------------------------
// 預設「黑貓熱感應」= 上面那組照範例量好的 95x193mm 版面(中間有印刷區)。
// 「4x6」= 101.6x152.4mm 通用熱感應貼紙,沒有印刷區:上面明細+金額,下面貼標籤(縮到放得下、置中)。
// 切換時把對應的數值整組蓋進上面那幾個常數物件 —— 產生 PDF 的程式完全不用分兩套。
const SHOPEE_FORMATS = {
  bcat: {
    page: { ...SHOPEE_PAGE }, items: { ...SHOPEE_ITEMS }, total: { ...SHOPEE_TOTAL },
    label: { ...SHOPEE_LABEL_BOX }, nolabel: { ...SHOPEE_NOLABEL },
  },
  // 4x6 一筆訂單印兩張(使用者 2026-10-15 指定):第 1 張明細(最上面印訂單編號,才對得回標籤),
  // 第 2 張標籤(放大到填滿整張、置中)。明細整張都能用,字可以印大一點
  "4x6": {
    page: { w: 4 * 72, h: 6 * 72 },                         // 288 x 432 pt
    items: { x1: 18, x2: 152, colW: 118, fullW: 252, top: 54, maxBottom: 380, size: 18 },
    total: { top: 396, valueRight: 270 },
    label: { x: null, w: 288 - 12, top: 6, maxH: 432 - 12 },
    nolabel: { top: 30 },
  },
};
let shopeeFormat = "bcat";

function setShopeeFormat(fmt) {
  const f = SHOPEE_FORMATS[fmt];
  if (!f) return;
  shopeeFormat = fmt;
  const base = SHOPEE_FORMATS.bcat;
  Object.assign(SHOPEE_PAGE, base.page, f.page);
  Object.assign(SHOPEE_ITEMS, base.items, f.items);
  Object.assign(SHOPEE_TOTAL, base.total, f.total);
  Object.assign(SHOPEE_LABEL_BOX, base.label, f.label);
  Object.assign(SHOPEE_NOLABEL, base.nolabel, f.nolabel);
  setFormatPills("shopeeFormatPills", fmt);
  try { localStorage.setItem("shopeeFormat", fmt); } catch (e) {}
}

// 紙張格式的選取狀態(蝦皮、官網、離島貼紙共用;下拉選單或膠囊鈕都吃)
function setFormatPills(groupId, fmt) {
  const g = document.getElementById(groupId);
  if (!g) return;
  if (g.tagName === "SELECT") { g.value = fmt; return; }   // 紙張格式現在是下拉選單
  g.querySelectorAll(".fmt-pill").forEach(b => {
    const on = b.dataset.fmt === fmt;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
}

// 原檔上「標籤本身」佔的範圍,單位是 pt、從頁面左上角量起。
//
// 為什麼是絕對點數而不是頁面比例:蝦皮兩種下載格式(A6 熱感應單、A4 寄貨單+裝箱單)
// 紙張大小差很多,但標籤都畫在同一個絕對位置(x 約 7..220, top 從 7 開始),用比例反而對不上。
// bottom 抓寬一點(340)是因為不同寄送方式的標籤高度不一樣(店到家 333、標準配送 288),
// 裁多了只是下面多一塊空白,裁少了會切掉條碼 —— 寧可多裁。
const SHOPEE_SRC_LABEL = { left: 5.5, right: 221.5, top: 5.5, bottom: 340 };

// 上傳的檔案(兩邊都可以多選,蝦皮是每種寄送方式各出一份)
let shopeePacks = [];   // [{ name, orders, byOrder, byTracking }]
let shopeePdfs = [];    // [{ name, bytes, pages: [{ index, orderSn, tracking }] }]
// PDF 是逐頁抽文字,幾十頁要跑幾秒。這段期間如果讓人按下去,每筆都還對不到標籤,
// 會整份印成「無標籤」而且看起來很正常 —— 所以讀取中一律把按鈕鎖住。
let shopeePdfLoading = false;

// 勾了「不印發票」的訂單(存訂單編號)。送禮的客人不想讓收禮的人看到價錢,
// 那一張的總金額就換成「不印發票」四個字 —— 留白的話撿貨的人會以為是漏印了。
// 存訂單編號而不是頁碼,因為預覽每次都整個重畫,頁碼會跟著檔案順序跑掉。
const shopeeNoInvoice = new Set();

// 按 ✕ 拿掉、這次不印的頁(存 job.uid)。常見情況是對不到裝箱單的那幾張,
// 或是已經印過的單 —— 不想為了跳過一兩張就整批重來。
const shopeeRemoved = new Set();

// 手動改過的品項文字(job.uid → 每行一個品項)。自動縮寫是規則產生的,但總有規則想不到的
// 情況(臨時換贈品、客人加註),讓人能直接改比一直加特例規則實際。
// 金額不跟著文字走 —— 改字只是改紙上寫什麼,不該動到對帳的數字。
const shopeeEdited = new Map();
let shopeeEditingUid = null;

function startShopeeEdit(uid) {
  shopeeEditingUid = uid;
  renderShopeePreview();
}

function cancelShopeeEdit() {
  shopeeEditingUid = null;
  renderShopeePreview();
}

function resetShopeeEdit(uid) {
  shopeeEdited.delete(uid);
  shopeeEditingUid = null;
  renderShopeePreview();
}

function saveShopeeEdit(uid) {
  const ta = document.getElementById("shopeeEditBox");
  if (!ta) return;
  const lines = ta.value.split("\n").map(x => x.trim()).filter(Boolean);
  if (lines.length) shopeeEdited.set(uid, lines); else shopeeEdited.delete(uid);
  shopeeEditingUid = null;
  renderShopeePreview();
  // 字型是切過的子集,打到不在裡面的字會印成 □ —— 當場講,不要等印出來才發現
  const bad = unsupportedChars(lines.join(""));
  if (bad.length) {
    setShopeeStatus("這些字印不出來,紙上會變成 □:" + bad.join(" "), "warn");
  }
}

function removeShopeeJob(uid) {
  shopeeRemoved.add(uid);
  renderShopeePreview();
}

function restoreShopeeJobs() {
  shopeeRemoved.clear();
  shopeeEdited.clear();
  shopeeEditingUid = null;
  renderShopeePreview();
}

function shopeeJobKey(job) {
  return job.orderSn || job.tracking || "";
}

function toggleShopeeNoInvoice(key, on) {
  if (!key) return;
  if (on) shopeeNoInvoice.add(key); else shopeeNoInvoice.delete(key);
  const all = document.getElementById("shopeeNoInvoiceAll");
  if (all) {
    const jobs = shopeeBuildJobs();
    const keys = jobs.map(shopeeJobKey).filter(Boolean);
    all.checked = keys.length > 0 && keys.every(k => shopeeNoInvoice.has(k));
  }
}

function toggleShopeeNoInvoiceAll(on) {
  shopeeBuildJobs().forEach(job => {
    const k = shopeeJobKey(job);
    if (!k) return;
    if (on) shopeeNoInvoice.add(k); else shopeeNoInvoice.delete(k);
  });
  renderShopeePreview();
}

const shopeeScriptCache = new Map();
function shopeeLoadScript(src) {
  if (shopeeScriptCache.has(src)) return shopeeScriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("函式庫載入失敗:" + src));
    document.head.appendChild(el);
  });
  shopeeScriptCache.set(src, p);
  return p;
}

async function ensureShopeeLibs() {
  if (!window.pdfjsLib) {
    await shopeeLoadScript(SHOPEE_PDFJS_SRC);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = SHOPEE_PDFJS_WORKER;
  }
  if (!window.PDFLib) await shopeeLoadScript(SHOPEE_PDFLIB_SRC);
  if (!window.fontkit) await shopeeLoadScript(SHOPEE_FONTKIT_SRC);
}

// 字型本體(base64,約 2.4MB)用到才載。不放在 <head> 的原因是其他四個分頁根本用不到,
// 沒道理每個人開網站都先拖 2.4MB。載一次就被瀏覽器快取。
const SHOPEE_FONT_JS = "shopee-code-font.js";

let shopeeFontBytes = null;
async function ensureShopeeFont() {
  if (shopeeFontBytes) return shopeeFontBytes;
  if (typeof SHOPEE_CODE_FONT_B64 === "undefined") {
    await shopeeLoadScript(SHOPEE_FONT_JS);
  }
  if (typeof SHOPEE_CODE_FONT_B64 === "undefined") {
    throw new Error("載入中文字型失敗(" + SHOPEE_FONT_JS + "),代號會印不出來");
  }
  const bin = atob(SHOPEE_CODE_FONT_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  shopeeFontBytes = bytes;
  return shopeeFontBytes;
}

// 一選好檔案就先偷偷開始載字型,等按下「產生」時通常已經好了。
// 失敗不用管 —— ensureShopeeFont() 到時候會自己再試一次並且好好報錯。
function preloadShopeeFont() {
  if (typeof SHOPEE_CODE_FONT_B64 === "undefined") {
    shopeeLoadScript(SHOPEE_FONT_JS).catch(() => {});
  }
}

// 熱感應單上的蝦皮訂單編號固定 14 碼英數。pdf.js 回傳的文字是一段一段的,
// 空白拿掉之後編號會跟後面的門市代號(2423…)黏在一起,所以只取標籤後面剛好 14 碼
// —— 用 {12,20} 這種寬鬆長度會把門市代號一起吃進來。
function extractShopeeOrderSn(text) {
  const flat = String(text).replace(/\s+/g, "");
  const m = flat.match(/蝦皮訂單編號[:：]?([A-Z0-9]{14})/);
  return m ? m[1] : "";
}

// 備用比對鍵(訂單編號讀不到時才用)。店到家是 TW + 13 碼,黑貓宅急便是純 12 碼
function extractShopeeTracking(text) {
  const flat = String(text).replace(/\s+/g, "");
  const tw = flat.match(/(TW\d{10,})/);
  if (tw) return tw[1];
  const hei = flat.match(/(?<!\d)(\d{12})(?!\d)/);
  return hei ? hei[1] : "";
}

// 一個實體頁面可能塞了不只一張標籤:
//   2026-10-05 起:兩張 A6 標籤直向疊在同一張 A4 上
//   2026-10-19 起:A4 上 2×2 排四張(左上、右上、左下、右下),三張的話右下空著
// 中間沒有分頁也沒有分隔標記,所以用每張「蝦皮訂單編號」文字的位置(x 和 y)當錨點。
//
// 以前是「整行文字」比對,同一排左右兩張標籤的字會被併成一行,只抓得到左邊那張
// (右上那張就漏了,實際發生在 2026-10-19 的單)。現在逐個文字片段找,左右分開。
// 每張標籤的物流單號只在「自己那一欄、自己的錨點到下一個錨點之間」找,號碼才不會混。
//
// items 是 { str, x, top }( top 從頁面上緣算起,跟 parseItemListBlocks 用的座標系一致)
function extractShopeeLabelSlots(items) {
  const sorted = items.slice().sort((a, b) => (a.top - b.top) || (a.x - b.x));
  const anchors = [];
  sorted.forEach((it, i) => {
    if (!/蝦皮訂單編號/.test(it.str.replace(/\s+/g, ""))) return;
    // 編號本身可能在同一片段,也可能是右邊緊接著的那一片(同一行、x 比較大、離很近)
    const near = sorted.filter(o => Math.abs(o.top - it.top) < 3 && o.x >= it.x && o.x - it.x < 140)
                       .sort((a, b) => a.x - b.x).map(o => o.str).join("").replace(/\s+/g, "");
    const m = near.match(/蝦皮訂單編號[:：]?([A-Z0-9]{14})/);
    if (m) anchors.push({ orderSn: m[1], top: it.top, x: it.x });
  });
  if (!anchors.length) return [];

  // 欄:x 差不多的算同一欄(左欄 x≈7、右欄 x≈305)
  const colStarts = [];
  anchors.slice().sort((a, b) => a.x - b.x).forEach(a => {
    if (!colStarts.some(c => Math.abs(c - a.x) < 40)) colStarts.push(a.x);
  });
  const colOf = x => colStarts.reduce((best, c) => Math.abs(c - x) < Math.abs(best - x) ? c : best, colStarts[0]);

  // 排序:先由上往下、同一排再由左往右(跟紙上的閱讀順序一樣)
  anchors.sort((a, b) => (Math.abs(a.top - b.top) < 3 ? a.x - b.x : a.top - b.top));

  return anchors.map(a => {
    const col = colOf(a.x);
    const colIdx = colStarts.slice().sort((p, q) => p - q).indexOf(col);
    const nextCol = colStarts.filter(c => c > col).sort((p, q) => p - q)[0] ?? Infinity;
    const below = anchors.filter(o => colOf(o.x) === col && o.top > a.top + 3).map(o => o.top);
    const bandEnd = below.length ? Math.min(...below) : Infinity;
    const mine = items.filter(o => o.top >= a.top - 20 && o.top < bandEnd && o.x >= col - 10 && o.x < nextCol - 10);
    // 物流單號優先看「寄件編號」那一行自己的值(緊接在後面那一片),不要把整張標籤的字黏在一起找 ——
    // 黏起來的話,單號後面接著的其他數字(門市代號、條碼字)會被一起吃進去
    const lbl = mine.find(o => /寄件編號/.test(o.str.replace(/\s+/g, "")));
    let tracking = "";
    if (lbl) {
      const val = mine.filter(o => Math.abs(o.top - lbl.top) < 3 && o.x >= lbl.x).sort((p, q) => p.x - q.x)
                      .map(o => o.str).join("").replace(/\s+/g, "");
      const m = val.match(/寄件編號[:：]?([A-Z0-9]+)/) || val.match(/[:：]([A-Z0-9]+)/);
      if (m) tracking = m[1];
    }
    if (!tracking) {
      const bandText = mine.sort((p, q) => (p.top - q.top) || (p.x - q.x)).map(o => o.str).join(" ");
      tracking = extractShopeeTracking(bandText);
    }
    return { orderSn: a.orderSn, tracking, top: a.top, x: a.x, col: colIdx, colX: col };
  });
}

// 找這張標籤是哪筆訂單的商品。
// 「寄貨單+裝箱單」版的 PDF 自己就帶商品列表,優先用它 —— 同事不用再去下載 xlsx。
// 只有 A6 熱感應單那種(PDF 裡沒有商品)才回頭查裝箱單。
function shopeeFindOrder(key) {
  for (const pdf of shopeePdfs) {
    const its = pdf.items && pdf.items.get(key.orderSn);
    if (its && its.length) {
      return { orderSn: key.orderSn, tracking: key.tracking, items: its };
    }
  }
  for (const pk of shopeePacks) {
    const o = pk.byOrder.get(key.orderSn) || pk.byTracking.get(key.tracking);
    if (o) return o;
  }
  return null;
}

// 一個放置區收兩種檔案:xlsx 當裝箱單、pdf 當熱感應單。
// 分批丟是常態(先拖裝箱單再拖 PDF,或一種寄送方式拖一次),所以是累加不是取代,
// 同名檔案會蓋掉舊的 —— 重新下載過的檔案再拖一次就會更新,不會變成兩份。
async function onShopeeFiles(files) {
  const list = Array.from(files || []);
  const packs = list.filter(f => /\.xlsx?$/i.test(f.name));
  const pdfs = list.filter(f => /\.pdf$/i.test(f.name));
  if (packs.length) await onShopeePackFiles(packs);
  if (pdfs.length) await onShopeePdfFiles(pdfs);
}

function clearShopeeFiles() {
  shopeePacks = [];
  shopeePdfs = [];
  shopeeNoInvoice.clear();
  shopeeRemoved.clear();
  const input = document.getElementById("shopeeInput");
  if (input) input.value = "";
  renderShopeeFileList();
  renderShopeePreview();
}

// ---------- 讀裝箱單(可多份) ----------
async function onShopeePackFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  preloadShopeeFont();
  for (const file of list) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // 蝦皮這份檔的 <dimension> 寫成 A1(他們產檔的 bug),幸好 SheetJS 會自己重算範圍;
      // 之後若換解析器,記得不能信 dimension,否則整張表只會讀到一格
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
      const parsed = parsePackingList(rows);
      shopeePacks = shopeePacks.filter(x => x.name !== file.name);
      shopeePacks.push({ name: file.name, ...parsed });
    } catch (e) {
      setShopeeStatus("裝箱單「" + file.name + "」讀取失敗:" + e.message, "error");
      return;
    }
  }
  renderShopeeFileList();
  renderShopeePreview();
}

// ---------- 讀熱感應 PDF(可多份) ----------
async function onShopeePdfFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  preloadShopeeFont();
  shopeePdfLoading = true;
  renderShopeePreview();
  try {
    await ensureShopeeLibs();
    for (const file of list) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf.slice(0));
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const pages = [];
      const items = new Map();       // 訂單編號 → 商品陣列(商品列表優先用這份,有價格)
      const pickItems = new Map();   // 訂單編號 → 商品陣列(撿貨單,沒有價格,只在 items 沒有時才補)
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const vp = page.getViewport({ scale: 1 });
        const text = tc.items.map(it => it.str).join(" ");
        // pdf.js 的 transform 是 [a,b,c,d,x,y],y 從頁面底部算,換成從上面算才好比對
        const flat = tc.items.map(it => ({
          str: it.str,
          x: it.transform[4],
          top: vp.height - it.transform[5],
          w: it.width,
        }));

        // 蝦皮有好幾種下載格式,頁數和順序都不一樣,所以看內容認頁別,不要照位置猜:
        //   撿貨單   → 這筆訂單的商品(沒有價格,只在商品列表/裝箱單都沒有時當備胎)
        //   商品列表 → 這筆訂單的商品(「寄貨單+裝箱單」版,不用再下載 xlsx,有價格)
        //   其他有訂單編號的 → 託運標籤(一頁可能不只一張,見 extractShopeeLabelSlots)
        if (/撿貨單/.test(text)) {
          for (const [sn, its] of parsePickListPage(flat)) {
            const prev = pickItems.get(sn) || [];
            pickItems.set(sn, prev.concat(its));
          }
          continue;
        }
        if (/商品列表/.test(text)) {
          // 一個實體頁面可能塞了不只一筆訂單的表(2026-09-28 起蝦皮的新排版是
          // 一頁兩筆,直向排、中間空一大段),所以這裡吃的是「這一頁切出來的每一段」
          for (const parsed of parseItemListBlocks(flat)) {
            if (!parsed.orderSn) continue;
            const prev = items.get(parsed.orderSn) || [];
            // 商品多的時候列表會跨頁,同一張單要接起來而不是覆蓋
            items.set(parsed.orderSn, prev.concat(parsed.items));
          }
          continue;
        }
        if (!/蝦皮訂單編號|寄件編號/.test(text)) continue;
        // 一個實體頁面可能塞了不只一張標籤(直向疊好幾張,中間沒有分頁),
        // 用每一張「蝦皮訂單編號」的位置當錨點切開,抓到幾個錨點就是幾張標籤
        const slots = extractShopeeLabelSlots(flat);
        if (!slots.length) {
          // 抓不到錨點的保底:整頁當一張標籤處理,維持舊行為
          pages.push({ index: i - 1, slot: 0, shiftTop: 0, orderSn: extractShopeeOrderSn(text), tracking: extractShopeeTracking(text) });
        } else {
          // 位移以「最左上那張」為基準:往下幾排 → shiftTop,往右幾欄 → shiftLeft
          const top0 = Math.min(...slots.map(x => x.top));
          const left0 = Math.min(...slots.map(x => x.colX));
          slots.forEach((s, k) => {
            pages.push({ index: i - 1, slot: k, shiftTop: s.top - top0, shiftLeft: s.colX - left0,
                         orderSn: s.orderSn, tracking: s.tracking });
          });
        }
      }
      // 撿貨單沒有價格,只在商品列表/裝箱單都沒抓到這筆訂單時才當備胎用
      for (const [sn, its] of pickItems) {
        if (!items.has(sn)) items.set(sn, its);
      }
      shopeePdfs = shopeePdfs.filter(x => x.name !== file.name);
      shopeePdfs.push({ name: file.name, bytes, pages, items });
    }
  } catch (e) {
    shopeePdfLoading = false;
    setShopeeStatus("PDF 讀取失敗:" + e.message, "error");
    renderShopeePreview();
    return;
  }
  shopeePdfLoading = false;
  renderShopeeFileList();
  renderShopeePreview();
}

// 要印的頁面清單 = 每張熱感應標籤一頁,加上「有裝箱單但沒有標籤」的訂單(黑貓)各一頁。
// 兩邊都走一遍才不會漏:標籤對不到裝箱單 → 印「查無商品資料」;
// 裝箱單對不到標籤 → 那是沒有熱感應條碼的寄送方式,改印大字物流單號。
function shopeeBuildJobs() {
  const jobs = [];
  const usedOrders = new Set();

  shopeePdfs.forEach((pdf, pdfIdx) => {
    pdf.pages.forEach(p => {
      const order = shopeeFindOrder(p);
      if (order) usedOrders.add(order.orderSn);
      jobs.push({
        // uid 認的是「哪一份 PDF 的第幾頁、第幾張標籤」而不是訂單編號 —— 同一張訂單
        // 重複下載過兩次時,用訂單編號會一次砍掉兩頁。檔案只會累加不會抽走,索引是穩定的。
        // 一定要帶 slot:一頁可能塞兩張標籤(見 extractShopeeLabelSlots),用同一個 index
        // 的話兩張標籤的 uid 會撞在一起,其中一張會被誤判成「已經 ✕ 掉」而印不出來。
        uid: "L" + pdfIdx + "#" + p.index + "." + (p.slot || 0),
        kind: "label",
        pdfIdx,
        pageIndex: p.index,
        shiftTop: p.shiftTop || 0,
        shiftLeft: p.shiftLeft || 0,
        orderSn: p.orderSn || (order && order.orderSn) || "",
        tracking: p.tracking || (order && order.tracking) || "",
        order,
      });
    });
  });

  shopeePacks.forEach(pk => {
    pk.orders.forEach(o => {
      if (usedOrders.has(o.orderSn)) return;
      jobs.push({
        uid: "N" + o.orderSn,
        kind: "nolabel",
        orderSn: o.orderSn,
        tracking: o.tracking,
        order: o,
      });
    });
  });

  return jobs.filter(j => !shopeeRemoved.has(j.uid));
}

// 一筆訂單 → 要印的明細。對不到資料會印「查無商品資料」而不是留白
function shopeeDetail(job) {
  const order = job.order;
  if (!order || !order.items.length) {
    return { lines: [sanitizeCode("查無商品資料")], total: 0, miss: true, unknown: false };
  }
  let unknown = false, total = 0;
  const lines = order.items.map(it => {
    const r = buildShortCode(it);
    if (r.unknown) unknown = true;
    // 兩種來源的金額欄意思不一樣:
    //   商品列表(PDF)的「總計」已經是整列小計 → 直接加
    //   裝箱單(xlsx)的「價格」是單價          → 要乘數量
    total += (it["小計"] != null) ? it["小計"] : r.price * r.qty;
    return sanitizeCode(r.compact);
  });
  return { lines, total, miss: false, unknown };
}

// 包一層:手動改過就用改過的,沒有才用規則算的。金額一律維持原本算出來的
function shopeeDetailFor(job) {
  const d = shopeeDetail(job);
  const edited = shopeeEdited.get(job.uid);
  if (edited && edited.length) {
    return { ...d, lines: edited.map(sanitizeCode), edited: true };
  }
  return d;
}

function renderShopeePreview() {
  const box = document.getElementById("shopeePreview");
  const btn = document.getElementById("shopeeGenBtn");
  if (!box) return;
  if (shopeePdfLoading) {
    if (btn) btn.disabled = true;
    setShopeeStatus("正在讀取熱感應單…", "loading");
    return;
  }
  const pdfHasItems = shopeePdfs.some(p => p.items && p.items.size);
  if (!shopeePacks.length && !pdfHasItems) {
    box.innerHTML = "";
    if (btn) btn.disabled = true;
    const undo0 = document.getElementById("shopeeRestoreBtn");
    if (undo0) undo0.style.display = "none";
    setShopeeStatus(
      shopeePdfs.length
        ? "這份 PDF 裡沒有商品列表,還要再給裝箱單…"
        : "把當天的檔案丟進來…", "");
    return;
  }
  const jobs = shopeeBuildJobs();
  let miss = 0, unknown = 0, nolabel = 0;
  const rows = jobs.map((job, i) => {
    const r = shopeeDetailFor(job);
    if (r.miss) miss++;
    if (r.unknown) unknown++;
    if (job.kind === "nolabel") nolabel++;
    const cls = r.miss ? "shopee-row miss" : (r.unknown ? "shopee-row unknown" : "shopee-row");
    const tag = job.kind === "nolabel" ? "無標籤" : "P" + (i + 1);
    // 對不到裝箱單 / 認不出品項的,清單上要有一個一眼看得到的驚嘆號,不能只靠底色
    const flag = r.miss ? "❗" : (r.unknown ? "⚠" : "");   // 預覽旗標保留 emoji(使用者 2026-10-15 指定)
    const key = shopeeJobKey(job);
    if (shopeeEditingUid === job.uid) {
      return "<div class=\"" + cls + " editing\">"
        + "<span class=\"shopee-pg\">" + tag + "</span>"
        + "<span class=\"shopee-sn\">" + (job.orderSn || job.tracking || "(讀不到編號)") + "</span>"
        + "<div class=\"shopee-edit\">"
        +   "<textarea id=\"shopeeEditBox\" rows=\"" + Math.max(2, r.lines.length) + "\">"
        +     escapeHtml(r.lines.join("\n")) + "</textarea>"
        +   "<div class=\"shopee-edit-btns\">"
        +     "<button class=\"btn btn-primary btn-small\" onclick=\"saveShopeeEdit('"
        +       escapeHtml(job.uid) + "')\">儲存</button>"
        +     "<button class=\"btn btn-secondary btn-small\" onclick=\"cancelShopeeEdit()\">取消</button>"
        +     (shopeeEdited.has(job.uid)
              ? "<button class=\"btn btn-secondary btn-small\" onclick=\"resetShopeeEdit('"
                + escapeHtml(job.uid) + "')\" title=\"丟掉手改的,回到自動縮寫\">還原</button>"
              : "")
        +     "<span class=\"shopee-edit-hint\">一行一個品項</span>"
        +   "</div>"
        + "</div>"
        + "</div>";
    }
    return "<div class=\"" + cls + "\">"
      + "<span class=\"shopee-flag\">" + flag + "</span>"
      + "<span class=\"shopee-pg\">" + tag + "</span>"
      + "<span class=\"shopee-sn\">" + (job.orderSn || job.tracking || "(讀不到編號)") + "</span>"
      + "<span class=\"shopee-code" + (r.edited ? " edited" : "") + "\">"
      +   (r.edited ? "✎ " : "") + escapeHtml(r.lines.join("　")) + "</span>"
      + "<button class=\"shopee-edit-btn\" title=\"手動改這一張要印的文字\""
      +   " onclick=\"startShopeeEdit('" + escapeHtml(job.uid) + "')\">編輯</button>"
      + "<label class=\"shopee-noinv\" title=\"勾了這張,金額那格印「不印發票」\">"
      +   "<input type=\"checkbox\" class=\"zoned-checkbox\"" + (shopeeNoInvoice.has(key) ? " checked" : "")
      +   " onchange=\"toggleShopeeNoInvoice('" + escapeHtml(key) + "', this.checked); renderShopeePreview();\">"
      +   "不印發票"
      + "</label>"
      // 金額不顯示也不印(2026-10-19 起手寫,報表金額有蝦幣折抵對不上)
      + "<button class=\"shopee-del\" title=\"這張不印\""
      +   " onclick=\"removeShopeeJob('" + escapeHtml(job.uid) + "')\">✕</button>"
      + "</div>";
  });
  box.innerHTML = rows.join("");
  if (shopeeEditingUid) {
    const ta = document.getElementById("shopeeEditBox");
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  if (btn) btn.disabled = !jobs.length;

  const bits = [jobs.length + " 頁"];
  if (nolabel) bits.push(nolabel + " 筆對不上寄件單(只印訂單編號)");
  if (miss) bits.push(miss + " 頁對不到裝箱單");
  if (unknown) bits.push(unknown + " 頁有認不出來的品項");

  const noInvCount = jobs.filter(j => shopeeNoInvoice.has(shopeeJobKey(j))).length;
  if (noInvCount) bits.push(noInvCount + " 張不印發票");
  if (shopeeRemoved.size) bits.push("已拿掉 " + shopeeRemoved.size + " 頁");
  const editedCount = jobs.filter(j => shopeeEdited.has(j.uid)).length;
  if (editedCount) bits.push(editedCount + " 張手改過文字");

  const undo = document.getElementById("shopeeRestoreBtn");
  if (undo) {
    undo.style.display = shopeeRemoved.size ? "" : "none";
    undo.textContent = "復原拿掉的 " + shopeeRemoved.size + " 頁";
  }
  setShopeeStatus(bits.join("、"), (miss || unknown) ? "warn" : "success");

  const all = document.getElementById("shopeeNoInvoiceAll");
  if (all) {
    const keys = jobs.map(shopeeJobKey).filter(Boolean);
    all.checked = keys.length > 0 && keys.every(k => shopeeNoInvoice.has(k));
  }
}

// 自動排版:一欄(整個寬度)和兩欄各算一次能用多大的字,取字比較大的那種。
//
// 為什麼不固定兩欄:欄寬只有 93.2pt,「胖組合大黃金+木+粉福*1」這種長代號塞進去
// 會被縮到 6pt,可是整張紙明明只有一件商品、上面一大片空白。反過來品項多的時候
// 兩欄才排得下 —— 所以讓它自己選,不要寫死。
function shopeeFitOneLayout(font, lines, cols) {
  const avail = SHOPEE_ITEMS.maxBottom - SHOPEE_ITEMS.top;
  const colW = cols === 1 ? SHOPEE_ITEMS.fullW : SHOPEE_ITEMS.colW;
  const rows = Math.ceil(lines.length / cols);
  for (let size = SHOPEE_ITEMS.size; size >= SHOPEE_ITEMS.minSize; size -= 0.25) {
    const lh = size * SHOPEE_ITEMS.lineRatio;
    if (rows * lh > avail) continue;
    if (lines.every(t => font.widthOfTextAtSize(t, size) <= colW)) {
      return { size, lh, cols, rows, fits: true };
    }
  }
  return null;
}

function shopeeFitItems(font, lines) {
  const avail = SHOPEE_ITEMS.maxBottom - SHOPEE_ITEMS.top;
  const one = shopeeFitOneLayout(font, lines, 1);
  const two = shopeeFitOneLayout(font, lines, 2);
  if (one && two) return one.size >= two.size ? one : two;   // 一樣大就用一欄,比較好讀
  if (one || two) return one || two;
  // 連最小字級、兩欄都塞不下 → 還是印,但要讓人知道有東西沒印完
  const size = SHOPEE_ITEMS.minSize;
  const lh = size * SHOPEE_ITEMS.lineRatio;
  return { size, lh, cols: 2, rows: Math.floor(avail / lh), fits: false };
}

async function generateShopeeLabels() {
  const btn = document.getElementById("shopeeGenBtn");
  const nudgeEl = document.getElementById("shopeeNudge");
  const nudge = (Number(nudgeEl && nudgeEl.value) || 0) * MM;   // mm → pt,正數往上
  if (btn) { btn.disabled = true; btn.textContent = "產生中…"; }
  try {
    await ensureShopeeLibs();
    const out = await PDFLib.PDFDocument.create();
    out.registerFontkit(window.fontkit);
    // 一定要 subset:false —— pdf-lib 對中文字型做 subset 會隨機掉字(「貓」「大」「右」
    // 印不出來,同一行的「黃」「金」卻正常)。字型已經離線切成只剩代號用字,整包嵌也才 33KB。
    const font = await out.embedFont(await ensureShopeeFont(), { subset: false });

    // 每份來源 PDF 只載入一次,頁面再各自 embedPage
    const srcDocs = [];
    for (const pdf of shopeePdfs) {
      srcDocs.push(await PDFLib.PDFDocument.load(pdf.bytes));
    }

    const fromTop = y => SHOPEE_PAGE.h - y;
    const jobs = shopeeBuildJobs();
    let overflow = 0;

    const split = shopeeFormat === "4x6";   // 明細、標籤分兩張印
    for (const job of jobs) {
      const page = out.addPage([SHOPEE_PAGE.w, SHOPEE_PAGE.h]);
      const labelPage = split ? out.addPage([SHOPEE_PAGE.w, SHOPEE_PAGE.h]) : page;
      if (split) {
        // 明細跟標籤分開了,明細最上面印訂單編號,才對得回是哪張標籤
        page.drawText(sanitizeCode("訂單編號"), {
          x: SHOPEE_ITEMS.x1, y: fromTop(14 + 9), size: 9, font, color: PDFLib.rgb(0, 0, 0),
        });
        page.drawText(sanitizeCode(job.orderSn || job.tracking || ""), {
          x: SHOPEE_ITEMS.x1, y: fromTop(26 + 16), size: 16, font, color: PDFLib.rgb(0, 0, 0),
        });
      } else if (job.kind === "label") {
        // 黑貓熱感應紙:有寄件單的也在最上面印訂單編號(使用者 2026-10-19 指定),小字一行,品項接在下面。
        // 沒寄件單的那種下半部本來就有大字訂單編號,不重複印
        page.drawText(sanitizeCode("訂單編號 " + (job.orderSn || job.tracking || "")), {
          x: SHOPEE_ITEMS.x1, y: fromTop(6 + 10), size: 10, font, color: PDFLib.rgb(0, 0, 0),
        });
      }

      // ---- 下半部(4x6 是第 2 張):有標籤就貼標籤,沒有就印大字物流單號 ----
      if (job.kind === "label") {
        const srcPage = srcDocs[job.pdfIdx].getPages()[job.pageIndex];
        if (srcPage) {
          const sw = srcPage.getWidth(), sh = srcPage.getHeight();
          // 裁掉標籤以外的空白(boundingBox 用來源頁的左下角座標系,所以 top/bottom 要翻)。
          // shiftTop:一頁塞了不只一張標籤時,第 2+ 張要往下位移對應的距離才裁得到自己
          // (見 extractShopeeLabelSlots),第一張 shiftTop=0,行為跟以前完全一樣
          // shiftLeft:2×2 排法右邊那一欄要往右位移才裁得到(左欄是 0)
          const shift = job.shiftTop || 0;
          const shiftX = job.shiftLeft || 0;
          const cropTop = Math.min(SHOPEE_SRC_LABEL.top + shift, sh);
          const cropBottom = Math.min(SHOPEE_SRC_LABEL.bottom + shift, sh);
          const crop = {
            left:   Math.min(SHOPEE_SRC_LABEL.left + shiftX, sw),
            right:  Math.min(SHOPEE_SRC_LABEL.right + shiftX, sw),
            bottom: sh - cropBottom,
            top:    sh - cropTop,
          };
          const embedded = await out.embedPage(srcPage, crop);
          // 寬度撐滿,但不能超過可用高度(4x6 下半部比較矮);x 沒指定就置中
          const scale = Math.min(SHOPEE_LABEL_BOX.w / (crop.right - crop.left),
                                 SHOPEE_LABEL_BOX.maxH / (crop.top - crop.bottom));
          const drawW = (crop.right - crop.left) * scale;
          const drawH = (crop.top - crop.bottom) * scale;
          labelPage.drawPage(embedded, {
            x: SHOPEE_LABEL_BOX.x ?? (SHOPEE_PAGE.w - drawW) / 2,
            y: fromTop(SHOPEE_LABEL_BOX.top) - drawH + nudge,
            xScale: scale,
            yScale: scale,
          });
        }
      } else {
        let y = SHOPEE_NOLABEL.top;
        const put = (text, size) => {
          labelPage.drawText(sanitizeCode(text), {
            x: SHOPEE_ITEMS.x1,
            y: fromTop(y + size),
            size, font, color: PDFLib.rgb(0, 0, 0),
          });
          y += size + SHOPEE_NOLABEL.gap;
        };
        // 對不上寄件單(沒有熱感應標籤)的:只寫訂單編號,品項在上半照印(使用者 2026-10-19 指定)
        put("訂單編號", SHOPEE_NOLABEL.labelSize);
        put(job.orderSn || job.tracking || "", SHOPEE_NOLABEL.trackSize);
      }

      // ---- 上半部:明細 + 總金額 ----
      const detail = shopeeDetailFor(job);
      const fit = shopeeFitItems(font, detail.lines);
      if (!fit.fits) overflow++;

      // 先填滿左欄再換右欄 —— 由上往下讀比較順,不是左右跳著看
      const perCol = Math.max(1, Math.ceil(detail.lines.length / fit.cols));
      detail.lines.forEach((t, i) => {
        const col = Math.floor(i / perCol);
        const row = i % perCol;
        if (col >= fit.cols || row >= fit.rows) return;   // 塞不下的不畫(已計入 overflow)
        page.drawText(t, {
          x: col === 0 ? SHOPEE_ITEMS.x1 : SHOPEE_ITEMS.x2,
          y: fromTop(SHOPEE_ITEMS.top + fit.lh * (row + 1)) + fit.size * 0.22,
          size: fit.size,
          font,
          color: PDFLib.rgb(0, 0, 0),
        });
      });

      // 金額不印(使用者 2026-10-19):有人用蝦幣折抵,報表上的金額跟實付對不上,改成手寫。
      // 金額那個位置平常留空給人寫;勾了「不印發票」的印「不印發票」四個字
      if (shopeeNoInvoice.has(shopeeJobKey(job))) {
        const noInv = sanitizeCode("不印發票");
        page.drawText(noInv, {
          x: SHOPEE_TOTAL.valueRight - font.widthOfTextAtSize(noInv, SHOPEE_TOTAL.valueSize),
          y: fromTop(SHOPEE_TOTAL.top + SHOPEE_TOTAL.valueSize),
          size: SHOPEE_TOTAL.valueSize, font, color: PDFLib.rgb(0, 0, 0),
        });
      }

      // 平台註記:印在金額同一行的左邊(那裡本來空著,不會壓到品項)。
      // 官網訂單用同一種紙,不註記的話印出來分不出是哪個平台的單
      page.drawText(sanitizeCode(SHOPEE_PLATFORM_TAG), {
        x: SHOPEE_ITEMS.x1,
        y: fromTop(SHOPEE_TOTAL.top + SHOPEE_TOTAL.valueSize),
        size: SHOPEE_TOTAL.valueSize, font, color: PDFLib.rgb(0, 0, 0),
      });

      // SHOPEE_GAP(分割線/印刷區)刻意留白,不畫任何東西
    }

    const bytes = await out.save();
    const name = "蝦皮出貨單_" + (shopeeFormat === "4x6" ? "4x6_" : "") + todayStr("") + ".pdf";
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
    setShopeeStatus(
      "已產生 " + name + "(" + jobs.length + " 筆" + (split ? "、" + jobs.length * 2 + " 頁" : "") + ")"
        + (overflow ? "、" + overflow + " 頁品項太多印不完,請檢查" : ""),
      overflow ? "warn" : "success");
  } catch (e) {
    setShopeeStatus("產生失敗:" + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "產生出貨單"; }
  }
}

function setShopeeStatus(msg, kind) {
  const el = document.getElementById("shopeeStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

// 裝箱單和標籤共用一格,每個檔案後面掛自己的數量 ——
// 分成兩格的話,只丟 PDF 的人會一直看到空的「裝箱單」那格,像是漏做了什麼
function renderShopeeFileList() {
  const el = document.getElementById("shopeeFileList");
  if (!el) return;
  const parts = [];
  shopeePacks.forEach(p => parts.push(p.name + "(" + p.orders.length + " 筆)"));
  shopeePdfs.forEach(p => {
    const items = p.items ? p.items.size : 0;
    parts.push(p.name + "(" + p.pages.length + " 張標籤"
      + (items ? "、自帶 " + items + " 筆商品" : "") + ")");
  });
  el.textContent = parts.length ? parts.join("、") : "尚未選擇檔案…";
  el.classList.toggle("empty", !parts.length);
  el.classList.toggle("has-file", parts.length > 0);
}
