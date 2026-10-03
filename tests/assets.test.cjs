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

test('HTML and game-stage CSS references resolve to real local asset bytes, never LFS pointers', () => {
  const references = new Set();
  for (const source of ['index.html', 'css/game-stage.css']) {
    const text = fs.readFileSync(path.join(ROOT, source), 'utf8');
    const pattern = source.endsWith('.html') ? /\b(?:src|href)\s*=\s*["']([^"']+)["']/g : /url\(\s*["']?([^"')]+)["']?\s*\)/g;
    for (const match of text.matchAll(pattern)) {
      const url = match[1].trim();
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
      const relative = decodeURIComponent(url.split(/[?#]/)[0]);
      const file = path.resolve(ROOT, path.dirname(source), relative);
      const label = source + ' -> ' + url;
      assert.ok(file.startsWith(ROOT + path.sep), label + ' remains inside the built site');
      assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), label + ' exists');
      const bytes = fs.readFileSync(file);
      assert.ok(bytes.length > 0, label + ' is not empty');
      assert.ok(!bytes.subarray(0, 100).toString().startsWith('version https://git-lfs.github.com/spec/v1'), label + ' contains materialized bytes');
      if (path.extname(file) === '.png') {
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', label + ' PNG signature');
        assert.equal(bytes.subarray(12, 16).toString(), 'IHDR', label + ' image header');
        assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, label + ' positive dimensions');
        assert.equal(bytes.subarray(-12).toString('hex'), '0000000049454e44ae426082', label + ' complete PNG ending');
      } else if (path.extname(file) === '.svg') {
        const svg = bytes.toString('utf8');
        assert.match(svg, /<svg\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i, label + ' SVG document');
        assert.match(svg, /viewBox=["']0 0 [1-9]\d*(?:\.\d+)? [1-9]\d*(?:\.\d+)?["']/i, label + ' positive source canvas');
        assert.match(svg, /<\/svg>\s*$/i, label + ' complete SVG ending');
      }
      references.add(file);
    }
  }
  const stage = path.join(ROOT, 'assets/runtime/ui/game-stage');
  const artwork = fs.readdirSync(stage).filter(name => /\.(?:png|svg)$/.test(name));
  assert.ok(artwork.length >= 12, 'the background and complete reusable UI art set exist');
  for (const name of artwork) assert.ok(references.has(path.join(stage, name)), name + ' is used by the live HTML or stylesheet');
});

test('semantic HUD log text remains readable over the darkest cream-panel composite', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/game-stage.css'), 'utf8');
  function luminance(hex) {
    const channels = hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  }
  const background = luminance('e8e6d1');
  for (const semantic of ['', 'fresh', 'good', 'warn', 'bad', 'special']) {
    const selector = '.hud-log .log div' + (semantic ? '.' + semantic : '');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rules = [...css.matchAll(new RegExp(escaped + '\\s*\\{([^}]+)\\}', 'g'))];
    assert.ok(rules.length > 0, selector + ' explicitly overrides legacy light text');
    const color = rules.at(-1)[1].match(/(?:^|;)\s*color\s*:\s*#([\da-f]{6})\b/i);
    assert.ok(color, selector + ' declares a concrete foreground');
    const foreground = luminance(color[1]);
    const ratio = (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
    assert.ok(ratio >= 4.5, selector + ' contrast ' + ratio.toFixed(2) + ':1 must reach 4.5:1');
  }
});
