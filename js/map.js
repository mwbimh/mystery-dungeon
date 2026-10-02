/* Map generation for 迷宫 */
(function (global) {
  const MD = global.MD;
  const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2 };

  function randInt(a, b) {
    return a + Math.floor(MD.random() * (b - a + 1));
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(MD.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function key(x, y) {
    return x + "," + y;
  }

  function carveRect(tiles, roomIds, x0, y0, w, h, roomId) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        tiles[y][x] = TILE.FLOOR;
        roomIds[y][x] = roomId;
      }
    }
  }

  function carveCorridor(tiles, roomIds, x0, y0, x1, y1) {
    let x = x0, y = y0;
    // L-shaped: horizontal then vertical, or reverse randomly
    if (MD.random() < 0.5) {
      while (x !== x1) {
        tiles[y][x] = TILE.FLOOR;
        if (roomIds[y][x] === undefined || roomIds[y][x] === null) roomIds[y][x] = -1;
        else if (roomIds[y][x] !== -1 && (tiles[y][x] === TILE.FLOOR)) { /* keep room */ }
        if (roomIds[y][x] == null) roomIds[y][x] = -1;
        x += x1 > x ? 1 : -1;
      }
      while (y !== y1) {
        tiles[y][x] = TILE.FLOOR;
        if (roomIds[y][x] == null) roomIds[y][x] = -1;
        y += y1 > y ? 1 : -1;
      }
    } else {
      while (y !== y1) {
        tiles[y][x] = TILE.FLOOR;
        if (roomIds[y][x] == null) roomIds[y][x] = -1;
        y += y1 > y ? 1 : -1;
      }
      while (x !== x1) {
        tiles[y][x] = TILE.FLOOR;
        if (roomIds[y][x] == null) roomIds[y][x] = -1;
        x += x1 > x ? 1 : -1;
      }
    }
    tiles[y1][x1] = TILE.FLOOR;
    if (roomIds[y1][x1] == null) roomIds[y1][x1] = -1;
  }

  function neighbors4(x, y) {
    return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
  }

  function floodFillReachable(tiles, sx, sy) {
    const h = tiles.length, w = tiles[0].length;
    const seen = new Set();
    const q = [[sx, sy]];
    seen.add(key(sx, sy));
    while (q.length) {
      const [x, y] = q.shift();
      for (const [nx, ny] of neighbors4(x, y)) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (tiles[ny][nx] === TILE.WALL) continue;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  /**
   * Generate a floor map.
   * @returns {{width,height,tiles,roomIds,rooms,stairs,playerSpawn,monsterHouseRooms}}
   */
  function generateFloor(floorNum) {
    const width = randInt(MD.config.map.width.min, MD.config.map.width.max);
    const height = randInt(MD.config.map.height.min, MD.config.map.height.max);
    const tiles = Array.from({ length: height }, () => Array(width).fill(TILE.WALL));
    const roomIds = Array.from({ length: height }, () => Array(width).fill(null));

    const cols = width >= 56 ? 4 : 3;
    const rows = 3;
    const margin = 1;
    const cellW = Math.floor((width - margin * 2) / cols);
    const cellH = Math.floor((height - margin * 2) / rows);

    const rooms = []; // {id,x,y,w,h,cx,cy,slotR,slotC,isMonsterHouse,merged}
    let nextId = 0;

    // Decide which slots get rooms; ensure enough rooms
    const slotPlan = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        slotPlan.push({ r, c, skip: MD.random() < MD.config.map.skipRoomChance });
      }
    }
    // Guarantee at least 5 rooms
    let active = slotPlan.filter((s) => !s.skip);
    while (active.length < 5) {
      const skipped = slotPlan.filter((s) => s.skip);
      if (!skipped.length) break;
      const pick = skipped[randInt(0, skipped.length - 1)];
      pick.skip = false;
      active = slotPlan.filter((s) => !s.skip);
    }

    // Occasional large hall: merge 2 adjacent rooms horizontally
    let hallPair = null;
    if (MD.random() < MD.config.map.hallChance) {
      const candidates = [];
      for (const s of active) {
        const right = active.find((o) => o.r === s.r && o.c === s.c + 1);
        if (right) candidates.push([s, right]);
      }
      if (candidates.length) {
        hallPair = candidates[randInt(0, candidates.length - 1)];
      }
    }

    function placeRoomInSlot(slot, forceRect) {
      const ox = margin + slot.c * cellW;
      const oy = margin + slot.r * cellH;
      let rw, rh, rx, ry;
      if (forceRect) {
        rw = forceRect.w;
        rh = forceRect.h;
        rx = forceRect.x;
        ry = forceRect.y;
      } else {
        const maxW = Math.max(5, cellW - 3);
        const maxH = Math.max(4, cellH - 3);
        rw = randInt(5, Math.min(12, maxW));
        rh = randInt(4, Math.min(9, maxH));
        rx = ox + randInt(1, Math.max(1, cellW - rw - 1));
        ry = oy + randInt(1, Math.max(1, cellH - rh - 1));
        // Clamp
        if (rx + rw >= width - 1) rx = width - 1 - rw;
        if (ry + rh >= height - 1) ry = height - 1 - rh;
        if (rx < 1) rx = 1;
        if (ry < 1) ry = 1;
      }
      const id = nextId++;
      carveRect(tiles, roomIds, rx, ry, rw, rh, id);
      const room = {
        id,
        x: rx,
        y: ry,
        w: rw,
        h: rh,
        cx: rx + Math.floor(rw / 2),
        cy: ry + Math.floor(rh / 2),
        slotR: slot.r,
        slotC: slot.c,
        isMonsterHouse: false,
        merged: !!forceRect,
      };
      rooms.push(room);
      return room;
    }

    const placedSlots = new Set();
    if (hallPair) {
      const [a, b] = hallPair;
      const ox = margin + a.c * cellW;
      const oy = margin + a.r * cellH;
      const spanW = cellW * 2 - 2;
      const rw = randInt(Math.min(14, spanW - 2), Math.min(22, spanW));
      const rh = randInt(6, Math.min(10, cellH - 2));
      let rx = ox + randInt(1, Math.max(1, spanW - rw));
      let ry = oy + randInt(1, Math.max(1, cellH - rh - 1));
      if (rx + rw >= width - 1) rx = width - 1 - rw;
      if (ry + rh >= height - 1) ry = height - 1 - rh;
      placeRoomInSlot(a, { x: rx, y: ry, w: rw, h: rh });
      placedSlots.add(a.r + "," + a.c);
      placedSlots.add(b.r + "," + b.c);
    }

    for (const slot of slotPlan) {
      if (slot.skip) continue;
      const k = slot.r + "," + slot.c;
      if (placedSlots.has(k)) continue;
      placeRoomInSlot(slot, null);
      placedSlots.add(k);
    }

    // Connect rooms with MST-like + a few extra edges
    function dist(a, b) {
      return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
    }
    const edges = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        edges.push({ i, j, d: dist(rooms[i], rooms[j]) });
      }
    }
    edges.sort((a, b) => a.d - b.d);
    const parent = rooms.map((_, i) => i);
    function find(i) {
      return parent[i] === i ? i : (parent[i] = find(parent[i]));
    }
    function unite(a, b) {
      a = find(a); b = find(b);
      if (a !== b) parent[a] = b;
    }
    const used = [];
    for (const e of edges) {
      if (find(e.i) !== find(e.j)) {
        unite(e.i, e.j);
        used.push(e);
        carveCorridor(tiles, roomIds, rooms[e.i].cx, rooms[e.i].cy, rooms[e.j].cx, rooms[e.j].cy);
      }
    }
    // Extra loops
    const extras = Math.min(2, Math.floor(edges.length / 4));
    let added = 0;
    for (const e of edges) {
      if (added >= extras) break;
      if (used.includes(e)) continue;
      if (MD.random() < MD.config.map.loopChance) {
        carveCorridor(tiles, roomIds, rooms[e.i].cx, rooms[e.i].cy, rooms[e.j].cx, rooms[e.j].cy);
        added++;
      }
    }

    // Normalize roomIds: walls stay null, floors in corridors get -1, room floors keep id
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tiles[y][x] === TILE.WALL) {
          roomIds[y][x] = null;
        } else if (roomIds[y][x] == null) {
          roomIds[y][x] = -1;
        }
      }
    }

    // Fix any corridor that cut through rooms: keep room id if originally carved as room
    // (already handled by carveRect first)

    // Place stairs in a random room
    const stairRoom = rooms[randInt(0, rooms.length - 1)];
    const stairs = {
      x: stairRoom.x + randInt(1, Math.max(1, stairRoom.w - 2)),
      y: stairRoom.y + randInt(1, Math.max(1, stairRoom.h - 2)),
    };
    tiles[stairs.y][stairs.x] = TILE.STAIRS;

    // Player spawn: farthest room center from stairs
    let best = rooms[0], bestD = -1;
    for (const r of rooms) {
      const d = Math.abs(r.cx - stairs.x) + Math.abs(r.cy - stairs.y);
      if (d > bestD) {
        bestD = d;
        best = r;
      }
    }
    const playerSpawn = {
      x: best.x + randInt(1, Math.max(1, best.w - 2)),
      y: best.y + randInt(1, Math.max(1, best.h - 2)),
    };
    // Ensure not on stairs
    if (playerSpawn.x === stairs.x && playerSpawn.y === stairs.y) {
      playerSpawn.x = best.cx;
      playerSpawn.y = best.cy;
    }

    // Connectivity check — if stairs unreachable from spawn, carve direct corridor
    let reachable = floodFillReachable(tiles, playerSpawn.x, playerSpawn.y);
    if (!reachable.has(key(stairs.x, stairs.y))) {
      carveCorridor(tiles, roomIds, playerSpawn.x, playerSpawn.y, stairs.x, stairs.y);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (tiles[y][x] !== TILE.WALL && roomIds[y][x] == null) roomIds[y][x] = -1;
        }
      }
      tiles[stairs.y][stairs.x] = TILE.STAIRS;
      reachable = floodFillReachable(tiles, playerSpawn.x, playerSpawn.y);
    }

    // Monster houses: 15–25% of non-spawn rooms
    const monsterHouseRooms = [];
    for (const r of rooms) {
      if (r.id === best.id) continue;
      const chance = MD.config.map.monsterHouseChance.min + MD.random() * (MD.config.map.monsterHouseChance.max - MD.config.map.monsterHouseChance.min);
      if (MD.random() < chance) {
        r.isMonsterHouse = true;
        monsterHouseRooms.push(r.id);
      }
    }

    // Mark stairs room id correctly
    roomIds[stairs.y][stairs.x] = stairRoom.id;

    return {
      width,
      height,
      tiles,
      roomIds,
      rooms,
      stairs,
      playerSpawn,
      spawnRoomId: best.id,
      monsterHouseRooms,
      floorNum,
      TILE,
    };
  }

  function isWalkable(map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    return map.tiles[y][x] !== TILE.WALL;
  }

  function getRoomId(map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return map.roomIds[y][x];
  }

  /** Diagonal corner rule: block if either orthogonal adjacent is wall */
  function canStep(map, fromX, fromY, dx, dy) {
    const nx = fromX + dx, ny = fromY + dy;
    if (!isWalkable(map, nx, ny)) return false;
    if (dx !== 0 && dy !== 0) {
      if (!isWalkable(map, fromX + dx, fromY)) return false;
      if (!isWalkable(map, fromX, fromY + dy)) return false;
    }
    return true;
  }

  /** Count orthogonal floor neighbors (for junction detection in dash) */
  function orthoFloorDegree(map, x, y) {
    let n = 0;
    for (const [nx, ny] of neighbors4(x, y)) {
      if (isWalkable(map, nx, ny)) n++;
    }
    return n;
  }

  global.MD = global.MD || {};
  global.MD.TILE = TILE;
  global.MD.generateFloor = generateFloor;
  global.MD.isWalkable = isWalkable;
  global.MD.getRoomId = getRoomId;
  global.MD.canStep = canStep;
  global.MD.orthoFloorDegree = orthoFloorDegree;
  global.MD.randInt = randInt;
  global.MD.shuffle = shuffle;
  global.MD.key = key;
})(typeof window !== "undefined" ? window : globalThis);
