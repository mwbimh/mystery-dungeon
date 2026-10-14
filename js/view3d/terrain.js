/* 迷宫 3D — 手绘 2.5D 地形：地面、圆润岩壁 / 规整墙体、手绘纸片装饰
 *
 * 几何按格点共享顶点位置，地面和墙顶用世界坐标投影贴图，崖壁贴图横向平铺、纵向按墙高铺满一张。
 * 每个顶点的底色 = 主题乘色 × 软阴影（墙脚接触阴影），显示色 = 底色 × 视野乘数（visibility.js）。
 * 网格按贴图分组：floor / corr / top / side，外加 glow（发光条，不受光）。
 */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { S, decoList, fbm, hash01, makePaperMesh } = V;

  const _c = new THREE.Color();
  function colArr(hex, mul) {
    _c.setHex(hex);
    const m = mul == null ? 1 : mul;
    return [Math.min(1, _c.r * m), Math.min(1, _c.g * m), Math.min(1, _c.b * m)];
  }
  function mulC(c, m) { return [c[0] * m, c[1] * m, c[2] * m]; }
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

  // ---------- 非索引三角面构建器（带 UV、逐顶点颜色）----------
  function Builder(ts, sideV) {
    this.pos = [];
    this.uv = [];
    this.base = [];
    this.meta = [];
    this.ts = ts || 0.5;
    this.sideV = sideV || 0.7;
  }
  const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _n = new THREE.Vector3();
  /** 三角面。col 可以是一个颜色或三个顶点各自的颜色；hint 给出朝外方向时自动纠正绕序。 */
  Builder.prototype.tri = function (a, b, c, col, meta, hint) {
    let ca, cb, cc;
    if (Array.isArray(col[0])) { ca = col[0]; cb = col[1]; cc = col[2]; } else { ca = cb = cc = col; }
    _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_ab, _ac);
    if (hint && _n.x * hint[0] + _n.y * hint[1] + _n.z * hint[2] < 0) {
      let t = b; b = c; c = t;
      t = cb; cb = cc; cc = t;
      _n.negate();
    }
    _n.normalize();
    const pts = [a, b, c], cols = [ca, cb, cc];
    const top = Math.abs(_n.y) > 0.55;
    const alongZ = Math.abs(_n.x) > Math.abs(_n.z);
    for (let i = 0; i < 3; i++) {
      const p = pts[i], q = cols[i];
      this.pos.push(p[0], p[1], p[2]);
      if (top) this.uv.push(p[0] * this.ts, -p[2] * this.ts);
      else this.uv.push((alongZ ? p[2] : p[0]) * this.ts, p[1] * this.sideV);
      this.base.push(q[0], q[1], q[2]);
      this.meta.push(meta);
    }
  };
  /** 四边形 a-b-c-d，cols 为四个顶点颜色或一个颜色 */
  Builder.prototype.quad = function (a, b, c, d, cols, meta, hint) {
    const per = Array.isArray(cols[0]);
    this.tri(a, b, c, per ? [cols[0], cols[1], cols[2]] : cols, meta, hint);
    this.tri(a, c, d, per ? [cols[0], cols[2], cols[3]] : cols, meta, hint);
  };
  /** 按位置合并法线，得到圆润的明暗过渡 */
  function smoothNormals(geo) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const acc = new Map();
    const key = (i) => Math.round(p.getX(i) * 500) + "," + Math.round(p.getY(i) * 500) + "," + Math.round(p.getZ(i) * 500);
    for (let i = 0; i < p.count; i++) {
      const k = key(i);
      let a = acc.get(k);
      if (!a) { a = [0, 0, 0]; acc.set(k, a); }
      a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i);
    }
    for (let i = 0; i < p.count; i++) {
      const a = acc.get(key(i));
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
    }
    n.needsUpdate = true;
  }
  Builder.prototype.toMesh = function (material, smooth) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    const colorAttr = new THREE.Float32BufferAttribute(new Float32Array(this.base.length), 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("color", colorAttr);
    geo.computeVertexNormals();
    if (smooth) smoothNormals(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    return { mesh: mesh, meta: this.meta, base: new Float32Array(this.base) };
  };

  function litMat(tex) {
    return new THREE.MeshLambertMaterial({ map: tex || null, vertexColors: true, fog: true });
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
      m.material.dispose(); // 贴图在 styles.js 里缓存复用，不 dispose
    }
    V.terrainParts = [];
    clearDecos();
    V.lastVisSig = "";
  }

  // ---------- 主构建 ----------
  function rebuildMap(map) {
    clearMap();
    if (!map) return;
    const st = V.styleFor(V.currentTheme);
    const ws = st.wall, col = st.col, tex = st.tex || {};
    const rock = ws.style === "rock";
    const bump = (st.floor && st.floor.bump) || 0;
    const ao = st.ao == null ? 0.4 : st.ao;
    const w = map.width, h = map.height;
    const ts = st.texScale || 0.5;
    const sideV = 1 / (ws.h[1] + 0.15);
    const B = {
      floor: new Builder(ts, sideV), corr: new Builder(ts, sideV),
      top: new Builder(st.topScale || ts, sideV), side: new Builder(st.sideScale || ts, sideV), glow: new Builder(ts, sideV),
    };
    const C = {
      floor: colArr(col.floor), corr: colArr(col.corr != null ? col.corr : col.floor),
      top: colArr(col.top), side: colArr(col.side), base: colArr(col.base != null ? col.base : col.side, col.base != null ? 1 : 0.7),
    };

    // 每格一个视野 meta：地面看自己；墙看自己和半径 2 内的地面
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

    function wallsAround(vi, vj) {
      let n = 0;
      if (isWall(map, vi - 1, vj - 1)) n++;
      if (isWall(map, vi, vj - 1)) n++;
      if (isWall(map, vi - 1, vj)) n++;
      if (isWall(map, vi, vj)) n++;
      return n;
    }
    function floorY(vi, vj) {
      return (fbm(vi * 0.8, vj * 0.8) - 0.5) * bump;
    }
    const fCache = new Map();
    function floorV(vi, vj) {
      const k = vi * 4096 + vj;
      let v = fCache.get(k);
      if (v) return v;
      v = [vi - 0.5, floorY(vi, vj), vj - 0.5];
      fCache.set(k, v);
      return v;
    }
    // 地面顶点的接触阴影：贴墙越多越暗
    function floorAO(vi, vj) {
      const n = wallsAround(vi, vj);
      return n === 0 ? 1 : 1 - ao * (n >= 3 ? 0.75 : n === 2 ? 0.5 : 0.3);
    }
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
        // 顶沿往里收一点，让圆唇露出来
        const t = towardFloor(vi, vj);
        x -= t[0] * 0.04;
        z -= t[1] * 0.04;
      } else {
        y = ws.h[0];
      }
      v = [x, y, z];
      tCache.set(k, v);
      return v;
    }
    // 崖壁中间的分段点：r = 高度比例，out = 向地面外凸
    const ROWS = rock
      ? [{ r: 0.28, out: 0.1, c: 1 - ao * 0.45 }, { r: 0.64, out: 0.13, c: 1 - ao * 0.12 }, { r: 0.9, out: 0.1, c: 1.04 }]
      : [];
    const rCache = new Map();
    function rowV(vi, vj, ri) {
      const k = (vi * 4096 + vj) * 4 + ri;
      let v = rCache.get(k);
      if (v) return v;
      const b = floorV(vi, vj), t = topV(vi, vj), R = ROWS[ri];
      const f = towardFloor(vi, vj);
      const out = R.out * (0.8 + hash01(vi * 7 + ri, vj * 11) * 0.45);
      v = [b[0] + (t[0] - b[0]) * R.r + f[0] * out, b[1] + (t[1] - b[1]) * R.r, b[2] + (t[2] - b[2]) * R.r + f[1] * out];
      rCache.set(k, v);
      return v;
    }

    const UP = [0, 1, 0];

    // ---- 地面 ----
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isFloor(map, x, y)) continue;
        const meta = M(x, y);
        const b = meta.corr ? B.corr : B.floor, c0 = meta.corr ? C.corr : C.floor;
        const va = floorV(x, y), vb = floorV(x + 1, y), vc = floorV(x + 1, y + 1), vd = floorV(x, y + 1);
        const cols = [mulC(c0, floorAO(x, y)), mulC(c0, floorAO(x + 1, y)), mulC(c0, floorAO(x + 1, y + 1)), mulC(c0, floorAO(x, y + 1))];
        b.quad(va, vb, vc, vd, cols, meta, UP);
      }
    }

    // ---- 墙顶：中心微鼓，像一块块圆润的岩团 / 树冠 ----
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isFloor(map, x, y)) continue;
        const meta = M(x, y);
        const a = topV(x, y), b = topV(x + 1, y), c = topV(x + 1, y + 1), d = topV(x, y + 1);
        if (rock) {
          const cy = (a[1] + b[1] + c[1] + d[1]) / 4 + 0.06 + hash01(x * 3, y * 5) * 0.08;
          const ctr = [x, cy, y];
          const quads = [[a, b], [b, c], [c, d], [d, a]];
          for (let i = 0; i < 4; i++) B.top.tri(ctr, quads[i][0], quads[i][1], [mulC(C.top, 1.05), C.top, C.top], meta, UP);
        } else {
          B.top.quad(a, b, c, d, C.top, meta, UP);
        }
      }
    }

    // ---- 崖壁 / 墙面 ----
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
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
          const out = [-DIRS[d][0], 0.1, -DIRS[d][1]];
          const meta = { kind: "wall", cells: [{ x: x, y: y, room: false }, { x: wx_, y: wy_, room: false }] };
          const b0 = floorV(e[0][0], e[0][1]), b1 = floorV(e[1][0], e[1][1]);
          const lo0 = [b0[0], b0[1] - 0.04, b0[2]], lo1 = [b1[0], b1[1] - 0.04, b1[2]];
          const t0 = topV(e[0][0], e[0][1]), t1 = topV(e[1][0], e[1][1]);
          const cLo = mulC(C.side, 1 - ao);
          if (rock) {
            let p0 = lo0, p1 = lo1, cp = cLo;
            for (let ri = 0; ri < ROWS.length; ri++) {
              const q0 = rowV(e[0][0], e[0][1], ri), q1 = rowV(e[1][0], e[1][1], ri);
              const cq = mulC(C.side, ROWS[ri].c);
              B.side.quad(p0, p1, q1, q0, [cp, cp, cq, cq], meta, out);
              p0 = q0; p1 = q1; cp = cq;
            }
            B.side.quad(p0, p1, t1, t0, [cp, cp, C.side, C.side], meta, out);
          } else {
            const bh = 0.16;
            const k0 = [lo0[0], bh, lo0[2]], k1 = [lo1[0], bh, lo1[2]];
            const cb = C.base;
            B.side.quad(lo0, lo1, k1, k0, [mulC(cb, 1 - ao), mulC(cb, 1 - ao), cb, cb], meta, out);
            const cs = mulC(C.side, 0.92);
            if (ws.trim) {
              const ty0 = t0[1] - 0.12, ty1 = t0[1] - 0.06;
              const s0 = [t0[0], ty0, t0[2]], s1 = [t1[0], ty0, t1[2]], u0 = [t0[0], ty1, t0[2]], u1 = [t1[0], ty1, t1[2]];
              B.side.quad(k0, k1, s1, s0, [cs, cs, C.side, C.side], meta, out);
              const ox = -DIRS[d][0] * 0.004, oz = -DIRS[d][1] * 0.004;
              const tc = colArr(ws.trim[Math.floor(hash01(wx_ * 7, wy_ * 11) * ws.trim.length) % ws.trim.length]);
              B.glow.quad([s0[0] + ox, s0[1], s0[2] + oz], [s1[0] + ox, s1[1], s1[2] + oz], [u1[0] + ox, u1[1], u1[2] + oz], [u0[0] + ox, u0[1], u0[2] + oz], tc, meta, out);
              B.side.quad(u0, u1, t1, t0, C.side, meta, out);
            } else {
              B.side.quad(k0, k1, t1, t0, [cs, cs, C.side, C.side], meta, out);
            }
          }
        }
      }
    }

    // ---- 地图边缘的裙边 ----
    function skirt(v0, v1, cx, cy, out) {
      const t0 = topV(v0[0], v0[1]), t1 = topV(v1[0], v1[1]);
      const cd = mulC(C.side, 0.6);
      B.side.quad([t0[0], -0.3, t0[2]], [t1[0], -0.3, t1[2]], t1, t0, [cd, cd, C.side, C.side], M(cx, cy), out);
    }
    for (let y = 0; y < h; y++) {
      skirt([0, y], [0, y + 1], 0, y, [-1, 0, 0]);
      skirt([w, y], [w, y + 1], w - 1, y, [1, 0, 0]);
    }
    for (let x = 0; x < w; x++) {
      skirt([x, 0], [x + 1, 0], x, 0, [0, 0, -1]);
      skirt([x, h], [x + 1, h], x, h - 1, [0, 0, 1]);
    }

    if (map.stairs && V.stairsLight) {
      V.stairsLight.position.set(map.stairs.x * S, 0.55, map.stairs.y * S);
      V.stairsLight.color.setHex(0xffd090);
      V.stairsLight.visible = false;
    }

    // ---- 上传 ----
    const parts = [
      ["floor", tex.floor, true], ["corr", tex.corr || tex.floor, true],
      ["top", tex.top, true], ["side", tex.side, true],
    ];
    for (let i = 0; i < parts.length; i++) {
      const b = B[parts[i][0]];
      if (!b.pos.length) continue;
      V.terrainParts.push(b.toMesh(litMat(V.terrainTex(parts[i][1])), parts[i][2]));
    }
    if (B.glow.pos.length) V.terrainParts.push(B.glow.toMesh(glowMat(), false));
    for (let i = 0; i < V.terrainParts.length; i++) V.scene.add(V.terrainParts[i].mesh);

    buildDecos(map);
    placeDecos(map);
  }

  function clearDecos() {
    decoList.length = 0;
    if (!V.decoRoot) return;
    while (V.decoRoot.children.length) {
      const ch = V.decoRoot.children[0];
      V.decoRoot.remove(ch);
      if (ch.userData && ch.userData.paper) V.disposePaper(ch.userData.paper);
    }
  }

  function addDeco(name, wx, wz, tileX, tileY) {
    const g = new THREE.Group();
    const paper = makePaperMesh(name, name === "stairs" ? "actor" : "deco");
    paper.renderOrder = 1;
    g.add(paper);
    g.position.set(wx, 0, wz);
    g.userData.paper = paper;
    g.userData.tx = tileX;
    g.userData.ty = tileY;
    g.userData.ox = wx - tileX * S;
    g.userData.oz = wz - tileY * S;
    g.userData.name = name;
    g.visible = false;
    V.decoRoot.add(g);
    decoList.push(g);
  }

  function buildDecos(map) {
    clearDecos();
    if (!map || !V.decoRoot) return;
    const mh = {};
    const houses = map.monsterHouseRooms || [];
    for (let i = 0; i < houses.length; i++) mh[houses[i]] = true;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.tiles[y][x] === MD.TILE.WALL) continue;
        if (map.stairs && map.stairs.x === x && map.stairs.y === y) continue;
        if (map.playerSpawn && map.playerSpawn.x === x && map.playerSpawn.y === y) continue;
        const wE = isWall(map, x + 1, y) ? 1 : 0;
        const wW = isWall(map, x - 1, y) ? 1 : 0;
        const wS = isWall(map, x, y + 1) ? 1 : 0;
        const wN = isWall(map, x, y - 1) ? 1 : 0;
        const walls = wE + wW + wS + wN;
        if (!walls) continue;
        const room = isRoom(map, x, y);
        const rid = map.roomIds[y][x];
        const n = hash01(x * 17, y * 31);
        const pool = (V.currentTheme && V.currentTheme.deco) || ["crystal", "mushroom", "lantern", "vine", "flower"];
        const pick = (f) => pool[Math.min(pool.length - 1, Math.floor(f * pool.length))];
        let name = null;
        if (room) {
          if (mh[rid] && n > 0.42) {
            name = n > 0.72 ? pick((n * 7) % 1) : (n > 0.56 ? pick((n * 13) % 1) : pick((n * 5) % 1));
          } else if (walls >= 2 && n > 0.36) {
            name = n > 0.7 ? pick((n * 11) % 1) : (n > 0.52 ? pick((n * 17) % 1) : pick((n * 3) % 1));
          } else if (n > 0.64) {
            name = pick((n * 23) % 1);
          }
        } else if (n > 0.84) {
          name = pick((n * 29) % 1);
        }
        if (!name) continue;
        // skip 1-tile corridors (two opposite walls) — sprites clip both sides
        if ((wE && wW && !wN && !wS) || (wN && wS && !wE && !wW)) continue;
        if (walls >= 3) continue;
        const sz = (MD.sprites && MD.sprites.worldSize(name)) || { w: 0.7580, h: 0.9000 };
        const half = (sz.w || 0.4) * 0.5;
        const margin = 0.1;
        const maxToward = Math.max(0, 0.5 - half - margin);
        const toward = Math.min(0.1, maxToward);
        const ox = (wE - wW) * toward;
        const oz = (wS - wN) * toward;
        addDeco(name, x * S + ox, y * S + oz, x, y);
      }
    }
    if (map.stairs) {
      addDeco("stairs", map.stairs.x * S, map.stairs.y * S, map.stairs.x, map.stairs.y);
    }
  }

  // 装饰的位置只取决于地图（静态），可见性只在视野变化时变，朝向只在相机动时变
  let decoCamSig = "";
  function placeDecos(map) {
    for (let i = 0; i < decoList.length; i++) {
      const g = decoList[i];
      const clear = V.wallClearance(map, g.userData.tx, g.userData.ty);
      g.position.x = g.userData.tx * S + (g.userData.ox || 0) + clear.x * 0.7;
      g.position.z = g.userData.ty * S + (g.userData.oz || 0) + clear.z * 0.7;
    }
    decoCamSig = "";
  }

  /** 视野变化时调用：刷新装饰显隐。 */
  function updateDecoVisibility(state) {
    for (let i = 0; i < decoList.length; i++) {
      const g = decoList[i];
      const v = V.visOf(state, g.userData.tx, g.userData.ty);
      if (v.seen && !g.visible) decoCamSig = "";
      g.visible = v.seen;
    }
  }

  /** 每帧调用：相机有变化时让可见装饰朝向相机。 */
  function updateDecos(state) {
    if (!decoList.length || !V.camera) return;
    const c = V.camera.position, q = V.camera.quaternion;
    const sig = c.x.toFixed(3) + "," + c.y.toFixed(3) + "," + c.z.toFixed(3) + "," + q.y.toFixed(4) + "," + q.w.toFixed(4);
    if (sig === decoCamSig) return;
    decoCamSig = sig;
    for (let i = 0; i < decoList.length; i++) {
      const g = decoList[i];
      if (g.visible && g.userData.paper) V.billboard(g.userData.paper, 0.02);
    }
  }

  Object.assign(V, {
    clearMap, isWall, rebuildMap, updateDecos, updateDecoVisibility,
  });
})(typeof window !== "undefined" ? window : globalThis);
