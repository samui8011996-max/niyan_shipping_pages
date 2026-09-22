// ===================================================================
// 蝦皮出貨工具:把「商品名稱 + 規格」自動縮寫成印在熱感應單上的撿貨代號。
//
// 代號長什麼樣(由左到右,沒有的就整段省略):
//   [雕] [主體+尺寸] [顏色+款式] [星座] [+加購]
//   例:  雕 貓小對 黃 獅子 +木
//        貓小 黃金 +寶
//        獅子貓 +茶樹
//        消波4.5
//
// 為什麼不是直接砍商品名稱:賣場標題塞滿行銷字(【開店送禮,蝦皮限定優惠】…),
// 真正撿貨要看的四件事 —— 拿哪個公仔、哪個尺寸、哪個顏色/款式、要不要加購 ——
// 分散在標題和規格兩欄,而且同一件事有好幾種寫法,所以一律「抽特徵再重組」。
//
// 認不出來的欄位會留一個「?」,代表這筆要人工看過並補規則,不是靜靜印一個錯代號。
// ===================================================================

// ===================================================================
// 可以印出來的全部字元(唯一來源)。
// 除了規則會產生的代號用字,還包含實際商品名稱/規格出現過的字,以及現場手寫備註
// 常用的字 —— 因為預覽可以按「編輯」自己改文字,不在這個表裡的字會印成「□」。
//
// 為什麼要維護這個清單:pdf-lib 在前端對中文字型做 subset 會隨機掉字
// (實測「貓」「大」「右」「粉」印不出來,同一行的「黃」「金」卻正常),
// 所以改成「離線先把字型切成只含這些字」→ 執行時用 subset:false 整包嵌進去。
// 字型檔 shopee-code-font.ttf 就是照這個字串切出來的,用 build-shopee-font.py 重建。
//
// ⚠ 改了縮寫規則、加了新顏色/新品項/新精油,一定要:
//    1. 把新字加進這裡  2. 重跑 build-shopee-font.py  3. 兩個都 commit
//    沒重建的話,新字在熱感應單上會印成「□」(不會靜靜消失,列印前就看得出來)。
// ===================================================================
const SHOPEE_CODE_CHARS = "柑草葵竺精紛繽】【票發印不皮蝦編訂號流物*額總合胖消波蟾蜍犬兔馬雙喵團圓貓組財富大中小對六黑黃粉綠白灰金福左右牡羊座牛子巨蟹獅處女天秤蠍射手摩羯水瓶魚掌木寶霜油玫瑰薰衣佛茶樹甜橙檸檬雕查無商品資料此單件共□0123456789xX+-./,()[]:; abcdefghijklmnopqrstuvwyzABCDEFGHIJKLMNOPQRSTUVWYZ?!一上交人任住你健備優元公出分到刻加化原可名咬場塊士多奔套好字宅定客室家寄市帳幣底店康廚式心快怪惠惱意愛感戀所招換搞擇擋收文方日旺星有格樂標款泥淨清準炭為然煩片狗猫生療癒登盒研祝禪禮秋粽純結續者自色英萬製規請謝護貨賓賣購辦送速運選部配錢鍊長門開限陸隔雷項預顏首騰！，｜急補缺退改註贈另特別只剩等待已未少個袋條支顆張包裝箱破損重服確認留言注先後再同樣碼面取超付現明今期二三四七八九十的了和或與跟要沒是非否需拆貼紙帶封膠";

// 每一列都會呼叫,每次重建 Set 太浪費,建一次就好
let SC_CHAR_SET = null;
function scCharSet() {
  if (!SC_CHAR_SET) {
    // 以字型「實際含有的字」為準(shopee-code-chars.js,由 build-shopee-font.py 產生)。
    // SHOPEE_CODE_CHARS 只是規則自己會用到的字,現在字型切到 Big5 常用字,範圍大得多 ——
    // 拿它來判斷會把一堆印得出來的字誤判成缺字。獨立跑測試時沒載到那支才退回來用。
    const src = (typeof SHOPEE_FONT_CHARS !== "undefined") ? SHOPEE_FONT_CHARS : SHOPEE_CODE_CHARS;
    SC_CHAR_SET = new Set(src.split(""));
  }
  return SC_CHAR_SET;
}

// 字型沒有的字一律換成 □ —— 缺字要在紙上看得見,不能默默印成空白
function sanitizeCode(text) {
  const ok = scCharSet();
  return String(text ?? "").split("").map(c => (ok.has(c) ? c : "□")).join("");
}

// 印不出來的字有哪些(不重複)。手動編輯代號時要當場告訴人,不然只會在紙上看到 □
function unsupportedChars(text) {
  const ok = scCharSet();
  const bad = [];
  for (const c of String(text ?? "")) {
    if (!ok.has(c) && !bad.includes(c)) bad.push(c);
  }
  return bad;
}

// 星座清單:獨立跑測試時 shipping-core.js 不一定載入,所以自己備一份
const SC_ZODIAC = (typeof ZODIAC_SIGNS !== "undefined") ? ZODIAC_SIGNS
  : ["牡羊座", "金牛座", "雙子座", "巨蟹座", "獅子座", "處女座", "天秤座", "天蠍座", "射手座", "摩羯座", "水瓶座", "雙魚座"];

// 顏色:六個正式色名 → 一個字。順序有意義,「備長炭黑/炭錢黑」要排在「黑」之前
const SC_COLORS = [
  [/一套六色|六色任選/, "六"],
  [/備長炭黑|炭錢黑|炭黑/, "黑"],
  [/招財黃|黃金運/,       "黃"],
  [/戀愛粉/,             "粉"],
  [/健康綠/,             "綠"],
  [/純淨白/,             "白"],
  [/清水灰/,             "灰"],
];

// 款式只有金運/招福兩種,但「胖胖招財招福貓」這個品名本身就含「招福」兩字,
// 直接比對會讓每一筆都變成「招福」——所以只認「顏色後面緊接著款式」或規格欄的明確寫法
const SC_STYLE = { "金運": "金", "招福": "福" };

// 註:蝦皮的商品選項會寫「招財黃,右手金運」,但經確認左右手撿貨時用不到(款式已經決定了
// 是哪一隻),所以只拿它來判斷金運/招福(見 scStyle),不印進代號。

// 精油名稱縮到兩個字,印在 4x6 上才不會擠掉其他欄位
// 精油一律寫全名(使用者 2026-09-22 指定)。原本縮成兩個字是為了省寬度,
// 但「玫瑰」「佛手」這種半截的名字在現場容易念錯拿錯,字級自己會縮,不差這幾個字。
const SC_OILS = [
  [/玫瑰天竺葵|玫瑰/, "玫瑰天竺葵"],
  [/薰衣草/,         "薰衣草"],
  [/佛手柑/,         "佛手柑"],
  [/茶樹/,           "茶樹"],
  [/甜橙/,           "甜橙"],
  [/檸檬/,           "檸檬"],
];

// 依「主商品貨號」套用的特例。賣場標題三天兩頭改,貨號不會,所以能認貨號就別去比對標題。
// 每一項都是可選的:item 換掉主體名稱、size 覆寫尺寸(""=不印)、style 固定款式、
// dropAddons 拿掉多餘的加購字樣。
const SC_SKU_RULES = {
  // 【送禮首選】繽紛好運精油組 胖胖招財貓 (小)+精油 【交換禮物】
  // 現場叫「繽紛精油組」(跟【大小貓組】一樣用【】框起來,一眼看出是組合);這個賣場只出金運,顏色由買家選,只有一種尺寸所以不印尺寸。
  // 品名已經說了是精油組,再印一次「+油組」是廢話。
  "niyan_RedGiftBag": { item: "【繽紛精油組】", size: "", style: "金", dropAddons: ["油組"] },
};

function scSkuRule(row) {
  const sku = String(row["主商品貨號"] ?? "").trim();
  return (sku && SC_SKU_RULES[sku]) || null;
}

// 主體:比對順序 = specific → generic,「胖胖貓」那條一定要放最後,
// 不然消波塊/蟾蜍/招財犬這些非貓商品的標題裡若出現「招財」會被吃掉
// 組合商品在現場的叫法。要改名只動這裡 —— 但記得新用到的字要加進 SHOPEE_CODE_CHARS
// 並重跑 build-shopee-font.py,不然會印成「□」。
const SC_SET_LABEL = "【大小貓組】";

const SC_ITEMS = [
  [/消波塊/,                 "消波"],
  [/蟾蜍/,                   "蟾蜍"],
  [/招財犬|旺旺招財犬/,       "犬"],
  [/發財兔/,                 "兔"],
  [/黑馬招財[猫貓]|奔富黑馬/, "馬"],
  [/雙喵組/,                 "雙喵"],
  [/團圓貓/,                 "團圓"],
  // 蝦皮的「胖胖招財招福貓組(大…、小…、原木片)」是一次三件的組合,括號裡的大/小是內容物,
  // 不是可選尺寸 —— 要排在下面「胖胖…貓」那條之前,不然會被當成單隻貓
  [/胖胖[^,，]{0,8}貓組/,     SC_SET_LABEL],
  [/開運胖胖貓/,             "胖胖貓"],   // 星座貓,星座另外抽
  [/胖胖[^,，]{0,6}貓/,       "胖胖貓"],
];

function scText(row) {
  return [row["商品名稱"], row["規格設定"], row["客製刻印選項"]]
    .map(s => String(s ?? "").trim())
    .filter(s => s && s !== "-")
    .join(" ");
}

// 「XX: 不加購」整段拿掉。沒加購 = 沒資訊,留著只會讓後面的加購比對誤判
function scStripNotBought(s) {
  return String(s ?? "").replace(/[,，]?\s*\+?[^,，:：]{1,12}[:：]\s*不加購/g, "");
}

function scColor(s) {
  const hit = SC_COLORS.find(([re]) => re.test(s));
  return hit ? hit[1] : "";
}

// 款式:規格欄的四種寫法 + 品名裡「顏色 款式」連寫,其餘一律不猜
function scStyle(spec, name) {
  let m = spec.match(/款式[:：]\s*(金運|招福)/)            // 款式: 招福
       || spec.match(/[左右]手(金運|招福)/)                // 蝦皮:招財黃,右手金運
       || spec.match(/[-－]\s*(金運|招福)/)                // 顏色-款式: 招財黃-金運
       || spec.match(/【(金運|招福)】/)                    // 規格: 招財黃【金運】
       || spec.match(/(黃金運)/);                          // 規格: 黃金運
  if (m) return SC_STYLE[m[1]] || (m[1] === "黃金運" ? "金" : "");
  // 品名結尾常寫成「… 招財黃 金運」「… 戀愛粉 招福」「…招財黃金運X精油組」
  m = name.match(/(?:招財黃|戀愛粉|健康綠|純淨白|清水灰|炭錢黑|備長炭黑)\s*(金運|招福)/);
  return m ? SC_STYLE[m[1]] : "";
}

// 組合商品(「胖胖招財招福貓組(大胖胖金運貓招財黃、小胖胖金運招福貓、原木片)」)。
// 括號裡是固定的內容物,買家只能選其中一隻的顏色/款式,所以代號寫成:
//     【大小貓組】 + 固定那隻(大黃金) + 內附小物(+木) + 買家選的規格(+粉福)
//   → 【大小貓組】大黃金+木+粉福
// 固定那隻取括號內用「、」分開的第一項;它的品名是「金運貓」或「招福貓」只會出現一個,
// 所以這裡可以直接比對 —— 但第二項是「金運招福貓」兩個都有,不能這樣抓,
// 那一隻本來就是買家選的,由 spec 決定。
function scSetParts(name) {
  const inner = name.match(/[(（]([^)）]*[、,,][^)）]*)[)）]/);
  const out = { lead: "", wood: false };
  if (!inner) return out;
  const pieces = inner[1].split(/[、,,]/).map(x => x.trim()).filter(Boolean);
  out.wood = pieces.some(x => /木片|原木/.test(x));
  const first = pieces[0] || "";
  let size = "";
  if (/大/.test(first)) size = "大";
  else if (/中/.test(first)) size = "中";
  else if (/小/.test(first)) size = "小";
  const color = scColor(first);
  const style = /金運/.test(first) ? "金" : (/招福/.test(first) ? "福" : "");
  out.lead = size + color + style;
  return out;
}

function scSize(name) {
  let size = "";
  if (/[(（]\s*大\s*[)）]|貓\s*[(（]大/.test(name)) size = "大";
  else if (/[(（]\s*中\s*[)）]/.test(name)) size = "中";
  else if (/[(（]\s*小\s*[)）]/.test(name)) size = "小";
  if (/一對/.test(name)) size += "對";
  return size ? "(" + size + ")" : "";
}

// 星座:規格欄「星座: 獅子座(7/23~8/22)」優先,其次品名裡「獅子座開運胖胖貓」。
// 「貓掌」是雷雕圖案選項裡混在星座欄位的值,不是星座,但撿貨一樣要看,所以照印
function scZodiac(spec, name) {
  if (/貓掌/.test(spec)) return "貓掌";
  let m = spec.match(/星座[:：]\s*([^,，(（]+)/);
  if (m) {
    const sign = SC_ZODIAC.find(z => m[1].includes(z));
    if (sign) return sign.replace("座", "");
  }
  m = name.match(new RegExp("(" + SC_ZODIAC.join("|") + ")開運胖胖貓"));
  if (m) return m[1].replace("座", "");
  return "";
}

// 加購:一律只看清掉「不加購」之後剩下的文字。
// 精油例外——品名寫「X 甜橙精油」而規格沒寫的賣場是有的,所以精油名兩邊都掃
function scAddons(spec, name, drop) {
  const out = [];
  if (/木片底座|＋?底座|\+底座/.test(spec) || /\+底座/.test(name)) out.push("木");
  if (/元寶/.test(spec) || /元寶/.test(name)) out.push("寶");
  if (/護手霜/.test(name) || /護手霜/.test(spec)) out.push("霜");
  if (/精油組/.test(name)) out.push("油組");
  const oil = SC_OILS.find(([re]) => re.test(spec) || re.test(name));
  if (oil) out.push(oil[1]);
  return drop && drop.length ? out.filter(x => !drop.includes(x)) : out;
}

// 主回傳:{ code, parts, unknown } —— unknown=true 代表有欄位認不出來,UI 要標出來給人看
function buildShortCode(row) {
  const name = String(row["商品名稱"] ?? "").trim();
  const rawSpec = String(row["規格設定"] ?? "").trim();
  const spec = scStripNotBought(rawSpec);
  const all = scStripNotBought(scText(row));

  const seg = [];
  let unknown = false;

  if (/雷雕/.test(all)) seg.push("雕");

  const rule = scSkuRule(row);
  const itemHit = SC_ITEMS.find(([re]) => re.test(name));
  const item = (rule && rule.item) || (itemHit ? itemHit[1] : "?");
  // 有貨號特例就不算認不出來 —— 那是我們自己指定的名字,不是猜的
  if (!itemHit && !(rule && rule.item)) unknown = true;

  // 消波塊看的是幾公分,不是尺寸/顏色/款式
  if (item === "消波") {
    const cm = all.match(/(\d+(?:\.\d+)?)\s*(?:cm|公分)/);
    seg.push("消波" + (cm ? cm[1] : ""));
  } else if (item === "犬") {
    const dog = all.match(/([財富])狗狗/);
    seg.push((dog ? dog[1] : "") + "犬");
  } else if (item === SC_SET_LABEL) {
    const set = scSetParts(name);
    seg.push(SC_SET_LABEL + set.lead);
    if (set.wood) seg.push("+木");
    if (!set.lead) unknown = true;   // 括號裡讀不出固定那隻 → 要人工看
  } else if (item === "雙喵" || item === "團圓") {
    // 雙喵/團圓本來就是固定的「大+小」一組,品名裡的「(大金運+小招福)」是內容物說明,
    // 不是可選尺寸 —— 照 scSize 抓會變成「雙喵大」,反而看起來像有另一個小的版本
    seg.push(item);
  } else {
    seg.push(item + (rule && rule.size !== undefined ? rule.size : scSize(name)));
  }

  // 一對雷雕會把兩隻的顏色分開寫成「金運: 招財黃, 招福: 健康綠」,兩隻都要印
  const pair = spec.match(/金運[:：]\s*([^,，]+)/);
  const pair2 = spec.match(/招福[:：]\s*([^,，]+)/);
  if (pair && pair2) {
    seg.push(scColor(pair[1]) + "金+" + scColor(pair2[1]) + "福");
  } else if (item !== "消波" && item !== "犬") {
    const color = scColor(spec) || scColor(name);
    const style = (rule && rule.style) || scStyle(spec, name);
    // 組合商品的規格是買家挑的那一隻,要跟固定那隻區隔開,所以前面掛 +
    if (color || style) seg.push((item === SC_SET_LABEL ? "+" : "") + color + style);
  }

  const zodiac = scZodiac(spec, name);
  if (zodiac) seg.push(zodiac);

  const addons = scAddons(spec, name, rule && rule.dropAddons);
  if (addons.length) seg.push("+" + addons.join("+"));

  const qty = Number(row["數量"] ?? 1) || 1;
  const price = Number(String(row["價格"] ?? "").replace(/[^0-9.]/g, "")) || 0;
  const parts = seg.filter(Boolean);
  // code = 給畫面預覽看的(有空白比較好讀);compact = 印在紙上的(照使用者範例,不留空白)
  const code = parts.join(" ") + (qty > 1 ? " x" + qty : "");
  const compact = parts.join("") + "*" + qty;
  return { code, compact, parts, qty, price, unknown: unknown || code.includes("?") };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildShortCode, sanitizeCode, unsupportedChars, SHOPEE_CODE_CHARS };
}
