/* 迷宫 — main game */
(function () {
  const MD = window.MD;
  const MAX_BAG = 20;
  const MAX_MONSTERS = 16;
  const TOTAL_FLOORS = 8;
  const DEBUG = /(?:\?|&)debug=1(?:&|$)/.test(location.search);
  const ASSET_V = "50";
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
  let ctx = null;
  let overlayCtx = null;
  let use3d = false;
  const FORCE_FLAT = /(?:\?|&)flat=1(?:&|$)/.test(location.search);

  function enable2d() {
    use3d = false;
    if (!ctx) ctx = canvas.getContext("2d");
    if (overlay) overlay.style.display = "none";
  }

  if (!FORCE_FLAT && typeof THREE !== "undefined" && MD.view3d) {
    try {
      if (MD.view3d.init(canvas)) {
        use3d = true;
        if (overlay) {
          overlay.style.pointerEvents = "none";
          overlayCtx = overlay.getContext("2d");
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
    mountSkillSlots();
    renderSkills();
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
      renderSkills();
    }
  }
  function writeBackItem(src, item) {
    if (!src) return;
    if (src.place === "bag") {
      if (src.index >= 0 && src.index < MAX_BAG) state.bag[src.index] = item;
    } else if (src.place === "skill" && state.skills[src.kind]) {
      state.skills[src.kind][src.index] = item;
      renderSkills();
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

  function emptyFloorTiles(preferNotRoomId) {
    const out = [];
    const map = state.map;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!MD.isWalkable(map, x, y)) continue;
        if (map.tiles[y][x] === MD.TILE.STAIRS) continue;
        if (actorAt(x, y)) continue;
        if (itemAt(x, y)) continue;
        if (preferNotRoomId != null && map.roomIds[y][x] === preferNotRoomId) continue;
        out.push({ x, y });
      }
    }
    return out;
  }

  function placeItems(count, roomFilter) {
    let tiles = emptyFloorTiles();
    if (roomFilter) {
      const filtered = tiles.filter((t) => roomFilter(state.map.roomIds[t.y][t.x]));
      if (filtered.length) tiles = filtered;
    }
    MD.shuffle(tiles);
    const n = Math.min(count, tiles.length);
    for (let i = 0; i < n; i++) {
      const t = tiles[i];
      const it = MD.randomFloorItem(state.floor);
      state.items.push({ ...it, x: t.x, y: t.y });
    }
  }

  function placeEnemies(count, roomId, dense) {
    let tiles = emptyFloorTiles();
    if (roomId != null) {
      tiles = tiles.filter((t) => state.map.roomIds[t.y][t.x] === roomId);
    }
    MD.shuffle(tiles);
    const n = Math.min(count, tiles.length, MAX_MONSTERS - state.enemies.filter((e) => e.alive).length);
    for (let i = 0; i < n; i++) {
      const t = tiles[i];
      const type = MD.pickEnemyType(state.floor);
      state.enemies.push(MD.makeEnemy(type, t.x, t.y));
    }
  }

  function setupFloor(floorNum) {
    state.floor = floorNum;
    state.turn = floorNum === 1 ? 0 : state.turn;
    state.map = MD.generateFloor(floorNum);
    state.enemies = [];
    state.items = [];
    state.explored = new Set();
    state.visible = new Set();
    state.triggeredMH = new Set();
    state.spawnCounter = 0;
    state.justEnteredMH = false;
    state.pendingDash = null;
    state.dashActive = false;

    const spawn = state.map.playerSpawn;
    if (!state.player) {
      state.player = MD.makePlayer(spawn.x, spawn.y);
    } else {
      state.player.x = spawn.x;
      state.player.y = spawn.y;
      state.player.anim = "idle";
      state.player.animT0 = performance.now();
      // keep hp/belly/statuses/facing across floors
    }

    // Baseline monsters in non-MH rooms
    const rooms = state.map.rooms;
    for (const r of rooms) {
      if (r.id === state.map.spawnRoomId) continue;
      if (r.isMonsterHouse) {
        // Pre-place some, rest on trigger
        const area = r.w * r.h;
        const pre = Math.min(3, Math.floor(area / 10));
        placeEnemies(pre, r.id, true);
        // Extra items in MH
        placeItems(MD.randInt(4, 7), (rid) => rid === r.id);
      } else {
        const n = Math.random() < 0.7 ? MD.randInt(1, 2) : 0;
        if (n) placeEnemies(n, r.id, false);
      }
    }
    // Sparse corridor / leftover monsters if under soft count
    const alive = () => state.enemies.filter((e) => e.alive).length;
    while (alive() < Math.min(8, 4 + floorNum) && alive() < MAX_MONSTERS) {
      placeEnemies(1, null, false);
      if (emptyFloorTiles().length < 5) break;
    }

    // Normal floor items
    placeItems(MD.randInt(3, 6), (rid) => rid !== state.map.spawnRoomId);

    // Ensure spawn tile clear of enemies/items
    state.enemies = state.enemies.filter((e) => !(e.x === spawn.x && e.y === spawn.y));
    state.items = state.items.filter((it) => !(it.x === spawn.x && it.y === spawn.y));
    // Stairs clear
    const sx = state.map.stairs.x, sy = state.map.stairs.y;
    state.enemies = state.enemies.filter((e) => !(e.x === sx && e.y === sy));
    state.items = state.items.filter((it) => !(it.x === sx && it.y === sy));

    refreshFOV();
    log("到达了 " + floorNum + " 层。", "good");
  }

  function enterDungeon() {
    if (state._animTimer) { clearTimeout(state._animTimer); state._animTimer = null; }
    state.animLock = false;
    state.mode = "dungeon";
    state.bag = padBag(state.bag);
    state.player = MD.makePlayer(0, 0);
    state.player.statuses = [];
    state.log = [];
    state.lastBellyWarn = 100;
    hideOverlay("townOverlay");
    closeWarehouse(true);
    setupFloor(1);
    canvas.focus();
    updateUI();
  }

  function returnToTown(msg) {
    if (state._animTimer) { clearTimeout(state._animTimer); state._animTimer = null; }
    state.animLock = false;
    state.mode = "town";
    state.map = null;
    state.enemies = [];
    state.items = [];
    state.player = null;
    state.aiming = null;
    cancelSkillAim();
    state.invOpen = false;
    state.whOpen = false;
    const inv = document.getElementById("hudInv");
    if (inv) inv.classList.add("collapsed");
    const wh = document.getElementById("hudWh");
    if (wh) wh.classList.add("collapsed");
    hideOverlay("endOverlay");
    const townMsg = document.getElementById("townMsg");
    if (townMsg) townMsg.textContent = msg || "欢迎回到镇子。点上方入口进迷宫，点 DeepSeek 开仓库。";
    showOverlay("townOverlay");
    MD.saveWarehouse(state.warehouse);
    updateUI();
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

  function tryPickup(auto) {
    const p = state.player;
    const it = itemAt(p.x, p.y);
    if (!it) {
      if (!auto) log("这里没有可拾取的物品。");
      return false;
    }
    if (bagFreeIndex() < 0) {
      log("背包满了。", "warn");
      return false;
    }
    state.items = state.items.filter((x) => x !== it);
    const { x, y, ...rest } = it;
    bagPut(rest);
    log("捡起了" + MD.displayName(rest) + "。", "good");
    if (state.invOpen) renderInv();
    return true;
  }

  function checkMonsterHouse() {
    const rid = MD.getRoomId(state.map, state.player.x, state.player.y);
    if (rid == null || rid < 0) return;
    if (!state.map.monsterHouseRooms.includes(rid)) return;
    if (state.triggeredMH.has(rid)) return;
    state.triggeredMH.add(rid);
    const room = state.map.rooms.find((r) => r.id === rid);
    const area = room ? room.w * room.h : 20;
    const want = Math.min(10, Math.max(5, Math.floor(area / 4)));
    const existing = state.enemies.filter((e) => e.alive && state.map.roomIds[e.y][e.x] === rid).length;
    const need = Math.max(0, want - existing);
    placeEnemies(need, rid, true);
    placeItems(MD.randInt(1, 3), (id) => id === rid);
    state.justEnteredMH = true;
    log("怪物部屋！", "special");
  }

  function applyDamage(target, dmg, sourceName) {
    target.hp -= dmg;
    if (MD.hasStatus(target, "sleep")) {
      MD.wakeIfDamaged(target);
      if (target.kind === "player") log("你被打醒了！", "warn");
      else log(target.name + "被打醒了！", "warn");
    }
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      if (target.kind === "enemy") {
        log(target.name + "倒下了。", "good");
        state.enemies = state.enemies.filter((e) => e !== target);
      }
    }
  }

  function playerMelee(enemy) {
    const dmg = MD.meleeDamage(state.player.atk, enemy.def);
    log("你砍了" + enemy.name + "（" + dmg + "）。");
    applyDamage(enemy, dmg, "player");
  }

  function enemyMelee(enemy) {
    const dmg = MD.meleeDamage(enemy.atk, state.player.def);
    log(enemy.name + "攻击了你（" + dmg + "）。", "bad");
    applyDamage(state.player, dmg, enemy.name);
  }

  function afterPlayerAction() {
    // Stairs
    const p = state.player;
    if (state.map.tiles[p.y][p.x] === MD.TILE.STAIRS) {
      state.dashActive = false;
      state.pendingDash = null;
      if (state.floor >= TOTAL_FLOORS) {
        playPlayerAnimThen("climb", function () {
          state.endKind = "clear";
          log("走出了迷宫！", "good");
          document.getElementById("endTitle").textContent = "走出了迷宫";
          document.getElementById("endMsg").textContent = "你带着背包里的物品回到了镇子。";
          showOverlay("endOverlay");
          updateUI();
        });
        return;
      }
      playPlayerAnimThen("climb", function () {
        if (state.mode !== "dungeon" || !state.player) return;
        log("走下了楼梯……");
        setupFloor(state.floor + 1);
        updateUI();
      });
      return;
    }

    tryPickup(true);
    checkMonsterHouse();
    hungerAndRegen();
    enemyTurns();
    spawnWanderer();
    refreshFOV();

    if (!state.player.alive || state.player.hp <= 0) {
      onDeath();
      return;
    }

    // Continue dash?
    if (state.dashActive && state.pendingDash) {
      const { dx, dy } = state.pendingDash;
      // defer one frame so render can show intermediate
      requestAnimationFrame(() => {
        if (state.mode !== "dungeon" || !state.dashActive) return;
        continueDash(dx, dy);
      });
    }
  }

  function hungerAndRegen() {
    const p = state.player;
    state.turn += 1;
    state.spawnCounter += 1;

    // belly every 10 turns
    if (state.turn % 10 === 0) {
      if (p.belly > 0) p.belly -= 1;
    }
    if (p.belly <= 0) {
      p.belly = 0;
      p.hp -= 1;
      if (state.turn % 1 === 0) {
        // log occasionally
        if (state.turn % 3 === 0) log("饿了。", "bad");
      }
      if (p.hp <= 0) {
        p.alive = false;
        return;
      }
    } else {
      // regen every 8 turns if not just entered MH
      if (!state.justEnteredMH && state.turn % 8 === 0 && p.hp < p.maxHp) {
        p.hp += 1;
      }
    }
    state.justEnteredMH = false;

    if (p.belly <= 20 && state.lastBellyWarn > 20) {
      log("肚子有点饿了……", "warn");
      state.lastBellyWarn = 20;
    }
    if (p.belly <= 10 && state.lastBellyWarn > 10) {
      log("肚子饿了！", "bad");
      state.lastBellyWarn = 10;
    }
    if (p.belly > 20) state.lastBellyWarn = p.belly;
  }

  function spawnWanderer() {
    if (state.spawnCounter < 40) return;
    state.spawnCounter = 0;
    const alive = state.enemies.filter((e) => e.alive).length;
    if (alive >= MAX_MONSTERS) return;
    const rid = MD.getRoomId(state.map, state.player.x, state.player.y);
    const tiles = emptyFloorTiles(rid >= 0 ? rid : null);
    if (!tiles.length) return;
    const t = tiles[MD.randInt(0, tiles.length - 1)];
    state.enemies.push(MD.makeEnemy(MD.pickEnemyType(state.floor), t.x, t.y));
  }

  function onDeath() {
    state.player.alive = false;
    state.dashActive = false;
    state.pendingDash = null;
    state.bag = emptyBag(); // lose bag
    state.skills = emptySkills();
    renderSkills();
    state.endKind = "death";
    log("倒下了……", "bad");
    document.getElementById("endTitle").textContent = "倒下了";
    document.getElementById("endMsg").textContent = "背包里的物品都丢掉了。仓库仍然保留。";
    playPlayerAnimThen("fail", function () {
      showOverlay("endOverlay");
      updateUI();
    });
    updateUI();
  }

  function canOccupy(x, y, self) {
    const a = actorAt(x, y);
    return !a || a === self;
  }

  /** Attempt player move by dx,dy. Returns 'moved'|'attacked'|'blocked'|'none' */
  function tryPlayerMove(dx, dy, fromDash) {
    const p = state.player;
    if (!p || !p.alive) return "none";
    if (state.animLock) return "none";

    // Status: sleep / para skip
    if (MD.hasStatus(p, "sleep") || MD.hasStatus(p, "para")) {
      log(MD.hasStatus(p, "sleep") ? "睡着了……" : "麻痹中……", "warn");
      MD.tickStatuses(p);
      state.dashActive = false;
      state.pendingDash = null;
      afterPlayerAction();
      return "moved";
    }

    let mdx = dx, mdy = dy;
    if (MD.hasStatus(p, "confuse")) {
      const d = MD.DIRS8[MD.randInt(0, 7)];
      mdx = d[0]; mdy = d[1];
      log("混乱中乱走！", "warn");
    }

    if (mdx === 0 && mdy === 0) {
      // wait — facing unchanged
      MD.tickStatuses(p);
      afterPlayerAction();
      return "moved";
    }

    facePlayer(mdx, mdy);

    if (!MD.canStep(state.map, p.x, p.y, mdx, mdy)) {
      // bump wall — no turn (unless confused: still wastes the turn)
      state.dashActive = false;
      state.pendingDash = null;
      if (MD.hasStatus(p, "confuse")) {
        MD.tickStatuses(p);
        afterPlayerAction();
        return "moved";
      }
      return "blocked";
    }
    const nx = p.x + mdx, ny = p.y + mdy;
    const target = actorAt(nx, ny);
    if (target && target.kind === "enemy") {
      state.dashActive = false;
      state.pendingDash = null;
      if (MD.hasStatus(p, "confuse")) {
        // confused attack still happens if we stepped into them via random dir
      }
      playerMelee(target);
      MD.tickStatuses(p);
      playPlayerAnimThen("attack", function () {
        if (state.mode !== "dungeon" || !state.player) return;
        afterPlayerAction();
        updateUI();
      });
      return "attacked";
    }
    if (target) {
      state.dashActive = false;
      return "blocked";
    }

    p.x = nx;
    p.y = ny;
    if (fromDash || state.dashActive) {
      if (p.anim !== "run") p.animT0 = performance.now();
      p.anim = "run";
    } else {
      if (p.anim !== "walk") p.animT0 = performance.now();
      p.anim = "walk";
    }
    MD.tickStatuses(p);
    afterPlayerAction();
    return "moved";
  }

  function waitTurn() {
    if (state.animLock) return;
    const p = state.player;
    if (p && p.alive) {
      p.anim = "defend";
      p.animT0 = performance.now();
    }
    tryPlayerMove(0, 0, false);
  }

  function shouldStopDash(x, y, dx, dy) {
    // Stop at junction: more than 2 orthogonal floors (corridor branch) or room entry
    const rid = MD.getRoomId(state.map, x, y);
    const prevRid = MD.getRoomId(state.map, x - dx, y - dy);
    if (rid >= 0 && (prevRid == null || prevRid < 0 || prevRid !== rid)) {
      // entered a room
      return true;
    }
    const deg = MD.orthoFloorDegree(state.map, x, y);
    if (deg >= 3) return true; // junction
    // Enemy in LOS
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (MD.canSee(state.map, x, y, e.x, e.y)) return true;
    }
    // Item on tile
    if (itemAt(x, y)) return true;
    // Stairs
    if (state.map.tiles[y][x] === MD.TILE.STAIRS) return true;
    // Next step blocked or would attack
    if (!MD.canStep(state.map, x, y, dx, dy)) return true;
    const nx = x + dx, ny = y + dy;
    if (actorAt(nx, ny)) return true;
    return false;
  }

  function startDash(dx, dy) {
    state.dashActive = true;
    state.pendingDash = { dx, dy };
    const r = tryPlayerMove(dx, dy, true);
    if (r === "blocked" || r === "attacked" || r === "none") {
      state.dashActive = false;
      state.pendingDash = null;
      return;
    }
    // If after move we should stop, clear dash
    if (shouldStopDash(state.player.x, state.player.y, dx, dy)) {
      state.dashActive = false;
      state.pendingDash = null;
    }
  }

  function continueDash(dx, dy) {
    if (!state.dashActive) return;
    if (shouldStopDash(state.player.x, state.player.y, dx, dy)) {
      // One more check: if we're ON a stop condition already after last move, halt
      // But allow continuing if only junction behind us — shouldStopDash true means stop NOW before next
      state.dashActive = false;
      state.pendingDash = null;
      updateUI();
      return;
    }
    const r = tryPlayerMove(dx, dy, true);
    if (r !== "moved") {
      state.dashActive = false;
      state.pendingDash = null;
      return;
    }
    if (shouldStopDash(state.player.x, state.player.y, dx, dy)) {
      state.dashActive = false;
      state.pendingDash = null;
    }
  }

  function enemyTurns() {
    const p = state.player;
    // Copy list — may mutate
    const list = state.enemies.filter((e) => e.alive);
    for (const e of list) {
      if (!e.alive || !p.alive) continue;

      if (MD.hasStatus(e, "sleep") || MD.hasStatus(e, "para")) {
        MD.tickStatuses(e);
        continue;
      }

      let confuse = MD.hasStatus(e, "confuse");
      const see = MD.canSee(state.map, e.x, e.y, p.x, p.y);

      if (confuse) {
        const step = MD.randomDirStep(state.map, allActors(), e);
        if (step) {
          const t = actorAt(step.x, step.y);
          if (t && t !== e) {
            // attack whoever
            if (t.kind === "player") enemyMelee(e);
            else {
              const dmg = MD.meleeDamage(e.atk, t.def);
              log(e.name + "混乱中打了" + t.name + "（" + dmg + "）。", "warn");
              applyDamage(t, dmg, e.name);
            }
          } else {
            if (MD.setFacing) MD.setFacing(e, step.x - e.x, step.y - e.y);
            e.x = step.x;
            e.y = step.y;
          }
        }
        MD.tickStatuses(e);
        continue;
      }

      if (see) {
        if (MD.isAdjacent(e, p)) {
          if (MD.setFacing) MD.setFacing(e, p.x - e.x, p.y - e.y);
          enemyMelee(e);
        } else {
          const step = MD.stepToward(state.map, allActors(), e, p.x, p.y);
          if (step) {
            if (MD.setFacing) MD.setFacing(e, step.x - e.x, step.y - e.y);
            e.x = step.x;
            e.y = step.y;
          }
        }
      } else {
        // wander 30%
        if (Math.random() < 0.3) {
          const step = MD.randomDirStep(state.map, allActors(), e);
          if (step) {
            if (MD.setFacing) MD.setFacing(e, step.x - e.x, step.y - e.y);
            e.x = step.x;
            e.y = step.y;
          }
        }
      }
      MD.tickStatuses(e);
    }
  }

  // --- Items ---
  function eatItem(index) {
    const item = state.bag[index];
    if (!item) return;
    if (item.type === "onigiri") {
      applyFood(50);
      bagClear(index);
      log("吃了饭团。", "good");
    } else if (item.type === "bigOnigiri") {
      applyFood(100);
      bagClear(index);
      log("吃了大饭团。", "good");
    } else if (item.type === "sleepHerb") {
      bagClear(index);
      MD.addStatus(state.player, "sleep", MD.randInt(4, 6));
      log("吃了睡眠草……睡着了。", "warn");
    } else {
      log("这个不能吃。");
      return;
    }
    closeInv();
    afterItemUseTurn();
  }

  function applyFood(amount) {
    const p = state.player;
    if (p.belly >= p.maxBelly) {
      if (p.maxBelly < 200) {
        p.maxBelly = Math.min(200, p.maxBelly + 5);
        log("最大饱食度上升了！", "good");
      }
      p.belly = p.maxBelly;
    } else {
      p.belly = Math.min(p.maxBelly, p.belly + amount);
      if (p.belly >= p.maxBelly && p.maxBelly < 200 && amount >= 100) {
        // big fill while nearly full — optional raise handled when already full
      }
    }
    state.lastBellyWarn = p.belly;
  }

  function afterItemUseTurn() {
    // Player spent a turn using item; statuses for player: eatItem may have added sleep
    // Tick player status once (duration ticks on actor's turn)
    // Note: if we just applied sleep, ticking immediately reduces duration by 1 — OK for MD feel
    if (!MD.hasStatus(state.player, "sleep") && !MD.hasStatus(state.player, "para")) {
      MD.tickStatuses(state.player);
    } else {
      MD.tickStatuses(state.player);
    }
    tryPickup(true);
    checkMonsterHouse();
    hungerAndRegen();
    enemyTurns();
    spawnWanderer();
    refreshFOV();
    if (!state.player.alive || state.player.hp <= 0) onDeath();
    renderSkills();
    updateUI();
  }

  function beginAim(action, slotIndex) {
    state.aiming = { action, slotIndex };
    state.invOpen = true;
    document.getElementById("aimHint").classList.remove("hidden");
    renderInv();
  }

  function cancelAim() {
    state.aiming = null;
    document.getElementById("aimHint").classList.add("hidden");
    renderInv();
  }

  function resolveAim(dx, dy) {
    if (!state.aiming) return;
    if (dx === 0 && dy === 0) return;
    facePlayer(dx, dy);
    const { action, slotIndex } = state.aiming;
    const item = state.bag[slotIndex];
    state.aiming = null;
    document.getElementById("aimHint").classList.add("hidden");
    closeInv();
    if (!item) return;

    const src = { place: "bag", index: slotIndex };
    if (action === "throw") {
      doThrow(item, src, dx, dy);
    } else if (action === "swing") {
      doSwing(item, src, dx, dy);
    }
  }

  function rayCast(x, y, dx, dy, maxRange) {
    const cells = [];
    let cx = x, cy = y;
    for (let i = 0; i < maxRange; i++) {
      // diagonal corner rule for projectile? use walk check from previous
      if (!MD.canStep(state.map, cx, cy, dx, dy)) {
        // blocked by wall — stop before
        break;
      }
      cx += dx;
      cy += dy;
      cells.push({ x: cx, y: cy });
      const a = actorAt(cx, cy);
      if (a) break;
    }
    return cells;
  }

  function doThrow(item, src, dx, dy) {
    const range = item.type === "knockStaff" ? 10 : 8;
    const path = rayCast(state.player.x, state.player.y, dx, dy, range);
    consumeFrom(src);

    if (!path.length) {
      log("扔到了墙上。");
      // item destroyed / lost for rock etc.
      afterItemUseTurn();
      return;
    }
    const last = path[path.length - 1];
    const hit = actorAt(last.x, last.y);

    if (item.type === "rock") {
      if (hit) {
        log("石头击中了" + hit.name + "！");
        applyDamage(hit, 8, "rock");
      } else {
        log("石头落在了地上。");
        // leave rock on floor
        state.items.push({ ...MD.makeItem("rock"), x: last.x, y: last.y });
      }
    } else if (item.type === "sleepHerb") {
      if (hit) {
        MD.addStatus(hit, "sleep", MD.randInt(4, 6));
        log("睡眠草击中了" + hit.name + "！", "good");
      } else {
        state.items.push({ ...MD.makeItem("sleepHerb"), x: last.x, y: last.y });
        log("睡眠草落在了地上。");
      }
    } else if (item.type === "onigiri" || item.type === "bigOnigiri") {
      if (hit) {
        log(MD.displayName(item) + "砸中了" + hit.name + "（1）。");
        applyDamage(hit, 1, "food");
      } else {
        state.items.push({ ...MD.makeItem(item.type), x: last.x, y: last.y });
        log(MD.displayName(item) + "落在了地上。");
      }
    } else if (item.type === "knockStaff") {
      // throw staff: knock once and destroy
      if (hit) {
        log("扔出的击退之杖击中了" + hit.name + "！", "good");
        knockback(hit, dx, dy);
      } else {
        log("击退之杖摔碎了。");
      }
    }
    afterItemUseTurn();
  }

  function doSwing(item, src, dx, dy) {
    if (item.type !== "knockStaff") return;
    if ((item.charges | 0) <= 0) {
      log("杖的次数已经用尽了。", "warn");
      afterItemUseTurn();
      return;
    }
    item.charges -= 1;
    item.name = "击退之杖 [" + item.charges + "]";
    if (src && src.place === "skill" && item.charges <= 0) {
      consumeFrom(src);
    } else {
      writeBackItem(src, item);
    }

    // infinite range bolt
    const path = rayCast(state.player.x, state.player.y, dx, dy, 100);
    if (!path.length) {
      log("挥空了。");
      afterItemUseTurn();
      return;
    }
    const last = path[path.length - 1];
    const hit = actorAt(last.x, last.y);
    if (hit) {
      log("击退之杖命中了" + hit.name + "！", "good");
      knockback(hit, dx, dy);
    } else {
      log("杖光消失在远处。");
    }
    afterItemUseTurn();
  }

  function knockback(actor, dx, dy) {
    // Knock until wall
    let guard = 0;
    while (guard++ < 100) {
      if (!MD.canStep(state.map, actor.x, actor.y, dx, dy)) {
        // hit wall — extra 5 dmg
        applyDamage(actor, 5, "wall");
        log(actor.name + "撞到了墙！", "warn");
        break;
      }
      const nx = actor.x + dx, ny = actor.y + dy;
      if (actorAt(nx, ny)) {
        // blocked by another actor — stop, no wall dmg
        break;
      }
      actor.x = nx;
      actor.y = ny;
    }
  }

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
    const [wx, wy] = toWorldDir(sx, sy);
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
    if (bagDragFrom >= 0) return;
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
      if (Number.isNaN(from)) from = bagDragFrom;
      if (Number.isNaN(from) || from < 0) return;
      bagDropConsumedClick = true;
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

  let bagDragFrom = -1;
  let bagDropConsumedClick = false;

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
      bagDragFrom = index;
      e.dataTransfer.setData("text/plain", String(index));
      e.dataTransfer.setData("text/md-bag", String(index));
      e.dataTransfer.effectAllowed = "move";
      slot.classList.add("dragging");
    });
    slot.addEventListener("dragend", () => {
      bagDragFrom = -1;
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
      if (Number.isNaN(from)) from = bagDragFrom;
      if (Number.isNaN(from) || from < 0) return;
      if (swapBagSlots(from, index)) {
        bagDropConsumedClick = true;
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
        if (bagDropConsumedClick) {
          bagDropConsumedClick = false;
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


  function toWorldDir(dx, dy) {
    if (use3d && MD.view3d && typeof MD.view3d.screenToTileDir === "function") {
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

  function updateUI() {
    MD.updateSidePanel(state);
  }

  function frame() {
    const wrap = canvas.parentElement;
    const cw = Math.max(320, wrap.clientWidth);
    const ch = Math.max(280, wrap.clientHeight);
    if (use3d) {
      MD.view3d.resize(cw, ch);
      MD.view3d.sync(state);
      MD.view3d.render();
      if (overlay && overlayCtx) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const ow = Math.max(1, Math.floor(cw * dpr));
        const oh = Math.max(1, Math.floor(ch * dpr));
        if (overlay.width !== ow || overlay.height !== oh) {
          overlay.width = ow;
          overlay.height = oh;
        }
        overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        overlayCtx.clearRect(0, 0, cw, ch);
        MD.drawOverlay(overlayCtx, state, cw, ch);
      }
    } else {
      const cols = Math.floor(cw / MD.TILE_PX);
      const rows = Math.floor(ch / MD.TILE_PX);
      const tw = cols * MD.TILE_PX;
      const th = rows * MD.TILE_PX;
      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
      }
      MD.drawGame(ctx, state);
    }
    requestAnimationFrame(frame);
  }

  // Boot
  initSkillBar();
  renderSkills();
  log("欢迎。", "good");
  showOverlay("townOverlay");
  updateUI();
  canvas.focus();
  requestAnimationFrame(frame);

  // Expose for debug
  window.MD_STATE = state;
})();
