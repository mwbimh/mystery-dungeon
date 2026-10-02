/* PaperDialogue: framework-free visual novel UI. No game or content dependency. */
(function (global) {
  'use strict';
  let sequence = 0;
  const owners = new WeakMap();
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function validate(scene) {
    if (!scene || typeof scene !== 'object' || !scene.nodes || typeof scene.nodes !== 'object') {
      throw new TypeError('PaperDialogue: scene.nodes is required');
    }
    const ids = Object.keys(scene.nodes);
    const start = scene.start || ids[0];
    if (!start || !own(scene.nodes, start)) throw new Error('PaperDialogue: invalid start node');
    ids.forEach(id => {
      const node = scene.nodes[id];
      if (!node || typeof node.text !== 'string') throw new TypeError('PaperDialogue: node ' + id + ' needs text');
      if (node.choices !== undefined && !Array.isArray(node.choices)) throw new TypeError('PaperDialogue: choices must be an array');
      const links = [node].concat(node.choices || []);
      links.forEach((link, index) => {
        if (!link || typeof link !== 'object') throw new TypeError('PaperDialogue: invalid choice in ' + id);
        if (index && typeof link.label !== 'string') throw new TypeError('PaperDialogue: choice needs a label');
        if (link.next !== undefined && link.next !== null && !own(scene.nodes, link.next)) {
          throw new Error('PaperDialogue: missing node ' + link.next);
        }
        if (link.action !== undefined && (typeof link.action !== 'string' || !link.action)) {
          throw new TypeError('PaperDialogue: action must be a nonempty string');
        }
      });
    });
    return start;
  }

  function create(options) {
    options = options || {};
    const doc = options.document || global.document;
    const mount = options.mount || (doc && doc.body);
    const inputTarget = doc && (doc.defaultView || doc);
    const id = 'pvn-' + (++sequence);
    const copy = Object.assign({
      close: '结束交谈', next: '继续', finish: '下次再聊', choose: '你想说些什么？',
      hint: '空格 / Enter 继续 · ↑↓ 选择 · Esc 离开', chapter: '小镇絮语'
    }, options.labels || {});
    let current = null, destroyed = false, listening = false;
    const heldKeys = new Set();

    function notify(name, value) {
      if (typeof options[name] !== 'function') return;
      try { options[name](value); }
      catch (error) {
        if (typeof options.onError === 'function') options.onError(error);
        else if (global.console && global.console.error) global.console.error('PaperDialogue host callback failed:', error);
      }
    }
    function consume(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function focus(element) {
      if (!element || typeof element.focus !== 'function') return;
      try { element.focus({ preventScroll: true }); } catch (_) { element.focus(); }
    }
    function listen() {
      if (listening) return;
      inputTarget.addEventListener('keydown', onKeyDown, true);
      inputTarget.addEventListener('keyup', onKeyUp, true);
      inputTarget.addEventListener('blur', onBlur, true);
      doc.addEventListener('focusin', onFocus, true);
      listening = true;
    }
    function unlisten() {
      if (!listening) return;
      inputTarget.removeEventListener('keydown', onKeyDown, true);
      inputTarget.removeEventListener('keyup', onKeyUp, true);
      inputTarget.removeEventListener('blur', onBlur, true);
      doc.removeEventListener('focusin', onFocus, true);
      listening = false;
    }
    function onBlur(event) {
      // Element blur also travels through capture; only a window blur ends held keys.
      if (event.target !== inputTarget) return;
      heldKeys.clear();
      if (!current) unlisten();
    }
    function onFocus(event) {
      if (current && !current.root.contains(event.target)) focus(current.controls[0] || current.closeButton);
    }
    function cycle(items, direction) {
      const index = items.indexOf(doc.activeElement);
      const target = items[index < 0 ? (direction > 0 ? 0 : items.length - 1) : (index + direction + items.length) % items.length];
      focus(target);
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function onKeyDown(event) {
      if (!current) {
        // Consume the repeated closing key until physical release, preventing a held
        // Enter/Space from immediately starting a run or taking a game turn.
        if (heldKeys.has(event.key)) consume(event);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || /^F\d{1,2}$/.test(event.key)) {
        event.stopImmediatePropagation(); // Keep browser shortcuts usable.
        return;
      }
      consume(event);
      heldKeys.add(event.key);
      if (event.repeat || event.isComposing) return;
      if (event.key === 'Escape') { close('dismissed'); return; }
      if (event.key === 'Tab') { cycle(current.controls.concat(current.closeButton), event.shiftKey ? -1 : 1); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { cycle(current.controls, 1); return; }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { cycle(current.controls, -1); return; }
      if (/^[1-9]$/.test(event.key) && current.node.choices && current.node.choices.length) {
        choose(Number(event.key) - 1); return;
      }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        if (doc.activeElement === current.closeButton) { close('dismissed'); return; }
        if (current.node.choices && current.node.choices.length) {
          const index = current.controls.indexOf(doc.activeElement);
          choose(index < 0 ? 0 : index);
        } else advance();
      }
    }
    function onKeyUp(event) {
      if (current || heldKeys.has(event.key)) {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) consume(event);
        heldKeys.delete(event.key);
      }
      if (!current && !heldKeys.size) unlisten();
    }
    function element(tag, className, parent, text) {
      const node = doc.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      if (parent) parent.appendChild(node);
      return node;
    }
    function inertBackground(root) {
      const saved = [];
      // Also isolate siblings of a custom mount, up to body. Never inert our root.
      let branch = root;
      while (branch && branch !== doc.body) {
        const parent = branch.parentElement;
        if (!parent) break;
        Array.from(parent.children).forEach(sibling => {
          if (sibling === branch || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) return;
          saved.push({ node: sibling, inert: sibling.inert });
          sibling.inert = true;
        });
        branch = parent;
      }
      return saved;
    }
    function safePortrait(src) {
      if (typeof src !== 'string' || !src.trim()) return null;
      // Remote image URLs and project-relative files are allowed; executable/data
      // documents are not. A broken optional portrait never blocks conversation.
      if (/^(?:javascript|vbscript|data|blob):/i.test(src.trim())) return null;
      return src;
    }
    function render(nodeId) {
      const run = current;
      if (!run) return;
      const node = run.scene.nodes[nodeId];
      run.nodeId = nodeId;
      run.node = node;
      run.root.dataset.node = nodeId;
      const speaker = node.speaker || run.scene.speaker || '';
      run.speaker.textContent = speaker;
      run.role.textContent = node.role || run.scene.role || '';
      run.text.textContent = node.text;
      run.counter.textContent = String(++run.step).padStart(2, '0');
      run.fallback.textContent = speaker ? Array.from(speaker)[0] : '✦';
      const src = safePortrait(node.portrait === undefined ? run.scene.portrait : node.portrait);
      const hasPortrait = !!src && !run.failedPortraits.has(src);
      run.image.hidden = !hasPortrait;
      run.fallback.hidden = hasPortrait;
      run.image.onerror = () => {
        if (current !== run) return;
        run.failedPortraits.add(src);
        run.image.hidden = true;
        run.fallback.hidden = false;
      };
      if (hasPortrait && run.image.getAttribute('src') !== src) run.image.setAttribute('src', src);
      run.choices.replaceChildren();
      run.controls = [];
      const choices = node.choices || [];
      run.prompt.hidden = !choices.length;
      run.nextButton.hidden = !!choices.length;
      choices.forEach((choice, index) => {
        const button = element('button', 'pvn-choice', run.choices);
        button.type = 'button';
        button.dataset.choice = choice.id || String(index);
        element('span', 'pvn-choice-number', button, String(index + 1).padStart(2, '0')).setAttribute('aria-hidden', 'true');
        element('span', 'pvn-choice-label', button, choice.label);
        element('span', 'pvn-choice-arrow', button, '↗').setAttribute('aria-hidden', 'true');
        button.addEventListener('click', () => choose(index));
        run.controls.push(button);
      });
      if (!choices.length) {
        run.nextButton.textContent = node.next ? copy.next + '  →' : copy.finish + '  ↗';
        run.controls.push(run.nextButton);
      }
      run.card.scrollTop = 0;
      focus(run.controls[0]);
      notify('onNode', getState());
    }
    function open(scene, openOptions) {
      if (destroyed) throw new Error('PaperDialogue: controller has been destroyed');
      const start = validate(scene); // Validate before replacing an existing valid scene.
      if (!doc || !mount || !inputTarget) throw new Error('PaperDialogue: a mounted document is required');
      const previous = owners.get(doc);
      if (previous) previous.close('replaced');
      openOptions = openOptions || {};
      const root = element('section', 'pvn-overlay', null);
      root.id = id;
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', id + '-speaker');
      root.setAttribute('aria-describedby', id + '-text');
      root.dataset.scene = scene.id || '';
      if (options.reducedMotion) root.className += ' pvn-reduced-motion';
      const stage = element('div', 'pvn-stage', root);
      const portrait = element('div', 'pvn-portrait', stage);
      portrait.setAttribute('aria-hidden', 'true');
      const fallback = element('div', 'pvn-portrait-fallback', portrait);
      const image = element('img', 'pvn-portrait-image', portrait);
      image.alt = ''; image.draggable = false;
      const card = element('div', 'pvn-card', stage);
      const heading = element('div', 'pvn-heading', card);
      element('span', 'pvn-chapter', heading, scene.title || copy.chapter);
      const counter = element('span', 'pvn-counter', heading, '01');
      counter.setAttribute('aria-hidden', 'true');
      const closeButton = element('button', 'pvn-close', heading, '×');
      closeButton.type = 'button'; closeButton.setAttribute('aria-label', copy.close);
      closeButton.title = copy.close + ' · Esc';
      closeButton.addEventListener('click', () => close('dismissed'));
      const signature = element('div', 'pvn-signature', card);
      const speaker = element('h2', 'pvn-speaker', signature);
      speaker.id = id + '-speaker';
      const role = element('span', 'pvn-role', signature);
      const text = element('p', 'pvn-text', card);
      text.id = id + '-text';
      text.setAttribute('aria-live', 'polite'); text.setAttribute('aria-atomic', 'true');
      const prompt = element('p', 'pvn-prompt', card, copy.choose);
      const choices = element('div', 'pvn-choices', card);
      const footer = element('div', 'pvn-footer', card);
      element('span', 'pvn-key-hint', footer, copy.hint);
      const nextButton = element('button', 'pvn-next', footer);
      nextButton.type = 'button'; nextButton.addEventListener('click', advance);
      ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu'].forEach(type => {
        root.addEventListener(type, event => event.stopPropagation());
      });
      current = {
        scene, root, card, speaker, role, text, prompt, choices, closeButton, nextButton,
        counter, image, fallback, node: null, nodeId: null, step: 0, controls: [], savedInert: [],
        failedPortraits: new Set(), context: openOptions.context, previousFocus: openOptions.trigger || doc.activeElement
      };
      owners.set(doc, api);
      try {
        mount.appendChild(root);
        current.savedInert = inertBackground(root);
        listen();
        render(start);
      } catch (error) { close('error'); throw error; }
      notify('onOpen', getState());
      return true;
    }
    function follow(link, choiceId) {
      if (!current) return false;
      if (link.action) {
        const event = {
          action: link.action, payload: link.payload, context: current.context,
          sceneId: current.scene.id || null, nodeId: current.nodeId, choiceId: choiceId || null
        };
        // Host actions run after restoring background and focus, so a warehouse or
        // future shop can mount its own independent UI without nested modals.
        close('action');
        notify('onAction', event);
      } else if (link.next !== undefined && link.next !== null) render(link.next);
      else close('completed');
      return true;
    }
    function advance() {
      if (!current || (current.node.choices && current.node.choices.length)) return false;
      return follow(current.node, null);
    }
    function choose(indexOrId) {
      if (!current || !current.node.choices) return false;
      const choices = current.node.choices;
      const index = typeof indexOrId === 'number' ? indexOrId : choices.findIndex(choice => choice.id === indexOrId);
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) return false;
      return follow(choices[index], choices[index].id || String(index));
    }
    function close(reason) {
      if (!current) return false;
      const run = current;
      current = null;
      if (owners.get(doc) === api) owners.delete(doc);
      run.image.onerror = null;
      run.root.remove();
      run.savedInert.forEach(saved => { saved.node.inert = saved.inert; });
      if (!heldKeys.size) unlisten();
      if (run.previousFocus && run.previousFocus.isConnected && !run.previousFocus.inert) focus(run.previousFocus);
      notify('onClose', { reason: reason || 'closed', sceneId: run.scene.id || null, nodeId: run.nodeId, context: run.context });
      return true;
    }
    function getState() {
      return { open: !!current, sceneId: current ? current.scene.id || null : null, nodeId: current ? current.nodeId : null };
    }
    function destroy() {
      destroyed = true;
      close('destroyed');
      heldKeys.clear();
      unlisten();
    }
    const api = Object.freeze({ open, close, advance, choose, isOpen: () => !!current, getState, destroy });
    return api;
  }
  global.PaperDialogue = Object.freeze({ create, validate, version: '1.0.0' });
})(typeof window !== 'undefined' ? window : globalThis);
