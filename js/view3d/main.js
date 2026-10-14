/* 迷宫 3D — init / sync / render / picking (public MD.view3d API) */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { CAM_FOV, FOG, S, applyOrbit, attachOrbit, canWebGL, clearMap, hideAllSprites, hideFx,
    onOrbitKey, orbit, paperMat, rebuildMap, setTheme, 
    updateActors, updateCamera, updateDecos, updateFx, updateItems, updateVisibility } = V;

  function init(canvas) {
    if (typeof THREE === "undefined") return false;
    if (!canWebGL()) return false;
    try {
      V.renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (e) {
      return false;
    }
    if (!V.renderer.getContext()) return false;

    V.gameCanvas = canvas;
    V.renderer.setClearColor(FOG, 1);
    V.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    V.renderer.outputColorSpace = THREE.SRGBColorSpace;
    V.renderer.autoClear = true;

    V.scene = new THREE.Scene();
    V.scene.background = new THREE.Color(FOG);
    V.scene.fog = new THREE.FogExp2(FOG, 0.018);

    const aspect = (canvas.clientWidth || 960) / (canvas.clientHeight || 640);
    V.camera = new THREE.PerspectiveCamera(CAM_FOV, aspect, 0.12, 90);
    V.camera.position.set(6, 7, 7);
    V.camera.lookAt(0, 0, 0);

    V.tmpColor = new THREE.Color();
    V.lookCurrent = new THREE.Vector3();
    V.raycaster = new THREE.Raycaster();
    V.ndc = new THREE.Vector2();
    V.hitPoint = new THREE.Vector3();
    V.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    V.hemi = new THREE.HemisphereLight(0xfff0d8, 0xa8c8b8, 0.78);
    V.scene.add(V.hemi);
    const dir = new THREE.DirectionalLight(0xfff4e0, 0.7);
    dir.position.set(10, 16, 12);
    V.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xb8d8e8, 0.28);
    fill.position.set(-8, 6, -4);
    V.scene.add(fill);
    V.scene.add(new THREE.AmbientLight(0xf0e8d8, 0.38));

    V.playerLight = new THREE.PointLight(0xffd090, 0.5, 6);
    V.scene.add(V.playerLight);
    V.stairsLight = new THREE.PointLight(0xffaa44, 1.35, 5);
    V.stairsLight.visible = false;
    V.scene.add(V.stairsLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshBasicMaterial({ color: 0x08060a, fog: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    V.scene.add(ground);
    V.groundMesh = ground;

    V.actorRoot = new THREE.Group();
    V.itemRoot = new THREE.Group();
    V.stairsRoot = new THREE.Group();
    V.decoRoot = new THREE.Group();
    V.scene.add(V.actorRoot);
    V.scene.add(V.itemRoot);
    V.scene.add(V.stairsRoot);
    V.scene.add(V.decoRoot);

    ["slime", "bat", "shell", "onigiri", "bigOnigiri", "rock", "sleepHerb", "knockStaff", "crystal", "mushroom", "lantern", "vine", "flower", "stairs"].forEach(paperMat);

    canvas.style.cursor = "grab";
    attachOrbit(canvas);
    const overlay = document.getElementById("overlay");
    if (overlay) {
      overlay.style.pointerEvents = "none";
      attachOrbit(overlay);
    }
    window.addEventListener("keydown", onOrbitKey);

    V.active = true;
    MD.view3d.active = true;
    if (V.pendingTheme) {
      const t = V.pendingTheme;
      V.pendingTheme = null;
      setTheme(t);
    }
    return true;
  }

  let lastW = 0, lastH = 0;
  let townFrames = 0;
  let renderIdle = false;
  function resize(cssW, cssH) {
    if (!V.renderer || !V.camera) return;
    const w = Math.max(1, cssW | 0);
    const h = Math.max(1, cssH | 0);
    // setSize 会重设 canvas 宽高（即使数值相同也会清空并重建绘图缓冲），只在尺寸变化时调用
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    V.renderer.setSize(w, h, false);
    V.camera.aspect = w / h;
    V.camera.updateProjectionMatrix();
  }

  function sync(state) {
    if (!V.active) return;
    const now = performance.now();
    if (state.mode !== "dungeon" || !state.map) {
      // 镇子里 3D 场景被镇子地图盖住且静止：清完场景后渲染一帧就停
      if (!V.lastMap && townFrames >= 2) { renderIdle = true; return; }
      townFrames++;
      renderIdle = false;
      if (V.lastMap) {
        clearMap();
        V.lastMap = null;
        V.camReady = false;
      }
      hideAllSprites();
      V.lookCurrent.set(0, 0, 0);
      applyOrbit();
      if (V.playerLight) V.playerLight.intensity = 0;
      hideFx();
      return;
    }
    townFrames = 0;
    renderIdle = false;
    if (state.map !== V.lastMap) {
      try {
        rebuildMap(state.map);
        V.lastMap = state.map;
        V.lastVisSig = "";
        V.camReady = false;
        hideAllSprites();
      } catch (err) {
        console.error("rebuildMap failed", err);
        clearMap();
        V.lastMap = state.map;
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
    if (!V.active || !V.renderer) return;
    if (renderIdle) return;
    V.renderer.render(V.scene, V.camera);
  }

  function pickTile(clientX, clientY, state) {
    if (!V.active || !V.camera || !V.renderer) return null;
    const canvas = V.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    V.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    V.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    V.raycaster.setFromCamera(V.ndc, V.camera);
    const hit = V.raycaster.ray.intersectPlane(V.floorPlane, V.hitPoint);
    if (!hit) return null;
    const x = Math.round(V.hitPoint.x / S);
    const y = Math.round(V.hitPoint.z / S);
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

  /** Renderer stats for debugging/perf tests. */
  function debugInfo() {
    if (!V.renderer) return null;
    const i = V.renderer.info;
    let objs = 0;
    if (V.scene) V.scene.traverse(function () { objs++; });
    return {
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs ? i.programs.length : 0,
      calls: i.render.calls,
      triangles: i.render.triangles,
      sceneObjects: objs,
    };
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
    debugInfo: debugInfo,
    active: false,
  };
})(typeof window !== "undefined" ? window : globalThis);
