/* 迷宫 3D — 低多边形地形：地面、墙体、楼梯和小物件
 *
 * 全部用平面着色的三角面拼出来，不用贴图；每个面的底色来自 styles.js 的色板，
 * 再乘以视野颜色（视野内 / 记忆中 / 未探索）。所有面都是非索引顶点，法线即面法线。
 * 网格分两份：lit（受光照）和 glow（不受光照，用于霓虹、发光条）。
 */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { S, decoList, fbm, hash01 } = V;

  // ---------- 工具 ----------
  const _c = new THREE.Color();
  function colArr(hex, mul) {
    _c.setHex(hex);
    const m = mul == null ? 1 : mul;
    return [Math.min(1, _c.r * m), Math.min(1, _c.g * m), Math.min(1, _c.b * m)];
  }
  function pick(list, f) {
    return list[Math.min(list.length - 1, Math.floor(f * list.length))];
  }
  function inMap(map, x, y) {
    return x >= 0 && y >= 0 && x < map.width && y < map.height;
  }
  function isWall(map, x, y) {
    if (!inMap(map, x, y)) return true;
    return map.tiles[y][x] === MD.TILE.WALL;
  }
  function isFloor(map, x, y) {
    return inMap(map, x, y) && map.tiles[y][x] !== MD.TILE.WALL;
  }
  function isRoom(map, x, y) {
    return inMap(map, x, y) && map.roomIds[y][x] != null && (map.roomIds[y][x] | 0) >= 0;
  }

  // ---------- 非索引三角面构建器 ----------
  function Builder() {
    this.pos = [];
    this.base = [];
    this.meta = [];
  }
  const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _n = new THREE.Vector3();
  /** 三角面；hint 给出朝外方向时自动纠正绕序。 */
  Builder.prototype.tri = function (a, b, c, col, meta, hint) {
    if (hint) {
      _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      _n.crossVectors(_ab, _ac);
      if (_n.x * hint[0] + _n.y * hint[1] + _n.z * hint[2] < 0) { const t = b; b = c; c = t; }
    }
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) {
      this.base.push(col[0], col[1], col[2]);
      this.meta.push(meta);
    }
  };
  Builder.prototype.quad = function (a, b, c, d, col, meta, hint) {
    this.tri(a, b, c, col, meta, hint);
    this.tri(a, c, d, col, meta, hint);
  };
  /** 追加一个 three 几何体（先变换好），每个面一个颜色。colorFn(faceIndex, normalY) -> [r,g,b] */
  Builder.prototype.geo = function (geo, colorFn, meta) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    if (this.k && this.k !== 1) {
      // 物件整体缩放（以落点为中心）
      const o = this.anchor, k = this.k;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, o[0] + (p.getX(i) - o[0]) * k, o[1] + (p.getY(i) - o[1]) * k, o[2] + (p.getZ(i) - o[2]) * k);
      }
    }
    for (let i = 0; i < p.count; i += 3) {
      const a = [p.getX(i), p.getY(i), p.getZ(i)];
      const b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
      const c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
      _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      _n.crossVectors(_ab, _ac).normalize();
      this.tri(a, b, c, colorFn(i / 3, _n.y), meta);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  };
  Builder.prototype.toMesh = function (material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    const colorAttr = new THREE.Float32BufferAttribute(new Float32Array(this.base.length), 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("color", colorAttr);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    return { mesh: mesh, meta: this.meta, base: new Float32Array(this.base) };
  };

  function litMat() {
    return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true });
  }
  function glowMat() {
    return new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  }

  // ---------- 清理 ----------
  V.terrainParts = [];
  function clearMap() {
    for (let i = 0; i < V.terrainParts.length; i++) {
      const m = V.terrainParts[i].mesh;
      V.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    V.terrainParts = [];
    if (V.stairsRoot) V.stairsRoot.visible = false;
    decoList.length = 0;
    V.lastVisSig = "";
  }

  // ---------- 主构建 ----------
  function rebuildMap(map) {
    clearMap();
    if (!map) return;
    const st = V.styleFor(V.currentTheme);
    const fs = st.floor, ws = st.wall;
    const w = map.width, h = map.height;
    const lit = new Builder();
    const glow = new Builder();
    const rock = ws.style === "rock";

    // 每格一个视野 meta：地面看自己；墙看自己和半径 2 内的地面（这样墙顶的树、石头跟着周围地面一起亮）
    const metaGrid = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const floor = isFloor(map, x, y);
        const cells = [{ x: x, y: y, room: floor && isRoom(map, x, y) }];
        if (!floor) {
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            if ((dx || dy) && isFloor(map, x + dx, y + dy)) cells.push({ x: x + dx, y: y + dy, room: false });
          }
        }
        row.push({ kind: floor ? "floor" : "wall", corr: floor && !cells[0].room, cells: cells });
      }
      metaGrid.push(row);
    }
    const M = (x, y) => (inMap(map, x, y) ? metaGrid[y][x] : { kind: "wall", cells: [] });

    // 墙离最近地面的距离（BFS，用来决定墙顶物件放多深）
    const dist = [];
    for (let y = 0; y < h; y++) dist.push(new Array(w).fill(99));
    const q = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isFloor(map, x, y)) { dist[y][x] = 0; q.push(x, y); }
    for (let i = 0; i < q.length; i += 2) {
      const x = q[i], y = q[i + 1], d = dist[y][x] + 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inMap(map, nx, ny) && dist[ny][nx] > d) { dist[ny][nx] = d; q.push(nx, ny); }
      }
    }

    // ---- 顶点位置（按格点共享，保证面与面严丝合缝）----
    function cellsAround(vi, vj, fn) {
      let n = 0;
      if (fn(vi - 1, vj - 1)) n++;
      if (fn(vi, vj - 1)) n++;
      if (fn(vi - 1, vj)) n++;
      if (fn(vi, vj)) n++;
      return n;
    }
    function floorY(vi, vj) {
      return ((fbm(vi * 0.8, vj * 0.8) - 0.5) * (fs.bump || 0)) + 0.0;
    }
    const fCache = new Map();
    function floorV(vi, vj) {
      const k = vi * 4096 + vj;
      let v = fCache.get(k);
      if (v) return v;
      let x = vi - 0.5, z = vj - 0.5;
      const y = fs.style === "ground" ? floorY(vi, vj) : 0;
      if (fs.style === "ground" && cellsAround(vi, vj, (a, b) => isFloor(map, a, b)) === 4) {
        x += (hash01(vi * 3, vj * 7) - 0.5) * 0.24;
        z += (hash01(vi * 5 + 1, vj * 3) - 0.5) * 0.24;
      }
      v = [x, y, z];
      fCache.set(k, v);
      return v;
    }
    // 角点朝向地面的方向（岩壁外凸、顶沿外挑都沿这个方向）
    function towardFloor(vi, vj) {
      let ox = 0, oz = 0;
      const cand = [[vi - 1, vj - 1], [vi, vj - 1], [vi - 1, vj], [vi, vj]];
      for (let i = 0; i < 4; i++) {
        if (isFloor(map, cand[i][0], cand[i][1])) {
          ox += cand[i][0] - (vi - 0.5);
          oz += cand[i][1] - (vj - 0.5);
        }
      }
      const len = Math.hypot(ox, oz);
      return len ? [ox / len, oz / len] : [0, 0];
    }
    const tCache = new Map();
    function topV(vi, vj) {
      const k = vi * 4096 + vj;
      let v = tCache.get(k);
      if (v) return v;
      let x = vi - 0.5, z = vj - 0.5, y;
      if (rock) {
        y = ws.h[0] + fbm(vi * 0.45 + 11.2, vj * 0.45 + 4.8) * (ws.h[1] - ws.h[0]) * 1.4;
        const t = towardFloor(vi, vj);
        const amt = 0.02 + hash01(vi, vj + 99) * 0.08;
        x += t[0] * amt + (hash01(vi + 40, vj) - 0.5) * 0.1;
        z += t[1] * amt + (hash01(vi, vj + 40) - 0.5) * 0.1;
      } else {
        y = ws.h[0];
      }
      v = [x, y, z];
      tCache.set(k, v);
      return v;
    }
    const mCache = new Map();
    function midV(vi, vj) {
      const k = vi * 4096 + vj;
      let v = mCache.get(k);
      if (v) return v;
      const b = floorV(vi, vj), t = topV(vi, vj);
      const f = towardFloor(vi, vj);
      const out = 0.05 + hash01(vi * 7, vj * 11) * 0.11;
      const r = 0.42 + hash01(vi * 13, vj * 5) * 0.16;
      v = [b[0] + (t[0] - b[0]) * r + f[0] * out, b[1] + (t[1] - b[1]) * r, b[2] + (t[2] - b[2]) * r + f[1] * out];
      mCache.set(k, v);
      return v;
    }

    const UP = [0, 1, 0];
    const stairs = map.stairs;

    // ---- 地面 ----
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isFloor(map, x, y)) continue;
        if (stairs && stairs.x === x && stairs.y === y) { addStairs(x, y); continue; }
        const meta = M(x, y);
        const pal = meta.corr ? fs.corr : fs.room;
        if (fs.style === "ground") {
          const a = floorV(x, y), b = floorV(x + 1, y), c = floorV(x + 1, y + 1), d = floorV(x, y + 1);
          const patch = fbm(x * 0.21 + 3.1, y * 0.21 + 8.7);
          const c1 = colArr(pick(pal, (patch * 0.7 + hash01(x * 2, y) * 0.3) % 1), 0.97 + hash01(x, y * 3) * 0.06);
          const c2 = colArr(pick(pal, (patch * 0.7 + hash01(x, y * 2 + 1) * 0.3) % 1), 0.97 + hash01(x * 3, y) * 0.06);
          if (hash01(x * 9, y * 17) > 0.5) {
            lit.tri(a, b, c, c1, meta, UP); lit.tri(a, c, d, c2, meta, UP);
          } else {
            lit.tri(a, b, d, c1, meta, UP); lit.tri(b, c, d, c2, meta, UP);
          }
        } else {
          // slab：倒角地砖，缝隙用 grout 色
          const x0 = x - 0.5, x1 = x + 0.5, z0 = y - 0.5, z1 = y + 0.5;
          const ins = 0.06, top = 0.035;
          const col = colArr(pick(pal, hash01(x * 7, y * 13)), 0.96 + hash01(x * 5, y) * 0.08);
          const A = [x0 + ins, top, z0 + ins], B = [x1 - ins, top, z0 + ins], C = [x1 - ins, top, z1 - ins], D = [x0 + ins, top, z1 - ins];
          const a = [x0, 0, z0], b = [x1, 0, z0], c = [x1, 0, z1], d = [x0, 0, z1];
          lit.quad(A, B, C, D, col, meta, UP);
          const bev = colArr(pick(pal, hash01(x * 7, y * 13)), 0.8);
          lit.quad(a, b, B, A, bev, meta, [0, 0.5, -1]);
          lit.quad(b, c, C, B, bev, meta, [1, 0.5, 0]);
          lit.quad(c, d, D, C, bev, meta, [0, 0.5, 1]);
          lit.quad(d, a, A, D, bev, meta, [-1, 0.5, 0]);
        }
      }
    }

    // ---- 墙顶 ----
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isFloor(map, x, y)) continue;
        const meta = M(x, y);
        const a = topV(x, y), b = topV(x + 1, y), c = topV(x + 1, y + 1), d = topV(x, y + 1);
        if (rock) {
          const cy = (a[1] + b[1] + c[1] + d[1]) / 4 + hash01(x * 3, y * 5) * 0.12;
          const ctr = [(a[0] + b[0] + c[0] + d[0]) / 4 + (hash01(x, y * 7) - 0.5) * 0.16, cy, (a[2] + b[2] + c[2] + d[2]) / 4 + (hash01(x * 7, y) - 0.5) * 0.16];
          const quads = [[a, b], [b, c], [c, d], [d, a]];
          for (let i = 0; i < 4; i++) {
            const col = colArr(pick(ws.top, hash01(x * 11 + i, y * 13)), 0.95 + hash01(x + i, y * 2) * 0.1);
            lit.tri(ctr, quads[i][0], quads[i][1], col, meta, UP);
          }
        } else {
          lit.quad(a, b, c, d, colArr(pick(ws.top, hash01(x * 11, y * 13))), meta, UP);
        }
      }
    }

    // ---- 崖壁 / 墙面 ----
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    // 每个方向对应的两个格点（从地面格看，左→右）
    const EDGE = [
      (x, y) => [[x, y], [x + 1, y]],
      (x, y) => [[x + 1, y], [x + 1, y + 1]],
      (x, y) => [[x + 1, y + 1], [x, y + 1]],
      (x, y) => [[x, y + 1], [x, y]],
    ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isFloor(map, x, y)) continue;
        for (let d = 0; d < 4; d++) {
          const wx_ = x + DIRS[d][0], wy_ = y + DIRS[d][1];
          if (!isWall(map, wx_, wy_)) continue;
          const e = EDGE[d](x, y);
          const out = [-DIRS[d][0], 0.15, -DIRS[d][1]];
          const meta = { kind: "wall", cells: [{ x: x, y: y, room: false }, { x: wx_, y: wy_, room: false }] };
          const isStairs = stairs && stairs.x === x && stairs.y === y;
          const b0 = isStairs ? [e[0][0] - 0.5, 0, e[0][1] - 0.5] : floorV(e[0][0], e[0][1]);
          const b1 = isStairs ? [e[1][0] - 0.5, 0, e[1][1] - 0.5] : floorV(e[1][0], e[1][1]);
          const lo0 = [b0[0], b0[1] - 0.04, b0[2]], lo1 = [b1[0], b1[1] - 0.04, b1[2]];
          const t0 = topV(e[0][0], e[0][1]), t1 = topV(e[1][0], e[1][1]);
          if (rock) {
            const m0 = midV(e[0][0], e[0][1]), m1 = midV(e[1][0], e[1][1]);
            const cl = colArr(pick(ws.side, hash01(wx_ * 5 + d, wy_ * 3)), 0.86);
            const cu = colArr(pick(ws.side, hash01(wx_ * 3, wy_ * 5 + d)), 1);
            lit.quad(lo0, lo1, m1, m0, cl, meta, out);
            lit.quad(m0, m1, t1, t0, cu, meta, out);
          } else {
            const bh = 0.16;
            const k0 = [lo0[0], bh, lo0[2]], k1 = [lo1[0], bh, lo1[2]];
            lit.quad(lo0, lo1, k1, k0, colArr(ws.base), meta, out);
            const col = colArr(pick(ws.side, hash01(wx_ * 5 + d, wy_ * 3)));
            if (ws.trim) {
              const ty0 = t0[1] - 0.12, ty1 = t0[1] - 0.06;
              const s0 = [t0[0], ty0, t0[2]], s1 = [t1[0], ty0, t1[2]], u0 = [t0[0], ty1, t0[2]], u1 = [t1[0], ty1, t1[2]];
              lit.quad(k0, k1, s1, s0, col, meta, out);
              const ox = -DIRS[d][0] * 0.004, oz = -DIRS[d][1] * 0.004;
              const tc = colArr(pick(ws.trim, hash01(wx_ * 7, wy_ * 11)));
              glow.quad([s0[0] + ox, s0[1], s0[2] + oz], [s1[0] + ox, s1[1], s1[2] + oz], [u1[0] + ox, u1[1], u1[2] + oz], [u0[0] + ox, u0[1], u0[2] + oz], tc, meta, out);
              lit.quad(u0, u1, t1, t0, col, meta, out);
            } else {
              lit.quad(k0, k1, t1, t0, col, meta, out);
            }
          }
        }
      }
    }

    // ---- 地图边缘的裙边 ----
    function skirt(v0, v1, cx, cy, out) {
      const t0 = topV(v0[0], v0[1]), t1 = topV(v1[0], v1[1]);
      const col = colArr(pick(ws.side, hash01(cx, cy)), 0.8);
      lit.quad([t0[0], -0.3, t0[2]], [t1[0], -0.3, t1[2]], t1, t0, col, M(cx, cy), out);
    }
    for (let y = 0; y < h; y++) {
      skirt([0, y], [0, y + 1], 0, y, [-1, 0, 0]);
      skirt([w, y], [w, y + 1], w - 1, y, [1, 0, 0]);
    }
    for (let x = 0; x < w; x++) {
      skirt([x, 0], [x + 1, 0], x, 0, [0, 0, -1]);
      skirt([x, h], [x + 1, h], x, h - 1, [0, 0, 1]);
    }

    // ---- 楼梯：地面上一个方形洞口，三级台阶往下 ----
    function addStairs(x, y) {
      const meta = M(x, y);
      const r = 0.36, x0 = x - 0.5, x1 = x + 0.5, z0 = y - 0.5, z1 = y + 0.5;
      const rimCol = colArr(fs.style === "slab" ? fs.grout : pick(fs.room, 0.5), 0.9);
      const ix0 = x - r, ix1 = x + r, iz0 = y - r, iz1 = y + r;
      // 洞口四周的地面
      lit.quad([x0, 0, z0], [x1, 0, z0], [ix1, 0, iz0], [ix0, 0, iz0], rimCol, meta, UP);
      lit.quad([x1, 0, z0], [x1, 0, z1], [ix1, 0, iz1], [ix1, 0, iz0], rimCol, meta, UP);
      lit.quad([x1, 0, z1], [x0, 0, z1], [ix0, 0, iz1], [ix1, 0, iz1], rimCol, meta, UP);
      lit.quad([x0, 0, z1], [x0, 0, z0], [ix0, 0, iz0], [ix0, 0, iz1], rimCol, meta, UP);
      const deep = -0.62;
      const wallC = colArr(pick(ws.side, 0.3), 0.55);
      lit.quad([ix0, 0, iz0], [ix1, 0, iz0], [ix1, deep, iz0], [ix0, deep, iz0], wallC, meta, [0, 0, 1]);
      lit.quad([ix1, 0, iz0], [ix1, 0, iz1], [ix1, deep, iz1], [ix1, deep, iz0], wallC, meta, [-1, 0, 0]);
      lit.quad([ix0, 0, iz1], [ix0, 0, iz0], [ix0, deep, iz0], [ix0, deep, iz1], wallC, meta, [1, 0, 0]);
      lit.quad([ix1, 0, iz1], [ix0, 0, iz1], [ix0, deep, iz1], [ix1, deep, iz1], wallC, meta, [0, 0, -1]);
      lit.quad([ix0, deep, iz0], [ix1, deep, iz0], [ix1, deep, iz1], [ix0, deep, iz1], [0.06, 0.05, 0.05], meta, UP);
      const steps = 4, depth = (iz1 - iz0) / steps;
      for (let k = 0; k < steps; k++) {
        const ty = -0.12 * (k + 1);
        const za = iz0 + depth * k, zb = za + depth;
        const sc = colArr(pick(ws.side, 0.6), 1 - k * 0.16);
        const box = new THREE.BoxGeometry(ix1 - ix0 - 0.02, 0.1, depth);
        box.translate(x, ty - 0.05, (za + zb) / 2);
        lit.geo(box, () => sc, meta);
      }
    }
    if (stairs && V.stairsLight) {
      V.stairsLight.position.set(stairs.x * S, 0.55, stairs.y * S);
      V.stairsLight.color.setHex(0xffd090);
      V.stairsLight.visible = false;
    }

    // ---- 小物件 ----
    const P = V.terrainProps;
    const props = st.props || {};
    const big = { crystal: 1, stalagmite: 1, pillar: 1, crate: 1, barrel: 1, planter: 1, neon: 1 };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isFloor(map, x, y)) continue;
        if (stairs && stairs.x === x && stairs.y === y) continue;
        if (map.playerSpawn && map.playerSpawn.x === x && map.playerSpawn.y === y) continue;
        const corridor = (isWall(map, x - 1, y) && isWall(map, x + 1, y)) || (isWall(map, x, y - 1) && isWall(map, x, y + 1));
        for (let d = 0; d < 4; d++) {
          if (!isWall(map, x + DIRS[d][0], y + DIRS[d][1])) continue;
          const list = props.floor || [];
          let roll = hash01(x * 31 + d * 7, y * 17 + d);
          for (let i = 0; i < list.length; i++) {
            const it = list[i];
            if (roll < it.p) {
              if (big[it.kind] && corridor) break;
              const along = (hash01(x + d, y * 5) - 0.5) * 0.5;
              const px = x + DIRS[d][0] * 0.33 + (DIRS[d][1] ? along : 0);
              const pz = y + DIRS[d][1] * 0.33 + (DIRS[d][0] ? along : 0);
              const py = fs.style === "ground" ? floorY(px + 0.5, pz + 0.5) : 0.035;
              const tb = it.kind === "neon" ? glow : lit;
              tb.anchor = [px, py, pz]; tb.k = st.propScale || 1.5;
              P[it.kind](tb, px, py, pz, st, x * 1000 + y * 4 + d, M(x, y), glow);
              tb.k = 1;
              break;
            }
            roll -= it.p;
          }
        }
      }
    }
    const wallList = props.wall || [];
    if (wallList.length) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (isFloor(map, x, y) || dist[y][x] > (props.maxDist || 1)) continue;
          let roll = hash01(x * 13 + 5, y * 29 + 3);
          for (let i = 0; i < wallList.length; i++) {
            const it = wallList[i];
            if (roll < it.p) {
              const a = topV(x, y), b = topV(x + 1, y), c = topV(x + 1, y + 1), d = topV(x, y + 1);
              const px = x + (hash01(x * 3, y) - 0.5) * 0.4;
              const pz = y + (hash01(x, y * 3) - 0.5) * 0.4;
              const py = Math.min(a[1], b[1], c[1], d[1]) + 0.02;
              lit.anchor = [px, py, pz]; lit.k = st.wallPropScale || 1.15;
              P[it.kind](lit, px, py, pz, st, x * 1000 + y * 4 + 77, M(x, y), glow);
              lit.k = 1;
              break;
            }
            roll -= it.p;
          }
        }
      }
    }

    // ---- 上传 ----
    if (lit.pos.length) V.terrainParts.push(lit.toMesh(litMat()));
    if (glow.pos.length) V.terrainParts.push(glow.toMesh(glowMat()));
    for (let i = 0; i < V.terrainParts.length; i++) V.scene.add(V.terrainParts[i].mesh);
  }

  function updateDecos() {}
  function updateDecoVisibility() {}

  Object.assign(V, {
    clearMap, isWall, rebuildMap, updateDecos, updateDecoVisibility, colArr,
  });
})(typeof window !== "undefined" ? window : globalThis);
