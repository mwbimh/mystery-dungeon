'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js/dialogue.js'), 'utf8');
const content = fs.readFileSync(path.join(ROOT, 'js/town-content.js'), 'utf8');

function harness() {
  const listeners = new Map();
  let doc;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {};
      this.dataset = {}; this.handlers = new Map(); this.inert = false; this.hidden = false;
      this.parentElement = null; this.textContent = ''; this.className = '';
    }
    get isConnected() { return this === doc.body || !!(this.parentElement && this.parentElement.isConnected); }
    appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
    replaceChildren() { this.children.forEach(node => { node.parentElement = null; }); this.children = []; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] === undefined ? null : this.attrs[key]; }
    addEventListener(key, value) { const list = this.handlers.get(key) || []; list.push(value); this.handlers.set(key, list); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
    focus() { doc.activeElement = this; }
    click() { for (const handler of this.handlers.get('click') || []) handler({ target: this, stopPropagation() {}, preventDefault() {} }); }
  }
  doc = {
    createElement: tag => new Element(tag),
    addEventListener(key, value) { const list = listeners.get(key) || []; list.push(value); listeners.set(key, list); },
    removeEventListener(key, value) { const list = (listeners.get(key) || []).filter(x => x !== value); if (list.length) listeners.set(key, list); else listeners.delete(key); }
  };
  doc.body = new Element('body');
  const background = doc.body.appendChild(new Element('main'));
  const opener = background.appendChild(new Element('button'));
  doc.activeElement = opener;
  const context = vm.createContext({ document: doc, console });
  vm.runInContext(source, context); vm.runInContext(content, context);
  function find(className, parent = doc.body) {
    if (parent.className.split(' ').includes(className)) return parent;
    for (const child of parent.children) { const found = find(className, child); if (found) return found; }
    return null;
  }
  function event(type, values = {}) {
    const e = { target: doc.activeElement, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
    for (const handler of [...listeners.get(type) || []]) { handler(e); if (e.stopped) break; }
    return e;
  }
  function key(key, values = {}) { const e = event('keydown', { key, ...values }); event('keyup', { key, ...values }); return e; }
  return { api: context.PaperDialogue, content: context.MDTownContent, doc, background, opener, listeners, find, event, key, Element };
}
const scene = () => ({ id: 'demo', speaker: '测试旅人', role: '向导', portrait: 'portrait.png', start: 'hello', nodes: {
  hello: { text: '<b>只是文字，不是 HTML</b>', next: 'choice' },
  choice: { text: '走哪一条路？', choices: [
    { id: 'left', label: '左边', next: 'ending' }, { id: 'storage', label: '仓库', action: 'warehouse', payload: { tab: 'stored' } }
  ] },
  ending: { text: '下次见。' }
} });

test('standalone component has no MD dependency and mounts lazily', () => {
  const h = harness(), d = h.api.create();
  assert.equal(h.doc.body.children.length, 1); assert.equal(d.isOpen(), false);
  assert.equal(d.open(scene(), { trigger: h.opener }), true);
  const root = h.find('pvn-overlay');
  assert.equal(root.attrs.role, 'dialog'); assert.equal(root.attrs['aria-modal'], 'true');
  assert.equal(h.find('pvn-text').textContent, '<b>只是文字，不是 HTML</b>');
  assert.equal(h.find('pvn-speaker').textContent, '测试旅人');
  assert.equal(h.background.inert, true);
  assert.equal(h.doc.activeElement, h.find('pvn-next'));
  d.close(); assert.equal(h.background.inert, false); assert.equal(h.doc.activeElement, h.opener);
  assert.equal(h.listeners.size, 0); assert.equal(d.close(), false);
});

test('branches and action callbacks return context only after full modal teardown', () => {
  const h = harness(), events = [];
  const d = h.api.create({
    onClose: value => events.push(['close', value.reason]),
    onAction: value => {
      assert.equal(d.isOpen(), false); assert.equal(h.background.inert, false); assert.equal(h.find('pvn-overlay'), null);
      events.push(['action', value]);
    }
  });
  d.open(scene(), { context: { npc: 'test' } });
  assert.equal(d.advance(), true); assert.equal(d.getState().nodeId, 'choice');
  assert.equal(d.advance(), false); assert.equal(d.choose(-1), false); assert.equal(d.choose('unknown'), false);
  assert.equal(d.choose('storage'), true);
  assert.equal(events[0][1], 'action');
  const action = events[1][1];
  assert.equal(action.action, 'warehouse'); assert.equal(action.sceneId, 'demo');
  assert.equal(action.nodeId, 'choice'); assert.equal(action.choiceId, 'storage');
  assert.equal(action.context.npc, 'test'); assert.equal(action.payload.tab, 'stored');
  assert.equal(d.choose('storage'), false); // No stale action invocation.
});

for (const key of ['Enter', ' ', 'Spacebar']) {
  test(`${JSON.stringify(key)} advances once, selects focused branch and closes at the end`, () => {
    const h = harness(), d = h.api.create(); d.open(scene());
    assert.equal(h.key(key).prevented, true); assert.equal(d.getState().nodeId, 'choice');
    assert.equal(h.key(key).stopped, true); assert.equal(d.getState().nodeId, 'ending');
    h.key(key); assert.equal(d.isOpen(), false); assert.equal(h.listeners.size, 0);
  });
}

test('held dismissal key is drained until release; autorepeat cannot leak into game', () => {
  const h = harness(), d = h.api.create(); d.open(scene());
  const close = h.event('keydown', { key: 'Escape' });
  assert.ok(close.prevented && close.stopped); assert.equal(d.isOpen(), false);
  const repeat = h.event('keydown', { key: 'Escape', repeat: true }); assert.ok(repeat.prevented && repeat.stopped);
  const release = h.event('keyup', { key: 'Escape' }); assert.ok(release.prevented && release.stopped);
  assert.equal(h.listeners.size, 0); assert.equal(h.key('Escape').stopped, false);
});

test('focus cycles through choices and close, with arrow and number selection', () => {
  const h = harness(), d = h.api.create(); d.open(scene()); d.advance();
  const choices = h.find('pvn-choices').children;
  assert.equal(h.doc.activeElement, choices[0]);
  h.key('ArrowDown'); assert.equal(h.doc.activeElement, choices[1]);
  h.key('Tab'); assert.equal(h.doc.activeElement, h.find('pvn-close'));
  h.key('Tab'); assert.equal(h.doc.activeElement, choices[0]);
  h.key('Tab', { shiftKey: true }); assert.equal(h.doc.activeElement, h.find('pvn-close'));
  h.opener.focus(); h.event('focusin'); assert.equal(h.doc.activeElement, choices[0]);
  h.key('1'); assert.equal(d.getState().nodeId, 'ending');
  d.close();
});

test('normal game keys are isolated while browser shortcuts keep their native default', () => {
  const h = harness(), d = h.api.create(); d.open(scene());
  for (const key of ['w', 'i', '.', 'Shift', 'ArrowUp']) {
    const e = h.key(key); assert.ok(e.prevented && e.stopped); assert.equal(d.getState().nodeId, 'hello');
  }
  const shortcut = h.key('r', { ctrlKey: true }); assert.equal(shortcut.prevented, false); assert.equal(shortcut.stopped, true);
  h.key('Enter', { repeat: true }); assert.equal(d.getState().nodeId, 'hello');
  h.key('Enter', { isComposing: true }); assert.equal(d.getState().nodeId, 'hello');
  d.destroy(); assert.equal(h.listeners.size, 0); assert.equal(h.key('w').stopped, false);
});

test('reopen replaces current conversation; multiple controllers do not stack or inherit state', () => {
  const h = harness(), reasons = [], d = h.api.create({ onClose: e => reasons.push(e.reason) });
  d.open(scene()); d.advance(); d.open(scene());
  assert.equal(d.getState().nodeId, 'hello'); assert.deepEqual(reasons, ['replaced']);
  assert.equal(h.doc.body.children.filter(x => x.className === 'pvn-overlay').length, 1);
  const second = h.api.create(); second.open(scene());
  assert.equal(d.isOpen(), false); assert.equal(second.isOpen(), true); assert.equal(h.background.inert, true);
  second.close(); assert.equal(h.background.inert, false); assert.equal(h.listeners.size, 0);
  assert.equal(h.doc.activeElement, h.opener);
});

test('portrait failure and unsafe optional URL fall back without blocking conversation', () => {
  const h = harness(), d = h.api.create(); d.open(scene());
  const image = h.find('pvn-portrait-image'); image.onerror();
  assert.equal(image.hidden, true); assert.equal(h.find('pvn-portrait-fallback').hidden, false);
  d.advance(); assert.equal(image.hidden, true); assert.equal(h.find('pvn-portrait-fallback').hidden, false);
  d.close(); assert.equal(image.onerror, null);
  const unsafe = scene(); unsafe.portrait = 'javascript:alert(1)'; d.open(unsafe);
  assert.equal(h.find('pvn-portrait-image').getAttribute('src'), null);
  assert.equal(h.find('pvn-portrait-fallback').hidden, false); d.close();
});

test('original inert states and custom mount ancestors are restored without changing content', () => {
  const h = harness(); h.background.inert = true;
  const other = h.doc.body.appendChild(new h.Element('section'));
  const mount = other.appendChild(new h.Element('div'));
  const sibling = other.appendChild(new h.Element('aside'));
  const d = h.api.create({ mount }); d.open(scene());
  assert.equal(sibling.inert, true); assert.equal(other.inert, false);
  d.close(); assert.equal(h.background.inert, true); assert.equal(sibling.inert, false);
});

test('invalid scenes fail before replacing a valid one and destroy is final', () => {
  const h = harness(), d = h.api.create(); d.open(scene());
  const invalid = scene(); invalid.nodes.hello.next = 'missing';
  assert.throws(() => d.open(invalid), /missing node/); assert.equal(d.isOpen(), true);
  assert.throws(() => h.api.validate({}), /nodes/);
  const badChoice = scene(); badChoice.nodes.choice.choices = [null];
  assert.throws(() => h.api.validate(badChoice), /invalid choice/);
  d.destroy(); assert.equal(d.isOpen(), false); assert.equal(h.listeners.size, 0);
  assert.throws(() => d.open(scene()), /destroyed/);
});

test('all six town identities resolve to valid immutable content and existing portrait files', () => {
  const h = harness();
  assert.deepEqual([...h.content.names].sort(), ['ChatGPT', 'Claude', 'DeepSeek', 'DeepSeek Harness', 'GLM', 'Kimi'].sort());
  assert.equal(h.content.get('not-a-person'), null); assert.equal(h.content.get('__proto__'), null);
  const actions = new Set();
  for (const name of h.content.names) {
    const data = h.content.get(name); h.api.validate(data);
    assert.equal(Object.isFrozen(data), true); assert.equal(Object.isFrozen(data.nodes.hello), true);
    assert.ok(fs.existsSync(path.join(ROOT, data.portrait)), data.portrait);
    const visited = new Set(), queue = [data.start];
    while (queue.length) {
      const id = queue.shift(); if (visited.has(id)) continue; visited.add(id);
      const node = data.nodes[id];
      for (const edge of [node].concat(node.choices || [])) {
        if (edge.next) queue.push(edge.next); if (edge.action) actions.add(edge.action);
      }
    }
    assert.equal(visited.size, Object.keys(data.nodes).length, name + ' has no unreachable authored node');
    const d = h.api.create(); d.open(data); assert.equal(d.isOpen(), true); d.destroy();
  }
  assert.deepEqual([...actions], ['warehouse']); // No shop, currency or forging system was added.
});

test('window blur clears release protection and detached triggers are not refocused', () => {
  const h = harness(), d = h.api.create(); d.open(scene());
  h.opener.remove(); h.event('keydown', { key: 'Escape' });
  assert.equal(d.isOpen(), false);
  h.event('blur', { target: h.doc });
  assert.equal(h.listeners.size, 0);
  assert.notEqual(h.doc.activeElement, h.opener);
});

test('mount failure and missing document do not strand active state or listeners', () => {
  const h = harness(), d = h.api.create();
  const append = h.doc.body.appendChild;
  h.doc.body.appendChild = () => { throw new Error('mount failed'); };
  assert.throws(() => d.open(scene()), /mount failed/);
  assert.equal(d.isOpen(), false); assert.equal(h.listeners.size, 0); assert.equal(h.background.inert, false);
  h.doc.body.appendChild = append; d.open(scene()); d.close();
  const empty = vm.createContext({}); vm.runInContext(source, empty);
  assert.throws(() => empty.PaperDialogue.create().open(scene()), /mounted document/);
});

test('click controls close, branch, and reopen with no stale state', () => {
  const h = harness(), d = h.api.create(); d.open(scene());
  h.find('pvn-next').click(); assert.equal(d.getState().nodeId, 'choice');
  h.find('pvn-choices').children[0].click(); assert.equal(d.getState().nodeId, 'ending');
  h.find('pvn-close').click(); assert.equal(d.isOpen(), false); assert.equal(h.listeners.size, 0);
  d.open(scene()); assert.equal(d.getState().nodeId, 'hello');
  d.destroy();
});
