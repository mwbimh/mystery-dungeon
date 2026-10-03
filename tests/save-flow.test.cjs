'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, plain } = require('./helpers/save-harness.cjs');

async function game(options = {}) {
  return createHarness({ ...options, beforeGame(context, load) {
    load('js/saves.js');
    context.MD.shellManaged = !context.MD.preview;
    // This matches the bootstrap's per-session adapter; the legacy browser keys
    // remain available to the menu's explicit migration, never the live game.
    const memory = new Map();
    context.MD.storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) };
  } });
}
function begin(h, dungeon = 'original') {
  h.MD.session.fresh(); h.MD.session.resume();
  h.MD.selectDungeon(dungeon); h.get('btnNewRun').click();
  assert.equal(h.state.mode, 'dungeon');
}
function save(h) { return plain(h.MD.session.snapshot()); }
async function repository(h, backend) {
  const store = h.context.MDSaves.createStore({ config: h.MD.config, backend: backend || h.context.MDSaves.createMemoryBackend(), now: () => 1000 });
  await store.init(); return store;
}
async function descend(h) {
  h.state.enemies = [];
  h.state.player.x = h.state.map.stairs.x; h.state.player.y = h.state.map.stairs.y;
  for (const cell of h.MD.computeVisible(h.state.map, h.state.player.x, h.state.player.y)) h.state.explored.add(cell);
  h.key(' '); await h.flushTimers();
}

test('managed startup is paused and keyboard cannot start a hidden journey', async () => {
  const h = await game();
  assert.equal(h.MD.session.isPaused(), true);
  h.key('Enter'); h.key(' '); h.key('Numpad6');
  assert.equal(h.state.mode, 'town'); assert.equal(h.state.player, null);
});

test('closing dungeon bag and help restores playable focus for the very next key', async () => {
  const h = await game(); begin(h); h.state.enemies = [];
  for (const [open, close] of [['btnInv', 'btnInvClose'], ['btnHelp', 'btnHelpClose']]) {
    for (let repetition = 0; repetition < 3; repetition++) {
      h.get(open).click();
      assert.equal(h.context.document.activeElement.id, close);
      h.get(close).click();
      assert.equal(h.context.document.activeElement.id, 'game');
      const before = h.state.turn;
      h.key(' ');
      assert.equal(h.state.turn, before + 1, open + ' must not swallow the next wait');
    }
  }
  h.get('btnInv').click(); h.key('Escape');
  assert.equal(h.context.document.activeElement.id, 'game');
  h.get('btnHelp').click(); h.key('Escape');
  assert.equal(h.context.document.activeElement.id, 'game');
});

test('town loadout shares the accessible body layer with the bag and restores board ownership', async () => {
  const h = await game(); h.MD.session.fresh(); h.MD.session.resume();
  const body = h.context.document.body;
  assert.equal(h.get('hudSkills').parentElement, body);
  assert.equal(h.get('hudSkills').inert, false);
  h.state.bag[0] = h.MD.makeItem('rock');
  h.get('btnTownBag').click();
  assert.equal(h.get('hudInv').parentElement, body);
  assert.equal(h.get('hudSkills').inert, false);
  assert.equal(h.get('townOverlay').inert, true);
  const active = h.get('skillActive0');
  active.dispatch('drop', { dataTransfer: { getData: () => '0' } });
  assert.equal(h.state.skills.active[0].type, 'rock');
  assert.equal(h.state.bag[0], null);
  h.get('btnInvClose').click();
  assert.equal(h.context.document.activeElement.id, 'btnTownBag');
  h.get('btnHelpTown').click(); assert.equal(h.get('hudSkills').inert, true);
  h.get('btnHelpClose').click(); assert.equal(h.get('hudSkills').inert, false);
  h.get('btnNewRun').click();
  assert.notEqual(h.get('hudSkills').parentElement, body);
  assert.equal(body.classList.contains('town-active'), false);
});

test('route panel dismisses without departing, blocks town tools and selects only configured routes', async () => {
  const h = await game(); h.MD.session.fresh(); h.MD.session.resume();
  h.get('btnTownRoute').click();
  assert.equal(h.state.mode, 'town'); assert.equal(h.get('routeOverlay').classList.contains('hidden'), false);
  assert.equal(h.get('townOverlay').inert, true); assert.equal(h.get('hudSkills').inert, true);
  h.key('i'); assert.equal(h.state.invOpen, false);
  h.key('Escape');
  assert.equal(h.get('routeOverlay').classList.contains('hidden'), true);
  assert.equal(h.context.document.activeElement.id, 'btnTownRoute');
  h.get('btnTownRoute').click();
  const choice = h.get('routeChoices').children.find(button => button.dataset.dungeon === 'trainingGrove');
  choice.click(); assert.equal(h.state.dungeonId, 'trainingGrove'); assert.equal(choice['aria-pressed'], 'true');
  h.get('btnNewRun').click();
  assert.equal(h.state.mode, 'dungeon'); assert.equal(h.get('routeOverlay').classList.contains('hidden'), true);
  assert.equal(h.context.document.activeElement.id, 'game');
  const before = h.state.turn; h.key(' '); assert.equal(h.state.turn, before + 1);
});

test('natural defeat returns town focus, warehouse dismissal and the next expedition to usable controls', async () => {
  const h = await game({ query:'?flat=1' }); begin(h);
  assert.equal(typeof h.MD.debugFloor, 'undefined');
  const { hungerEvery, starvationDamage } = h.state.floorConfig.rules;
  const limit = h.state.player.belly * hungerEvery + Math.ceil(h.state.player.maxHp / starvationDamage) + 1;
  for (let waits = 0; !h.state.endKind && waits < limit; waits++) {
    h.key(' '); await h.flushTimers();
  }
  assert.equal(h.state.endKind, 'death');
  assert.equal(h.context.document.activeElement.id, 'btnEndOk');
  h.get('btnEndOk').click();
  assert.equal(h.state.mode, 'town'); assert.equal(h.state.endKind, null);
  assert.equal(h.context.document.activeElement.id, 'stickerChatgpt');
  h.get('btnTownBag').click(); h.get('btnWhToggle').click(); h.get('btnWhClose').click();
  assert.equal(h.state.whOpen, false);
  assert.equal(h.context.document.activeElement.id, 'btnWhToggle');
  h.key('Escape'); assert.equal(h.context.document.activeElement.id, 'btnTownBag');
  h.get('btnNewRun').click();
  assert.equal(h.context.document.activeElement.id, 'game');
  for (let repetition = 0; repetition < 2; repetition++) {
    h.get('btnLogToggle').click();
    assert.equal(h.context.document.activeElement.id, 'game');
    const before = h.state.turn; h.key(' '); await h.flushTimers();
    assert.equal(h.state.turn, before + 1);
  }
});

for (const dungeon of ['original', 'trainingGrove']) {
  test(`full ${dungeon} snapshot export/import restores state and the following RNG sequence`, async () => {
    const first = await game(); begin(first, dungeon);
    first.MD.debugFloor(2);
    first.state.bag[0] = first.MD.makeItem('knockStaff');
    first.state.warehouse.push(first.MD.makeItem('onigiri'));
    first.MD.unlockSkillSlot('active');
    first.state.skills.active[0] = first.MD.makeItem('rock');
    first.state.player.statuses.push({ type: 'confuse', turns: 3 });
    first.key(' '); first.key(' ');
    const expected = save(first);
    assert.equal(expected.floor, 2); assert.equal(expected.turn, 2);
    assert.equal(first.context.MDSaves.validateSnapshot(expected, first.MD.config).length, 0);
    const store = await repository(first);
    await store.write(1, expected, { name: 'Round trip', expectedRevision: 0 });
    const text = await store.exportSlot(1);
    const incoming = first.context.MDSaves.parseFile(text, first.MD.config);
    await store.importSlot(2, incoming, { expectedRevision: 0 });
    const restored = await game();
    restored.MD.session.restore((await store.read(2)).snapshot);
    assert.deepEqual(save(restored), expected);
    assert.notEqual(restored.state.map, first.state.map);
    assert.equal(restored.state.explored instanceof Set || Object.prototype.toString.call(restored.state.explored) === '[object Set]', true);
    assert.equal(restored.state.skills.active.length, expected.skillMeta.active);
    assert.deepEqual(Array.from({ length: 16 }, () => restored.MD.random()), Array.from({ length: 16 }, () => first.MD.random()));
    // Resume both into the next deterministic floor, rather than comparing only
    // the bytes that happened to be restored.
    first.MD.session.resume(); restored.MD.session.resume();
    await descend(first); await descend(restored);
    assert.deepEqual(save(restored), save(first));
  });
}

test('fresh journeys isolate warehouse, skill capacity, dungeon, input and old timers', async () => {
  const h = await game(); begin(h, 'trainingGrove');
  h.state.warehouse.push(h.MD.makeItem('onigiri')); h.state.bag[0] = h.MD.makeItem('rock');
  h.MD.unlockSkillSlot('active'); h.state.skills.active[0] = h.MD.makeItem('rock');
  const prior = save(h);
  h.key('ArrowRight'); // Pending direction chord must not act on the next slot.
  await h.MD.session.pause();
  h.MD.session.fresh(); h.MD.session.resume();
  h.get('btnNewRun').click();
  await h.flushTimers();
  assert.equal(h.state.dungeonId, h.MD.config.defaultDungeonId);
  assert.equal(h.state.turn, 0); assert.equal(h.state.floor, 1);
  assert.deepEqual(plain(h.state.warehouse), []);
  assert.ok(h.state.bag.every(item => item === null));
  assert.equal(h.MD.skillSlotInfo().active, h.MD.config.rules.activeSlots);
  assert.ok(h.state.skills.active.every(item => item === null));
  h.MD.session.restore(prior);
  assert.deepEqual(save(h), prior);
});

test('snapshot is detached; invalid import and restore cannot change a live journey or slot', async () => {
  const h = await game(); begin(h, 'trainingGrove');
  const original = save(h), store = await repository(h);
  await store.write(1, original, { expectedRevision: 0 });
  const detached = h.MD.session.snapshot(); detached.player.hp = 0; detached.map.tiles[0][0] = 1;
  assert.deepEqual(save(h), original);
  for (const mutate of [s => { s.dungeonId = 'retiredDungeon'; }, s => { s.player.x = -1; }, s => { s.bag[0] = { type: 'removedItem' }; }, s => { s.map.tiles[0] = []; }, s => { s.rngState = -1; }]) {
    const invalid = plain(original); mutate(invalid);
    assert.throws(() => h.MD.session.restore(invalid));
    assert.deepEqual(save(h), original);
    await assert.rejects(store.write(1, invalid, { expectedRevision: 1 }));
    assert.deepEqual(plain((await store.read(1)).snapshot), original);
  }
  assert.throws(() => h.context.MDSaves.parseFile('{invalid', h.MD.config));
  assert.deepEqual(plain((await store.read(1)).snapshot), original);
});

test('pause waits for an already committed attack and prevents queued movement', async () => {
  const h = await game(); begin(h);
  h.state.enemies = [];
  const p = h.state.player;
  const moves = [['Numpad6', 1, 0], ['Numpad4', -1, 0], ['Numpad8', 0, -1], ['Numpad2', 0, 1]];
  const [key, dx, dy] = moves.find(([, x, y]) => h.MD.canStep(h.state.map, p.x, p.y, x, y));
  h.state.enemies.push(h.MD.makeEnemy('shell', p.x + dx, p.y + dy));
  h.key(key);
  assert.equal(h.MD.session.isStable(), false);
  assert.throws(() => h.MD.session.snapshot(), /动作/);
  const paused = h.MD.session.pause();
  h.key(' '); h.key('ArrowLeft');
  await h.flushTimers(); await paused;
  assert.equal(h.MD.session.isStable(), true); assert.equal(h.state.turn, 1);
  const checkpoint = save(h);
  h.key(' '); h.key('Enter');
  assert.deepEqual(save(h), checkpoint);
});

for (const endKind of ['death', 'clear']) {
  test(`${endKind} snapshot reload retains outcome and normal town settlement`, async () => {
    const h = await game(); begin(h, 'trainingGrove');
    h.state.bag[0] = h.MD.makeItem('travelOnigiri'); h.state.skills.active[0] = h.MD.makeItem('rock');
    h.state.warehouse.push(h.MD.makeItem('onigiri'));
    if (endKind === 'clear') { h.MD.debugFloor(3); await descend(h); }
    else { h.state.enemies = []; h.state.player.hp = 1; h.state.player.belly = 0; h.key(' '); await h.flushTimers(); }
    assert.equal(h.state.endKind, endKind);
    const checkpoint = save(h), restored = await game();
    restored.MD.session.restore(checkpoint); restored.MD.session.resume();
    assert.deepEqual(save(restored), checkpoint);
    assert.equal(restored.get('endOverlay').classList.contains('hidden'), false);
    restored.get('btnEndOk').click();
    assert.equal(restored.state.mode, 'town'); assert.equal(restored.state.endKind, null);
    assert.equal(restored.state.player, null); assert.equal(restored.state.map, null);
    assert.equal(restored.state.warehouse.length, 1);
    assert.equal(!!restored.state.bag[0], endKind === 'clear');
    assert.equal(!!restored.state.skills.active[0], endKind === 'clear');
    assert.equal(restored.context.MDSaves.validateSnapshot(save(restored), restored.MD.config).length, 0);
  });
}

test('designer gameplay and its save facade never access persistent browser storage', async () => {
  const h = await game({ query: '?flat=1&designer=1&seed=42&dungeon=trainingGrove&floor=2', denyStorage: true });
  assert.equal(h.state.mode, 'dungeon'); assert.equal(h.state.floor, 2);
  h.key(' '); h.MD.saveWarehouse([h.MD.makeItem('onigiri')]); h.MD.unlockSkillSlot('active');
  const store = h.context.MDSaves.createStore({ config: h.MD.config, volatileOnly: true });
  await store.init(); await store.write(1, save(h), { expectedRevision: 0 });
  assert.deepEqual(h.accesses, []);
  assert.equal(store.status.persistent, false);
});

async function menu(h) {
  h.MD.settings = { playOpening: true, reducedMotion: false, renderer: 'auto' };
  h.load('js/menu.js'); await h.context.MDMenu.ready;
  return h.context.MDMenu;
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
async function clickMenu(h, predicate) {
  const node = descendants(h.get('menuContent')).find(predicate);
  assert.ok(node, 'Expected menu action');
  node.click();
  for (let i = 0; i < 60; i++) await Promise.resolve();
  return node;
}

test('multiple menu slots return to the main menu and Continue uses most recent journey', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); h.get('btnNewRun').click(); await m.open();
  await m.start(2); h.MD.selectDungeon('trainingGrove'); h.get('btnNewRun').click(); await m.open();
  assert.equal(m.activeSlot, 2);
  assert.equal(h.get('menuContinue').disabled, false);
  h.get('menuContinue').click();
  for (let i = 0; i < 80; i++) await Promise.resolve();
  assert.equal(h.state.dungeonId, 'trainingGrove');
  assert.equal(h.MD.session.isPaused(), false);
  assert.equal((await m.store.list()).filter(row => row.status === 'ready').length, 2);
});

test('cancelled occupied-slot New Game leaves saved and live game contents untouched', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); h.get('btnNewRun').click(); h.key(' '); await m.open();
  const prior = save(h), envelope = plain(await m.store.read(1));
  await m.start(1); // The test browser's confirmation defaults to Cancel.
  assert.equal(m.activeSlot, 1); assert.deepEqual(save(h), prior);
  const after = plain(await m.store.read(1));
  assert.deepEqual(after.snapshot, envelope.snapshot);
  assert.equal(h.MD.session.isPaused(), true);
});

test('cancelled and malformed file imports preserve every existing slot', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); await m.open();
  h.get('menuLoad').click(); for (let i = 0; i < 60; i++) await Promise.resolve();
  const original = plain((await m.store.read(1)).snapshot);
  await clickMenu(h, node => node.dataset.action === 'import' && node.dataset.slot === '1');
  h.get('saveFileInput').files = []; h.get('saveFileInput').dispatch('change');
  for (let i = 0; i < 60; i++) await Promise.resolve();
  assert.deepEqual(plain((await m.store.read(1)).snapshot), original);
  for (const [name, text] of [['image.png', '\u0089PNG'], ['bad.json', '{'], ['foreign.json', '{"version":1,"unrelated":true}']]) {
    await clickMenu(h, node => node.dataset.action === 'import' && node.dataset.slot === '1');
    h.get('saveFileInput').files = [{ name, size: text.length, text: async () => text }];
    h.get('saveFileInput').dispatch('change');
    for (let i = 0; i < 80; i++) await Promise.resolve();
    assert.ok(h.get('menuNotice').textContent.length);
    assert.deepEqual(plain((await m.store.read(1)).snapshot), original);
  }
  const text = await m.store.exportSlot(1);
  await clickMenu(h, node => node.dataset.action === 'import' && node.dataset.slot === '1');
  h.get('saveFileInput').files = [{ name: 'valid.json', size: text.length, text: async () => text }];
  h.get('saveFileInput').dispatch('change');
  for (let i = 0; i < 80; i++) await Promise.resolve();
  assert.deepEqual(plain((await m.store.read(1)).snapshot), original);
  assert.equal((await m.store.list()).filter(row => row.status === 'ready').length, 1);
});

test('settings persist independently from slot snapshots and cancelled settings navigation', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); await m.open();
  const original = plain((await m.store.read(1)).snapshot);
  h.get('menuSettings').click(); for (let i = 0; i < 30; i++) await Promise.resolve();
  const motion = h.get('setting-reducedMotion'); motion.checked = true; motion.onchange();
  const opening = h.get('setting-playOpening'); opening.checked = false; opening.onchange();
  const renderer = h.get('setting-renderer'); renderer.value = 'flat'; renderer.onchange();
  assert.deepEqual(JSON.parse(h.storage.get('md-settings-v1')), { playOpening: false, reducedMotion: true, renderer: 'flat' });
  assert.deepEqual(plain((await m.store.read(1)).snapshot), original);
});

test('legacy migration copies into an empty journey without rewriting old browser records', async () => {
  const storage = new Map([
    ['md_warehouse_v1', JSON.stringify([{ type: 'onigiri', uid: 'legacy', name: '饭团' }])],
    ['md-skill-meta', JSON.stringify({ active: 3, passive: 1 })],
    ['md-expedition-v1', JSON.stringify({ version: 1, dungeonId: 'trainingGrove' })],
  ]);
  const h = await game({ storage }), m = await menu(h), original = [...storage.entries()];
  h.MD.legacyData = { warehouse: storage.get('md_warehouse_v1'), skills: storage.get('md-skill-meta'), expedition: storage.get('md-expedition-v1') };
  h.context.confirm = () => true;
  h.get('menuLoad').click(); for (let i = 0; i < 60; i++) await Promise.resolve();
  await clickMenu(h, node => node.dataset.action === 'legacy');
  for (let i = 0; i < 80; i++) await Promise.resolve();
  assert.equal(m.activeSlot, 1); assert.equal(h.state.mode, 'town');
  assert.equal(h.state.dungeonId, 'trainingGrove'); assert.equal(h.state.warehouse[0].uid, 'legacy');
  assert.equal(h.MD.skillSlotInfo().active, 3);
  assert.equal((await m.store.read(1)).metadata.source, 'legacy');
  assert.deepEqual([...storage.entries()], original);
});

test('unknown legacy IDs stay available in untouched original records and cannot create a partial save', async () => {
  const h = await game(), m = await menu(h);
  h.MD.legacyData = { warehouse: JSON.stringify([{ type: 'retired-item', uid: 'old' }]), skills: null, expedition: null };
  h.context.confirm = () => true;
  h.get('menuLoad').click(); for (let i = 0; i < 60; i++) await Promise.resolve();
  await clickMenu(h, node => node.dataset.action === 'legacy');
  assert.match(h.get('menuNotice').textContent, /未知|移除/);
  assert.equal((await m.store.list()).filter(row => row.status === 'ready').length, 0);
  assert.match(h.MD.legacyData.warehouse, /retired-item/);
});

test('a failed save protects stored data and still exposes current in-memory download', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); h.get('btnNewRun').click(); await m.open();
  const stored = plain(await m.store.read(1));
  h.state.bag[0] = h.MD.makeItem('rock');
  m.store.write = async () => { const error = new Error('Quota exceeded'); error.name = 'QuotaExceededError'; throw error; };
  await assert.rejects(m.save(true), /Quota/);
  assert.deepEqual(plain(await m.store.read(1)), stored);
  assert.match(h.get('saveStatus').textContent, /保存失败/);
  await m.open();
  assert.ok(descendants(h.get('menuContent')).some(node => node.textContent === '下载当前进度'));
});

test('closing while a save transaction is pending prompts rather than claiming durable progress', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); await m.open();
  h.state.warehouse.push(h.MD.makeItem('onigiri'));
  const write = m.store.write; let release;
  m.store.write = (...args) => new Promise(resolve => { release = () => write(...args).then(resolve); });
  const saving = m.save(true);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  h.emit('beforeunload', event);
  assert.equal(event.prevented, true);
  await release(); await saving;
  const settled = { prevented: false, preventDefault() { this.prevented = true; } };
  h.emit('beforeunload', settled);
  assert.equal(settled.prevented, false);
});

test('3D renderer-only actor IDs never enter a save or conflict with strict import validation', async () => {
  const h = await game(); begin(h);
  h.state.player._vid = 'a1'; h.state.enemies.forEach((actor, i) => { actor._vid = 'a' + (i + 2); });
  const snapshot = save(h);
  assert.equal(Object.hasOwn(snapshot.player, '_vid'), false);
  assert.equal(snapshot.enemies.some(actor => Object.hasOwn(actor, '_vid')), false);
  assert.equal(h.context.MDSaves.validateSnapshot(snapshot, h.MD.config).length, 0);
  const store = await repository(h); await store.write(1, snapshot);
  await h.MD.session.pause(); h.MD.session.restore((await store.read(1)).snapshot);
  assert.deepEqual(save(h), snapshot);
  assert.equal(h.state.player._vid, undefined);
});

test('A → queued B → A persists the final A and does not lose the dirty checkpoint', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); await m.open();
  const initial = save(h), write = m.store.write;
  let release, writes = 0;
  m.store.write = (...args) => {
    writes++;
    return writes === 1 ? new Promise((resolve, reject) => { release = () => write(...args).then(resolve, reject); }) : write(...args);
  };
  h.state.warehouse.push(h.MD.makeItem('rock'));
  const middle = m.save(true);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  h.state.warehouse.pop(); h.MD.random.setState(initial.rngState);
  const latest = m.save(true);
  const whilePending = { prevented: false, preventDefault() { this.prevented = true; } };
  h.emit('beforeunload', whilePending); assert.equal(whilePending.prevented, true);
  await release(); await middle; await latest;
  assert.equal(writes, 2);
  assert.deepEqual(plain((await m.store.read(1)).snapshot), initial);
  const settled = { prevented: false, preventDefault() { this.prevented = true; } };
  h.emit('beforeunload', settled); assert.equal(settled.prevented, false);
});

test('a newer in-memory change stays dirty after an older queued transaction finishes', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); await m.open();
  const write = m.store.write; let release;
  m.store.write = (...args) => new Promise(resolve => { release = () => write(...args).then(resolve); });
  h.state.warehouse.push(h.MD.makeItem('rock'));
  const saving = m.save(true);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  h.state.warehouse.push(h.MD.makeItem('onigiri'));
  await release(); await saving;
  const unsaved = { prevented: false, preventDefault() { this.prevented = true; } };
  h.emit('beforeunload', unsaved); assert.equal(unsaved.prevented, true);
  assert.equal((await m.store.read(1)).snapshot.warehouse.length, 1);
});

test('the first menu open stays visible and offers recovery when its flush fails', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1);
  assert.equal(h.get('menuScreen').hidden, true);
  h.state.warehouse.push(h.MD.makeItem('rock'));
  m.store.write = async () => { throw new Error('Quota exceeded'); };
  await m.open();
  assert.equal(h.get('menuScreen').hidden, false);
  assert.equal(h.MD.session.isPaused(), true);
  assert.match(h.get('menuNotice').textContent, /保存失败.*Quota/);
  assert.ok(descendants(h.get('menuContent')).some(node => node.textContent === '下载当前进度'));
  assert.equal(h.state.warehouse.length, 1);
});

test('help and inventory own movement, waiting, pickup, and buffered direction input', async () => {
  const h = await game(); begin(h);
  h.state.enemies = [];
  const checkpoint = save(h);
  h.key('ArrowRight');
  h.get('btnHelp').click();
  for (const key of [' ', '.', 'g', 'Numpad6', 'ArrowDown', 'i']) h.key(key);
  await h.flushTimers();
  assert.deepEqual(save(h), checkpoint);
  assert.equal(h.state.invOpen, false);
  h.key('Escape');
  assert.equal(h.get('helpOverlay').classList.contains('hidden'), true);
  h.key('ArrowLeft'); h.key('i');
  for (const key of [' ', '.', 'g', 'Numpad6', 'ArrowDown']) h.key(key);
  await h.flushTimers();
  assert.deepEqual(save(h), checkpoint);
  assert.equal(h.state.invOpen, true);
  h.key('Escape'); h.key(' ');
  assert.equal(h.state.turn, checkpoint.turn + 1);
});

test('town Enter and Tab do not start a run or steal focus into inventory', async () => {
  const h = await game(); h.MD.session.resume();
  let prevented = false;
  h.key('Enter'); h.key('Tab', { preventDefault() { prevented = true; } });
  assert.equal(h.state.mode, 'town'); assert.equal(h.state.invOpen, false);
  assert.equal(prevented, false);
  h.key('Enter', { target: { tagName: 'BUTTON' } });
  assert.equal(h.state.mode, 'town');
  h.get('btnHelpTown').click(); h.get('btnNewRun').click();
  assert.equal(h.state.mode, 'town');
  h.key('Escape'); h.get('btnNewRun').click();
  assert.equal(h.state.mode, 'dungeon');
});

test('town inventory and warehouse keep the paper town visible and restore interaction', async () => {
  const h = await game(); h.MD.session.resume();
  h.key('i');
  assert.equal(h.state.invOpen, true);
  assert.equal(h.get('townOverlay').classList.contains('hidden'), false);
  assert.equal(h.get('townOverlay').inert, true);
  assert.equal(h.context.document.body.classList.contains('town-panel-open'), true);
  h.get('btnWhToggle').click();
  assert.equal(h.state.whOpen, true);
  assert.equal(h.get('townOverlay').classList.contains('hidden'), false);
  h.key('Escape');
  assert.equal(h.get('townOverlay').inert, false);
  assert.equal(h.context.document.body.classList.contains('town-panel-open'), false);
});

test('the first deliberate bag click after drag drop selects or transfers immediately', async () => {
  const h = await game(); h.MD.session.resume();
  h.state.bag[0] = h.MD.makeItem('rock');
  h.state.bag[1] = h.MD.makeItem('onigiri');
  h.key('i');
  const transfer = { getData: () => '0', setData() {} };
  h.get('invGrid').children[1].dispatch('drop', { dataTransfer: transfer });
  h.get('invGrid').children[0].click();
  assert.equal(h.state.invSelected, 0);
  h.get('btnWhToggle').click();
  h.get('invGrid').children[1].dispatch('drop', { dataTransfer: transfer });
  const item = h.state.bag[0];
  h.get('invGrid').children[0].click();
  assert.equal(h.state.bag[0], null); assert.equal(h.state.warehouse[0].uid, item.uid);
});

test('unavailable database reads and writes still leave in-memory download recovery reachable', async () => {
  const h = await game(), m = await menu(h);
  await m.start(1); h.state.warehouse.push(h.MD.makeItem('rock'));
  m.store.write = m.store.list = async () => { throw new Error('database connection is closing'); };
  await m.open();
  assert.equal(h.get('menuScreen').hidden, false);
  assert.equal(h.MD.session.isPaused(), true);
  assert.ok(descendants(h.get('menuContent')).some(node => node.textContent === '下载当前进度'));
  assert.ok(descendants(h.get('menuContent')).some(node => node.textContent === '回到旅程'));
  assert.equal(h.get('menuNew').disabled, true);
  assert.equal(h.get('menuLoad').disabled, true);
  assert.equal(h.state.warehouse.length, 1);
});

for (const [type, hotkey] of [['rock', 't'], ['knockStaff', 'z']]) {
  test(`focused inventory controls still allow ${type} aiming direction`, async () => {
    const h = await game(); begin(h); h.state.enemies = [];
    h.state.bag[0] = h.MD.makeItem(type); h.key('i');
    h.key(hotkey, { target: { tagName: 'BUTTON' } });
    assert.ok(h.state.aiming);
    h.key('ArrowRight', { target: { tagName: 'BUTTON' } });
    assert.equal(h.state.aiming, null);
    assert.equal(h.state.turn, 1);
  });
}

test('opening and closing a modal cancels a held skill gesture before its pointerup', async () => {
  const h = await game(); begin(h); h.state.enemies = [];
  const item = h.MD.makeItem('rock'); h.state.skills.active[0] = item;
  const slot = h.get('skillActive0');
  const down = { button: 0, buttons: 1, pointerType: 'mouse', clientX: 10, clientY: 10 };
  slot.dispatch('pointerdown', down); assert.equal(h.state.skillAiming, true);
  h.key('i'); assert.equal(h.state.skillAiming, false);
  h.emit('document:pointerup', { clientX: 70, clientY: 10 });
  assert.equal(h.state.turn, 0); assert.equal(h.state.skills.active[0], item);
  slot.dispatch('pointerdown', down); assert.equal(h.state.skillAiming, false);
  h.key('Escape');
  slot.dispatch('pointerdown', down); assert.equal(h.state.skillAiming, true);
  h.get('btnHelp').click(); h.key('Escape');
  h.emit('document:pointerup', { clientX: 70, clientY: 10 });
  assert.equal(h.state.skillAiming, false);
  assert.equal(h.state.turn, 0); assert.equal(h.state.skills.active[0], item);
});

test('menu pause clears a released direction chord before the next tap', async () => {
  const h = await game(); begin(h); h.state.enemies = [];
  h.state.player.x = 3; h.state.player.y = 3;
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) h.state.map.tiles[y][x] = h.MD.TILE.FLOOR;
  h.key('ArrowUp'); h.emit('keyup', { key: 'ArrowUp' });
  await h.MD.session.pause(); h.MD.session.resume();
  h.key('ArrowRight'); h.emit('keyup', { key: 'ArrowRight' }); await h.flushTimers();
  assert.equal(h.state.player.x, 4); assert.equal(h.state.player.y, 3);
  assert.equal(h.state.turn, 1);
});
