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
      // 離島那批的撿貨分組,一起送去包貨系統的「離島•郵局」字卡(沒有離島就是 null)
      offshorePicking: buildOffshorePickingSummary(offshoreRows),
    }),
  })
    .then(r => r.json())
.then(data => {
      if (data.ok) {
        const breakdown = Object.entries(data.results || {})
          .map(([c, r]) => {
            if (!r.ok) return `${c} 失敗(${r.error})`;
            let s = `${c} ${r.count}`;
            if (r.packingSync) {
              s += r.packingSync.ok ? "(已同步包貨郵局)" : `(包貨同步失敗:${r.packingSync.error || "未知錯誤"})`;
            }
            return s;
          })
          .join(" · ");
        setStatus("status", "success", `✓ 已上傳 ${data.totalWritten} 筆 · ${breakdown}`);
        uploadLineRegular();  // ← 加這行
      } else {
        setStatus("status", "error", `✗ 上傳失敗:${data.error || "未知錯誤"}`);
      }
    })
    .catch(err => {
      setStatus("status", "error", `✗ 上傳失敗:${err.message}`);
    })
    .finally(() => {
      document.getElementById("uploadBtn").disabled = false;
    });
}


// 上傳 Line禮物件數時,順便把「分區列印」算出來的撿貨分組一起送到包貨系統,
// 包貨那邊點字卡就看得到今天要撿哪些品項各幾件,不用再開這邊的分區列印分頁對。
// 用的是跟畫面上完全同一套分組邏輯(buildPickGroups),含門檻設定,所以不會兩邊對不起來。
function buildPickingSummary() {
  if (!loadedRows || typeof buildPickGroups !== "function") return null;
  try {
    const exportRows = getZonedExportRows(loadedRows);
    const { splitBySpec, threshold } = getZonedOptions();
    const { ownGroups, mergedGroups } = buildPickGroups(exportRows, splitBySpec, threshold);
    const list = ownGroups.map(g => ({ "品項": g.label, "件數": g.qty }));
    // 沒超過門檻的那些併成一張單,對撿貨的人來說是一個整體,給個總數就好
    const mergedQty = mergedGroups.reduce((sum, g) => sum + g.qty, 0);
    if (mergedQty > 0) list.push({ "品項": "其他合併", "件數": mergedQty });
    return list.length ? list : null;
  } catch (e) {
    // 撿貨明細只是附帶資訊,算不出來也不該擋住件數上傳
    console.warn("撿貨分組計算失敗,這次不送明細:", e);
    return null;
  }
}

// 離島那批的撿貨分組(給包貨系統「離島•郵局」字卡點開來看)。
// 跟 Line禮物 不同:離島一天通常只有一兩筆,套門檻會全部被併成「其他合併」一行,
// 撿貨的人等於看不到要撿什麼 —— 所以門檻固定傳 0,每組都自成一列(qty > 0 就獨立)。
// 這裡收的是原始訂單列(loadedRows 篩出來的),不是已經轉成試算表欄位的那份。
function buildOffshorePickingSummary(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (typeof buildPickGroups !== "function") return null;
  try {
    const { ownGroups } = buildPickGroups(rows, false, 0);
    const list = ownGroups.map(g => ({ "品項": g.label, "件數": g.qty }));
    return list.length ? list : null;
  } catch (e) {
    // 撿貨明細只是附帶資訊,算不出來也不該擋住離島件數上傳
    console.warn("離島撿貨分組計算失敗,這次不送明細:", e);
    return null;
  }
}

  function uploadLineRegular() {
  if (!lastStats) return;
  const url = getGsUrl();
  if (!url) return;
  const count = lastStats.regular;
  if (count <= 0) return;
  const today = todayStr("-");
  const btn = document.getElementById("uploadBtn");
  if (btn) { btn.disabled = true; }
  setStatus("status", "loading", "上傳中(Line禮物)…");

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
          ? `✓ 已上傳，Line禮物 今日累計 ${data.total} 筆`
          : `✓ 已上傳，Line禮物 今日 ${data.total} 筆`;
        setStatus("status", "success", msg);
      } else {
        setStatus("status", "error", `✗ Line禮物上傳失敗：${data.error || "未知錯誤"}`);
      }
    })
    .catch(err => setStatus("status", "error", `✗ Line禮物上傳失敗：${err.message}`))
    .finally(() => {
      if (btn) { btn.disabled = false; }
    });
}
