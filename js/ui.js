/* Rendering & DOM UI helpers */
(function (global) {
  const MD = global.MD;
  const TILE_PX = 28;

  function resizeCanvas(canvas, cssW, cssH) {
    // Keep internal resolution matching CSS for crisp tiles
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // We use fixed logical size based on TILE_PX * view
    // Caller sets canvas.width/height in tiles * TILE_PX
  }

  function drawGame(ctx, state) {
    const canvas = ctx.canvas;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#0c1118";
    ctx.fillRect(0, 0, W, H);

    if (state.mode !== "dungeon" || !state.map) {
      // Decorative town-ish empty board
      ctx.fillStyle = "#121820";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#8b9bb4";
      ctx.font = "16px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("镇子 · 打开左侧菜单进入迷宫", W / 2, H / 2);
      return;
    }

    const map = state.map;
    const player = state.player;
    const viewCols = Math.floor(W / TILE_PX);
    const viewRows = Math.floor(H / TILE_PX);
    let camX = player.x - Math.floor(viewCols / 2);
    let camY = player.y - Math.floor(viewRows / 2);
    camX = Math.max(0, Math.min(map.width - viewCols, camX));
    camY = Math.max(0, Math.min(map.height - viewRows, camY));
    if (map.width < viewCols) camX = Math.floor((map.width - viewCols) / 2);
    if (map.height < viewRows) camY = Math.floor((map.height - viewRows) / 2);

    state._cam = { camX, camY, viewCols, viewRows, TILE_PX };

    const debug = state.debug;
    const visible = state.visible || new Set();
    const explored = state.explored || new Set();

    for (let sy = 0; sy < viewRows; sy++) {
      for (let sx = 0; sx < viewCols; sx++) {
        const x = camX + sx;
        const y = camY + sy;
        const px = sx * TILE_PX;
        const py = sy * TILE_PX;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
          ctx.fillStyle = "#05070a";
          ctx.fillRect(px, py, TILE_PX, TILE_PX);
          continue;
        }
        const k = MD.key(x, y);
        const inVis = debug || visible.has(k);
        const seen = debug || explored.has(k);
        if (!seen) {
          ctx.fillStyle = "#05070a";
          ctx.fillRect(px, py, TILE_PX, TILE_PX);
          continue;
        }
        const t = map.tiles[y][x];
        if (t === MD.TILE.WALL) {
          ctx.fillStyle = inVis ? "#1e2a3c" : "#121820";
          ctx.fillRect(px, py, TILE_PX, TILE_PX);
          ctx.fillStyle = inVis ? "#2a3a52" : "#182030";
          ctx.fillRect(px + 2, py + 2, TILE_PX - 4, TILE_PX - 4);
        } else {
          // floor
          const rid = map.roomIds[y][x];
          let base = rid >= 0 ? "#1a2433" : "#151c28";
          if (!inVis) base = rid >= 0 ? "#121925" : "#0e141d";
          ctx.fillStyle = base;
          ctx.fillRect(px, py, TILE_PX, TILE_PX);
          // subtle grid
          ctx.strokeStyle = inVis ? "#243044" : "#1a2230";
          ctx.strokeRect(px + 0.5, py + 0.5, TILE_PX - 1, TILE_PX - 1);

          if (t === MD.TILE.STAIRS && (inVis || explored.has(k))) {
            ctx.fillStyle = inVis ? "#f5c16c" : "#6b5a30";
            ctx.fillRect(px + 6, py + 6, TILE_PX - 12, TILE_PX - 12);
            ctx.strokeStyle = inVis ? "#ffe6a8" : "#4a4020";
            ctx.strokeRect(px + 6.5, py + 6.5, TILE_PX - 13, TILE_PX - 13);
            ctx.fillStyle = inVis ? "#1a2332" : "#0e141d";
            ctx.font = "bold 12px system-ui";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("下", px + TILE_PX / 2, py + TILE_PX / 2);
          }
        }

        if (debug && map.roomIds[y][x] != null) {
          ctx.fillStyle = "rgba(94,234,212,0.35)";
          ctx.font = "9px monospace";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(String(map.roomIds[y][x]), px + 2, py + 2);
        }
      }
    }

    // Items: only if visible (or debug); hide if explored but not in LOS
    if (state.items) {
      for (const it of state.items) {
        const k = MD.key(it.x, it.y);
        if (!debug && !visible.has(k)) continue;
        const sx = it.x - camX, sy = it.y - camY;
        if (sx < 0 || sy < 0 || sx >= viewCols || sy >= viewRows) continue;
        const px = sx * TILE_PX, py = sy * TILE_PX;
        ctx.fillStyle = MD.itemColor(it);
        ctx.beginPath();
        ctx.arc(px + TILE_PX / 2, py + TILE_PX / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Enemies
    if (state.enemies) {
      for (const e of state.enemies) {
        if (!e.alive) continue;
        const k = MD.key(e.x, e.y);
        if (!debug && !visible.has(k)) continue;
        const sx = e.x - camX, sy = e.y - camY;
        if (sx < 0 || sy < 0 || sx >= viewCols || sy >= viewRows) continue;
        drawActor(ctx, sx * TILE_PX, sy * TILE_PX, e.color, e.glyph || e.name[0], e);
      }
    }

    // Player always
    {
      const sx = player.x - camX, sy = player.y - camY;
      drawActor(ctx, sx * TILE_PX, sy * TILE_PX, player.color, "你", player);
    }

    // Minimap
    drawMinimap(ctx, state, W, H);

    // Aim overlay
    if (state.aiming) {
      ctx.fillStyle = "rgba(245,193,108,0.12)";
      ctx.fillRect(0, 0, W, 28);
      ctx.fillStyle = "#f5c16c";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("选择方向 · Esc 取消", W / 2, 14);
    }
  }

  function drawActor(ctx, px, py, color, label, actor) {
    const r = 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(px + 4, py + 4, TILE_PX - 8, TILE_PX - 8, 6)
      : ctx.rect(px + 4, py + 4, TILE_PX - 8, TILE_PX - 8);
    ctx.fill();
    ctx.fillStyle = "#0a1210";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, px + TILE_PX / 2, py + TILE_PX / 2 + 0.5);

    // status dots
    if (actor && actor.statuses && actor.statuses.length) {
      let ox = px + 4;
      for (const s of actor.statuses) {
        ctx.fillStyle = s.type === "sleep" ? "#a78bfa" : s.type === "confuse" ? "#f5c16c" : "#ff7b72";
        ctx.fillRect(ox, py + TILE_PX - 6, 4, 4);
        ox += 5;
      }
    }
  }

  function drawMinimap(ctx, state, W, H) {
    const map = state.map;
    const scale = 2;
    const mw = map.width * scale;
    const mh = map.height * scale;
    const ox = W - mw - 12;
    const oy = 12;
    ctx.fillStyle = "rgba(10,14,20,0.72)";
    ctx.fillRect(ox - 4, oy - 4, mw + 8, mh + 8);
    ctx.strokeStyle = "#314562";
    ctx.strokeRect(ox - 4.5, oy - 4.5, mw + 8, mh + 8);

    const explored = state.explored;
    const debug = state.debug;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const k = MD.key(x, y);
        if (!debug && !explored.has(k)) continue;
        const t = map.tiles[y][x];
        if (t === MD.TILE.WALL) ctx.fillStyle = "#3a4b66";
        else if (t === MD.TILE.STAIRS) ctx.fillStyle = "#f5c16c";
        else ctx.fillStyle = "#243044";
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
    // player
    ctx.fillStyle = "#5eead4";
    ctx.fillRect(ox + state.player.x * scale, oy + state.player.y * scale, scale, scale);
  }

  function updateSidePanel(state) {
    const floorEl = document.getElementById("statFloor");
    const hpEl = document.getElementById("statHp");
    const bellyEl = document.getElementById("statBelly");
    const turnEl = document.getElementById("statTurn");
    const barHp = document.getElementById("barHp");
    const barBelly = document.getElementById("barBelly");
    const pills = document.getElementById("statusPills");
    const logEl = document.getElementById("log");

    if (state.mode === "town") {
      floorEl.textContent = "镇子";
      hpEl.textContent = "—";
      bellyEl.textContent = "—";
      turnEl.textContent = "—";
      barHp.querySelector("span").style.width = "92%";
      barBelly.querySelector("span").style.width = "92%";
      pills.innerHTML = "";
    } else if (state.player) {
      const p = state.player;
      floorEl.textContent = state.floor + " F";
      hpEl.textContent = p.hp + "/" + p.maxHp;
      bellyEl.textContent = p.belly + "/" + p.maxBelly;
      turnEl.textContent = String(state.turn);
      const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
      const bellyPct = Math.max(0, Math.min(100, (p.belly / p.maxBelly) * 100));
      barHp.querySelector("span").style.width = (20 + 0.72 * hpPct) + "%";
      barBelly.querySelector("span").style.width = (22 + 0.70 * bellyPct) + "%";
      barHp.classList.toggle("ok", p.hp > p.maxHp * 0.35);
      barBelly.classList.toggle("low", p.belly <= 20);

      const names = { sleep: "睡眠", confuse: "混乱", para: "麻痹" };
      pills.innerHTML = "";
      for (const s of p.statuses) {
        const el = document.createElement("span");
        el.className = "pill";
        el.textContent = names[s.type] + " " + s.turns;
        pills.appendChild(el);
      }
    }

    if (logEl && state.log) {
      const lines = state.log.slice(-12);
      logEl.innerHTML = "";
      lines.forEach((line, i) => {
        const div = document.createElement("div");
        div.textContent = line.text;
        div.className = line.cls || "";
        if (i === lines.length - 1) div.classList.add("fresh");
        logEl.appendChild(div);
      });
    }
  }

  function drawOverlay(ctx, state, W, H) {
    if (W == null) W = ctx.canvas.width;
    if (H == null) H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (state.mode !== "dungeon" || !state.map) return;
    drawMinimap(ctx, state, W, H);
    if (state.aiming) {
      ctx.fillStyle = "rgba(245,193,108,0.16)";
      ctx.fillRect(0, 0, W, 28);
      ctx.fillStyle = "#f5c16c";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("选择方向 · Esc 取消", W / 2, 14);
    }
  }

  function screenToTile(state, clientX, clientY, canvas) {
    if (MD.view3d && MD.view3d.active) {
      return MD.view3d.pickTile(clientX, clientY, state);
    }
    if (!state._cam || !state.map) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * canvas.width;
    const my = ((clientY - rect.top) / rect.height) * canvas.height;
    const { camX, camY, TILE_PX } = state._cam;
    const x = camX + Math.floor(mx / TILE_PX);
    const y = camY + Math.floor(my / TILE_PX);
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return null;
    return { x, y };
  }

  MD.TILE_PX = TILE_PX;
  MD.drawGame = drawGame;
  MD.drawOverlay = drawOverlay;
  MD.updateSidePanel = updateSidePanel;
  MD.screenToTile = screenToTile;
})(typeof window !== "undefined" ? window : globalThis);
