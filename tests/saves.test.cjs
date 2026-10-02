'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function setup(extra = {}) {
  const context = vm.createContext(Object.defineProperties({ console, TextEncoder, setTimeout, clearTimeout }, Object.getOwnPropertyDescriptors(extra)));
  for (const name of ['config', 'saves']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name + '.js'), 'utf8'), context);
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/default-config-v2.json'), 'utf8'));
  const MD = {}; context.MDConfig.installRuntime(MD, config); context.MD = MD;
  MD.random = context.MDConfig.seededRandom(7); MD.weightedPick = entries => context.MDConfig.weightedPick(entries, MD.random);
  for (const name of ['map', 'actors', 'items']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name + '.js'), 'utf8'), context);
  function snapshot(mode = 'town') {
    const skills = { active: Array(config.rules.activeSlots).fill(null), passive: Array(config.rules.passiveSlots).fill(null) };
    const s = { mode, dungeonId: MD.dungeonId, floor: 0, turn: 0, map: null, player: null, enemies: [], items: [], bag: Array(config.rules.maxBag).fill(null), skills,
      warehouse: [], explored: [], triggeredMH: [], log: [{ text: '欢迎。', cls: 'good' }], skillMeta: { active: skills.active.length, passive: skills.passive.length }, lastBellyWarn: 100, spawnCounter: 0, endKind: null, rngState: 123, playTimeMs: 0 };
    if (mode === 'dungeon') {
      s.floor = 1; s.map = clone(MD.generateFloor(1)); s.player = clone(MD.makePlayer(s.map.playerSpawn.x, s.map.playerSpawn.y));
      delete s.player.animT0; delete s.player.anim;
      const pos = s.map.stairs; s.enemies = [clone(MD.makeEnemy('slime', pos.x, pos.y, 1))];
      s.items = [{ ...clone(MD.makeItem('onigiri')), x: pos.x, y: pos.y }];
      s.explored = [s.player.x + ',' + s.player.y];
    }
    return s;
  }
  return { api: context.MDSaves, context, config, MD, snapshot };
}

// A minimal transaction-accurate IDB fake: mutations stage data, request success
// precedes commit, and failure rolls the entire transaction back.
function fakeIndexedDB() {
  let rows = new Map(), created = false, queue = Promise.resolve();
  const faults = { nextWrite: null, abortAfterPut: false, opens: 0, closes: 0 };
  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore() { created = true; }, close() { faults.closes++; },
    transaction() {
      let pending = 0, aborted = false, started = false, staged, done, ended = false;
      const work = [], gate = new Promise(resolve => { done = resolve; });
      const tx = { error: null, oncomplete: null, onabort: null, onerror: null,
        abort() { if (ended) throw new Error('TransactionInactiveError'); aborted = true; setImmediate(finish); },
        objectStore() { return {
          get(id) { return request(() => clone(staged.get(id))); },
          getAll() { return request(() => Array.from(staged.values(), clone)); },
          put(record) { return request(() => { if (faults.nextWrite) { const e = new Error(faults.nextWrite); e.name = faults.nextWrite; faults.nextWrite = null; throw e; } staged.set(record.slotId, clone(record)); if (faults.abortAfterPut) { faults.abortAfterPut = false; aborted = true; } return record.slotId; }); },
          delete(id) { return request(() => staged.delete(id)); },
        }; },
      };
      function finish() {
        if (ended || !started || pending && !aborted) return;
        ended = true;
        if (aborted) { if (tx.onabort) tx.onabort(); }
        else { rows = staged; if (tx.oncomplete) tx.oncomplete(); }
        done();
      }
      function request(operation) {
        const req = { result: undefined, error: null }; pending++;
        const execute = () => setImmediate(() => {
          if (aborted) { pending--; finish(); return; }
          try { const result = operation(); req.result = result; if (req.onsuccess) req.onsuccess(); }
          catch (e) { req.error = e; tx.error = e; aborted = true; if (req.onerror) req.onerror(); if (tx.onerror) tx.onerror(); }
          pending--; setImmediate(finish);
        });
        if (started) execute(); else work.push(execute);
        return req;
      }
      queue.then(() => { started = true; staged = new Map(Array.from(rows, ([k, v]) => [k, clone(v)])); work.forEach(fn => fn()); if (!pending) setImmediate(finish); });
      queue = gate; return tx;
    },
  };
  return { faults, db, open() { faults.opens++; const req = { result: db }; setImmediate(() => { if (!created && req.onupgradeneeded) req.onupgradeneeded(); if (req.onsuccess) req.onsuccess(); }); return req; } };
}

test('snapshot validates real generated dungeon, town, death, clear and RNG state', () => {
  const { api, snapshot } = setup();
  for (const mode of ['town', 'dungeon']) assert.deepEqual(Array.from(api.validateSnapshot(snapshot(mode), setup().config)), []);
  const s = snapshot('dungeon'); s.endKind = 'death'; s.player.alive = false; s.player.hp = -3;
  assert.deepEqual(Array.from(api.validateSnapshot(s, setup().config)), []);
  s.endKind = 'clear'; s.player.alive = true; s.player.hp = 1;
  assert.deepEqual(Array.from(api.validateSnapshot(s, setup().config)), []);
});

test('envelope round-trip preserves every authoritative field and checksum', () => {
  const { api, config, snapshot, MD } = setup(); const s = snapshot('dungeon');
  s.bag[0] = clone(MD.makeItem('knockStaff')); s.warehouse.push(clone(MD.makeItem('onigiri'))); s.turn = 82; s.rngState = 4294967295; s.playTimeMs = 12345.6;
  const env = api.createEnvelope(s, config, { name: '雪林远征', now: 1234 });
  assert.deepEqual(clone(api.parseFile(JSON.stringify(env), config).snapshot), s);
  s.turn = 100; assert.equal(env.snapshot.turn, 82);
  const corrupt = clone(env); corrupt.snapshot.turn++; assert.throws(() => api.parseFile(JSON.stringify(corrupt), config), { code: 'CORRUPT_SAVE' });
});

test('compatibility ignores translated labels and colors, catches gameplay and catalog IDs named name', () => {
  const { api, config } = setup(); const c = clone(config), original = api.configFingerprint(c);
  c.localization.texts[0].values['zh-CN'] = '新文本'; c.items.onigiri.name = '新的苹果'; c.enemies.slime.color = '#ffffff'; c.floorBands[0].themeId = 'modern';
  assert.equal(api.configFingerprint(c), original);
  c.rules.hungerEvery++; assert.notEqual(api.configFingerprint(c), original);
  const special = clone(config); special.items.name = clone(special.items.onigiri); const hash = api.configFingerprint(special); special.items.name.dropOnMiss = 0;
  assert.notEqual(api.configFingerprint(special), hash);
});

test('validation isolates unknown items, malformed grids, coordinates, actor state and unsafe numeric values', () => {
  const { api, config, snapshot } = setup();
  const changes = [
    s => { s.bag[0] = { type: 'unreleased' }; }, s => { s.warehouse = [null]; },
    s => { s.map.tiles[0].pop(); }, s => { s.map.tiles = null; }, s => { s.map.roomIds = null; }, s => { s.map.rooms = null; },
    s => { s.player.x = 999; }, s => { s.player.statuses = [{ type: 'sleep', turns: -1 }]; },
    s => { s.map.stairs = null; }, s => { s.player = null; }, s => { s.skillMeta = null; },
    s => { s.rngState = -1; }, s => { s.playTimeMs = Infinity; }, s => { s.turn = NaN; }, s => { s.bag = []; },
    s => { s.skills.active = []; }, s => { s.explored = ['01,2']; }, s => { s.triggeredMH = [999]; },
    s => { s.player.alive = false; }, s => { s.mode = 'code'; }, s => { s.map.rooms[0].id = '__proto__'; },
  ];
  for (const change of changes) { const s = snapshot('dungeon'); change(s); assert.ok(api.validateSnapshot(s, config).length, change.toString()); }
});

test('prototype pollution, accessors, cycles, sparse arrays and non-JSON objects are rejected before cloning', () => {
  const { api, config, snapshot } = setup();
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const s = snapshot(); Object.defineProperty(s, key, { enumerable: true, value: { polluted: true } });
    assert.match(api.validateSnapshot(s, config)[0], /保留字段/);
  }
  const variants = [s => { Object.defineProperty(s, 'turn', { enumerable: true, get() { throw new Error('do not execute'); } }); }, s => { s.log = [s]; }, s => { s.warehouse = new Date(); }, s => { delete s.bag[1]; }, s => { s.turn = undefined; }];
  for (const change of variants) { const s = snapshot(); change(s); assert.ok(api.validateSnapshot(s, config).length); }
  assert.equal({}.polluted, undefined);
});

test('version, strict envelope fields, metadata and oversized file fail clearly', () => {
  const { api, config, snapshot } = setup(); const env = api.createEnvelope(snapshot(), config);
  assert.throws(() => api.parseFile('{not-json', config), { code: 'INVALID_SAVE' });
  assert.throws(() => api.parseFile(JSON.stringify({ ...env, version: 999 }), config), { code: 'INCOMPATIBLE_SAVE' });
  assert.throws(() => api.parseFile(JSON.stringify({ ...env, injected: true }), config), { code: 'INVALID_SAVE' });
  assert.throws(() => api.createEnvelope(snapshot(), config, { name: ' ' }), { code: 'INVALID_SAVE' });
  assert.throws(() => api.createEnvelope(snapshot(), config, { revision: -1 }), { code: 'INVALID_SAVE' });
  assert.throws(() => api.parseFile(' '.repeat(api.MAX_FILE_BYTES + 1), config), { code: 'TOO_LARGE' });
  assert.throws(() => api.parseFile('雪'.repeat(Math.ceil(api.MAX_FILE_BYTES / 3)), config), { code: 'TOO_LARGE' });
});

test('large warehouses are preserved without arbitrary truncation', async () => {
  const { api, config, snapshot } = setup(); const s = snapshot();
  s.warehouse = Array.from({ length: 10001 }, (_, i) => ({ type: 'onigiri', uid: 'item' + i, name: '苹果' }));
  const store = api.createStore({ config, volatileOnly: true });
  await store.write(1, s); const exported = await store.exportSlot(1);
  const restored = api.parseFile(exported, config); assert.equal(restored.snapshot.warehouse.length, 10001);
  assert.equal(restored.snapshot.warehouse[10000].uid, 'item10000');
});

test('designer-only store never reads or opens real persistent storage', async () => {
  const { api, config, snapshot } = setup({ get indexedDB() { throw new Error('should not read'); }, get localStorage() { throw new Error('should not read'); } });
  const options = { config, volatileOnly: true }; Object.defineProperty(options, 'indexedDB', { get() { throw new Error('should not read option'); } });
  const store = api.createStore(options); assert.equal((await store.init()).persistent, false);
  await store.write(1, snapshot()); assert.equal((await store.read(1)).snapshot.mode, 'town');
  assert.equal((await api.createStore({ config, volatileOnly: true }).read(1)), null);
});

test('unavailable IndexedDB explicitly selects volatile memory without touching legacy storage', async () => {
  const { api, config, snapshot } = setup(); const denied = { open() { throw new Error('SecurityError'); } };
  const store = api.createStore({ config, indexedDB: denied }); const status = await store.init();
  assert.equal(status.kind, 'memory'); assert.equal(status.persistent, false); assert.match(status.reason, /临时/); assert.match(status.reason, /SecurityError/);
  await store.write(1, snapshot()); assert.equal((await store.list()).length, 10);
});

test('all ten slots isolate snapshots, clones and manual slot bounds', async () => {
  const { api, config, snapshot } = setup(); const store = api.createStore({ config, volatileOnly: true });
  const initial = await store.list(); assert.equal(initial.length, 10); assert.ok(initial.every(r => r.status === 'empty' && r.metadata.revision === 0));
  await Promise.all(Array.from({ length: 10 }, (_, i) => { const s = snapshot(); s.turn = i; return store.write(i + 1, s, { expectedRevision: 0, name: '旅程 ' + i }); }));
  const rows = await store.list(); assert.ok(rows.every(r => r.status === 'ready'));
  for (let id = 1; id <= 10; id++) assert.equal((await store.read(id)).snapshot.turn, id - 1);
  const read = await store.read(1); read.snapshot.turn = 500; assert.equal((await store.read(1)).snapshot.turn, 0);
  for (const id of [0, 11, '1', NaN, 1.5]) await assert.rejects(store.write(id, snapshot()), { code: 'INVALID_SLOT' });
});

test('writes capture state immediately and compare-and-swap prevents stale queued writes', async () => {
  const { api, config, snapshot } = setup(); const backend = api.createMemoryBackend(), a = api.createStore({ config, backend }), b = api.createStore({ config, backend });
  const s = snapshot(); const pending = a.write(1, s, { expectedRevision: 0 }); s.turn = 900; await pending;
  assert.equal((await a.read(1)).snapshot.turn, 0);
  const first = a.write(1, { ...snapshot(), turn: 1 }, { expectedRevision: 1 });
  const stale = b.write(1, { ...snapshot(), turn: 2 }, { expectedRevision: 1 });
  assert.equal((await first).metadata.revision, 2); await assert.rejects(stale, { code: 'CONFLICT' });
  assert.equal((await a.read(1)).snapshot.turn, 1);
});

test('delete clears current and backup but tombstone prevents ABA stale-page overwrites', async () => {
  const { api, config, snapshot } = setup(); const store = api.createStore({ config, volatileOnly: true });
  await store.write(1, snapshot()); await store.write(1, { ...snapshot(), turn: 1 }, { expectedRevision: 1 });
  assert.equal(await store.delete(1, { expectedRevision: 2 }), 3);
  const row = (await store.list())[0]; assert.equal(row.status, 'empty'); assert.equal(row.metadata.revision, 3); assert.equal(row.backupAvailable, false);
  await assert.rejects(store.write(1, snapshot(), { expectedRevision: 0 }), { code: 'CONFLICT' });
  const restored = await store.write(1, snapshot(), { expectedRevision: 3 }); assert.equal(restored.metadata.revision, 4);
  await assert.rejects(store.delete(1, { expectedRevision: 2 }), { code: 'CONFLICT' });
});

test('valid backups survive corrupt current writes and recovery increments revision', async () => {
  const { api, config, snapshot } = setup(); const backend = api.createMemoryBackend(), store = api.createStore({ config, backend, now: () => 1234 });
  await store.write(1, snapshot(), { name: '旧旅程' }); await store.write(1, { ...snapshot(), turn: 20 }, { expectedRevision: 1 });
  await store.write(2, snapshot());
  await backend.mutate(1, record => { record.current.snapshot.turn = 999; return { record, value: null }; });
  const rows = await store.list(); assert.equal(rows[0].status, 'corrupt'); assert.equal(rows[0].backupAvailable, true); assert.equal(rows[1].status, 'ready');
  await assert.rejects(store.read(1), { code: 'CORRUPT_SAVE' });
  const recovered = await store.recover(1, { expectedRevision: 2 }); assert.equal(recovered.snapshot.turn, 0); assert.equal(recovered.metadata.revision, 3);
  assert.equal((await store.list())[0].status, 'ready');
});

test('incompatible/corrupt backups are not offered as recoverable', async () => {
  const { api, config, snapshot } = setup(); const backend = api.createMemoryBackend(), store = api.createStore({ config, backend });
  await store.write(1, snapshot()); await store.write(1, snapshot());
  await backend.mutate(1, record => { record.backup.configFingerprint = 'other'; return { record, value: null }; });
  assert.equal((await store.list())[0].backupAvailable, false); await assert.rejects(store.recover(1), { code: 'NO_BACKUP' });
  const changed = clone(config); changed.player.hp++;
  const other = api.createStore({ config: changed, backend }); assert.equal((await other.list())[0].status, 'incompatible');
  await assert.rejects(other.read(1), { code: 'INCOMPATIBLE_SAVE' });
});

test('import validates first, preserves target on failure, and backs up overwritten slot', async () => {
  const { api, config, snapshot } = setup(); const store = api.createStore({ config, volatileOnly: true });
  await store.write(1, snapshot()); const before = await store.exportSlot(1);
  await assert.rejects(store.importSlot(1, '{bad', { expectedRevision: 1 }), { code: 'INVALID_SAVE' }); assert.equal(await store.exportSlot(1), before);
  const imported = api.createEnvelope({ ...snapshot(), turn: 44 }, config, { name: '导入旅程' });
  const result = await store.importSlot(1, imported, { expectedRevision: 1 }); assert.equal(result.snapshot.turn, 44); assert.equal(result.metadata.source, 'import'); assert.equal(result.metadata.revision, 2);
  assert.equal((await store.recover(1, { expectedRevision: 2 })).snapshot.turn, 0);
  await assert.rejects(store.exportSlot(2), { code: 'EMPTY_SLOT' });
});

test('real IndexedDB adapter waits for commit, persists across stores, and atomically backs up', async () => {
  const { api, config, snapshot } = setup(); const idb = fakeIndexedDB(); const a = api.createStore({ config, indexedDB: idb });
  assert.equal((await a.init()).persistent, true); const s = snapshot();
  await a.write(1, s, { expectedRevision: 0 }); s.turn = 5; await a.write(1, s, { expectedRevision: 1 });
  const b = api.createStore({ config, indexedDB: idb }); assert.equal((await b.read(1)).snapshot.turn, 5);
  assert.equal((await b.list())[0].backupAvailable, true); const recovered = await b.recover(1, { expectedRevision: 2 }); assert.equal(recovered.snapshot.turn, 0);
});

test('IDB quota failure and late transaction abort roll back current and backup without switching stores', async () => {
  const { api, config, snapshot } = setup(); const idb = fakeIndexedDB(); const store = api.createStore({ config, indexedDB: idb });
  await store.write(1, snapshot()); await store.write(1, { ...snapshot(), turn: 1 }); const before = await store.exportSlot(1);
  idb.faults.nextWrite = 'QuotaExceededError'; await assert.rejects(store.write(1, { ...snapshot(), turn: 2 }, { expectedRevision: 2 }), /QuotaExceededError/);
  assert.equal(store.status.kind, 'indexeddb'); assert.equal(store.status.persistent, true); assert.equal(await store.exportSlot(1), before);
  idb.faults.abortAfterPut = true; await assert.rejects(store.write(1, { ...snapshot(), turn: 3 }, { expectedRevision: 2 }), { code: 'STORAGE_ABORTED' });
  assert.equal(await store.exportSlot(1), before); assert.equal((await store.recover(1, { expectedRevision: 2 })).snapshot.turn, 0);
});

test('IDB compare-and-swap protects two active browser tabs', async () => {
  const { api, config, snapshot } = setup(); const idb = fakeIndexedDB(); const a = api.createStore({ config, indexedDB: idb }), b = api.createStore({ config, indexedDB: idb });
  await a.write(1, snapshot()); await b.init();
  const results = await Promise.allSettled([a.write(1, { ...snapshot(), turn: 1 }, { expectedRevision: 1 }), b.write(1, { ...snapshot(), turn: 2 }, { expectedRevision: 1 })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'CONFLICT');
  assert.equal((await a.read(1)).metadata.revision, 2);
});

test('IDB version change closes connection and subsequent writes fail visibly', async () => {
  const { api, config, snapshot } = setup(); const idb = fakeIndexedDB(); const store = api.createStore({ config, indexedDB: idb });
  await store.write(1, snapshot()); idb.db.onversionchange();
  await assert.rejects(store.write(1, snapshot()), { code: 'STORAGE_UNAVAILABLE' }); assert.equal(store.status.persistent, true); assert.match(store.status.lastError, /关闭/);
});

test('blocked IDB startup falls back once and closes a late success connection', async () => {
  const { api, config } = setup(); let closed = 0, request;
  const factory = { open() { request = { result: { close() { closed++; } } }; setImmediate(() => request.onblocked()); return request; } };
  const store = api.createStore({ config, indexedDB: factory }); assert.equal((await store.init()).kind, 'memory');
  request.onsuccess(); assert.equal(closed, 1); assert.equal(store.status.kind, 'memory');
});

test('malformed nested imported structures always return validation errors, never escape', () => {
  const { api, config, snapshot } = setup(); const original = snapshot('dungeon');
  const paths = [
    ['map'], ['player'], ['skills'], ['skillMeta'], ['map', 'tiles'], ['map', 'roomIds'], ['map', 'rooms'], ['map', 'monsterHouseRooms'], ['map', 'stairs'],
    ['player', 'statuses'], ['player', 'type'], ['items', 0, 'type'], ['enemies', 0, 'type'], ['skills', 'active'], ['bag'], ['log'], ['explored'], ['triggeredMH'],
  ];
  for (const keys of paths) for (const value of [null, {}, [], true, 4, 'invalid', { toString: null }]) {
    const s = clone(original); let target = s; for (const key of keys.slice(0, -1)) target = target[key]; target[keys.at(-1)] = value;
    if (keys.join('.') === 'map.monsterHouseRooms') s.triggeredMH = [0];
    let result; assert.doesNotThrow(() => { result = api.validateSnapshot(s, config); }, keys.join('.'));
    assert.ok(Array.isArray(result));
  }
});

test('impossible enemy counts, overlapping actors and oversized map dimensions are rejected', () => {
  const { api, config, snapshot } = setup();
  const overlap = snapshot('dungeon'); overlap.enemies[0].x = overlap.player.x; overlap.enemies[0].y = overlap.player.y;
  assert.ok(api.validateSnapshot(overlap, config).some(e => e.includes('重叠')));
  const many = snapshot('dungeon'); many.enemies = Array.from({ length: 101 }, () => clone(many.enemies[0]));
  assert.ok(api.validateSnapshot(many, config).some(e => e.includes('$.enemies')));
  const large = snapshot('dungeon'); large.map.width = 200; assert.ok(api.validateSnapshot(large, config).some(e => e.includes('$.map.width')));
});

test('missing current data with a surviving backup stays visibly corrupt and recoverable', async () => {
  const { api, config, snapshot } = setup(); const backend = api.createMemoryBackend(), store = api.createStore({ config, backend });
  await store.write(1, snapshot()); await store.write(1, { ...snapshot(), turn: 1 });
  await backend.mutate(1, record => { record.current = null; return { record, value: null }; });
  const row = (await store.list())[0]; assert.equal(row.status, 'corrupt'); assert.equal(row.backupAvailable, true);
  await assert.rejects(store.read(1), { code: 'CORRUPT_SAVE' }); assert.equal((await store.recover(1)).snapshot.turn, 0);
});
