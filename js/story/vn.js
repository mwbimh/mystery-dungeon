/* 剧情 — 视觉小说播放器（立绘 + 对话框 + 选项）
 *
 * 剧情数据在 js/story/scenes.js（MD.storyData），这里只负责播放。
 *
 * 对外：
 *   MD.story.trigger(event, ctx)  按事件挑一段没看过/可重复的剧情播放，返回是否播放
 *   MD.story.play(id, onDone)     直接播放某段
 *   MD.story.active()             是否正在播放（播放时游戏输入被拦截）
 *   MD.story.seen / resetSeen()   已看过的剧情（localStorage md_story_v1）
 */
(function (global) {
  const MD = global.MD || (global.MD = {});
  const SEEN_KEY = "md_story_v1";
  const TYPE_MS = 28; // 打字机速度：每字毫秒

  let seen = loadSeen();
  let cur = null; // { scene, i, onDone, typing, timer, full, labels }
  let root, nameEl, textEl, choicesEl, hintEl;
  const slots = {}; // left / right → { el, who }

  function loadSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSeen() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) { /* 隐私模式等 */ }
  }

  function data() { return MD.storyData || { cast: {}, scenes: [] }; }
  function castOf(who) { return (who && data().cast[who]) || null; }

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.id = "vnOverlay";
    root.className = "vn hidden";
    root.innerHTML =
      '<div class="vn-stage">' +
      '<img class="vn-portrait vn-left" alt="" draggable="false">' +
      '<img class="vn-portrait vn-right" alt="" draggable="false">' +
      "</div>" +
      '<div class="vn-box">' +
      '<div class="vn-name"></div>' +
      '<div class="vn-text"></div>' +
      '<div class="vn-choices"></div>' +
      '<div class="vn-hint">▼</div>' +
      '<button type="button" class="vn-skip" title="跳过这段剧情（Esc）">跳过 ▸▸</button>' +
      "</div>";
    document.body.appendChild(root);
    slots.left = { el: root.querySelector(".vn-left"), who: null };
    slots.right = { el: root.querySelector(".vn-right"), who: null };
    nameEl = root.querySelector(".vn-name");
    textEl = root.querySelector(".vn-text");
    choicesEl = root.querySelector(".vn-choices");
    hintEl = root.querySelector(".vn-hint");
    root.addEventListener("click", function (e) {
      if (e.target.closest(".vn-choices") || e.target.closest(".vn-skip")) return;
      advance();
    });
    root.querySelector(".vn-skip").addEventListener("click", function (e) {
      e.stopPropagation();
      finish();
    });
    // 捕获阶段拦截按键，游戏的 keydown 收不到
    window.addEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (!cur) return;
    e.stopImmediatePropagation();
    const k = e.key;
    const btns = choicesEl.querySelectorAll("button");
    if (btns.length) {
      const n = parseInt(k, 10);
      if (n >= 1 && n <= btns.length) { e.preventDefault(); btns[n - 1].click(); return; }
      let idx = Array.prototype.indexOf.call(btns, document.activeElement);
      if (k === "ArrowDown" || k === "ArrowRight" || k === "s" || k === "d") { e.preventDefault(); btns[(idx + 1) % btns.length].focus(); return; }
      if (k === "ArrowUp" || k === "ArrowLeft" || k === "w" || k === "a") { e.preventDefault(); btns[(idx - 1 + btns.length) % btns.length].focus(); return; }
      if (k === "Enter" || k === " " || k === "z") { e.preventDefault(); (btns[idx] || btns[0]).click(); }
      return;
    }
    if (k === "Enter" || k === " " || k === "z" || k === "Z") { e.preventDefault(); advance(); }
    else if (k === "Escape") { e.preventDefault(); finish(); }
  }

  // ---- 立绘 ----
  function slotFor(who, pos) {
    if (pos) return pos;
    if (slots.left.who === who) return "left";
    if (slots.right.who === who) return "right";
    const c = castOf(who);
    if (c && c.side) return c.side;
    return slots.left.who ? "right" : "left";
  }

  /** "kimi:smile" → { who: "kimi", face: "smile" } */
  function parseWho(w) {
    if (!w) return { who: null, face: null };
    const k = String(w).indexOf(":");
    return k < 0 ? { who: w, face: null } : { who: w.slice(0, k), face: w.slice(k + 1) || null };
  }

  /** 差分立绘路径：cast.faces[face] → cast.faceDir 约定（<faceDir><face>.webp）→ 默认 img */
  function faceSrc(who, face) {
    const c = castOf(who);
    if (!c) return null;
    if (!face || face === "default") return c.img;
    if (c.faces && c.faces[face]) return c.faces[face];
    if (c.faceDir) return c.faceDir + face + ".webp";
    return c.img;
  }

  const preloaded = {};
  function preload(src) {
    if (!src || preloaded[src]) return;
    const im = new Image();
    im.src = src;
    preloaded[src] = im;
  }

  function setSrc(el, who, face) {
    const src = faceSrc(who, face);
    if (el.getAttribute("src") === src) return;
    const fallback = castOf(who).img;
    el.onerror = src !== fallback ? function () { el.onerror = null; el.src = fallback; } : null;
    el.src = src;
  }

  function showPortrait(who, pos, face) {
    const c = castOf(who);
    if (!c || !c.img) return null;
    const side = slotFor(who, pos);
    const s = slots[side];
    const other = slots[side === "left" ? "right" : "left"];
    if (other.who === who) { // 换站位：从另一侧撤下
      other.who = null;
      other.el.classList.remove("shown", "talk", "dim");
    }
    if (s.who !== who) {
      s.who = who;
      s.face = face || c.face || null;
      setSrc(s.el, who, s.face);
      s.el.classList.remove("in");
      void s.el.offsetWidth; // 重新触发入场动画
      s.el.classList.add("in");
    } else if (face && face !== s.face) {
      s.face = face; // 同一角色换表情：直接换图，不播入场动画
      setSrc(s.el, who, face);
    }
    s.el.classList.add("shown");
    return side;
  }

  function focusSpeaker(side) {
    ["left", "right"].forEach(function (k) {
      slots[k].el.classList.toggle("dim", !!side && k !== side && !!slots[k].who);
      slots[k].el.classList.toggle("talk", k === side);
    });
  }

  function clearPortraits() {
    ["left", "right"].forEach(function (k) {
      slots[k].who = null;
      slots[k].face = null;
      slots[k].el.onerror = null;
      slots[k].el.removeAttribute("src");
      slots[k].el.className = "vn-portrait vn-" + k;
    });
  }

  // ---- 播放 ----
  function play(id, onDone) {
    const scene = typeof id === "string" ? data().scenes.find(function (s) { return s.id === id; }) : id;
    if (!scene) { if (onDone) onDone(); return false; }
    build();
    if (cur) finish(true);
    const labels = {};
    scene.lines.forEach(function (l, i) { if (l && l.label) labels[l.label] = i; });
    cur = { scene: scene, i: -1, onDone: onDone, typing: false, timer: 0, full: "", labels: labels };
    clearPortraits();
    scene.lines.forEach(function (l) {
      let w = null, f = null;
      if (Array.isArray(l)) { const p = parseWho(l[0]); w = p.who; f = p.face || (l[2] && l[2].face); }
      else if (l && l.show) { const p = parseWho(l.show); w = p.who; f = p.face || l.face; }
      if (w && castOf(w)) preload(faceSrc(w, f));
    });
    (scene.cast || []).forEach(function (w) { const p = parseWho(w); showPortrait(p.who, null, p.face); });
    focusSpeaker(null);
    root.classList.remove("hidden");
    document.body.classList.add("vn-open");
    seen[scene.id] = (seen[scene.id] || 0) + 1;
    saveSeen();
    next();
    return true;
  }

  function next() {
    if (!cur) return;
    const lines = cur.scene.lines;
    for (;;) {
      cur.i++;
      if (cur.i >= lines.length) { finish(); return; }
      const l = lines[cur.i];
      if (!l) continue;
      if (l.label) continue;
      if (l.goto) {
        if (l.goto === "end") { finish(); return; }
        cur.i = cur.labels[l.goto] != null ? cur.labels[l.goto] : lines.length;
        continue;
      }
      if (l.show) {
        const p = parseWho(l.show);
        showPortrait(p.who, l.pos, p.face || l.face);
        continue;
      }
      if (l.leave) {
        ["left", "right"].forEach(function (k) {
          if (slots[k].who === parseWho(l.leave).who) { slots[k].who = null; slots[k].el.classList.remove("shown", "talk", "dim"); }
        });
        continue;
      }
      if (l.choice) { showChoice(l.choice); return; }
      if (Array.isArray(l)) {
        const p = parseWho(l[0]);
        const opt = typeof l[2] === "string" ? { pos: l[2] } : (l[2] || {});
        say(p.who, l[1], opt.pos, p.face || opt.face);
        return;
      }
    }
  }

  function say(who, text, pos, face) {
    const c = castOf(who);
    let side = null;
    if (c) side = showPortrait(who, pos, face);
    focusSpeaker(side);
    nameEl.textContent = c ? c.name : (who || "");
    nameEl.classList.toggle("empty", !nameEl.textContent);
    textEl.classList.toggle("narration", !who);
    choicesEl.innerHTML = "";
    hintEl.classList.remove("show");
    cur.full = text;
    cur.typing = true;
    let n = 0;
    textEl.textContent = "";
    clearInterval(cur.timer);
    cur.timer = setInterval(function () {
      n++;
      textEl.textContent = text.slice(0, n);
      if (n >= text.length) doneTyping();
    }, TYPE_MS);
  }

  function doneTyping() {
    if (!cur) return;
    clearInterval(cur.timer);
    cur.typing = false;
    textEl.textContent = cur.full;
    hintEl.classList.add("show");
  }

  function showChoice(opts) {
    hintEl.classList.remove("show");
    choicesEl.innerHTML = "";
    opts.forEach(function (o, i) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vn-choice";
      b.textContent = o[0];
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        choicesEl.innerHTML = "";
        if (o[1]) cur.i = cur.labels[o[1]] != null ? cur.labels[o[1]] : cur.i;
        next();
      });
      choicesEl.appendChild(b);
      if (i === 0) setTimeout(function () { b.focus(); }, 0);
    });
  }

  function advance() {
    if (!cur) return;
    if (choicesEl.childElementCount) return;
    if (cur.typing) { doneTyping(); return; }
    next();
  }

  function finish(silent) {
    if (!cur) return;
    clearInterval(cur.timer);
    const done = cur.onDone;
    cur = null;
    root.classList.add("hidden");
    document.body.classList.remove("vn-open");
    if (!silent && done) done();
  }

  // ---- 触发 ----
  /** event: "town" | "npc" | "floor"；ctx: { npc, floor, after } */
  function trigger(event, ctx, onDone) {
    ctx = ctx || {};
    if (/(?:\?|&)nostory=1(?:&|$)/.test(location.search)) return false;
    const list = data().scenes.filter(function (s) {
      const t = s.on;
      if (!t || t.event !== event) return false;
      if (t.npc && t.npc !== ctx.npc) return false;
      if (t.floor && t.floor !== ctx.floor) return false;
      if (t.after && t.after !== ctx.after) return false;
      if (t.once && seen[s.id]) return false;
      if (t.requires && !seen[t.requires]) return false;
      return true;
    });
    if (!list.length) return false;
    // 优先没看过的一次性剧情；否则在可重复的里挑看得最少的
    list.sort(function (a, b) {
      const pa = a.on.once ? 0 : 1, pb = b.on.once ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (seen[a.id] || 0) - (seen[b.id] || 0);
    });
    return play(list[0], onDone);
  }

  /** 检查剧情数据：未知角色、缺失 label、重复 id。返回问题列表（空 = 没问题）。 */
  function validate() {
    const out = [];
    const ids = {};
    data().scenes.forEach(function (sc) {
      if (ids[sc.id]) out.push("重复 id：" + sc.id);
      ids[sc.id] = true;
      const labels = {};
      sc.lines.forEach(function (l) { if (l && l.label) labels[l.label] = true; });
      function who(w, where) {
        const p = parseWho(w);
        if (p.who && !castOf(p.who)) out.push(sc.id + "：未知角色 " + p.who + "（" + where + "）");
      }
      (sc.cast || []).forEach(function (w) { who(w, "cast"); });
      sc.lines.forEach(function (l, i) {
        if (Array.isArray(l)) who(l[0], "第 " + (i + 1) + " 行");
        else if (l && l.show) who(l.show, "show");
        else if (l && l.goto && l.goto !== "end" && !labels[l.goto]) out.push(sc.id + "：goto 找不到 label " + l.goto);
        else if (l && l.choice) l.choice.forEach(function (o) { if (o[1] && !labels[o[1]]) out.push(sc.id + "：选项找不到 label " + o[1]); });
      });
    });
    return out;
  }

  MD.story = {
    validate: validate,
    trigger: trigger,
    play: play,
    active: function () { return !!cur; },
    get seen() { return seen; },
    resetSeen: function () { seen = {}; saveSeen(); },
    setSeen: function (obj) { seen = obj || {}; saveSeen(); },
  };
})(typeof window !== "undefined" ? window : globalThis);
