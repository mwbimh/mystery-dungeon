/* Dungeon floor themes: dungeon floor bands choose the environment.
   Each theme drives: fog/sky color + fog density, hemisphere light,
   floor+wall textures (runtime PNG with procedural fallback palette),
   vertex tint palette, wall-corner decoration pool and ambient FX layers.
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
      fog: 0x201c38, fogDensity: 0.045,
      hemiSky: 0x8888ff, hemiGround: 0x302858,
      lightColor: 0xc090ff,
      phong: { specular: 0x8868c8, shininess: 26 },
      floorTex: "tex/cyber-floor", wallTex: "tex/cyber-wall",
      floorTexB: "tex/cyber-floor-b", wallTexB: "tex/cyber-wall-b",
      palFloor: [72, 80, 120], palWall: [56, 48, 96],
      tints: {
        floorRoomVis: 0x8a92d0, floorCorrVis: 0x7078b0,
        floorRoomMem: 0x181629, floorCorrMem: 0x131123,
        wallVis: 0x7a6ab8, wallMem: 0x111020,
      },
      deco: ["crystal", "lantern", "crystal"],
      edge: { colors: [0xff4fd8, 0x40e0ff], width: 0.11 },
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
      edge: { colors: [0x9fdcff, 0xd8f0ff], width: 0.1 },
      fx: [
        { colors: [0x9fe8ff, 0xffffff], count: 70, size: 0.05, fall: -0.14, sway: 0.5, spread: 16, height: 6, opacity: 0.65, additive: true },
      ],
    },
  ];

  // Visual-only paper palette shared by the diorama and lightweight 2D mode.
  // It never participates in the map seed, collision, spawn or turn rules.
  const PAPER = {
    cave:    { rim: 0xfff0d6, ink: 0x62576b, accent: 0xb29abd, fleck: 0xe7d0a1, shape: "spark" },
    forest:  { rim: 0xf1efcc, ink: 0x3e644b, accent: 0x93ad66, fleck: 0xe6d39a, shape: "leaf" },
    wetcave: { rim: 0xe1f2f2, ink: 0x476575, accent: 0x9ac9d8, fleck: 0xc2dae3, shape: "rain" },
    ruins:   { rim: 0xffedcd, ink: 0x7a624d, accent: 0xccaa6b, fleck: 0xe5c998, shape: "spark" },
    wooden:  { rim: 0xfbe6bd, ink: 0x735238, accent: 0xbb8957, fleck: 0xe8c78c, shape: "mote" },
    modern:  { rim: 0xf7f3e9, ink: 0x687381, accent: 0xa9bccc, fleck: 0xd7dfe5, shape: "mote" },
    cyber:   { rim: 0xb4b2e1, ink: 0x27233f, accent: 0xc275bc, fleck: 0x91b4d2, shape: "rain" },
    future:  { rim: 0xf5fbff, ink: 0x627e9b, accent: 0x97cbdc, fleck: 0xceecf4, shape: "spark" },
  };
  for (const theme of THEMES) {
    theme.paper = PAPER[theme.id];
    for (const layer of theme.fx) {
      layer.shape = layer.size >= 0.4 ? "mote" : theme.paper.shape;
      // Air should frame the stickers, rather than cover small targets.
      layer.count = Math.min(layer.count, theme.id === "forest" ? 42 : 36);
      if (layer.shape === "leaf") layer.size = 0.105;
      if (layer.shape === "rain") layer.size = 0.095;
    }
  }
  // A damp paper wash, without a plastic specular flash on each floor tile.
  THEMES.find(theme => theme.id === "wetcave").phong = { specular: 0x395664, shininess: 16 };

  function paperStyle(theme) { return (theme && theme.paper) || PAPER.cave; }
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
    const style = paperStyle(theme);
    const palette = wall ? theme.palWall : theme.palFloor;
    const factor = wall ? 0.73 : room ? 0.88 : 0.77;
    ctx.fillStyle = "rgb(" + palette.map(v => Math.round(v * factor)).join(",") + ")";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = cssColor(style.rim);
    ctx.globalAlpha = wall ? 0.17 : 0.12;
    ctx.fillRect(1, 1, size - 2, wall ? size * 0.57 : size - 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssColor(style.ink);
    ctx.lineWidth = 1;
    ctx.globalAlpha = wall ? 0.30 : 0.13;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    if (wall) {
      const seam = Math.round(size * (0.52 + variant * 0.045));
      ctx.beginPath(); ctx.moveTo(1, seam); ctx.lineTo(size - 1, seam + 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(size * (variant % 2 ? 0.35 : 0.69), seam); ctx.lineTo(size * 0.5, size - 1); ctx.stroke();
    }
    // Tiny deterministic fibres, not a moving noise pass or a full-size image.
    for (let i = 0; i < 5; i++) {
      ctx.globalAlpha = wall ? 0.16 : 0.12;
      ctx.fillStyle = cssColor(i % 2 ? style.ink : style.rim);
      const fx = 2 + tileHash(i, variant + 31) * (size - 5);
      const fy = 2 + tileHash(variant + 41, i) * (size - 5);
      ctx.fillRect(fx, fy, i % 2 ? 2 : 1, 1);
    }
    ctx.globalAlpha = 1;
    // The normal renderer uses only 28px; keep this helper bounded for other callers.
    if (tileCache.size >= 256) tileCache.clear();
    tileCache.set(key, canvas);
    return canvas;
  }

  function drawPaperTile(ctx, theme, tile) {
    theme = theme || THEMES[0];
    const { map, x, y, px, py, size, wall, inVis, room } = tile;
    const style = paperStyle(theme);
    const variant = Math.floor(tileHash(x, y) * 4);
    ctx.save();
    ctx.drawImage(flatTile(theme, wall, room, variant, size), px, py, size, size);
    if (wall) {
      // Highlight only the cut edge facing a traversable tile; continuous walls
      // remain one mass and do not become a checkerboard of collectible stickers.
      const open = (dx, dy) => x + dx >= 0 && y + dy >= 0 && x + dx < map.width && y + dy < map.height && map.tiles[y + dy][x + dx] !== MD.TILE.WALL;
      ctx.lineWidth = 2;
      ctx.strokeStyle = cssColor(style.rim);
      ctx.beginPath();
      if (open(0, -1)) { ctx.moveTo(px, py + 1); ctx.lineTo(px + size, py + 1); }
      if (open(1, 0)) { ctx.moveTo(px + size - 1, py); ctx.lineTo(px + size - 1, py + size); }
      if (open(0, 1)) { ctx.moveTo(px, py + size - 1); ctx.lineTo(px + size, py + size - 1); }
      if (open(-1, 0)) { ctx.moveTo(px + 1, py); ctx.lineTo(px + 1, py + size); }
      ctx.stroke();
    }
    if (!inVis) {
      ctx.fillStyle = "rgba(12,17,26,0.76)";
      ctx.fillRect(px, py, size, size);
    }
    ctx.restore();
  }
  MD.paperTerrain = { style: paperStyle, drawTile: drawPaperTile };

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
