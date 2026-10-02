/* 2.5D diorama renderer — carved cave mesh + orbit camera + paper actors */
(function (global) {
  const MD = global.MD;
  MD.view3d = {
    init: function () { return false; },
    sync: function () {},
    render: function () {},
    resize: function () {},
    pickTile: function () { return null; },
    active: false,
  };
  if (typeof THREE === "undefined") return;

  const S = 1;
  const HOP_MS = 90;
  const FOG = 0xc5e4ef; // anime cave sky, cool mint
  const CAM_FOV = 52;
  const DEG = Math.PI / 180;
  const PITCH_FIXED = 52 * DEG; // locked overhead; orbit yaw only
  const DIST_MIN = 4;
  const DIST_MAX = 16;
  const UV_SCALE = 0.48;
  const YAW_STEP = 15 * DEG;

  const COL = {
    floorRoomVis: new THREE.Color(0xfff6e4),
    floorCorrVis: new THREE.Color(0xe6f0ea),
    floorRoomMem: new THREE.Color(0x9a8868),
    floorCorrMem: new THREE.Color(0x6e7c78),
    wallVis: new THREE.Color(0xf0e4f8),
    wallMem: new THREE.Color(0x6a6278),
    black: new THREE.Color(0x05060a),
  };

  let renderer = null;
  let scene = null;
  let camera = null;
  let active = false;
  let tmpColor = null;
  let raycaster = null;
  let ndc = null;
  let hitPoint = null;
  let floorPlane = null;

  let floorMesh = null;
  let wallMesh = null;
  let floorMeshB = null;
  let wallMeshB = null;
  let edgeMesh = null;
  let floorMeta = [];
  let wallMeta = [];
  let floorMetaB = [];
  let wallMetaB = [];
  let lastMap = null;
  let lastVisSig = "";

  let actorRoot = null;
  let itemRoot = null;
  let stairsRoot = null;
  let decoRoot = null;
  const decoList = [];
  let stairsLight = null;
  let playerLight = null;
  let hemi = null;
  let dirtTex = null;
  let rockTex = null;
  let dirtTexB = null;
  let rockTexB = null;
  let currentTheme = null;
  let pendingTheme = null;

  const actorPool = [];
  const itemPool = [];
  const actorVisual = new Map();
  const itemVisual = new Map();
  let lookCurrent = null;
  let camReady = false;
  let vidSeq = 1;
  let paperMats = Object.create(null);

  const orbit = {
    yaw: 0.68,
    pitch: PITCH_FIXED,
    dist: 9.4,
  };
  let dragging = false;
  let lastPtrX = 0;
  let lastPtrY = 0;
  let gameCanvas = null;

  function hash01(x, y) {
    let n = (x * 374761393 + y * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n >>> 0) % 1000) / 1000;
  }

  function fade(t) {
    return t * t * (3 - 2 * t);
  }

  function noise2(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const a = hash01(ix, iy);
    const b = hash01(ix + 1, iy);
    const c = hash01(ix, iy + 1);
    const d = hash01(ix + 1, iy + 1);
    const ux = fade(fx);
    const uy = fade(fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  function fbm(x, y) {
    return noise2(x, y) * 0.5 + noise2(x * 2.03, y * 1.97) * 0.28 + noise2(x * 4.1, y * 3.9) * 0.14;
  }

  function tint(base, x, y, amt) {
    const n = (hash01(x, y) - 0.5) * amt;
    tmpColor.copy(base);
    tmpColor.r = Math.min(1, Math.max(0, tmpColor.r + n));
    tmpColor.g = Math.min(1, Math.max(0, tmpColor.g + n * 0.8));
    tmpColor.b = Math.min(1, Math.max(0, tmpColor.b + n * 0.6));
    return tmpColor;
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function canWebGL() {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch (e) {
      return false;
    }
  }

  let fxDotTexture = null;
  let fxLayers = [];
  let fxLastT = 0;
  let groundMesh = null;

  function fxDot() {
    if (fxDotTexture) return fxDotTexture;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    fxDotTexture = new THREE.CanvasTexture(c);
    return fxDotTexture;
  }

  function clearFx() {
    for (const L of fxLayers) {
      scene.remove(L.group);
      L.geo.dispose();
      L.mat.dispose();
    }
    fxLayers = [];
  }

  function initFx(theme) {
    clearFx();
    const list = (theme && theme.fx) || [];
    for (const cfg of list) {
      const N = cfg.count;
      const colors = cfg.colors.map(function (c) { return new THREE.Color(c); });
      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      const seeds = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * cfg.spread;
        pos[i * 3 + 1] = Math.random() * cfg.height;
        pos[i * 3 + 2] = (Math.random() - 0.5) * cfg.spread;
        const c = colors[i % colors.length];
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        seeds[i] = Math.random() * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size: cfg.size,
        map: fxDot(),
        vertexColors: true,
        transparent: true,
        opacity: cfg.opacity,
        depthWrite: false,
        sizeAttenuation: true,
        fog: true,
        blending: cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      const group = new THREE.Group();
      group.add(points);
      group.visible = false;
      scene.add(group);
      fxLayers.push({ group: group, geo: geo, mat: mat, cfg: cfg, seeds: seeds });
    }
  }

  function updateFx(now, cx, cz) {
    const dt = Math.min(0.05, (now - fxLastT) / 1000 || 0.016);
    fxLastT = now;
    const t = now / 1000;
    for (const L of fxLayers) {
      L.group.position.set(cx, 0, cz);
      L.group.visible = true;
      const pos = L.geo.attributes.position.array;
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        let y = pos[i * 3 + 1] - L.cfg.fall * dt;
        if (L.cfg.fall > 0 && y < 0.06) y = L.cfg.height;
        if (L.cfg.fall < 0 && y > L.cfg.height) y = 0.06;
        pos[i * 3 + 1] = y;
        pos[i * 3] += Math.sin(t * 0.8 + L.seeds[i]) * L.cfg.sway * dt;
      }
      L.geo.attributes.position.needsUpdate = true;
    }
  }

  function hideFx() {
    for (const L of fxLayers) L.group.visible = false;
  }

  function setTheme(theme) {
    if (!theme) return;
    if (!active || !scene) { pendingTheme = theme; return; }
    if (currentTheme === theme) return;
    currentTheme = theme;
    if (scene.fog) {
      scene.fog.color.set(theme.fog);
      if (theme.fogDensity && scene.fog.density != null) scene.fog.density = theme.fogDensity;
    }
    if (scene.background && scene.background.set) scene.background.set(theme.fog);
    if (renderer) renderer.setClearColor(theme.fog, 1);
    if (groundMesh) {
      groundMesh.material.color.set(theme.fog).multiplyScalar(0.25);
    }
    if (hemi) {
      hemi.color.set(theme.hemiSky);
      hemi.groundColor.set(theme.hemiGround);
    }
    if (playerLight && theme.lightColor) {
      playerLight.color.set(theme.lightColor);
    }
    initFx(theme);
    // vertex tint palette (updateVisibility refreshes colours when sig changes)
    if (theme.tints) {
      COL.floorRoomVis.set(theme.tints.floorRoomVis);
      COL.floorCorrVis.set(theme.tints.floorCorrVis);
      COL.floorRoomMem.set(theme.tints.floorRoomMem);
      COL.floorCorrMem.set(theme.tints.floorCorrMem);
      COL.wallVis.set(theme.tints.wallVis);
      COL.wallMem.set(theme.tints.wallMem);
    }
    lastVisSig = "";
    tryLoadRuntimeCaveTex(theme.floorTex, function (tex) {
      dirtTex = tex;
      if (floorMesh && floorMesh.material) {
        floorMesh.material.map = tex;
        floorMesh.material.needsUpdate = true;
      }
    }, function () {
      dirtTex = makeSeamlessTex(256, 3, theme.palFloor);
      if (floorMesh && floorMesh.material) {
        floorMesh.material.map = dirtTex;
        floorMesh.material.needsUpdate = true;
      }
    });
    tryLoadRuntimeCaveTex(theme.wallTex, function (tex) {
      rockTex = tex;
      if (wallMesh && wallMesh.material) {
        wallMesh.material.map = tex;
        wallMesh.material.needsUpdate = true;
      }
    }, function () {
      rockTex = makeSeamlessTex(256, 19, theme.palWall);
      if (wallMesh && wallMesh.material) {
        wallMesh.material.map = rockTex;
        wallMesh.material.needsUpdate = true;
      }
    });
    if (theme.floorTexB && theme.wallTexB) {
      tryLoadRuntimeCaveTex(theme.floorTexB, function (tex) {
        dirtTexB = tex;
        if (floorMeshB && floorMeshB.material) {
          floorMeshB.material.map = tex;
          floorMeshB.material.needsUpdate = true;
        }
      }, function () {
        dirtTexB = makeSeamlessTex(256, 77, theme.palFloor);
        if (floorMeshB && floorMeshB.material) {
          floorMeshB.material.map = dirtTexB;
          floorMeshB.material.needsUpdate = true;
        }
      });
      tryLoadRuntimeCaveTex(theme.wallTexB, function (tex) {
        rockTexB = tex;
        if (wallMeshB && wallMeshB.material) {
          wallMeshB.material.map = tex;
          wallMeshB.material.needsUpdate = true;
        }
      }, function () {
        rockTexB = makeSeamlessTex(256, 91, theme.palWall);
        if (wallMeshB && wallMeshB.material) {
          wallMeshB.material.map = rockTexB;
          wallMeshB.material.needsUpdate = true;
        }
      });
    }
  }

  function tryLoadRuntimeCaveTex(name, onReady, onError) {
    // Prefer sprites.texture (handles PNG + painter fallback); clone settings for tiling
    if (MD.sprites && typeof MD.sprites.texture === "function") {
      const base = MD.sprites.texture(name);
      if (base) {
        base.wrapS = THREE.RepeatWrapping;
        base.wrapT = THREE.RepeatWrapping;
        base.generateMipmaps = true;
        base.minFilter = THREE.LinearMipmapLinearFilter;
        base.magFilter = THREE.LinearFilter;
        base.needsUpdate = true;
        if (onReady) onReady(base);
        if (MD.sprites.ready) {
          MD.sprites.ready.then(function () {
            if (onReady) onReady(base);
          });
        }
        return;
      }
    }
    const path = "assets/runtime/" + name + ".png";
    const loader = new THREE.TextureLoader();
    loader.load(
      path,
      function (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        if (onReady) onReady(tex);
      },
      undefined,
      function () { if (onError) onError(); }
    );
  }

  function makeSeamlessTex(size, seed, palette) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const p = size;
    function wrapNoise(x, y, sc) {
      const u = x / p;
      const v = y / p;
      const n1 = noise2(seed + u * sc, seed * 1.7 + v * sc);
      const n2 = noise2(seed + 40 + (u + 1) * sc, seed * 1.7 + v * sc);
      const n3 = noise2(seed + u * sc, seed * 1.7 + 40 + (v + 1) * sc);
      const n4 = noise2(seed + 40 + (u + 1) * sc, seed * 1.7 + 40 + (v + 1) * sc);
      const wu = 0.5 - 0.5 * Math.cos(u * Math.PI * 2);
      const wv = 0.5 - 0.5 * Math.cos(v * Math.PI * 2);
      const a = n1 + (n2 - n1) * wu;
      const b = n3 + (n4 - n3) * wu;
      return a + (b - a) * wv;
    }
    for (let y = 0; y < p; y++) {
      for (let x = 0; x < p; x++) {
        const n = wrapNoise(x, y, 6) * 0.55 + wrapNoise(x, y, 14) * 0.28 + wrapNoise(x, y, 32) * 0.17;
        const k = n - 0.5;
        const i = (y * p + x) * 4;
        d[i] = clamp(palette[0] + k * 48 + (hash01(x + seed, y) - 0.5) * 10, 0, 255) | 0;
        d[i + 1] = clamp(palette[1] + k * 42 + (hash01(x, y + seed) - 0.5) * 10, 0, 255) | 0;
        d[i + 2] = clamp(palette[2] + k * 36 + (hash01(x + y, seed) - 0.5) * 8, 0, 255) | 0;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  function paperMat(name) {
    if (paperMats[name]) return paperMats[name];
    const tex = MD.sprites && MD.sprites.texture(name);
    paperMats[name] = new THREE.MeshBasicMaterial({
      map: tex || null,
      color: tex ? 0xffffff : 0xff00ff,
      transparent: true,
      alphaTest: 0.52,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
    });
    return paperMats[name];
  }

  function makePaperMesh(name, kind) {
    const sz = (MD.sprites && MD.sprites.worldSize(name)) || { w: 0.7580, h: 0.9000 };
    const geo = new THREE.PlaneGeometry(sz.w, sz.h);
    geo.translate(0, sz.h / 2, 0);
    const mesh = new THREE.Mesh(geo, paperMat(name));
    mesh.userData.name = name;
    mesh.userData.kind = kind;
    mesh.userData.h = sz.h;
    return mesh;
  }

  const PLAYER_COLS = 8;
  const PLAYER_ROWS = 4;
  const PLAYER_FPS = 10;

  function atlasSpec(name) {
    if (MD.sprites && MD.sprites.atlas && MD.sprites.atlas[name]) return MD.sprites.atlas[name];
    if (name === "player") return { cellW: 256, cellH: 304, cols: 8, rows: 4 };
    return { cellW: 128, cellH: 128, cols: 8, rows: 1 };
  }

  function makeAtlasPaperMesh(name) {
    const sz = (MD.sprites && MD.sprites.worldSize(name)) || { w: 0.7580, h: 0.9000 };
    const spec = atlasSpec(name);
    const geo = new THREE.PlaneGeometry(sz.w, sz.h);
    geo.translate(0, sz.h / 2, 0);
    // Billboard does rotateY(π), which mirrors U. Flip UVs so left/right match the atlas.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    uv.needsUpdate = true;
    const canvas = document.createElement("canvas");
    canvas.width = spec.cellW;
    canvas.height = spec.cellH;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    const ctex = new THREE.CanvasTexture(canvas);
    ctex.colorSpace = THREE.SRGBColorSpace;
    ctex.generateMipmaps = false;
    ctex.minFilter = THREE.LinearFilter;
    ctex.magFilter = THREE.LinearFilter;
    ctex.wrapS = THREE.ClampToEdgeWrapping;
    ctex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshBasicMaterial({
      map: ctex,
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.4,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.name = name;
    mesh.userData.kind = "actor";
    mesh.userData.h = sz.h;
    mesh.userData.playerAtlas = true;
    mesh.userData.atlas = true;
    mesh.userData.atlasCanvas = canvas;
    mesh.userData.atlasCtx = ctx;
    mesh.userData.atlasTex = ctex;
    mesh.userData.atlasKey = "";
    mesh.userData.atlasCols = spec.cols;
    mesh.userData.atlasRows = spec.rows;
    return mesh;
  }

  function cameraRelativeCol(actor) {
    const fdx = actor && actor.facingDx != null ? actor.facingDx : 0;
    const fdy = actor && actor.facingDy != null ? actor.facingDy : 1;
    const worldAngle = Math.atan2(fdx, fdy); // 0 = S / +Z
    let rel = worldAngle - orbit.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    let col = Math.round(rel / (Math.PI / 4));
    return ((col % PLAYER_COLS) + PLAYER_COLS) % PLAYER_COLS;
  }

  function resolvePlayerAnim(actor, state, vis, now) {
    const a = (actor && actor.anim) || "idle";
    const spec = MD.sprites && MD.sprites.playerAnim;
    const fps = (spec && spec.fps) || PLAYER_FPS;
    const frames = (spec && spec.frames) || PLAYER_ROWS;
    const oneShotMs = frames * (1000 / fps);
    const elapsed = now - (actor && actor.animT0 || 0);
    if (a === "fail") return "fail";
    if (a === "climb" && elapsed < oneShotMs) return "climb";
    if (a === "attack" && elapsed < oneShotMs) return "attack";
    if (a === "defend" && elapsed < oneShotMs) return "defend";
    if (state && state.dashActive) return "run";
    const hopping = vis && (now - vis.t0) < HOP_MS;
    if (hopping) return (a === "run" || (state && state.dashActive)) ? "run" : "walk";
    return "idle";
  }

  function playerFrameIndex(anim, actor, now) {
    const spec = MD.sprites && MD.sprites.playerAnim;
    const fps = (spec && spec.fps) || PLAYER_FPS;
    const frames = (spec && spec.frames) || PLAYER_ROWS;
    const frameDur = 1000 / fps;
    const oneShot = anim === "attack" || anim === "climb" || anim === "fail" || anim === "defend";
    if (oneShot) {
      const elapsed = Math.max(0, now - (actor && actor.animT0 || 0));
      return Math.min(frames - 1, Math.floor(elapsed / frameDur));
    }
    if (anim === "idle") return Math.floor(now / 180) % frames;
    return Math.floor(now / frameDur) % frames;
  }

  function updatePlayerSprite(paper, actor, state, vis, now) {
    if (!paper || !paper.userData.atlasCtx) return;
    const anim = resolvePlayerAnim(actor, state, vis, now);
    const img = MD.sprites && MD.sprites.playerImage && MD.sprites.playerImage(anim);
    if (!img || !img.naturalWidth) return;
    const col = cameraRelativeCol(actor);
    const row = playerFrameIndex(anim, actor, now);
    const key = anim + ":" + col + ":" + row;
    if (paper.userData.atlasKey === key) return;
    paper.userData.atlasKey = key;
    const cw = img.naturalWidth / PLAYER_COLS;
    const ch = img.naturalHeight / PLAYER_ROWS;
    const ctx = paper.userData.atlasCtx;
    const canvas = paper.userData.atlasCanvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, col * cw, row * ch, cw, ch, 0, 0, canvas.width, canvas.height);
    paper.userData.atlasTex.needsUpdate = true;
  }

  function updateMonsterSprite(paper, actor, name) {
    if (!paper || !paper.userData.atlasCtx) return;
    const img = MD.sprites && MD.sprites.monsterImage && MD.sprites.monsterImage(name);
    if (!img || !img.naturalWidth) return;
    const col = cameraRelativeCol(actor);
    const key = name + ":" + col;
    if (paper.userData.atlasKey === key) return;
    paper.userData.atlasKey = key;
    const cols = paper.userData.atlasCols || 8;
    const rows = paper.userData.atlasRows || 1;
    const cw = img.naturalWidth / cols;
    const ch = img.naturalHeight / rows;
    const ctx = paper.userData.atlasCtx;
    const canvas = paper.userData.atlasCanvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, col * cw, 0, cw, ch, 0, 0, canvas.width, canvas.height);
    paper.userData.atlasTex.needsUpdate = true;
  }

  function paperSortOrder(group, layer) {
    if (!camera || !group) return layer || 0;
    const dx = camera.position.x - group.position.x;
    const dy = camera.position.y - group.position.y;
    const dz = camera.position.z - group.position.z;
    const dist = Math.hypot(dx, dy, dz);
    return (40 - dist) * 50 + (layer || 0);
  }

  function makeBlobShadow(r) {
    const geo = new THREE.CircleGeometry(r, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.04;
    m.renderOrder = 1;
    return m;
  }

  function allocActor() {
    for (let i = 0; i < actorPool.length; i++) {
      if (!actorPool[i].userData.inUse) return actorPool[i];
    }
    const g = new THREE.Group();
    g.userData.inUse = false;
    g.userData.paper = null;
    g.userData.shadow = makeBlobShadow(0.22);
    g.add(g.userData.shadow);
    const badge = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xa78bfa })
    );
    badge.position.y = 1.35;
    badge.visible = false;
    g.userData.badge = badge;
    g.add(badge);
    actorRoot.add(g);
    actorPool.push(g);
    return g;
  }

  function allocItem() {
    for (let i = 0; i < itemPool.length; i++) {
      if (!itemPool[i].userData.inUse) return itemPool[i];
    }
    const g = new THREE.Group();
    g.userData.inUse = false;
    g.userData.paper = null;
    g.userData.shadow = makeBlobShadow(0.12);
    g.userData.shadow.material = g.userData.shadow.material.clone();
    g.userData.shadow.material.opacity = 0.22;
    g.add(g.userData.shadow);
    itemRoot.add(g);
    itemPool.push(g);
    return g;
  }

  function setPaper(group, name, kind) {
    if (group.userData.paper && group.userData.name === name) return;
    if (group.userData.paper) {
      group.remove(group.userData.paper);
      if (group.userData.paper.geometry) group.userData.paper.geometry.dispose();
      if (group.userData.paper.userData && group.userData.paper.userData.playerAtlas && group.userData.paper.material) {
        group.userData.paper.material.dispose();
      }
      group.userData.paper = null;
    }
    const paper = (MD.sprites && MD.sprites.atlas && Object.prototype.hasOwnProperty.call(MD.sprites.atlas, name))
      ? makeAtlasPaperMesh(name)
      : makePaperMesh(name, kind);
    paper.renderOrder = 3;
    group.add(paper);
    group.userData.paper = paper;
    group.userData.name = name;
    if (group.userData.badge) {
      group.userData.badge.position.y = (paper.userData.h || 1) + 0.18;
    }
    const r = kind === "item" ? 0.12 : name === "player" ? 0.24 : 0.2;
    group.userData.shadow.scale.setScalar(r / 0.22);
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      mesh.material.dispose();
    }
  }

  function clearMap() {
    disposeMesh(floorMesh);
    disposeMesh(wallMesh);
    disposeMesh(floorMeshB);
    disposeMesh(wallMeshB);
    disposeMesh(edgeMesh);
    floorMesh = wallMesh = null;
    floorMeshB = wallMeshB = edgeMesh = null;
    floorMeta = [];
    wallMeta = [];
    floorMetaB = [];
    wallMetaB = [];
    if (stairsRoot) {
      while (stairsRoot.children.length) {
        const ch = stairsRoot.children[0];
        stairsRoot.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      }
    }
    clearDecos();
    lastVisSig = "";
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

  function caveMat(tex, th) {
    const p = (th && th.phong) || {};
    return new THREE.MeshPhongMaterial({
      map: tex || null,
      color: 0xffffff,
      vertexColors: true,
      fog: true,
      specular: p.specular != null ? p.specular : 0x111111,
      shininess: p.shininess != null ? p.shininess : 2,
    });
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
    const th = currentTheme || {};
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
      floorMesh = fb.toMesh(caveMat(dirtTex, th));
      scene.add(floorMesh);
      floorMeta = fb.meta;
    }
    if (fbB && fbB.idx.length) {
      floorMeshB = fbB.toMesh(caveMat(dirtTexB, th));
      scene.add(floorMeshB);
      floorMetaB = fbB.meta;
    }
    if (wb.idx.length) {
      wallMesh = wb.toMesh(caveMat(rockTex, th));
      scene.add(wallMesh);
      wallMeta = wb.meta;
    }
    if (wbB && wbB.idx.length) {
      wallMeshB = wbB.toMesh(caveMat(rockTexB, th));
      scene.add(wallMeshB);
      wallMetaB = wbB.meta;
    }
    if (eb && eb.idx.length) {
      edgeMesh = eb.toMesh(new THREE.MeshBasicMaterial({
        vertexColors: true,
        fog: true,
        transparent: true,
        opacity: 0.95,
      }));
      scene.add(edgeMesh);
    }

    buildStairsDecor(map);
    buildDecos(map);
  }

  function buildStairsDecor(map) {
    if (!map || !map.stairs || !stairsRoot) return;
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
    stairsRoot.add(glow);
    if (stairsLight) {
      stairsLight.position.set(x, 0.55, z);
      stairsLight.color.setHex(0xffd090);
      stairsLight.visible = false;
    }
    stairsRoot.visible = false;
  }

  function clearDecos() {
    decoList.length = 0;
    if (!decoRoot) return;
    while (decoRoot.children.length) {
      const ch = decoRoot.children[0];
      decoRoot.remove(ch);
      if (ch.userData && ch.userData.paper && ch.userData.paper.geometry) {
        ch.userData.paper.geometry.dispose();
      }
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
    decoRoot.add(g);
    decoList.push(g);
  }

  function buildDecos(map) {
    clearDecos();
    if (!map || !decoRoot) return;
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
        const pool = (currentTheme && currentTheme.deco) || ["crystal", "mushroom", "lantern", "vine", "flower"];
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

  function updateDecos(state) {
    if (!decoList.length) return;
    for (let i = 0; i < decoList.length; i++) {
      const g = decoList[i];
      const v = visOf(state, g.userData.tx, g.userData.ty);
      g.visible = v.seen;
      if (g.visible && g.userData.paper) {
        const map = state.map;
        const clear = wallClearance(map, g.userData.tx, g.userData.ty);
        const sz = (MD.sprites && MD.sprites.worldSize(g.userData.name)) || { w: 0.4 };
        const extra = Math.max(0, (sz.w || 0.4) * 0.25);
        g.position.x = g.userData.tx * S + (g.userData.ox || 0) + clear.x * 0.7;
        g.position.z = g.userData.ty * S + (g.userData.oz || 0) + clear.z * 0.7;
        billboard(g.userData.paper, 0.02);
      }
    }
  }

  function visOf(state, x, y) {
    const k = MD.key(x, y);
    const debug = state.debug;
    const seen = debug || (state.explored && state.explored.has(k));
    const vis = debug || (state.visible && state.visible.has(k));
    return { seen: !!seen, vis: !!vis };
  }

  function shadeMeta(state, meta) {
    if (!meta || !meta.cells || !meta.cells.length) return COL.black;
    let vis = false, seen = false, room = false;
    for (let i = 0; i < meta.cells.length; i++) {
      const c = meta.cells[i];
      const v = visOf(state, c.x, c.y);
      if (v.vis) vis = true;
      if (v.seen) seen = true;
      if (c.room) room = true;
    }
    if (!seen) return COL.black;
    if (meta.kind === "floor") {
      const c0 = meta.cells[0];
      if (vis) return room ? tint(COL.floorRoomVis, c0.x, c0.y, 0.08) : tint(COL.floorCorrVis, c0.x, c0.y, 0.07);
      return room ? tint(COL.floorRoomMem, c0.x, c0.y, 0.04) : tint(COL.floorCorrMem, c0.x, c0.y, 0.04);
    }
    const c0 = meta.cells[0];
    return vis ? tint(COL.wallVis, c0.x, c0.y, 0.07) : tint(COL.wallMem, c0.x, c0.y, 0.04);
  }

  function paintMeshColors(mesh, meta, state) {
    if (!mesh) return;
    const attr = mesh.geometry.getAttribute("color");
    const arr = attr.array;
    for (let i = 0; i < meta.length; i++) {
      const c = shadeMeta(state, meta[i]);
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    attr.needsUpdate = true;
  }

  function updateVisibility(state) {
    const map = state.map;
    if (!map) return;
    const sig = (state.debug ? "d" : "") + (state.player ? state.player.x + "," + state.player.y : "") + ":" + (state.explored ? state.explored.size : 0) + ":" + (state.visible ? state.visible.size : 0);
    if (sig === lastVisSig) return;
    lastVisSig = sig;
    paintMeshColors(floorMesh, floorMeta, state);
    paintMeshColors(wallMesh, wallMeta, state);
    paintMeshColors(floorMeshB, floorMetaB, state);
    paintMeshColors(wallMeshB, wallMetaB, state);
    if (map.stairs) {
      const v = visOf(state, map.stairs.x, map.stairs.y);
      stairsRoot.visible = v.seen;
      if (stairsLight) {
        stairsLight.visible = v.vis && v.seen;
        stairsLight.intensity = v.vis ? 1.35 : 0;
      }
    }
    updateDecos(state);
  }

  function actorId(a) {
    if (!a._vid) a._vid = "a" + (vidSeq++);
    return a._vid;
  }

  function spriteNameForActor(a) {
    if (a.kind === "player") return "player";
    return a.type;
  }

  function spriteNameForItem(it) {
    return it.type;
  }

  function hideUnused(map, live) {
    map.forEach(function (vis, id) {
      if (!live.has(id)) {
        vis.group.userData.inUse = false;
        vis.group.visible = false;
        map.delete(id);
      }
    });
  }

  function billboard(paper, baseY) {
    if (!paper || !camera || !paper.parent) return;
    // Face the screen (parallel to view).
    paper.quaternion.copy(camera.quaternion);
    paper.rotateY(Math.PI);
    // Pull toward camera so the leaning plane does not sink into walls/floor behind.
    const g = paper.parent;
    const dx = camera.position.x - g.position.x;
    const dy = camera.position.y - g.position.y;
    const dz = camera.position.z - g.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    if (paper.userData.kind === "deco") {
      paper.quaternion.identity();
      paper.rotation.set(0, Math.atan2(dx, dz), 0);
      paper.position.set(0, baseY != null ? baseY : 0.02, 0);
    } else {
      const pull = paper.userData.kind === "item" ? 0.28 : 0.48;
      const y0 = baseY != null ? baseY : 0.03;
      paper.position.set((dx / len) * pull, y0 + (dy / len) * pull * 0.2, (dz / len) * pull);
    }
    const layer = paper.userData.kind === "actor" ? 2 : paper.userData.kind === "item" ? 1 : 0;
    paper.renderOrder = paperSortOrder(g, layer);
  }

  /** Nudge standing sprites away from adjacent wall cells to reduce side clipping. */
  function wallClearance(map, tileX, tileY) {
    let ox = 0, oz = 0;
    if (!map) return { x: 0, z: 0 };
    const push = 0.18;
    if (isWall(map, tileX + 1, tileY)) ox -= push;
    if (isWall(map, tileX - 1, tileY)) ox += push;
    if (isWall(map, tileX, tileY + 1)) oz -= push;
    if (isWall(map, tileX, tileY - 1)) oz += push;
    // Corners: slightly stronger diagonal push
    if (isWall(map, tileX + 1, tileY + 1)) { ox -= push * 0.35; oz -= push * 0.35; }
    if (isWall(map, tileX - 1, tileY + 1)) { ox += push * 0.35; oz -= push * 0.35; }
    if (isWall(map, tileX + 1, tileY - 1)) { ox -= push * 0.35; oz += push * 0.35; }
    if (isWall(map, tileX - 1, tileY - 1)) { ox += push * 0.35; oz += push * 0.35; }
    return { x: ox, z: oz };
  }

  function hopY(vis, now) {
    const t = Math.min(1, (now - vis.t0) / HOP_MS);
    if (t >= 1) {
      vis.x = vis.toX;
      vis.z = vis.toZ;
      return 0;
    }
    const e = 1 - (1 - t) * (1 - t);
    vis.x = vis.fromX + (vis.toX - vis.fromX) * e;
    vis.z = vis.fromZ + (vis.toZ - vis.fromZ) * e;
    return Math.sin(t * Math.PI) * 0.16;
  }

  function ensureVisual(store, id, alloc, name, kind, tx, tz, now, snap) {
    let vis = store.get(id);
    if (!vis) {
      const g = alloc();
      g.userData.inUse = true;
      g.visible = true;
      setPaper(g, name, kind);
      vis = {
        group: g,
        x: tx, z: tz,
        fromX: tx, fromZ: tz,
        toX: tx, toZ: tz,
        t0: now - HOP_MS,
      };
      store.set(id, vis);
      g.position.set(tx, 0, tz);
    } else {
      vis.group.userData.inUse = true;
      vis.group.visible = true;
      setPaper(vis.group, name, kind);
      if (snap) {
        vis.x = vis.toX = vis.fromX = tx;
        vis.z = vis.toZ = vis.fromZ = tz;
        vis.t0 = now - HOP_MS;
      } else if (tx !== vis.toX || tz !== vis.toZ) {
        vis.fromX = vis.x;
        vis.fromZ = vis.z;
        vis.toX = tx;
        vis.toZ = tz;
        vis.t0 = now;
      }
    }
    return vis;
  }

  function updateActors(state, now) {
    const live = new Set();
    const debug = state.debug;
    const visible = state.visible || new Set();

    function show(actor, name) {
      const k = MD.key(actor.x, actor.y);
      const inVis = debug || visible.has(k) || actor.kind === "player";
      if (!inVis) return;
      const id = actorId(actor);
      live.add(id);
      const vis = ensureVisual(actorVisual, id, allocActor, name, "actor", actor.x * S, actor.y * S, now, false);
      const hop = hopY(vis, now);
      const bob = name === "bat" ? Math.sin(now * 0.008 + actor.x) * 0.06 + 0.12 : Math.sin(now * 0.003 + actor.x) * 0.015;
      const clear = wallClearance(state.map, actor.x, actor.y);
      vis.group.position.set(vis.x + clear.x, 0, vis.z + clear.z);
      billboard(vis.group.userData.paper, 0.03 + hop + bob);
      if (name === "player") {
        updatePlayerSprite(vis.group.userData.paper, actor, state, vis, now);
      } else if (vis.group.userData.paper.userData.atlas) {
        updateMonsterSprite(vis.group.userData.paper, actor, name);
      }
      const badge = vis.group.userData.badge;
      if (badge) {
        const st = actor.statuses && actor.statuses[0];
        if (st) {
          badge.visible = true;
          badge.material.color.set(
            st.type === "sleep" ? 0xa78bfa : st.type === "confuse" ? 0xf5c16c : 0xff7b72
          );
          badge.position.y = (vis.group.userData.paper && vis.group.userData.paper.userData.h || 1) + 0.2 + hop + bob;
        } else badge.visible = false;
      }
    }

    if (state.player) show(state.player, "player");
    if (state.enemies) {
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (!e.alive) continue;
        show(e, spriteNameForActor(e));
      }
    }
    hideUnused(actorVisual, live);
  }

  function updateItems(state, now) {
    const live = new Set();
    const debug = state.debug;
    const visible = state.visible || new Set();
    if (state.items) {
      for (let i = 0; i < state.items.length; i++) {
        const it = state.items[i];
        const k = MD.key(it.x, it.y);
        if (!debug && !visible.has(k)) continue;
        const id = it.uid || (it.uid = "i" + (vidSeq++));
        live.add(id);
        const name = spriteNameForItem(it);
        const vis = ensureVisual(itemVisual, id, allocItem, name, "item", it.x * S, it.y * S, now, true);
        const clear = wallClearance(state.map, it.x, it.y);
        vis.group.position.set(it.x * S + clear.x * 0.5, 0, it.y * S + clear.z * 0.5);
        if (vis.group.userData.paper) {
          billboard(vis.group.userData.paper, 0.04);
        }
      }
    }
    hideUnused(itemVisual, live);
  }

  function hideAllSprites() {
    actorPool.forEach(function (g) { g.userData.inUse = false; g.visible = false; });
    itemPool.forEach(function (g) { g.userData.inUse = false; g.visible = false; });
    actorVisual.clear();
    itemVisual.clear();
    if (stairsRoot) stairsRoot.visible = false;
    if (stairsLight) stairsLight.visible = false;
  }

  function applyOrbit() {
    orbit.pitch = PITCH_FIXED;
    const cp = Math.cos(orbit.pitch);
    const sp = Math.sin(orbit.pitch);
    const sy = Math.sin(orbit.yaw);
    const cy = Math.cos(orbit.yaw);
    camera.position.set(
      lookCurrent.x + orbit.dist * sy * cp,
      lookCurrent.y + orbit.dist * sp,
      lookCurrent.z + orbit.dist * cy * cp
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(lookCurrent.x, 0.38, lookCurrent.z);
  }

  function overlayOpen() {
    const nodes = document.querySelectorAll(".overlay");
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].classList.contains("hidden")) return true;
    }
    return false;
  }

  function updateCamera(state, now) {
    const p = state.player;
    if (!p) return;
    let vis = actorVisual.get(p._vid);
    const tx = vis ? vis.x : p.x * S;
    const tz = vis ? vis.z : p.y * S;
    if (!camReady) {
      lookCurrent.set(tx, 0, tz);
      camReady = true;
    } else {
      lookCurrent.x += (tx - lookCurrent.x) * 0.14;
      lookCurrent.z += (tz - lookCurrent.z) * 0.14;
    }
    applyOrbit();
    if (playerLight) {
      playerLight.position.set(tx, 1.4, tz);
      const rid = state.map ? MD.getRoomId(state.map, p.x, p.y) : -1;
      const inRoom = rid != null && rid >= 0;
      playerLight.color.set(inRoom ? 0xffe8b8 : 0xc8e0f0);
      playerLight.intensity = inRoom ? 0.45 : 0.35;
      playerLight.distance = inRoom ? 7 : 4.2;
    }
    if (hemi) {
      hemi.color.set(0xfff0d8);
      hemi.groundColor.set(0xa8c8b8);
    }
  }

  function attachOrbit(el) {
    if (!el) return;
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 2 && e.button !== 0) return;
      dragging = true;
      lastPtrX = e.clientX;
      lastPtrY = e.clientY;
      el.style.cursor = "grabbing";
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      if (gameCanvas && gameCanvas.focus) gameCanvas.focus();
      e.preventDefault();
    });
    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      const dx = e.clientX - lastPtrX;
      const dy = e.clientY - lastPtrY;
      lastPtrX = e.clientX;
      lastPtrY = e.clientY;
      orbit.yaw -= dx * 0.008;
      orbit.pitch = PITCH_FIXED; // pitch locked — drag only orbits horizontally
    });
    function endDrag(e) {
      dragging = false;
      el.style.cursor = "grab";
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      orbit.dist = clamp(orbit.dist * (1 + dir * 0.12), DIST_MIN, DIST_MAX);
    }, { passive: false });
  }

  function onOrbitKey(e) {
    if (e.key !== "q" && e.key !== "Q" && e.key !== "e" && e.key !== "E") return;
    if (overlayOpen()) return;
    if (e.key === "e" || e.key === "E") {
      /* inventory uses E to eat when open — overlayOpen already covers that */
    }
    e.preventDefault();
    orbit.yaw += (e.key === "q" || e.key === "Q") ? YAW_STEP : -YAW_STEP;
  }

  function init(canvas) {
    if (typeof THREE === "undefined") return false;
    if (!canWebGL()) return false;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (e) {
      return false;
    }
    if (!renderer.getContext()) return false;

    gameCanvas = canvas;
    renderer.setClearColor(FOG, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = true;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(FOG);
    scene.fog = new THREE.FogExp2(FOG, 0.018);

    const aspect = (canvas.clientWidth || 960) / (canvas.clientHeight || 640);
    camera = new THREE.PerspectiveCamera(CAM_FOV, aspect, 0.12, 90);
    camera.position.set(6, 7, 7);
    camera.lookAt(0, 0, 0);

    tmpColor = new THREE.Color();
    lookCurrent = new THREE.Vector3();
    raycaster = new THREE.Raycaster();
    ndc = new THREE.Vector2();
    hitPoint = new THREE.Vector3();
    floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    dirtTex = makeSeamlessTex(256, 3, [232, 210, 160]);
    rockTex = makeSeamlessTex(256, 19, [180, 192, 208]);
    // Prefer runtime cave textures (anime floor/wall)
    tryLoadRuntimeCaveTex("floor", function (tex) {
      dirtTex = tex;
      if (floorMesh && floorMesh.material) {
        floorMesh.material.map = tex;
        floorMesh.material.needsUpdate = true;
      }
    });
    tryLoadRuntimeCaveTex("wall", function (tex) {
      rockTex = tex;
      if (wallMesh && wallMesh.material) {
        wallMesh.material.map = tex;
        wallMesh.material.needsUpdate = true;
      }
    });

    hemi = new THREE.HemisphereLight(0xfff0d8, 0xa8c8b8, 0.78);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff4e0, 0.7);
    dir.position.set(10, 16, 12);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xb8d8e8, 0.28);
    fill.position.set(-8, 6, -4);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xf0e8d8, 0.38));

    playerLight = new THREE.PointLight(0xffd090, 0.5, 6);
    scene.add(playerLight);
    stairsLight = new THREE.PointLight(0xffaa44, 1.35, 5);
    stairsLight.visible = false;
    scene.add(stairsLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshBasicMaterial({ color: 0x08060a, fog: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    scene.add(ground);
    groundMesh = ground;

    actorRoot = new THREE.Group();
    itemRoot = new THREE.Group();
    stairsRoot = new THREE.Group();
    decoRoot = new THREE.Group();
    scene.add(actorRoot);
    scene.add(itemRoot);
    scene.add(stairsRoot);
    scene.add(decoRoot);

    new Set([...Object.keys(MD.config.enemies), ...Object.keys(MD.config.items),
      "crystal", "mushroom", "lantern", "vine", "flower", "stairs"]).forEach(paperMat);

    canvas.style.cursor = "grab";
    attachOrbit(canvas);
    const overlay = document.getElementById("overlay");
    if (overlay) {
      overlay.style.pointerEvents = "none";
      attachOrbit(overlay);
    }
    window.addEventListener("keydown", onOrbitKey);

    active = true;
    MD.view3d.active = true;
    if (pendingTheme) {
      const t = pendingTheme;
      pendingTheme = null;
      setTheme(t);
    }
    return true;
  }

  function resize(cssW, cssH) {
    if (!renderer || !camera) return;
    const w = Math.max(1, cssW | 0);
    const h = Math.max(1, cssH | 0);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function sync(state) {
    if (!active) return;
    const now = performance.now();
    if (state.mode !== "dungeon" || !state.map) {
      if (lastMap) {
        clearMap();
        lastMap = null;
        camReady = false;
      }
      hideAllSprites();
      lookCurrent.set(0, 0, 0);
      applyOrbit();
      if (playerLight) playerLight.intensity = 0;
      hideFx();
      return;
    }
    if (state.map !== lastMap) {
      try {
        rebuildMap(state.map);
        lastMap = state.map;
        lastVisSig = "";
        camReady = false;
        hideAllSprites();
      } catch (err) {
        console.error("rebuildMap failed", err);
        clearMap();
        lastMap = state.map;
      }
    }
    updateVisibility(state);
    updateActors(state, now);
    updateItems(state, now);
    updateDecos(state);
    updateCamera(state, now);
    if (state.player) updateFx(now, state.player.x * S, state.player.y * S);
    else hideFx();
  }

  function render() {
    if (!active || !renderer) return;
    renderer.render(scene, camera);
  }

  function pickTile(clientX, clientY, state) {
    if (!active || !camera || !renderer) return null;
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(floorPlane, hitPoint);
    if (!hit) return null;
    const x = Math.round(hitPoint.x / S);
    const y = Math.round(hitPoint.z / S);
    if (!state.map) return { x, y };
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return null;
    return { x, y };
  }

  /** Screen / key direction → grid step (camera-relative).
   *  ix,iy use the same convention as keys: up=[0,-1], right=[1,0]. */
  function screenToTileDir(ix, iy) {
    if (!ix && !iy) return [0, 0];
    const yaw = orbit.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    // key up (iy=-1) → screen-forward
    let wx = (-iy) * fx + ix * rx;
    let wz = (-iy) * fz + ix * rz;
    const ax = Math.abs(wx), az = Math.abs(wz);
    let dx = 0, dy = 0;
    if (ax < 1e-6 && az < 1e-6) return [0, 0];
    if (ax >= az * 0.414) dx = wx > 0 ? 1 : -1; // ~tan(22.5°)
    if (az >= ax * 0.414) dy = wz > 0 ? 1 : -1;
    if (!dx && !dy) {
      if (ax >= az) dx = wx > 0 ? 1 : -1;
      else dy = wz > 0 ? 1 : -1;
    }
    return [dx, dy];
  }

  function getYaw() {
    return orbit.yaw;
  }

  MD.view3d = {
    init: init,
    sync: sync,
    render: render,
    resize: resize,
    pickTile: pickTile,
    screenToTileDir: screenToTileDir,
    getYaw: getYaw,
    setTheme: setTheme,
    active: false,
  };
})(typeof window !== "undefined" ? window : globalThis);
