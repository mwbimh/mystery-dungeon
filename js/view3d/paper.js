/* 迷宫 3D — paper sprites: materials, atlases, pools */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { HOP_MS, actorPool, itemPool, orbit, paperMats } = V;

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

  // 同一贴图的纸片共用一个平面几何体（装饰每层几百个），永不释放
  const paperGeoCache = {};
  function paperGeo(name, sz, flipU) {
    const key = name + (flipU ? "|flip" : "");
    let geo = paperGeoCache[key];
    if (geo && geo.userData.w === sz.w && geo.userData.h === sz.h) return geo;
    geo = new THREE.PlaneGeometry(sz.w, sz.h);
    geo.translate(0, sz.h / 2, 0);
    if (flipU) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      uv.needsUpdate = true;
    }
    geo.userData.w = sz.w;
    geo.userData.h = sz.h;
    geo.userData.shared = true;
    paperGeoCache[key] = geo;
    return geo;
  }

  function makePaperMesh(name, kind) {
    const sz = (MD.sprites && MD.sprites.worldSize(name)) || { w: 0.7580, h: 0.9000 };
    const geo = paperGeo(name, sz, false);
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
    // Billboard does rotateY(π), which mirrors U. Flip UVs so left/right match the atlas.
    const geo = paperGeo(name, sz, true);
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
    if (!V.camera || !group) return layer || 0;
    const dx = V.camera.position.x - group.position.x;
    const dy = V.camera.position.y - group.position.y;
    const dz = V.camera.position.z - group.position.z;
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
    V.actorRoot.add(g);
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
    V.itemRoot.add(g);
    itemPool.push(g);
    return g;
  }

  /** 释放纸片自己独占的资源（共享几何体和 paperMats 里的材质不动）。 */
  function disposePaper(paper) {
    if (!paper) return;
    const ud = paper.userData || {};
    if (paper.geometry && !(paper.geometry.userData && paper.geometry.userData.shared)) paper.geometry.dispose();
    if (ud.atlas) {
      if (ud.atlasTex) ud.atlasTex.dispose();
      if (paper.material) paper.material.dispose();
    }
  }

  function setPaper(group, name, kind) {
    if (group.userData.paper && group.userData.name === name) return;
    if (group.userData.paper) {
      group.remove(group.userData.paper);
      disposePaper(group.userData.paper);
      group.userData.paper = null;
    }
    const paper = (name === "player" || name === "slime" || name === "bat")
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

  Object.assign(V, {
    paperMat, makePaperMesh, updatePlayerSprite, updateMonsterSprite,
    paperSortOrder, allocActor, allocItem, setPaper, disposePaper,
  });
})(typeof window !== "undefined" ? window : globalThis);
