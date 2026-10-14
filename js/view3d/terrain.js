/* 迷宫 3D — carved cave mesh, stairs, decorations */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { S, UV_SCALE, caveMat, decoList, fbm, hash01, makePaperMesh } = V;

  function disposeMesh(mesh) {
    if (!mesh) return;
    V.scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      mesh.material.dispose();
    }
  }

  function clearMap() {
    disposeMesh(V.floorMesh);
    disposeMesh(V.wallMesh);
    disposeMesh(V.floorMeshB);
    disposeMesh(V.wallMeshB);
    disposeMesh(V.edgeMesh);
    V.floorMesh = V.wallMesh = null;
    V.floorMeshB = V.wallMeshB = V.edgeMesh = null;
    V.floorMeta = [];
    V.wallMeta = [];
    V.floorMetaB = [];
    V.wallMetaB = [];
    if (V.stairsRoot) {
      while (V.stairsRoot.children.length) {
        const ch = V.stairsRoot.children[0];
        V.stairsRoot.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      }
    }
    clearDecos();
    V.lastVisSig = "";
  }

  function Builder() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.meta = [];
  }

  Builder.prototype.vert = function (x, y, z, u, v, meta, col) {
    const i = this.meta.length;
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.col.push(col ? col[0] : 0.02, col ? col[1] : 0.012, col ? col[2] : 0.02);
    this.meta.push(meta);
    return i;
  };

  Builder.prototype.tri = function (a, b, c) {
    this.idx.push(a, b, c);
  };

  Builder.prototype.quad = function (a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  };

  Builder.prototype.appendGeo = function (geo, meta, uvWorld) {
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const base = this.meta.length;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const uu = uvWorld ? x * UV_SCALE : (uv ? uv.getX(i) : 0);
      const vv = uvWorld ? z * UV_SCALE : (uv ? uv.getY(i) : y * UV_SCALE);
      this.vert(x, y, z, uu, vv, meta);
    }
    const index = geo.index;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        this.tri(base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        this.tri(base + i, base + i + 1, base + i + 2);
      }
    }
  };

  Builder.prototype.toMesh = function (material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    const colorAttr = new THREE.Float32BufferAttribute(this.col, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("color", colorAttr);
    geo.setIndex(this.idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    return mesh;
  };

  function inMap(map, x, y) {
    return x >= 0 && y >= 0 && x < map.width && y < map.height;
  }

  function isWall(map, x, y) {
    if (!inMap(map, x, y)) return true;
    return map.tiles[y][x] === MD.TILE.WALL;
  }

  function isFloor(map, x, y) {
    if (!inMap(map, x, y)) return false;
    return map.tiles[y][x] !== MD.TILE.WALL;
  }

  function isRoom(map, x, y) {
    return inMap(map, x, y) && (map.roomIds[y][x] | 0) >= 0;
  }

  function wx(vi) { return vi - 0.5; }
  function wz(vj) { return vj - 0.5; }

  function floorH(vi, vj, map) {
    let y = (fbm(vi * 0.82, vj * 0.82) - 0.5) * 0.068;
    if (map.stairs) {
      const dx = wx(vi) - map.stairs.x;
      const dz = wz(vj) - map.stairs.y;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) {
        const t = 1 - d / 1.5;
        y -= 0.06 * t * t;
      }
    }
    return y;
  }

  function wallH(vi, vj) {
    return 0.92 + fbm(vi * 0.47 + 11.2, vj * 0.47 + 4.8) * 0.78;
  }

  function plateauJitter(map, vi, vj) {
    let ox = 0, oz = 0, n = 0;
    const cells = [[vi - 1, vj - 1], [vi, vj - 1], [vi - 1, vj], [vi, vj]];
    for (let i = 0; i < 4; i++) {
      const cx = cells[i][0], cy = cells[i][1];
      if (isFloor(map, cx, cy)) {
        ox += wx(vi) - cx;
        oz += wz(vj) - cy;
        n++;
      }
    }
    if (n === 0) {
      return {
        x: (hash01(vi, vj + 40) - 0.5) * 0.14,
        z: (hash01(vi + 7, vj) - 0.5) * 0.14,
      };
    }
    const len = Math.hypot(ox, oz) || 1;
    const amt = hash01(vi, vj + 99) * 0.12;
    return { x: (ox / len) * amt, z: (oz / len) * amt };
  }

  function floorCellsAt(map, vi, vj) {
    const cells = [];
    const cand = [[vi - 1, vj - 1], [vi, vj - 1], [vi - 1, vj], [vi, vj]];
    for (let i = 0; i < 4; i++) {
      const cx = cand[i][0], cy = cand[i][1];
      if (isFloor(map, cx, cy)) cells.push({ x: cx, y: cy, room: isRoom(map, cx, cy) });
    }
    return cells;
  }

  function wallCellsAt(map, vi, vj) {
    const cells = [];
    const cand = [[vi - 1, vj - 1], [vi, vj - 1], [vi - 1, vj], [vi, vj]];
    for (let i = 0; i < 4; i++) {
      const cx = cand[i][0], cy = cand[i][1];
      if (inMap(map, cx, cy) && map.tiles[cy][cx] === MD.TILE.WALL) {
        cells.push({ x: cx, y: cy, room: false });
      }
    }
    return cells;
  }

  function addRockLump(builder, x, y, z, seed, meta) {
    const geo = new THREE.IcosahedronGeometry(0.16 + hash01(seed, 1) * 0.12, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      hash01(seed, 2) * 2.2,
      hash01(seed, 3) * 6.2,
      hash01(seed, 4) * 1.6
    ));
    const sc = new THREE.Vector3(
      0.65 + hash01(seed, 5) * 0.9,
      0.4 + hash01(seed, 6) * 0.85,
      0.65 + hash01(seed, 7) * 0.9
    );
    m.compose(new THREE.Vector3(x, y, z), q, sc);
    geo.applyMatrix4(m);
    builder.appendGeo(geo, meta, true);
    geo.dispose();
  }

  function addBoxLump(builder, x, y, z, seed, meta) {
    const geo = new THREE.BoxGeometry(
      0.22 + hash01(seed, 8) * 0.28,
      0.18 + hash01(seed, 9) * 0.32,
      0.22 + hash01(seed, 10) * 0.28
    );
    geo.rotateY(hash01(seed, 11) * Math.PI);
    geo.translate(x, y, z);
    builder.appendGeo(geo, meta, true);
    geo.dispose();
  }

  function rebuildMap(map) {
    clearMap();
    if (!map) return;
    const w = map.width, h = map.height;
    const th = V.currentTheme || {};
    const hasB = !!(th.floorTexB && th.wallTexB);
    const fb = new Builder();
    const fbB = hasB ? new Builder() : null;
    const wb = new Builder();
    const wbB = hasB ? new Builder() : null;
    const eb = (th.edge && th.edge.colors) ? new Builder() : null;
    const floorIdxA = new Map();
    const floorIdxB = new Map();
    const platIdxA = new Map();
    const platIdxB = new Map();

    // low-frequency noise splits floor/wall tiles into organic A/B patches
    function floorVar(x, y) { return hasB && fbm(x * 0.33 + 7.3, y * 0.33 + 2.9) > 0.6; }
    function wallVar(x, y) { return hasB && fbm(x * 0.29 + 11.7, y * 0.29 + 5.1) > 0.62; }
    function F(v) { return v ? fbB : fb; }
    function W(v) { return v ? wbB : wb; }
    function FI(v) { return v ? floorIdxB : floorIdxA; }
    function PI(v) { return v ? platIdxB : platIdxA; }

    function getFloorVert(vi, vj, varB) {
      const idx = FI(varB);
      const k = vi + "," + vj;
      if (idx.has(k)) return idx.get(k);
      const x = wx(vi), z = wz(vj);
      const y = floorH(vi, vj, map);
      const idxv = F(varB).vert(x, y, z, x * UV_SCALE, z * UV_SCALE, { kind: "floor", cells: floorCellsAt(map, vi, vj) });
      idx.set(k, idxv);
      return idxv;
    }

    function getPlatVert(vi, vj, varB) {
      const idx = PI(varB);
      const k = vi + "," + vj;
      if (idx.has(k)) return idx.get(k);
      const j = plateauJitter(map, vi, vj);
      const x = wx(vi) + j.x;
      const z = wz(vj) + j.z;
      const y = wallH(vi, vj);
      const idxv = W(varB).vert(x, y, z, x * UV_SCALE, z * UV_SCALE, { kind: "wall", cells: wallCellsAt(map, vi, vj) });
      idx.set(k, idxv);
      return idxv;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isFloor(map, x, y)) continue;
        const vb = floorVar(x, y);
        const sw = getFloorVert(x, y, vb);
        const se = getFloorVert(x + 1, y, vb);
        const ne = getFloorVert(x + 1, y + 1, vb);
        const nw = getFloorVert(x, y + 1, vb);
        F(vb).quad(sw, nw, ne, se);
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (map.tiles[y][x] !== MD.TILE.WALL) continue;
        const vb = wallVar(x, y);
        const sw = getPlatVert(x, y, vb);
        const se = getPlatVert(x + 1, y, vb);
        const ne = getPlatVert(x + 1, y + 1, vb);
        const nw = getPlatVert(x, y + 1, vb);
        // flat top over shared corner heights -> walls read as one continuous
        // terrain instead of a grid of separate pyramids
        W(vb).quad(sw, nw, ne, se);
      }
    }

    function platPos(b, i) {
      return { x: b.pos[i * 3], y: b.pos[i * 3 + 1], z: b.pos[i * 3 + 2] };
    }

    function cliffBottom(vi, vj, wallX, wallY, varB) {
      const x = wx(vi);
      const z = wz(vj);
      const y = floorH(vi, vj, map) - 0.03;
      const meta = { kind: "wall", cells: inMap(map, wallX, wallY) ? [{ x: wallX, y: wallY, room: false }] : wallCellsAt(map, vi, vj) };
      return W(varB).vert(x, y, z, x * UV_SCALE, y * UV_SCALE, meta);
    }

    function addCliff(v0i, v0j, v1i, v1j, wallX, wallY) {
      const vb = wallVar(wallX, wallY);
      const top0 = getPlatVert(v0i, v0j, vb);
      const top1 = getPlatVert(v1i, v1j, vb);
      const bot0 = cliffBottom(v0i, v0j, wallX, wallY, vb);
      const bot1 = cliffBottom(v1i, v1j, wallX, wallY, vb);
      W(vb).quad(bot0, bot1, top1, top0);
      // trim strip hugging the cliff face base (theme edge / neon lines)
      if (th.edge && eb) {
        const pB0 = platPos(W(vb), bot0), pB1 = platPos(W(vb), bot1);
        const pT0 = platPos(W(vb), top0), pT1 = platPos(W(vb), top1);
        const t0 = 0.06, t1 = 0.4;
        const f = th.edge.colors[Math.floor(hash01(wallX * 5, wallY * 11) * th.edge.colors.length) % th.edge.colors.length];
        const col = new THREE.Color(f);
        const jit = 0.85 + hash01(wallX + 2, wallY + 9) * 0.3;
        const cA = [Math.min(1, col.r * jit), Math.min(1, col.g * jit), Math.min(1, col.b * jit)];
        const s0 = eb.vert(
          pB0.x + (pT0.x - pB0.x) * t0, pB0.y + (pT0.y - pB0.y) * t0, pB0.z + (pT0.z - pB0.z) * t0,
          0, 0, { kind: "wall", cells: [{ x: wallX, y: wallY, room: false }] }, cA);
        const s1 = eb.vert(
          pB1.x + (pT1.x - pB1.x) * t0, pB1.y + (pT1.y - pB1.y) * t0, pB1.z + (pT1.z - pB1.z) * t0,
          0, 0, { kind: "wall", cells: [{ x: wallX, y: wallY, room: false }] }, cA);
        const s2 = eb.vert(
          pB1.x + (pT1.x - pB1.x) * t1, pB1.y + (pT1.y - pB1.y) * t1, pB1.z + (pT1.z - pB1.z) * t1,
          0, 0, { kind: "wall", cells: [{ x: wallX, y: wallY, room: false }] }, cA);
        const s3 = eb.vert(
          pB0.x + (pT0.x - pB0.x) * t1, pB0.y + (pT0.y - pB0.y) * t1, pB0.z + (pT0.z - pB0.z) * t1,
          0, 0, { kind: "wall", cells: [{ x: wallX, y: wallY, room: false }] }, cA);
        eb.quad(s0, s3, s2, s1);
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isFloor(map, x, y)) continue;
        if (isWall(map, x, y - 1)) addCliff(x, y, x + 1, y, x, y - 1);
        if (isWall(map, x + 1, y)) addCliff(x + 1, y, x + 1, y + 1, x + 1, y);
        if (isWall(map, x, y + 1)) addCliff(x + 1, y + 1, x, y + 1, x, y + 1);
        if (isWall(map, x - 1, y)) addCliff(x, y + 1, x, y, x - 1, y);
      }
    }

    function addSkirt(v0i, v0j, v1i, v1j, wallX, wallY) {
      const vb = wallVar(wallX, wallY);
      const top0 = getPlatVert(v0i, v0j, vb);
      const top1 = getPlatVert(v1i, v1j, vb);
      const meta = { kind: "wall", cells: inMap(map, wallX, wallY) ? [{ x: wallX, y: wallY, room: false }] : [] };
      const p0 = platPos(W(vb), top0);
      const p1 = platPos(W(vb), top1);
      const b0 = W(vb).vert(p0.x, -0.28, p0.z, p0.x * UV_SCALE, 0, meta);
      const b1 = W(vb).vert(p1.x, -0.28, p1.z, p1.x * UV_SCALE, 0, meta);
      W(vb).quad(b0, b1, top1, top0);
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (map.tiles[y][x] !== MD.TILE.WALL) continue;
        if (x === 0) addSkirt(x, y, x, y + 1, x, y);
        if (x === w - 1) addSkirt(x + 1, y + 1, x + 1, y, x, y);
        if (y === 0) addSkirt(x + 1, y, x, y, x, y);
        if (y === h - 1) addSkirt(x, y + 1, x + 1, y + 1, x, y);
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isFloor(map, x, y)) continue;
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        for (let d = 0; d < 4; d++) {
          const dx = dirs[d][0], dy = dirs[d][1];
          const wx_ = x + dx, wy_ = y + dy;
          if (!inMap(map, wx_, wy_) || map.tiles[wy_][wx_] !== MD.TILE.WALL) continue;
          const px = dirs[d][1], py = -dirs[d][0];
          const longWall = isWall(map, wx_ + px, wy_ + py) && isWall(map, wx_ - px, wy_ - py);
          const n = hash01(x * 3 + dx, y * 5 + dy);
          if (!(longWall && n > 0.62) && n < 0.84) continue;
          const meta = { kind: "wall", cells: [{ x: wx_, y: wy_, room: false }] };
          const lvb = wallVar(wx_, wy_);
          const lx = x + dx * (0.52 + hash01(x, wy_) * 0.18);
          const lz = y + dy * (0.52 + hash01(wy_, x) * 0.18);
          const ly = 0.18 + hash01(x + wy_, 2) * 0.35;
          addRockLump(W(lvb), lx, ly, lz, x * 17 + y * 13 + d, meta);
          if (n > 0.9) addBoxLump(W(lvb), lx + (hash01(d, x) - 0.5) * 0.16, ly * 0.7, lz + (hash01(y, d) - 0.5) * 0.16, x + y + d, meta);
        }
      }
    }

    if (fb.idx.length) {
      V.floorMesh = fb.toMesh(caveMat(V.dirtTex, th));
      V.scene.add(V.floorMesh);
      V.floorMeta = fb.meta;
    }
    if (fbB && fbB.idx.length) {
      V.floorMeshB = fbB.toMesh(caveMat(V.dirtTexB, th));
      V.scene.add(V.floorMeshB);
      V.floorMetaB = fbB.meta;
    }
    if (wb.idx.length) {
      V.wallMesh = wb.toMesh(caveMat(V.rockTex, th));
      V.scene.add(V.wallMesh);
      V.wallMeta = wb.meta;
    }
    if (wbB && wbB.idx.length) {
      V.wallMeshB = wbB.toMesh(caveMat(V.rockTexB, th));
      V.scene.add(V.wallMeshB);
      V.wallMetaB = wbB.meta;
    }
    if (eb && eb.idx.length) {
      V.edgeMesh = eb.toMesh(new THREE.MeshBasicMaterial({
        vertexColors: true,
        fog: true,
        transparent: true,
        opacity: 0.95,
      }));
      V.scene.add(V.edgeMesh);
    }

    buildStairsDecor(map);
    buildDecos(map);
    placeDecos(map);
  }

  function buildStairsDecor(map) {
    if (!map || !map.stairs || !V.stairsRoot) return;
    const x = map.stairs.x * S;
    const z = map.stairs.y * S;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.72),
      new THREE.MeshBasicMaterial({
        color: 0x2a1c12,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, 0.025, z);
    V.stairsRoot.add(glow);
    if (V.stairsLight) {
      V.stairsLight.position.set(x, 0.55, z);
      V.stairsLight.color.setHex(0xffd090);
      V.stairsLight.visible = false;
    }
    V.stairsRoot.visible = false;
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
