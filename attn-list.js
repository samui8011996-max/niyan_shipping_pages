// ===================================================================
// 注意品項 / 離島•郵局:清單小視窗(2026-10-22 改版)
//
// 這兩類本來是上傳到各自的 Google 試算表,再點統計字卡開試算表看。
// 使用者 2026-10-22 指定:試算表拿掉、個資拿掉,改成點字卡直接彈出小視窗,
// 視窗裡只有「日期 / 訂單編號 / 品名備註 x件數」—— 不放姓名、地址、電話。
//
// 離島的郵局出貨貼紙(offshore-label.js)照舊保留:那張貼紙要貼在包裹上,
// 沒有地址寄不了。它的資料只在這台瀏覽器裡,從載入的訂單表讀,不經過任何伺服器。
// ===================================================================

const ATTN_KINDS = {
  notice: {
    title: "注意品項",
    hint: "出貨前要特別注意的品項,包貨那邊的「品項統計」也會用橘色標出來。",
    pick: r => (r["_類別列表"] || []).includes("注意品項"),
  },
  offshore: {
    title: "離島・郵局",
    hint: "",   // 使用者 2026-10-30:離島這段說明拿掉
    pick: r => !!r["_離島"],
    label: true,   // 視窗裡多一顆「列印離島貼紙」
  },
};

// 這兩類要送去包貨字卡 / 顯示在視窗上的逐筆資料(沒有個資)
function attnRows(kind) {
  const cfg = ATTN_KINDS[kind];
  if (!cfg || !Array.isArray(loadedRows)) return [];
  const today = todayStr("/");
  return loadedRows.filter(cfg.pick).map(r => ({
    date: today,
    orderId: String(r["訂單編號"] ?? "").trim(),
    note: r["_備註"] || pickStatLabel(r),   // _備註 結尾本來就有「 x數量」
  }));
}

function openAttnList(kind) {
  const cfg = ATTN_KINDS[kind];
  if (!cfg) return;
  const rows = attnRows(kind);
  document.getElementById("attnTitle").textContent = cfg.title;
  const hintEl = document.getElementById("attnHint");
  hintEl.textContent = cfg.hint;
  hintEl.hidden = !cfg.hint;
  document.getElementById("attnCount").textContent = rows.length ? `${rows.length} 筆` : "";

  const labelBtn = document.getElementById("attnLabelBtn");
  labelBtn.hidden = !cfg.label || rows.length === 0;
  document.getElementById("attnSheetBtn").hidden = true;   // 只有星座貓X蛋糕的視窗有(cake-sync.js)

  const box = document.getElementById("attnBody");
  if (!loadedRows) {
    box.innerHTML = `<div class="attn-empty">還沒載入訂單總表</div>`;
  } else if (!rows.length) {
    box.innerHTML = `<div class="attn-empty">這次沒有${cfg.title}</div>`;
  } else {
    box.innerHTML = rows.map(r => `
      <div class="attn-row">
        <span class="attn-date">${escapeHtml(r.date)}</span>
        <span class="attn-sn">${escapeHtml(r.orderId)}</span>
        <span class="attn-note">${escapeHtml(r.note)}</span>
      </div>`).join("");
  }
  document.getElementById("attnModal").classList.add("show");
}

function closeAttnList() {
  document.getElementById("attnModal").classList.remove("show");
}

// 視窗裡的「列印離島貼紙」:沿用原本的貼紙功能,印完把視窗關掉
function attnPrintOffshore() {
  closeAttnList();
  if (typeof generateOffshorePdf === "function") generateOffshorePdf();
}
