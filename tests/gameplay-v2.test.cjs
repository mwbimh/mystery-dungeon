'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');

function element(id = '') {
  const el = { id, tagName: 'DIV', style: {}, dataset: {}, children: [], listeners: {}, value: '', textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); },
    removeEventListener() {}, removeAttribute() {}, setAttribute() {}, focus() {},
    querySelectorAll() { return []; }, querySelector() { return element(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 40, height: 40 }; },
    getContext() { return {}; },
  };
  const classes = new Set(['hidden']);
  el.classList = { add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); }, contains(name) { return classes.has(name); }, toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); } };
  Object.defineProperty(el, 'innerHTML', { set() { this.children = []; }, get() { return ''; } });
  return el;
}
const plain = value => JSON.parse(JSON.stringify(value));
function harness(options = {}) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); };
  const document = { getElementById: get, createElement: () => element(), querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const rules = { maxBag: 7, activeSlots: 2, passiveSlots: 1, maxActiveSlots: 4, maxPassiveSlots: 3,
    maxMonsters: 20, houseItems: { min: 0, max: 0 }, floorItems: { min: 0, max: 0 }, houseTriggerItems: { min: 0, max: 0 },
    housePreEnemyMax: 0, housePreEnemyAreaDivisor: 12, houseEnemyMin: 5, houseEnemyMax: 10, houseEnemyAreaDivisor: 4,
    floorEnemySoftMax: 0, floorEnemyBase: 0, floorEnemyEvery: 3, floorEnemyEmptyReserve: 5,
    roomEnemyChance: 0, hungerEvery: 1000, starvationDamage: 1, starvationLogEvery: 3, regenEvery: 1000, regenAmount: 1,
    hungerWarning: 20, hungerCritical: 10, wandererEvery: 1000, idleMoveChance: 0, enemyScale: 1 };
  const effect = (kind, fields = {}) => ({ kind, power: 0, turnsMin: 0, turnsMax: 0, range: 0, wallDamage: 0, ...fields });
  const item = (id, fields = {}) => ({ name: id, nameKey: id, color: '#fff', useEffectId: 'none', throwEffectId: 'none', swingEffectId: 'none', chargesMin: 0, chargesMax: 0, activeSkill: 0, passiveSkill: 0, dropOnMiss: 1, ...fields });
  const items = {
    pear: item('pear', { useEffectId: 'food', throwEffectId: 'damage', passiveSkill: 1 }),
    pebble: item('pebble', { throwEffectId: 'damage', activeSkill: 1 }),
    poppy: item('poppy', { useEffectId: 'sleep', throwEffectId: 'sleepShot' }),
    lantern: item('lantern', { swingEffectId: 'damageShot', throwEffectId: 'knock', chargesMin: 2, chargesMax: 2, activeSkill: 1 }),
    hollow: item('hollow', { throwEffectId: 'damage', dropOnMiss: 0 }),
  };
  const dungeons = { original: { id: 'original', nameKey: 'first', totalFloors: 2 }, grove: { id: 'grove', nameKey: 'second', totalFloors: 1 } };
  const config = { version: 2, rules, player: { hp: 30, atk: 7, def: 2, belly: 100 }, effects: { bellyCap: 200, bellyGrowth: 5, damageRoll: { min: -1, max: 1 } }, items, dungeons,
    enemies: { moss: { nameKey: 'moss', hp: 50, atk: 0, def: 0, glyph: 'm', color: '#aaa', behaviorTemplate: 'chase' } },
    itemEffects: { food: effect('food', { power: 30 }), damage: effect('damage', { power: 7, range: 2 }), sleep: effect('sleep', { turnsMin: 6, turnsMax: 6 }), sleepShot: effect('sleep', { turnsMin: 6, turnsMax: 6, range: 4 }), damageShot: effect('damage', { power: 11, range: 6 }), knock: effect('knockback', { range: 4, wallDamage: 13 }) } };
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  freeze(config);
  const storage = new Map();
  let rolls = 0;
  let MD = { config, dungeonId: 'original', t: (key, params = {}) => key + Object.values(params).join(' '),
    random: () => { rolls++; return .2; }, weightedPick: entries => entries[0].id,
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    floorConfig(floor) { const dungeon = dungeons[this.dungeonId]; return { dungeon, rules: this.dungeonId === "grove" ? { ...rules, ...options.groveRules } : rules, map: {}, themeId: 'forest', itemEntries: [{ id: this.dungeonId === 'original' ? 'pear' : 'poppy', weight: 1 }] }; },
    selectDungeon(id) { if (this.canSelectDungeon && !this.canSelectDungeon()) throw new Error('Return to town first'); this.dungeonId = id; this.storage.setItem('md-expedition-v1', JSON.stringify({ dungeonId: id })); },
    TILE: { WALL: 0, FLOOR: 1, STAIRS: 2 }, key: (x, y) => `${x},${y}`,
    randInt(min, max) { return Math.floor(this.random() * (max - min + 1)) + min; }, shuffle: list => list,
    themeForFloor: () => ({ id: 'forest' }), THEMES: [],
    generateFloor() { const tiles = Array.from({ length: 7 }, (_, y) => Array.from({ length: 12 }, (_, x) => x === 0 || y === 0 || x === 11 || y === 6 ? 0 : 1)); tiles[5][10] = 2;
      return { width: 12, height: 7, tiles, roomIds: tiles.map(row => row.map(() => 0)), rooms: [{ id: 0, w: 10, h: 5 }], spawnRoomId: 0, playerSpawn: { x: 2, y: 3 }, stairs: { x: 10, y: 5 }, monsterHouseRooms: [] }; },
    isWalkable: (map, x, y) => (map.tiles[y]?.[x] ?? 0) !== 0,
    canStep: (map, x, y, dx, dy) => (map.tiles[y + dy]?.[x + dx] ?? 0) !== 0,
    getRoomId: () => 0, computeVisible: () => new Set(), canSee: () => false, pickEnemyType: () => 'moss', updateSidePanel() {},
  };
  const windowEvents = {};
  const timers = new Map(); let timer = 0;
  const sandbox = { MD, document, console, URLSearchParams, TextEncoder, localStorage: MD.storage,
    fetch: async file => ({ ok: true, text: async () => fs.readFileSync(path.join(ROOT, options.fixture && file === 'config/game.json' ? 'tests/fixtures/default-config-v2.json' : file), 'utf8') }),
    location: { search: options.query || '?flat=1' }, performance: { now: () => 0 },
    requestAnimationFrame() {}, setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(event, fn) { windowEvents[event] = fn; }, devicePixelRatio: 1 };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  function finishLoad() {
  for (const file of ['js/actors.js', 'js/items.js', 'js/game.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  const state = context.MD_STATE;
  function key(key, fields = {}) { windowEvents.keydown({ key, code: key, target: null, preventDefault() {}, ...fields }); }
  function start() { get('btnNewRun').onclick(); }
  function inventoryItem(id, slot = 0) { state.bag[slot] = MD.makeItem(id); get('btnInv').onclick(); const node = get('invGrid').children[slot]; node.listeners.click[0](); return state.bag[slot]; }
  function action(id, actionIndex, direction) { const item = inventoryItem(id); get('invActions').children[actionIndex].onclick(); if (direction) key(direction); return item; }
  function enemy(x, y) { const e = MD.makeEnemy('moss', x, y); state.enemies.push(e); return e; }
  return { MD, state, get, key, start, action, inventoryItem, enemy, storage, timers, rolls: () => rolls };
  }
  if (options.generated) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'), context);
    return context.MDConfig.boot().then(() => {
      MD = context.MD;
      for (const file of ['js/themes.js', 'js/map.js', 'js/fov.js', 'js/ui.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
      return finishLoad();
    });
  }
  return finishLoad();
}

test('v2 arbitrary item definitions derive verbs, charges, floor pools and immutable source', () => {
  const { MD } = harness();
  assert.deepEqual(plain(MD.ITEM_DEFS.pear.verbs), ['eat', 'throw']);
  assert.deepEqual(plain(MD.ITEM_DEFS.lantern.verbs), ['swing', 'throw']);
  assert.equal(MD.makeItem('lantern').charges, 2);
  assert.equal(MD.itemEffect('pear', 'use').power, 30);
  assert.equal(MD.itemEffect({ type: 'pear' }, 'swing'), null);
  assert.equal(MD.randomFloorItem(1).type, 'pear');
  MD.selectDungeon('grove');
  assert.equal(MD.randomFloorItem(1).type, 'poppy');
  assert.ok(Object.isFrozen(MD.config.items.pear));
  assert.equal(MD.config.items.pear.verbs, undefined);
});

test('v2 food and sleep use work for new IDs with configured power and duration', () => {
  const h = harness(); h.start();
  h.state.player.belly = 35;
  h.action('pear', 0);
  assert.equal(h.state.player.belly, 65);
  assert.equal(h.state.bag[0], null);
  h.action('poppy', 0);
  assert.equal(h.state.player.statuses[0].type, 'sleep');
  assert.equal(h.state.player.statuses[0].turns, 5);
});

test('v2 ranged damage uses action range; drop-on-miss preserves default RNG order', () => {
  const h = harness(); h.start();
  const target = h.enemy(4, 3);
  h.action('pebble', 0, 'Numpad6');
  assert.equal(target.hp, 43);
  h.state.enemies = [];
  const before = h.rolls();
  h.action('pebble', 0, 'Numpad6');
  assert.equal(h.state.items.at(-1).x, 4);
  assert.equal(h.state.items.at(-1).type, 'pebble');
  assert.equal(h.rolls() - before, 2); // make item + legacy miss identity
  h.action('hollow', 0, 'Numpad4');
  assert.equal(h.state.items.length, 1);
});

test('v2 swing consumes charges and chooses configured effect rather than item ID', () => {
  const h = harness(); h.start();
  const target = h.enemy(7, 3);
  const lantern = h.action('lantern', 1, 'Numpad6'); // throw then swing inventory action order
  assert.equal(target.hp, 39);
  assert.equal(lantern.charges, 1);
  assert.equal(h.state.bag[0], lantern);
});

test('v2 thrown knockback uses per-effect wall damage', () => {
  const h = harness(); h.start();
  const target = h.enemy(4, 3);
  h.action('lantern', 0, 'Numpad6');
  assert.equal(target.x, 10);
  assert.equal(target.hp, 37);
});

test('v2 skill eligibility accepts arbitrary active and passive IDs', () => {
  const h = harness(); h.start();
  h.inventoryItem('pebble');
  const active = h.get('skillActiveRow').children[0];
  active.listeners.drop[0]({ preventDefault() {}, stopPropagation() {}, dataTransfer: { getData: () => '0' } });
  assert.equal(h.state.skills.active[0].type, 'pebble');
  assert.equal(h.state.bag[0], null);
  h.get('btnInv').onclick();
  h.inventoryItem('pear');
  const passive = h.get('skillPassiveRow').children[0];
  passive.listeners.drop[0]({ preventDefault() {}, stopPropagation() {}, dataTransfer: { getData: () => '0' } });
  assert.equal(h.state.skills.passive[0].type, 'pear');
});

test('v2 dungeon choice is town-only; repeated starts and reset cannot leak floor state', () => {
  const h = harness();
  const select = h.get('dungeonSelect');
  select.value = 'grove'; select.listeners.change[0]();
  h.start();
  const oldMap = h.state.map;
  assert.equal(h.state.dungeonId, 'grove');
  assert.equal(select.disabled, true);
  assert.equal(h.state.bag.length, 7);
  assert.throws(() => h.MD.selectDungeon('original'), /Return to town/);
  h.start();
  assert.equal(h.state.map, oldMap);
  h.state.endKind = 'clear'; h.get('btnEndOk').onclick();
  assert.equal(h.state.mode, 'town');
  assert.equal(h.state.map, null);
  assert.equal(h.state.floor, 0);
  assert.equal(h.state.turn, 0);
  assert.equal(h.state.floorConfig, null);
  assert.equal(h.state.enemies.length, 0);
  select.value = 'original'; select.listeners.change[0]();
  h.start();
  assert.equal(h.state.dungeonId, 'original');
  assert.notEqual(h.state.map, oldMap);
  assert.equal(h.state.floor, 1);
  assert.equal(h.state.endKind, null);
});

test('v2 warehouse preserves IDs/charges and original storage key', () => {
  const h = harness();
  h.storage.set('md_warehouse_v1', JSON.stringify([{ type: 'lantern', uid: 'old', charges: 1, name: 'Old name' }, { type: 'retired', name: 'Historical item' }]));
  const loaded = h.MD.loadWarehouse();
  assert.equal(loaded[0].charges, 1);
  assert.equal(loaded[0].uid, 'old');
  assert.equal(loaded[0].name, h.MD.displayName(loaded[0]));
  h.MD.saveWarehouse(loaded);
  assert.equal(JSON.parse(h.storage.get('md_warehouse_v1'))[1].type, 'retired');
});


test('v2 selected dungeon length controls exit and original dungeon advances floors', () => {
  const h = harness();
  h.MD.selectDungeon('grove'); h.start();
  h.state.player.x = h.state.map.stairs.x;
  h.state.player.y = h.state.map.stairs.y;
  h.key(' ');
  for (const fn of h.timers.values()) fn(); h.timers.clear();
  assert.equal(h.state.endKind, 'clear');
  h.get('btnEndOk').onclick();
  h.MD.selectDungeon('original'); h.start();
  h.state.player.x = h.state.map.stairs.x;
  h.state.player.y = h.state.map.stairs.y;
  h.key(' ');
  for (const fn of h.timers.values()) fn(); h.timers.clear();
  assert.equal(h.state.floor, 2);
  assert.equal(h.state.endKind, null);
});

test('v2 per-dungeon rules control hunger, regeneration and warning thresholds', () => {
  const h = harness({ groveRules: { hungerEvery: 1, regenEvery: 1, regenAmount: 4, hungerWarning: 70, hungerCritical: 30 } });
  h.MD.selectDungeon('grove'); h.start();
  h.state.player.hp = 10; h.state.player.belly = 70;
  h.key(' ');
  assert.equal(h.state.player.hp, 14);
  assert.equal(h.state.player.belly, 69);
  assert.equal(h.state.lastBellyWarn, 70);
  assert.equal(h.get('barBelly').classList.contains('low'), true);
  assert.equal(h.MD.config.rules.hungerEvery, 1000);
});

test('v2 town inventory actions cannot consume items or create stale aiming state', () => {
  const h = harness();
  const pear = h.inventoryItem('pear');
  h.get('invActions').children[0].onclick();
  h.get('invActions').children[1].onclick();
  assert.equal(h.state.bag[0], pear);
  assert.equal(h.state.aiming, null);
  assert.equal(h.state.player, null);
});


test('v2 generated configuration boots actual modules, selects dungeons and spawns configured content', async () => {
  const h = await harness({ generated: true, query: '?flat=1&lang=en' });
  const select = h.get('dungeonSelect');
  assert.equal(select.children.length, Object.keys(h.MD.config.dungeons).length);
  select.value = 'trainingGrove'; select.listeners.change[0]();
  assert.equal(h.MD.dungeonId, 'trainingGrove');
  assert.equal(JSON.parse(h.storage.get('md-expedition-v1')).dungeonId, 'trainingGrove');
  h.start();
  assert.equal(h.state.dungeonId, 'trainingGrove');
  assert.equal(h.state.floorConfig.dungeon.totalFloors, 3);
  assert.equal(h.state.map.width, 50);
  assert.equal(h.state.map.height, 30);
  assert.ok(h.state.items.length > 0);
  assert.ok(h.state.items.every(item => item.type === 'travelOnigiri'));
  assert.ok(h.state.enemies.length > 0);
  assert.ok(h.state.enemies.every(enemy => enemy.type === 'emberSlime'));
  assert.match(h.get('statDungeon').textContent, /Training Grove/);
  assert.throws(() => h.MD.selectDungeon('original'), /冒险中/);
  h.state.enemies = [];
  h.state.player.belly = 5;
  h.action('travelOnigiri', 0);
  assert.equal(h.state.player.belly, 80);
  h.state.endKind = 'clear'; h.get('btnEndOk').onclick();
  select.value = 'original'; select.listeners.change[0](); h.start();
  assert.equal(h.state.dungeonId, 'original');
  assert.equal(h.state.floorConfig.dungeon.totalFloors, 24);
});

test('v2 generated seeded previews repeat actual game state and isolate expedition storage', async () => {
  const options = { generated: true, query: '?flat=1&designer=1&seed=42&floor=3&dungeon=trainingGrove' };
  const first = await harness(options), second = await harness(options);
  const snapshot = h => plain({ map: h.state.map, items: h.state.items, enemies: h.state.enemies, player: h.state.player, floor: h.state.floor });
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.equal(first.state.floor, 3);
  assert.equal(first.state.mode, 'dungeon');
  assert.equal(first.storage.size, 0);
  first.MD.saveWarehouse([first.MD.makeItem('travelOnigiri')]);
  assert.equal(first.storage.size, 0);
});

// Captured with these same normalized fields from the unmodified ccd73c5 game,
// actor/item/map/theme/FOV/UI/config scripts and its original v1 workbook fixture.
for (const [floor, expected] of [
  [1, '7b4d67b9746470997381c60650e3ad973e1ea8bd77be362a02a7e4535616247c'],
  [4, 'b1d708f7ee95f5e4db6d85a32d320bf5c7f0883bbae80d55df945d17a2676fb4'],
]) {
  test(`v2 default full gameplay matches ccd73c5: seed 42 floor ${floor}`, async () => {
    const h = await harness({ generated: true, fixture: true, query: `?flat=1&designer=1&seed=42&floor=${floor}` });
    const s = h.state;
    const snapshot = {
      map: s.map,
      player: { x: s.player.x, y: s.player.y, hp: s.player.hp, belly: s.player.belly, statuses: s.player.statuses },
      items: s.items.map(({ type, x, y, uid, charges }) => ({ type, x, y, uid, charges })),
      enemies: s.enemies.map(({ type, x, y, hp, atk, def }) => ({ type, x, y, hp, atk, def })),
    };
    const hash = require('node:crypto').createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    assert.equal(hash, expected);
  });
}
