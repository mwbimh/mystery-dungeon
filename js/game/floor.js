/* 迷宫 — floor setup, town/dungeon transitions, pickup, monster houses */
(function () {
  const MD = window.MD;
  const G = MD.game;
  const { MAX_MONSTERS, actorAt, bagFreeIndex, bagPut, canvas, hideOverlay, itemAt, log, padBag,
    refreshFOV, showOverlay, state, updateUI } = G;

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
    state.theme = MD.themeForFloor(floorNum);
    if (MD.view3d && MD.view3d.setTheme) MD.view3d.setTheme(state.theme);
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
        const pre = Math.min(2, Math.floor(area / 12));
        placeEnemies(pre, r.id, true);
        // Extra items in MH
        placeItems(MD.randInt(4, 7), (rid) => rid === r.id);
      } else {
        const n = Math.random() < 0.45 ? 1 : 0;
        if (n) placeEnemies(n, r.id, false);
      }
    }
    // Sparse corridor / leftover monsters if under soft count
    const alive = () => state.enemies.filter((e) => e.alive).length;
    while (alive() < Math.min(5, 2 + Math.floor(floorNum / 3)) && alive() < MAX_MONSTERS) {
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
    if (MD.story) MD.story.trigger("floor", { floor: floorNum });
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
    G.closeWarehouse(true);
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
    G.cancelSkillAim();
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
    const after = state.endKind;
    state.endKind = null;
    if (MD.story) MD.story.trigger("town", { after: after });
  }

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
    if (state.invOpen) G.renderInv();
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

  function spawnWanderer() {
    if (state.spawnCounter < 55) return;
    state.spawnCounter = 0;
    const alive = state.enemies.filter((e) => e.alive).length;
    if (alive >= MAX_MONSTERS) return;
    const rid = MD.getRoomId(state.map, state.player.x, state.player.y);
    const tiles = emptyFloorTiles(rid >= 0 ? rid : null);
    if (!tiles.length) return;
    const t = tiles[MD.randInt(0, tiles.length - 1)];
    state.enemies.push(MD.makeEnemy(MD.pickEnemyType(state.floor), t.x, t.y));
  }

  Object.assign(G, {
    setupFloor, enterDungeon, returnToTown, tryPickup, checkMonsterHouse,
    spawnWanderer,
  });
})();
