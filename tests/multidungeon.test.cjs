'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
// A frozen migration fixture is intentional: changing a designer's current
// dungeon count, order, balance or locale list must not invalidate regressions.
const fixture = () => JSON.parse(read('tests/fixtures/default-config-v2.json'));
const plain = value => JSON.parse(JSON.stringify(value));

function environment({ data = fixture(), search = '', persisted = new Map() } = {}) {
  const calls = [];
  const context = vm.createContext({ console, TextEncoder, URLSearchParams,
    location: { search },
    localStorage: {
      getItem(key) { calls.push(['get', key]); return persisted.get(key) ?? null; },
      setItem(key, value) { calls.push(['set', key]); persisted.set(key, String(value)); },
      removeItem(key) { calls.push(['remove', key]); persisted.delete(key); },
    },
    fetch: async url => ({ ok: true, text: async () => url.endsWith('schema.json')
      ? read('config/schema.json') : JSON.stringify(data) }),
  });
  vm.runInContext(read('js/config.js'), context, { filename: 'js/config.js' });
  return { context, api: context.MDConfig, data, calls, persisted };
}

function loadGameplay(context) {
  for (const file of ['js/map.js', 'js/actors.js', 'js/items.js', 'js/themes.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return context.MD;
}

test('normal boot restores selected dungeon without rewriting legacy saves', async () => {
  const persisted = new Map([
    ['md-expedition-v1', JSON.stringify({ version: 1, dungeonId: 'trainingGrove' })],
    ['md_warehouse_v1', JSON.stringify([{ type: 'rock', uid: 'old-rock' }])],
    ['md-skill-meta', JSON.stringify({ active: 4, passive: 3 })],
  ]);
  const before = new Map(persisted);
  const { api, context } = environment({ persisted });
  await api.boot();
  assert.equal(context.MD.dungeonId, 'trainingGrove');
  const MD = loadGameplay(context);
  assert.equal(MD.loadWarehouse()[0].uid, 'old-rock');
  for (const key of ['md_warehouse_v1', 'md-skill-meta']) assert.equal(persisted.get(key), before.get(key));
});

test('dungeon selection persists and survives a fresh runtime', async () => {
  const persisted = new Map();
  const first = environment({ persisted });
  await first.api.boot();
  first.context.MD.selectDungeon('trainingGrove');
  assert.equal(JSON.parse(persisted.get('md-expedition-v1')).dungeonId, 'trainingGrove');
  const second = environment({ persisted });
  await second.api.boot();
  assert.equal(second.context.MD.dungeonId, 'trainingGrove');
  second.context.MD.selectDungeon('original');
  assert.equal(JSON.parse(persisted.get('md-expedition-v1')).dungeonId, 'original');
});

test('explicit invalid dungeon IDs fail instead of silently using original', async () => {
  for (const id of ['missingDungeon', '__proto__', 'constructor']) {
    const { api, context } = environment({ search: '?dungeon=' + id });
    await assert.rejects(api.boot());
    assert.equal(context.MD?.config, undefined);
  }
});

test('selected dungeon determines the preview floor limit', async () => {
  const data = fixture();
  const last = data.dungeons.trainingGrove.totalFloors;
  const valid = environment({ data, search: `?designer=1&dungeon=trainingGrove&floor=${last}&seed=42` });
  await valid.api.boot();
  assert.equal(valid.context.MD.preview.floor, last);
  const invalid = environment({ data, search: `?designer=1&dungeon=trainingGrove&floor=${last + 1}&seed=42` });
  await assert.rejects(invalid.api.boot());
  assert.equal(invalid.context.MD?.config, undefined);
});

test('preview dungeon changes never read or mutate persistent selection or inventory', async () => {
  const persisted = new Map([
    ['md-expedition-v1', JSON.stringify({ version: 1, dungeonId: 'trainingGrove' })],
    ['md_warehouse_v1', '[{"type":"rock","uid":"sentinel"}]'],
    ['md-skill-meta', '{"active":4,"passive":3}'],
  ]);
  const before = [...persisted];
  const { api, context, calls } = environment({ persisted, search: '?designer=1&dungeon=trainingGrove&seed=0' });
  await api.boot();
  const MD = loadGameplay(context);
  MD.selectDungeon('original');
  MD.selectDungeon('trainingGrove');
  MD.saveWarehouse([{ type: 'travelOnigiri', uid: 'temporary' }]);
  assert.equal(MD.loadWarehouse()[0].uid, 'temporary');
  assert.deepEqual(calls, []);
  assert.deepEqual([...persisted], before);
});

test('floor resolution isolates dungeon profiles and resolves all floor boundaries', async () => {
  const { api, context, data } = environment();
  await api.boot();
  const MD = context.MD;
  const snapshot = JSON.stringify(MD.config);
  MD.selectDungeon('original');
  const original = plain(MD.floorConfig(1));
  MD.selectDungeon('trainingGrove');
  const training = plain(MD.floorConfig(1));
  assert.notDeepEqual(training.map, original.map);
  assert.notDeepEqual(training.enemyEntries, original.enemyEntries);
  assert.notDeepEqual(training.itemEntries, original.itemEntries);
  for (const [id, dungeon] of Object.entries(data.dungeons)) {
    MD.selectDungeon(id);
    for (let floor = 1; floor <= dungeon.totalFloors; floor++) {
      const config = MD.floorConfig(floor);
      assert.equal(config.band.dungeonId, id);
      assert.ok(config.band.fromFloor <= floor && config.band.toFloor >= floor);
      assert.ok(config.enemyEntries.length > 0 && config.itemEntries.length > 0);
    }
    assert.throws(() => MD.floorConfig(0));
    assert.throws(() => MD.floorConfig(dungeon.totalFloors + 1));
  }
  MD.selectDungeon('original');
  assert.deepEqual(plain(MD.floorConfig(1)), original);
  assert.equal(JSON.stringify(MD.config), snapshot);
});

test('variant records execute through shared supported templates', async () => {
  const { api, context } = environment({ search: '?designer=1&dungeon=trainingGrove&seed=42' });
  await api.boot();
  const MD = loadGameplay(context);
  const enemy = MD.makeEnemy('emberSlime', 1, 2);
  assert.equal(enemy.type, 'emberSlime');
  assert.equal(enemy.name, MD.t(MD.config.enemies.emberSlime.nameKey));
  const item = MD.makeItem('travelOnigiri');
  assert.equal(item.type, 'travelOnigiri');
  assert.equal(MD.displayName(item), MD.t(MD.config.items.travelOnigiri.nameKey));
  const selected = MD.floorConfig(1);
  MD.random = () => 0;
  assert.equal(MD.pickEnemyType(1), selected.enemyEntries.find(row => row.weight > 0).id);
  assert.equal(MD.randomFloorItem(1).type, selected.itemEntries.find(row => row.weight > 0).id);
  const map = MD.generateFloor(1);
  assert.ok(map.width >= selected.map.width.min && map.width <= selected.map.width.max);
  assert.ok(map.height >= selected.map.height.min && map.height <= selected.map.height.max);
  assert.equal(MD.themeForFloor(1).id, selected.themeId);
});

test('band-specific map and rule overrides take precedence without altering defaults', async () => {
  const data = fixture();
  const band = data.floorBands.find(row => row.dungeonId === 'trainingGrove' && row.toFloor === data.dungeons.trainingGrove.totalFloors);
  band.mapProfileOverride = data.dungeons.original.mapProfileId;
  band.ruleProfileOverride = data.dungeons.original.ruleProfileId;
  const { api, context } = environment({ data, search: '?dungeon=trainingGrove' });
  await api.boot();
  const first = context.MD.floorConfig(1);
  const last = context.MD.floorConfig(data.dungeons.trainingGrove.totalFloors);
  assert.deepEqual(plain(first.map), data.mapProfiles[data.dungeons.trainingGrove.mapProfileId]);
  assert.deepEqual(plain(last.map), data.mapProfiles[data.dungeons.original.mapProfileId]);
  assert.equal(first.rules.enemyScale, data.ruleProfiles[data.dungeons.trainingGrove.ruleProfileId].enemyScale);
  assert.equal(last.rules.enemyScale, data.ruleProfiles[data.dungeons.original.ruleProfileId].enemyScale);
  assert.equal(context.MD.config.dungeons.trainingGrove.mapProfileId, 'grove');
});

test('adding a language requires data rows rather than a hardcoded language branch', async () => {
  const data = fixture();
  data.localization.locales.push('ja');
  for (const row of data.localization.texts) row.values.ja = row.values.en;
  const { api, context } = environment({ data, search: '?lang=ja&dungeon=trainingGrove' });
  await api.boot();
  const MD = loadGameplay(context);
  assert.equal(MD.locale, 'ja');
  assert.equal(MD.makeEnemy('emberSlime', 0, 0).name,
    data.localization.texts.find(row => row.key === data.enemies.emberSlime.nameKey).values.ja);
});

test('current generated config validates regardless of authored record counts', () => {
  const { api } = environment();
  assert.deepEqual(plain(api.validate(JSON.parse(read('config/game.json')), JSON.parse(read('config/schema.json')))), []);
});

const invalidData = [
  ['unknown default dungeon', d => { d.defaultDungeonId = 'missingDungeon'; }],
  ['dungeon map reference', d => { d.dungeons.original.mapProfileId = 'missingMap'; }],
  ['dungeon rules reference', d => { d.dungeons.original.ruleProfileId = 'missingRules'; }],
  ['floor dungeon reference', d => { d.floorBands[0].dungeonId = 'missingDungeon'; }],
  ['floor map override reference', d => { d.floorBands[0].mapProfileOverride = 'missingMap'; }],
  ['floor rules override reference', d => { d.floorBands[0].ruleProfileOverride = 'missingRules'; }],
  ['floor enemy group reference', d => { d.floorBands[0].enemyGroupId = 'missingGroup'; }],
  ['floor item group reference', d => { d.floorBands[0].itemGroupId = 'missingGroup'; }],
  ['floor theme reference', d => { d.floorBands[0].themeId = 'missingTheme'; }],
  ['floor range inversion', d => { d.floorBands[0].fromFloor = d.floorBands[0].toFloor + 1; }],
  ['uncovered dungeon', d => { d.floorBands = d.floorBands.filter(row => row.dungeonId !== 'original'); }],
  ['floor overlap', d => { const row = { ...d.floorBands[0], id: 'qaDuplicateBand' }; d.floorBands.push(row); }],
  ['monster template', d => { d.enemies.emberSlime.behaviorTemplate = 'unsupportedTeleport'; }],
  ['unknown use effect', d => { d.items.travelOnigiri.useEffectId = 'missingEffect'; }],
  ['inverted charges', d => { d.items.knockStaff.chargesMin = d.items.knockStaff.chargesMax + 1; }],
  ['incomplete added locale', d => { d.localization.locales.push('ja'); }],
  ['unknown locale default', d => { d.localization.defaultLocale = 'missingLocale'; }],
  ['missing default-language translation', d => { delete d.localization.texts[0].values[d.localization.defaultLocale]; }],
  ['inherited property name still needs profile shape', d => { d.ruleProfiles.toString = 'not-a-profile'; }],
  ['aliased none effect', d => { d.itemEffects.emptyAlias = { ...d.itemEffects.none }; d.items.rock.throwEffectId = 'emptyAlias'; }],
  ['duplicate translation key', d => { d.localization.texts.push({ ...d.localization.texts[0] }); }],
  ['mismatched translation placeholders', d => { d.localization.texts[0].values.en += ' {unexpected}'; }],
];
for (const [label, mutate] of invalidData) {
  test(`multidungeon validator rejects ${label} with a source-mappable path`, () => {
    const { api } = environment();
    const data = fixture();
    mutate(data);
    const errors = api.validate(data, JSON.parse(read('config/schema.json')));
    assert.ok(errors.length > 0, label);
    assert.ok(errors.every(error => error.startsWith('$.')), plain(errors));
  });
}

for (const key of ['item.usedSleep', 'item.landed', 'item.broken', 'item.emptyCharges', 'dungeon.choose', 'skill.help']) {
  test(`runtime text ${key} rejects caller-unsupported matching placeholders`, () => {
    const { api } = environment();
    const data = fixture();
    const row = data.localization.texts.find(row => row.key === key);
    for (const locale of data.localization.locales) row.values[locale] += ' {unexpected}';
    const errors = api.validate(data, JSON.parse(read('config/schema.json')));
    assert.ok(errors.some(error => error.startsWith('$.localization.texts[')), key);
  });
}

test('sorting floor rows for authoring does not change valid dungeon coverage', async () => {
  const data = fixture();
  data.floorBands.reverse();
  const { api, context } = environment({ data });
  await api.boot();
  for (const [id, dungeon] of Object.entries(data.dungeons)) {
    context.MD.selectDungeon(id);
    for (let floor = 1; floor <= dungeon.totalFloors; floor++) {
      const result = context.MD.floorConfig(floor);
      assert.equal(result.band.dungeonId, id);
      assert.ok(result.band.fromFloor <= floor && result.band.toFloor >= floor);
    }
  }
});
