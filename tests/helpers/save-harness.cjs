'use strict';
// A VM exercises the actual config, game and save modules. The DOM and browser
// scheduling below are test doubles, so these checks do not claim browser QA.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');
const plain = value => JSON.parse(JSON.stringify(value));

function element(id = '') {
  const classes = new Set(['hidden']);
  const listeners = {};
  const node = { id, tagName: 'DIV', style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], listeners,
    value: '', checked: false, disabled: false, textContent: '', hidden: false, parentElement: { clientWidth: 800, clientHeight: 600 },
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(event, fn) { (listeners[event] ||= []).push(fn); },
    removeEventListener(event, fn) { listeners[event] = (listeners[event] || []).filter(entry => entry !== fn); },
    removeAttribute(name) { delete this[name]; }, setAttribute(name, value) { this[name] = String(value); },
    focus() {}, remove() {}, click() { if (!this.disabled) { if (this.onclick) this.onclick(); this.dispatch('click'); } },
    dispatch(event, data = {}) { for (const fn of listeners[event] || []) fn({ preventDefault() {}, stopPropagation() {}, target: this, ...data }); },
    querySelectorAll() { return []; }, querySelector() { return element(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 40, height: 40 }; }, getContext() { return {}; },
    classList: { add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }, toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); } },
  };
  Object.defineProperty(node, 'innerHTML', { set() { this.children = []; }, get() { return ''; } });
  return node;
}

async function createHarness(options = {}) {
  const elements = new Map(), created = [], storage = options.storage || new Map(), accesses = [], windowEvents = {}, timers = new Map(), frames = new Map();
  let timerId = 0, frameId = 0;
  const get = id => { const mounted = created.findLast(node => node.id === id); if (mounted) return mounted; if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); };
  const document = { body: element('body'), documentElement: element('html'), hidden: false,
    getElementById: get, createElement: tag => { const node = Object.assign(element(), { tagName: tag.toUpperCase() }); created.push(node); return node; },
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(event, fn) { (windowEvents['document:' + event] ||= []).push(fn); }, removeEventListener() {},
  };
  const localStorage = {
    getItem(key) { accesses.push(['get', key]); if (options.denyStorage) throw new Error('Storage denied'); return storage.get(key) ?? null; },
    setItem(key, value) { accesses.push(['set', key]); if (options.denyStorage) throw new Error('Storage denied'); storage.set(key, String(value)); },
    removeItem(key) { accesses.push(['remove', key]); if (options.denyStorage) throw new Error('Storage denied'); storage.delete(key); },
  };
  const sandbox = { document, console, URLSearchParams, TextEncoder, TextDecoder, structuredClone, Blob, URL,
    navigator: {}, localStorage, location: { search: options.query || '?flat=1&debug=1', reload() {} }, performance: { now: () => 0 },
    fetch: async file => ({ ok: true, text: async () => fs.readFileSync(path.join(ROOT, file.includes('schema.json') ? 'config/schema.json' : 'tests/fixtures/default-config-v2.json'), 'utf8') }),
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); },
    queueMicrotask, devicePixelRatio: 1,
    addEventListener(event, fn) { (windowEvents[event] ||= []).push(fn); },
    removeEventListener(event, fn) { windowEvents[event] = (windowEvents[event] || []).filter(entry => entry !== fn); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    confirm: () => false,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const load = file => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  load('js/config.js');
  await context.MDConfig.boot();
  if (options.beforeGame) await options.beforeGame(context, load);
  for (const file of ['js/themes.js', 'js/map.js', 'js/fov.js', 'js/items.js', 'js/actors.js', 'js/ui.js', 'js/game.js']) load(file);
  const h = { context, MD: context.MD, state: context.MD_STATE, get, storage, accesses, timers, frames, load,
    key(key, extra = {}) { for (const fn of windowEvents.keydown || []) fn({ key, code: key, target: null, preventDefault() {}, ...extra }); },
    emit(event, data = {}) { for (const fn of windowEvents[event] || []) fn(data); },
    async flushTimers(limit = 100) { let count = 0; while (timers.size) { if (++count > limit) throw new Error('Timers did not settle'); const current = [...timers.entries()]; for (const [id, fn] of current) { if (!timers.delete(id)) continue; await fn(); } await Promise.resolve(); } },
  };
  return h;
}
module.exports = { createHarness, element, plain, ROOT };
