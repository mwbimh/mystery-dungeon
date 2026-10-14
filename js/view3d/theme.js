/* 迷宫 3D — themes and cave textures */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { COL, clamp, hash01, initFx, noise2 } = V;

  function setTheme(theme) {
    if (!theme) return;
    if (!V.active || !V.scene) { V.pendingTheme = theme; return; }
    if (V.currentTheme === theme) return;
    V.currentTheme = theme;
    if (V.scene.fog) {
      V.scene.fog.color.set(theme.fog);
      if (theme.fogDensity && V.scene.fog.density != null) V.scene.fog.density = theme.fogDensity;
    }
    if (V.scene.background && V.scene.background.set) V.scene.background.set(theme.fog);
    if (V.renderer) V.renderer.setClearColor(theme.fog, 1);
    if (V.groundMesh) {
      V.groundMesh.material.color.set(theme.fog).multiplyScalar(0.25);
    }
    if (V.hemi) {
      V.hemi.color.set(theme.hemiSky);
      V.hemi.groundColor.set(theme.hemiGround);
    }
    if (V.playerLight && theme.lightColor) {
      V.playerLight.color.set(theme.lightColor);
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
    V.lastVisSig = "";
    tryLoadRuntimeCaveTex(theme.floorTex, function (tex) {
      V.dirtTex = tex;
      if (V.floorMesh && V.floorMesh.material) {
        V.floorMesh.material.map = tex;
        V.floorMesh.material.needsUpdate = true;
      }
    }, function () {
      V.dirtTex = makeSeamlessTex(256, 3, theme.palFloor);
      if (V.floorMesh && V.floorMesh.material) {
        V.floorMesh.material.map = V.dirtTex;
        V.floorMesh.material.needsUpdate = true;
      }
    });
    tryLoadRuntimeCaveTex(theme.wallTex, function (tex) {
      V.rockTex = tex;
      if (V.wallMesh && V.wallMesh.material) {
        V.wallMesh.material.map = tex;
        V.wallMesh.material.needsUpdate = true;
      }
    }, function () {
      V.rockTex = makeSeamlessTex(256, 19, theme.palWall);
      if (V.wallMesh && V.wallMesh.material) {
        V.wallMesh.material.map = V.rockTex;
        V.wallMesh.material.needsUpdate = true;
      }
    });
    if (theme.floorTexB && theme.wallTexB) {
      tryLoadRuntimeCaveTex(theme.floorTexB, function (tex) {
        V.dirtTexB = tex;
        if (V.floorMeshB && V.floorMeshB.material) {
          V.floorMeshB.material.map = tex;
          V.floorMeshB.material.needsUpdate = true;
        }
      }, function () {
        V.dirtTexB = makeSeamlessTex(256, 77, theme.palFloor);
        if (V.floorMeshB && V.floorMeshB.material) {
          V.floorMeshB.material.map = V.dirtTexB;
          V.floorMeshB.material.needsUpdate = true;
        }
      });
      tryLoadRuntimeCaveTex(theme.wallTexB, function (tex) {
        V.rockTexB = tex;
        if (V.wallMeshB && V.wallMeshB.material) {
          V.wallMeshB.material.map = tex;
          V.wallMeshB.material.needsUpdate = true;
        }
      }, function () {
        V.rockTexB = makeSeamlessTex(256, 91, theme.palWall);
        if (V.wallMeshB && V.wallMeshB.material) {
          V.wallMeshB.material.map = V.rockTexB;
          V.wallMeshB.material.needsUpdate = true;
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

  Object.assign(V, {
    setTheme, tryLoadRuntimeCaveTex, makeSeamlessTex, caveMat,
  });
})(typeof window !== "undefined" ? window : globalThis);
