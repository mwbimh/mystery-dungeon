/* 迷宫 3D — actor & item billboards */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { HOP_MS, S, actorPool, actorVisual, allocActor, allocItem, isWall, itemPool, itemVisual,
    paperSortOrder, setPaper, updateMonsterSprite, updatePlayerSprite } = V;

  function actorId(a) {
    if (!a._vid) a._vid = "a" + (V.vidSeq++);
    return a._vid;
  }

  function spriteNameForActor(a) {
    if (a.kind === "player") return "player";
    if (a.type === "slime") return "slime";
    if (a.type === "bat") return "bat";
    if (a.type === "shell") return "shell";
    return "slime";
  }

  function spriteNameForItem(it) {
    const tp = it && it.type;
    if (tp === "onigiri" || tp === "bigOnigiri" || tp === "rock" || tp === "sleepHerb" || tp === "knockStaff") return tp;
    return "rock";
  }

  function hideUnused(map, live) {
    map.forEach(function (vis, id) {
      if (!live.has(id)) {
        vis.group.userData.inUse = false;
        vis.group.visible = false;
        map.delete(id);
      }
    });
  }

  function billboard(paper, baseY) {
    if (!paper || !V.camera || !paper.parent) return;
    // Face the screen (parallel to view).
    paper.quaternion.copy(V.camera.quaternion);
    paper.rotateY(Math.PI);
    // Pull toward camera so the leaning plane does not sink into walls/floor behind.
    const g = paper.parent;
    const dx = V.camera.position.x - g.position.x;
    const dy = V.camera.position.y - g.position.y;
    const dz = V.camera.position.z - g.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    if (paper.userData.kind === "deco") {
      paper.quaternion.identity();
      paper.rotation.set(0, Math.atan2(dx, dz), 0);
      paper.position.set(0, baseY != null ? baseY : 0.02, 0);
    } else {
      const pull = paper.userData.kind === "item" ? 0.28 : 0.48;
      const y0 = baseY != null ? baseY : 0.03;
      paper.position.set((dx / len) * pull, y0 + (dy / len) * pull * 0.2, (dz / len) * pull);
    }
    const layer = paper.userData.kind === "actor" ? 2 : paper.userData.kind === "item" ? 1 : 0;
    paper.renderOrder = paperSortOrder(g, layer);
  }

  /** Nudge standing sprites away from adjacent wall cells to reduce side clipping. */
  function wallClearance(map, tileX, tileY) {
    let ox = 0, oz = 0;
    if (!map) return { x: 0, z: 0 };
    const push = 0.18;
    if (isWall(map, tileX + 1, tileY)) ox -= push;
    if (isWall(map, tileX - 1, tileY)) ox += push;
    if (isWall(map, tileX, tileY + 1)) oz -= push;
    if (isWall(map, tileX, tileY - 1)) oz += push;
    // Corners: slightly stronger diagonal push
    if (isWall(map, tileX + 1, tileY + 1)) { ox -= push * 0.35; oz -= push * 0.35; }
    if (isWall(map, tileX - 1, tileY + 1)) { ox += push * 0.35; oz -= push * 0.35; }
    if (isWall(map, tileX + 1, tileY - 1)) { ox -= push * 0.35; oz += push * 0.35; }
    if (isWall(map, tileX - 1, tileY - 1)) { ox += push * 0.35; oz += push * 0.35; }
    return { x: ox, z: oz };
  }

  function hopY(vis, now) {
    const t = Math.min(1, (now - vis.t0) / HOP_MS);
    if (t >= 1) {
      vis.x = vis.toX;
      vis.z = vis.toZ;
      return 0;
    }
    const e = 1 - (1 - t) * (1 - t);
    vis.x = vis.fromX + (vis.toX - vis.fromX) * e;
    vis.z = vis.fromZ + (vis.toZ - vis.fromZ) * e;
    return Math.sin(t * Math.PI) * 0.16;
  }

  function ensureVisual(store, id, alloc, name, kind, tx, tz, now, snap) {
    let vis = store.get(id);
    if (!vis) {
      const g = alloc();
      g.userData.inUse = true;
      g.visible = true;
      setPaper(g, name, kind);
      vis = {
        group: g,
        x: tx, z: tz,
        fromX: tx, fromZ: tz,
        toX: tx, toZ: tz,
        t0: now - HOP_MS,
      };
      store.set(id, vis);
      g.position.set(tx, 0, tz);
    } else {
      vis.group.userData.inUse = true;
      vis.group.visible = true;
      setPaper(vis.group, name, kind);
      if (snap) {
        vis.x = vis.toX = vis.fromX = tx;
        vis.z = vis.toZ = vis.fromZ = tz;
        vis.t0 = now - HOP_MS;
      } else if (tx !== vis.toX || tz !== vis.toZ) {
        vis.fromX = vis.x;
        vis.fromZ = vis.z;
        vis.toX = tx;
        vis.toZ = tz;
        vis.t0 = now;
      }
    }
    return vis;
  }

  function updateActors(state, now) {
    const live = new Set();
    const debug = state.debug;
    const visible = state.visible || new Set();

    function show(actor, name) {
      const k = MD.key(actor.x, actor.y);
      const inVis = debug || visible.has(k) || actor.kind === "player";
      if (!inVis) return;
      const id = actorId(actor);
      live.add(id);
      const vis = ensureVisual(actorVisual, id, allocActor, name, "actor", actor.x * S, actor.y * S, now, false);
      const hop = hopY(vis, now);
      const bob = name === "bat" ? Math.sin(now * 0.008 + actor.x) * 0.06 + 0.12 : Math.sin(now * 0.003 + actor.x) * 0.015;
      const clear = wallClearance(state.map, actor.x, actor.y);
      vis.group.position.set(vis.x + clear.x, 0, vis.z + clear.z);
      billboard(vis.group.userData.paper, 0.03 + hop + bob);
      if (name === "player") {
        updatePlayerSprite(vis.group.userData.paper, actor, state, vis, now);
      } else if (name === "slime" || name === "bat") {
        updateMonsterSprite(vis.group.userData.paper, actor, name);
      }
      const badge = vis.group.userData.badge;
      if (badge) {
        const st = actor.statuses && actor.statuses[0];
        if (st) {
          badge.visible = true;
          badge.material.color.set(
            st.type === "sleep" ? 0xa78bfa : st.type === "confuse" ? 0xf5c16c : 0xff7b72
          );
          badge.position.y = (vis.group.userData.paper && vis.group.userData.paper.userData.h || 1) + 0.2 + hop + bob;
        } else badge.visible = false;
      }
    }

    if (state.player) show(state.player, "player");
    if (state.enemies) {
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (!e.alive) continue;
        show(e, spriteNameForActor(e));
      }
    }
    hideUnused(actorVisual, live);
  }

  function updateItems(state, now) {
    const live = new Set();
    const debug = state.debug;
    const visible = state.visible || new Set();
    if (state.items) {
      for (let i = 0; i < state.items.length; i++) {
        const it = state.items[i];
        const k = MD.key(it.x, it.y);
        if (!debug && !visible.has(k)) continue;
        const id = it.uid || (it.uid = "i" + (V.vidSeq++));
        live.add(id);
        const name = spriteNameForItem(it);
        const vis = ensureVisual(itemVisual, id, allocItem, name, "item", it.x * S, it.y * S, now, true);
        const clear = wallClearance(state.map, it.x, it.y);
        vis.group.position.set(it.x * S + clear.x * 0.5, 0, it.y * S + clear.z * 0.5);
        if (vis.group.userData.paper) {
          billboard(vis.group.userData.paper, 0.04);
        }
      }
    }
    hideUnused(itemVisual, live);
  }

  function hideAllSprites() {
    actorPool.forEach(function (g) { g.userData.inUse = false; g.visible = false; });
    itemPool.forEach(function (g) { g.userData.inUse = false; g.visible = false; });
    actorVisual.clear();
    itemVisual.clear();
    if (V.stairsRoot) V.stairsRoot.visible = false;
    if (V.stairsLight) V.stairsLight.visible = false;
  }

  Object.assign(V, {
    billboard, wallClearance, updateActors, updateItems, hideAllSprites,
  });
})(typeof window !== "undefined" ? window : globalThis);
