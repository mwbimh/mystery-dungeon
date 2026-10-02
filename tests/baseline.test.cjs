const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const baselineCommit = '5ab2ad7f02ea773c9c25a68688f7ce3404060c05';
const baseline = process.env.MD_TEST_BASELINE === '1';

function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}
async function load(random = seeded(1)) {
  const math = Object.create(Math);
  math.random = random;
  const storage = new Map();
  const context = vm.createContext({ Math: math, console, URLSearchParams, TextEncoder,
    location: { search: '' },
    fetch: async url => ({ ok: true, text: async () => fs.readFileSync(path.join(root,
      url.endsWith('schema.json') ? 'config/schema.json' : 'tests/fixtures/default-config-v2.json'), 'utf8') }),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    MD: { random },
  });
  const read = file => baseline
    ? execFileSync('git', ['show', `${baselineCommit}:${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
  if (!baseline && fs.existsSync(path.join(root, 'js/config.js'))) {
    vm.runInContext(read('js/config.js'), context, { filename: 'js/config.js' });
    await context.MDConfig.boot();
  }
  context.MD.random = random;
  context.MD.storage = context.localStorage;
  if (context.MDConfig) context.MD.weightedPick = entries => context.MDConfig.weightedPick(entries, context.MD.random);
  for (const file of ['js/map.js', 'js/actors.js', 'js/items.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return { MD: context.MD, storage };
}
const plain = value => JSON.parse(JSON.stringify(value));

// SHA-256 fixtures generated ONLY from the unmodified baseline commit above.
const fixtures = [
  [1, 1, '2251aa9a4396935ac2b489922eb0e5ef36f85d6ef61c597166530b0deee1d39c'],
  [42, 2, '8fa7e097afa543f011c1a697377422515051fb72bae2d2fb47234c19ca4fceb1'],
  [123456789, 4, '729587824cdc1b1d63ce3a57449353e6804d97f8d61f5d9630062b9e75f08ec0'],
  [1000, 6, '1236c53b21499344e3d4a029351e19cefdc6316321f0243549ee6ecc21e66aa4'],
  [4294967295, 9, 'ad8c635e1bb8ce0dddf70bf11d0fb526778690083ff5e84d719a52c345a85b11'],
];
for (const [seed, floor, expected] of fixtures) {
  test(`default map matches baseline: seed ${seed}, floor ${floor}`, async () => {
    const { MD } = await load(seeded(seed));
    const map = MD.generateFloor(floor);
    assert.equal(createHash('sha256').update(JSON.stringify(map)).digest('hex'), expected);
    assert.equal(map.tiles[map.stairs.y][map.stairs.x], MD.TILE.STAIRS);
    assert.ok(MD.isWalkable(map, map.playerSpawn.x, map.playerSpawn.y));
  });
}
test('default player and effective enemy stats remain unchanged', async () => {
  const { MD } = await load();
  const p = MD.makePlayer(3, 7);
  assert.deepEqual([p.hp, p.maxHp, p.atk, p.def, p.belly, p.maxBelly, p.x, p.y], [30, 30, 7, 2, 100, 100, 3, 7]);
  for (const [type, hp, atk, def] of [['slime', 5, 3, 0], ['bat', 4, 3, 0], ['shell', 10, 4, 2]]) {
    const enemy = MD.makeEnemy(type, 2, 4);
    assert.deepEqual([enemy.hp, enemy.maxHp, enemy.atk, enemy.def], [hp, hp, atk, def]);
  }
});
test('enemy probability boundaries and floor progression remain unchanged', async () => {
  let roll = 0;
  const { MD } = await load(() => roll);
  for (const [floor, value, expected] of [
    [1, 0.699999, 'slime'], [1, 0.7, 'bat'],
    [2, 0.549999, 'slime'], [2, 0.55, 'bat'], [3, 0.999999, 'bat'],
    [4, 0.549999, 'slime'], [4, 0.55, 'bat'], [4, 0.849999, 'bat'], [4, 0.85, 'shell'],
  ]) { roll = value; assert.equal(MD.pickEnemyType(floor), expected); }
});
test('floor loot probability boundaries remain unchanged', async () => {
  let roll = 0;
  const { MD } = await load(() => roll);
  for (const [value, expected] of [[0, 'onigiri'], [0.379999, 'onigiri'], [0.38, 'bigOnigiri'],
    [0.519999, 'bigOnigiri'], [0.52, 'rock'], [0.779999, 'rock'], [0.78, 'sleepHerb'],
    [0.899999, 'sleepHerb'], [0.9, 'knockStaff'], [0.999999, 'knockStaff']]) {
    roll = value; assert.equal(MD.randomFloorItem(1).type, expected);
  }
});
test('staff charge range and combat damage limits remain unchanged', async () => {
  let roll = 0;
  const { MD } = await load(() => roll);
  for (const [value, charges] of [[0, 4], [0.5, 5], [0.999999, 6]]) {
    roll = value;
    assert.equal(MD.makeItem('knockStaff').charges, charges);
    assert.equal(MD.displayName({ type: 'knockStaff', charges }), `击退之杖 [${charges}]`);
  }
  roll = 0; assert.equal(MD.meleeDamage(7, 2), 4);
  roll = 0.999999; assert.equal(MD.meleeDamage(7, 2), 6);
  assert.equal(MD.meleeDamage(1, 100), 1);
});
test('legacy warehouse key and valid item payload round-trip remain compatible', async () => {
  const { MD, storage } = await load();
  const items = [{ type: 'onigiri', name: '饭团', uid: 'legacy1' },
    { type: 'knockStaff', name: '击退之杖 [2]', charges: 2, uid: 'legacy2' }];
  storage.set('md_warehouse_v1', JSON.stringify(items));
  assert.deepEqual(plain(MD.loadWarehouse()), items);
  MD.saveWarehouse(items);
  assert.deepEqual(JSON.parse(storage.get('md_warehouse_v1')), items);
});
