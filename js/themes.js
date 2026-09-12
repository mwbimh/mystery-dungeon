/* Dungeon floor themes: every 3 floors shares one environment.
   Each theme drives: fog/sky color, hemisphere light, floor+wall textures
   (runtime PNG with procedural fallback palette), vertex tint palette and
   wall-corner decoration pool. */
(function (global) {
  const MD = (global.MD = global.MD || {});

  const THEMES = [
    {
      id: "cave", name: "洞窟",
      fog: 0xc5e4ef, hemiSky: 0xfff0d8, hemiGround: 0xa8c8b8,
      floorTex: "floor", wallTex: "wall",
      palFloor: [232, 210, 160], palWall: [180, 192, 208],
      tints: {
        floorRoomVis: 0xfff6e4, floorCorrVis: 0xe6f0ea,
        floorRoomMem: 0x9a8868, floorCorrMem: 0x6e7c78,
        wallVis: 0xf0e4f8, wallMem: 0x6a6278,
      },
      deco: ["crystal", "mushroom", "lantern", "vine", "flower"],
    },
    {
      id: "forest", name: "森林",
      fog: 0xd4ecd2, hemiSky: 0xf2ffe0, hemiGround: 0x9cc09a,
      floorTex: "tex/forest-floor", wallTex: "tex/forest-wall",
      palFloor: [168, 208, 128], palWall: [96, 152, 96],
      tints: {
        floorRoomVis: 0xeef8dc, floorCorrVis: 0xd8ecc8,
        floorRoomMem: 0x7c9068, floorCorrMem: 0x5c7060,
        wallVis: 0xd8eecb, wallMem: 0x5c7058,
      },
      deco: ["flower", "vine", "mushroom", "flower", "vine"],
    },
    {
      id: "wetcave", name: "潮湿洞窟",
      fog: 0xc2dcec, hemiSky: 0xeaf6ff, hemiGround: 0x88a8b8,
      floorTex: "tex/wetcave-floor", wallTex: "tex/wetcave-wall",
      palFloor: [168, 196, 216], palWall: [112, 144, 168],
      tints: {
        floorRoomVis: 0xe2f0fa, floorCorrVis: 0xccdcea,
        floorRoomMem: 0x7088a0, floorCorrMem: 0x587088,
        wallVis: 0xd0e4f0, wallMem: 0x506478,
      },
      deco: ["mushroom", "vine", "crystal", "mushroom"],
    },
    {
      id: "ruins", name: "遗迹",
      fog: 0xe6d8c0, hemiSky: 0xfff0d0, hemiGround: 0xb0a088,
      floorTex: "tex/ruins-floor", wallTex: "tex/ruins-wall",
      palFloor: [224, 208, 168], palWall: [176, 152, 112],
      tints: {
        floorRoomVis: 0xf8eeda, floorCorrVis: 0xe6d8c2,
        floorRoomMem: 0x98886a, floorCorrMem: 0x786848,
        wallVis: 0xe8d8c4, wallMem: 0x685840,
      },
      deco: ["crystal", "lantern", "crystal", "vine"],
    },
    {
      id: "wooden", name: "木制建筑",
      fog: 0xecdcc0, hemiSky: 0xffedd0, hemiGround: 0xb09068,
      floorTex: "tex/wooden-floor", wallTex: "tex/wooden-wall",
      palFloor: [216, 176, 120], palWall: [168, 128, 80],
      tints: {
        floorRoomVis: 0xfaecca, floorCorrVis: 0xe8d4b4,
        floorRoomMem: 0x9a7c58, floorCorrMem: 0x785e40,
        wallVis: 0xf0dcba, wallMem: 0x685238,
      },
      deco: ["lantern", "vine", "lantern", "flower"],
    },
    {
      id: "modern", name: "现代建筑",
      fog: 0xe2e6ee, hemiSky: 0xffffff, hemiGround: 0xa8b0c0,
      floorTex: "tex/modern-floor", wallTex: "tex/modern-wall",
      palFloor: [224, 226, 232], palWall: [184, 190, 200],
      tints: {
        floorRoomVis: 0xf4f6fa, floorCorrVis: 0xdfe4ec,
        floorRoomMem: 0x888ea0, floorCorrMem: 0x687084,
        wallVis: 0xe8ecf2, wallMem: 0x586072,
      },
      deco: ["lantern", "flower", "lantern"],
    },
    {
      id: "cyber", name: "赛博朋克",
      fog: 0x201c38, hemiSky: 0x8888ff, hemiGround: 0x302858,
      floorTex: "tex/cyber-floor", wallTex: "tex/cyber-wall",
      palFloor: [72, 80, 120], palWall: [56, 48, 96],
      tints: {
        floorRoomVis: 0x8a92d0, floorCorrVis: 0x7078b0,
        floorRoomMem: 0x3c3868, floorCorrMem: 0x302c58,
        wallVis: 0x7a6ab8, wallMem: 0x2c2850,
      },
      deco: ["crystal", "lantern", "crystal"],
    },
    {
      id: "future", name: "未来科技",
      fog: 0xe8f2ff, hemiSky: 0xf0f8ff, hemiGround: 0xa8c0d8,
      floorTex: "tex/future-floor", wallTex: "tex/future-wall",
      palFloor: [224, 236, 248], palWall: [200, 216, 240],
      tints: {
        floorRoomVis: 0xf4faff, floorCorrVis: 0xe2ecf8,
        floorRoomMem: 0x8898b0, floorCorrMem: 0x687890,
        wallVis: 0xe8f2ff, wallMem: 0x586880,
      },
      deco: ["crystal", "lantern", "crystal", "flower"],
    },
  ];

  const FLOORS_PER_THEME = 3;

  function themeForFloor(floor) {
    const idx = Math.min(THEMES.length - 1, Math.floor((Math.max(1, floor) - 1) / FLOORS_PER_THEME));
    return THEMES[idx];
  }

  MD.THEMES = THEMES;
  MD.FLOORS_PER_THEME = FLOORS_PER_THEME;
  MD.themeForFloor = themeForFloor;
})(typeof window !== "undefined" ? window : globalThis);
