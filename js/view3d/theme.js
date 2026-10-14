/* 迷宫 3D — 主题：雾、天空、灯光、环境粒子 */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { initFx } = V;

  function setTheme(theme) {
    if (!theme) return;
    if (!V.active || !V.scene) { V.pendingTheme = theme; return; }
    if (V.currentTheme === theme) return;
    V.currentTheme = theme;
    if (V.scene.fog) {
      V.scene.fog.color.set(theme.fog);
      if (theme.fogDensity && V.scene.fog.density != null) V.scene.fog.density = theme.fogDensity;
    }
    if (V.scene.background && V.scene.background.set) V.scene.background.set(theme.fog);
    if (V.renderer) V.renderer.setClearColor(theme.fog, 1);
    if (V.groundMesh) {
      V.groundMesh.material.color.set(theme.fog).multiplyScalar(0.25);
    }
    if (V.hemi) {
      V.hemi.color.set(theme.hemiSky);
      V.hemi.groundColor.set(theme.hemiGround);
    }
    if (V.playerLight && theme.lightColor) {
      V.playerLight.color.set(theme.lightColor);
    }
    initFx(theme);
    V.lastVisSig = "";
    // 地形颜色都在 styles.js；主题切换后由 rebuildMap 重新生成网格
  }

  Object.assign(V, {
    setTheme,
  });
})(typeof window !== "undefined" ? window : globalThis);
