// ===================================================================
// 瑪黑家居訂單:品項簡稱。
//
// 這個平台的「規格」欄目前一律是空的,款式(金運/招福)直接寫進「產品名稱」裡,
// 使用者 2026-10-19 說明的命名邏輯:
//   「胖胖招財招福貓」「胖胖金運招福貓」→ 泛稱,兩個詞都出現,沒有指定單一款式
//   「胖胖招財貓」(只有「招財」沒有「招福」) → 金運
//   「胖胖招福貓」(只有「招福」沒有「招財」) → 招福
// 顏色、尺寸、加購品的抽法直接借用蝦皮那套規則(buildShortCode),品名寫法幾乎
// 通用;只有這個「款式藏在品名裡」是蝦皮沒有的情況,蝦皮那邊的品名一律寫「招財招福貓」
// 要靠規格欄才知道款式,所以不能改 shopee-shortcode.js 的全域規則,只能在這裡先把
// 判斷出來的款式包成「【金運】」/「【招福】」塞進規格字串 —— 這個寫法 scStyle() 本來就認得
// (規格欄「招財黃【金運】」那種格式本來就有商品在用),不用動蝦皮那邊半行程式碼。
//
// 商品編號(瑪黑家居新版商品編號/供應商商品編號,例如 NIYA10019)目前看起來是流水號,
// 不像官網 SKU 那樣看得出顏色/尺寸/款式,沒辦法比照 web-shortcode.js 用正規表示式規則
// 對應;改成「貨號 → 覆寫結果」的清單,新貨號出現、人工確認過款式之後加一行就好,
// 之後同一個貨號就不用每次都靠品名猜。
// ===================================================================

// 貨號 → 固定覆寫。貨號一旦確認對應哪個商品,就不會因為品名改標題而跑掉;
// 還沒人工確認過的貨號,靠下面的 marheStyleFromName() 從品名判斷,判斷不出來才算 unknown。
const MARHE_SKU_RULES = {
  // 範例(人工確認後解除註解):NIYA10019: { style: "金運" },
};

// 「招財」「招福」兩個詞都出現 → 泛稱,不是指定款式(要去看別的欄位或人工確認);
// 只出現其中一個 → 那就是款式本身
function marheStyleFromName(name) {
  const hasGold = /招財貓/.test(name);
  const hasFu = /招福貓/.test(name);
  if (hasGold && hasFu) return "";
  if (hasGold) return "金運";
  if (hasFu) return "招福";
  return "";
}

// row = 瑪黑家居報表的一列(一個商品)。回傳格式跟蝦皮 buildShortCode 一樣:
// { code(預覽用,有空白), compact(印在紙上/備註用,不留空白), qty, unknown }
function buildMarheShortCode(row) {
  const sku = String(row["瑪黑家居新版商品編號"] ?? row["供應商商品編號"] ?? "").trim();
  const name = String(row["產品名稱"] ?? "").trim();
  const rawSpec = String(row["規格"] ?? "").trim();
  const qty = Number(row["數量"] ?? 1) || 1;

  const override = MARHE_SKU_RULES[sku] || {};
  // 規格欄已經有款式字樣就優先用(萬一哪天這個平台改成會填規格欄);
  // 不然就用貨號覆寫;都沒有才從品名判斷
  const inferredStyle = /金運|招福/.test(rawSpec) ? "" : (override.style || marheStyleFromName(name));
  const spec = [rawSpec, inferredStyle ? "【" + inferredStyle + "】" : ""].filter(Boolean).join(" ");

  if (typeof buildShortCode !== "function") {
    return { code: name + " x" + qty, compact: name + " x" + qty, qty, unknown: true };
  }
  const r = buildShortCode({ "商品名稱": name, "規格設定": spec, "數量": qty });
  return { code: r.code, compact: r.compact, qty, unknown: r.unknown };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildMarheShortCode, MARHE_SKU_RULES, marheStyleFromName };
}
