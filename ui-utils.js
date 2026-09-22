// ===================================================================
// UI 工具
// ===================================================================
function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.classList.toggle("active", p.id === `tab-${name}`);
  });
  maybeLoadProblemsOnTabSwitch(name);
  maybeLoadReturnsOnTabSwitch(name);
}

function setStatus(elId, type, msg) {
  const el = document.getElementById(elId);
  el.className = "status " + type;
  if (type === "loading") {
    el.innerHTML = `<span class="spinner"></span>${msg}`;
  } else {
    el.textContent = msg;
  }
}

function todayStr(sep = "") {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}${sep}${m}${sep}${d}`;
}


function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 兩個分頁(一般出貨表、分區列印)其實共用同一份 loadedRows,上傳一次兩邊都能用,
// 不用分別上傳兩次 —— 這裡把兩個檔案顯示徽章一起更新,才不會讓人誤以為另一頁還沒上傳
function setFileDisplays(filename) {
  ["fileDisplay", "zonedFileDisplay"].forEach(id => {
    const d = document.getElementById(id);
    if (!d) return;
    d.textContent = filename;
    d.classList.remove("empty"); d.classList.add("has-file");
  });
}


// ===================================================================
// 拖曳上傳:每個檔案欄位除了點「選擇檔案」,也可以整個卡片當放置區。
//
// 為什麼要攔 window 的 dragover/drop:瀏覽器預設會「開啟」被丟進來的檔案,
// 也就是直接離開這一頁(還沒上傳的東西全沒了)。只在放置區攔是不夠的,
// 丟歪一點點落在卡片外面就會觸發,所以整個 window 都要擋。
// ===================================================================
["dragover", "drop"].forEach(ev => {
  window.addEventListener(ev, e => e.preventDefault());
});

function fileExt(name) {
  const m = String(name || "").toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}

// zone   = 當放置區的元素(通常是整張 .card)
// accept = 允許的副檔名陣列,例如 [".xlsx", ".xls"]
// onFiles(files)  = 通過檢查的檔案(陣列)
// onReject(names) = 被擋下來的檔名(陣列),沒給的話只是安靜忽略
function setupDropZone(zone, { accept, onFiles, onReject }) {
  if (!zone) return;
  const okExt = accept.map(x => x.toLowerCase());
  // dragleave 在游標移到子元素上也會觸發,直接拿它移除樣式會一直閃,
  // 所以用進出計數,歸零才算真的離開
  let depth = 0;

  zone.addEventListener("dragenter", e => {
    e.preventDefault();
    depth++;
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragover", e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  zone.addEventListener("dragleave", e => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove("drag-over");
  });
  zone.addEventListener("drop", e => {
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    zone.classList.remove("drag-over");
    const all = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!all.length) return;
    const good = all.filter(f => okExt.includes(fileExt(f.name)));
    const bad = all.filter(f => !okExt.includes(fileExt(f.name)));
    if (bad.length && onReject) onReject(bad.map(f => f.name));
    if (good.length) onFiles(good);
  });
}
