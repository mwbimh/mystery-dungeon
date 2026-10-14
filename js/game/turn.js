/* 迷宫 — combat, turn loop, hunger, movement, dash, enemy AI */
(function () {
  const MD = window.MD;
  const G = MD.game;
  const { TOTAL_FLOORS, actorAt, allActors, checkMonsterHouse, emptyBag, emptySkills, facePlayer,
    itemAt, log, playPlayerAnimThen, refreshFOV, setupFloor, showOverlay, spawnWanderer, state,
    tryPickup, updateUI } = G;

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

  function onDeath() {
    state.player.alive = false;
    state.dashActive = false;
    state.pendingDash = null;
    state.bag = emptyBag(); // lose bag
    state.skills = emptySkills();
    G.renderSkills();
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

  Object.assign(G, {
    applyDamage, playerMelee, afterPlayerAction, hungerAndRegen, onDeath,
    tryPlayerMove, waitTurn, startDash, enemyTurns,
  });
})();
