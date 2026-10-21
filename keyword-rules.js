// ===================================================================
// 過濾 / 刪除關鍵字 / 替換 規則 (原本在 index.html 內,獨立成檔方便維護)
// 這個檔案要在主程式的 <script> 之前用 <script src="keyword-rules.js"> 載入
// ===================================================================

// 「當月壽星」行銷標題用的星座
// 星座貓的賣場標題會掛上當月壽星的星座來吸引下單(例如
// 「【12星座貓客製雷雕】…星座開運胖胖貓x客製生日紀念日 處女座 天秤座」),每個月換,
// 跨月的月份還會一次掛兩個。但客人實際挑哪一隻是看規格設定的「星座: 金牛座(4/20~5/20)」,
// 跟標題上掛的那兩個完全無關 —— 標題的星座若留在備註裡,出貨的人會一次看到
// 「處女座 天秤座 金牛座」三個星座,不知道要拿哪隻。
// 所以:規格設定/客製刻印欄裡「有」星座時,商品名稱上的星座一律拿掉(不管掛幾個、哪個月);
// 舊的「一個星座開一個賣場」(星座只寫在標題、規格裡沒有)則照舊留著,不然會變成沒人知道要拿哪隻。
// 變數名不能叫 ZODIAC_SIGNS —— shipping-core.js 已經有一個同名的 const,
// 兩支都是 <script> 共用全域,撞名會讓 shipping-core.js 整支載不起來。
const ZODIAC_NAMES = [
  "牡羊座", "金牛座", "雙子座", "巨蟹座", "獅子座", "處女座",
  "天秤座", "天蠍座", "射手座", "摩羯座", "水瓶座", "雙魚座",
];

// 連【OO座送禮】【OO座生日快樂】這種包在方括號裡的一起吃掉,
// 不然只挖掉星座會留下孤零零的「【送禮】」。
const PROMO_ZODIAC_REGEX = new RegExp(
  "\\s*【?(?:" + ZODIAC_NAMES.join("|") + ")(?:送禮|生日快樂)?】?", "g");

function hasZodiacName(text) {
  const s = String(text ?? "");
  return ZODIAC_NAMES.some(z => s.includes(z));
}

function stripPromoZodiac(name) {
  return String(name ?? "").replace(PROMO_ZODIAC_REGEX, "");
}

// 空白字元可能是全形/半形/多個空白,逐字比對容易對不到 → 用正規表示式忽略空白處理
const REMOVE_REGEX_PATTERNS = [
  /【\s*送禮首選】/g,
  // 「【OO座送禮】」這種標題,12 星座版本一律刪掉(例如【處女座送禮】)
  /【(牡羊座|金牛座|雙子座|巨蟹座|獅子座|處女座|天秤座|天蠍座|射手座|摩羯座|水瓶座|雙魚座)送禮】/g,
  // 「【OO座生日快樂】」這種標題,12 星座版本一律刪掉
  /【(牡羊座|金牛座|雙子座|巨蟹座|獅子座|處女座|天秤座|天蠍座|射手座|摩羯座|水瓶座|雙魚座)生日快樂】/g,
  // 任何「OO: 不加購」都整段刪掉(沒加購=沒資訊,不用印在備註),不用每個欄位名稱各寫一條;
  // 有些欄位名稱前面接著 + 號(例如「+加購木片底座: 不加購」),要一起吃掉才不會留下孤立的逗號/+號
  /[,，]?\s*\+?[一-鿿A-Za-z0-9]{1,10}[:：]\s*不加購/g,
];

const REMOVE_PATTERNS = [
  ", +250天然精油: 不加購",
  "【開運組合】",
  "【財運滾滾來】",
  "為你擋住所有煩惱",
  " , +加購木片底座: 不加購 '",
  ", +加購: 不加購 '",
  ", 加購: 不加購",
  "(收禮者可任選)",
  "【+1元多一件】",
  "【 泥研製所||生日送禮首選】",
  "泥研製所||",
  "【泥研製所】",
  "+250",
  "單方",
  "+加購單方精油: 不加購",
  "+加購精油: 不加購",
  ", 加購精油: 不加購",
  ", +加購木片底座: 不加購",
  "好運禮物組",
  " +金元寶+底座",
  "(3/21~4/19)",
  "(4/20~5/20)",
  "(5/21~6/21)",
  "(6/22~7/22)",
  "(7/23~8/22)",
  "(8/22~9/23)",
  "(9/23~10/23)",
  "(10/24~11/22)",
  "(11/23~12/21)",
  "(12/22~1/19)",
  "(1/20~2/18)",
  "(2/19~3/20)",
  " 處女座 獅子座",
  "6色可選【辦公室小物】",
  "【顏色可自選】",
  "6款顏色任選",
  "收禮人自選顏色！6色可選",
  "【泥研製所||辦公室小物】",
  "【辦公室小物】",
  "+元寶 生日禮物 招財貓禮物 ｜可加購精油",
  "生日 祝福 感謝招財貓",
  "收禮者可任選 12款招財貓+精油組！",
  "收禮人自選色!3色可選～",
  "【入厝送禮 一家祈福】",
  "客製生日.英文名字",
  "收禮人自選顏色!6色可選",
  "收禮人自選精油！",
  "x客製生日紀念日",
  "【開店送禮首選】",
  "【生日送禮首選】",
  "中部粽",
  "【搞怪禮物】",
  "限定登場｜",
  "12星座",
  "'",
  "+50",
  "【不倒翁招財招福貓】",
  "【入厝送禮】",
  "【必選禮物】",
  "【開運招財擺件】",
  "【開運送禮】",
];

// 品名簡化(找到左邊字串就整段換成右邊,跟 REMOVE_PATTERNS 不同,這裡是「換字」不是單純刪除)
const REPLACE_PATTERNS = [
  ["胖胖招財招福貓", "胖胖貓"],
  ["胖胖金運招福貓", "胖胖貓"],
  ["胖胖招財貓", "胖胖貓"],  // 少數訂單漏打「招福」兩字,補這個變體才會被辨識成胖胖貓,不然會被誤判成完全不同的商品
  ["【萬馬奔騰，馬上有錢】", "【馬貓】"],
  ["【快速出貨，心意送禮】", "【快速出貨】"],
  ["辦公室療癒首選", "辦公室語錄"],
  ["辦公室發財語錄", "辦公室語錄"],
  ["星座開運胖胖貓", "星座貓"],
  ["開運胖胖貓", "星座貓"],
  ["顏色-款式:", "規格:"],
  [", +加購木片底座: 木片", "+加購: 木片"],
  [", +加購木片底座: 木片", "+加購: 木片"],
  ["賓士水泥消波塊", "消波塊"],
  ["客製化雷雕", "雷雕"],
  ["圓滾滾幸運貓", "雙手貓"],
  // 顏色名稱簡化:招財黃 → 黃,以此類推
  ["招財黃", "黃"],
  ["炭錢黑", "黑"],
  ["純淨白", "白"],
  ["健康綠", "綠"],
  ["清水灰", "灰"],
  ["戀愛粉", "粉"],
];

// ---- LINE禮物個別商品的備註寫法(使用者 2026-10-21 在審核頁逐一決定)----
// 用 LINE 的「商品編號」對應,沒列在這裡的商品一律照原本寫法(buildNoteFull)。
//   short: true  → 改用跟蝦皮/官網同一套簡寫(shopee-shortcode.js 的 buildShortCode)
//   title        → 照原本寫法,只是把又長又是行銷字的品名換成短的
//   spec         → 規格裡要換掉的字 [[找, 換成], ...]
//   giantLaser   → 雷雕巨物招財貓:【雷雕】胖胖貓(巨)黃金 文字:XXX;沒填文字印「未雷雕換木片」
//   zodiacCat    → 星座貓 星座: 獅子座, 加購: 茶樹精油
//   dog          → 狗 黑財 / 狗 黑富。dog 給顏色字就用那個顏色,給 true 就看規格的顏色;
//                  財/富看規格「選擇狗狗: 財狗狗」「款式: 富」或品名的「(富)」;extra 接在最後
const LINE_NOTE_RULES = {
  "322027870": { short: true },   // 水泥咬幣金錢招福蟾蜍 → 蟾蜍灰
  "322031898": { dog: "黑" },     // 金項鍊-好運旺旺招財犬 炭錢黑 → 狗 黑財 / 狗 黑富
  "322381305": { dog: "黑", extra: "+檜木精油" },   // 旺旺芬芳好運組 招財犬 炭錢黑+檜木精油 → 狗 黑財+檜木精油
  "322027872": { dog: true },     // 【狗狗有財】好運旺旺招財犬 (富) → 狗 灰富 / 狗 白富(顏色看規格)
  "322301178": { short: true },   // 天后派對Q版媽祖公仔 → 媽祖
  "322575749": { short: true },   // 【天赦日迎好運】胖胖招財招福貓(大) → 胖胖貓(大)
  // 圓滾滾幸運貓團圓版 6 色 → 雙手貓(三入) 黃(使用者 2026-10-21)
  "322209152": { title: "雙手貓(三入) 黃" },
  "322234353": { title: "雙手貓(三入) 黑" },
  "322234354": { title: "雙手貓(三入) 白" },
  "322031897": { title: "雙手貓(三入) 綠" },
  "322031895": { title: "雙手貓(三入) 灰" },
  "322031896": { title: "雙手貓(三入) 粉" },
  "322027860": { title: "可愛兔" },
  "322027867": { title: "貓頭鷹", spec: [["歪左邊守護好運", "歪左邊"], ["歪右邊幸福滿滿", "歪右邊"], ["好運幸福一對", "一對"]] },
  "322436662": { title: "馬貓+精油" },   // 【萬馬奔騰，馬上有錢】好運奔富黑馬招財貓+精油
  "322031735": { title: "胖胖貓 (大) 白 金運" },
  "322031883": { title: "胖胖貓(大)一對 黑" },
  "322031755": { title: "胖胖貓(大) 白 招福" },
  "322031750": { title: "胖胖貓(大) 黑 金運" },
  "322031884": { title: "胖胖貓(大)一對 綠" },
  "322031880": { title: "胖胖貓(大)一對 灰" },
  "322031888": { title: "胖胖貓一對(小)" },
  "322233703": { title: "【雷雕】胖胖貓 (大)", spec: [["雷雕(未填寫文字會換成木片)", "(未雷雕換木片)"]] },
  "322329026": { title: "團圓美滿胖胖貓(大中小三入)" },
  "322329751": { title: "永生花玻璃球【矢車藍】" },
  "322346457": { title: "永生花玻璃球【櫻花粉】" },
  "322384394": { title: "胖胖貓 (大金運+小招福)雙喵組" },
  "322413765": { title: "【好運禮盒】消波塊4.5公分 +" },   // 接規格「精油: 佛手柑」→ …4.5公分 + 精油: 佛手柑
  "322233451": { giantLaser: true },
  "322095963": { title: "龍年寶寶" },
  "322125174": { title: "福氣黃龍寶寶" },
  "322194001": { title: "胖胖招福貓 黃 招福 (大)" },
  "322579026": { title: "星座貓X永生花玻璃球" },
};

const LINE_COLOR_CHAR = { "招財黃": "黃", "炭錢黑": "黑", "純淨白": "白", "健康綠": "綠", "清水灰": "灰", "戀愛粉": "粉" };

// 星座貓(…座開運胖胖貓、可選星座的星座開運胖胖貓,有沒有「+元寶」都算)全部統一成
// 「星座貓 星座: 獅子座, 加購: 茶樹精油」(使用者 2026-10-21)。用品名判斷,每個月新開的星座賣場也會套到;
// 雷雕星座貓、星座永生花是別的商品,不算
function isLineZodiacCat(name) {
  return /開運胖胖貓/.test(name) && !/雷雕|永生花/.test(name);
}

function lineRuleFor(row) {
  const byId = LINE_NOTE_RULES[String(row["商品編號"] ?? "").trim()];
  if (byId) return byId;
  if (isLineZodiacCat(String(row["商品名稱"] ?? ""))) return { zodiacCat: true };
  return null;
}

// 加購一律寫成「, 加購: 茶樹精油」(使用者 2026-10-21)。LINE 的規格有好幾種寫法:
// 「+加購精油: 茶樹」「+加購單方精油: 茶樹」「+250天然精油: 茶樹」(+250 拿掉後剩「天然精油: 茶樹」)、
// 「加購: +金元寶」。精油組/好運禮盒裡的「精油: 佛手柑」是禮盒本來就有、客人挑的,不是加購,不動。
function lineNormalizeAddons(note) {
  return note
    .replace(/[,，]?\s*\+?(?:加購(?:單方)?精油|天然精油)[:：]\s*([^\s,，]+)/g, ", 加購: $1精油")
    .replace(/[,，]?\s*加購[:：]\s*\+?/g, ", 加購: ")
    .replace(/^,\s*/, "")
    .replace(/\s+/g, " ").trim();
}

// 黑貓出貨表/分區列印/離島標籤用的備註
function buildNote(row) {
  return lineNormalizeAddons(buildNoteRaw(row));
}

function buildNoteRaw(row) {
  const rule = lineRuleFor(row);
  if (!rule) return buildNoteFull(row);
  const qty = row["數量"] ?? 1;
  if (rule.short && typeof buildShortCode === "function") {
    const r = buildShortCode({ "商品名稱": row["商品名稱"], "規格設定": row["規格設定"], "數量": qty });
    if (!r.unknown) return r.compact;
    return buildNoteFull(row);
  }
  if (rule.giantLaser) {
    const spec = String(row["規格設定"] ?? "");
    const color = (spec.match(/招財黃|炭錢黑|純淨白|健康綠|清水灰|戀愛粉/) || [])[0];
    const style = /金運/.test(spec) ? "金" : (/招福/.test(spec) ? "福" : "");
    const text = (String(row["客製刻印選項"] ?? "").match(/刻印文字[:：]\s*(.+)$/) || [])[1]?.trim();
    return `【雷雕】胖胖貓(巨)${color ? LINE_COLOR_CHAR[color] : ""}${style} ${text ? "文字:" + text : "未雷雕換木片"} x${qty}`;
  }
  if (rule.dog) {
    const spec = String(row["規格設定"] ?? ""), name = String(row["商品名稱"] ?? "");
    const color = typeof rule.dog === "string" ? rule.dog
      : ((spec.match(/(清水灰|磨石白|純淨白|備長炭黑|炭錢黑|灰|白|黑)/) || [])[1] || "").replace(/清水|磨石|純淨|備長炭|炭錢/, "");
    const pick = (spec.match(/([財富])狗狗/) || spec.match(/款式[:：]\s*([財富])/) || name.match(/[(（]([財富])[)）]/) || [])[1] || "";
    return `狗 ${color}${pick}${rule.extra || ""} x${qty}`;
  }
  if (rule.zodiacCat) {
    const spec = String(row["規格設定"] ?? "");
    // 可選星座的賣場看規格;一個星座一個賣場的,星座寫在品名「巨蟹座開運胖胖貓」(不是前面行銷用的【天秤座生日快樂】)
    const name = String(row["商品名稱"] ?? "");
    const sign = (spec.match(/星座[:：]\s*([^,，(（【]+)/) || [])[1]?.trim()
      || (name.match(new RegExp("(" + ZODIAC_NAMES.join("|") + ")開運胖胖貓")) || [])[1];
    const oil = (spec.match(/加購(?:單方)?精油[:：]\s*([^,，【\s]+)/) || spec.match(/加購[:：]\s*([^,，【\s]+?)精油/) || [])[1];
    const segs = [sign && "星座: " + sign, oil && oil !== "不加購" && "加購: " + oil + "精油"].filter(Boolean);
    return `星座貓${segs.length ? " " + segs.join(", ") : ""} x${qty}`;
  }
  let spec = String(row["規格設定"] ?? "");
  for (const [find, repl] of (rule.spec || [])) spec = spec.split(find).join(repl);
  const note = buildNoteFull({ ...row, "商品名稱": rule.title || row["商品名稱"], "規格設定": spec });
  return note.replace(/\s+-\s*(?=x\d+$)/, " ").replace(/\s+/g, " ").trim();   // 空的刻印欄留下的「 - 」拿掉
}

// 原本的完整寫法(保留「顏色:」「星座:」「刻印文字:」「金運:/招福:」這些欄位名)。
// 上傳廠商試算表一定要用這個 —— 雷雕網站(niyan_Laser)是從雷雕試算表的備註欄
// 用這些欄位名抓星座、顏色、刻印文字的,換掉它就抓不到了。
function buildNoteFull(row) {
  // 規格/刻印欄已經寫了客人挑的星座,標題上那些就只是當月的行銷字樣,拿掉(見 stripPromoZodiac)
  const pickedZodiac = hasZodiacName(row["規格設定"]) || hasZodiacName(row["客製刻印選項"]);
  const parts = [];
  for (const col of ["商品名稱", "規格設定", "客製刻印選項"]) {
    const v = row[col];
    if (v != null) {
      let s = String(v);
      if (col === "商品名稱" && pickedZodiac) s = stripPromoZodiac(s);
      s = s.trim();
      if (s && s !== "-") parts.push(s);
    }
  }
  const qty = row["數量"] ?? 1;
  let note = parts.join(" ") + ` x${qty}`;
  for (const [find, repl] of REPLACE_PATTERNS) note = note.split(find).join(repl);
  for (const pat of REMOVE_PATTERNS) note = note.split(pat).join("");
  for (const re of REMOVE_REGEX_PATTERNS) note = note.replace(re, "");
  note = note.replace(/[,、]\s*(?=x\d)/g, " ");
  return note.replace(/\s+/g, " ").trim();
}

// 一般文字清理:套用跟商品名稱一樣的 REPLACE/REMOVE/REMOVE_REGEX 規則,拿掉「不加購」「限定登場｜」
// 這類雜訊,但不像 cleanProductName 會把尺寸也拿掉 —— 純粹給「未配對訂單」這種顯示原始商品明細
// 用的欄位清一清,不是拿去當分組 key。
function cleanFreeText(text) {
  let s = String(text ?? "");
  for (const [find, repl] of REPLACE_PATTERNS) s = s.split(find).join(repl);
  for (const pat of REMOVE_PATTERNS) s = s.split(pat).join("");
  for (const re of REMOVE_REGEX_PATTERNS) s = s.replace(re, "");
  return s.replace(/\s+/g, " ").trim();
}

// 取「乾淨的品項名」作為排序鍵 → 同品項一定排一起
// 例如「【泥研製所||辦公室小物】胖胖招財招福貓 (小)」和「【辦公室小物】胖胖招財招福貓 (小)」
// 經過 REMOVE_PATTERNS 清理後會變成同字串,就能合併
function cleanProductName(name) {
  // 分組/排序用的名稱不留星座:星座是撿貨真正在乎的差異,但它由 zodiacGroupSuffix 依
  // extractZodiac(看規格設定)另外貼在後面。留在名稱裡反而會讓同一款商品因為標題每月換星座、
  // 或「一星座一賣場」的舊標題,被拆成好幾個不同的組。
  let s = stripPromoZodiac(name);
  for (const [find, repl] of REPLACE_PATTERNS) s = s.split(find).join(repl);
  for (const pat of REMOVE_PATTERNS) s = s.split(pat).join("");
  for (const re of REMOVE_REGEX_PATTERNS) s = s.replace(re, "");
  s = s.replace(/[(（](小|中|大)[)）]/g, "");   // 尺寸另外用 extractSize 排序,不放進分組名稱裡
  return s.replace(/\s+/g, " ").trim();
}

// 有些品項的尺寸/組合描述是寫在規格設定裡,不是商品名稱,所以要合併比對;
// 原始資料的商品名稱其實是「胖胖招財招福貓」不是「胖胖貓」,要先套 REPLACE_PATTERNS 簡化成跟關鍵字一致的寫法才比對得到;
// 且原始資料的空白不一定跟關鍵字打的一樣(有無空格),兩邊都去掉空白再比對
function rowHaystack(row) {
  let s = [row["商品名稱"] ?? "", row["規格設定"] ?? "", row["客製刻印選項"] ?? ""].map(String).join("");
  for (const [find, repl] of REPLACE_PATTERNS) s = s.split(find).join(repl);
  return s.replace(/\s+/g, "");
}
