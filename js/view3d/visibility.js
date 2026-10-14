/* 迷宫 3D — fog-of-war vertex shading */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { COL } = V;

  function visOf(state, x, y) {
    const k = MD.key(x, y);
    const debug = state.debug;
    const seen = debug || (state.explored && state.explored.has(k));
    const vis = debug || (state.visible && state.visible.has(k));
    return { seen: !!seen, vis: !!vis };
  }

  // 视野颜色乘数：视野内≈原色，记忆中按主题 mem 变暗，未探索近黑
  const VIS_ROOM = new THREE.Color(1, 1, 1);
  const VIS_CORR = new THREE.Color(0.93, 0.93, 0.93);
  const MEM = new THREE.Color();
  let stamp = 0;
  function shadeMeta(state, meta) {
    if (meta._s === stamp) return meta._c;
    meta._s = stamp;
    let vis = false, seen = false;
    const cells = meta.cells || [];
    for (let i = 0; i < cells.length; i++) {
      const v = visOf(state, cells[i].x, cells[i].y);
      if (v.vis) { vis = true; seen = true; break; }
      if (v.seen) seen = true;
    }
    meta._c = !seen ? COL.black : vis ? (meta.corr ? VIS_CORR : VIS_ROOM) : MEM;
    return meta._c;
  }

  function paintPart(part, state) {
    const attr = part.mesh.geometry.getAttribute("color");
    const arr = attr.array, base = part.base, meta = part.meta;
    for (let i = 0; i < meta.length; i++) {
      const c = shadeMeta(state, meta[i]);
      const k = i * 3;
      arr[k] = base[k] * c.r;
      arr[k + 1] = base[k + 1] * c.g;
      arr[k + 2] = base[k + 2] * c.b;
    }
    attr.needsUpdate = true;
  }

  function updateVisibility(state) {
    const map = state.map;
    if (!map) return;
    const sig = (state.debug ? "d" : "") + (state.player ? state.player.x + "," + state.player.y : "") + ":" + (state.explored ? state.explored.size : 0) + ":" + (state.visible ? state.visible.size : 0);
    if (sig === V.lastVisSig) return;
    V.lastVisSig = sig;
    stamp++;
    MEM.setHex(V.styleFor(V.currentTheme).mem || 0x444455);
    for (let i = 0; i < V.terrainParts.length; i++) paintPart(V.terrainParts[i], state);
    if (map.stairs) {
      const v = visOf(state, map.stairs.x, map.stairs.y);
      V.stairsRoot.visible = v.seen;
      if (V.stairsLight) {
        V.stairsLight.visible = v.vis && v.seen;
        V.stairsLight.intensity = v.vis ? 1.35 : 0;
      }
    }
    V.updateDecoVisibility(state);
  }

  Object.assign(V, {
    visOf, updateVisibility,
  });
})(typeof window !== "undefined" ? window : globalThis);
