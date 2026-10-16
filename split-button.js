// ===================================================================
// 印單按鈕 + 紙張格式:做成「分割按鈕」(使用者 2026-10-16 指定的樣子)
//   [ 產離島貼紙 PDF | ⌄ ]
// 箭頭是同一顆按鈕的右半邊,中間一條細線隔開;點箭頭跳出小選單選紙張。
//
// 頁面上原本的 <select class="fmt-select"> 留著當「目前選哪個」的狀態(藏起來),
// setFormatPills / setXxxFormat 都照舊對它設值 —— 這裡只是把它換一個外觀,
// 選單點下去就是改 select 的值、觸發它的 onchange,其他程式完全不用動。
// ===================================================================
function setupSplitButtons() {
  document.querySelectorAll("select.fmt-select").forEach(sel => {
    const main = sel.previousElementSibling;
    if (!main || !main.classList.contains("btn")) return;

    const wrap = document.createElement("div");
    wrap.className = "split-btn";
    main.parentNode.insertBefore(wrap, main);
    wrap.appendChild(main);

    // 箭頭用跟主按鈕同一個顏色 class(btn-primary / btn-lavender…)
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.className = [...main.classList].filter(c => c.startsWith("btn")).join(" ") + " split-arrow";
    arrow.setAttribute("aria-haspopup", "menu");
    arrow.setAttribute("aria-expanded", "false");
    arrow.innerHTML = '<svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">'
      + '<path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    wrap.appendChild(arrow);

    const menu = document.createElement("div");
    menu.className = "split-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    wrap.appendChild(menu);

    sel.hidden = true;
    wrap.appendChild(sel);

    const label = () => sel.options[sel.selectedIndex]?.text || "";
    const syncTitle = () => {
      arrow.title = "紙張:" + label() + "(點這裡切換)";
      arrow.setAttribute("aria-label", arrow.title);
    };
    const renderMenu = () => {
      menu.innerHTML = [...sel.options].map(o =>
        `<button type="button" role="menuitemradio" aria-checked="${o.value === sel.value}"
           class="split-item${o.value === sel.value ? " on" : ""}" data-v="${o.value}">
           <span class="split-check">${o.value === sel.value ? "✓" : ""}</span>${escapeHtml(o.text)}
         </button>`).join("");
    };
    const close = () => { menu.hidden = true; arrow.setAttribute("aria-expanded", "false"); };

    arrow.addEventListener("click", e => {
      e.stopPropagation();
      const open = menu.hidden;
      document.querySelectorAll(".split-menu").forEach(m => { m.hidden = true; });
      if (open) { renderMenu(); menu.hidden = false; arrow.setAttribute("aria-expanded", "true"); }
      else close();
    });
    menu.addEventListener("click", e => {
      const it = e.target.closest(".split-item");
      if (!it) return;
      sel.value = it.dataset.v;
      sel.dispatchEvent(new Event("change"));
      syncTitle();
      close();
    });
    document.addEventListener("click", e => { if (!wrap.contains(e.target)) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

    // 主按鈕還沒載入檔案時是 disabled(半透明),箭頭跟著變淡看起來才是同一顆;
    // 但箭頭本身一直能按 —— 檔案還沒丟進來也可以先選好紙張
    const syncDim = () => arrow.classList.toggle("dim", main.disabled);
    new MutationObserver(syncDim).observe(main, { attributes: true, attributeFilter: ["disabled"] });
    syncDim();

    // 程式改 select 值的時候(記住上次的選擇),提示文字跟著更新
    sel.addEventListener("change", syncTitle);
    const origSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    Object.defineProperty(sel, "value", {
      get() { return origSet.get.call(this); },
      set(v) { origSet.set.call(this, v); syncTitle(); },
    });
    syncTitle();
  });
}
