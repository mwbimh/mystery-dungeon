/* 迷宫 3D — ambient particle FX */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;

  let fxDotTexture = null;
  let fxLayers = [];
  let fxLastT = 0;
  V.groundMesh = null;

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
      V.scene.remove(L.group);
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
      V.scene.add(group);
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

  Object.assign(V, {
    initFx, updateFx, hideFx,
  });
})(typeof window !== "undefined" ? window : globalThis);
