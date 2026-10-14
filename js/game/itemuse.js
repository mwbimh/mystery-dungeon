/* 迷宫 — item use: eat, throw, swing, aiming, knockback */
(function () {
  const MD = window.MD;
  const G = MD.game;
  const { actorAt, applyDamage, bagClear, checkMonsterHouse, consumeFrom, enemyTurns, facePlayer,
    hungerAndRegen, log, onDeath, refreshFOV, spawnWanderer, state, tryPickup, updateUI,
    writeBackItem } = G;

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
    G.closeInv();
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
    G.renderSkills();
    updateUI();
  }

  function beginAim(action, slotIndex) {
    state.aiming = { action, slotIndex };
    state.invOpen = true;
    document.getElementById("aimHint").classList.remove("hidden");
    G.renderInv();
  }

  function cancelAim() {
    state.aiming = null;
    document.getElementById("aimHint").classList.add("hidden");
    G.renderInv();
  }

  function resolveAim(dx, dy) {
    if (!state.aiming) return;
    if (dx === 0 && dy === 0) return;
    facePlayer(dx, dy);
    const { action, slotIndex } = state.aiming;
    const item = state.bag[slotIndex];
    state.aiming = null;
    document.getElementById("aimHint").classList.add("hidden");
    G.closeInv();
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

  Object.assign(G, {
    eatItem, beginAim, cancelAim, resolveAim, doThrow, doSwing,
  });
})();
