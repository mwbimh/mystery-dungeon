/* Paper-cutout sprites: prefer Kenney CC0 runtime PNGs, fall back to canvas painters */
(function (global) {
  const MD = global.MD;

  const RUNTIME = "assets/runtime/";
  /** Logical sprite name → runtime filename (no .png). */
  const FILE_MAP = {
    floor: "floor",
    wall: "wall",
    wallCap: "wallCap",
    player: "player",
    slime: "slime",
    bat: "bat",
    slimeDirs: "slime-dirs",
    batDirs: "bat-dirs",
    shell: "shell",
    onigiri: "onigiri",
    bigOnigiri: "bigOnigiri",
    rock: "rock",
    sleepHerb: "herb",
    knockStaff: "staff",
    crystal: "crystal",
    mushroom: "mushroom",
    lantern: "lantern",
    vine: "vine",
    flower: "flower",
    stairs: "stairs",
  };

  const cacheCanvas = {};
  const cacheTex = {};
  const imageCache = {}; // name → HTMLImageElement | false (failed)
  const waiters = {}; // name → [resolve]
  let preloadPromise = null;

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.imageSmoothingEnabled = true;
    return { c, ctx };
  }

  function mulberry(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function grain(ctx, w, h, amount, seed) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const rnd = mulberry(seed);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const n = (rnd() - 0.5) * amount;
      d[i] = clamp(d[i] + n);
      d[i + 1] = clamp(d[i + 1] + n);
      d[i + 2] = clamp(d[i + 2] + n);
    }
    ctx.putImageData(img, 0, 0);
  }

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function strokeFill(ctx, outline, fill, lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = outline;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }

  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ---------- dungeon materials ---------- */
  function paintFloor() {
    const { c, ctx } = makeCanvas(64, 64);
    ctx.fillStyle = "#e8c992";
    ctx.fillRect(0, 0, 64, 64);
    const rnd = mulberry(42);
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = rnd() > 0.5 ? "rgba(160,110,60,0.1)" : "rgba(255,240,200,0.12)";
      ctx.beginPath();
      ctx.ellipse(rnd() * 64, rnd() * 64, 4 + rnd() * 10, 2 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(140,100,50,0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 62, 62);
    grain(ctx, 64, 64, 14, 42);
    return c;
  }

  function paintWall() {
    const { c, ctx } = makeCanvas(64, 64);
    ctx.fillStyle = "#a8b4c4";
    ctx.fillRect(0, 0, 64, 64);
    const rnd = mulberry(99);
    ctx.strokeStyle = "rgba(80,90,110,0.28)";
    ctx.lineWidth = 2;
    for (let y = 0; y < 64; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(64, y + 0.5);
      ctx.stroke();
      const shift = (y / 16) % 2 === 0 ? 0 : 16;
      for (let x = shift; x < 64; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + 16);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rnd() > 0.5 ? "rgba(60,70,90,0.1)" : "rgba(230,235,245,0.12)";
      ctx.fillRect(rnd() * 64, rnd() * 64, 3 + rnd() * 8, 2 + rnd() * 5);
    }
    grain(ctx, 64, 64, 12, 99);
    return c;
  }

  function paintWallCap() {
    const { c, ctx } = makeCanvas(32, 32);
    ctx.fillStyle = "#c0cad6";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "rgba(80,90,110,0.2)";
    ctx.fillRect(0, 20, 32, 12);
    grain(ctx, 32, 32, 12, 7);
    return c;
  }

  /* ---------- characters ---------- */
  function paintPlayer() {
    const { c, ctx } = makeCanvas(128, 176);
    const ink = "#2a1c12";
    ctx.beginPath();
    ctx.moveTo(34, 78);
    ctx.quadraticCurveTo(18, 110, 28, 150);
    ctx.lineTo(50, 148);
    ctx.quadraticCurveTo(40, 110, 48, 82);
    ctx.closePath();
    strokeFill(ctx, ink, "#4a2a18", 3);
    ctx.beginPath();
    ctx.moveTo(90, 78);
    ctx.quadraticCurveTo(110, 108, 102, 150);
    ctx.lineTo(80, 148);
    ctx.quadraticCurveTo(94, 110, 80, 82);
    ctx.closePath();
    strokeFill(ctx, ink, "#5a3420", 3);

    roundRect(ctx, 48, 118, 14, 36, 5);
    strokeFill(ctx, ink, "#3f4d40", 3);
    roundRect(ctx, 66, 118, 14, 36, 5);
    strokeFill(ctx, ink, "#4a5a48", 3);
    roundRect(ctx, 44, 148, 20, 16, 5);
    strokeFill(ctx, ink, "#3a2416", 3);
    roundRect(ctx, 66, 148, 20, 16, 5);
    strokeFill(ctx, ink, "#4a3020", 3);

    ctx.beginPath();
    ctx.moveTo(44, 78);
    ctx.quadraticCurveTo(64, 72, 84, 78);
    ctx.lineTo(88, 122);
    ctx.quadraticCurveTo(64, 132, 40, 122);
    ctx.closePath();
    strokeFill(ctx, ink, "#c4a36a", 3);
    roundRect(ctx, 44, 108, 40, 8, 2);
    strokeFill(ctx, ink, "#3a2416", 2.5);
    ctx.fillStyle = "#d4a84b";
    ctx.fillRect(60, 108, 8, 8);

    ctx.beginPath();
    ctx.moveTo(32, 100);
    ctx.lineTo(22, 148);
    ctx.lineTo(28, 150);
    ctx.lineTo(40, 104);
    ctx.closePath();
    strokeFill(ctx, ink, "#c5ced6", 2.5);
    roundRect(ctx, 28, 96, 16, 8, 2);
    strokeFill(ctx, ink, "#8b6914", 2);

    ellipse(ctx, 66, 58, 20, 22);
    strokeFill(ctx, ink, "#e8c4a0", 3);
    ctx.beginPath();
    ctx.moveTo(48, 52);
    ctx.quadraticCurveTo(50, 38, 66, 36);
    ctx.quadraticCurveTo(86, 38, 84, 54);
    ctx.quadraticCurveTo(78, 48, 66, 50);
    ctx.quadraticCurveTo(54, 48, 48, 52);
    ctx.closePath();
    strokeFill(ctx, ink, "#3d2914", 2.5);

    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(60, 60, 2.2, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(74, 60, 2.2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(64, 70);
    ctx.quadraticCurveTo(68, 74, 74, 70);
    ctx.stroke();
    ctx.fillStyle = "rgba(220,120,90,0.28)";
    ellipse(ctx, 54, 66, 5, 3);
    ctx.fill();
    ellipse(ctx, 80, 66, 5, 3);
    ctx.fill();

    ellipse(ctx, 64, 40, 46, 12);
    strokeFill(ctx, ink, "#d4a04a", 3);
    ellipse(ctx, 66, 30, 26, 16);
    strokeFill(ctx, ink, "#e0b45c", 3);
    ctx.beginPath();
    ctx.ellipse(66, 38, 26, 5, 0, 0, Math.PI * 2);
    strokeFill(ctx, ink, "#8b5a22", 2);
    ctx.strokeStyle = "rgba(255,240,200,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(58, 26, 10, 4, -0.5, 0, Math.PI);
    ctx.stroke();

    grain(ctx, 128, 176, 12, 11);
    return c;
  }

  function paintSlime() {
    const { c, ctx } = makeCanvas(96, 96);
    const ink = "#14301c";
    ellipse(ctx, 48, 58, 36, 28);
    strokeFill(ctx, ink, "#3db36c", 3.5);
    ellipse(ctx, 48, 50, 32, 24);
    ctx.fillStyle = "#5ecf8a";
    ctx.fill();
    ctx.fillStyle = "rgba(200,255,220,0.7)";
    ellipse(ctx, 36, 42, 10, 7);
    ctx.fill();
    ctx.fillStyle = ink;
    ellipse(ctx, 38, 54, 4, 6);
    ctx.fill();
    ellipse(ctx, 58, 54, 4, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ellipse(ctx, 37, 52, 1.6, 2);
    ctx.fill();
    ellipse(ctx, 57, 52, 1.6, 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(48, 62, 8, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.strokeStyle = ink;
    ctx.fillStyle = "#3db36c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(16, 58, 8, 5, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(80, 58, 8, 5, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    grain(ctx, 96, 96, 10, 3);
    return c;
  }

  function paintBat() {
    const { c, ctx } = makeCanvas(128, 96);
    const ink = "#1a1428";
    function wing(dir) {
      ctx.beginPath();
      ctx.moveTo(64, 50);
      ctx.quadraticCurveTo(64 + dir * 28, 18, 64 + dir * 56, 38);
      ctx.quadraticCurveTo(64 + dir * 42, 48, 64 + dir * 50, 62);
      ctx.quadraticCurveTo(64 + dir * 32, 50, 64 + dir * 18, 58);
      ctx.quadraticCurveTo(64 + dir * 22, 44, 64, 50);
      ctx.closePath();
      strokeFill(ctx, ink, dir < 0 ? "#3d3558" : "#5a4a78", 3);
      ctx.strokeStyle = "rgba(20,14,32,0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(64, 50);
      ctx.quadraticCurveTo(64 + dir * 30, 32, 64 + dir * 52, 42);
      ctx.stroke();
    }
    wing(-1);
    wing(1);
    ellipse(ctx, 64, 54, 14, 18);
    strokeFill(ctx, ink, "#2a2438", 3);
    ctx.beginPath();
    ctx.moveTo(54, 40);
    ctx.lineTo(50, 24);
    ctx.lineTo(62, 38);
    ctx.closePath();
    strokeFill(ctx, ink, "#2a2438", 2.5);
    ctx.beginPath();
    ctx.moveTo(74, 40);
    ctx.lineTo(78, 24);
    ctx.lineTo(66, 38);
    ctx.closePath();
    strokeFill(ctx, ink, "#2a2438", 2.5);
    ctx.fillStyle = "#f5c16c";
    ellipse(ctx, 58, 52, 3.5, 4.5);
    ctx.fill();
    ellipse(ctx, 70, 52, 3.5, 4.5);
    ctx.fill();
    ctx.fillStyle = ink;
    ellipse(ctx, 59, 53, 1.5, 2);
    ctx.fill();
    ellipse(ctx, 71, 53, 1.5, 2);
    ctx.fill();
    ctx.fillStyle = "#f0ece4";
    ctx.beginPath();
    ctx.moveTo(60, 64);
    ctx.lineTo(62, 70);
    ctx.lineTo(64, 64);
    ctx.moveTo(64, 64);
    ctx.lineTo(66, 70);
    ctx.lineTo(68, 64);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    grain(ctx, 128, 96, 10, 5);
    return c;
  }

  function paintShell() {
    const { c, ctx } = makeCanvas(112, 96);
    const ink = "#2a2218";
    ctx.fillStyle = "#c4a882";
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    [[22, 70], [36, 78], [72, 78], [86, 70]].forEach(function (p) {
      ellipse(ctx, p[0], p[1], 8, 5);
      ctx.fill();
      ctx.stroke();
    });
    ellipse(ctx, 56, 50, 40, 28);
    strokeFill(ctx, ink, "#6b5840", 3.5);
    ellipse(ctx, 56, 46, 32, 20);
    strokeFill(ctx, ink, "#8b7355", 2.5);
    ctx.strokeStyle = "rgba(42,34,24,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(56, 50, 18, 22, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(24, 50);
    ctx.quadraticCurveTo(56, 36, 88, 50);
    ctx.stroke();
    ellipse(ctx, 56, 70, 16, 12);
    strokeFill(ctx, ink, "#c4a882", 3);
    ctx.fillStyle = ink;
    ellipse(ctx, 50, 70, 2.4, 3);
    ctx.fill();
    ellipse(ctx, 62, 70, 2.4, 3);
    ctx.fill();
    ctx.fillStyle = "#a88868";
    ellipse(ctx, 56, 76, 6, 4);
    ctx.fill();
    grain(ctx, 112, 96, 10, 8);
    return c;
  }

  /* ---------- items ---------- */
  function paintOnigiri(big) {
    const s = big ? 80 : 64;
    const { c, ctx } = makeCanvas(s, s);
    const ink = "#2a1c12";
    const cx = s / 2, cy = s / 2 + 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.38);
    ctx.quadraticCurveTo(cx + s * 0.38, cy + s * 0.12, cx + s * 0.28, cy + s * 0.32);
    ctx.quadraticCurveTo(cx, cy + s * 0.4, cx - s * 0.28, cy + s * 0.32);
    ctx.quadraticCurveTo(cx - s * 0.38, cy + s * 0.12, cx, cy - s * 0.38);
    ctx.closePath();
    strokeFill(ctx, ink, big ? "#f3e6c4" : "#efe0b8", 3);
    roundRect(ctx, cx - s * 0.14, cy + s * 0.02, s * 0.28, s * 0.28, 4);
    strokeFill(ctx, ink, "#2c332c", 2.5);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ellipse(ctx, cx - s * 0.1, cy - s * 0.12, s * 0.08, s * 0.05);
    ctx.fill();
    grain(ctx, s, s, 10, big ? 21 : 20);
    return c;
  }

  function paintRock() {
    const { c, ctx } = makeCanvas(64, 56);
    const ink = "#1c2228";
    ctx.beginPath();
    ctx.moveTo(16, 34);
    ctx.quadraticCurveTo(12, 18, 28, 12);
    ctx.quadraticCurveTo(44, 6, 52, 20);
    ctx.quadraticCurveTo(58, 36, 44, 44);
    ctx.quadraticCurveTo(24, 50, 16, 34);
    ctx.closePath();
    strokeFill(ctx, ink, "#9aa4b2", 3);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ellipse(ctx, 30, 20, 8, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(40,48,56,0.25)";
    ellipse(ctx, 40, 32, 8, 5);
    ctx.fill();
    grain(ctx, 64, 56, 14, 30);
    return c;
  }

  function paintHerb() {
    const { c, ctx } = makeCanvas(64, 80);
    const ink = "#1a2030";
    ctx.beginPath();
    ctx.moveTo(32, 72);
    ctx.quadraticCurveTo(30, 40, 34, 18);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "#5a8a48";
    ctx.lineWidth = 2;
    ctx.stroke();
    function leaf(x, y, rot, col) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2);
      strokeFill(ctx, ink, col, 2.4);
      ctx.strokeStyle = "rgba(20,30,20,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.stroke();
      ctx.restore();
    }
    leaf(22, 34, -0.7, "#7dba5a");
    leaf(44, 28, 0.8, "#68a848");
    leaf(32, 16, -0.15, "#a78bfa");
    grain(ctx, 64, 80, 10, 40);
    return c;
  }

  function paintStaff() {
    const { c, ctx } = makeCanvas(48, 96);
    const ink = "#1c140c";
    ctx.beginPath();
    ctx.moveTo(22, 90);
    ctx.lineTo(26, 28);
    ctx.lineTo(30, 90);
    ctx.closePath();
    strokeFill(ctx, ink, "#8b6914", 2.5);
    ctx.beginPath();
    ctx.moveTo(26, 8);
    ctx.lineTo(38, 22);
    ctx.lineTo(26, 34);
    ctx.lineTo(14, 22);
    ctx.closePath();
    strokeFill(ctx, ink, "#5eead4", 3);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.moveTo(26, 12);
    ctx.lineTo(32, 20);
    ctx.lineTo(26, 18);
    ctx.closePath();
    ctx.fill();
    grain(ctx, 48, 96, 10, 50);
    return c;
  }

  const PAINTERS = {
    floor: paintFloor,
    wall: paintWall,
    wallCap: paintWallCap,
    player: paintPlayer,
    slime: paintSlime,
    bat: paintBat,
    shell: paintShell,
    onigiri: function () { return paintOnigiri(false); },
    bigOnigiri: function () { return paintOnigiri(true); },
    rock: paintRock,
    sleepHerb: paintHerb,
    knockStaff: paintStaff,
    crystal: paintStaff,
    mushroom: paintSlime,
    lantern: paintStaff,
    vine: paintHerb,
    flower: paintHerb,
    stairs: paintStaff,
  };

  const WORLD = {
    player: { w: 0.7580, h: 0.9000 },
    slime: { w: 0.5494, h: 0.6800 },
    bat: { w: 0.6175, h: 0.7400 },
    shell: { w: 0.78, h: 0.66 },
    onigiri: { w: 0.38, h: 0.38 },
    bigOnigiri: { w: 0.46, h: 0.46 },
    rock: { w: 0.36, h: 0.32 },
    sleepHerb: { w: 0.34, h: 0.44 },
    knockStaff: { w: 0.28, h: 0.6 },
    crystal: { w: 0.36, h: 0.56 },
    mushroom: { w: 0.36, h: 0.48 },
    lantern: { w: 0.24, h: 0.7 },
    vine: { w: 0.26, h: 0.78 },
    flower: { w: 0.34, h: 0.4 },
    stairs: { w: 0.86, h: 0.98 },
  };

  function fileStem(name) {
    return FILE_MAP[name] || name;
  }

  function notifyWaiters(name, img) {
    const list = waiters[name];
    if (!list) return;
    delete waiters[name];
    for (let i = 0; i < list.length; i++) list[i](img);
  }

  function beginLoad(name) {
    if (Object.prototype.hasOwnProperty.call(imageCache, name)) return;
    const stem = fileStem(name);
    if (!stem) {
      imageCache[name] = false;
      return;
    }
    imageCache[name] = null; // loading
    const img = new Image();
    img.decoding = "async";
    img.onload = function () {
      imageCache[name] = img;
      bumpTexture(name, img);
      notifyWaiters(name, img);
    };
    img.onerror = function () {
      imageCache[name] = false;
      notifyWaiters(name, null);
    };
    img.src = RUNTIME + stem + ".png?v=50";
  }

  function getImage(name) {
    beginLoad(name);
    const v = imageCache[name];
    if (v && v !== false && v.complete && v.naturalWidth > 0) return v;
    return null;
  }

  function whenImage(name) {
    beginLoad(name);
    const v = imageCache[name];
    if (v === false) return Promise.resolve(null);
    if (v && v.complete && v.naturalWidth > 0) return Promise.resolve(v);
    return new Promise(function (resolve) {
      if (!waiters[name]) waiters[name] = [];
      waiters[name].push(resolve);
    });
  }

  function configureTex(tex, tiling) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = !!tiling;
    if (tiling) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    } else {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
    }
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  function isTiling(name) {
    return name === "floor" || name === "wall" || name === "wallCap";
  }

  function bumpTexture(name, img) {
    if (typeof THREE === "undefined") return;
    const existing = cacheTex[name];
    if (existing) {
      existing.image = img;
      existing.needsUpdate = true;
      return;
    }
    // create early so later texture() hits cache with PNG
    const tex = configureTex(new THREE.Texture(img), isTiling(name));
    cacheTex[name] = tex;
  }

  function paint(name) {
    const img = getImage(name);
    if (img) {
      // Draw PNG into a canvas so callers that expect a canvas still work
      if (cacheCanvas[name] && cacheCanvas[name].__fromImg) return cacheCanvas[name];
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      c.__fromImg = true;
      cacheCanvas[name] = c;
      return c;
    }
    if (cacheCanvas[name] && !cacheCanvas[name].__fromImg) return cacheCanvas[name];
    const fn = PAINTERS[name];
    if (!fn) return null;
    cacheCanvas[name] = fn();
    return cacheCanvas[name];
  }

  function texture(name) {
    if (typeof THREE === "undefined") return null;
    if (cacheTex[name]) return cacheTex[name];
    const img = getImage(name);
    let tex;
    if (img) {
      tex = configureTex(new THREE.Texture(img), isTiling(name));
    } else {
      const canvas = paint(name);
      if (!canvas) return null;
      tex = configureTex(new THREE.CanvasTexture(canvas), isTiling(name));
      // When PNG arrives, swap image onto this same Texture so paperMats stay valid
      whenImage(name).then(function (loaded) {
        if (!loaded || cacheTex[name] !== tex) return;
        tex.image = loaded;
        tex.needsUpdate = true;
        // Invalidate canvas paint cache so paint() redraws from PNG if needed
        if (cacheCanvas[name] && !cacheCanvas[name].__fromImg) delete cacheCanvas[name];
      });
    }
    cacheTex[name] = tex;
    return tex;
  }

  function worldSize(name) {
    return WORLD[name] || { w: 0.5, h: 0.5 };
  }

  function preload(names) {
    const list = names || Object.keys(PAINTERS);
    if (preloadPromise) return preloadPromise;
    preloadPromise = Promise.all(list.map(function (n) { return whenImage(n); })).then(function () {
      return true;
    });
    return preloadPromise;
  }

  // Kick off loads immediately so PNGs are often ready by view3d.init
  Object.keys(PAINTERS).forEach(beginLoad);

  /* ---------- 8-dir player atlases (768x512, 8 cols x 4 rows) ---------- */
  const PLAYER_ANIMS = ["idle", "walk", "run", "attack", "defend", "climb", "fail"];
  const PLAYER_COLS = 8;
  const PLAYER_ROWS = 4;
  const PLAYER_FPS = 10;
  const playerImageCache = {};
  const playerTexCache = {};
  const playerWaiters = {};

  function notifyPlayerWaiters(anim, img) {
    const list = playerWaiters[anim];
    if (!list) return;
    delete playerWaiters[anim];
    for (let i = 0; i < list.length; i++) list[i](img);
  }

  function beginLoadPlayerAnim(anim) {
    if (Object.prototype.hasOwnProperty.call(playerImageCache, anim)) return;
    playerImageCache[anim] = null;
    const img = new Image();
    img.decoding = "async";
    img.onload = function () {
      playerImageCache[anim] = img;
      bumpPlayerTexture(anim, img);
      notifyPlayerWaiters(anim, img);
    };
    img.onerror = function () {
      playerImageCache[anim] = false;
      notifyPlayerWaiters(anim, null);
    };
    img.src = RUNTIME + "player/" + anim + ".png?v=50";
  }

  function whenPlayerAnim(anim) {
    beginLoadPlayerAnim(anim);
    const v = playerImageCache[anim];
    if (v === false) return Promise.resolve(null);
    if (v && v.complete && v.naturalWidth > 0) return Promise.resolve(v);
    return new Promise(function (resolve) {
      if (!playerWaiters[anim]) playerWaiters[anim] = [];
      playerWaiters[anim].push(resolve);
    });
  }

  function configurePlayerAtlasTex(tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.repeat.set(1 / PLAYER_COLS, 1 / PLAYER_ROWS);
    tex.offset.set(0, 1 - 1 / PLAYER_ROWS);
    tex.needsUpdate = true;
    return tex;
  }

  function bumpPlayerTexture(anim, img) {
    if (typeof THREE === "undefined") return;
    const existing = playerTexCache[anim];
    if (existing) {
      existing.image = img;
      existing.needsUpdate = true;
      return;
    }
    playerTexCache[anim] = configurePlayerAtlasTex(new THREE.Texture(img));
  }

  function playerTexture(anim) {
    anim = anim || "idle";
    if (typeof THREE === "undefined") return null;
    if (playerTexCache[anim]) return playerTexCache[anim];
    beginLoadPlayerAnim(anim);
    const img = playerImageCache[anim];
    let tex;
    if (img && img !== false && img.complete && img.naturalWidth > 0) {
      tex = configurePlayerAtlasTex(new THREE.Texture(img));
    } else {
      tex = configurePlayerAtlasTex(new THREE.Texture());
      whenPlayerAnim(anim).then(function (loaded) {
        if (!loaded || playerTexCache[anim] !== tex) return;
        tex.image = loaded;
        tex.needsUpdate = true;
      });
    }
    playerTexCache[anim] = tex;
    return tex;
  }

  PLAYER_ANIMS.forEach(beginLoadPlayerAnim);

  function monsterImage(name) {
    const key = name === "slime" ? "slimeDirs" : name === "bat" ? "batDirs" : null;
    if (!key) return null;
    return getImage(key);
  }

  const ATLAS = {
    player: { cellW: 256, cellH: 304, cols: 8, rows: 4 },
    slime: { cellW: 202, cellH: 250, cols: 8, rows: 1 },
    bat: { cellW: 252, cellH: 302, cols: 8, rows: 1 },
  };

  const origPreload = preload;
  function preloadAll(names) {
    const base = origPreload(names);
    const extra = Promise.all(
      PLAYER_ANIMS.map(whenPlayerAnim).concat([whenImage("slimeDirs"), whenImage("batDirs")])
    );
    return Promise.all([base, extra]).then(function () { return true; });
  }

  beginLoad("slimeDirs");
  beginLoad("batDirs");

  MD.sprites = {
    paint: paint,
    texture: texture,
    worldSize: worldSize,
    preload: preloadAll,
    ready: preloadAll(),
    fileMap: FILE_MAP,
    playerTexture: playerTexture,
    playerImage: function (anim) {
      beginLoadPlayerAnim(anim || "idle");
      const v = playerImageCache[anim || "idle"];
      return v && v !== false ? v : null;
    },
    playerAnims: PLAYER_ANIMS,
    playerAnim: { fps: PLAYER_FPS, frames: PLAYER_ROWS, cols: PLAYER_COLS, rows: PLAYER_ROWS },
    monsterImage: monsterImage,
    atlas: ATLAS,
  };
})(typeof window !== "undefined" ? window : globalThis);
