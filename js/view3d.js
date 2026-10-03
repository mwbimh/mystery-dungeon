/* 2.5D diorama renderer — theme-specific terrain volumes + outlined target actors */
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
  const UV_SCALE = 0.38;
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
  let surfaceMesh = null;
  let environmentMesh = null;
  let environmentMeta = [];
  let surfaceMeta = [];
  let environmentStats = { primitiveCounts: {}, landmarkCounts: {} };
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
  const terrainTextures = Object.create(null);

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
    dist: 7.8,
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

  const fxTextures = Object.create(null);
  let fxLayers = [];
  let fxLastT = 0;
  let groundMesh = null;

  function reducedMotion() {
    return !!(MD.settings && MD.settings.reducedMotion);
  }

  function environment() {
    return (currentTheme && currentTheme.environment) || MD.THEMES[0].environment;
  }

  function fxStamp(shape) {
    if (fxTextures[shape]) return fxTextures[shape];
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineCap = "round";
    g.lineJoin = "round";
    if (shape === "leaf") {
      g.beginPath(); g.moveTo(12, 44); g.quadraticCurveTo(9, 13, 48, 13);
      g.quadraticCurveTo(52, 39, 12, 44); g.fill();
      g.globalCompositeOperation = "destination-out";
      g.lineWidth = 2; g.beginPath(); g.moveTo(17, 39); g.lineTo(40, 20); g.stroke();
    } else if (shape === "rain") {
      g.lineWidth = 3; g.beginPath(); g.moveTo(34, 12); g.lineTo(29, 49); g.stroke();
    } else if (shape === "spark") {
      g.beginPath(); g.moveTo(32, 7); g.lineTo(38, 26); g.lineTo(54, 32);
      g.lineTo(38, 38); g.lineTo(32, 57); g.lineTo(26, 38); g.lineTo(10, 32);
      g.lineTo(26, 26); g.closePath(); g.fill();
    } else {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 28);
      grad.addColorStop(0, "rgba(255,255,255,0.8)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.3)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    }
    fxTextures[shape] = new THREE.CanvasTexture(c);
    return fxTextures[shape];
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
      const compact = global.innerWidth && global.innerWidth < 700;
      const N = Math.min(cfg.count, compact ? 24 : 48);
      const colors = cfg.colors.map(function (c) { return new THREE.Color(c); });
      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      const seeds = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (hash01(i + 17, N + 5) - 0.5) * cfg.spread;
        pos[i * 3 + 1] = hash01(i + 23, N + 11) * cfg.height;
        pos[i * 3 + 2] = (hash01(i + 29, N + 19) - 0.5) * cfg.spread;
        const c = colors[i % colors.length];
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        seeds[i] = hash01(i + 31, N + 37) * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size: cfg.size,
        map: fxStamp(cfg.shape || "mote"),
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
      group.name = "dungeon-air";
      group.add(points);
      group.visible = false;
      scene.add(group);
      fxLayers.push({ group: group, geo: geo, mat: mat, cfg: cfg, seeds: seeds });
    }
  }

  function updateFx(now, cx, cz) {
    if (reducedMotion()) { fxLastT = now; hideFx(); return; }
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
        const half = L.cfg.spread * 0.5;
        if (pos[i * 3] > half) pos[i * 3] = -half;
        else if (pos[i * 3] < -half) pos[i * 3] = half;
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
    // A theme switch on the same logical floor also rebuilds its visual geometry.
    lastMap = null;
    if (scene.fog) {
      scene.fog.color.set(theme.fog);
      if (theme.fogDensity && scene.fog.density != null) scene.fog.density = theme.fogDensity;
    }
    if (scene.background && scene.background.set) scene.background.set(theme.fog);
    if (renderer) renderer.setClearColor(theme.fog, 1);
    if (groundMesh) {
      groundMesh.material.color.set(theme.fog);
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
    // Each material has a designed visual vocabulary, not merely a recolored noise.
    if (!terrainTextures[theme.id]) terrainTextures[theme.id] = [
      paintedTerrain(theme, false, false), paintedTerrain(theme, true, false),
      paintedTerrain(theme, false, true), paintedTerrain(theme, true, true),
    ];
    [dirtTex, rockTex, dirtTexB, rockTexB] = terrainTextures[theme.id];
  }

  // Painted materials are authored at three scales: broad color masses, readable
  // construction/organic shapes, then small brush marks. Their world-space UVs
  // continue across cells, so the gameplay grid never becomes the artwork.
  function materialTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    return tex;
  }

  function paintedTerrain(theme, wall, alternate) {
    const size = 512, env = theme.environment;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
    const g = canvas.getContext("2d"), seed = 71 + (alternate ? 137 : 0) + (wall ? 311 : 0);
    const rgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    const base = rgb(wall ? env.stone : env.ground);
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const broad = Math.sin(u * Math.PI * 4 + Math.sin(v * Math.PI * 2) * 1.8) * Math.cos(v * Math.PI * 4 + 0.7);
      const grain = (hash01(x + seed, y + seed) - 0.5) * 9;
      const shade = broad * (theme.id === "forest" ? 13 : 7) + grain;
      const i = (y * size + x) * 4;
      image.data[i] = clamp(base[0] + shade, 0, 255);
      image.data[i + 1] = clamp(base[1] + shade * 0.8, 0, 255);
      image.data[i + 2] = clamp(base[2] + shade * 0.55, 0, 255);
      image.data[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    const R = (i, j) => hash01(i * 13 + seed, j * 17 + seed);
    const ellipse = (x,y,rx,ry,angle,color) => { g.fillStyle=color; g.beginPath(); g.ellipse(x,y,rx,ry,angle,0,Math.PI*2); g.fill(); };
    const line = (points,color,width) => { g.strokeStyle=color; g.lineWidth=width; g.lineCap="round"; g.beginPath(); points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p)); g.stroke(); };
    if (theme.id === "forest") {
      // Deliberately clustered meadow, not a uniform confetti/noise fill.
      for (let i=0;i<46;i++) {
        const x=R(i,1)*size,y=R(i,2)*size,r=16+R(i,3)*56;
        ellipse(x,y,r,r*0.53,R(i,4)*3,wall?"rgba(101,72,34,.13)":i%3?"rgba(81,139,46,.14)":"rgba(246,221,151,.35)");
      }
      for (let i=0;i<760;i++) {
        const x=R(i,5)*size,y=R(i,6)*size,patch=noise2(x/65+seed,y/65);
        if (patch<0.42) continue;
        const length=3+R(i,7)*8;
        line([[x-3,y+2],[x,y-length],[x+1,y+1],[x+5,y-length*0.65]],i%3?"rgba(75,122,39,.50)":"rgba(232,240,151,.75)",1.6);
        if (i%13===0) {
          ellipse(x,y,3.2,1.8,-0.6,"#e7c372"); ellipse(x+2,y-4,2,3,0.3,"#7d9f46");
        }
        if (!wall && i%29===0) {
          for(let k=0;k<5;k++) ellipse(x+Math.cos(k*1.256)*3,y+Math.sin(k*1.256)*3,2.3,1.4,k*1.256,i%2?"#fff0b1":"#e8b9cc");
          ellipse(x,y,1.7,1.7,0,"#d29840");
        }
      }
    } else if (theme.id === "wooden") {
      // Staggered tongue-and-groove boards with knots, endgrain and warm wear.
      const rows=wall?5:8, height=size/rows;
      for(let row=0;row<rows;row++) {
        const y=row*height;
        g.fillStyle=row%3===0?"rgba(115,62,28,.10)":"rgba(255,218,151,.13)"; g.fillRect(0,y,size,height-2);
        line([[0,y+height-1],[size,y+height-1]],"rgba(111,66,34,.49)",2.2);
        line([[0,y+3],[size,y+3]],"rgba(255,226,165,.52)",1.5);
        const joint=(row%2?0.3:0.76)*size;
        line([[joint,y+3],[joint,y+height-3]],"rgba(104,62,30,.48)",2);
        for(let k=0;k<10;k++) {
          const gy=y+6+R(row,k)*Math.max(6,height-12),start=R(k,row)*size;
          line([[start,gy],[start+24,gy-2],[start+57,gy+1],[start+104,gy]],"rgba(125,75,36,.17)",1.2);
        }
        const knotX=R(row,50)*size;
        ellipse(knotX,y+height*0.48,9,3,0,"rgba(103,57,28,.30)");
        line([[knotX-21,y+height*0.48],[knotX-7,y+height*0.37],[knotX+13,y+height*0.39],[knotX+26,y+height*0.48]],"rgba(118,64,27,.29)",1.2);
      }
    } else if (["modern","cyber","future"].includes(theme.id)) {
      const cyber=theme.id==="cyber", future=theme.id==="future", step=wall?128:256;
      for(let y=0;y<size;y+=step) for(let x=0;x<size;x+=step) {
        g.fillStyle=cyber?"rgba(38,49,91,.27)":"rgba(71,123,144,.10)"; g.fillRect(x+5,y+5,step-10,step-10);
        g.fillStyle=cyber?"rgba(157,171,214,.18)":"rgba(247,254,238,.28)"; g.fillRect(x+8,y+8,step-16,step-18);
        line([[x+1,y+step-1],[x+step-1,y+step-1],[x+step-1,y+1]],cyber?"rgba(33,34,72,.55)":"rgba(88,131,151,.37)",2);
        const corner=15;
        for(const a of [[corner,corner],[step-corner,corner],[corner,step-corner],[step-corner,step-corner]]) ellipse(x+a[0],y+a[1],2.2,2.2,0,cyber?"#7c95b7":"#8aacb2");
        if(cyber) {
          line([[x+23,y+41],[x+62,y+41],[x+77,y+57],[x+77,y+91]],"rgba(77,224,225,.58)",3);
          line([[x+step-24,y+step-35],[x+step-73,y+step-35]],"rgba(238,142,212,.75)",4);
        } else if(future) {
          g.fillStyle="rgba(77,174,165,.30)"; g.fillRect(x+step*0.25,y+step-14,step*0.5,5);
          for(let k=0;k<3;k++) { g.fillStyle="rgba(222,164,86,.52)"; g.fillRect(x+17+k*7,y+19,4,8); }
        } else if((x+y)%512===0) {
          for(let k=0;k<4;k++) line([[x+21+k*7,y+step-33],[x+25+k*7,y+step-22]],"rgba(80,131,146,.32)",2);
        }
      }
    } else {
      const wet=theme.id==="wetcave", ruin=theme.id==="ruins";
      if(ruin) {
        const stepY=ruin?128:96;
        for(let row=-1;row<6;row++) for(let col=-1;col<5;col++) {
          const x=col*168+(row%2)*84,y=row*stepY;
          g.fillStyle=(row+col)%3?"rgba(245,233,205,.13)":"rgba(79,80,96,.10)";
          g.fillRect(x+3,y+3,161,stepY-6);
          line([[x+4,y+stepY-3],[x+165,y+stepY-3],[x+165,y+4]],ruin?"rgba(136,108,70,.35)":"rgba(69,66,97,.22)",2.5);
          line([[x+8,y+5],[x+159,y+5]],"rgba(255,238,204,.28)",2);
        }
      }
      if(wall && !ruin) for(let i=0;i<9;i++) {
        const y=i*61+(i%2)*11;
        line([[-10,y],[70,y+7],[147,y-6],[235,y+9],[326,y-4],[419,y+5],[522,y]],wet?"rgba(64,116,137,.24)":"rgba(93,70,121,.24)",3+(i%3)*2);
        line([[-10,y-4],[70,y+3],[147,y-10],[235,y+5],[326,y-8],[419,y+1],[522,y-4]],"rgba(241,229,215,.25)",2);
      }
      for(let i=0;i<(wall?100:200);i++) {
        const x=R(i,1)*size,y=R(i,2)*size,r=2+R(i,3)*(wall?8:11);
        ellipse(x,y,r,r*(0.4+R(i,4)*0.4),R(i,5)*3,wet?i%3?"rgba(82,159,167,.22)":"rgba(216,238,223,.40)":i%3?"rgba(138,107,87,.18)":"rgba(255,235,188,.5)");
        if(i%7===0) line([[x-r*0.6,y-r*0.3],[x+r*0.3,y-r*0.35]],"rgba(255,245,208,.36)",1.5);
        if(i%23===0) line([[x,y],[x+9,y+8],[x+18,y+5],[x+25,y+13]],wet?"rgba(53,124,139,.20)":"rgba(111,87,93,.24)",1.5);
      }
      if(wet) for(let i=0;i<15;i++) {
        const x=R(i,41)*size,y=R(i,42)*size;
        ellipse(x,y,17+R(i,44)*27,7+R(i,45)*12,R(i,43)*3,"rgba(41,173,174,.24)");
        line([[x-9,y-4],[x+8,y-5]],"rgba(198,246,232,.57)",2);
      }
      if(ruin) for(let i=0;i<28;i++) ellipse(R(i,91)*size,R(i,92)*size,11+R(i,93)*14,5+R(i,94)*7,0.4,"rgba(102,144,82,.23)");
    }
    return materialTexture(canvas);
  }

  let volumeTexture = null;
  const FINISH = { stone:0, foliage:1, wood:2, panel:3, plain:4, water:5, blossom:6, metal:7 };
  function volumeAtlas() {
    if(volumeTexture) return volumeTexture;
    const size=1024, cell=256, canvas=document.createElement("canvas"); canvas.width=canvas.height=size;
    const g=canvas.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,size,size);
    for(const [name,slot] of Object.entries(FINISH)) {
      const ox=(slot%4)*cell,oy=Math.floor(slot/4)*cell;
      g.save(); g.translate(ox,oy); g.beginPath(); g.rect(0,0,cell,cell); g.clip();
      g.fillStyle="#eef0e6"; g.fillRect(0,0,cell,cell);
      for(let i=0;i<150;i++) {
        const x=hash01(i+slot*43,7)*cell,y=hash01(i+slot*13,23)*cell;
        g.fillStyle=i%3?"rgba(255,255,246,.14)":"rgba(42,49,42,.08)";
        g.beginPath(); g.ellipse(x,y,4+hash01(i,13)*14,3+hash01(i,16)*8,hash01(i,17)*3,0,Math.PI*2);g.fill();
      }
      if(name==="foliage") for(let i=0;i<150;i++) {
        const x=hash01(i+47,52)*cell,y=hash01(i+18,93)*cell,a=hash01(i,82)*6;
        g.fillStyle=i%4===0?"#fbf4bb":i%3===0?"#c0ceaa":"#e0e8c8";
        g.beginPath();g.ellipse(x,y,5+hash01(i,29)*7,2.8,a,0,Math.PI*2);g.fill();
        g.strokeStyle="rgba(78,104,59,.18)";g.lineWidth=1;g.beginPath();g.moveTo(x-3*Math.cos(a),y-3*Math.sin(a));g.lineTo(x+4*Math.cos(a),y+4*Math.sin(a));g.stroke();
      }
      if(name==="wood") for(let i=0;i<44;i++) {
        const x=hash01(i,16)*cell;
        g.strokeStyle=i%3?"rgba(69,43,26,.23)":"rgba(255,245,211,.47)";g.lineWidth=1+hash01(i,32)*3;
        g.beginPath();g.moveTo(x,-3);g.bezierCurveTo(x+12,70,x-9,180,x+3,260);g.stroke();
      }
      if(name==="stone") for(let i=0;i<16;i++) {
        const x=hash01(i+7,14)*cell,y=hash01(i+12,24)*cell;
        g.strokeStyle="rgba(75,68,90,.16)";g.lineWidth=1.5;g.beginPath();g.moveTo(x,y);g.lineTo(x+15,y+9);g.lineTo(x+28,y+5);g.stroke();
      }
      if(name==="panel" || name==="metal") {
        g.fillStyle="rgba(43,61,81,.13)";g.fillRect(22,23,212,8);g.fillRect(22,223,212,6);
        for(let k=0;k<5;k++){g.fillStyle="rgba(56,68,81,.19)";g.fillRect(36,47+k*14,90,5);}
        for(const [x,y] of [[17,16],[239,16],[17,240],[239,240]]){g.fillStyle="#8eaaa7";g.beginPath();g.arc(x,y,3.5,0,Math.PI*2);g.fill();}
      }
      if(name==="water") {g.fillStyle="rgba(255,255,255,.6)";g.fillRect(49,89,55,3);g.fillRect(88,121,81,3);}
      g.restore();
    }
    volumeTexture=materialTexture(canvas); volumeTexture.wrapS=volumeTexture.wrapT=THREE.ClampToEdgeWrapping;
    return volumeTexture;
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
        d[i] = clamp(palette[0] + k * 22 + (hash01(x + seed, y) - 0.5) * 10, 0, 255) | 0;
        d[i + 1] = clamp(palette[1] + k * 20 + (hash01(x, y + seed) - 0.5) * 10, 0, 255) | 0;
        d[i + 2] = clamp(palette[2] + k * 18 + (hash01(x + y, seed) - 0.5) * 8, 0, 255) | 0;
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
    const row = reducedMotion() ? 0 : playerFrameIndex(anim, actor, now);
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
        if (group.userData.paper.userData.atlasTex) group.userData.paper.userData.atlasTex.dispose();
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
    disposeMesh(surfaceMesh);
    disposeMesh(environmentMesh);
    floorMesh = wallMesh = null;
    floorMeshB = wallMeshB = surfaceMesh = environmentMesh = null;
    environmentMeta = [];
    surfaceMeta = [];
    environmentStats = { primitiveCounts: {}, landmarkCounts: {} };
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
    return (fbm(vi * 0.68, vj * 0.68) - 0.45) * environment().floorRelief;
  }

  function wallH(vi, vj) {
    const e = environment();
    const broad = fbm(vi * 0.42 + 11.2, vj * 0.42 + 4.8);
    if (e.form === "broken-masonry") return e.height + Math.floor(broad * 4) * 0.09;
    return e.height + broad * e.relief;
  }

  function plateauJitter(map, vi, vj) {
    const e = environment();
    let ox = 0, oz = 0;
    for (const cell of [[vi - 1, vj - 1], [vi, vj - 1], [vi - 1, vj], [vi, vj]]) {
      if (isFloor(map, cell[0], cell[1])) { ox += wx(vi) - cell[0]; oz += wz(vj) - cell[1]; }
    }
    const len = Math.hypot(ox, oz) || 1;
    // Retreat into wall cells. Never narrow a traversable tile with geometry.
    const amt = e.inset * (e.relief ? 0.45 + hash01(vi, vj + 99) * 0.55 : 1);
    return { x: ox / len * amt, z: oz / len * amt };
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

  // Reused primitive templates are transformed directly into two merged batches.
  // No scene node per rock/post/pipe and no allocation in the render loop.
  const solids = Object.create(null);
  function addSolid(builder, shape, position, scale, rotation, meta) {
    environmentStats.primitiveCounts[shape] = (environmentStats.primitiveCounts[shape] || 0) + 1;
    if (!solids[shape]) {
      solids[shape] = shape === "rock" ? new THREE.IcosahedronGeometry(0.5, 0)
        : shape === "round" ? new THREE.SphereGeometry(0.5, 7, 4)
        : shape === "bud" ? new THREE.SphereGeometry(0.5, 5, 2)
        : shape === "shrub" ? new THREE.SphereGeometry(0.5, 7, 3)
        : shape === "leafball" ? new THREE.SphereGeometry(0.5, 8, 4)
        : shape === "crystal" ? new THREE.CylinderGeometry(0.015, 0.5, 1, 5)
        : shape === "column" ? new THREE.CylinderGeometry(0.5, 0.5, 1, 8)
        : shape === "cone" ? new THREE.CylinderGeometry(0.12, 0.5, 1, 7)
        : new THREE.BoxGeometry(1, 1, 1);
    }
    const geo = solids[shape], p = geo.attributes.position, uv = geo.attributes.uv;
    const base = builder.meta.length;
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0]))), new THREE.Vector3(...scale));
    const point = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).applyMatrix4(matrix);
      const slot = FINISH[meta.finish || "stone"] || 0;
      const u = uv ? uv.getX(i) : 0, v = uv ? uv.getY(i) : 0;
      builder.vert(point.x, point.y, point.z, ((slot % 4) + 0.018 + u * 0.964) / 4,
        1 - (Math.floor(slot / 4) + 0.982 - v * 0.964) / 4, meta);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i += 3) builder.tri(base + geo.index.getX(i), base + geo.index.getX(i + 1), base + geo.index.getX(i + 2));
    else for (let i = 0; i < p.count; i += 3) builder.tri(base + i, base + i + 1, base + i + 2);
  }

  function rebuildMap(map) {
    clearMap();
    if (!map) return;
    const w = map.width, h = map.height, th = currentTheme || MD.THEMES[0], env = environment();
    const fb = new Builder(), fbB = new Builder(), wb = new Builder(), wbB = new Builder();
    const structures = new Builder(), surfaces = new Builder();
    const floorIndices = [new Map(), new Map()], wallIndices = [new Map(), new Map()];
    const dressedWalls = new Set();
    function landmark(name) { environmentStats.landmarkCounts[name] = (environmentStats.landmarkCounts[name] || 0) + 1; }
    function floorVar(x, y) { return fbm(x * 0.22 + 7.3, y * 0.22 + 2.9) > 0.46 ? 1 : 0; }
    function wallVar(x, y) { return fbm(x * 0.27 + 11.7, y * 0.27 + 5.1) > 0.51 ? 1 : 0; }
    function F(v) { return v ? fbB : fb; }
    function W(v) { return v ? wbB : wb; }
    function metaFor(x, y, color, tone, finish) {
      return { kind: "environment", cells: [{ x, y, room: isRoom(map, x, y) }], surfaceColor: new THREE.Color(color), tone: tone == null ? 1 : tone, finish: finish || "stone" };
    }
    function floorVertex(x, y, v) {
      const key = x + "," + y, cache = floorIndices[v];
      if (!cache.has(key)) cache.set(key, F(v).vert(wx(x), floorH(x, y, map), wz(y), x * UV_SCALE, y * UV_SCALE, { kind: "floor", cells: floorCellsAt(map, x, y) }));
      return cache.get(key);
    }
    function wallPosition(x, y) {
      const j = plateauJitter(map, x, y);
      return { x: wx(x) + j.x, y: wallH(x, y), z: wz(y) + j.z };
    }
    function wallVertex(x, y, v) {
      const key = x + "," + y, cache = wallIndices[v], p = wallPosition(x, y);
      if (!cache.has(key)) cache.set(key, W(v).vert(p.x, p.y, p.z, x * UV_SCALE, y * UV_SCALE, { kind: "wall", cells: wallCellsAt(map, x, y), tone: 0.83 }));
      return cache.get(key);
    }
    function nearFloor(x, y) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(map, x + dx, y + dy)) return true;
      return false;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (isFloor(map, x, y)) {
        const v = floorVar(x, y);
        F(v).quad(floorVertex(x, y, v), floorVertex(x, y + 1, v), floorVertex(x + 1, y + 1, v), floorVertex(x + 1, y, v));
      } else if (nearFloor(x, y)) {
        // Only a one-tile cutaway shell is rendered; deep solid walls no longer
        // become a giant featureless platform covering most of the screen.
        const v = wallVar(x, y);
        W(v).quad(wallVertex(x, y, v), wallVertex(x, y + 1, v), wallVertex(x + 1, y + 1, v), wallVertex(x + 1, y, v));
      }
    }

    function facade(ax, ay, bx, by, wallX, wallY, floorX, floorY) {
      const top0 = wallPosition(ax, ay), top1 = wallPosition(bx, by);
      const nx = -(by - ay), nz = bx - ax, tx = bx - ax, tz = by - ay;
      const n = hash01(wallX * 31 + ax, wallY * 23 + by);
      const builder = W(wallVar(wallX, wallY));
      const cells = [{ x: wallX, y: wallY, room: false }];
      // Broad changes of cross-section make actual shelves, erosion, banks or
      // sloped cabin panels. No thin stripe is added to any boundary.
      const levels = env.form === "rootbank" ? [0, 0.22, 0.64, 1]
        : env.form === "pressure-shells" ? [0, 0.18, 0.78, 1]
        : env.form === "karst" ? [0, 0.24, 0.57, 0.83, 1]
        : env.form === "strata" ? [0, 0.30, 0.62, 1] : [0, 0.14, 0.86, 1];
      const across = env.form === "karst" || env.form === "strata" ? 3 : 1;
      function point(u, t) {
        const baseX = wx(ax) + tx * u, baseZ = wz(ay) + tz * u;
        const topX = top0.x + (top1.x - top0.x) * u, topZ = top0.z + (top1.z - top0.z) * u;
        let depth = 0;
        if (env.form === "strata") depth = t === 0.3 ? 0.11 + n * 0.05 : t === 0.62 ? 0.025 : 0;
        if (env.form === "karst") depth = Math.sin(Math.PI * t) * (0.12 + Math.sin(u * Math.PI) * 0.15);
        if (env.form === "rootbank") depth = Math.sin(Math.PI * t * 0.75) * 0.13;
        if (env.form === "broken-masonry") depth = t > 0 && t < 1 ? 0.22 : 0;
        if (env.form === "timber-bays" || env.form === "service-bays") depth = t > 0 && t < 1 ? 0.21 : 0;
        if (env.form === "utility-stacks") depth = t > 0 && t < 1 ? 0.29 : 0;
        if (env.form === "pressure-shells") depth = t === 0.18 || t === 0.78 ? 0.22 : 0.09;
        // Every facade shares its endpoint profile with its neighbour. The old
        // normal-offset endpoints opened bright cracks at concave room corners.
        depth *= Math.sin(Math.PI * u);
        return { x: baseX + (topX - baseX) * t - nx * depth, y: -0.02 + (top0.y + (top1.y - top0.y) * u + 0.02) * t, z: baseZ + (topZ - baseZ) * t - nz * depth };
      }
      for (let row = 0; row < levels.length - 1; row++) for (let col = 0; col < across; col++) {
        const u = col / across, v = (col + 1) / across;
        const points = [point(u, levels[row]), point(v, levels[row]), point(v, levels[row + 1]), point(u, levels[row + 1])];
        const meta = { kind: "wall", cells, tone: row === 0 ? 0.80 : 0.95 };
        const ids = points.map(p => builder.vert(p.x, p.y, p.z, (tx ? p.x : p.z) * UV_SCALE, p.y * UV_SCALE, meta));
        builder.quad(...ids);
      }
      const cx = (wx(ax) + wx(bx)) / 2, cz = (wz(ay) + wz(by)) / 2;
      const height = (top0.y + top1.y) / 2;
      const rotation = [0, Math.atan2(tx, tz) - Math.PI / 2, 0];
      const organic = ["rootbank", "broken-masonry", "karst", "strata"].includes(env.form);
      const finish = organic ? "stone" : env.form === "timber-bays" ? "wood" : "panel";
      const stone = metaFor(wallX, wallY, env.stone, 1, finish);
      const secondary = metaFor(wallX, wallY, env.secondary, 1, env.form === "rootbank" ? "wood" : finish);
      const accent = metaFor(wallX, wallY, env.accent, 1, env.form === "rootbank" || env.form === "broken-masonry" ? "foliage" : env.form === "karst" ? "water" : finish);
      const detail = metaFor(wallX, wallY, env.detail, 1, "plain");
      const foliage = metaFor(wallX, wallY, 0x7eba83, 1, "foliage");
      function solid(shape, along, depth, y, sx, sy, sz, material, turn, lean, wide) {
        const angle = turn || 0, tilt = lean || 0;
        // Crowns may bridge consecutive solid bank cells, never a path/corner.
        const continuous = wide && isWall(map,wallX+tx,wallY+tz) && isWall(map,wallX-tx,wallY-tz)
          && inMap(map,wallX+tx,wallY+tz) && inMap(map,wallX-tx,wallY-tz);
        const span = continuous ? 0.73 : 0.48;
        if(continuous) sx *= 1.4;
        let tangentRadius = (Math.abs(Math.cos(angle)) * (Math.abs(Math.cos(tilt)) * sx + Math.abs(Math.sin(tilt)) * sy) + Math.abs(Math.sin(angle)) * sz) / 2;
        let normalRadius = (Math.abs(Math.sin(angle)) * (Math.abs(Math.cos(tilt)) * sx + Math.abs(Math.sin(tilt)) * sy) + Math.abs(Math.cos(angle)) * sz) / 2;
        const fit = Math.min(1, span / tangentRadius, 0.48 / normalRadius);
        sx *= fit; sy *= fit; sz *= fit;
        tangentRadius *= fit; normalRadius *= fit;
        depth = clamp(depth, normalRadius + 0.015, 0.985 - normalRadius);
        along = clamp(along, -span + tangentRadius, span - tangentRadius);
        const rot = rotation.slice(); rot[1] += angle; rot[2] = tilt;
        addSolid(structures, shape, [cx + tx * along - nx * depth, y, cz + tz * along - nz * depth], [sx, sy, sz], rot, material);
      }
      const wallKey = wallX + "," + wallY;
      // Corners can expose three or four faces of the same cell. A single
      // coherent tree/pillar/cabinet there is more legible and much cheaper
      // than four intersecting copies of a repeated wall decoration.
      if (!dressedWalls.has(wallKey)) {
        dressedWalls.add(wallKey);
        if (env.form === "strata") {
          // Uneven bedrock is continuous; only selected pockets grow crystals.
          solid("rock", -0.16, 0.40, height * 0.66, 0.78, height * 0.90, 0.74, stone, n * 0.5);
          solid("round", 0.22, 0.43, height * 0.88, 0.54, 0.42, 0.69, secondary, -n * 0.4);
          if (n > 0.73) {
            for(let k=0;k<3;k++) solid("crystal", -0.23+k*0.22, 0.43+k*0.05, height+0.10+(k===1?0.16:0), 0.17+k*0.018, 0.24+(k===1?0.38:0.05), 0.18, k===1?accent:detail, (k-1)*0.10);
            landmark("crystal-cluster");
          } else if(n<0.29) {
            solid("round", -0.12, 0.43, height+0.05, 0.65, 0.26, 0.66, stone, n*2);
            solid("round", 0.23, 0.39, height+0.02, 0.31, 0.22, 0.40, secondary);
          }
          if(n>0.38 && n<0.63) {
            solid("column", 0.24, 0.20, 0.20, 0.07, 0.18, 0.07, detail);
            solid("round", 0.22, 0.22, 0.30, 0.23, 0.09, 0.22, accent);
          }
        } else if (env.form === "rootbank") {
          // Trees occur as groves rather than one identical icon per grid cell.
          const leafDark=metaFor(wallX,wallY,0x50894b,1,"foliage");
          const leafLight=metaFor(wallX,wallY,0xb4d85d,1,"foliage");
          const blossom=metaFor(wallX,wallY,n>0.8?0xf2c3ce:0xf2d981,1,"blossom");
          const grow=0.84+n*0.22;
          solid("shrub", -0.19, 0.40, height+0.10, 0.57, 0.29, 0.59, leafDark, n);
          solid("shrub", 0.20, 0.40, height+0.15, 0.49, 0.33, 0.57, accent, -n);
          if(n>0.57) {
            solid("cone", -0.08, 0.49, height+0.28, 0.27, 0.68*grow, 0.27, secondary);
            solid("column", 0.11, 0.48, height+0.49, 0.10, 0.34, 0.11, secondary, 0,-0.36);
            solid("leafball", -0.22, 0.48, height+0.74*grow, 0.83, 0.53, 0.75, leafDark, 0.13,0,true);
            solid("leafball", 0.17, 0.52, height+0.91*grow, 0.84, 0.63, 0.82, accent, -0.12,0,true);
            solid("leafball", -0.21, 0.39, height+1.03*grow, 0.69, 0.46, 0.65, leafLight, 0.21,0,true);
            solid("leafball", 0.24, 0.27, height+0.81*grow, 0.59, 0.41, 0.49, accent, -0.19);
            if(n>0.83) for(let k=0;k<4;k++) solid("bud", -0.23+k*0.12, 0.23, height+0.71+(k%2)*0.12, 0.09, 0.055, 0.09, blossom);
            landmark("leafy-tree");
          } else if(n>0.30) {
            solid("shrub", -0.16, 0.40, height+0.32, 0.59, 0.38, 0.60, leafLight,n);
            solid("shrub", 0.17, 0.26, height+0.24, 0.46, 0.33, 0.44, accent,-n);
            for(let k=0;k<3;k++) solid("bud", -0.20+k*0.17, 0.21, height+0.35+(k%2)*0.09, 0.075, 0.045, 0.08, blossom);
            landmark("flowering-shrub");
          } else {
            solid("rock", -0.17, 0.39, height+0.15, 0.42, 0.38, 0.55, stone,n*2);
            solid("rock", 0.16, 0.41, height+0.07, 0.31, 0.21, 0.36, stone,-n);
          }
        } else if (env.form === "karst") {
          solid("round", -0.17, 0.42, height*0.72, 0.74, height*1.03, 0.73, stone, n);
          solid("round", 0.22, 0.43, height*0.94, 0.52, 0.43, 0.65, secondary, -n);
          if(n>0.76) {
            solid("cone", -0.15, 0.45, height+0.23, 0.35, 0.85, 0.38, secondary);
            solid("cone", 0.22, 0.39, height+0.05, 0.22, 0.41, 0.28, stone);
            landmark("dripstone-grotto");
          } else if(n>0.42) {
            for(let k=0;k<3;k++) {
              solid("column", -0.24+k*0.20, 0.27, 0.24+k*0.09, 0.06, 0.21, 0.07, secondary);
              solid("round", -0.24+k*0.20, 0.24, 0.35+k*0.09, 0.26+k*0.03, 0.105, 0.26, k%2?accent:detail);
            }
            landmark("mushroom-garden");
          }
        } else if (env.form === "broken-masonry") {
          // A low ruined wall with occasional columns, fallen blocks and ivy.
          for(let k=0;k<2;k++) solid("box", -0.22+k*0.45, 0.38, height+0.09, 0.43, 0.18+n*0.12, 0.61, k?secondary:stone,(n-0.5)*0.06);
          if(n>0.77) {
            solid("box", -0.12, 0.42, height+0.27, 0.53, 0.19, 0.58, secondary);
            solid("column", -0.12, 0.40, height+0.49, 0.32, 0.71, 0.33, stone);
            solid("column", -0.12, 0.40, height+0.78, 0.38, 0.13, 0.38, secondary);
            solid("box", -0.12, 0.42, height+0.89, 0.53, 0.12, 0.47, secondary,0.06);
            landmark("broken-column");
          } else if(n>0.40) solid("box", 0.12, 0.42, height+0.29, 0.57, 0.18, 0.47, secondary,(n-0.5)*0.7);
          if(n<0.34) for(let k=0;k<3;k++) solid("leafball", -0.22+k*0.19, 0.17, height+0.10-k*0.07, 0.30, 0.18, 0.24, accent,n);
        } else if (env.form === "timber-bays") {
          // A continuous cottage wall, with deep framing only at structural bays.
          for(let k=0;k<4;k++) solid("box", 0, 0.30, 0.15+k*0.235, 0.99, 0.22, 0.40, k%2?stone:accent);
          solid("box", 0, 0.26, 1.09, 0.99, 0.15, 0.42, secondary);
          if((wallX+wallY)%3===0) {
            solid("box", 0, 0.16, 0.56, 0.18, 1.16, 0.29, secondary);
            solid("box", 0.20, 0.16, 0.87, 0.11, 0.49, 0.16, secondary,0,-0.70);
            landmark("timber-frame");
          } else if(n>0.65) {
            solid("box", 0, 0.095, 0.67, 0.57, 0.55, 0.13, secondary);
            solid("box", 0, 0.028, 0.69, 0.43, 0.40, 0.027, detail);
            solid("box", 0, 0.045, 0.68, 0.045, 0.47, 0.048, accent);
            solid("box", 0, 0.044, 0.68, 0.48, 0.042, 0.048, accent);
            solid("box", 0, 0.17, 0.38, 0.69, 0.10, 0.28, secondary);
          }
          if(n<0.17) {
            solid("column", 0.21, 0.22, 0.22, 0.30, 0.37, 0.31, secondary);
            solid("leafball", 0.20, 0.23, 0.46, 0.41, 0.31, 0.41, foliage);
          }
        } else if (env.form === "service-bays") {
          solid("box", 0, 0.42, 0.58, 0.99, 1.04, 0.71, stone);
          solid("box", 0, 0.20, 0.11, 0.99, 0.18, 0.34, secondary);
          if(n>0.77) {
            solid("box", -0.09, 0.20, 0.64, 0.62, 0.96, 0.33, secondary);
            solid("box", -0.09, 0.024, 0.79, 0.43, 0.38, 0.036, detail);
            for(let k=0;k<3;k++) solid("box", -0.09, 0.038, 0.34+k*0.08, 0.40, 0.035, 0.04, stone);
            solid("box", 0.20, 0.027, 0.83, 0.065, 0.08, 0.04, accent);
            landmark("vent-cabinet");
          } else if((wallX+wallY)%3!==0) {
            solid("box", 0, 0.11, 0.69, 0.79, 0.54, 0.14, secondary);
            solid("box", 0, 0.027, 0.71, 0.69, 0.43, 0.026, detail);
            solid("box", 0.24, 0.044, 0.71, 0.035, 0.47, 0.036, stone);
          } else {
            solid("box", 0, 0.12, 0.34, 0.55, 0.28, 0.20, accent);
            solid("leafball", -0.11, 0.17, 0.59, 0.35, 0.41, 0.30, foliage);
            solid("leafball", 0.15, 0.18, 0.55, 0.30, 0.29, 0.28, foliage);
          }
        } else if (env.form === "utility-stacks") {
          solid("box", 0, 0.45, 0.52, 0.99, 0.92, 0.78, secondary);
          solid("box", 0, 0.25, 0.19, 0.99, 0.18, 0.41, stone);
          if(n>0.64) {
            solid("box", -0.20, 0.35, 0.75+n*0.09, 0.40, 1.30+n*0.12, 0.61, stone);
            solid("box", 0.23, 0.36, 0.65, 0.42, 1.07, 0.59, secondary);
            solid("box", -0.19, 0.025, 0.93, 0.28, 0.34, 0.027, detail);
            for(let k=0;k<3;k++) solid("box", -0.19, 0.02, 0.83+k*0.075, 0.20-k*0.025, 0.035, 0.023, accent);
            solid("column", 0.29, 0.10, 0.79, 0.095, 0.63, 0.10, accent);
            landmark("neon-stack");
          } else if(n>0.29) {
            solid("box", 0, 0.086, 0.69, 0.70, 0.53, 0.10, stone);
            solid("box", 0, 0.020, 0.70, 0.59, 0.41, 0.024, accent);
            for(let k=0;k<3;k++) solid("box", -0.12+k*0.13, 0.018, 0.66, 0.075, 0.12+k*0.065, 0.020, secondary);
          } else {
            for(let k=0;k<2;k++) solid("column", -0.18+k*0.31, 0.18, 0.70, 0.15, 0.81, 0.16, stone);
            solid("box", 0, 0.12, 0.52, 0.63, 0.16, 0.12, detail);
          }
        } else if (env.form === "pressure-shells") {
          // Continuous laboratory shell with occasional pods and planted alcoves.
          solid("box", 0, 0.46, 0.56, 0.99, 0.90, 0.77, stone);
          solid("box", 0, 0.25, 0.14, 0.99, 0.16, 0.42, secondary);
          if(n>0.73) {
            solid("column", 0, 0.43, 0.22, 0.78, 0.25, 0.78, secondary);
            solid("round", 0, 0.43, 0.76, 0.81, 1.02, 0.80, stone);
            for(const d of [-1,1]) solid("round", d*0.28, 0.30, 0.70, 0.14, 0.75, 0.31, secondary);
            solid("box", 0, 0.04, 0.72, 0.32, 0.40, 0.05, accent);
            solid("box", 0, 0.018, 0.83, 0.21, 0.07, 0.021, detail);
            landmark("pressure-pod");
          } else if(n>0.25) {
            solid("box", 0, 0.10, 0.66, 0.72, 0.46, 0.15, secondary);
            solid("box", 0, 0.022, 0.68, 0.60, 0.34, 0.03, accent);
            for(let k=0;k<3;k++) solid("box", -0.15+k*0.15, 0.018, 0.67, 0.08, 0.15-k*0.025, 0.021, detail);
          } else {
            solid("box", 0, 0.17, 0.33, 0.62, 0.23, 0.26, secondary);
            solid("leafball", -0.14, 0.24, 0.63, 0.37, 0.43, 0.36, foliage);
            solid("leafball", 0.18, 0.23, 0.58, 0.30, 0.32, 0.30, foliage);
          }
        }
      }
      // Only low, non-blocking surface detail along wide room margins. The
      // tile centre, every corridor and the stairs/spawn neighbourhood stay clear.
      const reserved = [map.stairs, map.playerSpawn].some(p => p && Math.abs(p.x - floorX) + Math.abs(p.y - floorY) <= 1);
      const corridor = !isRoom(map, floorX, floorY) || (isWall(map, floorX - 1, floorY) && isWall(map, floorX + 1, floorY)) || (isWall(map, floorX, floorY - 1) && isWall(map, floorX, floorY + 1));
      if (!reserved && !corridor && n > 0.78 && env.form !== "rootbank") {
        const material = metaFor(floorX, floorY, env.form === "karst" ? env.accent : env.secondary, 0.84);
        const natural = env.relief > 0;
        addSolid(surfaces, natural ? "round" : "box", [cx + nx * 0.095, 0.006, cz + nz * 0.095], [0.68, env.form === "karst" ? 0.013 : 0.027, 0.16], rotation, material);
      }
    }

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isFloor(map, x, y)) {
      if (isWall(map, x, y - 1)) facade(x, y, x + 1, y, x, y - 1, x, y);
      if (isWall(map, x + 1, y)) facade(x + 1, y, x + 1, y + 1, x + 1, y, x, y);
      if (isWall(map, x, y + 1)) facade(x + 1, y + 1, x, y + 1, x, y + 1, x, y);
      if (isWall(map, x - 1, y)) facade(x, y + 1, x, y, x - 1, y, x, y);
    }
    // Restrained low relief at natural room edges only; texture carries the
    // walkable material everywhere, leaving actors and items the visual priority.
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!isFloor(map,x,y) || !isRoom(map,x,y)) continue;
      if ([map.stairs,map.playerSpawn].some(p=>p && Math.abs(p.x-x)+Math.abs(p.y-y)<=1)) continue;
      const n=hash01(x*41+13,y*29+7), edge=isWall(map,x-1,y)||isWall(map,x+1,y)||isWall(map,x,y-1)||isWall(map,x,y+1);
      const base=(floorH(x,y,map)+floorH(x+1,y+1,map))/2;
      if(env.form==="rootbank" && edge && n>0.42) {
        for(let k=0;k<3;k++) {
          const color=k===2 ? (n>0.7?0xf2ca87:0xecc2d6) : env.accent;
          const material=metaFor(x,y,color,1,k===2?"blossom":"foliage");
          addSolid(surfaces,"bud",[x-0.26+k*0.24,base+0.001,y+(n-0.5)*0.5],[0.23,0.026,0.17],[0,n*4+k,0],material);
        }
      } else if(env.form==="karst" && edge && n>0.55) {
        const material=metaFor(x,y,env.accent,1,"water");
        addSolid(surfaces,"round",[x,base+0.002,y],[0.74,0.013,0.58],[0,n*3,0],material);
      } else if(env.form==="broken-masonry" && edge && n>0.73) {
        const material=metaFor(x,y,env.secondary,1,"stone");
        addSolid(surfaces,"box",[x,base+0.002,y],[0.47,0.023,0.36],[0,n*0.6,0],material);
      } else if(["service-bays","pressure-shells","utility-stacks"].includes(env.form) && n>0.95) {
        const material=metaFor(x,y,env.secondary,1,"metal");
        addSolid(surfaces,"box",[x,base+0.001,y],[0.37,0.012,0.31],[0,0,0],material);
      } else if(env.form==="timber-bays" && edge && n>0.94) {
        const material=metaFor(x,y,env.secondary,1,"wood");
        addSolid(surfaces,"box",[x,base+0.001,y],[0.48,0.012,0.12],[0,n*0.6,0],material);
      } else if(env.form==="strata" && edge && n>0.76) {
        const material=metaFor(x,y,env.secondary,1,"stone");
        addSolid(surfaces,"round",[x+0.11,base+0.001,y-0.12],[0.24,0.025,0.17],[0,n*2,0],material);
      }
    }
    // Close exposed backs of the thin cutaway shell, including map boundaries.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isWall(map, x, y) && nearFloor(x, y)) {
      for (const e of [[x,y,x+1,y,0,-1],[x+1,y,x+1,y+1,1,0],[x+1,y+1,x,y+1,0,1],[x,y+1,x,y,-1,0]]) {
        if (inMap(map, x + e[4], y + e[5]) && (!isWall(map, x + e[4], y + e[5]) || nearFloor(x + e[4], y + e[5]))) continue;
        const b = W(wallVar(x,y)), a = wallPosition(e[0],e[1]), c = wallPosition(e[2],e[3]);
        const meta = { kind: "wall", cells: [{x,y,room:false}], tone: 0.65 };
        const ids = [{x:a.x,y:-0.08,z:a.z},{x:c.x,y:-0.08,z:c.z},c,a].map(p=>b.vert(p.x,p.y,p.z,p.x*UV_SCALE,p.z*UV_SCALE,meta));
        b.quad(...ids);
      }
    }
    function mesh(builder, name, texture, shiny) {
      if (!builder.idx.length) return null;
      const material = caveMat(texture, th);
      if (!texture) { material.specular.setHex(shiny ? 0x667b80 : 0x151b20); material.shininess = shiny ? 40 : 7; }
      const m = builder.toMesh(material); m.name = name; m.userData.environmentForm = env.form;
      scene.add(m); return m;
    }
    floorMesh = mesh(fb, "dungeon-floor", dirtTex); floorMeta = fb.meta;
    floorMeshB = mesh(fbB, "dungeon-floor-secondary", dirtTexB); floorMetaB = fbB.meta;
    wallMesh = mesh(wb, "dungeon-wall", rockTex); wallMeta = wb.meta;
    wallMeshB = mesh(wbB, "dungeon-wall-secondary", rockTexB); wallMetaB = wbB.meta;
    environmentMesh = mesh(structures, "dungeon-environment-volumes", volumeAtlas()); environmentMeta = structures.meta;
    surfaceMesh = mesh(surfaces, "dungeon-surface-inlays", volumeAtlas(), env.form === "karst"); surfaceMeta = surfaces.meta;
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
    // Environment is made of lit volumes. Only the actionable exit is an
    // outlined billboard, keeping its visual priority alongside actors/items.
    if (map.stairs) addDeco("stairs", map.stairs.x * S, map.stairs.y * S, map.stairs.x, map.stairs.y);
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
    if (meta.surfaceColor) return tmpColor.copy(meta.surfaceColor).multiplyScalar((vis ? 1 : 0.18) * (meta.tone == null ? 1 : meta.tone));
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
      const tone = meta[i].surfaceColor ? 1 : (meta[i].tone == null ? 1 : meta[i].tone);
      arr[i * 3] = c.r * tone;
      arr[i * 3 + 1] = c.g * tone;
      arr[i * 3 + 2] = c.b * tone;
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
    paintMeshColors(environmentMesh, environmentMeta, state);
    paintMeshColors(surfaceMesh, surfaceMeta, state);
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
      const pull = paper.userData.kind === "item" ? 0.18 : 0.25;
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
    if (reducedMotion()) { vis.x = vis.toX; vis.z = vis.toZ; return 0; }
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
      const bob = reducedMotion() ? 0 : name === "bat" ? Math.sin(now * 0.008 + actor.x) * 0.06 + 0.12 : Math.sin(now * 0.003 + actor.x) * 0.015;
      const clear = wallClearance(state.map, actor.x, actor.y);
      vis.group.position.set(vis.x + clear.x, 0, vis.z + clear.z);
      const paper = vis.group.userData.paper;
      billboard(paper, 0.03 + hop + bob);
      // Rotate about the feet, like a sticker nudged by a fingertip, never a 3D turn.
      const elapsed = now - (actor.animT0 || 0);
      const action = !reducedMotion() && elapsed >= 0 && elapsed < 260;
      const tap = action ? Math.sin(Math.PI * elapsed / 260) : 0;
      if (actor.anim === "attack") paper.rotateZ(-0.06 * tap);
      else if (actor.anim === "defend") paper.rotateZ(0.045 * tap);
      vis.group.userData.shadow.material.opacity = name === "bat" ? 0.2 : 0.28 - hop * 0.35;
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
    if (MD.isGameplayInputBlocked && MD.isGameplayInputBlocked()) return true;
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
    } else if (reducedMotion()) {
      lookCurrent.set(tx, 0, tz);
    } else {
      lookCurrent.x += (tx - lookCurrent.x) * 0.14;
      lookCurrent.z += (tz - lookCurrent.z) * 0.14;
    }
    applyOrbit();
    if (playerLight) {
      playerLight.position.set(tx, 1.4, tz);
      const rid = state.map ? MD.getRoomId(state.map, p.x, p.y) : -1;
      const inRoom = rid != null && rid >= 0;
      playerLight.color.set(currentTheme && currentTheme.lightColor || (inRoom ? 0xffe8b8 : 0xc8e0f0));
      playerLight.intensity = inRoom ? 0.45 : 0.35;
      playerLight.distance = inRoom ? 7 : 4.2;
    }
    if (hemi) {
      hemi.color.set(currentTheme && currentTheme.hemiSky || 0xfff0d8);
      hemi.groundColor.set(currentTheme && currentTheme.hemiGround || 0xa8c8b8);
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
    if (e.defaultPrevented) return;
    const target = e.target;
    if (target && (target.isContentEditable || (target.closest && target.closest("button,a,select,input,textarea,[contenteditable]")))) return;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, global.innerWidth < 700 ? 1.5 : 2));
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

    hemi = new THREE.HemisphereLight(0xfff9e9, 0xa8c8b8, 1.02);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff4df, 1.12);
    dir.position.set(10, 16, 12);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xd2ecff, 0.38);
    fill.position.set(-8, 6, -4);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xfff7e8, 0.42));

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

  // Snapshot-only diagnostics for GPU acceptance tests; no mutable scene or
  // gameplay references escape this renderer and nothing runs per animation frame.
  function getEnvironmentInfo() {
    const meshes = [floorMesh, floorMeshB, wallMesh, wallMeshB, environmentMesh, surfaceMesh].filter(Boolean);
    let vertices = 0, triangles = 0, signature = 2166136261;
    for (const mesh of meshes) {
      const position = mesh.geometry.attributes.position;
      vertices += position.count;
      triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
      for (const value of position.array) signature = Math.imul(signature ^ Math.round(value * 10000), 16777619);
    }
    return Object.freeze({
      themeId: currentTheme && currentTheme.id,
      form: currentTheme && currentTheme.environment.form,
      meshNames: Object.freeze(meshes.map(mesh => mesh.name)),
      meshCount: meshes.length, vertices, triangles,
      geometrySignature: (signature >>> 0).toString(16),
      landmarkKinds: Object.freeze(Object.keys(environmentStats.landmarkCounts).sort()),
      landmarkCounts: Object.freeze({ ...environmentStats.landmarkCounts }),
      primitiveCounts: Object.freeze({ ...environmentStats.primitiveCounts }),
      outlineMeshCount: scene ? scene.children.filter(node => node.name === "dungeon-paper-details" || node.name === "dungeon-theme-edge" || node.isLineSegments).length : 0,
    });
  }

  MD.view3d = {
    init: init,
    sync: sync,
    render: render,
    resize: resize,
    pickTile: pickTile,
    screenToTileDir: screenToTileDir,
    getYaw: getYaw,
    getEnvironmentInfo: getEnvironmentInfo,
    setTheme: setTheme,
    active: false,
  };
})(typeof window !== "undefined" ? window : globalThis);
