'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let server, browser, base;
let generatedOverride;

before(async () => {
  server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(ROOT, '.' + (relative === '/' ? '/index.html' : relative));
    if (!target.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    if (relative === '/config/game.json' && generatedOverride) {
      res.setHeader('Content-Type', 'application/json'); res.end(generatedOverride); return;
    }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
    fs.readFile(target, (err, bytes) => {
      if (err) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
      res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function loaded(page, query = '?flat=1') {
  await page.goto(base + '/index.html' + query);
  await page.waitForFunction(() => window.MD_STATE);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const s = window.MD_STATE;
    return { floor: s.floor, mode: s.mode, turn: s.turn, player: s.player ? { ...s.player, animT0: 0 } : null, enemies: s.enemies, items: s.items, map: s.map };
  });
}

test('normal startup loads generated workbook defaults', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await loaded(page);
    assert.equal(await page.evaluate(() => MD_STATE.mode), 'town');
    await page.locator('#stickerEntrance').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => MD_STATE.player);
    const actual = await page.evaluate(() => ({ mode: MD_STATE.mode, hp: MD_STATE.player.hp, configHp: MD.config.player.hp }));
    const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game.json'), 'utf8'));
    assert.equal(actual.mode, 'dungeon');
    assert.equal(actual.hp, defaults.player.hp);
    assert.equal(actual.configHp, defaults.player.hp);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('seeded preview repeats floor layout and leaves persistent storage unchanged', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loaded(page);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('md-test-sentinel', 'preserve'); localStorage.setItem('md_warehouse_v1', JSON.stringify([{ id: 'normal-save' }])); });
    const initialStorage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
    const floor = Math.min(4, await page.evaluate(() => MD.config.rules.totalFloors));
    const preview = `?designer=1&seed=42&floor=${floor}&flat=1&debug=1`;
    await loaded(page, preview);
    const first = await snapshot(page);
    assert.equal(first.mode, 'dungeon');
    assert.equal(first.floor, floor);
    assert.equal(first.turn, 0);
    await page.reload();
    await page.waitForFunction(floor => window.MD_STATE && MD_STATE.player && MD_STATE.floor === floor, floor);
    assert.deepEqual(await snapshot(page), first);
    assert.deepEqual(await page.evaluate(() => MD_STATE.warehouse), []);
    await page.evaluate(() => MD.saveWarehouse([{ id: 'preview-only' }]));
    assert.deepEqual(await page.evaluate(() => MD.loadWarehouse()), [{ id: 'preview-only' }]);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => MD_STATE.turn > 0);
    assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), initialStorage);
  } finally { await context.close(); }
});

test('editing Excel player.hp then converting changes the actual preview player', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'md-workbook-browser-'));
  const workbook = path.join(temporary, 'game.xlsx');
  const output = path.join(temporary, 'game.json');
  let context;
  try {
    execFileSync('python3', ['-c', [
      'import sys, openpyxl',
      'book = openpyxl.load_workbook(sys.argv[1])',
      'sheet = book["Settings"]',
      'headers = {cell.value: cell.column for cell in sheet[1]}',
      'for row in range(2, sheet.max_row + 1):',
      '    if sheet.cell(row, headers["path"]).value == "player.hp":',
      '        sheet.cell(row, headers["value"]).value = 47',
      '        break',
      'else:',
      '    raise AssertionError("player.hp row missing")',
      'book.save(sys.argv[2])',
    ].join('\n'), path.join(ROOT, 'config/game.xlsx'), workbook], { cwd: ROOT, stdio: 'pipe' });
    execFileSync('python3', ['tools/convert_config.py', '--workbook', workbook, '--output', output], { cwd: ROOT, stdio: 'pipe' });
    generatedOverride = fs.readFileSync(output);
    assert.equal(JSON.parse(generatedOverride).player.hp, 47);
    context = await browser.newContext();
    const page = await context.newPage();
    await loaded(page, '?designer=1&seed=42&floor=1&flat=1');
    assert.equal(await page.evaluate(() => MD_STATE.player.hp), 47);
  } finally {
    generatedOverride = undefined;
    if (context) await context.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('invalid or missing generated JSON stops startup visibly; repaired config reloads', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    generatedOverride = '{broken';
    await page.goto(base + '/index.html?flat=1');
    await page.locator('#configError').waitFor();
    assert.match(await page.locator('#configError').textContent(), /配置加载失败/);
    assert.equal(await page.evaluate(() => typeof MD_STATE), 'undefined');
    generatedOverride = undefined;
    await page.route('**/config/game.json', route => route.fulfill({ status: 404, body: 'missing' }));
    await page.reload();
    await page.locator('#configError').waitFor();
    assert.equal(await page.evaluate(() => typeof MD_STATE), 'undefined');
    await page.unroute('**/config/game.json');
    await page.reload();
    await page.waitForFunction(() => window.MD_STATE);
    assert.equal(await page.locator('#configError').count(), 0);
    assert.equal(await page.evaluate(() => MD_STATE.mode), 'town');
  } finally {
    generatedOverride = undefined;
    await context.close();
  }
});

test('static build includes generated configuration and boots independently', async () => {
  execFileSync('python3', ['tools/build.py'], { cwd: ROOT, stdio: 'pipe' });
  for (const name of ['index.html', 'js/config.js', 'config/game.json', 'config/schema.json']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', name)), name);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'dist', 'config/game.xlsx')), false);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/config/game.json'), 'utf8'));
    const floor = Math.min(2, built.rules.totalFloors);
    await page.goto(base + `/dist/index.html?designer=1&seed=42&floor=${floor}&flat=1`);
    await page.waitForFunction(floor => window.MD_STATE && MD_STATE.floor === floor, floor);
    assert.equal(await page.evaluate(() => MD_STATE.mode), 'dungeon');
  } finally { await context.close(); }
});

test('Excel localization switches names to English without changing saved item IDs', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loaded(page, '?flat=1&lang=zh-CN');
    const saved = await page.evaluate(() => {
      const item = MD.makeItem('onigiri');
      if (MD.displayName(item) !== MD.config.items.onigiri.name) throw new Error('Default Chinese name changed');
      if (MD.makeEnemy('slime', 1, 1).name !== MD.config.enemies.slime.name) throw new Error('Default enemy name changed');
      MD.saveWarehouse([item]);
      return localStorage.getItem('md_warehouse_v1');
    });
    await loaded(page, '?flat=1&lang=en');
    const result = await page.evaluate(() => {
      const item = MD.loadWarehouse()[0];
      const text = key => MD.config.localization.texts.find(row => row.key === key).en;
      return {
        type: item.type,
        itemName: MD.displayName(item),
        expectedItem: text(MD.config.items.onigiri.nameKey),
        enemyName: MD.makeEnemy('slime', 1, 1).name,
        expectedEnemy: text(MD.config.enemies.slime.nameKey),
        raw: localStorage.getItem('md_warehouse_v1'),
        locale: MD.locale,
      };
    });
    assert.equal(result.locale, 'en');
    assert.equal(result.type, 'onigiri');
    assert.equal(result.itemName, result.expectedItem);
    assert.equal(result.enemyName, result.expectedEnemy);
    assert.equal(result.raw, saved);
  } finally { await context.close(); }
});
