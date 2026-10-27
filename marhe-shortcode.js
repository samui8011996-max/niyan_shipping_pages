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

// 2026-10-27 瑪黑商品資料改成規格欄會寫款式了,但寫法跟蝦皮不一樣:
//   「胖胖招福貓-招財黃」「胖胖金運貓」「胖胖金運招福貓」(=一對)「15公分-招福貓」「一對招財招福貓」
// 蝦皮的 scStyle 認不得「胖胖招福貓」這種寫法,而且「-招福」會被當成款式再印一次(變「福福」),
// 所以先換成蝦皮認得的寫法再丟進去
// 「15公分水泥擴香招財貓招福貓」現場叫瘦貓,15公分就是(巨)(使用者 2026-10-27),
// 跟蝦皮「巨大炭錢夠招財」同一隻 —— 品名換成蝦皮那個,直接用蝦皮的瘦貓規則印 瘦貓(巨)金
function marheIsSlimCat(name) {
  return /15\s*公分.*招財貓招福貓/.test(name);
}

function marheNormalizeSpec(spec, name) {
  let s = spec.replace(/[-－]/g, " ");
  // 狗狗規格寫「來財-備長炭黑」「來富-清水灰」,換成蝦皮認得的「狗來財」(品名兩個字都有,只看品名會一律變富狗)
  if (/狗/.test(name)) s = s.replace(/來([財富])/, "狗來$1");
  // 消波塊規格只寫 小/中/大,蝦皮那套看的是公分;對法跟官網 TETRAPOD-S/M/L 一樣
  if (/消波塊/.test(name) && /^[小中大]$/.test(s.trim())) return { 小: "4.5公分", 中: "8公分", 大: "12公分" }[s.trim()];
  // 15公分那組是瘦貓,規格「一對招財招福貓」要留著「一對」給瘦貓規則看
  if (marheIsSlimCat(name)) return s.trim();
  // 8/15公分「招財貓招福貓」那組的款式由 shopee-shortcode 自己看規格欄的 招財貓/招福貓,不用換
  if (/招財貓招福貓/.test(name)) return s.replace(/一對招財招福貓/, "招財貓招福貓").trim();
  if (/胖胖金運招福貓/.test(s)) return s.replace(/胖胖金運招福貓/, "一對").trim();
  if (/(?:胖胖)?金運貓/.test(s)) return s.replace(/(?:胖胖)?金運貓/, "").trim() + " 【金運】";
  if (/(?:胖胖)?招福貓/.test(s)) return s.replace(/(?:胖胖)?招福貓/, "").trim() + " 【招福】";
  return s.trim();
}

// row = 瑪黑家居報表的一列(一個商品)。回傳格式跟蝦皮 buildShortCode 一樣:
// { code(預覽用,有空白), compact(印在紙上/備註用,不留空白), qty, unknown }
function buildMarheShortCode(row) {
  const sku = String(row["瑪黑家居新版商品編號"] ?? row["供應商商品編號"] ?? "").trim();
  const name = String(row["產品名稱"] ?? "").trim();
  const rawSpec = marheNormalizeSpec(String(row["規格"] ?? "").trim(), name);
  const qty = Number(row["數量"] ?? 1) || 1;

  const override = MARHE_SKU_RULES[sku] || {};
  // 規格欄已經有款式字樣就優先用(萬一哪天這個平台改成會填規格欄);
  // 不然就用貨號覆寫;都沒有才從品名判斷
  const inferredStyle = /金運|招福/.test(rawSpec) ? "" : (override.style || marheStyleFromName(name));
  const spec = [rawSpec, inferredStyle ? "【" + inferredStyle + "】" : ""].filter(Boolean).join(" ");

  if (typeof buildShortCode !== "function") {
    return { code: name + " x" + qty, compact: name + " x" + qty, qty, unknown: true };
  }
  // 「巨物胖胖招財貓」品名沒寫 (巨),scSize 抓不到尺寸 —— 補上,印成 胖胖貓(巨)黃金(使用者 2026-10-27)
  const codeName = marheIsSlimCat(name) ? "巨大炭錢夠招財 15公分"
    : /巨物/.test(name) && !/[(（]\s*巨/.test(name) ? name + " (巨)" : name;
  const r = buildShortCode({ "商品名稱": codeName, "規格設定": spec, "數量": qty });
  return { code: r.code, compact: r.compact, qty, unknown: r.unknown };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildMarheShortCode, MARHE_SKU_RULES, marheStyleFromName };
}
