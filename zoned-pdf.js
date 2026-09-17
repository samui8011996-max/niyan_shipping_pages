// ===================================================================
// 分區列印:黑貓託運單 PDF 分頁
// ===================================================================
// 舊流程是「每組下載一份黑貓出貨表 xlsx → 一份一份丟進黑貓系統」,很花時間。
// 新流程改成:訂單一次全部倒進黑貓系統 → 黑貓吐回一份含全部託運單的 PDF →
// 丟進這裡,依照跟 xlsx 完全一樣的撿貨分組,把 PDF 拆成「每組一個檔」。
//
// 對應方式:每頁託運單上都印著訂單編號(18 碼),用它跟今天的 LINE 訂單表對。
// 實測 76 頁的檔案是一頁一個訂單編號、沒有重複,但程式仍支援同一訂單占多頁(多件)。
//
// 兩個函式庫都是「用到才載」,不放在 <head>:光 pdf.js 的 worker 就 1MB,
// 沒要分 PDF 的人不該為它付載入時間。
// ===================================================================

const PDFJS_SRC    = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const PDFLIB_SRC   = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";

let zonedPdfBytes = null;         // 原始 PDF(給 pdf-lib 重組用,不能是被 pdf.js 吃掉的那份)
let zonedPdfName = "";
let zonedPdfPages = [];           // [{ index(0起), orderId, trackNo }]
let zonedPdfByOrder = new Map();  // 訂單編號 → [頁 index,...]
let zonedPdfSrcDoc = null;        // pdf-lib 載好的來源文件,重複使用不用每次重讀

const zonedScriptCache = new Map();
function loadScriptOnce(src) {
  if (zonedScriptCache.has(src)) return zonedScriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("函式庫載入失敗:" + src));
    document.head.appendChild(el);
  });
  zonedScriptCache.set(src, p);
  return p;
}

async function ensurePdfLibs() {
  if (!window.pdfjsLib) {
    await loadScriptOnce(PDFJS_SRC);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  if (!window.PDFLib) await loadScriptOnce(PDFLIB_SRC);
}

// 從一頁的文字裡挖出訂單編號。
// 託運單上「訂單編號」會出現兩次,下半截那個是被截掉的 17 碼,所以:
//   1. 先找「訂單編號」標籤後面那串,長度剛好 18 碼的才算數
//   2. 找不到才退回「全頁任何一串獨立的 18 碼數字」
// pdf.js 給的文字是一小段一小段的,數字可能被切開,所以比對前先把空白全部拿掉。
function extractOrderId(text) {
  const flat = String(text).replace(/\s+/g, "");
  const labelled = flat.match(/訂單編號[:：]?(\d{18})(?!\d)/);
  if (labelled) return labelled[1];
  const any = flat.match(/(?<!\d)\d{18}(?!\d)/);
  if (any) return any[0];
  // 訂單編號後面緊接著品名的「0009-…」,整串會黏成 22 位數字,
  // 這時候取開頭 18 碼(訂單編號都是 20 開頭的年份)
  const glued = flat.match(/(?<!\d)(20\d{16})\d+/);
  return glued ? glued[1] : "";
}

// 優先從「重建過的那一行」抓:那一行是「訂單編號：xxx 代收款 元 溫層 常溫」,
// 數字前後都有別的字,不會跟品名的 0009 黏在一起
function extractOrderIdFromLines(lines, fallbackText) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("訂單編號") < 0) continue;
    const m = lines[i].replace(/\s+/g, "").match(/(?<!\d)(\d{18})(?!\d)/);
    if (m) return m[1];
  }
  return extractOrderId(fallbackText);
}

function extractTrackNo(text) {
  const m = String(text).replace(/\s+/g, "").match(/(\d{4}-\d{4}-\d{4})/);
  return m ? m[1] : "";
}

// ===== 修正 pdf.js 解出來的中文亂碼 =====
// 這份託運單的內嵌字型沒有給正確的 ToUnicode 對照,pdf.js 解出來的每個字
// 都被整體平移了一個固定值(實測中文字 +0x3058、括號/數字那個字型 +0x101),
// 例如「禮」會變成「䥖」。同一個字型的平移量是固定的,所以只要知道平移量就能還原。
//
// 怎麼知道平移量:每張黑貓託運單上一定會印「備註」「訂單編號」「收件人」這些固定標籤。
// 拿它們去比對「字碼差值」——平移不會改變字與字之間的差值——就能反推出平移量,
// 再用另外幾個標籤驗證,避免湊巧對到。
// 訂單編號那串數字本來就解得對(它用另一個字型),所以只平移需要平移的字型。

// 同一個字型裡,中文和 ASCII 標點的平移量不一樣(字型把它們排在 CID 空間的不同段),
// 所以每個字型要各算兩組:中文一組、ASCII 一組,再逐字判斷該用哪一組。
const DECODE_PROBES = ["備註", "訂單編號", "收件人", "客戶代號", "寄件人", "宅急便"];
const fontShiftCache = new Map();   // fontName → { cjk, latin }

const isCjk = c => (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff);
const isAscii = c => c >= 0x20 && c <= 0x7e;

function shiftText(s, d) {
  if (!d) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) - d);
  return out;
}

// 逐字還原。被打亂的字本身也可能落在中文區(「禮」被打亂成「䥖」),
// 所以不能因為「看起來已經是中文」就跳過不還原。
// 全形標點(：，【】)在這個字型裡又是另外好幾組平移量,硬解會解成別的字,
// 所以被打亂的字型只留「還原得出來」的字,其餘直接丟掉 ——
// 每一頁丟掉的都一樣,不影響分組,留著反而是亂碼。
function decodeWithShifts(s, sh) {
  const scrambled = !!(sh.cjk || sh.latin);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (sh.cjk && isCjk(c - sh.cjk)) { out += String.fromCharCode(c - sh.cjk); continue; }
    if (sh.latin && isAscii(c - sh.latin)) { out += String.fromCharCode(c - sh.latin); continue; }
    if (!scrambled && (isCjk(c) || isAscii(c))) { out += s[i]; continue; }
  }
  return out;
}

function asciiRatio(s) {
  if (!s.length) return 0;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e) n++;
  }
  return n / s.length;
}

function probeHits(s) {
  let n = 0;
  DECODE_PROBES.forEach(k => { if (s.indexOf(k) >= 0) n++; });
  return n;
}

// 用「每張單上一定會印的標籤」反推中文的平移量
function calibrateCjk(s) {
  if (probeHits(s) >= 2) return 0;                 // 本來就解得對
  for (let pi = 0; pi < DECODE_PROBES.length; pi++) {
    const probe = DECODE_PROBES[pi];
    for (let i = 0; i + probe.length <= s.length; i++) {
      const d = s.charCodeAt(i) - probe.charCodeAt(0);
      if (!d) continue;
      let ok = true;
      for (let k = 1; k < probe.length; k++) {
        if (s.charCodeAt(i + k) - probe.charCodeAt(k) !== d) { ok = false; break; }
      }
      // 同一個平移量至少要讓兩個不同標籤都對上,才算數(避免湊巧)
      if (ok && probeHits(shiftText(s, d)) >= 2) return d;
    }
  }
  return 0;
}

// 剩下那些字(用中文那組還原不了的)再找一個平移量,讓它們大部分落到指定範圍。
// ASCII 那組管括號、冒號、數字;全形那組管「：」「，」。
// 同一個字型會有好幾組平移量,是因為字型把 ASCII、全形標點、中文排在 CID 空間的不同段。
function calibrateRange(s, used, targets, inRange) {
  const rest = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let taken = false;
    for (let k = 0; k < used.length; k++) {
      const u = used[k];
      if (u[0] && u[1](c - u[0])) { taken = true; break; }
    }
    if (taken || isCjk(c) || isAscii(c)) continue;
    rest.push(c);
  }
  if (rest.length < 4) return 0;

  const freq = new Map();
  rest.forEach(c => freq.set(c, (freq.get(c) || 0) + 1));
  const common = Array.from(freq).sort((a, b) => b[1] - a[1]).slice(0, 30);

  let best = 0, bestScore = 0.3;      // 沒有明顯勝出就不要亂動
  common.forEach(pair => {
    targets.forEach(t => {
      const d = pair[0] - t;
      if (!d) return;
      let hit = 0;
      rest.forEach(c => { if (inRange(c - d)) hit++; });
      const score = hit / rest.length;
      if (score > bestScore) { bestScore = score; best = d; }
    });
  });
  return best;
}

const LATIN_TARGETS = [0x20, 0x28, 0x29, 0x2b, 0x2d, 0x2e, 0x2f, 0x3a,
                       0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39];

const NO_SHIFT = { cjk: 0, latin: 0 };

function shiftsFor(fontName) {
  return fontShiftCache.get(fontName || "?") || NO_SHIFT;
}

// 每個字型只校正一次(整份 PDF 共用同一批字型),之後每頁直接套用
function calibrateFonts(items) {
  const byFont = new Map();
  items.forEach(it => {
    const f = it.fontName || "?";
    byFont.set(f, (byFont.get(f) || "") + it.str);
  });
  byFont.forEach((text, font) => {
    if (fontShiftCache.has(font)) return;
    const cjk = calibrateCjk(text);
    const latin = calibrateRange(text, [[cjk, isCjk]], LATIN_TARGETS, isAscii);
    fontShiftCache.set(font, { cjk: cjk, latin: latin });
  });
}

// 把一頁的 text items 還原後,照原順序接回來
function decodePageText(items) {
  calibrateFonts(items);
  return items.map(it => decodeWithShifts(it.str, shiftsFor(it.fontName))).join(" ");
}

// ===== 只有 PDF、沒有訂單總表時的分組 =====
// 託運單的「備註」欄印的就是出貨表寫進去的品項描述(buildNote 的輸出:
// 商品名稱 + 規格設定 + 客製刻印選項 + x數量),所以光靠 PDF 也分得出品項。
// 注意:這條路沒有商品編號,所以 CODE_ALIASES(同商品不同編號)那類規則用不上,
// 純文字比對。要分得更準就載入 LINE 訂單總表,程式會自動改走原本那條路。

// 備註結束的位置:買家買了幾個會印成「- x1」,後面接的是黑貓自己的版面文字。
// 比對前會把空白全部拿掉(pdf.js 會把「備註」切成「備」「註」兩段,不先拿掉就比不到),
// 所以這裡的 pattern 也是以「沒有空白」為前提寫的。
const NOTE_STOP = "(?:-?x\\d+|客戶代號|訂單編號|客戶專線|ymt)";

// 規格設定裡的欄位名。粗分組時截到第一個欄位名之前 = 只留品項名。
// 用固定清單而不是「任意兩到四個中文字 + 冒號」,因為後者會切在詞中間
// (「繽紛好運精油組規格:」會被切成「繽紛好運精」)。賣場加新選項時補進來。
const NOTE_FIELDS = new RegExp(
  "(?:天然精油|其他刻字|刻印文字|選擇[\\u4e00-\\u9fff]{0,3}|加購[\\u4e00-\\u9fff]{0,4}" +
  "|規格|顏色|星座|款式|口味|尺寸|精油|金運|招福|花色|蠟燭|數量)\\s*:");

const ZODIAC_NAMES = ["牡羊", "金牛", "雙子", "巨蟹", "獅子", "處女",
                      "天秤", "天蠍", "射手", "摩羯", "水瓶", "雙魚"];

// 有訂單總表時,這幾組是靠商品編號(CODE_ALIASES)和分類規則合併的,
// 純文字看不出來,所以這裡用關鍵字補上,結果才會跟有總表時一致:
//   雷雕   —— 不管是什麼商品、什麼尺寸,撿完都送去同一個雷雕站,一律同一組
//   精油組 —— 禮盒版寫「+精油禮盒」、一般版寫「繽紛好運精油組」,是同一個實體商品
// 賣場上架新的同義寫法時補進這個表。
const PDF_ALIAS_RULES = [
  { test: /雷雕|刻印/, label: "雷雕客製刻印(不分商品/尺寸)", keepSize: false },
  { test: /繽紛好運精油組|精油禮盒/, label: "精油組", keepSize: true },
];

function extractSizeTag(s) {
  const m = s.match(/[(（]\s*(小|中|大)\s*[)）]/);
  return m ? m[1] : "";
}

// pdf.js 給的是「繪製順序」,不是閱讀順序 —— 這份託運單會把欄位標籤一次畫完
// (品名、備註、代收款…),數值另外畫,所以直接在文字流裡找「備註」後面接到的
// 會是別欄的字。要照座標把同一列的片段重新拼回去(pdfplumber 就是這樣做的),
// 標籤才會跟它自己的值配在一起。
function buildPageLines(items) {
  calibrateFonts(items);
  const rows = new Map();
  items.forEach(it => {
    const y = Math.round((it.transform ? it.transform[5] : 0) / 3) * 3;   // 容差 3pt
    const x = it.transform ? it.transform[4] : 0;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: x, s: decodeWithShifts(it.str, shiftsFor(it.fontName)) });
  });
  return Array.from(rows)
    .sort((a, b) => b[0] - a[0])                       // 由上而下
    .map(pair => pair[1].sort((a, b) => a.x - b.x).map(o => o.s).join(""));
}

// 從重建好的行裡挖備註:找到含「備註」的那一行,取標籤後面的字,
// 備註太長會折到下一行,所以往下接到看見「x數量」為止。
function extractNoteFromLines(lines) {
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf("備註");
    if (idx < 0) continue;
    // 標籤後面那個冒號有時是沒被解出來的字,所以不用冒號當依據,直接跳過標籤
    let buf = lines[i].slice(idx + 2);
    for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {
      if (new RegExp(NOTE_STOP).test(buf)) break;
      buf += lines[k];
    }
    const m = buf.replace(/\s+/g, "").match(new RegExp("^([\\s\\S]*?)" + NOTE_STOP));
    return m ? m[1] : buf.replace(/\s+/g, "").slice(0, 60);
  }
  return "";
}

// 正規化:PDF 會在字中間插空白(「加 購」),全部拿掉;全形標點統一;
// 加購選項不影響要撿哪個貨(同一個顏色不該因為加購不同被拆成好幾組),先濾掉
function normalizeNote(s) {
  let t = String(s).replace(/\s+/g, "")
    .replace(/：/g, ":").replace(/，/g, ",").replace(/、/g, ",");
  t = t.replace(/^[:,.\-–—\s]+/, "");     // 標籤後面那個冒號會跟著被切進來
  t = t.replace(/\+?加購[^:]{0,6}:[^,]*/g, "");
  return t.replace(/[,.\-–—]+$/, "").trim();
}

// 細分組 key:完整備註(同品項不同顏色/規格會各自一組)
function noteKeyFine(note) { return note; }

// 粗分組 key:只留品項名,再補上兩個「撿貨一定要分開」的差異:
//   星座 —— 同一個星座才算同一組(星座可能寫在品名裡,也可能在「星座:」欄位)
//   金運/招福 —— 是不同的公仔,實體長得不一樣,不能混撿
function noteKeyCoarse(note) {
  // 先看有沒有命中「靠商品編號合併」的那幾組(雷雕、精油組),有的話直接用固定名稱,
  // 不再往下接星座/金運招福 —— 有訂單總表時這幾組本來就不分那些
  for (let i = 0; i < PDF_ALIAS_RULES.length; i++) {
    const rule = PDF_ALIAS_RULES[i];
    if (!rule.test.test(note)) continue;
    const size = rule.keepSize ? extractSizeTag(note) : "";
    return size ? rule.label + "(" + size + ")" : rule.label;
  }

  const m = note.match(NOTE_FIELDS);
  let base = (m ? note.slice(0, m.index) : note).replace(/[,.\-–—+]+$/, "").trim();
  if (!base) base = note;

  const mz = note.match(/星座:([一-鿿]{2})座?/);
  if (mz && ZODIAC_NAMES.indexOf(mz[1]) >= 0) {
    const z = mz[1] + "座";
    if (base.indexOf(z) < 0) base = z + base;
  }

  const styles = ["金運", "招福"];
  for (let i = 0; i < styles.length; i++) {
    const st = styles[i];
    const hit = new RegExp("(?:規格|款式)[^,]*" + st).test(note) ||
                new RegExp("[【\\[]" + st).test(note);
    if (hit) {
      if (base.indexOf(st) < 0) base = base + "-" + st;
      break;
    }
  }
  return base;
}

async function handleZonedPdf(file) {
  setStatus("zonedStatus", "loading", "載入 PDF 函式庫…");
  try {
    await ensurePdfLibs();
    const buf = await file.arrayBuffer();
    // pdf.js 會把傳進去的 ArrayBuffer 吃掉(detach),所以另外留一份給 pdf-lib
    zonedPdfBytes = new Uint8Array(buf.slice(0));

    setStatus("zonedStatus", "loading", "解析託運單…");
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

    zonedPdfPages = [];
    zonedPdfByOrder = new Map();
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = decodePageText(tc.items);
      const lines = buildPageLines(tc.items);
      const orderId = extractOrderIdFromLines(lines, text);
      const note = normalizeNote(extractNoteFromLines(lines));
      zonedPdfPages.push({
        index: i - 1, orderId: orderId, trackNo: extractTrackNo(text),
        note: note, keyCoarse: noteKeyCoarse(note), keyFine: noteKeyFine(note),
      });
      if (orderId) {
        if (!zonedPdfByOrder.has(orderId)) zonedPdfByOrder.set(orderId, []);
        zonedPdfByOrder.get(orderId).push(i - 1);
      }
      if (i % 20 === 0) setStatus("zonedStatus", "loading", "解析託運單… " + i + "/" + doc.numPages);
    }

    zonedPdfSrcDoc = await PDFLib.PDFDocument.load(zonedPdfBytes);
    zonedPdfName = file.name;

    renderZonedPdfSummary();
    refreshZonedListsForPdf();

    const noId = zonedPdfPages.filter(p => !p.orderId).length;
    let msg = "✓ 已讀取 " + zonedPdfPages.length + " 頁託運單";
    if (noId > 0) msg += ",其中 " + noId + " 頁抓不到訂單編號";
    // 沒載訂單總表時改用託運單自己的「備註」分組,不是分不了組
    if (!zonedHasOrders()) {
      const noNote = zonedPdfPages.filter(p => !p.note).length;
      const n = zonedPdfBuildNoteGroups().own.length;
      let m2 = msg + " · 用託運單的備註分成 " + n + " 組";
      if (noNote > 0) m2 += "(" + noNote + " 頁抓不到備註)";
      setStatus("zonedStatus", noNote > 0 ? "warn" : "success", m2);
    } else {
      setStatus("zonedStatus", noId > 0 ? "warn" : "success", msg);
    }
  } catch (e) {
    zonedPdfBytes = null; zonedPdfSrcDoc = null;
    zonedPdfPages = []; zonedPdfByOrder = new Map();
    renderZonedPdfSummary();
    setStatus("zonedStatus", "error", "✗ PDF 讀取失敗:" + e.message);
    console.error(e);
  }
}

// 載入 PDF 後清單上要多出「⬇ 託運單」按鈕,所以重畫一次(清單本身的內容不變)
function refreshZonedListsForPdf() {
  if (typeof zonedGroupsCache !== "undefined" && zonedGroupsCache) {
    renderZonedGroupList(zonedGroupsCache);
  }
  if (typeof zonedMergedRowsCache !== "undefined" && zonedMergedRowsCache) {
    renderZonedMergedBlock(zonedMergedRowsCache, getZonedOptions().threshold);
  }
}

function zonedPdfReady() { return !!zonedPdfSrcDoc && zonedPdfPages.length > 0; }

function zonedHasOrders() {
  return typeof loadedRows !== "undefined" && !!loadedRows && loadedRows.length > 0;
}

// 一組訂單 → 要抽哪幾頁。頁序照訂單在組內的順序(也就是撿貨順序),
// 找不到託運單的訂單另外回報,不靜靜吞掉。
function pagesForRows(rows) {
  const pages = [];
  const missing = [];
  const seen = new Set();
  (rows || []).forEach(r => {
    const id = String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim();
    const hit = zonedPdfByOrder.get(id);
    if (!hit || hit.length === 0) { missing.push(id); return; }
    hit.forEach(p => { if (!seen.has(p)) { seen.add(p); pages.push(p); } });
  });
  return { pages: pages, missing: missing };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function savePagesAsPdf(pageIndexes, filename) {
  const out = await PDFLib.PDFDocument.create();
  const copied = await out.copyPages(zonedPdfSrcDoc, pageIndexes);
  copied.forEach(p => out.addPage(p));
  const bytes = await out.save();
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), filename);
}

// 清單上每一列的「⬇ 託運單」按鈕(沒載 PDF 就不顯示,避免按了才說沒資料)
function zonedPdfGroupButton(kind, idx) {
  if (!zonedPdfReady()) return "";
  return '<button class="btn btn-lavender btn-small" onclick="downloadZonedGroupPdf(\'' +
         kind + '\', ' + idx + ')">⬇ 託運單</button>';
}

async function downloadZonedGroupPdf(kind, idx) {
  if (!zonedPdfReady()) { setStatus("zonedStatus", "warn", "請先選擇黑貓託運單 PDF"); return; }
  const g = kind === "merged"
    ? { label: "其他合併", rows: zonedMergedRowsCache }
    : zonedGroupsCache[idx];
  if (!g || !g.rows || g.rows.length === 0) return;

  try {
    const r = pagesForRows(g.rows);
    if (r.pages.length === 0) {
      setStatus("zonedStatus", "warn", "「" + g.label + "」這組在 PDF 裡找不到任何託運單");
      return;
    }
    await savePagesAsPdf(r.pages, "託運單_" + sanitizeFilenamePart(g.label) + ".pdf");
    let msg = "✓ 已下載「" + g.label + "」託運單 " + r.pages.length + " 頁";
    if (r.missing.length > 0) msg += " · ⚠ " + r.missing.length + " 筆訂單在 PDF 裡沒有對應的單";
    setStatus("zonedStatus", r.missing.length > 0 ? "warn" : "success", msg);
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 託運單下載失敗:" + e.message);
    console.error(e);
  }
}

// 目前清單上每一組各出一個 PDF 檔;瀏覽器對「連續觸發下載」很敏感,所以中間留間隔
async function downloadAllZonedPdfs() {
  if (!zonedPdfReady()) { setStatus("zonedStatus", "warn", "請先選擇黑貓託運單 PDF"); return; }
  if (!zonedHasOrders()) { return downloadAllNoteGroupPdfs(); }

  const jobs = [];
  (zonedGroupsCache || []).forEach(g => jobs.push({ label: g.label, rows: g.rows }));
  if (zonedMergedRowsCache && zonedMergedRowsCache.length > 0) {
    jobs.push({ label: "其他合併", rows: zonedMergedRowsCache });
  }
  zonedPdfExtraBuckets().forEach(b => jobs.push(b));

  if (jobs.length === 0) { setStatus("zonedStatus", "warn", "目前沒有可下載的組別"); return; }

  let files = 0, pageTotal = 0, missTotal = 0;
  try {
    for (const job of jobs) {
      const r = job.pageIndexes
        ? { pages: job.pageIndexes, missing: [] }
        : pagesForRows(job.rows);
      missTotal += r.missing.length;
      if (r.pages.length === 0) continue;
      await savePagesAsPdf(r.pages, "託運單_" + sanitizeFilenamePart(job.label) + ".pdf");
      files++;
      pageTotal += r.pages.length;
      await new Promise(res => setTimeout(res, 300));
    }
    let msg = "✓ 已下載 " + files + " 個託運單 PDF,共 " + pageTotal + " 頁";
    if (missTotal > 0) msg += " · ⚠ " + missTotal + " 筆訂單找不到對應的託運單";
    setStatus("zonedStatus", missTotal > 0 ? "warn" : "success", msg);
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 批次下載失敗:" + e.message);
    console.error(e);
  }
}

// 分區清單裝不下的頁另外歸類,不能讓它們消失:
//   1. 訂單表裡有、但被分區排除的(黑熊/盆景公仔組/離島)→ 依類別各出一檔
//   2. 訂單表裡根本找不到的 → 「未對應」一檔,連同抓不到訂單編號的頁
function zonedPdfExtraBuckets() {
  const inZoned = new Set();
  (zonedGroupsCache || []).forEach(g => (g.rows || []).forEach(
    r => inZoned.add(String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim())));
  (zonedMergedRowsCache || []).forEach(
    r => inZoned.add(String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim()));

  const rowByOrder = new Map();
  (typeof loadedRows !== "undefined" && loadedRows ? loadedRows : []).forEach(
    r => rowByOrder.set(String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim(), r));

  const byLabel = new Map();
  zonedPdfPages.forEach(p => {
    if (p.orderId && inZoned.has(p.orderId)) return;
    const row = p.orderId ? rowByOrder.get(p.orderId) : null;
    let label = "未對應";
    if (row) label = row["_離島"] ? "離島郵局" : (row["_類別"] || "未分類");
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(p.index);
  });

  return Array.from(byLabel, ([label, pageIndexes]) => ({
    label: label, pageIndexes: pageIndexes, rows: [],
  }));
}

function renderZonedPdfSummary() {
  const el = document.getElementById("zonedPdfSummary");
  if (!el) return;
  if (!zonedPdfReady()) { el.innerHTML = ""; return; }

  const rows = (typeof loadedRows !== "undefined" && loadedRows) ? loadedRows : [];
  const known = new Set(rows.map(r => String(r["訂單編號"] == null ? "" : r["訂單編號"]).trim()));
  const matched = zonedPdfPages.filter(p => p.orderId && known.has(p.orderId)).length;
  const unmatched = zonedPdfPages.length - matched;

  if (!zonedHasOrders()) { renderZonedPdfOnly(el); return; }

  const extras = zonedPdfExtraBuckets().map((b, i) =>
    '<button class="btn btn-secondary btn-small" onclick="downloadZonedExtraPdf(' + i + ')">⬇ ' +
    escapeHtml(b.label) + "(" + b.pageIndexes.length + " 頁)</button>").join("");

  el.innerHTML =
    '<div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 12px;">' +
      '<div class="stat-card lavender">' +
        '<div class="stat-label">託運單頁數</div>' +
        '<div><span class="stat-number">' + zonedPdfPages.length + '</span><span class="stat-unit">頁</span></div>' +
        '<div class="stat-sub">' + escapeHtml(zonedPdfName) + '</div>' +
      '</div>' +
      '<div class="stat-card green">' +
        '<div class="stat-label">對到今天訂單</div>' +
        '<div><span class="stat-number">' + matched + '</span><span class="stat-unit">頁</span></div>' +
        '<div class="stat-sub">用訂單編號比對</div>' +
      '</div>' +
      '<div class="stat-card ' + (unmatched > 0 ? "orange" : "gray") + '">' +
        '<div class="stat-label">沒對到</div>' +
        '<div><span class="stat-number">' + unmatched + '</span><span class="stat-unit">頁</span></div>' +
        '<div class="stat-sub">會歸到下面的分類檔,不會漏掉</div>' +
      '</div>' +
    '</div>' +
    '<div class="actions" style="margin-bottom: 0;">' +
      '<button class="btn btn-lavender" onclick="downloadAllZonedPdfs()" ' +
      'title="清單上每一組各出一個 PDF 檔">▶ 全部下載託運單(每組一檔)</button>' +
      extras +
    '</div>';
}

// ===================================================================
// 只有 PDF 時的分組清單(沒有訂單總表)
// ===================================================================
let zonedPdfNoteMode = "coarse";   // coarse=只到品項名 / fine=含顏色規格

function setZonedNoteMode(mode) {
  zonedPdfNoteMode = mode === "fine" ? "fine" : "coarse";
  renderZonedPdfSummary();
}

// 依備註分組。跟訂單總表那條路一樣套「合併門檻」:
// 數量沒超過門檻的品項全部併成一份「其他合併」,不然一天會印出一堆只有一頁的檔。
function zonedPdfBuildNoteGroups() {
  const threshold = getZonedOptions().threshold;
  const map = new Map();
  zonedPdfPages.forEach(p => {
    const key = (zonedPdfNoteMode === "fine" ? p.keyFine : p.keyCoarse) || "(沒有備註)";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p.index);
  });

  const own = [];
  let mergedPages = [];
  Array.from(map).forEach(([label, pages]) => {
    if (pages.length > threshold) own.push({ label: label, pages: pages });
    else mergedPages = mergedPages.concat(pages.map(x => ({ label: label, page: x })));
  });

  own.sort((a, b) => b.pages.length - a.pages.length || a.label.localeCompare(b.label));
  // 併單裡面同品項的頁還是要排在一起,撿貨才不用在一疊裡跳來跳去
  mergedPages.sort((a, b) => a.label.localeCompare(b.label) || a.page - b.page);

  return {
    own: own,
    mergedPages: mergedPages.map(x => x.page),
    threshold: threshold,
    distinct: map.size,
  };
}

function renderZonedPdfOnly(el) {
  const g = zonedPdfBuildNoteGroups();
  const noNote = zonedPdfPages.filter(p => !p.note).length;

  const rows = g.own.map((grp, i) =>
    '<div class="problem-item">' +
      '<div class="problem-item-main">' +
        '<div class="problem-item-row1"><span class="pi-id">' + escapeHtml(grp.label) + '</span></div>' +
        '<div style="font-size: 13px; color: var(--text); font-weight: 600; margin-top: 4px;">' +
          grp.pages.length + ' 頁託運單</div>' +
      '</div>' +
      '<button class="btn btn-lavender btn-small" onclick="downloadNoteGroupPdf(' + i + ')">⬇ 託運單</button>' +
    '</div>').join("");

  const mergedRow = g.mergedPages.length === 0 ? "" :
    '<div class="problem-item">' +
      '<div class="problem-item-main">' +
        '<div class="problem-item-row1"><span class="pi-id">其他合併</span></div>' +
        '<div style="font-size: 13px; color: var(--text-dim); margin-top: 4px;">' +
          g.mergedPages.length + ' 頁 · 數量沒超過門檻(' + g.threshold + ')的品項,同品項的頁會排在一起</div>' +
      '</div>' +
      '<button class="btn btn-lavender btn-small" onclick="downloadNoteMergedPdf()">⬇ 託運單</button>' +
    '</div>';

  const modeBtn = (mode, text) =>
    '<button class="btn ' + (zonedPdfNoteMode === mode ? "btn-primary" : "btn-secondary") +
    ' btn-small" onclick="setZonedNoteMode(\'' + mode + '\')">' + text + '</button>';

  el.innerHTML =
    '<div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 12px;">' +
      '<div class="stat-card lavender">' +
        '<div class="stat-label">託運單頁數</div>' +
        '<div><span class="stat-number">' + zonedPdfPages.length + '</span><span class="stat-unit">頁</span></div>' +
        '<div class="stat-sub">' + escapeHtml(zonedPdfName) + '</div>' +
      '</div>' +
      '<div class="stat-card green">' +
        '<div class="stat-label">分出品項</div>' +
        '<div><span class="stat-number">' + g.distinct + '</span><span class="stat-unit">組</span></div>' +
        '<div class="stat-sub">其中 ' + g.own.length + ' 組超過門檻各自出檔' +
          (g.mergedPages.length > 0 ? ",其餘併成 1 檔" : "") +
          ';門檻設 1 就每組都獨立</div>' +
      '</div>' +
      '<div class="stat-card ' + (noNote > 0 ? "orange" : "gray") + '">' +
        '<div class="stat-label">抓不到備註</div>' +
        '<div><span class="stat-number">' + noNote + '</span><span class="stat-unit">頁</span></div>' +
        '<div class="stat-sub">會併進「其他合併」,不會漏掉</div>' +
      '</div>' +
    '</div>' +
    '<div class="stats-header">' +
      '<span class="stats-title">依備註分組(沒載訂單總表時)</span>' +
      '<span style="margin-left: auto; display: flex; gap: 6px;">' +
        modeBtn("coarse", "依品項") + modeBtn("fine", "依品項+顏色") +
      '</span>' +
      '<button class="btn btn-lavender btn-small" onclick="downloadAllNoteGroupPdfs()">⬇ 全部下載</button>' +
    '</div>' +
    '<p class="hint" style="margin: 0 0 10px;">' +
      '沒有訂單總表時,改用託運單上印的「備註」(品項描述)分組。' +
      '載入 LINE 訂單總表會自動改走原本那條路,能多用到商品編號、別名、尺寸那些規則,分得更準。' +
    '</p>' +
    '<div class="problem-list">' + rows + mergedRow + '</div>';
}

async function downloadNoteGroupPdf(i) {
  const g = zonedPdfBuildNoteGroups();
  const grp = g.own[i];
  if (!grp) return;
  try {
    await savePagesAsPdf(grp.pages, "託運單_" + sanitizeFilenamePart(grp.label) + ".pdf");
    setStatus("zonedStatus", "success", "✓ 已下載「" + grp.label + "」" + grp.pages.length + " 頁");
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 下載失敗:" + e.message);
    console.error(e);
  }
}

async function downloadNoteMergedPdf() {
  const g = zonedPdfBuildNoteGroups();
  if (g.mergedPages.length === 0) return;
  try {
    await savePagesAsPdf(g.mergedPages, "託運單_其他合併.pdf");
    setStatus("zonedStatus", "success", "✓ 已下載「其他合併」" + g.mergedPages.length + " 頁");
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 下載失敗:" + e.message);
    console.error(e);
  }
}

async function downloadAllNoteGroupPdfs() {
  const g = zonedPdfBuildNoteGroups();
  const jobs = g.own.slice();
  if (g.mergedPages.length > 0) jobs.push({ label: "其他合併", pages: g.mergedPages });
  if (jobs.length === 0) { setStatus("zonedStatus", "warn", "目前沒有可下載的組別"); return; }

  let files = 0, pageTotal = 0;
  try {
    for (const job of jobs) {
      await savePagesAsPdf(job.pages, "託運單_" + sanitizeFilenamePart(job.label) + ".pdf");
      files++;
      pageTotal += job.pages.length;
      await new Promise(res => setTimeout(res, 300));
    }
    setStatus("zonedStatus", "success",
      "✓ 已下載 " + files + " 個託運單 PDF,共 " + pageTotal + " 頁");
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 批次下載失敗:" + e.message);
    console.error(e);
  }
}

async function downloadZonedExtraPdf(i) {
  const b = zonedPdfExtraBuckets()[i];
  if (!b) return;
  try {
    await savePagesAsPdf(b.pageIndexes, "託運單_" + sanitizeFilenamePart(b.label) + ".pdf");
    setStatus("zonedStatus", "success", "✓ 已下載「" + b.label + "」" + b.pageIndexes.length + " 頁");
  } catch (e) {
    setStatus("zonedStatus", "error", "✗ 下載失敗:" + e.message);
    console.error(e);
  }
}
