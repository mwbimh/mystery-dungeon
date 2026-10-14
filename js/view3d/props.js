/* 迷宫 3D — 低多边形小物件（晶石、石头、树、草、箱子……）
 * 每个函数签名：(builder, x, y, z, style, seed, meta, glowBuilder)
 * 物件和地形合在同一个网格里，跟着所在格子的视野一起变暗。
 */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { hash01 } = V;

  const _c = new THREE.Color();
  function C(hex, mul) {
    _c.setHex(hex);
    const m = mul == null ? 1 : mul;
    return [Math.min(1, _c.r * m), Math.min(1, _c.g * m), Math.min(1, _c.b * m)];
  }
  function pick(list, f) {
    return list[Math.min(list.length - 1, Math.floor(f * list.length))];
  }
  function R(seed, k) { return hash01(seed, k * 7 + 3); }
  // 朝上的面亮一点、朝下暗一点，卡通感更强
  function shadeBy(col) {
    return function (i, ny) {
      const m = ny > 0.5 ? 1.08 : ny < -0.3 ? 0.7 : 0.95;
      return [Math.min(1, col[0] * m), Math.min(1, col[1] * m), Math.min(1, col[2] * m)];
    };
  }
  function place(geo, x, y, z, rx, ry, rz, sx, sy, sz) {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(sx || 1, sy || 1, sz || 1));
    geo.applyMatrix4(m);
    return geo;
  }

  const P = {};

  P.crystal = function (b, x, y, z, st, seed, meta) {
    const pal = st.crystal || [0x7fe3ff];
    const col = C(pick(pal, R(seed, 1)), 1.05);
    const n = 2 + Math.floor(R(seed, 2) * 2);
    for (let i = 0; i < n; i++) {
      const s = 0.05 + R(seed, 10 + i) * 0.04;
      const hgt = 2.2 + R(seed, 20 + i) * 1.6;
      const g = place(new THREE.OctahedronGeometry(s, 0), x + (R(seed, 30 + i) - 0.5) * 0.16, y + s * hgt * 0.7, z + (R(seed, 40 + i) - 0.5) * 0.16,
        (R(seed, 50 + i) - 0.5) * 0.7, R(seed, 60 + i) * 3, (R(seed, 70 + i) - 0.5) * 0.7, 1, hgt, 1);
      b.geo(g, shadeBy(col), meta);
    }
  };

  P.pebbles = function (b, x, y, z, st, seed, meta) {
    const n = 2 + Math.floor(R(seed, 1) * 2);
    for (let i = 0; i < n; i++) {
      const s = 0.04 + R(seed, 10 + i) * 0.05;
      const col = C(pick(st.wall.side, R(seed, 20 + i)), 1.15);
      const g = place(new THREE.IcosahedronGeometry(s, 0), x + (R(seed, 30 + i) - 0.5) * 0.3, y + s * 0.4, z + (R(seed, 40 + i) - 0.5) * 0.3,
        R(seed, 50 + i) * 3, R(seed, 60 + i) * 3, 0, 1.2, 0.7, 1);
      b.geo(g, shadeBy(col), meta);
    }
  };

  P.stalagmite = function (b, x, y, z, st, seed, meta) {
    const col = C(pick(st.wall.side, R(seed, 1)), 1.12);
    const hgt = 0.3 + R(seed, 2) * 0.25;
    b.geo(place(new THREE.ConeGeometry(0.09, hgt, 5), x, y + hgt / 2, z, 0, R(seed, 3) * 3), shadeBy(col), meta);
    const h2 = hgt * 0.55;
    b.geo(place(new THREE.ConeGeometry(0.06, h2, 5), x + 0.1, y + h2 / 2, z + 0.05, 0, R(seed, 4) * 3), shadeBy(col), meta);
  };

  P.boulder = function (b, x, y, z, st, seed, meta) {
    const col = C(pick(st.wall.top, R(seed, 1)), 0.95);
    const s = 0.16 + R(seed, 2) * 0.12;
    b.geo(place(new THREE.IcosahedronGeometry(s, 0), x, y + s * 0.45, z, R(seed, 3) * 3, R(seed, 4) * 3, 0, 1.2, 0.8, 1.1), shadeBy(col), meta);
    if (R(seed, 5) > 0.5) {
      const s2 = s * 0.55;
      b.geo(place(new THREE.IcosahedronGeometry(s2, 0), x + s, y + s2 * 0.4, z + s * 0.4, R(seed, 6) * 3, 0, 0), shadeBy(col), meta);
    }
  };

  P.tree = function (b, x, y, z, st, seed, meta) {
    const leaves = st.leaves || [0x3f9a3c];
    const trunk = C(pick(st.trunk || [0x6e4b2f], R(seed, 1)));
    const sc = 0.8 + R(seed, 2) * 0.45;
    const th = 0.28 * sc;
    b.geo(place(new THREE.CylinderGeometry(0.04 * sc, 0.06 * sc, th, 5), x, y + th / 2, z), shadeBy(trunk), meta);
    const lc = C(pick(leaves, R(seed, 3)));
    if (R(seed, 4) > 0.45) {
      // 针叶树：两层圆锥
      const h1 = 0.5 * sc, h2 = 0.4 * sc;
      b.geo(place(new THREE.ConeGeometry(0.34 * sc, h1, 6), x, y + th + h1 / 2 - 0.04, z, 0, R(seed, 5) * 3), shadeBy(lc), meta);
      b.geo(place(new THREE.ConeGeometry(0.25 * sc, h2, 6), x, y + th + h1 * 0.62 + h2 / 2, z, 0, R(seed, 6) * 3), shadeBy(C(pick(leaves, R(seed, 7)), 1.06)), meta);
    } else {
      // 阔叶树：一大一小两团多面体
      const r = 0.3 * sc;
      b.geo(place(new THREE.IcosahedronGeometry(r, 0), x, y + th + r * 0.8, z, R(seed, 5) * 3, R(seed, 6) * 3, 0, 1, 0.9, 1), shadeBy(lc), meta);
      b.geo(place(new THREE.IcosahedronGeometry(r * 0.62, 0), x + r * 0.55, y + th + r * 0.55, z + r * 0.3, R(seed, 8) * 3, 0, 0), shadeBy(C(pick(leaves, R(seed, 9)), 1.05)), meta);
    }
  };

  P.bush = function (b, x, y, z, st, seed, meta) {
    const leaves = st.leaves || [0x3f9a3c];
    const r = 0.17 + R(seed, 1) * 0.08;
    b.geo(place(new THREE.IcosahedronGeometry(r, 0), x, y + r * 0.55, z, R(seed, 2) * 3, R(seed, 3) * 3, 0, 1.25, 0.75, 1.1), shadeBy(C(pick(leaves, R(seed, 4)), 1.04)), meta);
    b.geo(place(new THREE.IcosahedronGeometry(r * 0.7, 0), x + r * 0.8, y + r * 0.4, z - r * 0.3, R(seed, 5) * 3, 0, 0, 1.1, 0.8, 1), shadeBy(C(pick(leaves, R(seed, 6)))), meta);
  };

  P.grass = function (b, x, y, z, st, seed, meta) {
    const leaves = st.leaves || [0x6faf4a, 0x5f9f40];
    const n = 3 + Math.floor(R(seed, 1) * 3);
    for (let i = 0; i < n; i++) {
      const hgt = 0.1 + R(seed, 10 + i) * 0.1;
      const col = C(pick(leaves, R(seed, 20 + i)), 1.15);
      b.geo(place(new THREE.ConeGeometry(0.025, hgt, 3), x + (R(seed, 30 + i) - 0.5) * 0.22, y + hgt / 2, z + (R(seed, 40 + i) - 0.5) * 0.22,
        (R(seed, 50 + i) - 0.5) * 0.6, R(seed, 60 + i) * 3, (R(seed, 70 + i) - 0.5) * 0.6), shadeBy(col), meta);
    }
  };

  P.flowers = function (b, x, y, z, st, seed, meta) {
    P.grass(b, x, y, z, st, seed, meta);
    const pal = st.flowers || [0xffd85a, 0xffffff];
    const n = 2 + Math.floor(R(seed, 2) * 2);
    for (let i = 0; i < n; i++) {
      const col = C(pick(pal, R(seed, 80 + i)));
      b.geo(place(new THREE.OctahedronGeometry(0.035, 0), x + (R(seed, 90 + i) - 0.5) * 0.22, y + 0.12 + R(seed, 95 + i) * 0.06, z + (R(seed, 99 + i) - 0.5) * 0.22,
        0, R(seed, 100 + i) * 3, 0, 1, 0.6, 1), shadeBy(col), meta);
    }
  };

  P.mushroom = function (b, x, y, z, st, seed, meta) {
    const caps = [0xe0503c, 0xd9a35c, 0xf08a5d];
    const n = 1 + Math.floor(R(seed, 1) * 2);
    for (let i = 0; i < n; i++) {
      const s = (0.7 + R(seed, 10 + i) * 0.5) * (i ? 0.7 : 1);
      const ox = i ? 0.09 : 0, oz = i ? 0.06 : 0;
      b.geo(place(new THREE.CylinderGeometry(0.025 * s, 0.03 * s, 0.1 * s, 5), x + ox, y + 0.05 * s, z + oz), shadeBy(C(0xf3e7cf)), meta);
      b.geo(place(new THREE.ConeGeometry(0.08 * s, 0.07 * s, 6), x + ox, y + 0.12 * s, z + oz), shadeBy(C(pick(caps, R(seed, 20 + i)))), meta);
    }
  };

  P.rubble = function (b, x, y, z, st, seed, meta) {
    const n = 2 + Math.floor(R(seed, 1) * 3);
    for (let i = 0; i < n; i++) {
      const s = 0.06 + R(seed, 10 + i) * 0.08;
      const col = C(pick(st.wall.side, R(seed, 20 + i)), 1.05);
      b.geo(place(new THREE.BoxGeometry(s, s * 0.7, s * 1.2), x + (R(seed, 30 + i) - 0.5) * 0.3, y + s * 0.3, z + (R(seed, 40 + i) - 0.5) * 0.3,
        (R(seed, 50 + i) - 0.5) * 0.5, R(seed, 60 + i) * 3, (R(seed, 70 + i) - 0.5) * 0.5), shadeBy(col), meta);
    }
  };

  P.pillar = function (b, x, y, z, st, seed, meta) {
    const col = C(pick(st.wall.top, R(seed, 1)), 1.05);
    const hgt = 0.35 + R(seed, 2) * 0.35;
    b.geo(place(new THREE.BoxGeometry(0.3, 0.08, 0.3), x, y + 0.04, z), shadeBy(C(st.wall.base || 0x8c7d62)), meta);
    b.geo(place(new THREE.CylinderGeometry(0.1, 0.12, hgt, 6), x, y + 0.08 + hgt / 2, z, (R(seed, 3) - 0.5) * 0.1, R(seed, 4) * 3, 0), shadeBy(col), meta);
  };

  P.crate = function (b, x, y, z, st, seed, meta) {
    const wood = [0xb5834e, 0xa57544, 0xc29058];
    const s = 0.24 + R(seed, 1) * 0.08;
    b.geo(place(new THREE.BoxGeometry(s, s, s), x, y + s / 2, z, 0, R(seed, 2) * 1.5), shadeBy(C(pick(wood, R(seed, 3)))), meta);
    if (R(seed, 4) > 0.6) {
      const s2 = s * 0.7;
      b.geo(place(new THREE.BoxGeometry(s2, s2, s2), x, y + s + s2 / 2, z, 0, R(seed, 5) * 1.5), shadeBy(C(pick(wood, R(seed, 6)), 1.05)), meta);
    }
  };

  P.barrel = function (b, x, y, z, st, seed, meta) {
    const hgt = 0.3;
    b.geo(place(new THREE.CylinderGeometry(0.11, 0.11, hgt, 8), x, y + hgt / 2, z), shadeBy(C(0x9b6a3c)), meta);
    b.geo(place(new THREE.CylinderGeometry(0.118, 0.118, 0.03, 8), x, y + hgt * 0.75, z), shadeBy(C(0x55504a)), meta);
    b.geo(place(new THREE.CylinderGeometry(0.118, 0.118, 0.03, 8), x, y + hgt * 0.25, z), shadeBy(C(0x55504a)), meta);
  };

  P.planter = function (b, x, y, z, st, seed, meta) {
    b.geo(place(new THREE.BoxGeometry(0.26, 0.18, 0.26), x, y + 0.09, z), shadeBy(C(0x8f98a3)), meta);
    P.bush(b, x, y + 0.16, z, st, seed, meta);
  };

  P.neon = function (b, x, y, z, st, seed, meta) {
    const col = C(pick(st.neon || [0x40e0ff], R(seed, 1)));
    const hgt = 0.4 + R(seed, 2) * 0.3;
    b.geo(place(new THREE.BoxGeometry(0.05, hgt, 0.05), x, y + hgt / 2, z), () => col, meta);
  };

  V.terrainProps = P;
})(typeof window !== "undefined" ? window : globalThis);
