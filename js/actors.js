/* Actors, combat, AI */
(function (global) {
  const MD = global.MD;

  const DIRS8 = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  const ENEMY_DEFS = {
    slime: { id: "slime", name: "史莱姆", color: "#6ee7b7", hp: 6, atk: 3, def: 0, glyph: "史" },
    bat: { id: "bat", name: "蝙蝠", color: "#c4b5fd", hp: 5, atk: 4, def: 0, glyph: "蝠" },
    shell: { id: "shell", name: "甲壳", color: "#94a3b8", hp: 12, atk: 5, def: 2, glyph: "甲" },
  };

  function makePlayer(x, y) {
    return {
      kind: "player",
      name: "你",
      x, y,
      hp: 30, maxHp: 30,
      atk: 7, def: 2,
      belly: 100, maxBelly: 100,
      statuses: [], // {type, turns}
      alive: true,
      color: "#5eead4",
      facingDx: 0,
      facingDy: 1, // south (+Z)
      anim: "idle",
      animT0: 0,
    };
  }

  function makeEnemy(type, x, y) {
    const d = ENEMY_DEFS[type];
    return {
      kind: "enemy",
      type,
      name: d.name,
      x, y,
      hp: d.hp, maxHp: d.hp,
      atk: d.atk, def: d.def,
      color: d.color,
      glyph: d.glyph,
      statuses: [],
      alive: true,
      facingDx: 0,
      facingDy: 1,
    };
  }

  function pickEnemyType(floorNum) {
    if (floorNum >= 4) {
      const r = Math.random();
      if (r < 0.35) return "slime";
      if (r < 0.65) return "bat";
      return "shell";
    }
    if (floorNum >= 2) {
      return Math.random() < 0.55 ? "slime" : "bat";
    }
    return Math.random() < 0.7 ? "slime" : "bat";
  }

  function meleeDamage(atk, def) {
    const roll = MD.randInt(-1, 1);
    return Math.max(1, atk - def + roll);
  }

  function hasStatus(actor, type) {
    return actor.statuses.some((s) => s.type === type && s.turns > 0);
  }

  function addStatus(actor, type, turns) {
    const existing = actor.statuses.find((s) => s.type === type);
    if (existing) {
      existing.turns = Math.max(existing.turns, turns);
    } else {
      actor.statuses.push({ type, turns });
    }
  }

  function tickStatuses(actor) {
    for (const s of actor.statuses) s.turns -= 1;
    actor.statuses = actor.statuses.filter((s) => s.turns > 0);
  }

  function wakeIfDamaged(actor) {
    const sleep = actor.statuses.find((s) => s.type === "sleep");
    if (sleep) {
      actor.statuses = actor.statuses.filter((s) => s.type !== "sleep");
      return true;
    }
    return false;
  }

  /** Simple BFS path one step toward target, 8-dir, respect corner rule & occupancy */
  function stepToward(map, actors, self, tx, ty) {
    const occ = new Set();
    for (const a of actors) {
      if (!a.alive) continue;
      if (a === self) continue;
      occ.add(MD.key(a.x, a.y));
    }
    // Allow stepping onto player tile for attack check handled by caller — AI uses adjacent attack separately
    // Here we path to adjacent walkable of target
    const w = map.width, h = map.height;
    const start = MD.key(self.x, self.y);
    const goalKeys = new Set();
    // Prefer being adjacent; also allow goal tile if empty (shouldn't be for player)
    for (const [dx, dy] of DIRS8) {
      const gx = tx + dx, gy = ty + dy;
      if (MD.canStep(map, tx, ty, dx, dy) || MD.isWalkable(map, gx, gy)) {
        // actually we want tiles from which we can be next to target — path to target itself and stop when adjacent
      }
    }

    // BFS from self toward target position; move onto target only if it's the player (attack handled outside)
    const q = [[self.x, self.y]];
    const prev = new Map();
    prev.set(start, null);
    let found = null;
    const maxVisit = 400;
    let visits = 0;
    while (q.length && visits < maxVisit) {
      visits++;
      const [x, y] = q.shift();
      if (x === tx && y === ty) {
        found = MD.key(x, y);
        break;
      }
      // If adjacent to target, good enough goal for approach
      if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 1 && !(x === self.x && y === self.y)) {
        // continue searching for closer / exact; mark candidate
        if (!found) found = MD.key(x, y);
      }
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx, ny = y + dy;
        if (!MD.canStep(map, x, y, dx, dy)) continue;
        const k = MD.key(nx, ny);
        if (prev.has(k)) continue;
        // Can't walk through other enemies (player tile allowed as goal)
        if (occ.has(k) && !(nx === tx && ny === ty)) continue;
        prev.set(k, MD.key(x, y));
        q.push([nx, ny]);
      }
    }

    // Prefer exact target in prev
    let end = prev.has(MD.key(tx, ty)) ? MD.key(tx, ty) : found;
    if (!end || end === start) {
      // Greedy fallback
      return greedyStep(map, actors, self, tx, ty, occ);
    }
    // Walk back to first step
    let cur = end;
    let parent = prev.get(cur);
    while (parent && parent !== start) {
      cur = parent;
      parent = prev.get(cur);
    }
    if (!parent) return null;
    const [sx, sy] = cur.split(",").map(Number);
    // Don't step onto target if occupied by player — caller attacks instead
    if (sx === tx && sy === ty) return null;
    if (occ.has(MD.key(sx, sy))) return null;
    return { x: sx, y: sy };
  }

  function greedyStep(map, actors, self, tx, ty, occ) {
    let best = null, bestScore = Infinity;
    for (const [dx, dy] of DIRS8) {
      if (!MD.canStep(map, self.x, self.y, dx, dy)) continue;
      const nx = self.x + dx, ny = self.y + dy;
      if (occ.has(MD.key(nx, ny))) continue;
      if (nx === tx && ny === ty) continue;
      const score = Math.max(Math.abs(nx - tx), Math.abs(ny - ty));
      if (score < bestScore) {
        bestScore = score;
        best = { x: nx, y: ny };
      }
    }
    return best;
  }

  function isAdjacent(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
  }

  function chebyshev(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  function randomDirStep(map, actors, self) {
    const occ = new Set();
    for (const a of actors) {
      if (!a.alive || a === self) continue;
      occ.add(MD.key(a.x, a.y));
    }
    const opts = MD.shuffle(DIRS8.slice());
    for (const [dx, dy] of opts) {
      if (!MD.canStep(map, self.x, self.y, dx, dy)) continue;
      const nx = self.x + dx, ny = self.y + dy;
      if (occ.has(MD.key(nx, ny))) continue;
      return { x: nx, y: ny, dx, dy };
    }
    return null;
  }

  MD.DIRS8 = DIRS8;
  MD.ENEMY_DEFS = ENEMY_DEFS;
  MD.makePlayer = makePlayer;
  MD.makeEnemy = makeEnemy;
  MD.pickEnemyType = pickEnemyType;
  MD.meleeDamage = meleeDamage;
  MD.hasStatus = hasStatus;
  MD.addStatus = addStatus;
  MD.tickStatuses = tickStatuses;
  MD.wakeIfDamaged = wakeIfDamaged;
  MD.stepToward = stepToward;
  MD.isAdjacent = isAdjacent;
  MD.chebyshev = chebyshev;
  function setFacing(actor, dx, dy) {
    if (!actor) return;
    if (!dx && !dy) return;
    actor.facingDx = dx;
    actor.facingDy = dy;
  }

  MD.randomDirStep = randomDirStep;
  MD.setFacing = setFacing;
})(typeof window !== "undefined" ? window : globalThis);
