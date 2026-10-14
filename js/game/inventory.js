/* 迷宫 — inventory & warehouse UI */
(function () {
  const MD = window.MD;
  const G = MD.game;
  const { MAX_BAG, bagClear, bagFreeIndex, bagPut, beginAim, canvas, eatItem, firstFilledSlot,
    hideOverlay, hudInvEl, hudWhEl, itemIconSrc, log, showOverlay, state } = G;

  // --- Inventory UI ---
  function openInv() {
    state.invOpen = true;
    if (state.invSelected == null || state.invSelected < 0 || !state.bag[state.invSelected]) {
      state.invSelected = firstFilledSlot();
    }
    state.aiming = null;
    const hint = document.getElementById("aimHint");
    if (hint) hint.classList.add("hidden");
    const inv = hudInvEl();
    if (inv) inv.classList.remove("collapsed");
    if (state.mode === "town") hideOverlay("townOverlay");
    renderInv();
  }

  function closeInv() {
    state.invOpen = false;
    state.aiming = null;
    closeWarehouse(true);
    const inv = hudInvEl();
    if (inv) inv.classList.add("collapsed");
    canvas.focus();
    if (state.mode === "town") showOverlay("townOverlay");
  }

  function fillSlotVisual(slot, item, indexLabel) {
    slot.innerHTML = "";
    if (indexLabel != null && indexLabel !== "") {
      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = indexLabel;
      slot.appendChild(idx);
    }
    if (!item) {
      slot.removeAttribute("title");
      return;
    }
    const src = itemIconSrc(item);
    if (src) {
      const img = document.createElement("img");
      img.className = "slot-icon";
      img.src = src;
      img.alt = MD.displayName(item);
      img.draggable = false;
      slot.appendChild(img);
    }
    if (item.type === "knockStaff") {
      const badge = document.createElement("span");
      badge.className = "slot-charge";
      badge.textContent = String(item.charges | 0);
      slot.appendChild(badge);
    }
    slot.title = MD.displayName(item);
  }

  G.bagDragFrom = -1;
  G.bagDropConsumedClick = false;

  function clearBagDragOver() {
    const grid = document.getElementById("invGrid");
    if (!grid) return;
    grid.querySelectorAll(".slot.drag-over").forEach((el) => el.classList.remove("drag-over"));
    document.querySelectorAll("#hudSkills .skill-slot.drag-over").forEach((el) => el.classList.remove("drag-over"));
  }

  function swapBagSlots(from, to) {
    if (from === to || from < 0 || to < 0 || from >= MAX_BAG || to >= MAX_BAG) return false;
    const tmp = state.bag[from];
    state.bag[from] = state.bag[to];
    state.bag[to] = tmp;
    if (state.invSelected === from) state.invSelected = to;
    else if (state.invSelected === to) state.invSelected = from;
    return true;
  }

  function bindBagSlotDnD(slot, index) {
    const filled = !!state.bag[index];
    slot.draggable = filled;
    slot.addEventListener("dragstart", (e) => {
      if (!state.bag[index]) {
        e.preventDefault();
        return;
      }
      G.bagDragFrom = index;
      e.dataTransfer.setData("text/plain", String(index));
      e.dataTransfer.setData("text/md-bag", String(index));
      e.dataTransfer.effectAllowed = "move";
      slot.classList.add("dragging");
    });
    slot.addEventListener("dragend", () => {
      G.bagDragFrom = -1;
      slot.classList.remove("dragging");
      clearBagDragOver();
    });
    slot.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      slot.classList.add("drag-over");
    });
    slot.addEventListener("dragleave", () => {
      slot.classList.remove("drag-over");
    });
    slot.addEventListener("drop", (e) => {
      e.preventDefault();
      slot.classList.remove("drag-over");
      const raw = e.dataTransfer.getData("text/plain");
      let from = parseInt(raw, 10);
      if (Number.isNaN(from)) from = G.bagDragFrom;
      if (Number.isNaN(from) || from < 0) return;
      if (swapBagSlots(from, index)) {
        G.bagDropConsumedClick = true;
        renderInv();
      }
    });
  }

  function renderInv() {
    const grid = document.getElementById("invGrid");
    const actions = document.getElementById("invActions");
    grid.innerHTML = "";
    for (let i = 0; i < MAX_BAG; i++) {
      const item = state.bag[i];
      const slot = document.createElement("div");
      slot.className = "slot" + (item ? "" : " empty") + (state.invSelected === i ? " selected" : "");
      slot.dataset.slot = String(i);
      const idxLabel = i === 9 ? "0" : String(i + 1);
      fillSlotVisual(slot, item, idxLabel);
      bindBagSlotDnD(slot, i);
      slot.addEventListener("click", () => {
        if (G.bagDropConsumedClick) {
          G.bagDropConsumedClick = false;
          return;
        }
        if (!state.bag[i]) return;
        if (state.whOpen && state.mode === "town") {
          state.warehouse.push(state.bag[i]);
          bagClear(i);
          if (state.invSelected === i) state.invSelected = firstFilledSlot();
          MD.saveWarehouse(state.warehouse);
          renderInv();
          renderWarehouse();
          return;
        }
        state.invSelected = i;
        renderInv();
      });
      grid.appendChild(slot);
    }
    actions.innerHTML = "";
    const item = state.bag[state.invSelected];
    if (!item) return;
    const def = MD.ITEM_DEFS[item.type];
    if (!def) return;
    if (def.verbs.includes("eat")) {
      const b = document.createElement("button");
      b.textContent = def.eatLabel || "吃";
      b.onclick = () => eatItem(state.invSelected);
      actions.appendChild(b);
    }
    if (def.verbs.includes("throw")) {
      const b = document.createElement("button");
      b.className = "ghost";
      b.textContent = def.throwLabel || "扔";
      b.onclick = () => beginAim("throw", state.invSelected);
      actions.appendChild(b);
    }
    if (def.verbs.includes("swing")) {
      const b = document.createElement("button");
      b.className = "ghost";
      b.textContent = def.swingLabel || "挥";
      b.onclick = () => beginAim("swing", state.invSelected);
      actions.appendChild(b);
    }
  }

  // --- Warehouse ---
  function openWarehouse() {
    if (!state.invOpen) openInv();
    state.whOpen = true;
    hideOverlay("townOverlay");
    const wh = hudWhEl();
    if (wh) wh.classList.remove("collapsed");
    const hint = document.getElementById("whHint");
    if (hint) {
      hint.textContent = state.mode === "town"
        ? "点击背包物品存入，点击仓库物品取出。仓库跨局保留。"
        : "迷宫里只能查看仓库，回到镇子才能存取。";
    }
    renderInv();
    renderWarehouse();
  }

  function closeWarehouse(silent) {
    state.whOpen = false;
    const wh = hudWhEl();
    if (wh) wh.classList.add("collapsed");
    MD.saveWarehouse(state.warehouse);
    if (!silent) renderInv();
  }

  function renderWarehouse() {
    const storeEl = document.getElementById("whStore");
    if (!storeEl) return;
    storeEl.innerHTML = "";
    if (!state.warehouse.length) {
      const empty = document.createElement("div");
      empty.className = "slot empty";
      storeEl.appendChild(empty);
      return;
    }
    state.warehouse.forEach((it, i) => {
      const slot = document.createElement("div");
      slot.className = "slot";
      fillSlotVisual(slot, it, "");
      slot.onclick = () => {
        if (state.mode !== "town") return;
        if (bagFreeIndex() < 0) {
          log("背包已满", "warn");
          return;
        }
        bagPut(it);
        state.warehouse.splice(i, 1);
        MD.saveWarehouse(state.warehouse);
        renderInv();
        renderWarehouse();
      };
      storeEl.appendChild(slot);
    });
  }

  Object.assign(G, {
    openInv, closeInv, fillSlotVisual, renderInv, openWarehouse,
    closeWarehouse,
  });
})();
