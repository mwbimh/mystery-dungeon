/* 迷宫 — skill bar: slots, drag-to-equip, drag-aim */
(function () {
  const MD = window.MD;
  const G = MD.game;
  const { ACTIVE_SKILL_TYPES, PASSIVE_SKILL_TYPES, actorAt, afterPlayerAction, bagClear, doSwing,
    doThrow, facePlayer, fillSlotVisual, firstFilledSlot, log, padSkills, playPlayerAnimThen,
    playerMelee, renderInv, skillMeta, state, updateUI } = G;

  function skillsBlocked() {
    if (state.mode !== "dungeon") return true;
    if (state.animLock) return true;
    const ids = ["endOverlay", "helpOverlay", "townOverlay"];
    for (let i = 0; i < ids.length; i++) {
      const el = document.getElementById(ids[i]);
      if (el && !el.classList.contains("hidden")) return true;
    }
    return false;
  }

  function vecTo8Dir(dx, dy) {
    if (dx === 0 && dy === 0) return [0, 0];
    const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const table = {
      0: [1, 0],
      1: [1, 1],
      2: [0, 1],
      3: [-1, 1],
      4: [-1, 0],
      "-4": [-1, 0],
      "-1": [1, -1],
      "-2": [0, -1],
      "-3": [-1, -1],
    };
    return table[String(oct)] || [1, 0];
  }

  let skillAim = null;

  function showAimLine(x0, y0, x1, y1) {
    const el = document.getElementById("skillAimLine");
    if (!el) return;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    el.style.display = "block";
    el.style.left = x0 + "px";
    el.style.top = (y0 - 1.5) + "px";
    el.style.width = len + "px";
    el.style.transform = "rotate(" + Math.atan2(dy, dx) + "rad)";
  }
  function hideAimLine() {
    const el = document.getElementById("skillAimLine");
    if (el) {
      el.style.display = "none";
      el.style.width = "0px";
    }
  }

  function cancelSkillAim() {
    if (skillAim && skillAim.slotEl) skillAim.slotEl.classList.remove("aiming");
    skillAim = null;
    state.skillAiming = false;
    hideAimLine();
    document.removeEventListener("pointermove", onSkillAimMove);
    document.removeEventListener("pointerup", onSkillAimUp);
    document.removeEventListener("pointercancel", onSkillAimCancel);
  }
  function onSkillAimMove(ev) {
    if (!skillAim) return;
    showAimLine(skillAim.cx, skillAim.cy, ev.clientX, ev.clientY);
  }
  function onSkillAimCancel() {
    cancelSkillAim();
  }
  function onSkillAimUp(ev) {
    if (!skillAim) return;
    const dx = ev.clientX - skillAim.x0;
    const dy = ev.clientY - skillAim.y0;
    const dist = Math.hypot(dx, dy);
    const src = { place: "skill", kind: "active", index: skillAim.index };
    const item = state.skills.active[skillAim.index];
    cancelSkillAim();
    if (dist < 12) return;
    if (skillsBlocked()) return;
    if (!item) return;
    const [sx, sy] = vecTo8Dir(dx, dy);
    if (sx === 0 && sy === 0) return;
    const [wx, wy] = G.toWorldDir(sx, sy);
    facePlayer(wx, wy);
    if (item.type === "knockStaff") doSwing(item, src, wx, wy);
    else if (item.type === "rock" || item.type === "sleepHerb") doThrow(item, src, wx, wy);
    updateUI();
  }

  function beginSkillAim(ev, index, slotEl) {
    if (ev.button !== 0) return;
    if (ev.pointerType === "mouse" && ev.buttons !== 1) return;
    const item = state.skills.active[index];
    if (!item) return;
    if (G.bagDragFrom >= 0) return;
    if (skillsBlocked()) return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelSkillAim();
    state.skillAiming = true;
    const r = slotEl.getBoundingClientRect();
    skillAim = {
      index,
      x0: ev.clientX,
      y0: ev.clientY,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      slotEl,
    };
    slotEl.classList.add("aiming");
    showAimLine(skillAim.cx, skillAim.cy, ev.clientX, ev.clientY);
    document.addEventListener("pointermove", onSkillAimMove);
    document.addEventListener("pointerup", onSkillAimUp);
    document.addEventListener("pointercancel", onSkillAimCancel);
  }

  function tryEquipFromBag(kind, index, bagIndex) {
    const item = state.bag[bagIndex];
    if (!item) return;
    if (index < 0 || index >= skillMeta[kind]) return;
    const ok = kind === "active" ? ACTIVE_SKILL_TYPES[item.type] : kind === "passive" ? PASSIVE_SKILL_TYPES[item.type] : false;
    if (!ok) {
      if (kind === "active") log("主动栏只能放击退之杖或石头。", "warn");
      else log("被动技能还没开放。", "warn");
      updateUI();
      return;
    }
    const prev = state.skills[kind][index];
    if (prev) log(MD.displayName(prev) + "被覆盖，消失了。", "warn");
    state.skills[kind][index] = item;
    bagClear(bagIndex);
    if (state.invSelected === bagIndex) state.invSelected = firstFilledSlot();
    renderSkills();
    renderInv();
    updateUI();
  }

  function unequipSkill(kind, index) {
    if (kind === "basic") return;
    const item = state.skills[kind] && state.skills[kind][index];
    if (!item) return;
    state.skills[kind][index] = null;
    log("卸下了" + MD.displayName(item) + "（消失了）");
    renderSkills();
    updateUI();
  }

  function playerBasicAttack() {
    if (skillsBlocked()) return;
    const p = state.player;
    if (!p || !p.alive) return;
    if (MD.hasStatus(p, "sleep") || MD.hasStatus(p, "para")) {
      log(MD.hasStatus(p, "sleep") ? "睡着了……" : "麻痹中……", "warn");
      MD.tickStatuses(p);
      afterPlayerAction();
      updateUI();
      return;
    }
    let dx = p.facingDx | 0, dy = p.facingDy | 0;
    if (dx === 0 && dy === 0) { dx = 0; dy = 1; }
    const nx = p.x + dx, ny = p.y + dy;
    const target = actorAt(nx, ny);
    if (target && target.kind === "enemy") {
      playerMelee(target);
      MD.tickStatuses(p);
      playPlayerAnimThen("attack", function () {
        if (state.mode !== "dungeon" || !state.player) return;
        afterPlayerAction();
        updateUI();
      });
      updateUI();
      return;
    }
    const blocked = !state.map || nx < 0 || ny < 0 || nx >= state.map.width || ny >= state.map.height
      || !MD.isWalkable(state.map, nx, ny);
    log(blocked ? "挡住了。" : "拍空了。", blocked ? "warn" : "");
    MD.tickStatuses(p);
    playPlayerAnimThen("attack", function () {
      if (state.mode !== "dungeon" || !state.player) return;
      afterPlayerAction();
      updateUI();
    });
    updateUI();
  }

  function bindSkillDrop(slot, kind, index) {
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
      e.stopPropagation();
      slot.classList.remove("drag-over");
      let raw = e.dataTransfer.getData("text/md-bag");
      if (raw === "" || raw == null) raw = e.dataTransfer.getData("text/plain");
      let from = parseInt(raw, 10);
      if (Number.isNaN(from)) from = G.bagDragFrom;
      if (Number.isNaN(from) || from < 0) return;
      G.bagDropConsumedClick = true;
      tryEquipFromBag(kind, index, from);
    });
  }

  function sanitizeSkills() {
    padSkills();
    const act = state.skills.active;
    for (let i = 0; i < act.length; i++) {
      if (act[i] && !ACTIVE_SKILL_TYPES[act[i].type]) act[i] = null;
    }
    const pas = state.skills.passive;
    for (let i = 0; i < pas.length; i++) {
      if (pas[i] && !PASSIVE_SKILL_TYPES[pas[i].type]) pas[i] = null;
    }
  }

  function renderSkills() {
    sanitizeSkills();
    const aRow = document.getElementById("skillActiveRow");
    if (aRow && aRow.children.length !== skillMeta.active) mountSkillSlots();
    const pRow = document.getElementById("skillPassiveRow");
    if (pRow && pRow.children.length !== skillMeta.passive) mountSkillSlots();
    for (let i = 0; i < skillMeta.active; i++) {
      const slot = document.getElementById("skillActive" + i);
      if (!slot) continue;
      const item = state.skills.active[i];
      slot.classList.toggle("empty", !item);
      fillSlotVisual(slot, item, "");
    }
    for (let i = 0; i < skillMeta.passive; i++) {
      const slot = document.getElementById("skillPassive" + i);
      if (!slot) continue;
      const item = state.skills.passive[i];
      slot.classList.toggle("empty", !item);
      fillSlotVisual(slot, item, "");
    }
  }

  function makeSkillSlot(kind, index) {
    const el = document.createElement("div");
    el.className = "skill-slot empty " + (kind === "passive" ? "skill-slot-passive" : "skill-slot-active");
    el.id = (kind === "active" ? "skillActive" : "skillPassive") + index;
    el.dataset.kind = kind;
    el.dataset.index = String(index);
    el.title = kind === "active" ? "主动" : "被动";
    el.draggable = false;
    el.addEventListener("dragstart", (e) => e.preventDefault());
    bindSkillDrop(el, kind, index);
    if (kind === "active") {
      el.addEventListener("pointerdown", (e) => beginSkillAim(e, index, el));
    }
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      unequipSkill(kind, index);
    });
    return el;
  }

  function mountSkillSlots() {
    const aRow = document.getElementById("skillActiveRow");
    const pRow = document.getElementById("skillPassiveRow");
    if (aRow) {
      aRow.innerHTML = "";
      for (let i = 0; i < skillMeta.active; i++) aRow.appendChild(makeSkillSlot("active", i));
    }
    if (pRow) {
      pRow.innerHTML = "";
      for (let i = 0; i < skillMeta.passive; i++) pRow.appendChild(makeSkillSlot("passive", i));
    }
  }

  function initSkillBar() {
    mountSkillSlots();
    const basic = document.getElementById("skillBasic");
    if (basic) {
      basic.draggable = false;
      basic.addEventListener("dragstart", (e) => e.preventDefault());
      basic.addEventListener("click", (e) => {
        e.preventDefault();
        playerBasicAttack();
      });
      basic.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  Object.assign(G, {
    cancelSkillAim, renderSkills, mountSkillSlots, initSkillBar,
  });
})();
