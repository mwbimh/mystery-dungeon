const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const defaults = () => JSON.parse(read('tests/fixtures/default-config-v1.json'));
const schema = JSON.parse(read('config/schema.json'));

function environment({ search = '', data = defaults(), failPath, corrupt = false } = {}) {
  const persisted = new Map([['md_warehouse_v1', '[{"type":"rock"}]'], ['md-skill-meta', '{"active":4,"passive":3}']]);
  const calls = [], requests = [];
  const localStorage = {
    getItem(key) { calls.push(['get', key]); return persisted.get(key) ?? null; },
    setItem(key, value) { calls.push(['set', key]); persisted.set(key, String(value)); },
  };
  const context = vm.createContext({ TextEncoder, URLSearchParams, console, location: { search }, localStorage,
    fetch: async (url, options) => {
      requests.push([url, options]);
      return { ok: url !== failPath, status: url === failPath ? 404 : 200,
        text: async () => url.endsWith('schema.json') ? JSON.stringify(schema) : corrupt ? '{' : JSON.stringify(data) };
    },
  });
  vm.runInContext(read('js/config.js'), context);
  return { context, api: context.MDConfig, persisted, calls, requests };
}
const invalidCases = [
  ['missing section', d => { delete d.player; }],
  ['unknown field', d => { d.player.hpTypo = 1; }],
  ['null object', d => { d.map = null; }],
  ['array replacing object', d => { d.player = []; }],
  ['non-number', d => { d.player.hp = '30'; }],
  ['fractional integer', d => { d.player.hp = 1.5; }],
  ['non-finite number', d => { d.rules.enemyScale = Infinity; }],
  ['range', d => { d.player.hp = 0; }],
  ['chance range', d => { d.map.hallChance = 1.1; }],
  ['version', d => { d.version = 2; }],
  ['min greater than max', d => { d.effects.staffCharges = { min: 6, max: 4 }; }],
  ['unknown enemy reference', d => { d.enemySpawns[0].entries[0].id = 'ghost'; }],
  ['unknown item reference', d => { d.itemDrops[0].id = 'ghost'; }],
  ['unknown theme', d => { d.themes.order[0] = 'ghost'; }],
  ['zero weight total', d => { d.itemDrops.forEach(e => { e.weight = 0; }); }],
  ['negative weight', d => { d.itemDrops[0].weight = -1; }],
  ['duplicate id', d => { d.itemDrops[1].id = d.itemDrops[0].id; }],
  ['empty weighted list', d => { d.itemDrops = []; }],
  ['spawn starts after floor one', d => { d.enemySpawns[0].fromFloor = 2; }],
  ['spawn floor exceeds completion floor', d => { d.enemySpawns[2].fromFloor = 25; }],
  ['unordered spawn floors', d => { d.enemySpawns[2].fromFloor = 2; }],
  ['belly cap below initial belly', d => { d.player.belly = 150; d.effects.bellyCap = 100; }],
  ['invalid color', d => { d.items.rock.color = 'red'; }],
  ['blank name', d => { d.items.rock.name = ''; }],
  ['padded name', d => { d.items.rock.name = ' 岩石'; }],
];
for (const [label, mutate] of invalidCases) {
  test(`configuration rejects ${label}`, () => {
    const { api } = environment();
    const data = defaults(); mutate(data);
    const errors = api.validate(data, schema);
    assert.ok(errors.length > 0, label);
    assert.match(errors[0], /^\$/);
  });
}
test('default config validates and parses without changing data', () => {
  const { api } = environment();
  assert.equal(api.validate(defaults(), schema).length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(api.parse(read('tests/fixtures/default-config-v1.json'), schema))), defaults());
});
test('parse rejects malformed JSON, unsafe shape and excessive UTF-8 byte size', () => {
  const { api } = environment();
  assert.throws(() => api.parse('{', schema));
  assert.throws(() => api.parse('{}', schema), /缺少字段/);
  assert.throws(() => api.parse('"' + '汉'.repeat(90000) + '"', schema), /256KiB/);
});
test('load failure blocks boot without assigning an unvalidated config', async () => {
  for (const options of [{ failPath: 'config/game.json' }, { failPath: 'config/schema.json' }, { corrupt: true }, { data: {} }]) {
    const { api, context } = environment(options);
    await assert.rejects(api.boot());
    assert.equal(context.MD, undefined);
  }
});
test('normal boot deep-freezes config and forwards existing storage keys', async () => {
  const { api, context, calls, persisted, requests } = environment();
  await api.boot();
  const { MD } = context;
  function checkFrozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value)); Object.values(value).forEach(checkFrozen);
  }
  checkFrozen(MD.config);
  assert.equal(MD.preview, null);
  assert.equal(MD.storage.getItem('md_warehouse_v1'), persisted.get('md_warehouse_v1'));
  MD.storage.setItem('md-skill-meta', 'saved');
  assert.equal(persisted.get('md-skill-meta'), 'saved');
  assert.deepEqual(calls, [['get', 'md_warehouse_v1'], ['set', 'md-skill-meta']]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(([, opts]) => opts.cache === 'no-store'));
});
test('preview boot isolates reads and writes and provides reproducible RNG', async () => {
  const first = environment({ search: '?designer=1&seed=0&floor=24' });
  const second = environment({ search: '?designer=1&seed=0&floor=24' });
  await Promise.all([first.api.boot(), second.api.boot()]);
  const MD = first.context.MD;
  assert.equal(MD.preview.seed, 0); assert.equal(MD.preview.floor, 24);
  assert.equal(MD.storage.getItem('md_warehouse_v1'), null);
  MD.storage.setItem('md_warehouse_v1', 'temporary');
  assert.equal(MD.storage.getItem('md_warehouse_v1'), 'temporary');
  assert.equal(first.calls.length, 0);
  assert.equal(first.persisted.get('md_warehouse_v1'), '[{"type":"rock"}]');
  for (let i = 0; i < 20; i++) assert.equal(MD.random(), second.context.MD.random());
});
test('preview accepts seed bounds and rejects invalid floor and seed parameters', async () => {
  for (const search of ['?designer=1', '?designer=1&seed=4294967295&floor=1']) {
    const { api } = environment({ search }); await api.boot();
  }
  for (const pair of ['seed=-1', 'seed=4294967296', 'seed=1.5', 'seed=abc', 'floor=0', 'floor=25', 'floor=1.5', 'floor=-1']) {
    const { api } = environment({ search: '?designer=1&' + pair });
    await assert.rejects(api.boot(), /seed/);
  }
});
test('normal play ignores preview-only seed and floor parameters', async () => {
  const { api, context } = environment({ search: '?seed=bad&floor=999' });
  await api.boot(); assert.equal(context.MD.preview, null);
});
test('custom validated data changes actual player, enemy, items, damage and generated map', async () => {
  const data = defaults();
  Object.assign(data.player, { hp: 77, atk: 12, def: 4, belly: 80 });
  data.rules.enemyScale = 1;
  Object.assign(data.enemies.slime, { hp: 21, atk: 13, name: '测试史莱姆' });
  data.localization.texts.find(row => row.key === data.enemies.slime.nameKey).zhCN = '测试史莱姆';
  data.effects.staffCharges = { min: 9, max: 9 };
  data.effects.damageRoll = { min: 0, max: 0 };
  data.items.knockStaff.name = '测试法杖';
  data.localization.texts.find(row => row.key === data.items.knockStaff.nameKey).zhCN = '测试法杖';
  data.itemDrops = [{ id: 'knockStaff', weight: 1 }];
  data.enemySpawns = [{ fromFloor: 1, entries: [{ id: 'shell', weight: 1 }] }];
  data.map.width = { min: 60, max: 60 }; data.map.height = { min: 36, max: 36 };
  data.map.monsterHouseChance = { min: 1, max: 1 };
  const { api, context } = environment({ search: '?designer=1&seed=42', data });
  await api.boot();
  for (const file of ['js/map.js', 'js/actors.js', 'js/items.js']) vm.runInContext(read(file), context);
  const { MD } = context;
  const player = MD.makePlayer(1, 2);
  assert.deepEqual([player.hp, player.maxHp, player.atk, player.def, player.belly], [77, 77, 12, 4, 80]);
  const enemy = MD.makeEnemy('slime', 1, 2);
  assert.deepEqual([enemy.hp, enemy.atk, enemy.name], [21, 13, '测试史莱姆']);
  assert.equal(MD.pickEnemyType(1), 'shell');
  const item = MD.randomFloorItem(1);
  assert.equal(item.type, 'knockStaff'); assert.equal(item.charges, 9);
  assert.equal(MD.displayName(item), '测试法杖 [9]');
  assert.equal(MD.meleeDamage(12, 4), 8);
  const map = MD.generateFloor(1);
  assert.equal(map.width, 60); assert.equal(map.height, 36);
  assert.equal(map.monsterHouseRooms.length, map.rooms.length - 1);
});
test('allowed map extremes keep rooms in bounds and stairs reachable across seeds', async () => {
  const { api } = environment();
  for (const width of [50, 80]) for (const height of [30, 48]) for (const chance of [0, 1]) {
    const data = defaults();
    data.map.width = { min: width, max: width }; data.map.height = { min: height, max: height };
    data.map.skipRoomChance = 1; data.map.hallChance = 1; data.map.loopChance = chance;
    data.map.monsterHouseChance = { min: chance, max: chance };
    assert.equal(api.validate(data, schema).length, 0);
    const { api: bootApi, context } = environment({ search: '?designer=1&seed=1', data });
    await bootApi.boot(); vm.runInContext(read('js/map.js'), context);
    for (let seed = 0; seed < 10; seed++) {
      context.MD.random = bootApi.seededRandom(seed * 123456789);
      const map = context.MD.generateFloor(1);
      assert.equal(map.width, width); assert.equal(map.height, height);
      assert.equal(map.tiles.length, height);
      for (const row of map.tiles) { assert.equal(row.length, width); assert.ok(row.every(tile => [0, 1, 2].includes(tile))); }
      for (const room of map.rooms) {
        assert.ok(room.x >= 1 && room.y >= 1 && room.w > 0 && room.h > 0);
        assert.ok(room.x + room.w < width && room.y + room.h < height);
      }
      for (const position of [map.playerSpawn, map.stairs]) {
        assert.ok(position.x >= 0 && position.x < width && position.y >= 0 && position.y < height);
        assert.ok(map.tiles[position.y][position.x] > 0);
      }
      const queue = [map.playerSpawn], seen = new Set([`${map.playerSpawn.x},${map.playerSpawn.y}`]);
      for (let i = 0; i < queue.length; i++) {
        const { x, y } = queue[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
          if (!context.MD.isWalkable(map, nx, ny) || seen.has(key)) continue;
          seen.add(key); queue.push({ x: nx, y: ny });
        }
      }
      assert.ok(seen.has(`${map.stairs.x},${map.stairs.y}`), `stairs unreachable: ${width}x${height}, chance ${chance}, seed ${seed}`);
    }
  }
});

const invalidLocalizationCases = [
  ['unknown enemy text reference', d => { d.enemies.slime.nameKey = 'unknown.enemy'; }],
  ['unknown item text reference', d => { d.items.rock.nameKey = 'unknown.item'; }],
  ['duplicate text key', d => { d.localization.texts.push({ ...d.localization.texts[0] }); }],
  ['missing English translation', d => { delete d.localization.texts[0].en; }],
  ['empty Chinese translation', d => { d.localization.texts[0].zhCN = ''; }],
  ['missing preview banner', d => { d.localization.texts = d.localization.texts.filter(row => row.key !== 'preview.banner'); }],
  ['missing theme name', d => { d.localization.texts = d.localization.texts.filter(row => row.key !== `theme.${d.themes.order[0]}.name`); }],
  ['placeholder language mismatch', d => { d.localization.texts.find(row => row.key === 'preview.banner').en += ' {unknown}'; }],
  ['malformed placeholder', d => { d.localization.texts.find(row => row.key === 'preview.banner').en += ' {bad-name}'; }],
  ['unclosed placeholder', d => { d.localization.texts.find(row => row.key === 'preview.banner').en += ' {seed'; }],
  ['generated enemy name mismatch', d => { d.enemies.slime.name = '不是默认译文'; }],
  ['generated item name mismatch', d => { d.items.rock.name = '不是默认译文'; }],
  ['enemy name contains caller-unsupported placeholder', d => {
    const row = d.localization.texts.find(row => row.key === d.enemies.slime.nameKey);
    row.zhCN += ' {name}'; row.en += ' {name}'; d.enemies.slime.name = row.zhCN;
  }],
  ['item name contains caller-unsupported placeholder', d => {
    const row = d.localization.texts.find(row => row.key === d.items.rock.nameKey);
    row.zhCN += ' {name}'; row.en += ' {name}'; d.items.rock.name = row.zhCN;
  }],
  ['theme name contains caller-unsupported placeholder', d => {
    const row = d.localization.texts.find(row => row.key === `theme.${d.themes.order[0]}.name`);
    row.zhCN += ' {name}'; row.en += ' {name}';
  }],
  ['preview banner has matching languages but wrong caller parameter signature', d => {
    const row = d.localization.texts.find(row => row.key === 'preview.banner');
    row.zhCN = '{seed} {name}'; row.en = '{seed} {name}';
  }],
  ['unsupported default locale', d => { d.localization.defaultLocale = 'fr'; }],
];
for (const [label, mutate] of invalidLocalizationCases) {
  test(`localization rejects ${label}`, () => {
    const { api } = environment(); const data = defaults(); mutate(data);
    assert.ok(api.validate(data, schema).length > 0, label);
  });
}
test('translator selects Chinese and English with checked named parameters', () => {
  const { api } = environment(); const data = defaults();
  data.localization.texts.push({ key: 'test.parameters', zhCN: '{name}拿到{count}件；{name}', en: '{name} received {count}; {name}' });
  assert.equal(api.validate(data, schema).length, 0);
  const zh = api.createTranslator(data, 'zh-CN'), en = api.createTranslator(data, 'en');
  const nameRow = data.localization.texts.find(row => row.key === data.enemies.slime.nameKey);
  assert.equal(zh(nameRow.key), nameRow.zhCN); assert.equal(en(nameRow.key), nameRow.en);
  assert.equal(zh('test.parameters', { name: '角色', count: 0 }), '角色拿到0件；角色');
  assert.equal(en('test.parameters', { name: 'Hero', count: 2 }), 'Hero received 2; Hero');
  assert.throws(() => zh('unknown.text.key'), /文本key不存在/);
  assert.throws(() => en('test.parameters', { name: 'Hero' }), /缺少占位符/);
  assert.throws(() => en('test.parameters', Object.create({ name: 'Hero', count: 2 })), /缺少占位符/);
  assert.throws(() => api.createTranslator(data, 'fr'), /不支持语言/);
});
test('boot chooses requested locale and rejects unsupported languages before game config is assigned', async () => {
  for (const locale of ['zh-CN', 'en']) {
    const { api, context } = environment({ search: '?designer=1&lang=' + locale });
    await api.boot();
    assert.equal(context.MD.locale, locale);
    for (const file of ['js/map.js', 'js/actors.js', 'js/items.js', 'js/themes.js']) vm.runInContext(read(file), context);
    const data = context.MD.config;
    const field = locale === 'en' ? 'en' : 'zhCN';
    const enemyName = data.localization.texts.find(row => row.key === data.enemies.slime.nameKey)[field];
    const itemName = data.localization.texts.find(row => row.key === data.items.rock.nameKey)[field];
    assert.equal(context.MD.makeEnemy('slime', 0, 0).name, enemyName);
    assert.equal(context.MD.displayName(context.MD.makeItem('rock')), itemName);
    const theme = context.MD.themeForFloor(1);
    assert.equal(theme.name, data.localization.texts.find(row => row.key === `theme.${theme.id}.name`)[field]);
  }
  const { api, context } = environment({ search: '?lang=fr' });
  await assert.rejects(api.boot(), /不支持语言/);
  assert.equal(context.MD?.config, undefined);
});

test('actual generated configuration validates independently of historical balance fixtures', () => {
  const { api } = environment();
  assert.doesNotThrow(() => api.parse(read('config/game.json'), schema));
});
test('text length uses Unicode codepoints consistently with schema validation', () => {
  const { api } = environment();
  const data = defaults();
  const row = data.localization.texts.find(entry => entry.key === data.enemies.slime.nameKey);
  data.enemies.slime.name = row.zhCN = '😀'.repeat(41);
  assert.equal(api.validate(data, schema).length, 0);
  data.enemies.slime.name = row.zhCN = '😀'.repeat(81);
  const errors = api.validate(data, schema);
  assert.ok(errors.some(error => error.startsWith('$.enemies.slime.name:')));
});
