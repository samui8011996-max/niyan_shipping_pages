// ===================================================================
// LINE禮物:每一筆都能改備註(使用者 2026-10-21)
// 載入 LINE 訂單總表後,在「改備註」卡片搜尋訂單編號/收件人/品項,直接改那一筆的備註。
// 改完的內容:
//   - 下載黑貓出貨表、離島貼紙 → 用改過的「黑貓備註」(_備註)
//   - 上傳廠商試算表 → 一般訂單也換成改過的備註;雷雕訂單另外改「刻印文字」,
//     寫回 _備註完整 的「刻印文字: …」(雷雕網站靠這個欄位名抓字),再送進雷雕 D1
// 偵測到的問題訂單會自動列在最上面。重新載入訂單檔就全部清掉(只存在這一次)。
// ===================================================================
let noteEditQuery = "";

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
  rows.forEach(r => {
    r["_原備註"] = r["_備註"];
    r["_原備註完整"] = r["_備註完整"];
    r["_已改備註"] = false;
  });
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
  document.getElementById("noteEditHint").textContent =
    (edited ? `已改 ${edited} 筆 · ` : "") + (q ? `找到 ${rows.length} 筆` : (rows.length ? "問題訂單和改過的列在下面" : "輸入訂單編號、收件人或品項搜尋"));
  const shown = rows.slice(0, 40);
  box.innerHTML = shown.map(r => {
    const i = loadedRows.indexOf(r);
    const laser = noteEditIsLaser(r);
    const isProblem = problems.has(String(r["訂單編號"] ?? "").trim());
    return `<div class="problem-item note-edit-item${r["_已改備註"] ? " editing" : ""}" data-i="${i}">
      <div class="problem-item-main">
        <div class="problem-item-row1">
          <span class="pi-id">${escapeHtml(r["訂單編號"] ?? "")}</span>
          <span class="pi-time">${escapeHtml(r["收件人姓名"] ?? "")}</span>
          ${isProblem ? '<span class="pi-type">問題訂單</span>' : ""}
          ${laser ? '<span class="pi-type">雷雕</span>' : ""}
          ${r["_已改備註"] ? '<span class="pi-type">已改</span>' : ""}
        </div>
        <label class="form-label" for="ne-note-${i}">黑貓出貨表備註</label>
        <input id="ne-note-${i}" class="form-input" data-f="note" value="${escapeHtml(r["_備註"] ?? "")}">
        ${laser ? `<label class="form-label" for="ne-text-${i}">刻印文字(雷雕網站用)</label>
        <input id="ne-text-${i}" class="form-input" data-f="text" value="${escapeHtml(engravingTextOf(r["_備註完整"]))}" placeholder="沒填就是不刻字(換木片)">` : ""}
      </div>
      <div class="problem-item-btns">
        <button type="button" class="pi-edit" data-act="save">存</button>
        ${r["_已改備註"] ? '<button type="button" class="pi-resolve" data-act="revert">還原</button>' : ""}
      </div>
    </div>`;
  }).join("") + (rows.length > shown.length ? `<p class="abbr-hint">只列前 ${shown.length} 筆,打更多字縮小範圍</p>` : "");
}

function saveNoteEdit(i) {
  const r = loadedRows[i];
  const card = document.querySelector(`.note-edit-item[data-i="${i}"]`);
  if (!r || !card) return;
  const note = card.querySelector('[data-f="note"]').value.trim();
  const textEl = card.querySelector('[data-f="text"]');
  r["_備註"] = note;
  if (noteEditIsLaser(r)) {
    r["_備註完整"] = setEngravingText(r["_原備註完整"], textEl ? textEl.value.trim() : "");
  } else {
    r["_備註完整"] = note;   // 一般訂單:廠商試算表也看改過的
  }
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
    const i = Number(b.closest(".note-edit-item").dataset.i);
    if (b.dataset.act === "save") saveNoteEdit(i);
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
