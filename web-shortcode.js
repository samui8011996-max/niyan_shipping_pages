// ===================================================================
// 官網訂單:用「商品貨號(SKU)」推出品項簡稱。
//
// 為什麼看貨號不看品名:官網(Shopline)的貨號是照規則編的(款式-顏色-尺寸-金運/招福),
// 品名會改、貨號不會。規則照 2026-10-15 的全商品目錄(niyancement-BulkUpdateForm)寫,
// 簡稱的寫法跟蝦皮出貨單一致(主體+尺寸 → 顏色+款式 → 星座 → +加購),現場看起來是同一套。
//
// 認不出來的貨號 → 退回蝦皮那套「看品名抽特徵」的規則(buildShortCode);
// 那邊也認不出來就直接印品名 + 選項,並標 unknown,讓預覽清單亮警示。
// 新商品上架、貨號規則變了,在 WEB_SKU_RULES 加一條就好。
// ===================================================================

const WEB_COLORS = {
  YELLOW: "黃", PINK: "粉", GREEN: "綠", BLACK: "黑",
  WHITE: "白", GREY: "灰", GRAY: "灰", BLUE: "藍", PURPLE: "紫",
};
const WEB_SIZES = { S: "小", M: "中", L: "大", XL: "巨" };
const WEB_STYLES = { GOLD: "金", FU: "福", FORTUNE: "福", PAIR: "金福" };
const WEB_OILS = {
  BERGAMOT: "佛手柑", LAVENDER: "薰衣草", GERANIUM: "玫瑰天竺葵",
  TEATREE: "茶樹", LEMON: "檸檬", ORANGE: "甜橙",
};
// 星座有兩種縮寫:永生花用三碼(ARI)、星座貓用全名(ARIES)
const WEB_ZODIAC = {
  ARI: "牡羊", ARIES: "牡羊", TAU: "金牛", TAURUS: "金牛", GEM: "雙子", GEMINI: "雙子",
  CAN: "巨蟹", CANCER: "巨蟹", LEO: "獅子", VIR: "處女", VIRGO: "處女",
  LIB: "天秤", LIBRA: "天秤", SCO: "天蠍", SCORPIO: "天蠍", SAG: "射手", SAGITTARIUS: "射手",
  CAP: "摩羯", CAPRICORN: "摩羯", AQU: "水瓶", AQUARIUS: "水瓶", PIS: "雙魚", PISCES: "雙魚",
};
const WEB_MOAI = {
  POMPADOUR: "飛機頭", MIDPART: "中分頭", BUZZ: "吋頭", BALD: "光頭", BOWL: "西瓜皮", SET5: "五款一組",
};

// 尺寸 + 一對:「(小)」「(中一對)」—— 一對寫成「中一對」,跟蝦皮一樣避免看成款式
function webSize(sz, style) {
  const s = WEB_SIZES[sz] || "";
  return "(" + s + (style === "PAIR" ? "一對" : "") + ")";
}

// 每條規則:[正規式, (比對結果) => 分段陣列]。由上往下比,第一條命中就用。
// 有前綴包含關係的(FAT / FATCAT / FATCATF、ZCAT / ZCAT-ALL)正規式本身就分得開,順序無所謂
const WEB_SKU_RULES = [
  // 胖胖招財招福貓(三個賣場的貨號前綴不同,規則一樣)
  [/^(?:FAT|FATCAT|FATCATF)-([A-Z]+)-(S|M|L|XL)-(GOLD|FU|PAIR)$/,
    m => ["胖胖貓" + webSize(m[2], m[3]), WEB_COLORS[m[1]] + WEB_STYLES[m[3]]]],
  // 巨物胖胖貓(15cm)
  [/^GIANT-CHUBBY-([A-Z]+)-(GOLD|FORTUNE)$/,
    m => ["胖胖貓(巨)", WEB_COLORS[m[1]] + WEB_STYLES[m[2]]]],
  // 好運成對:第一個顏色是金運那隻、第二個是招福那隻,含木片底座
  [/^FATPAIR-(M|L)-([A-Z]+)-([A-Z]+)$/,
    m => ["胖胖貓" + webSize(m[1], "PAIR"), WEB_COLORS[m[2]] + "金+" + WEB_COLORS[m[3]] + "福", "+木"]],
  // 好運禮盒:小胖胖貓 + 護手霜 / + 精油(含木片底座)
  [/^GIFT-CREAM-([A-Z]+)-(GOLD|FU)$/,
    m => ["胖胖貓(小)", WEB_COLORS[m[1]] + WEB_STYLES[m[2]], "+霜"]],
  [/^GIFT-OIL-([A-Z]+)-(GOLD|FU)-([A-Z]+)$/,
    m => ["胖胖貓(小)", WEB_COLORS[m[1]] + WEB_STYLES[m[2]], "+木+" + WEB_OILS[m[3]]]],
  [/^GIFT-TETRAPOD-([A-Z]+)$/, m => ["消波塊4.5cm", "+" + WEB_OILS[m[1]]]],
  // 星座貓:-ENG 是客製刻印,前面掛「【雷雕】」(跟蝦皮一樣),刻字內容看訂單備註
  [/^ZCAT-(?:ALL-)?([A-Z]+?)(-ENG)?$/,
    m => [m[2] ? "【雷雕】" : "", "星座貓", WEB_ZODIAC[m[1]] + "座"]],
  // 永生花
  [/^FLOWERCAT-(PINK|BLUE)-(GOLD|PINK)$/,
    m => ["永生花" + WEB_COLORS[m[1]], m[2] === "GOLD" ? "黃金" : "粉福"]],
  [/^ZFLOWER-([A-Z]+)-([A-Z]+)$/,
    m => ["星座永生花" + WEB_COLORS[m[1]], WEB_ZODIAC[m[2]] + "座"]],
  // 圓滾滾幸運貓(LINE 那邊叫「雙手貓」,見 keyword-rules.js)
  [/^LUCKY-([A-Z]+)-(S|M|L|SET)$/,
    m => ["雙手貓" + (m[2] === "SET" ? "(一家三口)" : webSize(m[2])), WEB_COLORS[m[1]]]],
  [/^GIANT-CHARCOAL-(R|L|PAIR)$/,
    m => ["炭錢巨貓", { R: "右", L: "左", PAIR: "一對" }[m[1]]]],
  [/^SLIMCAT8-([A-Z]+)-(R|L|PAIR)$/,
    m => ["招財貓招福貓", WEB_COLORS[m[1]] + { R: "金", L: "福", PAIR: "金福" }[m[2]]]],
  [/^DOG-([A-Z]+)-(CAI|FU)$/, m => [(m[2] === "CAI" ? "財" : "富") + "犬", WEB_COLORS[m[1]]]],
  [/^DRAGON-([A-Z]+)-(\d+)CM$/, m => ["龍寶寶" + m[2], WEB_COLORS[m[1]]]],
  [/^TETRAPOD-(S|M|L)$/, m => ["消波塊" + { S: "4.5", M: "8", L: "12" }[m[1]] + "cm"]],
  [/^RABBIT-(S|L)$/, m => ["兔" + (m[1] === "S" ? "4.5" : "8")]],
  [/^MOONRABBIT-([A-Z]+)$/, m => ["中秋兔", WEB_COLORS[m[1]]]],
  [/^TOAD-([A-Z]+)$/, m => ["蟾蜍", WEB_COLORS[m[1]]]],
  [/^GECKO-([A-Z]+)-(S|L)$/, m => ["守宮" + (m[2] === "S" ? "4.5" : "8"), WEB_COLORS[m[1]]]],
  [/^TIGER-(L|R|PAIR)$/, m => ["老虎", { L: "左", R: "右", PAIR: "對" }[m[1]]]],
  [/^OWL-TILT-(L|R|PAIR)$/, m => ["貓頭鷹", { L: "歪左", R: "歪右", PAIR: "一對" }[m[1]]]],
  [/^MOAI-S-([A-Z]+)-([A-Z0-9]+)$/, m => ["摩艾", WEB_COLORS[m[1]], WEB_MOAI[m[2]]]],
  [/^HORSECAT-([A-Z]+)$/, m => ["馬", "+" + WEB_OILS[m[1]]]],
  [/^OIL(?:5|10)-([A-Z]+)$/, m => ["精油", "+" + WEB_OILS[m[1]]]],
  [/^ENGRAVE-CAT-(M|L|XL)$/, m => ["【雷雕】", "加購(" + WEB_SIZES[m[1]] + "貓)"]],
  [/^ENGRAVE-WOOD$/, () => ["【雷雕】", "加購(木片)"]],
  [/^GIFT-CARD-SET$/, () => ["賀卡+插卡棒+木片"]],
  [/^GIFT-CARD$/, () => ["賀卡"]],
  [/^GIFT-BAG-RED$/, () => ["提袋"]],
  [/^WOOD-SLICE$/, () => ["木片"]],
  [/^HIDE-HOUSE$/, () => ["躲避屋"]],
  [/^CARD-HOLDER-MOUNTAIN$/, () => ["名片座"]],
  [/^POT-TILE4$/, () => ["花磚盆"]],
  [/^CANDLE-TULOU$/, () => ["蠟燭"]],
  [/^MAZU-Q-\d+$/, () => ["媽祖"]],
];

// row = 官網報表的一列(一個商品)。回傳格式跟蝦皮的 buildShortCode 一樣:
// { code(預覽用,有空白), compact(印在紙上,不留空白 + *數量), qty, unknown }
function buildWebShortCode(row) {
  const sku = String(row["商品貨號"] ?? "").trim().toUpperCase();
  const qty = Number(row["數量"] ?? 1) || 1;
  const finish = (parts, unknown) => {
    parts = parts.filter(Boolean);
    return {
      code: parts.join(" ") + " x" + qty,
      compact: parts.join("") + " x" + qty,   // 每個品項都寫 x數量,1 也要寫
      qty,
      unknown: unknown || parts.some(p => /undefined|\?/.test(p)),
    };
  };

  for (const [re, fn] of WEB_SKU_RULES) {
    const m = sku.match(re);
    if (m) return finish(fn(m), false);
  }

  // 貨號對不到:退回蝦皮那套看品名的規則(選項欄當規格)
  const name = String(row["商品名稱"] ?? "").trim();
  const spec = String(row["選項"] ?? "").trim();
  if (typeof buildShortCode === "function") {
    const r = buildShortCode({ "商品名稱": name, "規格設定": spec, "數量": qty });
    if (!r.unknown) return finish(r.parts, true);
  }
  // 都認不出來就照印品名(去掉【…】行銷字)+ 選項,至少撿得到貨
  const plain = name.replace(/【[^】]*】/g, "").trim() || name;
  return finish([plain, spec], true);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildWebShortCode, WEB_SKU_RULES };
}
