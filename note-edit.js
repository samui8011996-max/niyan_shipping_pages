// ===================================================================
// LINE禮物:每一筆都能改備註(使用者 2026-10-21)。一筆只有一格備註,沒有另外的刻印文字欄
// 載入 LINE 訂單總表後,在「改備註」卡片搜尋訂單編號/收件人/品項,直接改那一筆的備註。
// 改完的內容:
//   - 下載黑貓出貨表、離島貼紙 → 用改過的「黑貓備註」(_備註)
//   - 上傳廠商試算表、雷雕 D1 → 也用改過的備註(雷雕網站從裡面的「刻印文字: …」抓字)
// 偵測到的問題訂單會自動列在最上面。重新載入訂單檔就全部清掉(只存在這一次)。
// 也能刪除整筆訂單(使用者 2026-10-28:抽單用):同訂單編號的每個品項一起從 loadedRows 拿掉,
// 下載黑貓出貨表、上傳、離島貼紙、分區列印、統計字卡就都不會有它;可以還原,重新載入訂單檔也會回來。
// ===================================================================
let noteEditQuery = "";
let noteDeletedRows = [];   // 被刪掉的列(還原用),每列帶 _序 = 載入時的位置

function noteEditIsLaser(r) {
  return (r["_類別列表"] || []).includes("雷雕");
}

// 雷雕備註(完整寫法)裡的刻印文字換掉;原本沒有就補在數量前面;清空就拿掉
function setEngravingText(full, text) {
  const s = String(full || "");
  const qty = (s.match(/\s*x\d+\s*$/) || [""])[0];
  let body = qty ? s.slice(0, s.length - qty.length) : s;
  body = body.replace(/\s*刻印文字[:：]\s*.*$/, "").replace(/\s+-\s*$/, "");   // 空刻印欄留下的「 -」也拿掉
  if (text) body = body + " 刻印文字: " + text;
  return (body.trim() + qty).replace(/\s+/g, " ").trim();
}

function engravingTextOf(full) {
  return (String(full || "").replace(/\s*x\d+\s*$/, "").match(/刻印文字[:：]\s*(.+)$/) || [])[1]?.trim() || "";
}

// handleFile 讀完訂單檔後叫這支:記下原本的值(還原用),清掉上一個檔的修改
function initNoteEdits(rows) {
  rows.forEach((r, idx) => {
    r["_原備註"] = r["_備註"];
    r["_原備註完整"] = r["_備註完整"];
    r["_已改備註"] = false;
    r["_序"] = idx;
  });
  noteDeletedRows = [];
  noteEditQuery = "";
  const input = document.getElementById("noteEditSearch");
  if (input) input.value = "";
  document.getElementById("noteEditCard").hidden = false;
  renderNoteEditor();
}

function noteEditProblemIds() {
  if (typeof problemListCache === "undefined") return new Set();
  return new Set(problemListCache.map(p => String(p.orderId || "").trim()));
}

function renderNoteEditor() {
  const box = document.getElementById("noteEditList");
  if (!box || !loadedRows) return;
  const q = noteEditQuery.trim().toLowerCase();
  const problems = noteEditProblemIds();
  let rows;
  if (q) {
    rows = loadedRows.filter(r => [r["訂單編號"], r["收件人姓名"], r["_備註"], r["商品名稱"]]
      .some(v => String(v ?? "").toLowerCase().includes(q)));
  } else {
    // 沒搜尋時:問題訂單 + 已經改過的
    rows = loadedRows.filter(r => problems.has(String(r["訂單編號"] ?? "").trim()) || r["_已改備註"]);
  }
  const edited = loadedRows.filter(r => r["_已改備註"]).length;
  const deletedIds = [...new Set(noteDeletedRows.map(r => String(r["訂單編號"] ?? "").trim()))];
  document.getElementById("noteEditHint").textContent =
    (edited ? `已改 ${edited} 筆 · ` : "") + (deletedIds.length ? `已刪除 ${deletedIds.length} 筆 · ` : "") +
    (q ? `找到 ${rows.length} 筆` : (rows.length ? "問題訂單和改過的列在下面" : "輸入訂單編號、收件人或品項搜尋"));
  const shown = rows.slice(0, 40);
  const deletedHtml = deletedIds.map(id => {
    const first = noteDeletedRows.find(r => String(r["訂單編號"] ?? "").trim() === id);
    return `<div class="problem-item note-edit-item is-deleted">
      <div class="problem-item-main">
        <div class="problem-item-row1">
          <span class="pi-id">${escapeHtml(id)}</span>
          <span class="pi-time">${escapeHtml(first["收件人姓名"] ?? "")}</span>
          <span class="pi-removed">已刪除</span>
        </div>
        <div class="pi-note">${escapeHtml(first["_備註"] ?? "")}</div>
      </div>
      <div class="problem-item-btns">
        <button type="button" class="pi-edit" data-act="undelete" data-id="${escapeHtml(id)}">還原</button>
      </div>
    </div>`;
  }).join("");
  box.innerHTML = shown.map(r => {
    const i = loadedRows.indexOf(r);
    const laser = noteEditIsLaser(r);
    const isProblem = problems.has(String(r["訂單編號"] ?? "").trim());
    return `<div class="problem-item note-edit-item${isProblem ? " is-problem" : ""}${r["_已改備註"] ? " editing" : ""}" data-i="${i}">
      <div class="problem-item-main">
        <div class="problem-item-row1">
          <span class="pi-id">${escapeHtml(r["訂單編號"] ?? "")}</span>
          <span class="pi-time">${escapeHtml(r["收件人姓名"] ?? "")}</span>
          ${isProblem ? '<span class="pi-type ne-problem-tag">問題訂單</span>' : ""}
          ${laser ? '<span class="pi-type">雷雕</span>' : ""}
          ${r["_已改備註"] ? '<span class="pi-type">已改</span>' : ""}
        </div>
        <label class="form-label" for="ne-note-${i}">黑貓出貨表備註</label>
        <input id="ne-note-${i}" class="form-input" data-f="note" value="${escapeHtml(r["_備註"] ?? "")}">
      </div>
      <div class="problem-item-btns">
        <button type="button" class="pi-edit" data-act="save">存</button>
        ${r["_已改備註"] ? '<button type="button" class="pi-edit" data-act="revert">還原</button>' : ""}
        <button type="button" class="pi-resolve" data-act="delete">刪除</button>
      </div>
    </div>`;
  }).join("") + (rows.length > shown.length ? `<p class="abbr-hint">只列前 ${shown.length} 筆,打更多字縮小範圍</p>` : "")
    + deletedHtml;
}

// 刪掉/還原之後,統計字卡、離島鈕、分區列印、問題訂單警示都照新的 loadedRows 重算
function refreshAfterRowsChange() {
  renderStats(computeStats(loadedRows));
  document.getElementById("offshorePdfBtn").disabled = !loadedRows.some(r => r["_離島"]);
  if (typeof updateZonedStats === "function") updateZonedStats(loadedRows);
  if (typeof checkProblemOrdersAgainstLoaded === "function") checkProblemOrdersAgainstLoaded();
  renderNoteEditor();
}

function deleteOrder(i) {
  const r = loadedRows[i];
  if (!r) return;
  const id = String(r["訂單編號"] ?? "").trim();
  const same = loadedRows.filter(x => String(x["訂單編號"] ?? "").trim() === id);
  const msg = `確定刪除訂單 ${id}(${r["收件人姓名"] ?? ""})?` +
    (same.length > 1 ? `\n這筆訂單有 ${same.length} 個品項,會一起刪掉。` : "") +
    `\n\n刪除後,下載黑貓出貨表、上傳、離島貼紙、分區列印都不會有這筆。可以按「還原」拿回來。`;
  if (!confirm(msg)) return;
  // 原地刪(splice),其他檔案拿到的 loadedRows 是同一個陣列
  for (let k = loadedRows.length - 1; k >= 0; k--) {
    if (String(loadedRows[k]["訂單編號"] ?? "").trim() === id) noteDeletedRows.push(...loadedRows.splice(k, 1));
  }
  refreshAfterRowsChange();
  setStatus("status", "success", `✓ 已刪除訂單 ${id},剩 ${loadedRows.length} 筆`);
}

function undeleteOrder(id) {
  const back = noteDeletedRows.filter(r => String(r["訂單編號"] ?? "").trim() === id);
  noteDeletedRows = noteDeletedRows.filter(r => !back.includes(r));
  loadedRows.push(...back);
  loadedRows.sort((a, b) => a["_序"] - b["_序"]);   // 放回原本的排序位置
  refreshAfterRowsChange();
  setStatus("status", "success", `✓ 已還原訂單 ${id},共 ${loadedRows.length} 筆`);
}

function saveNoteEdit(i) {
  const r = loadedRows[i];
  const card = document.querySelector(`.note-edit-item[data-i="${i}"]`);
  if (!r || !card) return;
  const note = card.querySelector('[data-f="note"]').value.trim();
  r["_備註"] = note;
  // 只有一格備註(使用者 2026-10-21:不用另外標刻印文字,整欄給我改就好)。
  // 改過的備註也是廠商試算表/雷雕 D1 收到的內容;雷雕網站靠「刻印文字:」抓字,
  // 有人只寫「文字: Amy」(簡寫那種)就幫它補成「刻印文字: Amy」
  r["_備註完整"] = noteEditIsLaser(r) && !/刻印文字[:：]/.test(note)
    ? note.replace(/(^|\s)文字[:：]\s*/, "$1刻印文字: ")
    : note;
  r["_已改備註"] = note !== r["_原備註"] || r["_備註完整"] !== r["_原備註完整"];
  renderNoteEditor();
  setStatus("status", "success", `✓ 已改 ${r["訂單編號"] ?? ""} 的備註,下載黑貓出貨表、上傳都會用改過的`);
}

function revertNoteEdit(i) {
  const r = loadedRows[i];
  if (!r) return;
  r["_備註"] = r["_原備註"];
  r["_備註完整"] = r["_原備註完整"];
  r["_已改備註"] = false;
  renderNoteEditor();
}

function setupNoteEditor() {
  const input = document.getElementById("noteEditSearch");
  if (!input) return;
  input.addEventListener("input", () => { noteEditQuery = input.value; renderNoteEditor(); });
  document.getElementById("noteEditList").addEventListener("click", e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    if (b.dataset.act === "undelete") { undeleteOrder(b.dataset.id); return; }
    const i = Number(b.closest(".note-edit-item").dataset.i);
    if (b.dataset.act === "save") saveNoteEdit(i);
    else if (b.dataset.act === "delete") deleteOrder(i);
    else revertNoteEdit(i);
  });
  // 在輸入框按 Enter 也算存
  document.getElementById("noteEditList").addEventListener("keydown", e => {
    if (e.key !== "Enter" || !e.target.matches("input[data-f]")) return;
    e.preventDefault();
    saveNoteEdit(Number(e.target.closest(".note-edit-item").dataset.i));
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { setEngravingText, engravingTextOf };
}
if (typeof document !== "undefined") setupNoteEditor();
