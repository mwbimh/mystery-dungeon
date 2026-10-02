'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js/opening.js'), 'utf8');

function harness({ reducedMotion = false } = {}) {
  let now = 0, nextId = 0;
  const timers = new Map(), requests = [], listeners = new Map();
  let doc;
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.handlers = new Map();
      this.style = { setProperty() {} }; this.isConnected = false;
    }
    appendChild(node) { node.parent = this; node.isConnected = true; this.children.push(node); return node; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, value) { this.handlers.set(key, value); }
    removeEventListener(key, value) { if (this.handlers.get(key) === value) this.handlers.delete(key); }
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
    focus() { doc.activeElement = this; }
    set src(value) { this._src = value; requests.push(value); }
    get src() { return this._src; }
  }
  doc = {
    body: new Element('body'), activeElement: new Element('button'),
    createElement: tag => new Element(tag),
    addEventListener: (key, value) => listeners.set(key, value),
    removeEventListener: (key, value) => { if (listeners.get(key) === value) listeners.delete(key); }
  };
  doc.activeElement.isConnected = true;
  const initialFocus = doc.activeElement;
  const context = vm.createContext({
    document: doc, Promise, matchMedia: () => ({ matches: reducedMotion }),
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, time: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const entries = [...timers].filter(([, t]) => t.time <= end).sort((a, b) => a[1].time - b[1].time);
      if (!entries.length) break;
      const [id, timer] = entries[0]; timers.delete(id); now = timer.time; timer.fn();
    }
    now = end;
  }
  function find(predicate, parent = doc.body) {
    for (const child of parent.children) {
      if (predicate(child)) return child;
      const result = find(predicate, child); if (result) return result;
    }
    return null;
  }
  function key(value) {
    const event = { key: value, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }
    };
    if (listeners.get('keydown')) listeners.get('keydown')(event);
    return event;
  }
  return { api: context.MDOpening, context, doc, timers, requests, listeners, advance, find, key, initialFocus };
}

test('opening is lazy, reentrant, and completes independently of image/network events', async () => {
  const h = harness();
  assert.equal(h.requests.length, 0);
  const run = h.api.play();
  assert.equal(h.api.play(), run);
  assert.equal(h.api.isPlaying, true);
  assert.equal(h.doc.body.children.length, 1);
  const root = h.find(x => x.id === 'openingScreen');
  assert.equal(root.attrs.role, 'dialog');
  assert.equal(root.attrs['aria-modal'], 'true');
  assert.equal(h.doc.activeElement.id, 'openingSkip');
  assert.equal(root.dataset.scene, 'lantern');
  h.advance(2500); assert.equal(root.dataset.scene, 'passage');
  h.advance(3900); assert.equal(root.dataset.scene, 'title');
  h.advance(5600);
  assert.equal((await run).reason, 'completed');
  assert.equal(h.api.isPlaying, false);
  assert.equal(h.doc.body.children.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.doc.activeElement, h.initialFocus);
});

for (const key of ['Escape', 'Enter', ' ', 'Spacebar']) {
  test(`opening ${JSON.stringify(key)} skip consumes key and cleans up immediately`, async () => {
    const h = harness(), run = h.api.play();
    const event = h.key(key);
    assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    assert.equal((await run).reason, 'skipped');
    assert.equal(h.doc.body.children.length, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.key(key).prevented, false); // No lingering input capture.
    h.api.skip(); h.advance(12000); // Double skip and stale deadlines are harmless.
  });
}

test('opening click-anywhere skips and replay creates a fresh lifecycle', async () => {
  const h = harness(), run = h.api.play();
  const root = h.find(x => x.id === 'openingScreen');
  let prevented = false, stopped = false;
  root.handlers.get('click')({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal((await run).reason, 'skipped');
  assert.ok(prevented && stopped);
  const replay = h.api.play(); assert.notEqual(replay, run);
  h.api.skip(); assert.equal((await replay).reason, 'skipped');
});

test('opening traps Tab on its single skip control', async () => {
  const h = harness(), run = h.api.play();
  const event = h.key('Tab'); assert.ok(event.prevented && event.stopped);
  assert.equal(h.doc.activeElement.id, 'openingSkip');
  h.api.skip(); await run;
});

test('opening isolates ordinary game keys without ending the sequence', async () => {
  const h = harness(), run = h.api.play();
  for (const key of ['ArrowRight', 'w', 'i']) {
    const event = h.key(key); assert.equal(event.stopped, true);
    assert.equal(h.api.isPlaying, true);
  }
  h.api.skip(); await run;
  assert.equal(h.key('ArrowRight').stopped, false);
});

test('explicit and system reduced motion show a short static title', async () => {
  for (const useMedia of [false, true]) {
    const h = harness({ reducedMotion: useMedia });
    const run = h.api.play({ reducedMotion: !useMedia });
    const root = h.find(x => x.id === 'openingScreen');
    assert.equal(root.dataset.scene, 'title'); assert.ok(root.className.includes('is-static'));
    h.advance(799); assert.equal(h.api.isPlaying, true);
    h.advance(1); assert.equal((await run).reason, 'completed');
    assert.equal(h.timers.size, 0);
  }
});

test('missing portrait falls back to a centered title, without failing or extending the opening', async () => {
  const h = harness(), run = h.api.play();
  const root = h.find(x => x.id === 'openingScreen');
  const portrait = h.find(x => x.src === 'assets/runtime/opening/whale-maid.png');
  portrait.onerror(); assert.equal(portrait.hidden, true); assert.equal(root.dataset.art, 'fallback');
  h.advance(12000); assert.equal((await run).reason, 'completed');
  assert.equal(portrait.onerror, null); assert.equal(h.listeners.size, 0);
});

test('mount failure resolves safely and clears active-run state', async () => {
  const h = harness(); h.doc.createElement = () => { throw new Error('DOM unavailable'); };
  assert.equal((await h.api.play()).reason, 'error');
  assert.equal(h.api.isPlaying, false); assert.equal(h.timers.size, 0);
  const empty = vm.createContext({ Promise }); vm.runInContext(source, empty);
  assert.equal((await empty.MDOpening.play()).reason, 'unavailable');
});

test('opening assets resolve to real PNG bytes and no private references are published', () => {
  const h = harness(); h.api.play(); h.api.skip();
  const css = fs.readFileSync(path.join(ROOT, 'css/opening.css'), 'utf8');
  const assets = [...h.requests, ...[...css.matchAll(/url\('\.\.\/(assets\/[^']+)'\)/g)].map(m => m[1])];
  for (const asset of assets) {
    const bytes = fs.readFileSync(path.join(ROOT, asset));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', asset);
  }
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'assets/runtime/opening')), ['whale-maid.png']);
  assert.doesNotMatch(source + css, /drive\.google\.com|sediment:\/\/|https:\/\//);
});
