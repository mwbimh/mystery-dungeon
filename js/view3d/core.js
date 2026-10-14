/* 迷宫 3D — shared constants, renderer state, noise helpers */
(function (global) {
  const V = (global.MD.v3d = {});
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

  V.renderer = null;
  V.scene = null;
  V.camera = null;
  V.active = false;
  V.tmpColor = null;
  V.raycaster = null;
  V.ndc = null;
  V.hitPoint = null;
  V.floorPlane = null;

  V.lastMap = null;
  V.lastVisSig = "";

  V.actorRoot = null;
  V.itemRoot = null;
  V.stairsRoot = null;
  V.decoRoot = null;
  const decoList = [];
  V.stairsLight = null;
  V.playerLight = null;
  V.hemi = null;
  V.currentTheme = null;
  V.pendingTheme = null;

  const actorPool = [];
  const itemPool = [];
  const actorVisual = new Map();
  const itemVisual = new Map();
  V.lookCurrent = null;
  V.camReady = false;
  V.vidSeq = 1;
  let paperMats = {};

  const orbit = {
    yaw: 0.68,
    pitch: PITCH_FIXED,
    dist: 9.4,
  };
  V.dragging = false;
  V.lastPtrX = 0;
  V.lastPtrY = 0;
  V.gameCanvas = null;

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
    V.tmpColor.copy(base);
    V.tmpColor.r = Math.min(1, Math.max(0, V.tmpColor.r + n));
    V.tmpColor.g = Math.min(1, Math.max(0, V.tmpColor.g + n * 0.8));
    V.tmpColor.b = Math.min(1, Math.max(0, V.tmpColor.b + n * 0.6));
    return V.tmpColor;
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

  Object.assign(V, {
    S, HOP_MS, FOG, CAM_FOV, PITCH_FIXED, DIST_MIN, DIST_MAX,
    YAW_STEP, COL, decoList, actorPool, itemPool, actorVisual, itemVisual, paperMats, orbit,
    hash01, noise2, fbm, tint, clamp, canWebGL,
  });
})(typeof window !== "undefined" ? window : globalThis);
