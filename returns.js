// ===================================================================
// 包裹退貨(Tab 4)
// ===================================================================
// line禮物/蝦皮/mo 三個平台各自獨立(蝦皮、mo 沒有電聯欄位)
// 2026-09-23 起資料存在 D1 的 shipping_returns,不再寫 Google 試算表;
// 每筆的識別碼是 D1 的 id(以前是試算表列號 rowIndex)。
const RETURN_PLATFORMS = ["line禮物", "蝦皮", "Pinkoi", "官網", "瑪黑", "mo", "博客來", "酷澎"];
// 畫面上顯示的名字(資料庫裡存的值不變:line禮物、mo 是舊資料就在用的)
const RETURN_PLATFORM_LABEL = { "line禮物": "LINE禮物", "mo": "MO+" };
function returnPlatformLabel(p) { return RETURN_PLATFORM_LABEL[p] || p; }
function emptyReturnCache() { return Object.fromEntries(RETURN_PLATFORMS.map(p => [p, []])); }
let returnListCache = emptyReturnCache();   // { id, date, orderId, trackingNo, reason, result, contact1~4, resendNo }
// 正在編輯哪一筆(按「✏️ 編輯」時記下 id)。帶著它送出才是更新那一筆,
// 不然改了訂單編號會被當成新的一筆
let returnEditingId = null;

// 結果欄位固定四種狀態:未結案 是還在處理中,已退貨/結案/移除 算終結狀態
const RETURN_RESULT_OPTIONS = ["未結案", "已退貨", "結案", "移除"];
const RETURN_RESULT_BADGES = {
  "未結案": { cls: "pi-open",     icon: "" },
  "已退貨": { cls: "pi-returned", icon: "" },
  "結案":   { cls: "pi-result",   icon: "" },
  "移除":   { cls: "pi-removed",  icon: "" },
};
const RETURN_CLOSED_RESULTS = new Set(["結案", "已退貨", "移除"]);

function currentReturnPlatform() {
  const el = document.querySelector('input[name="returnPlatform"]:checked');
  return el ? el.value : "line禮物";
}

// 未結案 = 結果不是「結案/已退貨/移除」這幾種終結狀態(含空白)
function isReturnOpen(record) {
  const v = String(record.result || "").trim();
  return !RETURN_CLOSED_RESULTS.has(v);
}

function isReturnReturned(record) {
  return String(record.result || "").trim() === "已退貨";
}

// ---- 退貨電聯提醒(LINE禮物才有電聯欄位) ----
// 電聯欄位一點進去會自動帶「月/日 」(見 prefillReturnContactDate),所以開頭是今天日期 = 今天打過了
function returnContactCount(r) {
  return [r.contact1, r.contact2, r.contact3, r.contact4].filter(v => String(v || "").trim()).length;
}
function returnCalledToday(r) {
  const t = new Date();
  const re = new RegExp("^\\s*0?" + (t.getMonth() + 1) + "\\s*/\\s*0?" + t.getDate() + "(?!\\d)");
  return [r.contact1, r.contact2, r.contact3, r.contact4].some(v => re.test(String(v || "")));
}
// 今天要打電話:未結案、四次還沒打滿、今天還沒打
function returnNeedsCallToday(r) {
  return isReturnOpen(r) && returnContactCount(r) < 4 && !returnCalledToday(r);
}
function returnsToCallToday() {
  return (returnListCache["line禮物"] || []).filter(returnNeedsCallToday);
}

// ---- 原因:可以自己打,也可以點預設選項(顏色跟 Notion 那份一樣) ----
const RETURN_REASON_PRESETS = [
  { text: "未接電話", cls: "rr-pink" },
  { text: "地址錯誤", cls: "rr-blue" },
  { text: "電話錯誤", cls: "rr-red" },
  { text: "自取未取", cls: "rr-gold" },
];

// 點預設選項:欄位空的(或只有另一個預設選項)就直接換掉,已經有自己打的字就接在後面
function pickReturnReason(text) {
  const el = document.getElementById("returnReason");
  const cur = el.value.trim();
  if (!cur || RETURN_REASON_PRESETS.some(p => p.text === cur)) el.value = text;
  else if (!cur.includes(text)) el.value = cur + "、" + text;
  el.focus();
}

// 清單上的原因:預設選項變成彩色小標籤,其他字照原樣
function returnReasonHtml(reason) {
  let rest = String(reason || "").trim();
  if (!rest) return "";
  const tags = [];
  RETURN_REASON_PRESETS.forEach(p => {
    if (rest.includes(p.text)) {
      tags.push(`<span class="rr-tag ${p.cls}">${p.text}</span>`);
      rest = rest.replace(p.text, "");
    }
  });
  rest = rest.replace(/^[、,，\s]+|[、,，\s]+$/g, "").replace(/[、,，]\s*[、,，]/g, "、");
  return `<div class="pi-note">${tags.join("")}${rest ? escapeHtml(rest) : ""}</div>`;
}

// ---- 搜尋(訂單編號、託運單號都能查,不分已結案/未結案) ----
function returnSearchText() {
  const el = document.getElementById("returnSearch");
  return el ? el.value.replace(/\s+/g, "").toLowerCase() : "";
}
// 重寄可以寄很多次:一行一個(逗號、頓號分開也行)
function returnResendList(v) {
  return String(v || "").split(/[\n,，、]+/).map(x => x.trim()).filter(Boolean);
}
function returnMatchesSearch(r, q) {
  return String(r.orderId || "").toLowerCase().includes(q)
      || String(r.trackingNo || "").replace(/\s+/g, "").toLowerCase().includes(q)
      || returnResendList(r.resendNo).some(n => n.replace(/\s+/g, "").toLowerCase().includes(q));
}
function clearReturnSearch() {
  document.getElementById("returnSearch").value = "";
  renderReturnList();
}

function returnResultBadgeHtml(result) {
  const v = String(result || "").trim();
  if (!v) return `<span class="pi-open">未結案</span>`;
  const b = RETURN_RESULT_BADGES[v];
  if (b) return `<span class="${b.cls}">${escapeHtml(v)}</span>`;
  // 舊資料裡的自由文字結果(例如「蝦皮退款結案」),沒有對應到固定選項就照原文顯示
  return `<span class="pi-result">${escapeHtml(v)}</span>`;
}

function currentReturnFilter() {
  const el = document.querySelector('input[name="returnFilter"]:checked');
  return el ? el.value : "open";
}

function onReturnFilterChange() {
  renderReturnList();
}

function onReturnPlatformChange() {
  const platform = currentReturnPlatform();
  returnEditingId = null;     // 換平台等於放棄剛剛那筆的編輯
  setReturnEditMode(null);
  document.getElementById("returnContactFields").style.display = (platform === "line禮物") ? "" : "none";
  document.getElementById("returnListTitle").textContent = `${returnPlatformLabel(platform)} 退貨清單`;
  renderReturnList();
}

function submitReturn() {
  const url = getGsUrl();
  if (!url) {
    setStatus("returnStatus", "warn", "尚未設定 Apps Script 網址,請先點右上「設定」");
    openSettings();
    return;
  }

  const platform = currentReturnPlatform();
  const orderId = document.getElementById("returnOrderId").value.trim();
  const trackingNo = document.getElementById("returnTrackingNo").value.trim();
  // 訂單編號、託運單號擇一就好
  if (!orderId && !trackingNo) {
    setStatus("returnStatus", "error", "✗ 訂單編號或託運單號至少要填一個");
    document.getElementById("returnOrderId").focus();
    return;
  }
  const label = orderId || trackingNo;   // 狀態訊息裡用來指這一筆

  const resultEl = document.querySelector('input[name="returnResult"]:checked');
  const record = {
    date: document.getElementById("returnDate").value.trim(),
    orderId,
    trackingNo,
    resendNo: returnResendList(document.getElementById("returnResendNo").value).join("\n"),
    reason: document.getElementById("returnReason").value.trim(),
    result: resultEl ? resultEl.value : "未結案",
  };
  if (platform === "line禮物") {
    record.contact1 = document.getElementById("returnContact1").value.trim();
    record.contact2 = document.getElementById("returnContact2").value.trim();
    record.contact3 = document.getElementById("returnContact3").value.trim();
    record.contact4 = document.getElementById("returnContact4").value.trim();
  }

  setStatus("returnStatus", "loading", "上傳包裹退貨紀錄中…");
  document.getElementById("returnSubmitBtn").disabled = true;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "addReturn", platform, record, id: returnEditingId }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const msg = data.updated
          ? `✓ 已更新退貨紀錄 ${label}`
          : `✓ 已新增退貨紀錄 ${label}`;
        setStatus("returnStatus", "success", msg);
        clearReturnForm();
        loadReturns();
      } else {
        setStatus("returnStatus", "error", `✗ 上傳失敗:${data.error || "未知錯誤"}`);
      }
    })
    .catch(err => {
      setStatus("returnStatus", "error", `✗ 上傳失敗:${err.message}`);
    })
    .finally(() => {
      document.getElementById("returnSubmitBtn").disabled = false;
    });
}

// 電聯欄位第一次點進去(還是空的)時,自動帶入「月/日 」當開頭,不用自己手動打日期
function prefillReturnContactDate(el) {
  if (el.value.trim() !== "") return;
  const t = new Date();
  el.value = `${t.getMonth() + 1}/${t.getDate()} `;
  const len = el.value.length;
  el.setSelectionRange(len, len);
}

// 編輯模式的外觀:表單換橘色、上面一條「編輯中」、送出鈕改成「更新這一筆」
function setReturnEditMode(label) {
  const on = !!label;
  document.getElementById("returnFormCard").classList.toggle("editing", on);
  document.getElementById("returnEditBanner").hidden = !on;
  if (on) document.getElementById("returnEditLabel").textContent = label;
  document.getElementById("returnSubmitBtn").textContent = on ? "更新這一筆" : "送出退貨紀錄";
  renderReturnList();   // 清單上那一筆跟著標起來 / 取消
}

function clearReturnForm() {
  returnEditingId = null;
  setReturnEditMode(null);
  document.getElementById("returnDate").value = todayStr("-");
  document.getElementById("returnOrderId").value = "";
  document.getElementById("returnTrackingNo").value = "";
  document.getElementById("returnResendNo").value = "";
  document.getElementById("returnReason").value = "";
  const defaultResult = document.querySelector('input[name="returnResult"][value="未結案"]');
  if (defaultResult) defaultResult.checked = true;
  ["returnContact1", "returnContact2", "returnContact3", "returnContact4"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("returnOrderId").focus();
}

// 讀到退貨資料之後的收尾:更新統計字卡、重畫清單、更新小助手貓的打電話提醒。
// loadReturns(按鈕) 跟 loadReturnsQuietly(開網站/每小時) 共用 —— 以前只有按鈕那條會重畫,
// 背景讀完只進快取不畫,所以開網站切到退貨分頁還是停在「尚未載入清單」(使用者 2026-10-29 反映)
function applyReturnsData(data) {
  returnListCache = { ...emptyReturnCache(), ...(data.returns || {}) };
  const total = RETURN_PLATFORMS.reduce((s, p) => s + (returnListCache[p] || []).length, 0);
  const openTotal = RETURN_PLATFORMS.reduce(
    (s, p) => s + (returnListCache[p] || []).filter(isReturnOpen).length, 0
  );
  const statEl = document.getElementById("stat-return-total");
  if (statEl) statEl.textContent = total;
  const statOpenEl = document.getElementById("stat-return-open");
  if (statOpenEl) statOpenEl.textContent = openTotal;
  renderReturnList();
  if (typeof gcUpdateReturnCalls === "function") gcUpdateReturnCalls();
}

function loadReturns() {
  const url = getGsUrl();
  if (!url) {
    document.getElementById("returnListHint").textContent = "尚未設定 Apps Script 網址";
    document.getElementById("returnList").innerHTML =
      `<div class="problem-empty">請先點右上「設定」設定網址。</div>`;
    return;
  }

  document.getElementById("returnListHint").textContent = "載入中…";

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "getReturns" }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || "讀取失敗");
      applyReturnsData(data);
    })
    .catch(err => {
      document.getElementById("returnListHint").textContent = "載入失敗";
      document.getElementById("returnList").innerHTML =
        `<div class="problem-empty">✗ 載入失敗:${err.message}</div>`;
    });
}

function renderReturnList() {
  const platform = currentReturnPlatform();
  const filter = currentReturnFilter();
  const list = returnListCache[platform] || [];
  const container = document.getElementById("returnList");
  const hint = document.getElementById("returnListHint");

  // 更新「已結案/未結案/已退貨」篩選籤上的數量
  const openCount = list.filter(isReturnOpen).length;
  const closedCount = list.length - openCount;
  const returnedCount = list.filter(isReturnReturned).length;
  const openCountEl = document.getElementById("returnOpenCount");
  const closedCountEl = document.getElementById("returnClosedCount");
  const returnedCountEl = document.getElementById("returnReturnedCount");
  if (openCountEl) openCountEl.textContent = `(${openCount})`;
  if (closedCountEl) closedCountEl.textContent = `(${closedCount})`;
  if (returnedCountEl) returnedCountEl.textContent = `(${returnedCount})`;

  let filtered, filterLabel;
  const q = returnSearchText();
  if (q) {
    // 有打搜尋字就整個平台一起找,不管上面選哪個篩選
    filtered = list.filter(r => returnMatchesSearch(r, q));
    filterLabel = `搜尋「${q}」`;
  } else if (filter === "closed") {
    filtered = list.filter(r => !isReturnOpen(r));
    filterLabel = "已結案";
  } else if (filter === "returned") {
    filtered = list.filter(isReturnReturned);
    filterLabel = "已退貨";
  } else {
    filtered = list.filter(isReturnOpen);
    filterLabel = "未結案";
  }

  if (list.length === 0) {
    hint.textContent = `${returnPlatformLabel(platform)} 目前沒有退貨紀錄`;
    container.innerHTML = `<div class="problem-empty">${returnPlatformLabel(platform)} 目前沒有退貨紀錄</div>`;
    return;
  }
  if (filtered.length === 0 && q) {
    // 這個平台找不到,看看其他平台有沒有(常見:選錯平台)
    const others = RETURN_PLATFORMS.filter(p => p !== platform
      && (returnListCache[p] || []).some(r => returnMatchesSearch(r, q)));
    hint.textContent = `${returnPlatformLabel(platform)} 找不到「${q}」`;
    container.innerHTML = `<div class="problem-empty">${returnPlatformLabel(platform)} 找不到「${escapeHtml(q)}」`
      + (others.length ? `<br>在 <b>${others.map(returnPlatformLabel).join("、")}</b> 有找到,上面換平台看看` : "")
      + `</div>`;
    return;
  }
  if (filtered.length === 0) {
    hint.textContent = `${returnPlatformLabel(platform)} 沒有${filterLabel}的紀錄`;
    container.innerHTML = `<div class="problem-empty">${returnPlatformLabel(platform)} 目前沒有${filterLabel}的退貨紀錄</div>`;
    return;
  }

  hint.textContent = `共 ${list.length} 筆 · ${filterLabel} ${filtered.length} 筆`;

  // 由新到舊排序(id 越大代表越新加)
  const sorted = filtered.slice().sort((a, b) => b.id - a.id);

  container.innerHTML = sorted.map(r => {
    const safeId = escapeHtml(r.orderId || "");
    const safeTracking = escapeHtml(r.trackingNo || "");
    const safeDate = escapeHtml(r.date || "");

    const resultHtml = returnResultBadgeHtml(r.result);
    const trackingHtml = safeTracking ? `<span class="pi-tracking">${safeTracking}</span>` : "";
    const reasonHtml = returnReasonHtml(r.reason);
    const resendHtml = returnResendList(r.resendNo)
      .map(n => `<div class="pi-note"><span class="pi-resend">重寄</span>${escapeHtml(n)}</div>`).join("");

    const contactLines = [];
    const callHtml = (platform === "line禮物" && returnNeedsCallToday(r))
      ? `<span class="pi-call">今天要打第 ${returnContactCount(r) + 1} 次電話</span>` : "";
    if (platform === "line禮物") {
      [["第一次電聯", r.contact1], ["第二次電聯", r.contact2], ["第三次電聯", r.contact3], ["第四次電聯", r.contact4]]
        .forEach(([label, val]) => {
          const v = String(val || "").trim();
          if (v) contactLines.push(`<div class="pi-note">${escapeHtml(label)}:${escapeHtml(v)}</div>`);
        });
    }

    return `
      <div class="problem-item${r.id === returnEditingId ? " editing" : ""}" data-rid="${r.id}" data-id="${safeId}">
        <div class="problem-item-main">
          <div class="problem-item-row1">
            <span class="pi-id">${safeId}</span>
            ${trackingHtml}
            ${resultHtml}
            ${callHtml}
            <span class="pi-time">${safeDate}</span>
          </div>
          ${reasonHtml}
          ${resendHtml}
          ${contactLines.join("")}
        </div>
        <div class="problem-item-btns">
          <button class="pi-edit" onclick="editReturn(${r.id})">編輯</button>
          <button class="pi-resolve" onclick="removeReturn(${r.id}, '${safeId.replace(/'/g, "\\'")}', this)">刪除</button>
        </div>
      </div>
    `;
  }).join("");
}

function editReturn(id) {
  const platform = currentReturnPlatform();
  const record = (returnListCache[platform] || []).find(r => r.id === id);
  if (!record) return;
  returnEditingId = id;

  document.getElementById("returnDate").value = record.date || "";
  document.getElementById("returnOrderId").value = record.orderId || "";
  document.getElementById("returnTrackingNo").value = record.trackingNo || "";
  document.getElementById("returnResendNo").value = record.resendNo || "";
  document.getElementById("returnReason").value = record.reason || "";
  const resultVal = String(record.result || "").trim();
  const resultRadios = document.querySelectorAll('input[name="returnResult"]');
  let matched = false;
  resultRadios.forEach(el => {
    if (el.value === resultVal) { el.checked = true; matched = true; }
  });
  if (!matched) {
    // 舊資料或自由文字結果沒有對應到固定選項,先預設回到「未結案」
    const fallback = document.querySelector('input[name="returnResult"][value="未結案"]');
    if (fallback) fallback.checked = true;
  }
  if (platform === "line禮物") {
    document.getElementById("returnContact1").value = record.contact1 || "";
    document.getElementById("returnContact2").value = record.contact2 || "";
    document.getElementById("returnContact3").value = record.contact3 || "";
    document.getElementById("returnContact4").value = record.contact4 || "";
  }

  const editing = record.orderId || record.trackingNo || "(沒有編號的那筆)";
  setReturnEditMode(editing);
  setStatus("returnStatus", "warn", `✎ 編輯中:${editing}(改完按「更新這一筆」,或按「取消編輯」放棄)`);
  document.getElementById("returnFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function removeReturn(id, orderId, btn) {
  const url = getGsUrl();
  if (!url) {
    setStatus("returnStatus", "warn", "尚未設定 Apps Script 網址");
    return;
  }
  const platform = currentReturnPlatform();
  if (!confirm(`確定要刪除 ${returnPlatformLabel(platform)} 的退貨紀錄 ${orderId || "(沒有訂單編號的那筆)"} ?`)) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = "處理中…";
  }
  setStatus("returnStatus", "loading", `移除退貨紀錄 ${orderId}…`);

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "removeReturn", platform, id, orderId }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        setStatus("returnStatus", "success", `✓ 已移除 ${orderId}`);
        loadReturns();
      } else {
        setStatus("returnStatus", "error", `✗ 移除失敗:${data.error || "未知錯誤"}`);
        if (btn) { btn.disabled = false; btn.textContent = "刪除"; }
      }
    })
    .catch(err => {
      setStatus("returnStatus", "error", `✗ 移除失敗:${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = "刪除"; }
    });
}


function loadReturnsQuietly() {
  const url = getGsUrl();
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "getReturns" }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) return;
      applyReturnsData(data);   // 開網站就自動把清單畫好,不用再手動按重新整理
    })
    .catch(err => console.warn("背景讀取退貨失敗(打電話提醒先不顯示):", err));
}

function maybeLoadReturnsOnTabSwitch(name) {
  const total = RETURN_PLATFORMS.reduce((s, p) => s + (returnListCache[p] || []).length, 0);
  if (name === "returns" && total === 0) {
    loadReturns();
  }
}
