/* A self-contained, silent paper-theatre opening. Nothing here starts a game. */
(function (global) {
  'use strict';

  const DURATION_MS = 12000;
  const STATIC_DURATION_MS = 800;
  let current = null;

  function play(options) {
    if (current) return current.promise;
    options = options || {};
    const doc = global.document;
    if (!doc || !doc.body) return Promise.resolve({ reason: 'unavailable' });

    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const run = { promise, finish: null };
    current = run;
    let root, skip, previousFocus, finished = false;
    const timers = [];
    const images = [];
    const schedule = (fn, delay) => timers.push(global.setTimeout(fn, delay));

    function finish(reason) {
      if (finished) return;
      finished = true;
      timers.forEach(id => global.clearTimeout(id));
      images.forEach(img => { img.onerror = null; img.onload = null; });
      doc.removeEventListener('keydown', onKey, true);
      if (root) {
        root.removeEventListener('click', onClick);
        root.remove();
      }
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
        try { previousFocus.focus({ preventScroll: true }); } catch (_) { /* Focus is best effort. */ }
      }
      if (current === run) current = null;
      resolve({ reason });
    }
    run.finish = finish;

    function onClick(event) {
      event.preventDefault();
      event.stopPropagation();
      finish('skipped');
    }

    function onKey(event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        skip.focus({ preventScroll: true });
      } else if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        // Consume the dismissing key before it can activate the menu or move a player.
        event.preventDefault();
        event.stopImmediatePropagation();
        finish('skipped');
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        // A replay may sit above an already-mounted game. Keep ordinary movement
        // keys inside the opening, without intercepting browser shortcuts.
        event.stopImmediatePropagation();
      }
    }

    function element(tag, className, parent, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      if (parent) parent.appendChild(node);
      return node;
    }

    function picture(src, className, parent) {
      const img = element('img', className, parent);
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.onerror = () => {
        // Optional art cannot delay or block the deterministic finish deadline.
        img.hidden = true;
        if (root && className === 'md-opening-full-art') root.dataset.art = 'fallback';
      };
      images.push(img);
      img.src = src;
      return img;
    }

    try {
      const english = String(options.locale || (global.MD && global.MD.locale) || '').startsWith('en');
      const copy = Object.assign(english ? {
        label: 'Mystery Dungeon opening', skip: 'Skip opening', hint: 'Click anywhere · Esc',
        lantern: 'A little light.', passage: 'An unwritten journey.',
        title: 'Mystery Dungeon', subtitle: 'One step into the unknown', chapter: 'THE ADVENTURE BEGINS'
      } : {
        label: '迷宫开场动画', skip: '跳过片头', hint: '点击任意处 · Esc',
        lantern: '循着微光', passage: '走向未知的下一步',
        title: '迷宫', subtitle: '每一步，都是新的故事', chapter: 'THE ADVENTURE BEGINS'
      }, options.copy || {});
      const reduced = options.reducedMotion === true || (typeof global.matchMedia === 'function' && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
      previousFocus = doc.activeElement;
      root = element('section', 'md-opening' + (reduced ? ' is-static' : ''), doc.body);
      root.id = 'openingScreen';
      root.dataset.scene = reduced ? 'title' : 'lantern';
      root.dataset.art = 'ready';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', copy.label);

      // Visual layers have one concise accessible label; the skip control is the only focus target.
      const theatre = element('div', 'md-opening-theatre', root);
      theatre.setAttribute('aria-hidden', 'true');

      const night = element('div', 'md-opening-shot md-opening-night', theatre);
      element('div', 'md-opening-orbit', night);
      element('div', 'md-opening-lantern-glow', night);
      const lantern = element('div', 'md-opening-lantern', night);
      picture('assets/runtime/lantern.png', '', lantern);
      element('p', 'md-opening-caption', night, copy.lantern);

      const passage = element('div', 'md-opening-shot md-opening-passage', theatre);
      const corridor = element('div', 'md-opening-corridor', passage);
      element('div', 'md-opening-floor', corridor);
      element('div', 'md-opening-portal', corridor);
      for (let i = 0; i < 3; i++) element('div', 'md-opening-arch md-opening-arch-' + i, corridor);
      const traveller = element('div', 'md-opening-traveller', corridor);
      element('div', 'md-opening-traveller-shadow', traveller);
      element('div', 'md-opening-sprite', traveller);
      element('p', 'md-opening-caption', passage, copy.passage);

      const title = element('div', 'md-opening-shot md-opening-title', theatre);
      element('div', 'md-opening-map-lines', title);
      element('div', 'md-opening-disc', title);
      const portrait = element('div', 'md-opening-portrait', title);
      picture('assets/runtime/opening/whale-maid.png', 'md-opening-full-art', portrait);
      const lockup = element('div', 'md-opening-lockup' + (english ? ' is-english' : ''), title);
      element('span', 'md-opening-compass', lockup);
      element('p', 'md-opening-chapter', lockup, copy.chapter);
      element('h1', 'md-opening-game-title', lockup, copy.title);
      if (!english) element('p', 'md-opening-roman-title', lockup, 'MYSTERY DUNGEON');
      element('span', 'md-opening-rule', lockup);
      element('p', 'md-opening-subtitle', lockup, copy.subtitle);

      const motes = element('div', 'md-opening-motes', theatre);
      for (let i = 0; i < 12; i++) {
        const mote = element('i', '', motes);
        mote.style.setProperty('--i', String(i));
      }
      element('div', 'md-opening-vignette', theatre);
      element('div', 'md-opening-letterbox md-opening-letterbox-top', theatre);
      element('div', 'md-opening-letterbox md-opening-letterbox-bottom', theatre);
      const controls = element('div', 'md-opening-controls', root);
      element('span', 'md-opening-hint', controls, copy.hint);
      skip = element('button', 'md-opening-skip', controls, copy.skip);
      skip.id = 'openingSkip';
      skip.type = 'button';
      const progress = element('div', 'md-opening-progress', root);
      progress.setAttribute('aria-hidden', 'true');
      element('span', '', progress);
      root.addEventListener('click', onClick);
      doc.addEventListener('keydown', onKey, true);
      skip.focus({ preventScroll: true });

      if (!reduced) {
        schedule(() => { root.dataset.scene = 'passage'; }, 2500);
        schedule(() => { root.dataset.scene = 'title'; }, 6400);
      }
      // A wall-clock timeout, rather than animationend or any image promise, owns completion.
      schedule(() => finish('completed'), reduced ? STATIC_DURATION_MS : DURATION_MS);
    } catch (_) {
      finish('error');
    }
    return promise;
  }

  global.MDOpening = Object.freeze({
    play,
    skip() { if (current) current.finish('skipped'); },
    get isPlaying() { return current !== null; },
    durationMs: DURATION_MS
  });
})(typeof window !== 'undefined' ? window : globalThis);
