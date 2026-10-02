'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');

// Run the real loader; replace only browser image I/O. Check each requested
// on-disk PNG rather than maintaining a second asset manifest in the tests.
async function loadSprites() {
  const requests = new Set();
  class Image {
    set src(url) {
      this.source = url.split('?')[0];
      const file = path.resolve(ROOT, this.source);
      assert.ok(file.startsWith(path.join(ROOT, 'assets/runtime') + path.sep));
      const bytes = fs.readFileSync(file); // Missing/case-mismatched assets fail CI.
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', this.source);
      this.naturalWidth = bytes.readUInt32BE(16);
      this.naturalHeight = bytes.readUInt32BE(20);
      this.complete = true;
      requests.add(this.source);
      queueMicrotask(() => this.onload());
    }
  }
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game.json')));
  const context = vm.createContext({ MD: { config }, Image });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'), context);
  context.MDConfig.installRuntime(context.MD, config, { locale: 'en' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/actors.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/sprites.js'), 'utf8'), context);
  await context.MD.sprites.ready;
  return { MD: context.MD, requests };
}

test('enemy and player base PNGs follow stable internal IDs, independent of localized names', async () => {
  const { MD, requests } = await loadSprites();
  for (const id of ['player', ...Object.keys(MD.config.enemies)]) {
    assert.equal(MD.sprites.fileMap[id], id);
    assert.ok(requests.has(`assets/runtime/${id}.png`), id);
    if (id !== 'player') {
      const actor = MD.makeEnemy(id, 0, 0);
      assert.equal(actor.type, id);
      assert.equal(actor.name, MD.t(MD.config.enemies[id].nameKey));
      assert.ok(requests.has(`assets/runtime/${actor.type}.png`));
    }
  }
});

test('existing directional monster images and player action files resolve on disk', async () => {
  const { MD, requests } = await loadSprites();
  for (const id of ['slime', 'bat']) {
    assert.equal(MD.sprites.monsterImage(id).source, `assets/runtime/${id}-dirs.png`);
  }
  assert.equal(MD.sprites.monsterImage('shell'), null); // Existing static sprite.
  for (const action of MD.sprites.playerAnims) {
    const file = `assets/runtime/player/${action}.png`;
    assert.equal(MD.sprites.playerImage(action).source, file);
    assert.ok(requests.has(file));
  }
});
