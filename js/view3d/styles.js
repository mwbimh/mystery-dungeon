/* 迷宫 3D — 低多边形地形风格表（按主题 id）
 *
 * floor.style  "ground" 起伏的多边形地面 | "slab" 一块块带倒角的地砖
 * floor.room / floor.corr  房间 / 通道地面的色板（每个三角面随机取一个）
 * wall.style   "rock" 不规则岩壁（顶面高低起伏，侧面分两段外凸）| "block" 规整墙体
 * wall.top / wall.side     顶面 / 侧面色板；wall.base 墙脚色（block）；wall.trim 墙沿发光条（block，可选）
 * wall.h       [最低, 最高] 墙高
 * props.floor  贴墙地面的小物件 [{ kind, p }]，p = 每个贴墙格子出现的概率
 * props.wall   墙顶物件（只放在离地面 maxDist 格以内）
 * mem          记忆中（已探索但不在视野）的颜色乘数
 */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;

  const STYLES = {
    cave: {
      floor: { style: "ground", bump: 0.05, room: [0xd2b98f, 0xc8ad82, 0xdac39c, 0xc2a67c], corr: [0xb9a283, 0xae977a, 0xc1ab8c] },
      wall: { style: "rock", h: [0.95, 1.6], top: [0x958ead, 0x8b84a3, 0xa09ab8, 0x857e9c], side: [0x756f8f, 0x6c6686, 0x7e7898, 0x645e7e] },
      props: {
        floor: [{ kind: "crystal", p: 0.12 }, { kind: "pebbles", p: 0.18 }, { kind: "stalagmite", p: 0.08 }],
        wall: [{ kind: "boulder", p: 0.22 }, { kind: "crystal", p: 0.05 }],
        maxDist: 2,
      },
      crystal: [0x7fe3ff, 0xc5a0ff, 0xff9fd4],
      mem: 0x4a4a62,
    },
    forest: {
      floor: { style: "ground", bump: 0.06, room: [0x9fd068, 0xabd975, 0x92c45c, 0xb4de7e], corr: [0xcaa876, 0xbd9b6a, 0xd4b483] },
      wall: { style: "rock", h: [0.7, 1.05], top: [0x62ad48, 0x6fba53, 0x58a040, 0x7bc25c], side: [0x8f6545, 0x815a3c, 0x9a6f4e, 0x76523a] },
      props: {
        floor: [{ kind: "grass", p: 0.35 }, { kind: "flowers", p: 0.14 }, { kind: "mushroom", p: 0.06 }],
        wall: [{ kind: "tree", p: 0.55 }, { kind: "bush", p: 0.25 }],
        maxDist: 2,
      },
      leaves: [0x3f9a3c, 0x4caa45, 0x338a37, 0x5bb54c],
      trunk: [0x6e4b2f, 0x7a5636],
      flowers: [0xffd85a, 0xff8f86, 0xffffff, 0xc9a6ff],
      mem: 0x3e4c44,
    },
    wetcave: {
      floor: { style: "ground", bump: 0.05, room: [0x88adc2, 0x7fa3b8, 0x93b7cb], corr: [0x7393a6, 0x6b8b9e] },
      wall: { style: "rock", h: [1.0, 1.7], top: [0x5a7d94, 0x52748b, 0x6386a0], side: [0x45627a, 0x3e5a71, 0x4c6a83] },
      props: {
        floor: [{ kind: "stalagmite", p: 0.14 }, { kind: "crystal", p: 0.08 }, { kind: "pebbles", p: 0.12 }],
        wall: [{ kind: "boulder", p: 0.2 }],
        maxDist: 2,
      },
      crystal: [0x8fe8ff, 0xa8c4ff],
      mem: 0x3a4a5a,
    },
    ruins: {
      floor: { style: "slab", room: [0xdccda7, 0xd2c29b, 0xe4d6b2, 0xcdbd95], corr: [0xc1b08c, 0xb7a682], grout: 0x9c8d6e },
      wall: { style: "block", h: [1.1, 1.3], top: [0xc7b892, 0xbcad88], side: [0xae9e7e, 0xa39374, 0xb8a888], base: 0x8c7d62 },
      props: {
        floor: [{ kind: "rubble", p: 0.18 }, { kind: "pillar", p: 0.06 }, { kind: "grass", p: 0.12 }],
        wall: [{ kind: "rubble", p: 0.15 }],
        maxDist: 1,
      },
      mem: 0x4c463c,
    },
    wooden: {
      floor: { style: "slab", room: [0xc98f56, 0xbd844c, 0xd49a61, 0xb37a44], corr: [0xa9743f, 0x9e6b39], grout: 0x6e4a2a },
      wall: { style: "block", h: [1.1, 1.2], top: [0x7d5535, 0x734d30], side: [0x9f6e44, 0x94653e, 0xa8764a], base: 0x5e3f27 },
      props: {
        floor: [{ kind: "crate", p: 0.12 }, { kind: "barrel", p: 0.1 }],
        wall: [],
        maxDist: 1,
      },
      mem: 0x4a3c30,
    },
    modern: {
      floor: { style: "slab", room: [0xe8e8e4, 0xdededa, 0xf0f0ec], corr: [0xcbcdd1, 0xc2c4c8], grout: 0xa4a8ae },
      wall: { style: "block", h: [1.15, 1.25], top: [0x9ca5af, 0x939ca6], side: [0xd2d7dd, 0xc8ced5, 0xdadfe4], base: 0x7f8792 },
      props: {
        floor: [{ kind: "planter", p: 0.08 }, { kind: "crate", p: 0.08 }],
        wall: [],
        maxDist: 1,
      },
      leaves: [0x4caa45, 0x3f9a3c],
      mem: 0x484c54,
    },
    cyber: {
      floor: { style: "slab", room: [0x3d3854, 0x36314c, 0x433d5c], corr: [0x2e2b42, 0x29263b], grout: 0x1c1a28 },
      wall: { style: "block", h: [1.2, 1.5], top: [0x24222f, 0x2a2837], side: [0x403a5a, 0x383352, 0x48416a], base: 0x1e1c2a, trim: [0xff4fd8, 0x40e0ff] },
      props: {
        floor: [{ kind: "neon", p: 0.08 }, { kind: "crate", p: 0.06 }],
        wall: [],
        maxDist: 1,
      },
      neon: [0xff4fd8, 0x40e0ff, 0xffe14f],
      mem: 0x3a3650,
    },
    future: {
      floor: { style: "slab", room: [0xeaf2f9, 0xe0eaf3, 0xf3f8fc], corr: [0xcfdce8, 0xc6d4e2], grout: 0xa9bccd },
      wall: { style: "block", h: [1.2, 1.3], top: [0xf5f9fc, 0xeef4f9], side: [0xcad8e6, 0xc1d1e1, 0xd3e0ec], base: 0x95a9bd, trim: [0x5ad1ff] },
      props: {
        floor: [{ kind: "neon", p: 0.07 }],
        wall: [],
        maxDist: 1,
      },
      neon: [0x5ad1ff, 0x9fe8ff],
      mem: 0x4a5664,
    },
  };

  function styleFor(theme) {
    return STYLES[(theme && theme.id) || "cave"] || STYLES.cave;
  }

  Object.assign(V, { TERRAIN_STYLES: STYLES, styleFor });
})(typeof window !== "undefined" ? window : globalThis);
