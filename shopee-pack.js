// ===================================================================
// 蝦皮「裝箱單」(店到家宅配_N.xlsx)解析。
//
// 欄位:tracking_number / order_sn / product_info / remark_from_buyer / seller_note
// product_info 是一整條字串,一張訂單有幾件就有幾段,每段長這樣:
//   [1] 商品名稱:XXX; 商品選項名稱:YYY; 價格: $ 590; 數量: 1; 商品選項貨號: ;
//
// ⚠ 這個檔的 <dimension> 寫成 A1(蝦皮那邊產檔的 bug),用「只讀取宣告範圍」的方式
//    解析會以為整張表只有一格。SheetJS 預設會自己重算範圍,所以沒事,但若哪天改用
//    別的解析器,記得要忽略 dimension 自己掃。
// ===================================================================

// 一段 [n] … 拆成欄位。分隔是「; 」,但值本身可能含逗號(招財黃,右手金運),不能用逗號切
function spParseSegment(seg) {
  const item = {};
  seg.split(/;\s*/).forEach(pair => {
    const m = pair.match(/^\s*([^:：]+)[:：]\s*(.*)$/);
    if (m) item[m[1].trim()] = m[2].trim();
  });
  return {
    "商品名稱": item["商品名稱"] || "",
    "規格設定": item["商品選項名稱"] || "",   // 對齊 shopee-shortcode 吃的欄位名
    "數量": Number(item["數量"] || 1) || 1,
    "價格": item["價格"] || "",
    "商品選項貨號": item["商品選項貨號"] || "",
  };
}

function parseProductInfo(text) {
  const s = String(text ?? "").trim();
  if (!s) return [];
  // 用 [1] [2] … 當分段點;第一段前面沒東西,split 出來的空字串要濾掉
  return s.split(/\[\d+\]\s*/).map(x => x.trim()).filter(Boolean).map(spParseSegment);
}

// rows = SheetJS sheet_to_json(header:1) 出來的陣列(第一列是標題)
// 回傳 { byOrder: Map(order_sn → 訂單), byTracking: Map(tracking_number → 同一個訂單) }
function parsePackingList(rows) {
  if (!rows || !rows.length) return { orders: [], byOrder: new Map(), byTracking: new Map() };
  const head = rows[0].map(h => String(h ?? "").trim());
  const idx = name => head.indexOf(name);
  const iTrack = idx("tracking_number"), iSn = idx("order_sn"), iInfo = idx("product_info");
  if (iSn < 0 || iInfo < 0) {
    throw new Error("這份不像蝦皮裝箱單:找不到 order_sn / product_info 欄位");
  }
  const orders = [], byOrder = new Map(), byTracking = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const sn = String(row[iSn] ?? "").trim();
    if (!sn) continue;
    const o = {
      orderSn: sn,
      tracking: String(row[iTrack] ?? "").trim(),
      items: parseProductInfo(row[iInfo]),
    };
    orders.push(o);
    byOrder.set(o.orderSn, o);
    if (o.tracking) byTracking.set(o.tracking, o);
  }
  return { orders, byOrder, byTracking };
}

// ===================================================================
// 「蝦皮熱感應寄貨單+裝箱單」PDF 的「商品列表」頁。
//
// 這個版本一筆訂單兩頁(託運單 + 商品列表),商品資料就在 PDF 裡,不用另外下載 xlsx。
// 商品列表是一張表格,欄位是 # / 主商品貨號 / 商品名稱 / 商品選項貨號 / 商品規格名稱 / 數量 / 總計。
//
// ⚠ 不能照文字順序讀:PDF 的文字是照繪製順序吐出來的,同一條 y 上不同欄位的字會黏成
//    「1,1200」(#=1、數量=1、總計=200)這種看不出來的東西。所以一律**照 x 座標分欄**,
//    欄界從表頭那一列的各欄 x 位置算出來(不寫死,蝦皮調版面也還能用)。
//    商品名稱和規格都會換行,同一欄要把上下好幾行接起來。
// ===================================================================

const PACK_COLS = ["#", "主商品貨號", "商品名稱", "商品選項貨號", "商品規格名稱", "數量", "總計"];

// items = [{ str, x, top, w }](x/top 是頁面左上角為原點)
function parseItemListPage(items) {
  const txt = items.map(i => String(i.str || "")).join("");
  if (!txt.includes("商品列表")) return null;

  const snM = txt.replace(/\s+/g, "").match(/訂單編號[^:：]*[:：]([A-Z0-9]{14})/);
  const orderSn = snM ? snM[1] : "";

  // --- 表頭:找出每一欄的 x 位置 ---
  const heads = {};
  for (const it of items) {
    const s = String(it.str || "").trim();
    if (PACK_COLS.includes(s) && heads[s] === undefined) {
      heads[s] = { x0: it.x, x1: it.x + (it.w || 0), top: it.top };
    }
  }
  if (heads["商品名稱"] === undefined || heads["數量"] === undefined) return null;
  const headTop = heads["商品名稱"].top;

  // 欄界 = 相鄰兩欄的中線。「#」那欄常常跟表頭不同一行,抓不到就用商品名稱左邊當界
  const present = PACK_COLS.filter(c => heads[c]).sort((a, b) => heads[a].x0 - heads[b].x0);
  const bounds = present.map((name, i) => {
    const prev = i === 0 ? null : heads[present[i - 1]];
    const next = i === present.length - 1 ? null : heads[present[i + 1]];
    return {
      name,
      from: prev ? (prev.x1 + heads[name].x0) / 2 : -Infinity,
      to: next ? (heads[name].x1 + next.x0) / 2 : Infinity,
    };
  });
  const colOf = x => (bounds.find(b => x >= b.from && x < b.to) || {}).name || "";

  // --- 表身 ---
  const body = items
    .filter(it => it.top > headTop + 3 && String(it.str || "").trim())
    .filter(it => !/^買家備註/.test(String(it.str).trim()))
    .sort((a, b) => a.top - b.top || a.x - b.x);
  // 「買家備註」以下不是商品了
  const endAt = items.filter(it => /^買家備註/.test(String(it.str || "").trim()))
    .reduce((m, it) => Math.min(m, it.top), Infinity);

  // 每一列由「#」欄的序號起頭
  const starts = body
    .filter(it => it.top < endAt && colOf(it.x) === "#" && /^\d+$/.test(String(it.str).trim()))
    .map(it => it.top);
  if (!starts.length) return { orderSn, items: [] };

  const out = [];
  starts.forEach((top, i) => {
    const until = i + 1 < starts.length ? starts[i + 1] - 3 : endAt;
    const cell = {};
    body.filter(it => it.top >= top - 3 && it.top < until).forEach(it => {
      const c = colOf(it.x);
      if (!c || c === "#") return;
      cell[c] = (cell[c] || "") + String(it.str);
    });
    const qty = Number(String(cell["數量"] || "").replace(/[^0-9.]/g, "")) || 1;
    const sub = Number(String(cell["總計"] || "").replace(/[^0-9.]/g, ""));
    out.push({
      "商品名稱": (cell["商品名稱"] || "").trim(),
      "規格設定": (cell["商品規格名稱"] || "").trim(),
      "數量": qty,
      // 這一欄是「總計」= 整列的小計,不是單價,所以不要再乘數量
      "小計": Number.isFinite(sub) ? sub : null,
      "商品選項貨號": (cell["商品選項貨號"] || "").trim(),
    });
  });
  return { orderSn, items: out };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parsePackingList, parseProductInfo, parseItemListPage };
}
