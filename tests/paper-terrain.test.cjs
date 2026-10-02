'use strict';
// These tests execute the renderer with real Three.js geometry and a mock
// WebGLRenderer/canvas. They verify geometry, FOV, lifecycle and input contracts;
// browser screenshots and GPU rendering are deliberately separate acceptance gates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');

function makeHarness({ compact = false } = {}) {
  let now = 1000, scene, camera, createdCanvases = 0, rngCalls = 0;
  const events = {}, renders = [];
  function canvas() {
    const calls = [];
    const context = new Proxy({ calls,
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      createRadialGradient() { return { addColorStop() {} }; },
    }, { get(target, key) { return key in target ? target[key] : (...args) => calls.push([key, ...args]); } });
    const node = { width: 800, height: 600, clientWidth: 800, clientHeight: 600, style: {}, events: {},
      getContext(kind) { return kind === '2d' ? context : {}; },
      addEventListener(type, listener) { (this.events[type] ||= []).push(listener); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
      setPointerCapture() {}, releasePointerCapture() {}, focus() {},
    };
    context.canvas = node;
    return node;
  }
  const context = vm.createContext({ console: { ...console, warn() {} }, Uint8ClampedArray,
    performance: { now: () => now }, innerWidth: compact ? 390 : 1280, devicePixelRatio: 3,
    document: { createElement(tag) { assert.equal(tag, 'canvas'); createdCanvases++; return canvas(); }, getElementById() { return null; }, querySelectorAll() { return []; } },
    addEventListener(type, fn) { (events[type] ||= []).push(fn); },
    MD: { settings: { reducedMotion: false }, config: { enemies: {}, items: {} }, TILE: { WALL: 0, FLOOR: 1, STAIRS: 2 },
      key: (x, y) => x + ',' + y, getRoomId: (map, x, y) => map.roomIds[y][x], random() { rngCalls++; throw new Error('visual code consumed gameplay RNG'); },
    },
  });
  context.window = context;
  const load = file => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  load('vendor/three.min.js');
  context.THREE.WebGLRenderer = class {
    constructor(options) { this.domElement = options.canvas; }
    getContext() { return {}; } setClearColor() {} setSize() {}
    setPixelRatio(value) { this.pixelRatio = value; }
    render(s, c) { scene = s; camera = c; renders.push({ scene: s, camera: c }); }
  };
  context.MD.sprites = { texture() { return new context.THREE.Texture(); }, worldSize() { return { w: 0.75, h: 0.9 }; } };
  load('js/themes.js'); load('js/view3d.js');
  const view = context.MD.view3d;
  assert.equal(view.init(canvas()), true);
  function draw(theme, state) { view.setTheme(theme); view.sync(state); view.render(); return scene; }
  return { context, MD: context.MD, view, canvas, draw, events, renders,
    setNow(value) { now = value; }, get scene() { return scene; }, get camera() { return camera; },
    get createdCanvases() { return createdCanvases; }, get rngCalls() { return rngCalls; },
  };
}

function stateFor(size = 9, debug = true) {
  const tiles = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x === 0 || y === 0 || x === size - 1 || y === size - 1 || x === 5 && y > 3) ? 0 : 1));
  tiles[2][size - 3] = 2;
  const roomIds = tiles.map(row => row.map(tile => tile ? 0 : -1));
  return { mode: 'dungeon', debug, map: { width: size, height: size, tiles, roomIds, stairs: { x: size - 3, y: 2 }, playerSpawn: { x: 2, y: 2 } },
    player: { x: 2, y: 2, kind: 'player', anim: 'idle', statuses: [] }, enemies: [], items: [], explored: new Set(), visible: new Set() };
}
function meshes(scene) { return scene.children.filter(node => node.isMesh && node.geometry); }
function player(scene) { return scene.children.flatMap(node => node.children).find(node => node.userData.paper && node.userData.name === 'player'); }

test('all eight paper themes produce finite real geometry, one merged detail mesh and no gameplay changes', () => {
  const h = makeHarness();
  for (const theme of h.MD.THEMES) {
    const state = stateFor(), before = JSON.stringify(state.map);
    const scene = h.draw(theme, state);
    assert.equal(JSON.stringify(state.map), before, theme.id + ' map');
    assert.equal(scene.children.filter(node => node.name === 'dungeon-paper-details').length, 1);
    for (const mesh of meshes(scene)) {
      for (const attr of Object.values(mesh.geometry.attributes)) for (const value of attr.array) assert.ok(Number.isFinite(value), theme.id + ' finite geometry');
    }
    const wall = scene.getObjectByName('dungeon-wall');
    assert.ok(wall.geometry.attributes.position.count > 100);
    const air = scene.children.filter(node => node.name === 'dungeon-air');
    assert.ok(air.every(group => group.children[0].geometry.attributes.position.count <= 48));
    const hemi = scene.children.find(node => node.isHemisphereLight);
    assert.equal(hemi.color.getHex(), theme.hemiSky, theme.id + ' camera retains sky');
    assert.equal(hemi.groundColor.getHex(), theme.hemiGround, theme.id + ' camera retains ground');
  }
  assert.equal(h.rngCalls, 0);
});

test('unexplored paper trim and neon edges obey FOV; remembered details remain subdued', () => {
  const h = makeHarness(), state = stateFor(9, false);
  const theme = h.MD.THEMES.find(theme => theme.id === 'cyber');
  const scene = h.draw(theme, state);
  const detail = scene.getObjectByName('dungeon-paper-details');
  const edge = scene.getObjectByName('dungeon-theme-edge');
  for (const mesh of [detail, edge]) {
    assert.ok(mesh);
    assert.ok(Math.max(...mesh.geometry.attributes.color.array) < 0.01, mesh.name + ' unseen');
  }
  for (let y = 0; y < state.map.height; y++) for (let x = 0; x < state.map.width; x++) state.explored.add(x + ',' + y);
  h.view.sync(state);
  const remembered = Math.max(...detail.geometry.attributes.color.array);
  state.debug = true;
  h.view.sync(state);
  const visible = Math.max(...detail.geometry.attributes.color.array);
  assert.ok(remembered > 0.01 && remembered < visible * 0.25);
});

test('paper layer geometry is deterministic and old geometry is disposed when changing floors', () => {
  const h = makeHarness(), theme = h.MD.THEMES[0];
  const scene = h.draw(theme, stateFor());
  const first = scene.getObjectByName('dungeon-paper-details');
  const positions = Array.from(first.geometry.attributes.position.array);
  let disposed = 0;
  first.geometry.addEventListener('dispose', () => disposed++);
  h.view.sync(stateFor()); h.view.render();
  assert.equal(disposed, 1);
  assert.deepEqual(Array.from(h.scene.getObjectByName('dungeon-paper-details').geometry.attributes.position.array), positions);
  h.view.sync({ mode: 'town' }); h.view.render();
  assert.equal(h.scene.getObjectByName('dungeon-paper-details'), undefined);
  assert.ok(h.scene.children.filter(node => node.name === 'dungeon-air').every(node => !node.visible));
});

test('reduced motion freezes ambient particles and sticker bob, then snaps a changed tile', () => {
  const h = makeHarness(), state = stateFor();
  const scene = h.draw(h.MD.THEMES.find(theme => theme.id === 'forest'), state);
  h.MD.settings.reducedMotion = true;
  h.view.sync(state);
  const actor = player(scene);
  const position = actor.userData.paper.position.clone();
  const air = scene.children.find(node => node.name === 'dungeon-air');
  const particles = Array.from(air.children[0].geometry.attributes.position.array);
  h.setNow(1600); h.view.sync(state);
  assert.deepEqual(actor.userData.paper.position.toArray(), position.toArray());
  assert.deepEqual(Array.from(air.children[0].geometry.attributes.position.array), particles);
  assert.equal(air.visible, false);
  state.player.x = 3; h.setNow(1700); h.view.sync(state);
  assert.equal(actor.position.x, 3);
  h.MD.settings.reducedMotion = false;
  h.setNow(1800); h.view.sync(state);
  assert.equal(air.visible, true);
});

test('mobile caps ambient counts, and Q/E ignores blocked, prevented and form-focused input', () => {
  const h = makeHarness({ compact: true });
  const scene = h.draw(h.MD.THEMES.find(theme => theme.id === 'cyber'), stateFor());
  assert.ok(scene.children.filter(node => node.name === 'dungeon-air').every(group => group.children[0].geometry.attributes.position.count <= 24));
  const initial = h.view.getYaw();
  const emit = extra => h.events.keydown.forEach(fn => fn({ key: 'q', preventDefault() {}, ...extra }));
  emit({ defaultPrevented: true }); assert.equal(h.view.getYaw(), initial);
  emit({ target: { isContentEditable: true } }); assert.equal(h.view.getYaw(), initial);
  emit({ target: { closest: () => ({ tagName: 'BUTTON' }) } }); assert.equal(h.view.getYaw(), initial);
  h.MD.isGameplayInputBlocked = () => true;
  emit({}); assert.equal(h.view.getYaw(), initial);
  h.MD.isGameplayInputBlocked = () => false;
  emit({}); assert.notEqual(h.view.getYaw(), initial);
});

test('2D theme painter is deterministic, caches tiny tiles and darkens memory without changing the map', () => {
  const h = makeHarness(), state = stateFor();
  const ctx = h.canvas().getContext('2d');
  for (const theme of h.MD.THEMES) {
    const tile = { map: state.map, x: 0, y: 2, px: 0, py: 56, size: 28, wall: true, room: false, inVis: true };
    const before = JSON.stringify(state.map);
    h.MD.paperTerrain.drawTile(ctx, theme, tile);
    const count = h.createdCanvases;
    h.MD.paperTerrain.drawTile(ctx, theme, tile);
    assert.equal(h.createdCanvases, count, theme.id + ' tile cache');
    h.MD.paperTerrain.drawTile(ctx, theme, { ...tile, inVis: false });
    assert.equal(ctx.fillStyle, 'rgba(12,17,26,0.76)');
    h.MD.paperTerrain.drawTile(ctx, theme, { ...tile, x: 2, wall: false, room: true });
    assert.equal(JSON.stringify(state.map), before);
  }
  assert.equal(h.rngCalls, 0);
});
