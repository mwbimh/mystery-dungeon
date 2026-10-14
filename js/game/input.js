/* 迷宫 — keyboard/mouse input and UI buttons */
(function () {
  const MD = window.MD;
  const G = MD.game;
  const { actorAt, beginAim, cancelAim, cancelSkillAim, canvas, checkMonsterHouse, closeInv,
    closeWarehouse, eatItem, emptyBag, emptySkills, enemyTurns, enterDungeon, hideOverlay,
    hudLogEl, hungerAndRegen, itemAt, onDeath, openInv, openWarehouse, refreshFOV, renderInv,
    renderSkills, resolveAim, returnToTown, showOverlay, spawnWanderer, startDash, state,
    tryPickup, tryPlayerMove, updateUI, waitTurn } = G;

  function toWorldDir(dx, dy) {
    if (G.use3d && MD.view3d && typeof MD.view3d.screenToTileDir === "function") {
      return MD.view3d.screenToTileDir(dx, dy);
    }
    return [dx, dy];
  }

  // --- Input ---
  const DIR_KEYS = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    w: [0, -1], W: [0, -1],
    s: [0, 1], S: [0, 1],
    a: [-1, 0], A: [-1, 0],
    d: [1, 0], D: [1, 0],
    Numpad8: [0, -1],
    Numpad2: [0, 1],
    Numpad4: [-1, 0],
    Numpad6: [1, 0],
    Numpad7: [-1, -1],
    Numpad9: [1, -1],
    Numpad1: [-1, 1],
    Numpad3: [1, 1],
  };

  let chordTimer = null;
  let chordParts = { x: 0, y: 0 };

  function handleDirection(sx, sy, shift) {
    const [dx, dy] = toWorldDir(sx, sy);
    if (dx === 0 && dy === 0) return;
    if (state.skillAiming) return;
    if (state.aiming) {
      resolveAim(dx, dy);
      updateUI();
      return;
    }
    if (state.mode !== "dungeon") return;
    if (state.animLock) return;
    if (document.getElementById("endOverlay") && !document.getElementById("endOverlay").classList.contains("hidden")) return;

    if (shift) startDash(dx, dy);
    else {
      state.dashActive = false;
      state.pendingDash = null;
      tryPlayerMove(dx, dy, false);
    }
    updateUI();
  }

  function onKeyDown(e) {
    const key = e.key;

    // Global overlays
    if (key === "Escape") {
      if (state.skillAiming) {
        e.preventDefault();
        cancelSkillAim();
        return;
      }
      if (state.aiming) {
        e.preventDefault();
        cancelAim();
        return;
      }
      if (state.invOpen) {
        e.preventDefault();
        closeInv();
        return;
      }
      if (!document.getElementById("helpOverlay").classList.contains("hidden")) {
        hideOverlay("helpOverlay");
        return;
      }
      if (state.whOpen) {
        e.preventDefault();
        closeWarehouse();
        return;
      }
    }

    if (key === "?" || key === "h" || key === "H") {
      if (state.mode === "town" && state.whOpen) return;
      e.preventDefault();
      const help = document.getElementById("helpOverlay");
      if (help.classList.contains("hidden")) showOverlay("helpOverlay");
      else hideOverlay("helpOverlay");
      return;
    }

    if (state.mode === "town") {
      if (key === "i" || key === "I" || key === "Tab") {
        e.preventDefault();
        if (state.invOpen) closeInv();
        else openInv();
        return;
      }
      if (key === "Enter" && !state.invOpen) {
        enterDungeon();
      }
      return;
    }

    // End overlay
    if (!document.getElementById("endOverlay").classList.contains("hidden")) {
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        finishEnd();
      }
      return;
    }

    if (key === "i" || key === "I" || key === "Tab") {
      e.preventDefault();
      if (state.invOpen) closeInv();
      else openInv();
      return;
    }

    if (state.invOpen && !state.aiming) {
      // top-row number keys select slots; numpad still walks
      if (/^[0-9]$/.test(key) && (!e.code || e.code.startsWith("Digit"))) {
        e.preventDefault();
        let idx = key === "0" ? 9 : parseInt(key, 10) - 1;
        if (state.bag[idx]) {
          state.invSelected = idx;
          renderInv();
        }
        return;
      }
      if (key === "e" || key === "E") {
        const it = state.bag[state.invSelected];
        if (it && MD.ITEM_DEFS[it.type].verbs.includes("eat")) {
          e.preventDefault();
          eatItem(state.invSelected);
        }
        return;
      }
      if (key === "t" || key === "T") {
        const it = state.bag[state.invSelected];
        if (it && MD.ITEM_DEFS[it.type].verbs.includes("throw")) {
          e.preventDefault();
          beginAim("throw", state.invSelected);
        }
        return;
      }
      if (key === "z" || key === "Z" || key === "f" || key === "F") {
        const it = state.bag[state.invSelected];
        if (it && MD.ITEM_DEFS[it.type].verbs.includes("swing")) {
          e.preventDefault();
          beginAim("swing", state.invSelected);
        }
        return;
      }
    }

    if (state.aiming) {
      if (DIR_KEYS[key]) {
        e.preventDefault();
        const [sx, sy] = DIR_KEYS[key];
        const [dx, dy] = toWorldDir(sx, sy);
        resolveAim(dx, dy);
        updateUI();
      }
      return;
    }

    // Wait
    if (key === " " || key === "." || key === "Numpad5" || key === "5") {
      // Numpad5 wait; top-row 5 only if not inv — ok
      if (key === "5" && e.code !== "Numpad5" && e.getModifierState && false) { /* ignore */ }
      if (key === "5" && e.code !== "Digit5" && e.code !== "Numpad5") { /* */ }
      // Allow Space, ., Numpad5; Digit5 as wait too when not in inv
      if (key === "5" && e.code === "Digit5") {
        // also wait
      }
      e.preventDefault();
      if (!state.animLock) waitTurn();
      updateUI();
      return;
    }

    if (key === "g" || key === "G") {
      e.preventDefault();
      // pickup without turn if failed? Spec: G pickup — auto also on walk. Manual G should spend turn only if picked? Typically free or turn. Spec says G 拾取 — treat as action if item present
      if (tryPickup(false)) {
        MD.tickStatuses(state.player);
        checkMonsterHouse();
        hungerAndRegen();
        enemyTurns();
        spawnWanderer();
        refreshFOV();
        if (!state.player.alive || state.player.hp <= 0) onDeath();
      }
      updateUI();
      return;
    }

    // Movement with chord buffer for WASD diagonals
    if (DIR_KEYS[key]) {
      e.preventDefault();
      const [dx, dy] = DIR_KEYS[key];
      const isNumpadDiag = key.startsWith("Numpad") && dx !== 0 && dy !== 0;
      const isPureNumpad = key.startsWith("Numpad");
      const isArrowOrWasd = !isPureNumpad;

      if (isNumpadDiag || (isPureNumpad && (dx === 0 || dy === 0))) {
        handleDirection(dx, dy, e.shiftKey);
        return;
      }

      // Chord: accumulate within 40ms
      chordParts.x = dx !== 0 ? dx : chordParts.x;
      chordParts.y = dy !== 0 ? dy : chordParts.y;
      state.keysDown.add(key);

      if (chordTimer) clearTimeout(chordTimer);
      chordTimer = setTimeout(() => {
        let fx = 0, fy = 0;
        // Re-read held keys
        for (const k of state.keysDown) {
          const d = DIR_KEYS[k];
          if (!d) continue;
          if (d[0]) fx = d[0];
          if (d[1]) fy = d[1];
        }
        if (fx === 0 && fy === 0) {
          fx = chordParts.x;
          fy = chordParts.y;
        }
        chordParts = { x: 0, y: 0 };
        chordTimer = null;
        if (fx !== 0 || fy !== 0) handleDirection(fx, fy, e.shiftKey);
      }, 28);
      return;
    }
  }

  function onKeyUp(e) {
    state.keysDown.delete(e.key);
  }

  function finishEnd() {
    hideOverlay("endOverlay");
    if (state.endKind === "clear") {
      // Keep bag — dump to town
      returnToTown("走出了迷宫！背包物品已带回，可存入仓库。");
    } else {
      state.bag = emptyBag();
      state.skills = emptySkills();
      renderSkills();
      returnToTown("倒下了……背包物品丢失，仓库还在。");
    }
    state.endKind = null;
  }

  // --- UI buttons ---
  document.getElementById("btnEnter").onclick = () => enterDungeon();
  document.getElementById("btnWarehouse").onclick = () => openWarehouse();

  function initTownMap() {
    const root = document.getElementById("townMap");
    if (!root) return;
    root.querySelectorAll(".town-sticker").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        if (action === "enter") {
          enterDungeon();
          return;
        }
        if (action === "warehouse") {
          openWarehouse();
          return;
        }
        if (action === "npc") {
          const name = btn.dataset.npc || "友人";
          if (MD.story && MD.story.trigger("npc", { npc: name })) return;
          const chip = document.getElementById("townMsg");
          if (chip) chip.textContent = name + "在镇子里晃悠。点上方入口进迷宫，点 DeepSeek 开仓库。";
        }
      });
    });
  }
  initTownMap();
  document.getElementById("btnWhClose").onclick = () => closeWarehouse();
  document.getElementById("btnWhToggle").onclick = () => {
    if (state.whOpen) closeWarehouse();
    else openWarehouse();
  };
  document.getElementById("btnHelp").onclick = () => showOverlay("helpOverlay");
  document.getElementById("btnHelpTown").onclick = () => showOverlay("helpOverlay");
  document.getElementById("btnHelpClose").onclick = () => hideOverlay("helpOverlay");
  document.getElementById("btnInv").onclick = () => {
    if (state.invOpen) closeInv();
    else openInv();
  };
  document.getElementById("btnInvClose").onclick = () => closeInv();
  document.getElementById("btnLogToggle").onclick = () => {
    const el = hudLogEl();
    if (!el) return;
    el.classList.toggle("collapsed");
    const btn = document.getElementById("btnLogToggle");
    if (btn) btn.textContent = el.classList.contains("collapsed") ? "展开" : "收起";
  };
  document.getElementById("btnEndOk").onclick = () => finishEnd();

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("mousemove", (e) => {
    const t = MD.screenToTile(state, e.clientX, e.clientY, canvas);
    const el = document.getElementById("hoverInfo");
    if (!t || state.mode !== "dungeon") {
      el.textContent = "";
      return;
    }
    const k = MD.key(t.x, t.y);
    if (!state.debug && !state.explored.has(k)) {
      el.textContent = "";
      return;
    }
    const parts = ["(" + t.x + "," + t.y + ")"];
    if (state.debug) parts.push("room " + state.map.roomIds[t.y][t.x]);
    const a = actorAt(t.x, t.y);
    if (a && (state.debug || state.visible.has(k))) parts.push(a.name);
    const it = itemAt(t.x, t.y);
    if (it && (state.debug || state.visible.has(k))) parts.push(MD.displayName(it));
    if (state.map.tiles[t.y][t.x] === MD.TILE.STAIRS) parts.push("楼梯");
    el.textContent = parts.join(" · ");
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  Object.assign(G, {
    toWorldDir,
  });
})();
