/* 迷宫 3D — fog-of-war vertex shading */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { COL, tint } = V;

  function visOf(state, x, y) {
    const k = MD.key(x, y);
    const debug = state.debug;
    const seen = debug || (state.explored && state.explored.has(k));
    const vis = debug || (state.visible && state.visible.has(k));
    return { seen: !!seen, vis: !!vis };
  }

  function shadeMeta(state, meta) {
    if (!meta || !meta.cells || !meta.cells.length) return COL.black;
    let vis = false, seen = false, room = false;
    for (let i = 0; i < meta.cells.length; i++) {
      const c = meta.cells[i];
      const v = visOf(state, c.x, c.y);
      if (v.vis) vis = true;
      if (v.seen) seen = true;
      if (c.room) room = true;
    }
    if (!seen) return COL.black;
    if (meta.kind === "floor") {
      const c0 = meta.cells[0];
      if (vis) return room ? tint(COL.floorRoomVis, c0.x, c0.y, 0.08) : tint(COL.floorCorrVis, c0.x, c0.y, 0.07);
      return room ? tint(COL.floorRoomMem, c0.x, c0.y, 0.04) : tint(COL.floorCorrMem, c0.x, c0.y, 0.04);
    }
    const c0 = meta.cells[0];
    return vis ? tint(COL.wallVis, c0.x, c0.y, 0.07) : tint(COL.wallMem, c0.x, c0.y, 0.04);
  }

  function paintMeshColors(mesh, meta, state) {
    if (!mesh) return;
    const attr = mesh.geometry.getAttribute("color");
    const arr = attr.array;
    for (let i = 0; i < meta.length; i++) {
      const c = shadeMeta(state, meta[i]);
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    attr.needsUpdate = true;
  }

  function updateVisibility(state) {
    const map = state.map;
    if (!map) return;
    const sig = (state.debug ? "d" : "") + (state.player ? state.player.x + "," + state.player.y : "") + ":" + (state.explored ? state.explored.size : 0) + ":" + (state.visible ? state.visible.size : 0);
    if (sig === V.lastVisSig) return;
    V.lastVisSig = sig;
    paintMeshColors(V.floorMesh, V.floorMeta, state);
    paintMeshColors(V.wallMesh, V.wallMeta, state);
    paintMeshColors(V.floorMeshB, V.floorMetaB, state);
    paintMeshColors(V.wallMeshB, V.wallMetaB, state);
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
