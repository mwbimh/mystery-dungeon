/* 迷宫 — game core: constants, renderer pick, state, bag/skill-slot helpers, queries */
(function () {
  const G = (window.MD.game = window.MD.game || {});
  const MD = window.MD;
  const MAX_BAG = 20;
  const MAX_MONSTERS = 16;
  const TOTAL_FLOORS = 24;
  const DEBUG = /(?:\?|&)debug=1(?:&|$)/.test(location.search);
  const ASSET_V = "59";
  const ITEM_ICON = {
    onigiri: "assets/runtime/onigiri.png",
    bigOnigiri: "assets/runtime/bigOnigiri.png",
    rock: "assets/runtime/rock.png",
    sleepHerb: "assets/runtime/herb.png",
    knockStaff: "assets/runtime/staff.png",
  };

  function emptyBag() {
    return Array(MAX_BAG).fill(null);
  }
  function padBag(arr) {
    const out = emptyBag();
    if (!Array.isArray(arr)) return out;
    const n = Math.min(arr.length, MAX_BAG);
    for (let i = 0; i < n; i++) out[i] = arr[i] || null;
    return out;
  }

  const canvas = document.getElementById("game");
  const overlay = document.getElementById("overlay");
  G.ctx = null;
  G.overlayCtx = null;
  G.use3d = false;
  const FORCE_FLAT = /(?:\?|&)flat=1(?:&|$)/.test(location.search);

  function enable2d() {
    G.use3d = false;
    if (!G.ctx) G.ctx = canvas.getContext("2d");
    if (overlay) overlay.style.display = "none";
  }

  if (!FORCE_FLAT && typeof THREE !== "undefined" && MD.view3d) {
    try {
      if (MD.view3d.init(canvas)) {
        G.use3d = true;
        if (overlay) {
          overlay.style.pointerEvents = "none";
          G.overlayCtx = overlay.getContext("2d");
        }
      } else {
        enable2d();
      }
    } catch (err) {
      console.error("3D init failed, falling back to 2D", err);
      enable2d();
    }
  } else {
    enable2d();
  }

  const state = {
    mode: "town", // town | dungeon
    debug: DEBUG,
    floor: 0,
    turn: 0,
    map: null,
    player: null,
    enemies: [],
    items: [], // {x,y,type,...item fields}
    bag: emptyBag(),
    skills: { active: [null, null], passive: [null] },
    warehouse: MD.loadWarehouse(),
    explored: new Set(),
    visible: new Set(),
    log: [],
    triggeredMH: new Set(), // room ids triggered
    aiming: null, // {action:'throw'|'swing', slotIndex}
    skillAiming: false,
    invOpen: false,
    whOpen: false,
    invSelected: -1,
    pendingDash: null, // {dx,dy} continue dash after enemy turn
    dashActive: false,
    animLock: false,
    keysDown: new Set(),
    keyBuffer: [], // recent direction keys for diagonal chord
    lastBellyWarn: 100,
    spawnCounter: 0,
    justEnteredMH: false,
    endKind: null, // death | clear
  };

  function bagCount() {
    let n = 0;
    const bag = state.bag;
    for (let i = 0; i < MAX_BAG; i++) if (bag[i]) n++;
    return n;
  }
  function bagFreeIndex() {
    const bag = state.bag;
    for (let i = 0; i < MAX_BAG; i++) if (!bag[i]) return i;
    return -1;
  }
  function bagPut(item) {
    const i = bagFreeIndex();
    if (i < 0) return false;
    state.bag[i] = item;
    return true;
  }
  function bagClear(index) {
    if (index >= 0 && index < MAX_BAG) state.bag[index] = null;
  }
  const SKILL_SLOT_MAX = { active: 4, passive: 3 };
  const SKILL_SLOT_START = { active: 2, passive: 1 };
  function loadSkillMeta() {
    try {
      const o = JSON.parse(localStorage.getItem("md-skill-meta") || "null");
      if (o && typeof o === "object") {
        const a = Math.max(1, Math.min(SKILL_SLOT_MAX.active, o.active | 0));
        const p = Math.max(0, Math.min(SKILL_SLOT_MAX.passive, o.passive | 0));
        return { active: a, passive: p };
      }
    } catch (e) {}
    return { active: SKILL_SLOT_START.active, passive: SKILL_SLOT_START.passive };
  }
  const skillMeta = loadSkillMeta();
  function saveSkillMeta() {
    try {
      localStorage.setItem("md-skill-meta", JSON.stringify({
        active: skillMeta.active,
        passive: skillMeta.passive,
      }));
    } catch (e) {}
  }
  function emptySkills() {
    return {
      active: Array(skillMeta.active).fill(null),
      passive: Array(skillMeta.passive).fill(null),
    };
  }
  function padSkills() {
    if (!state.skills) state.skills = emptySkills();
    ["active", "passive"].forEach((kind) => {
      const n = skillMeta[kind];
      const arr = Array.isArray(state.skills[kind]) ? state.skills[kind].slice() : [];
      while (arr.length < n) arr.push(null);
      if (arr.length > n) arr.length = n;
      state.skills[kind] = arr;
    });
  }
  function unlockSkillSlot(kind) {
    if (kind !== "active" && kind !== "passive") return false;
    if (skillMeta[kind] >= SKILL_SLOT_MAX[kind]) return false;
    skillMeta[kind] += 1;
    saveSkillMeta();
    padSkills();
    G.mountSkillSlots();
    G.renderSkills();
    log("解锁了新的" + (kind === "active" ? "主动" : "被动") + "栏。", "good");
    updateUI();
    return true;
  }
  MD.unlockSkillSlot = unlockSkillSlot;
  MD.skillSlotInfo = function () {
    return {
      active: skillMeta.active,
      passive: skillMeta.passive,
      maxActive: SKILL_SLOT_MAX.active,
      maxPassive: SKILL_SLOT_MAX.passive,
    };
  };
  const ACTIVE_SKILL_TYPES = { knockStaff: true, rock: true };
  const PASSIVE_SKILL_TYPES = {};

  function consumeFrom(src) {
    if (!src) return;
    if (src.place === "bag") bagClear(src.index);
    else if (src.place === "skill" && state.skills[src.kind]) {
      state.skills[src.kind][src.index] = null;
      G.renderSkills();
    }
  }
  function writeBackItem(src, item) {
    if (!src) return;
    if (src.place === "bag") {
      if (src.index >= 0 && src.index < MAX_BAG) state.bag[src.index] = item;
    } else if (src.place === "skill" && state.skills[src.kind]) {
      state.skills[src.kind][src.index] = item;
      G.renderSkills();
    }
  }
  function firstFilledSlot() {
    for (let i = 0; i < MAX_BAG; i++) if (state.bag[i]) return i;
    return -1;
  }
  function itemIconSrc(item) {
    if (!item) return "";
    const src = ITEM_ICON[item.type];
    return src ? src + "?v=" + ASSET_V : "";
  }

  function log(text, cls) {
    state.log.push({ text, cls: cls || "" });
    if (state.log.length > 80) state.log.shift();
  }

  function playerAnimMs() {
    const spec = MD.sprites && MD.sprites.playerAnim;
    const fps = (spec && spec.fps) || 10;
    const frames = (spec && spec.frames) || 4;
    return frames * (1000 / fps);
  }

  function playPlayerAnimThen(anim, cb) {
    const p = state.player;
    if (!p) {
      if (cb) cb();
      return;
    }
    p.anim = anim;
    p.animT0 = performance.now();
    state.animLock = true;
    if (state._animTimer) clearTimeout(state._animTimer);
    state._animTimer = setTimeout(function () {
      state._animTimer = null;
      state.animLock = false;
      if (p.anim === anim && anim !== "fail") p.anim = "idle";
      if (cb) cb();
    }, playerAnimMs());
  }

  function facePlayer(dx, dy) {
    if (MD.setFacing) MD.setFacing(state.player, dx, dy);
    else if (state.player && (dx || dy)) {
      state.player.facingDx = dx;
      state.player.facingDy = dy;
    }
  }

  function allActors() {
    const list = [];
    if (state.player) list.push(state.player);
    for (const e of state.enemies) if (e.alive) list.push(e);
    return list;
  }

  function actorAt(x, y) {
    if (state.player && state.player.alive && state.player.x === x && state.player.y === y) return state.player;
    for (const e of state.enemies) {
      if (e.alive && e.x === x && e.y === y) return e;
    }
    return null;
  }

  function itemAt(x, y) {
    return state.items.find((it) => it.x === x && it.y === y) || null;
  }

  function refreshFOV() {
    if (!state.map || !state.player) return;
    state.visible = MD.computeVisible(state.map, state.player.x, state.player.y);
    for (const k of state.visible) state.explored.add(k);
  }

  function showOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  }
  function hideOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  }

  function hudInvEl() { return document.getElementById("hudInv"); }
  function hudWhEl() { return document.getElementById("hudWh"); }
  function hudLogEl() { return document.getElementById("hudLog"); }

  function canOccupy(x, y, self) {
    const a = actorAt(x, y);
    return !a || a === self;
  }

  function updateUI() {
    MD.updateSidePanel(state);
  }

  Object.assign(G, {
    MAX_BAG, MAX_MONSTERS, TOTAL_FLOORS, DEBUG, emptyBag, padBag, canvas,
    overlay, state, bagFreeIndex, bagPut, bagClear, skillMeta, emptySkills, padSkills,
    ACTIVE_SKILL_TYPES, PASSIVE_SKILL_TYPES, consumeFrom, writeBackItem, firstFilledSlot,
    itemIconSrc, log, playPlayerAnimThen, facePlayer, allActors, actorAt, itemAt, refreshFOV,
    showOverlay, hideOverlay, hudInvEl, hudWhEl, hudLogEl, updateUI,
  });
})();
