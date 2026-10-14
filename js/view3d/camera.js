/* 迷宫 3D — orbit camera */
(function (global) {
  const MD = global.MD;
  const V = MD.v3d;
  if (typeof THREE === "undefined" || !V) return;
  const { DIST_MAX, DIST_MIN, PITCH_FIXED, S, YAW_STEP, actorVisual, clamp, orbit } = V;

  function applyOrbit() {
    orbit.pitch = PITCH_FIXED;
    const cp = Math.cos(orbit.pitch);
    const sp = Math.sin(orbit.pitch);
    const sy = Math.sin(orbit.yaw);
    const cy = Math.cos(orbit.yaw);
    V.camera.position.set(
      V.lookCurrent.x + orbit.dist * sy * cp,
      V.lookCurrent.y + orbit.dist * sp,
      V.lookCurrent.z + orbit.dist * cy * cp
    );
    V.camera.up.set(0, 1, 0);
    V.camera.lookAt(V.lookCurrent.x, 0.38, V.lookCurrent.z);
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
    if (!V.camReady) {
      V.lookCurrent.set(tx, 0, tz);
      V.camReady = true;
    } else {
      V.lookCurrent.x += (tx - V.lookCurrent.x) * 0.14;
      V.lookCurrent.z += (tz - V.lookCurrent.z) * 0.14;
    }
    applyOrbit();
    if (V.playerLight) {
      V.playerLight.position.set(tx, 1.4, tz);
      const rid = state.map ? MD.getRoomId(state.map, p.x, p.y) : -1;
      const inRoom = rid != null && rid >= 0;
      V.playerLight.color.set(inRoom ? 0xffe8b8 : 0xc8e0f0);
      V.playerLight.intensity = inRoom ? 0.45 : 0.35;
      V.playerLight.distance = inRoom ? 7 : 4.2;
    }
  }

  function attachOrbit(el) {
    if (!el) return;
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 2 && e.button !== 0) return;
      V.dragging = true;
      V.lastPtrX = e.clientX;
      V.lastPtrY = e.clientY;
      el.style.cursor = "grabbing";
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      if (V.gameCanvas && V.gameCanvas.focus) V.gameCanvas.focus();
      e.preventDefault();
    });
    el.addEventListener("pointermove", function (e) {
      if (!V.dragging) return;
      const dx = e.clientX - V.lastPtrX;
      const dy = e.clientY - V.lastPtrY;
      V.lastPtrX = e.clientX;
      V.lastPtrY = e.clientY;
      orbit.yaw -= dx * 0.008;
      orbit.pitch = PITCH_FIXED; // pitch locked — drag only orbits horizontally
    });
    function endDrag(e) {
      V.dragging = false;
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

  Object.assign(V, {
    applyOrbit, updateCamera, attachOrbit, onOrbitKey,
  });
})(typeof window !== "undefined" ? window : globalThis);
