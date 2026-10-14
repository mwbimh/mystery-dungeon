/* 迷宫 — 存档：自动存到 localStorage，可导出/导入文件
 *
 * 存储键：
 *   md_warehouse_v1  仓库（items.js 负责）
 *   md-skill-meta    技能栏格数（core.js 负责）
 *   md_story_v1      看过的剧情（story/vn.js 负责）
 *   md_run_v1        本文件：随身物品（背包、技能栏）+ 迷宫中途进度
 * 导出文件把以上全部打包成一个 JSON；导入后写回各键并刷新页面。
 *
 * 规则：迷宫里每次行动后自动存（防抖），关页面/切后台时立即存；
 * 倒下时进度立刻作废、背包清空（不能读档反悔）。重新打开页面会直接回到存档时的楼层。
 */
(function () {
  const MD = window.MD;
  const G = MD.game;
  const { MAX_BAG, TOTAL_FLOORS, hideOverlay, log, padBag, padSkills, refreshFOV, renderSkills, state, updateUI } = G;

  const RUN_KEY = "md_run_v1";
  const ALL_KEYS = ["md_warehouse_v1", "md-skill-meta", "md_story_v1", RUN_KEY];
  const FORMAT = "mystery-dungeon-save";
  const VERSION = 1;
  const SAVE_DELAY = 250;

  // 运行时字段，不进存档
  const SKIP = { _vid: 1, anim: 1, animT0: 1, animUntil: 1 };
  function clean(obj) {
    if (Array.isArray(obj)) return obj.map(clean);
    if (!obj || typeof obj !== "object") return obj;
    const out = {};
    for (const k in obj) if (!SKIP[k] && typeof obj[k] !== "function") out[k] = clean(obj[k]);
    return out;
  }

  function runSnapshot() {
    const inRun = state.mode === "dungeon" && state.map && state.player && state.player.alive && !state.endKind;
    const snap = {
      v: VERSION,
      bag: clean(state.bag),
      skills: clean(state.skills),
      run: null,
    };
    if (inRun) {
      const map = Object.assign({}, state.map);
      delete map.TILE;
      snap.run = {
        floor: state.floor,
        turn: state.turn,
        map: map,
        player: clean(state.player),
        enemies: clean(state.enemies.filter((e) => e.alive)),
        items: clean(state.items),
        explored: Array.from(state.explored),
        triggeredMH: Array.from(state.triggeredMH),
        spawnCounter: state.spawnCounter,
        lastBellyWarn: state.lastBellyWarn,
        log: state.log.slice(-30),
      };
    }
    return snap;
  }

  let timer = 0;
  let suspended = false; // 读档/导入过程中不写
  function saveNow() {
    clearTimeout(timer);
    timer = 0;
    if (suspended) return false;
    try {
      localStorage.setItem(RUN_KEY, JSON.stringify(runSnapshot()));
      return true;
    } catch (e) {
      console.warn("存档失败", e);
      return false;
    }
  }
  function scheduleSave() {
    if (suspended || timer) return;
    timer = setTimeout(saveNow, SAVE_DELAY);
  }

  function readRun() {
    try {
      const o = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
      return o && typeof o === "object" ? o : null;
    } catch (e) {
      return null;
    }
  }

  function validRun(r) {
    if (!r || !r.map || !r.player) return false;
    const m = r.map;
    if (!Array.isArray(m.tiles) || m.tiles.length !== m.height || !m.tiles[0] || m.tiles[0].length !== m.width) return false;
    if (!(r.floor >= 1 && r.floor <= TOTAL_FLOORS)) return false;
    const p = r.player;
    return p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height;
  }

  /** 启动时调用：恢复随身物品；有迷宫进度就直接回到迷宫。返回是否回到了迷宫。 */
  function loadGame() {
    const o = readRun();
    if (!o) return false;
    if (Array.isArray(o.bag)) state.bag = padBag(o.bag.slice(0, MAX_BAG));
    if (o.skills && typeof o.skills === "object") {
      state.skills = o.skills;
      padSkills();
      renderSkills();
    }
    const r = o.run;
    if (!validRun(r)) return false;
    const now = performance.now();
    state.mode = "dungeon";
    state.floor = r.floor;
    state.turn = r.turn | 0;
    state.theme = MD.themeForFloor(r.floor);
    if (MD.view3d && MD.view3d.setTheme) MD.view3d.setTheme(state.theme);
    r.map.TILE = MD.TILE;
    state.map = r.map;
    state.player = Object.assign(MD.makePlayer(r.player.x, r.player.y), r.player, { anim: "idle", animT0: now });
    state.enemies = (r.enemies || []).map((e) => Object.assign(e, { anim: "idle", animT0: now }));
    state.items = r.items || [];
    state.explored = new Set(r.explored || []);
    state.visible = new Set();
    state.triggeredMH = new Set(r.triggeredMH || []);
    state.spawnCounter = r.spawnCounter | 0;
    state.lastBellyWarn = r.lastBellyWarn != null ? r.lastBellyWarn : 100;
    state.log = Array.isArray(r.log) ? r.log : [];
    state.pendingDash = null;
    state.dashActive = false;
    state.animLock = false;
    state.justEnteredMH = false;
    state.endKind = null;
    hideOverlay("townOverlay");
    refreshFOV();
    log("继续上次的冒险（" + r.floor + " 层）。", "good");
    updateUI();
    return true;
  }

  // ---- 导出 / 导入 ----
  function exportData() {
    saveNow();
    const data = {};
    ALL_KEYS.forEach((k) => {
      const raw = localStorage.getItem(k);
      if (raw != null) {
        try { data[k] = JSON.parse(raw); } catch (e) { /* 坏数据不导出 */ }
      }
    });
    return { format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), data: data };
  }

  function exportFile() {
    const json = JSON.stringify(exportData());
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    a.download = "mystery-dungeon-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".json";
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /** 校验并写入导入的存档；成功返回 null，失败返回原因。 */
  function importData(obj) {
    if (!obj || obj.format !== FORMAT || !obj.data || typeof obj.data !== "object") return "不是本游戏的存档文件";
    if ((obj.version | 0) > VERSION) return "存档来自更新的版本，请先更新游戏";
    const d = obj.data;
    if (d.md_warehouse_v1 != null && !Array.isArray(d.md_warehouse_v1)) return "仓库数据损坏";
    if (d[RUN_KEY] && d[RUN_KEY].run && !validRun(d[RUN_KEY].run)) return "迷宫进度数据损坏";
    suspended = true;
    clearTimeout(timer);
    ALL_KEYS.forEach((k) => {
      if (d[k] != null) localStorage.setItem(k, JSON.stringify(d[k]));
      else localStorage.removeItem(k);
    });
    return null;
  }

  function importFile(file, done) {
    const fr = new FileReader();
    fr.onload = function () {
      let err;
      try { err = importData(JSON.parse(fr.result)); } catch (e) { err = "文件无法解析"; }
      done(err);
    };
    fr.onerror = function () { done("文件读取失败"); };
    fr.readAsText(file);
  }

  function initSaveUI() {
    const btnExp = document.getElementById("btnExport");
    const btnImp = document.getElementById("btnImport");
    const input = document.getElementById("importFile");
    const msg = document.getElementById("saveMsg");
    const say = (t) => { if (msg) msg.textContent = t; };
    if (btnExp) btnExp.onclick = () => { exportFile(); say("已导出存档文件。"); };
    if (btnImp && input) {
      btnImp.onclick = () => input.click();
      input.onchange = () => {
        const f = input.files && input.files[0];
        input.value = "";
        if (!f) return;
        if (!window.confirm("导入会覆盖当前的仓库、背包和迷宫进度，确定吗？")) return;
        importFile(f, (err) => {
          if (err) { say("导入失败：" + err); return; }
          say("导入成功，正在重新载入……");
          setTimeout(() => location.reload(), 300);
        });
      };
    }
  }

  window.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

  Object.assign(G, {
    saveNow, scheduleSave, loadGame, initSaveUI,
  });
  MD.save = { saveNow, exportData, importData, exportFile, loadGame };
})();
