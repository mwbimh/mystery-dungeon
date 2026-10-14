/* 迷宫 — UI refresh, render loop, boot, debug panel */
(function () {
  const MD = window.MD;
  const G = MD.game;
  const { DEBUG, TOTAL_FLOORS, canvas, initSkillBar, log, overlay, renderSkills, setupFloor,
    showOverlay, state, updateUI } = G;

  function frame() {
    const wrap = canvas.parentElement;
    const cw = Math.max(320, wrap.clientWidth);
    const ch = Math.max(280, wrap.clientHeight);
    if (G.use3d) {
      MD.view3d.resize(cw, ch);
      MD.view3d.sync(state);
      MD.view3d.render();
      if (overlay && G.overlayCtx) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const ow = Math.max(1, Math.floor(cw * dpr));
        const oh = Math.max(1, Math.floor(ch * dpr));
        if (overlay.width !== ow || overlay.height !== oh) {
          overlay.width = ow;
          overlay.height = oh;
        }
        G.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        G.overlayCtx.clearRect(0, 0, cw, ch);
        MD.drawOverlay(G.overlayCtx, state, cw, ch);
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
      MD.drawGame(G.ctx, state);
    }
    requestAnimationFrame(frame);
  }

  // Boot
  initSkillBar();
  renderSkills();
  G.initSaveUI();
  const resumed = G.loadGame();
  if (!resumed) {
    log("欢迎。", "good");
    showOverlay("townOverlay");
  }
  updateUI();
  canvas.focus();
  if (!resumed && MD.story) MD.story.trigger("town", {});
  requestAnimationFrame(frame);

  // Expose for debug
  window.MD_STATE = state;
  if (DEBUG) {
    MD.debugFloor = function (n) {
      if (state.mode !== "dungeon") return false;
      setupFloor(Math.min(Math.max(1, n | 0), TOTAL_FLOORS));
      updateUI();
      return true;
    };

    // 主题预览面板：?debug=1 时出现在左下角，点按钮直接跳到对应主题首层
    const panel = document.createElement("div");
    panel.id = "debugPanel";
    const mkBtn = function (label, fn, cls) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls || "dbg-btn";
      b.textContent = label;
      b.addEventListener("click", fn);
      panel.appendChild(b);
    };
    MD.THEMES.forEach(function (t, i) {
      mkBtn(t.name, function () { MD.debugFloor(i * MD.FLOORS_PER_THEME + 1); });
    });
    panel.appendChild(document.createElement("br"));
    mkBtn("← 上一层", function () { MD.debugFloor(state.floor - 1); }, "dbg-btn dbg-small");
    mkBtn("下一层 →", function () { MD.debugFloor(state.floor + 1); }, "dbg-btn dbg-small");
    const host = document.querySelector(".board-wrap");
    if (host) host.appendChild(panel);
  }
})();
