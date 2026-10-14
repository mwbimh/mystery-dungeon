/* 迷宫 3D — 手绘 2.5D 地形风格表（按主题 id）
 *
 * tex       手绘贴图（assets/runtime/terrain/<名>.webp）：floor 房间地面、corr 通道、top 墙顶、side 崖壁/墙面
 *           缺哪张就用对应的 col 纯色（仍有软阴影和视野变暗）
 * col       每部分的底色；有贴图时作为乘色（一般接近白色）
 * wall.style "rock" 圆润厚实的岩壁（顶面微鼓，侧面多段外凸带圆唇）| "block" 规整墙体（基座 + 墙身 + 可选发光条）
 * wall.h    [最低, 最高] 墙高
 * texScale  贴图每个世界单位重复几次（0.5 = 两格一张）；topScale / sideScale 单独指定墙顶、崖壁
 * ao        墙脚接触阴影强度（0~1）
 * mem       记忆中（已探索但不在视野）的颜色乘数
 * deco      沿用 themes.js 里的纸片装饰（手绘小物件）
 */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;

  const STYLES = {
    cave: {
      tex: { floor: "cave-floor", corr: "cave-floor", top: "cave-top", side: "cave-side" },
      col: { floor: 0xffffff, corr: 0xe8e2d8, top: 0xffffff, side: 0xf2eef8 },
      floor: { bump: 0.05 },
      wall: { style: "rock", h: [1.0, 1.55] },
      texScale: 0.42, topScale: 0.3, sideScale: 0.4, ao: 0.42, mem: 0x4a4a62,
    },
    forest: {
      tex: { floor: "forest-floor", corr: "forest-path", top: "forest-top", side: "forest-side" },
      col: { floor: 0xffffff, corr: 0xffffff, top: 0xffffff, side: 0xffffff },
      floor: { bump: 0.06 },
      wall: { style: "rock", h: [0.85, 1.25] },
      texScale: 0.42, topScale: 0.2, sideScale: 0.4, ao: 0.45, mem: 0x3e4c44,
    },
    wetcave: {
      col: { floor: 0x88adc2, corr: 0x7a9db2, top: 0x5f8299, side: 0x4a687f },
      floor: { bump: 0.05 },
      wall: { style: "rock", h: [1.05, 1.65] },
      texScale: 0.42, ao: 0.4, mem: 0x3a4a5a,
    },
    ruins: {
      col: { floor: 0xdccda7, corr: 0xc8b893, top: 0xc7b892, side: 0xae9e7e, base: 0x8c7d62 },
      floor: { bump: 0 },
      wall: { style: "block", h: [1.15, 1.15] },
      texScale: 0.5, ao: 0.35, mem: 0x4c463c,
    },
    wooden: {
      col: { floor: 0xc98f56, corr: 0xae7843, top: 0x7d5535, side: 0x9f6e44, base: 0x5e3f27 },
      floor: { bump: 0 },
      wall: { style: "block", h: [1.15, 1.15] },
      texScale: 0.5, ao: 0.35, mem: 0x4a3c30,
    },
    modern: {
      col: { floor: 0xe8e8e4, corr: 0xcbcdd1, top: 0x9ca5af, side: 0xd2d7dd, base: 0x7f8792 },
      floor: { bump: 0 },
      wall: { style: "block", h: [1.2, 1.2] },
      texScale: 0.5, ao: 0.3, mem: 0x484c54,
    },
    cyber: {
      col: { floor: 0x3d3854, corr: 0x2e2b42, top: 0x24222f, side: 0x403a5a, base: 0x1e1c2a },
      floor: { bump: 0 },
      wall: { style: "block", h: [1.3, 1.3], trim: [0xff4fd8, 0x40e0ff] },
      texScale: 0.5, ao: 0.3, mem: 0x3a3650,
    },
    future: {
      col: { floor: 0xeaf2f9, corr: 0xcfdce8, top: 0xf5f9fc, side: 0xcad8e6, base: 0x95a9bd },
      floor: { bump: 0 },
      wall: { style: "block", h: [1.25, 1.25], trim: [0x5ad1ff] },
      texScale: 0.5, ao: 0.3, mem: 0x4a5664,
    },
  };

  function styleFor(theme) {
    return STYLES[(theme && theme.id) || "cave"] || STYLES.cave;
  }

  // 贴图缓存（按文件名），换层不重复加载
  const texCache = {};
  function terrainTex(name, onLoad) {
    if (!name) return null;
    if (texCache[name]) return texCache[name];
    const v = "1"; // 换贴图时改这里
    const tex = new THREE.TextureLoader().load("assets/runtime/terrain/" + name + ".webp" + (v ? "?v=" + v : ""), onLoad);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    texCache[name] = tex;
    return tex;
  }

  Object.assign(V, { TERRAIN_STYLES: STYLES, styleFor, terrainTex });
})(typeof window !== "undefined" ? window : globalThis);
