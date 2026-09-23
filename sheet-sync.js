// ===================================================================
// 試算表網址(全部寫死,不再開放設定/不再存 localStorage)
// 這些只是給統計字卡「點擊 → 開啟試算表」用的,實際寫入是後端 Apps Script 在做。
// 問題訂單 2026-09-17 起改存 D1,所以這裡已經沒有它了。
// ===================================================================
const SHEET_URLS = {
  "雷雕":       "https://docs.google.com/spreadsheets/d/1yWvDnbI9w1ukexlaZWNAOyPHUS7JKMgGIDPV83wlSQ8/edit",
  "黑熊":       "https://docs.google.com/spreadsheets/d/1SVuzdacjbJrX82pIRkkdB7B1kD3pF9nggkynzxzUTII/edit",
  "永生花":     "https://docs.google.com/spreadsheets/d/1ihfosKQwK8B9IA1768tHEACykPxHuTgzqd26kkA2YwM/edit",
  "注意品項":   "https://docs.google.com/spreadsheets/d/1dPGbWNIcslooHOkYtwIPc-moh88z1UR0aA1gTwZ-prU/edit",
  "盆景公仔組": "https://docs.google.com/spreadsheets/d/1hhx_HqK9m9XUxKQlGXcRYdY20Qpfg_zN9vTJW1U44Ts/edit",
  "離島•郵局":  OFFSHORE_SHEET_URL,
  "包裹退貨":   "https://docs.google.com/spreadsheets/d/1bMPA6GQ-tVaju85BFm9ETHOuG6hfGjPQfsDLtTWcEnk/edit",
};

function getSheetUrl(category) {
  return SHEET_URLS[category] || "";
}

function openSheet(category) {
  const url = getSheetUrl(category);
  if (url) window.open(url, "_blank");
}

function openReturnsSheet() {
  openSheet("包裹退貨");
}

// 點「未結案退貨」字卡 → 切到未結案篩選籤,並捲動到清單
function filterReturnsToOpen() {
  const el = document.querySelector('input[name="returnFilter"][value="open"]');
  if (el) el.checked = true;
  renderReturnList();
  document.getElementById("returnList")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 點「問題訂單」字卡 → 捲到下面的清單(以前是開試算表,現在資料在 D1)
function scrollToProblemList() {
  switchTab("problems");
  document.getElementById("problemList")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ===================================================================
// 深/淺色模式
// ===================================================================
// 只存在這台瀏覽器(localStorage),預設深色。
// 真正套用主題的那行在 index.html <head> 裡,要在畫面畫出來之前跑,不然會閃一下白底。
const THEME_KEY = "niyan_theme";

function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch (_) {
    return "dark";
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
}

function setTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  applyTheme(t);
  try { localStorage.setItem(THEME_KEY, t); } catch (_) { /* 無痕模式寫不進去就算了 */ }
  syncThemeButtons();
}

function syncThemeButtons() {
  const cur = getTheme();
  document.querySelectorAll("[data-theme-choice]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === cur);
  });
}

// ===================================================================
// 設定(現在只剩外觀)
// ===================================================================
const GS_URL = "/api";

function openSettings() {
  syncThemeButtons();
  document.getElementById("settingsModal").classList.add("show");
}
function closeSettings() { document.getElementById("settingsModal").classList.remove("show"); }

function getGsUrl() { return GS_URL; }

// ===================================================================
// 一鍵上傳分類訂單(雷雕/黑熊/永生花/注意品項/盆景)到廠商試算表
// ===================================================================
function uploadAllToSheet() {
  if (!loadedRows) return;
  const url = getGsUrl();
  if (!url) {
    setStatus("status", "warn", "⚠ 尚未設定 Apps Script 網址,請先點「⚙ 設定」");
    openSettings();
    return;
  }

  const today = todayStr("/");
  const targets = {};
  let totalCount = 0;

  UPLOAD_CATEGORIES.forEach(cat => {
    // 用完整命中清單比對,一筆訂單如果同時符合兩個分類(例如巨物+雷雕),
    // 兩邊廠商試算表都要收到這筆
    const catRows = loadedRows.filter(r => (r["_類別列表"] || []).includes(cat));
    if (catRows.length > 0) {
      targets[cat] = catRows.map(r => {
        const base = {
          date: today,
          name: r["收件人姓名"] ?? "",
          address: r["配送地址"] ?? "",
          phone: r["收件人聯絡電話"] ?? "",
          note: r["_備註"],
          orderId: r["訂單編號"] ?? "",
        };
        if (cat === "永生花") {
          // 永生花拆成黃金運 / 粉招福兩欄(由「規格設定」判斷裡面公仔的顏色)
          const qty = parseInt(r["數量"], 10) || 1;
          const spec = String(r["規格設定"] ?? "");
          let goldQty = 0, pinkQty = 0;
          if (spec.includes("黃金運")) goldQty = qty;
          else if (spec.includes("粉招福") || spec.includes("粉招") || spec.includes("粉福")) pinkQty = qty;
          else goldQty = qty;  // 都不符合就放黃金運欄,至少不掉資料
          base.goldQty = goldQty;
          base.pinkQty = pinkQty;
        } else {
          base.qty = r["數量"] ?? 1;
        }
        return base;
      });
      totalCount += catRows.length;
    }
  });

  // 離島•郵局:地址含離島縣市的訂單,獨立於商品分類之外,額外上傳到離島包裹試算表
  const offshoreRows = loadedRows.filter(r => r["_離島"]);
  if (offshoreRows.length > 0) {
    targets["離島•郵局"] = offshoreRows.map(r => ({
      date: today,
      name: r["收件人姓名"] ?? "",
      address: r["配送地址"] ?? "",
      phone: r["收件人聯絡電話"] ?? "",
      note: "",
      orderId: r["訂單編號"] ?? "",
      qty: r["數量"] ?? 1,
      island: r["_離島"],
    }));
    totalCount += offshoreRows.length;
  }

if (totalCount === 0) {
  // 沒有分類訂單，但還是要上傳一般訂單數
  uploadLineRegular();
  return;
}

  const catSummary = Object.entries(targets).map(([c, rs]) => `${c} ${rs.length}`).join(" · ");
  setStatus("status", "loading", `上傳中(${catSummary})…`);
  document.getElementById("uploadBtn").disabled = true;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "append",
      targets,
      // 離島那批逐筆的品項(含訂單編號,後端要拿來去重),一起送去包貨「離島•郵局」字卡
      offshoreItems: buildOffshoreItems(offshoreRows),
    }),
  })
    .then(r => r.json())
.then(data => {
      console.log("[一鍵上傳回應]", data);   // 出問題時 F12 主控台看得到後端原始回報
      // 包貨字卡跟試算表是兩套系統,分開回報:試算表掛了不代表字卡沒進去(反之亦然)
      const packing = describeOffshoreSync(data);
      if (data.ok) {
        const breakdown = Object.entries(data.results || {})
          .map(([c, r]) => (r.ok ? `${c} ${r.count}` : `${c} 試算表失敗(${r.error || "未知錯誤"})`))
          .join(" · ");
        const summary = `✓ 已上傳 ${data.totalWritten} 筆 · ${breakdown}${packing}`;
        setStatus("status", "success", summary);
        // 把這段當前綴傳下去 —— 不然 Line禮物 那行馬上就把它蓋掉,
        // 離島字卡到底有沒有進去、試算表哪一類失敗,全都看不到
        uploadLineRegular(summary + " · ");
      } else {
        // 試算表整包失敗也要繼續送 Line禮物件數 —— 那張卡根本不經過試算表,
        // 以前一起卡住,包貨看板就整天缺一塊
        const msg = `✗ 試算表上傳失敗:${data.error || "未知錯誤"}${packing}`;
        setStatus("status", "error", msg);
        uploadLineRegular(msg + " · ");
      }
    })
    .catch(err => {
      setStatus("status", "error", `✗ 上傳失敗:${err.message}`);
    })
    .finally(() => {
      document.getElementById("uploadBtn").disabled = false;
    });
}


// 字卡明細:照「品項 + 款式」統計,一個款式一行。
// 以前送的是分區列印的分組結果(有合併門檻),字卡上會出現「其他合併 10」「雷雕客製刻印
// (不分商品/尺寸) 7」這種看不出要撿什麼的行 —— 那套是為了「少印幾張出貨單」而合併,
// 不是為了看統計。這裡改成純統計:不套門檻、不合併,每個品項款式各自一行。
//
// 款式後綴沿用分區列印那套判斷(星座 / 尺寸 / 金運招福 / 招財黃 / 一對),不直接拿
// 「規格設定」全文當 key —— 那裡面還有加購、緞帶顏色這種跟撿貨無關的選項,
// 一起比對會炸成幾十行看不完。
// 統計用的品項名:cleanProductName 之後再把【行銷標語】整段拿掉。
// 同一個實體商品常常開好幾個賣場標題(【雷雕】/【生日送禮首選】/【辦公室語錄】…),
// 統計卡上應該併成同一行;要不要雷雕是撿貨真的在乎的差異,改用後綴標,不靠標題。
function pickStatName(row) {
  // 星座貓每個星座都是獨立的賣場標題(「處女座星座貓+元寶」「星座貓 處女座 天秤座」…),
  // 星座已經用後綴標了,名稱一律收斂成「星座貓」,同一個星座才不會被標題拆成好幾行
  if (isZodiacCat(row)) return "星座貓";
  const s = cleanProductName(row["商品名稱"])
    .replace(/[【\[][^】\]]*[】\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || cleanProductName(row["商品名稱"]) || "未命名商品";
}

function pickStatLabel(row) {
  const name = pickStatName(row);
  const parts = [];
  const zodiac = zodiacGroupSuffix(row);
  if (zodiac) parts.push(zodiac);
  const size = sizeGroupSuffix(row);
  if (size) parts.push(size);
  // 名稱本身就寫了「一對」就不用再標一次
  if (isPangpangPair(row) && !name.includes("一對")) parts.push("一對");
  // styleOrder: 0=金運 1=招福 2=看不出來 —— 看不出來的品項(例如禮盒、植物盆)就不要硬加後綴
  if (typeof styleOrder === "function" && styleOrder(row) !== 2) parts.push(styleGroupSuffix(row));
  if (isGoldYellowCat(row)) parts.push("招財黃");
  if (isLaserItem(row)) parts.push("雷雕");
  return parts.length ? `${name}(${parts.join(" ")})` : name;
}

// 把訂單列統計成 [{品項, 件數}],依品項名排序(同一個商品的不同款式會排在一起)
function tallyByItemStyle(rows) {
  const map = new Map();
  rows.forEach(r => {
    const label = pickStatLabel(r);
    map.set(label, (map.get(label) || 0) + (parseInt(r["數量"], 10) || 1));
  });
  return [...map]
    .map(([品項, 件數]) => ({ "品項": 品項, "件數": 件數 }))
    .sort((a, b) => a["品項"].localeCompare(b["品項"], "zh-Hant"));
}

// 上傳 Line禮物件數時一起送過去的品項統計(跟件數同一批訂單:扣掉黑熊/盆景/離島)
function buildPickingSummary() {
  if (!loadedRows) return null;
  try {
    const list = tallyByItemStyle(getZonedExportRows(loadedRows));
    return list.length ? list : null;
  } catch (e) {
    // 明細只是附帶資訊,算不出來也不該擋住件數上傳
    console.warn("品項統計計算失敗,這次不送明細:", e);
    return null;
  }
}

// 離島那批:逐筆送「訂單編號 + 品項 + 件數」,不先加總。
// 後端要靠訂單編號去重(同一天同一張單重複上傳只算一次),所以明細也得跟著訂單編號走,
// 不然重複上傳時件數沒加、明細卻又加一次,兩邊會對不起來。
function buildOffshoreItems(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  try {
    return rows.map(r => ({
      "訂單編號": String(r["訂單編號"] ?? "").trim(),
      "品項": pickStatLabel(r),
      "件數": parseInt(r["數量"], 10) || 1,
    }));
  } catch (e) {
    console.warn("離島品項統計計算失敗,這次不送明細:", e);
    return null;
  }
}

// 把後端回報的「離島字卡同步結果」翻成一句人看得懂的話
function describeOffshoreSync(data) {
  const ps = data && data.packingSync;
  if (!ps) return "";
  if (!ps.ok) return ` · ✗ 包貨離島字卡沒進去:${ps.error || "未知錯誤"}`;
  if (ps.skipped) return ` · 包貨離島字卡:這 ${ps.duplicated || 0} 張今天已經同步過,沒重複加`;
  const dup = ps.duplicated ? `,另 ${ps.duplicated} 張今天已同步過` : "";
  return ` · ✓ 包貨離島字卡 +${ps.added || 0} 件(今日共 ${ps.total || 0})${dup}`;
}

  function uploadLineRegular(prefix) {
  const pre = prefix || "";
  if (!lastStats) return;
  const url = getGsUrl();
  if (!url) return;
  const count = lastStats.regular;
  if (count <= 0) return;
  const today = todayStr("-");
  const btn = document.getElementById("uploadBtn");
  if (btn) { btn.disabled = true; }
  setStatus("status", "loading", `${pre}上傳中(Line禮物)…`);

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "uploadLineRegular",
      date: today,
      count: count,
      picking: buildPickingSummary()
    })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const msg = data.updated
          ? `${pre}✓ 已上傳，Line禮物 今日累計 ${data.total} 筆`
          : `${pre}✓ 已上傳，Line禮物 今日 ${data.total} 筆`;
        setStatus("status", "success", msg);
      } else {
        setStatus("status", "error", `${pre}✗ Line禮物上傳失敗：${data.error || "未知錯誤"}`);
      }
    })
    .catch(err => setStatus("status", "error", `${pre}✗ Line禮物上傳失敗：${err.message}`))
    .finally(() => {
      if (btn) { btn.disabled = false; }
    });
}
