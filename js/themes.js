/* Dungeon floor themes: dungeon floor bands choose the environment.
   Each theme drives: fog/sky color + fog density, hemisphere light,
   theme-specific terrain volumes, quiet material grain,
   vertex tint palette and ambient FX layers.
   FX layer: { colors, count, size, fall (+down / -up), sway, spread,
   height, opacity, additive } */
(function (global) {
  const MD = (global.MD = global.MD || {});

  const THEMES = [
    {
      id: "cave", name: "洞窟",
      fog: 0xc5e4ef, fogDensity: 0.03,
      hemiSky: 0xfff0d8, hemiGround: 0xa8c8b8,
      lightColor: 0xffd090,
      phong: { specular: 0x1a1a1a, shininess: 4 },
      floorTex: "floor", wallTex: "wall",
      floorTexB: "tex/cave-floor-b", wallTexB: "tex/cave-wall-b",
      palFloor: [232, 210, 160], palWall: [180, 192, 208],
      tints: {
        floorRoomVis: 0xfff6e4, floorCorrVis: 0xe6f0ea,
        floorRoomMem: 0x3d3629, floorCorrMem: 0x2c3130,
        wallVis: 0xf0e4f8, wallMem: 0x2a2730,
      },
      deco: ["crystal", "mushroom", "lantern", "vine", "flower"],
      fx: [
        { colors: [0xffe8c0, 0xd8ccb0], count: 60, size: 0.05, fall: 0.06, sway: 0.25, spread: 16, height: 6, opacity: 0.5 },
      ],
    },
    {
      id: "forest", name: "森林",
      fog: 0xd4ecd2, fogDensity: 0.032,
      hemiSky: 0xf2ffe0, hemiGround: 0x9cc09a,
      lightColor: 0xe8ffd8,
      phong: { specular: 0x141414, shininess: 3 },
      floorTex: "tex/forest-floor", wallTex: "tex/forest-wall",
      floorTexB: "tex/forest-floor-b", wallTexB: "tex/forest-wall-b",
      palFloor: [168, 208, 128], palWall: [96, 152, 96],
      tints: {
        floorRoomVis: 0xeef8dc, floorCorrVis: 0xd8ecc8,
        floorRoomMem: 0x313929, floorCorrMem: 0x242c26,
        wallVis: 0xd8eecb, wallMem: 0x242c23,
      },
      deco: ["flower", "vine", "mushroom", "flower", "vine"],
      fx: [
        { colors: [0x9ccf6a, 0xd8e8a0, 0xf0c060], count: 80, size: 0.09, fall: 0.3, sway: 1.1, spread: 16, height: 6, opacity: 0.85 },
      ],
    },
    {
      id: "wetcave", name: "潮湿洞窟",
      fog: 0xc2dcec, fogDensity: 0.042,
      hemiSky: 0xeaf6ff, hemiGround: 0x88a8b8,
      lightColor: 0xbfe8ff,
      phong: { specular: 0x9fc8e8, shininess: 70 },
      floorTex: "tex/wetcave-floor", wallTex: "tex/wetcave-wall",
      floorTexB: "tex/wetcave-floor-b", wallTexB: "tex/wetcave-wall-b",
      palFloor: [168, 196, 216], palWall: [112, 144, 168],
      tints: {
        floorRoomVis: 0xe2f0fa, floorCorrVis: 0xccdcea,
        floorRoomMem: 0x2c3640, floorCorrMem: 0x232c36,
        wallVis: 0xd0e4f0, wallMem: 0x202830,
      },
      deco: ["mushroom", "vine", "crystal", "mushroom"],
      fx: [
        { colors: [0xbfe8ff, 0xd8f4ff], count: 42, size: 0.05, fall: 1.6, sway: 0, spread: 16, height: 6, opacity: 0.7, additive: true },
        { colors: [0xcfe8f8], count: 26, size: 0.6, fall: 0.015, sway: 0.5, spread: 16, height: 2.2, opacity: 0.1 },
      ],
    },
    {
      id: "ruins", name: "遗迹",
      fog: 0xe6d8c0, fogDensity: 0.028,
      hemiSky: 0xfff0d0, hemiGround: 0xb0a088,
      lightColor: 0xffe2b0,
      phong: { specular: 0x201810, shininess: 5 },
      floorTex: "tex/ruins-floor", wallTex: "tex/ruins-wall",
      floorTexB: "tex/ruins-floor-b", wallTexB: "tex/ruins-wall-b",
      palFloor: [224, 208, 168], palWall: [176, 152, 112],
      tints: {
        floorRoomVis: 0xf8eeda, floorCorrVis: 0xe6d8c2,
        floorRoomMem: 0x3c362a, floorCorrMem: 0x30291c,
        wallVis: 0xe8d8c4, wallMem: 0x292319,
      },
      deco: ["crystal", "lantern", "crystal", "vine"],
      fx: [
        { colors: [0xffd890, 0xf0b060, 0xfff0c8], count: 55, size: 0.045, fall: -0.05, sway: 0.4, spread: 16, height: 5.5, opacity: 0.75, additive: true },
      ],
    },
    {
      id: "wooden", name: "木制建筑",
      fog: 0xecdcc0, fogDensity: 0.032,
      hemiSky: 0xffedd0, hemiGround: 0xb09068,
      lightColor: 0xffd8a0,
      phong: { specular: 0x2a2014, shininess: 8 },
      floorTex: "tex/wooden-floor", wallTex: "tex/wooden-wall",
      floorTexB: "tex/wooden-floor-b", wallTexB: "tex/wooden-wall-b",
      palFloor: [216, 176, 120], palWall: [168, 128, 80],
      tints: {
        floorRoomVis: 0xfaecca, floorCorrVis: 0xe8d4b4,
        floorRoomMem: 0x3d3123, floorCorrMem: 0x302519,
        wallVis: 0xf0dcba, wallMem: 0x292016,
      },
      deco: ["lantern", "vine", "lantern", "flower"],
      fx: [
        { colors: [0xffe0b0, 0xf8d8a8], count: 34, size: 0.045, fall: 0.05, sway: 0.2, spread: 16, height: 5.5, opacity: 0.4 },
      ],
    },
    {
      id: "modern", name: "现代建筑",
      fog: 0xe2e6ee, fogDensity: 0.022,
      hemiSky: 0xffffff, hemiGround: 0xa8b0c0,
      lightColor: 0xf4f8ff,
      phong: { specular: 0x3c424c, shininess: 18 },
      floorTex: "tex/modern-floor", wallTex: "tex/modern-wall",
      floorTexB: "tex/modern-floor-b", wallTexB: "tex/modern-wall-b",
      palFloor: [224, 226, 232], palWall: [184, 190, 200],
      tints: {
        floorRoomVis: 0xf4f6fa, floorCorrVis: 0xdfe4ec,
        floorRoomMem: 0x363840, floorCorrMem: 0x292c34,
        wallVis: 0xe8ecf2, wallMem: 0x23262d,
      },
      deco: ["lantern", "flower", "lantern"],
      fx: [],
    },
    {
      id: "cyber", name: "赛博朋克",
      fog: 0x655889, fogDensity: 0.030,
      hemiSky: 0xd9ceff, hemiGround: 0x7389ab,
      lightColor: 0xd9c4ff,
      phong: { specular: 0x8868c8, shininess: 26 },
      floorTex: "tex/cyber-floor", wallTex: "tex/cyber-wall",
      floorTexB: "tex/cyber-floor-b", wallTexB: "tex/cyber-wall-b",
      palFloor: [72, 80, 120], palWall: [56, 48, 96],
      tints: {
        floorRoomVis: 0xe4e9ff, floorCorrVis: 0xcbd9f2,
        floorRoomMem: 0x181629, floorCorrMem: 0x131123,
        wallVis: 0xe0d5ff, wallMem: 0x111020,
      },
      deco: ["crystal", "lantern", "crystal"],
      fx: [
        { colors: [0xff4fd8, 0x40e0ff, 0x9fe8ff], count: 90, size: 0.06, fall: 3.2, sway: 0, spread: 16, height: 7, opacity: 0.8, additive: true },
        { colors: [0xff4fd8, 0x40e0ff], count: 22, size: 0.05, fall: -0.25, sway: 0.6, spread: 16, height: 4.5, opacity: 0.6, additive: true },
      ],
    },
    {
      id: "future", name: "未来科技",
      fog: 0xe8f2ff, fogDensity: 0.02,
      hemiSky: 0xf0f8ff, hemiGround: 0xa8c0d8,
      lightColor: 0xcfe8ff,
      phong: { specular: 0x9fc0e0, shininess: 32 },
      floorTex: "tex/future-floor", wallTex: "tex/future-wall",
      palFloor: [224, 236, 248], palWall: [200, 216, 240],
      tints: {
        floorRoomVis: 0xf4faff, floorCorrVis: 0xe2ecf8,
        floorRoomMem: 0x363c46, floorCorrMem: 0x293039,
        wallVis: 0xe8f2ff, wallMem: 0x232933,
      },
      deco: ["crystal", "lantern", "crystal", "flower"],
      fx: [
        { colors: [0x9fe8ff, 0xffffff], count: 70, size: 0.05, fall: -0.14, sway: 0.5, spread: 16, height: 6, opacity: 0.65, additive: true },
      ],
    },
  ];

  // Visual-only environment specifications. None of these fields enter map generation,
  // movement, collision or the gameplay RNG. Structure is expressed in world units.
  const ENVIRONMENTS = {
    cave:    { form: "strata", height: 0.86, relief: 0.30, inset: 0.14, floorRelief: 0.040, stone: 0x9c89bd, secondary: 0xc8a6cf, accent: 0x52bfd0, ground: 0xe1c59d, detail: 0xefb65f, shape: "mote" },
    forest:  { form: "rootbank", height: 0.38, relief: 0.18, inset: 0.22, floorRelief: 0.045, stone: 0x91a65b, secondary: 0xa26e48, accent: 0x69b768, ground: 0xc5d58c, detail: 0xa4d975, shape: "leaf" },
    wetcave: { form: "karst", height: 0.64, relief: 0.23, inset: 0.18, floorRelief: 0.030, stone: 0x6596b2, secondary: 0x9dc7cb, accent: 0x49bec1, ground: 0xa9cfd0, detail: 0xb49cda, shape: "rain" },
    ruins:   { form: "broken-masonry", height: 0.39, relief: 0.16, inset: 0.07, floorRelief: 0.020, stone: 0xcfa56e, secondary: 0xe9c18c, accent: 0x6dac91, ground: 0xe6ceaa, detail: 0xc88159, shape: "mote" },
    wooden:  { form: "timber-bays", height: 0.83, relief: 0, inset: 0.07, floorRelief: 0.012, stone: 0xce9865, secondary: 0x895740, accent: 0xe9b66f, ground: 0xe6c392, detail: 0x6baba1, shape: "mote" },
    modern:  { form: "service-bays", height: 0.62, relief: 0, inset: 0.07, floorRelief: 0.006, stone: 0x91bdcf, secondary: 0x587f9c, accent: 0xefb35c, ground: 0xc5d9df, detail: 0x76c3c0, shape: "mote" },
    cyber:   { form: "utility-stacks", height: 0.43, relief: 0, inset: 0.10, floorRelief: 0.008, stone: 0x786fa5, secondary: 0x586b98, accent: 0x57d0d3, ground: 0x909abb, detail: 0xe47abe, shape: "rain" },
    future:  { form: "pressure-shells", height: 0.32, relief: 0, inset: 0.15, floorRelief: 0.005, stone: 0xbadbdc, secondary: 0x70a4be, accent: 0x69cbc1, ground: 0xcbdfe0, detail: 0xf0b16d, shape: "mote" },
  };
  for (const theme of THEMES) {
    theme.environment = ENVIRONMENTS[theme.id];
    for (const layer of theme.fx) {
      layer.shape = layer.size >= 0.4 ? "mote" : theme.environment.shape;
      layer.count = Math.min(layer.count, theme.id === "forest" ? 32 : 24);
      if (layer.shape === "leaf") layer.size = 0.075;
      if (layer.shape === "rain") layer.size = 0.065;
      layer.opacity = Math.min(layer.opacity, 0.42);
    }
  }
  THEMES.find(theme => theme.id === "wetcave").phong = { specular: 0x395664, shininess: 16 };

  function cssColor(hex) { return "#" + hex.toString(16).padStart(6, "0"); }
  function tileHash(x, y) {
    let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n >>> 0) / 4294967296;
  }
  const tileCache = new Map();
  function flatTile(theme, wall, room, variant, size) {
    const id = theme && theme.id || "cave";
    const key = id + ":" + wall + ":" + room + ":" + variant + ":" + size;
    if (tileCache.has(key)) return tileCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const env = theme.environment || ENVIRONMENTS.cave;
    ctx.fillStyle = cssColor(wall ? env.stone : env.ground);
    ctx.fillRect(0, 0, size, size);
    // Low-contrast material masses rather than tile borders or bright wall traces.
    ctx.fillStyle = cssColor(wall ? env.secondary : env.accent);
    ctx.globalAlpha = wall ? 0.24 : room ? 0.12 : 0.08;
    for (let i = 0; i < 4; i++) {
      const a = tileHash(i + 11, variant + 31);
      const b = tileHash(variant + 41, i + 19);
      if (env.form === "timber-bays") ctx.fillRect(0, i * size / 4 + variant, size, size * 0.13);
      else if (env.relief === 0) ctx.fillRect(a * size * 0.5, b * size * 0.5, size * 0.48, size * 0.37);
      else { ctx.beginPath(); ctx.ellipse(a * size, b * size, size * 0.29, size * 0.2, a, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (wall) { ctx.fillStyle = "rgba(18,24,29,0.24)"; ctx.fillRect(0, size * 0.72, size, size * 0.28); }
    if (tileCache.size >= 256) tileCache.clear();
    tileCache.set(key, canvas);
    return canvas;
  }
  function drawTerrainTile(ctx, theme, tile) {
    theme = theme || THEMES[0];
    const { x, y, px, py, size, wall, inVis, room } = tile;
    ctx.save();
    ctx.drawImage(flatTile(theme, wall, room, Math.floor(tileHash(x, y) * 4), size), px, py, size, size);
    if (!inVis) { ctx.fillStyle = "rgba(12,17,26,0.76)"; ctx.fillRect(px, py, size, size); }
    ctx.restore();
  }
  // Preserve the established 2D caller contract; environment rendering has no outlines.
  MD.paperTerrain = { drawTile: drawTerrainTile };

  function themeForFloor(floor) {
    const id = MD.floorConfig(floor).themeId;
    const theme = THEMES.find(theme => theme.id === id);
    if (!theme) throw new Error("Unknown theme ID: " + id);
    const nameKey = MD.config.themeCatalog[id].nameKey;
    return { ...theme, name: MD.t(nameKey) };
  }

  MD.THEMES = THEMES;
  MD.themeForFloor = themeForFloor;
})(typeof window !== "undefined" ? window : globalThis);
