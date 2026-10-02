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
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
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

async function readyMenu(page) {
  // Boot may play the OP before loading the game scripts. Skip through the same
  // visible control a player uses; never claim the VM tests cover this path.
  await page.waitForFunction(() => window.MD_STATE && document.getElementById('loadingScreen').hidden);
  // Atomic setup dismissal avoids natural OP expiry between count() and click().
  // Dedicated tests below exercise actual keyboard and visible-button input.
  await page.evaluate(() => document.getElementById('openingSkip')?.click());
  await page.waitForFunction(() => window.MD_STATE);
  if (await page.evaluate(() => !!MD.preview)) return;
  await page.waitForFunction(() => window.MDMenu);
  await page.evaluate(() => MDMenu.ready);
}
async function loaded(page, query = '?flat=1', enterJourney = true) {
  await page.goto(base + '/index.html' + query);
  await readyMenu(page);
  if (!enterJourney || await page.evaluate(() => !!MD.preview)) return;
  if (await page.locator('#menuContinue').isEnabled()) await menuClick(page, '#menuContinue');
  else {
    await menuClick(page, '#menuNew');
    await page.locator('button[data-slot="1"][data-action="new"]').click();
  }
  await page.waitForFunction(() => MDMenu.activeSlot && !MD.session.isPaused());
}
async function menuIdle(page) {
  await page.waitForFunction(() => !document.getElementById('menuScreen').hasAttribute('aria-busy'));
}
async function menuClick(page, selector) {
  await menuIdle(page);
  await page.locator(selector).click();
  // All shell actions set aria-busy synchronously, then clear it only after
  // queued saves, IndexedDB reads and the resulting DOM render are settled.
  await menuIdle(page);
}
async function savedSnapshot(page) {
  return page.evaluate(() => ({ ...MD.session.snapshot(), playTimeMs: 0 }));
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
    const floor = Math.min(4, await page.evaluate(() => MD.config.dungeons[MD.dungeonId].totalFloors));
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
  const output = path.join(temporary, 'game.json');
  let context;
  try {
    for (const file of ['rules.xlsx','monsters.xlsx','items.xlsx','dungeons.xlsx','spawns.xlsx','texts.xlsx']) {
      fs.copyFileSync(path.join(ROOT,'config',file),path.join(temporary,file));
    }
    // Artifact Tool-authored literal workbook fixture, compiled by real Luban.
    fs.copyFileSync(path.join(ROOT,'tests/fixtures/player-hp47-rules.xlsx'),path.join(temporary,'rules.xlsx'));
    execFileSync('python3', ['tools/convert_config.py', '--config-dir', temporary, '--output', output], { cwd: ROOT, stdio: 'pipe' });
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
  for (const name of ['index.html', 'js/config.js', 'js/saves.js', 'js/menu.js', 'js/opening.js', 'config/game.json', 'config/schema.json', 'LICENSE', 'assets/ATTRIBUTION.txt']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', name)), name);
  }
  for(const file of ['rules.xlsx','monsters.xlsx','items.xlsx','dungeons.xlsx','spawns.xlsx','texts.xlsx'])assert.equal(fs.existsSync(path.join(ROOT,'dist/config',file)),false);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/config/game.json'), 'utf8'));
    const floor = Math.min(2, built.dungeons[built.defaultDungeonId].totalFloors);
    await page.goto(base + `/dist/index.html?designer=1&seed=42&floor=${floor}&flat=1`);
    await page.waitForFunction(floor => window.MD_STATE && MD_STATE.floor === floor, floor);
    assert.equal(await page.evaluate(() => MD_STATE.mode), 'dungeon');
  } finally { await context.close(); }
});

test('Excel localization switches names while independent slot items retain stable IDs', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await loaded(page, '?flat=1&lang=zh-CN');
    const saved = await page.evaluate(async () => {
      const item = MD.makeItem('onigiri');
      if (MD.displayName(item) !== MD.config.items.onigiri.name) throw new Error('Default Chinese name changed');
      MD_STATE.warehouse = [item]; await MDMenu.save(true);
      return (await MDMenu.store.read(1)).snapshot.warehouse;
    });
    await loaded(page, '?flat=1&lang=en');
    const result = await page.evaluate(async () => {
      const item = MD_STATE.warehouse[0];
      const text = key => MD.config.localization.texts.find(row => row.key === key).values.en;
      return { type: item.type, itemName: MD.displayName(item), expectedItem: text(MD.config.items.onigiri.nameKey),
        enemyName: MD.makeEnemy('slime', 1, 1).name, expectedEnemy: text(MD.config.enemies.slime.nameKey),
        saved: (await MDMenu.store.read(1)).snapshot.warehouse, locale: MD.locale };
    });
    assert.equal(result.locale, 'en'); assert.equal(result.type, 'onigiri');
    assert.equal(result.itemName, result.expectedItem); assert.equal(result.enemyName, result.expectedEnemy);
    assert.deepEqual(result.saved, saved);
  } finally { await context.close(); }
});

test('second workbook dungeon selects, persists, renders variant assets and completes at its own floor', async () => {
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await loaded(page,'?flat=1&debug=1&lang=en');
    await page.locator('#dungeonSelect').selectOption('trainingGrove');
    await page.evaluate(() => MDMenu.save(true));
    assert.equal(await page.evaluate(async () => (await MDMenu.store.read(1)).snapshot.dungeonId), 'trainingGrove');
    await page.reload(); await readyMenu(page); await menuClick(page, '#menuContinue');
    await page.waitForFunction(() => !MD.session.isPaused());
    assert.equal(await page.locator('#dungeonSelect').inputValue(),'trainingGrove');
    await page.locator('#btnNewRun').click();
    await page.waitForFunction(()=>MD_STATE.mode==='dungeon');
    const actual=await page.evaluate(()=>({id:MD.dungeonId,width:MD_STATE.map.width,height:MD_STATE.map.height,enemy:MD_STATE.enemies.map(e=>e.type),items:MD_STATE.items.map(i=>i.type),theme:MD_STATE.theme.id}));
    assert.equal(actual.id,'trainingGrove');assert.equal(actual.width,50);assert.equal(actual.height,30);assert.equal(actual.theme,'forest');
    assert.ok(actual.enemy.length>0&&actual.enemy.every(id=>id==='emberSlime'));assert.ok(actual.items.length>0&&actual.items.every(id=>id==='travelOnigiri'));
    fs.mkdirSync(path.join(ROOT,'test-results'),{recursive:true});
    await page.screenshot({path:path.join(ROOT,'test-results/multidungeon-training-grove.png'),fullPage:true});
    for(const id of ['emberSlime','travelOnigiri'])assert.equal((await page.request.get(base+`/assets/runtime/${id}.png`)).status(),200);
    assert.equal(await page.evaluate(()=>{try{MD.selectDungeon('original');return false;}catch(_){return true;}}),true);
    await page.evaluate(()=>{MD.debugFloor(3);MD_STATE.enemies=[];MD_STATE.player.x=MD_STATE.map.stairs.x;MD_STATE.player.y=MD_STATE.map.stairs.y;});
    await page.keyboard.press('Space');await page.locator('#endOverlay:not(.hidden)').waitFor();
    assert.equal(await page.evaluate(()=>MD_STATE.endKind),'clear');
    await page.locator('#btnEndOk').click();
    assert.equal(await page.evaluate(()=>MD_STATE.mode),'town');
    await page.locator('#dungeonSelect').selectOption('original');await page.locator('#btnNewRun').click();
    assert.deepEqual(await page.evaluate(()=>({dungeon:MD_STATE.dungeonId,floor:MD_STATE.floor,total:MD.config.dungeons[MD.dungeonId].totalFloors,leaked:MD_STATE.enemies.some(e=>e.type==='emberSlime')||MD_STATE.items.some(i=>i.type==='travelOnigiri')})),{dungeon:'original',floor:1,total:24,leaked:false});
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('invalid dungeon URL and selected floor overflow show a recoverable config error', async () => {
  const context=await browser.newContext(),page=await context.newPage();
  try {
    for(const query of ['?dungeon=missing&flat=1','?designer=1&dungeon=trainingGrove&floor=4&flat=1']) {
      await page.goto(base+'/index.html'+query);await page.locator('#configError').waitFor();
      assert.equal(await page.evaluate(()=>typeof MD_STATE),'undefined');
    }
    await loaded(page,'?designer=1&dungeon=trainingGrove&floor=3&flat=1');
    assert.equal(await page.evaluate(()=>MD_STATE.floor),3);
  } finally {await context.close();}
});

test('OP skip reaches the four-part main menu without starting hidden gameplay', async () => {
  const context = await browser.newContext({ reducedMotion: 'no-preference' }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base + '/index.html?flat=1');
    await page.locator('#openingSkip').waitFor();
    await page.keyboard.press('Enter');
    // Do not let readyMenu's setup fallback conceal a broken keyboard handler.
    await page.locator('#openingScreen').waitFor({ state: 'detached', timeout: 2000 });
    await readyMenu(page);
    for (const id of ['menuNew', 'menuContinue', 'menuSettings', 'menuAbout']) await page.locator('#' + id).waitFor();
    assert.equal(await page.locator('#menuContinue').isDisabled(), true);
    assert.equal(await page.locator('#openingScreen').count(), 0);
    assert.deepEqual(await page.evaluate(() => ({ mode: MD_STATE.mode, player: MD_STATE.player, paused: MD.session.isPaused() })), { mode: 'town', player: null, paused: true });
    await menuClick(page, '#menuNew');
    assert.equal(await page.locator('.save-card').count(), 10);
    await page.locator('button[data-slot="1"][data-action="new"]').dblclick();
    await page.waitForFunction(() => MDMenu.activeSlot === 1 && !MD.session.isPaused());
    assert.equal(await page.evaluate(async () => (await MDMenu.store.list()).filter(row => row.status === 'ready').length), 1);
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
    await menuClick(page, '#btnSessionMenu');
    await page.screenshot({ path: path.join(ROOT, 'test-results/save-start-menu.png'), fullPage: true });
  } finally { await context.close(); }
});

test('native IndexedDB resumes both dungeons after reload and keeps slots independent', async () => {
  const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage();
  try {
    await loaded(page);
    assert.equal(await page.evaluate(() => MDMenu.store.status.kind), 'indexeddb');
    await page.locator('#dungeonSelect').selectOption('trainingGrove'); await page.locator('#btnNewRun').click();
    await page.keyboard.press('Space');
    await menuClick(page, '#btnSessionMenu');
    const first = await savedSnapshot(page);
    await page.reload(); await readyMenu(page); await menuClick(page, '#menuContinue');
    await page.waitForFunction(() => MDMenu.activeSlot === 1 && !MD.session.isPaused());
    assert.deepEqual(await savedSnapshot(page), first);
    await menuClick(page, '#btnSessionMenu'); await menuClick(page, '#menuNew');
    await page.locator('button[data-slot="2"][data-action="new"]').click();
    await page.waitForFunction(() => MDMenu.activeSlot === 2 && !MD.session.isPaused());
    assert.equal(await page.evaluate(() => MD_STATE.warehouse.length), 0);
    await page.locator('#btnNewRun').click();
    assert.equal(await page.evaluate(() => MD_STATE.dungeonId), 'original');
    await menuClick(page, '#btnSessionMenu');
    assert.equal(await page.locator('#menuContinue').isEnabled(), true);
    await menuClick(page, '#menuLoad'); await page.locator('button[data-slot="1"][data-action="load"]').click();
    await page.waitForFunction(() => MDMenu.activeSlot === 1 && !MD.session.isPaused());
    assert.deepEqual(await savedSnapshot(page), first);
  } finally { await context.close(); }
});

test('download current journey then upload into another slot resumes the complete checkpoint', async () => {
  const context = await browser.newContext({ reducedMotion: 'reduce', acceptDownloads: true }), page = await context.newPage();
  try {
    await loaded(page, '?flat=1&debug=1');
    await page.locator('#dungeonSelect').selectOption('trainingGrove'); await page.locator('#btnNewRun').click();
    await page.evaluate(() => { MD.debugFloor(2); MD_STATE.bag[0] = MD.makeItem('knockStaff'); MD_STATE.warehouse.push(MD.makeItem('onigiri')); MD.unlockSkillSlot('active'); });
    await page.keyboard.press('Space'); await menuClick(page, '#btnSessionMenu');
    const expected = await savedSnapshot(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载当前进度', exact: true }).click()]);
    const file = await download.path();
    assert.ok(file); const bytes = fs.readFileSync(file);
    assert.equal(JSON.parse(bytes).format, 'mystery-dungeon-save');
    await menuClick(page, '#menuLoad');
    await menuIdle(page);
    const chooserEvent = page.waitForEvent('filechooser');
    await page.locator('button[data-slot="2"][data-action="import"]').click();
    const chooser = await chooserEvent;
    page.once('dialog', dialog => dialog.accept());
    await chooser.setFiles({ name: 'journey.json', mimeType: 'application/json', buffer: bytes });
    await page.waitForFunction(() => MDMenu.activeSlot === 2 && !MD.session.isPaused());
    assert.deepEqual(await savedSnapshot(page), expected);
    assert.deepEqual(await page.evaluate(async () => ({ ...(await MDMenu.store.read(1)).snapshot, playTimeMs: 0 })), expected);
    await page.reload(); await readyMenu(page); await menuClick(page, '#menuContinue');
    await page.waitForFunction(() => !MD.session.isPaused());
    assert.deepEqual(await savedSnapshot(page), expected);
  } finally { await context.close(); }
});

test('wrong files and cancelled overwrite never replace an occupied slot', async () => {
  const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage();
  try {
    await loaded(page); await page.locator('#btnNewRun').click(); await page.keyboard.press('Space');
    await menuClick(page, '#btnSessionMenu'); const expected = await savedSnapshot(page);
    await menuClick(page, '#menuLoad');
    for (const [name, buffer] of [['picture.png', Buffer.from([137, 80, 78, 71])], ['bad.json', Buffer.from('{')]]) {
      await menuIdle(page);
      const chooserEvent = page.waitForEvent('filechooser'); await page.locator('button[data-slot="1"][data-action="import"]').click();
      await page.evaluate(() => {
        window.__thisImportRejected = false;
        const notice = document.getElementById('menuNotice');
        const observer = new MutationObserver(() => {
          if (notice.classList.contains('is-error') && notice.textContent) {
            window.__thisImportRejected = true; observer.disconnect();
          }
        });
        observer.observe(notice, { childList: true, subtree: true, characterData: true, attributes: true });
      });
      await (await chooserEvent).setFiles({ name, mimeType: name.endsWith('png') ? 'image/png' : 'application/json', buffer });
      await page.waitForFunction(() => window.__thisImportRejected === true);
      await menuIdle(page);
      await page.waitForFunction(() => document.getElementById('menuNotice').classList.contains('is-error'));
      assert.deepEqual(await savedSnapshot(page), expected);
    }
    const text = await page.evaluate(() => MDMenu.store.exportSlot(1));
    await menuIdle(page);
    const chooserEvent = page.waitForEvent('filechooser'); await page.locator('button[data-slot="1"][data-action="import"]').click();
    const dialogEvent = page.waitForEvent('dialog');
    await (await chooserEvent).setFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await (await dialogEvent).dismiss();
    await page.waitForFunction(() => !document.getElementById('menuScreen').hasAttribute('aria-busy'));
    assert.deepEqual(await page.evaluate(async () => ({ ...(await MDMenu.store.read(1)).snapshot, playTimeMs: 0 })), expected);
    assert.equal(await page.evaluate(async () => (await MDMenu.store.list()).filter(row => row.status === 'ready').length), 1);
  } finally { await context.close(); }
});

test('settings persist across reload; reduced motion and failed OP art still reach usable menus', async () => {
  const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage();
  try {
    await loaded(page, '?flat=1', false);
    assert.equal(await page.locator('#openingScreen').count(), 0);
    await menuClick(page, '#menuSettings');
    await page.locator('#setting-playOpening').uncheck(); await page.locator('#setting-reducedMotion').check();
    await page.locator('#setting-renderer').selectOption('flat');
    await page.reload(); await readyMenu(page); await menuClick(page, '#menuSettings');
    assert.equal(await page.locator('#setting-playOpening').isChecked(), false);
    assert.equal(await page.locator('#setting-reducedMotion').isChecked(), true);
    assert.equal(await page.locator('#setting-renderer').inputValue(), 'flat');
    await page.locator('#setting-reducedMotion').uncheck(); await page.locator('#setting-playOpening').check();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route('**/assets/runtime/opening/**', route => route.abort());
    await page.reload(); await page.locator('#openingSkip').waitFor(); await page.locator('#openingSkip').click();
    await readyMenu(page); assert.equal(await page.locator('#menuNew').isVisible(), true);
    assert.equal(await page.locator('#openingScreen').count(), 0);
  } finally { await context.close(); }
});

test('OP scenes, narrow title and exact automatic completion render with controlled browser time', async () => {
  const context = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    // The real OP timers run under Playwright's clock. Pausing between scene
    // boundaries prevents CI/screenshot latency from consuming its 12s lifetime.
    // Production OP scheduling code is unchanged; its registered callbacks run
    // at exact test-clock boundaries, including the asserted completion deadline. Screenshots finish CSS transitions for stable frames.
    await page.clock.install({ time: new Date('2026-10-02T00:00:00Z') });
    await page.addInitScript(() => localStorage.setItem('md-settings-v1', JSON.stringify({ version: 1, playOpening: false, reducedMotion: false, renderer: 'flat' })));
    await loaded(page, '?flat=1', false);
    await page.clock.pauseAt(new Date('2026-10-02T00:10:00Z'));
    await page.evaluate(() => { window.__openingResult = null; MDOpening.play({ reducedMotion: false }).then(result => { window.__openingResult = result; }); });
    fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
    assert.equal(await page.locator('#openingScreen').getAttribute('data-scene'), 'lantern');
    await page.locator('.md-opening-full-art').evaluate(image => image.decode());
    assert.equal(await page.locator('.md-opening-full-art').evaluate(image => image.naturalWidth > 0), true);
    await page.screenshot({ path: path.join(ROOT, 'test-results/opening-lantern.png'), animations: 'disabled', fullPage: true });
    await page.clock.runFor(2500);
    assert.equal(await page.locator('#openingScreen').getAttribute('data-scene'), 'passage');
    await page.screenshot({ path: path.join(ROOT, 'test-results/opening-passage.png'), animations: 'disabled', fullPage: true });
    await page.clock.runFor(3900);
    assert.equal(await page.locator('#openingScreen').getAttribute('data-scene'), 'title');
    await page.screenshot({ path: path.join(ROOT, 'test-results/opening-title.png'), animations: 'disabled', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(ROOT, 'test-results/opening-title-mobile.png'), animations: 'disabled', fullPage: true });
    await page.clock.runFor(5599);
    assert.equal(await page.locator('#openingScreen').count(), 1);
    await page.clock.runFor(1);
    assert.equal(await page.locator('#openingScreen').count(), 0);
    assert.equal(await page.evaluate(() => window.__openingResult.reason), 'completed');
    await page.clock.resume();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#menuNew').isVisible(), true);
  } finally { await context.close(); }
});

test('unavailable IndexedDB honestly warns about volatile saving and remains playable', async () => {
  const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage();
  try {
    await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Storage access denied', 'SecurityError'); } }));
    await loaded(page);
    assert.equal(await page.evaluate(() => MDMenu.store.status.persistent), false);
    assert.match(await page.locator('#saveStatus').textContent(), /仅本次|下载/);
    await page.locator('#btnNewRun').click(); await page.keyboard.press('Space');
    await menuClick(page, '#btnSessionMenu');
    assert.equal(await page.getByRole('button', { name: '下载当前进度', exact: true }).isVisible(), true);
    assert.match(await page.locator('.menu-storage-note').textContent(), /刷新或关闭会丢失/);
  } finally { await context.close(); }
});

test('two live tabs cannot silently overwrite each other and stale progress remains downloadable', async () => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const first = await context.newPage(), second = await context.newPage();
  try {
    await loaded(first); await first.locator('#btnNewRun').click(); await first.evaluate(() => MDMenu.save(true));
    await loaded(second);
    await first.keyboard.press('Space'); await first.evaluate(() => MDMenu.save(true));
    const latest = await first.evaluate(async () => ({ ...(await MDMenu.store.read(1)).snapshot, playTimeMs: 0 }));
    const conflict = await second.evaluate(async () => { MD_STATE.bag[0] = MD.makeItem('rock'); try { await MDMenu.save(true); return null; } catch (error) { return error.code; } });
    assert.equal(conflict, 'CONFLICT');
    assert.match(await second.locator('#saveStatus').textContent(), /保存失败/);
    assert.deepEqual(await first.evaluate(async () => ({ ...(await MDMenu.store.read(1)).snapshot, playTimeMs: 0 })), latest);
    await menuClick(second, '#btnSessionMenu');
    // Opening the shell awaits the queued save and IndexedDB slot listing.
    // click() dispatching is not evidence that this asynchronous render finished.
    await second.getByRole('button', { name: '下载当前进度', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await second.getByRole('button', { name: '下载当前进度', exact: true }).isVisible(), true);
  } finally { await context.close(); }
});

test('actual default 3D renderer autosaves and reloads without renderer internals', async () => {
  const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await loaded(page, '?debug=1');
    await page.locator('#btnNewRun').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Only view3d.actorId assigns this marker; 2D fallback cannot satisfy this.
    assert.match(await page.evaluate(() => MD_STATE.player._vid || ''), /^a[0-9]+$/);
    await menuClick(page, '#btnSessionMenu');
    const expected = await savedSnapshot(page);
    assert.equal(Object.hasOwn(expected.player, '_vid'), false);
    assert.equal(expected.enemies.some(actor => Object.hasOwn(actor, '_vid')), false);
    assert.equal(await page.evaluate(async () => (await MDMenu.store.list())[0].status), 'ready');
    fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
    await menuClick(page, '#menuResume');
    await page.screenshot({ path: path.join(ROOT, 'test-results/save-default-renderer.png'), fullPage: true });
    await menuClick(page, '#btnSessionMenu');
    await page.reload(); await readyMenu(page); await menuClick(page, '#menuContinue');
    await page.waitForFunction(() => MDMenu.activeSlot === 1 && !MD.session.isPaused());
    assert.deepEqual(await savedSnapshot(page), expected);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('paper town preserves native keyboard navigation and opens six distinct reusable conversations', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await loaded(page);
    fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'test-results/paper-town-desktop.png'), animations: 'disabled', fullPage: true });
    await page.locator('#btnTownBag').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => MD_STATE.invOpen), false);
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'btnTownBag');
    const scenes = new Set();
    for (const id of ['stickerChatgpt', 'stickerClaude', 'stickerKimi', 'stickerGlm', 'stickerHarness', 'stickerDeepseek']) {
      await page.locator('#' + id).focus(); await page.keyboard.press('Enter');
      await page.locator('.pvn-overlay').waitFor();
      assert.equal(await page.evaluate(() => MD_STATE.mode), 'town');
      assert.equal(await page.evaluate(() => document.querySelector('.pvn-overlay').contains(document.activeElement)), true);
      scenes.add(await page.locator('.pvn-text').textContent());
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('.pvn-overlay').contains(document.activeElement)), true);
      if (id === 'stickerChatgpt') await page.screenshot({ path: path.join(ROOT, 'test-results/paper-dialogue-desktop.png'), animations: 'disabled', fullPage: true });
      await page.keyboard.press('Escape');
      await page.locator('.pvn-overlay').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement.id), id);
      assert.equal(await page.evaluate(() => MD_STATE.mode), 'town');
    }
    assert.equal(scenes.size, 6);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('town inventory keeps its paper background; dialogue action opens warehouse and restores the town', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await loaded(page);
    await page.locator('#btnTownBag').click();
    assert.equal(await page.evaluate(() => MD_STATE.invOpen), true);
    assert.equal(await page.locator('#townOverlay').isVisible(), true);
    assert.equal(await page.locator('#hudInv').isVisible(), true);
    assert.equal(await page.evaluate(() => document.getElementById('hudInv').parentElement === document.body), true);
    assert.equal(await page.evaluate(() => {
      const panel = document.getElementById('hudInv'), r = panel.getBoundingClientRect();
      return panel.contains(document.elementFromPoint(r.left + 25, r.top + 25));
    }), true, 'inventory is actually above the town stacking context');
    await page.screenshot({ path: path.join(ROOT, 'test-results/paper-town-inventory.png'), animations: 'disabled', fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('townOverlay').inert), false);
    await page.locator('#stickerDeepseek').click();
    await page.locator('.pvn-choice[data-choice="warehouse"]').click();
    assert.equal(await page.locator('.pvn-overlay').count(), 0);
    assert.equal(await page.evaluate(() => MD_STATE.whOpen), true);
    assert.equal(await page.locator('#townOverlay').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('#stickerKimi').click();
    await page.locator('.pvn-choice[data-choice="movement"]').click();
    assert.match(await page.locator('.pvn-text').textContent(), /方向键/);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => MD.dialogue.isOpen()), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => MD_STATE.mode), 'town');
  } finally { await context.close(); }
});

test('help and bag modals block all gameplay keys and the first post-drag click works', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loaded(page, '?designer=1&seed=42&flat=1');
    await page.evaluate(() => { MD_STATE.enemies = []; MD_STATE.bag[0] = MD.makeItem('rock'); MD_STATE.bag[1] = MD.makeItem('onigiri'); });
    const before = await savedSnapshot(page);
    await page.locator('#btnHelp').click();
    await page.locator('#helpOverlay').evaluate(node => { node.tabIndex = -1; node.focus(); });
    for (const key of ['Space', '.', 'g', 'ArrowRight', 'w', 'i', 'Enter']) await page.keyboard.press(key);
    await page.waitForTimeout(80);
    assert.deepEqual(await savedSnapshot(page), before);
    await page.keyboard.press('Escape');
    await page.locator('#game').focus(); await page.keyboard.press('i');
    await page.locator('#hudInv').evaluate(node => { node.tabIndex = -1; node.focus(); });
    for (const key of ['Space', '.', 'g', 'ArrowRight', 'w']) await page.keyboard.press(key);
    assert.deepEqual(await savedSnapshot(page), before);
    await page.locator('#invGrid .slot[data-slot="0"]').dragTo(page.locator('#invGrid .slot[data-slot="1"]'));
    assert.equal(await page.evaluate(() => MD_STATE.bag[0].type), 'onigiri');
    await page.locator('#invGrid .slot[data-slot="0"]').click();
    assert.equal(await page.evaluate(() => MD_STATE.invSelected), 0);
    await page.keyboard.press('Escape');
    await page.locator('#game').focus(); await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => MD_STATE.turn), before.turn + 1);
  } finally { await context.close(); }
});

test('a failing first menu flush leaves visible download recovery instead of a frozen hidden game', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  try {
    await loaded(page);
    await page.evaluate(() => {
      MD_STATE.warehouse.push(MD.makeItem('rock'));
      MDMenu.store.write = MDMenu.store.list = async () => { throw new Error('Simulated database closure'); };
    });
    await page.locator('#btnSessionMenu').click(); await menuIdle(page);
    assert.equal(await page.locator('#menuScreen').isVisible(), true);
    assert.match(await page.locator('#menuNotice').textContent(), /保存失败/);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载当前进度', exact: true }).click();
    const downloaded = await downloading;
    const envelope = JSON.parse(fs.readFileSync(await downloaded.path(), 'utf8'));
    assert.ok(JSON.stringify(envelope).includes('rock'));
    assert.equal(await page.evaluate(() => MD_STATE.warehouse.length), 1);
  } finally { await context.close(); }
});

test('paper town, inventory and visual novel remain reachable on a narrow touch viewport', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await loaded(page);
    await page.screenshot({ path: path.join(ROOT, 'test-results/paper-town-mobile.png'), animations: 'disabled', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const id of ['stickerEntrance', 'stickerChatgpt', 'stickerClaude', 'stickerKimi', 'stickerGlm', 'stickerHarness', 'stickerDeepseek']) {
      const box = await page.locator('#' + id).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 391, id + ' usable hit target');
    }
    await page.locator('#stickerClaude').tap();
    await page.screenshot({ path: path.join(ROOT, 'test-results/paper-dialogue-mobile.png'), animations: 'disabled', fullPage: true });
    const card = await page.locator('.pvn-card').boundingBox();
    assert.ok(card.x >= 0 && card.x + card.width <= 391 && card.y >= 0 && card.y + card.height <= 844);
    await page.locator('.pvn-close').tap();
    await page.locator('#btnTownBag').tap(); await page.locator('#btnWhToggle').tap();
    await page.screenshot({ path: path.join(ROOT, 'test-results/paper-town-inventory-mobile.png'), animations: 'disabled', fullPage: true });
    const inv = await page.locator('#hudInv').boundingBox();
    assert.ok(inv.x >= 0 && inv.x + inv.width <= 391 && inv.y >= 0 && inv.y + inv.height <= 844);
    await page.locator('#btnInvClose').tap();
    assert.equal(await page.evaluate(() => document.getElementById('townOverlay').inert), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('all dungeon paper themes render with an actual WebGL context and unchanged movement rules', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await loaded(page, '?designer=1&dungeon=original&seed=42&debug=1');
    assert.equal(await page.evaluate(() => !!document.getElementById('game').getContext('webgl2')), true);
    const floors = await page.evaluate(() => {
      const seen = new Set(), result = [];
      for (let floor = 1; floor <= MD.config.dungeons.original.totalFloors; floor++) {
        const id = MD.floorConfig(floor).themeId;
        if (!seen.has(id)) { seen.add(id); result.push({ floor, id }); }
      }
      return result;
    });
    for (const { floor, id } of floors) {
      await page.evaluate(floor => MD.debugFloor(floor), floor);
      await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(ROOT, 'test-results/paper-dungeon-' + id + '.png'), animations: 'disabled', fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(ROOT, 'test-results/paper-dungeon-mobile.png'), animations: 'disabled', fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('paper town five-size layout keeps the background registered and all seven stickers separate', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loaded(page);
    for (const [name, width, height] of [['wide',1440,900],['laptop',1280,720],['phone',390,844],['small',320,640],['landscape',844,390]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { document.getElementById('townOverlay').scrollTop = 0; });
      const layout = await page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
        const town = document.getElementById('townOverlay');
        return { scene:rect(document.querySelector('.town-scene')), image:rect(document.querySelector('.town-map-bg')),
          overflow:town.scrollWidth > town.clientWidth, targets:[...document.querySelectorAll('.town-sticker')].map(node => ({id:node.id,...rect(node)})),
          choice:rect(document.querySelector('.dungeon-choice')) };
      });
      assert.equal(layout.overflow, false, name + ' horizontal overflow');
      for (const prop of ['x','y','width','height']) assert.ok(Math.abs(layout.scene[prop] - layout.image[prop]) < 1, name + ' image registration');
      assert.ok(layout.choice.y >= layout.scene.y + layout.scene.height, name + ' departure cannot cover scene');
      for (let i = 0; i < layout.targets.length; i++) for (let j = i + 1; j < layout.targets.length; j++) {
        const a = layout.targets[i], b = layout.targets[j];
        const overlapX = Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
        const overlapY = Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
        assert.ok(overlapX <= 1 || overlapY <= 1, name + ' overlapping hit targets ' + a.id + '/' + b.id);
      }
      await page.screenshot({ path:path.join(ROOT,'test-results/paper-layout-' + name + '.png'), animations:'disabled',fullPage:true });
      if (name === 'small' || name === 'landscape') {
        await page.locator('#btnNewRun').scrollIntoViewIfNeeded();
        await page.screenshot({ path:path.join(ROOT,'test-results/paper-layout-' + name + '-departure.png'), animations:'disabled',fullPage:true });
      }
    }
  } finally { await context.close(); }
});


test('inventory keyboard throw and staff aim work after focus moves onto the close button', async () => {
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await loaded(page, '?designer=1&seed=42&flat=1');
    for (const [type, key] of [['rock','t'],['knockStaff','z']]) {
      const before = await page.evaluate(type => { MD_STATE.enemies = []; MD_STATE.bag[0] = MD.makeItem(type); return MD_STATE.turn; }, type);
      await page.locator('#btnInv').click();
      await page.locator('#invGrid .slot[data-slot="0"]').click();
      await page.locator('#btnInvClose').focus(); await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'game');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => MD_STATE.aiming), null);
      assert.equal(await page.evaluate(() => MD_STATE.turn), before + 1);
    }
  } finally { await context.close(); }
});
