/* Journey menu. Gameplay snapshots stay local; nothing here uploads a save. */
(function (global) {
  'use strict';
  const MD = global.MD;
  if (MD.preview) { global.MDMenu = { ready: Promise.resolve() }; return; }
  const root = document.getElementById('menuScreen');
  const content = document.getElementById('menuContent');
  const notice = document.getElementById('menuNotice');
  const status = document.getElementById('saveStatus');
  const store = MDSaves.createStore({ config: MD.config });
  let activeSlot = null, revision = 0, saveTimer = null, dirty = false;
  let lastSignature = '', queuedSignature = '', saveChain = Promise.resolve(), busy = false, page = 'main';
  let persistenceBlocked = false, settingsError = '', importing = null, pendingWrites = 0;
  const settings = MD.settings;
  const $ = id => document.getElementById(id);
  function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
  function message(text, bad = false) { notice.textContent = text; notice.classList.toggle('is-error', bad); }
  function button(text, action, attrs = {}) { const b = el('button', text, 'menu-button'); b.type = 'button'; Object.assign(b.dataset, attrs); b.onclick = () => perform(action); return b; }
  async function perform(action) {
    if (busy) return;
    busy = true; root.setAttribute('aria-busy', 'true');
    try { await action(); } catch (error) { message(error.message || String(error), true); }
    finally { busy = false; root.removeAttribute('aria-busy'); }
  }
  function storageDescription() {
    return store.status.persistent ? '存档保存在这个浏览器与当前网址，不会自动同步到其他设备。清除网站数据或无痕模式可能导致丢失，建议定期下载备份。' : '浏览器存储不可用，本次仅保存在内存。刷新或关闭会丢失，请下载存档文件。' + (store.status.reason ? '（' + store.status.reason + '）' : '');
  }
  function showShell() { document.body.classList.add('shell-open'); root.hidden = false; $('btnSessionMenu').hidden = true; }
  function closeShell() { root.hidden = true; document.body.classList.remove('shell-open'); $('btnSessionMenu').hidden = false; MD.session.resume(); }
  function heading(title, subtitle) { content.replaceChildren(el('p', 'MYSTERY DUNGEON / 旅程档案', 'menu-eyebrow'), el('h1', title)); if (subtitle) content.appendChild(el('p', subtitle, 'menu-subtitle')); }
  function back() { const b = button('← 返回', () => renderMain()); b.classList.add('menu-back'); content.appendChild(b); }
  function setStatus(text, bad = false) { status.textContent = text; status.classList.toggle('is-error', bad); }
  function signature(snapshot) { return JSON.stringify({ ...snapshot, playTimeMs: 0 }); }
  function scheduleSave() {
    if (!activeSlot || persistenceBlocked) return;
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(false).catch(() => {}); }, 120);
  }
  async function save(force = false) {
    if (!activeSlot) return;
    if (!MD.session.isStable()) { scheduleSave(); return; }
    if (persistenceBlocked) throw new Error('存档发生冲突或写入失败。请先下载当前进度，再重新载入存档位；不会覆盖另一标签页的新进度。');
    const slot = activeSlot, snapshot = MD.session.snapshot(), sig = signature(snapshot);
    // Compare against the queue tail, not only the last completed write.
    // A → B (pending) → A must enqueue A after B instead of losing the undo.
    if (sig === (pendingWrites ? queuedSignature : lastSignature)) {
      if (!pendingWrites) dirty = false;
      return;
    }
    queuedSignature = sig;
    dirty = true;
    // Capture before queuing. Every queued write checks its slot and uses the
    // revision produced by its predecessor, not a stale timestamp from the UI.
    const work = async () => {
      if (slot !== activeSlot || persistenceBlocked) return;
      setStatus('正在保存…');
      try {
        const saved = await store.write(slot, snapshot, { expectedRevision: revision });
        revision = saved.metadata.revision; lastSignature = sig;
        setStatus(store.status.persistent ? '已自动保存 · 存档 ' + slot : '仅本次会话 · 请下载备份', !store.status.persistent);
      } catch (error) {
        persistenceBlocked = true; dirty = true;
        setStatus('保存失败 · 请下载备份', true);
        message(error.code === 'CONFLICT' ? '这个存档已在另一标签页更新。为保护双方进度，已停止覆盖；请下载当前进度后重新载入。' : '保存失败：' + error.message + '。当前进度仍在内存，请下载备份。', true);
        throw error;
      }
    };
    pendingWrites++;
    const result = saveChain.then(work, work).finally(() => {
      pendingWrites--;
      if (!pendingWrites && slot === activeSlot && !persistenceBlocked) {
        // Changes can arrive while IndexedDB is writing. Never mark a newer
        // in-memory state durable merely because an older transaction finished.
        dirty = !MD.session.isStable() || signature(MD.session.snapshot()) !== lastSignature;
      }
    }); saveChain = result.catch(() => {}); return result;
  }
  async function settle() { await MD.session.pause(); if (saveTimer) clearTimeout(saveTimer); saveTimer = null; await saveChain; if (activeSlot && !persistenceBlocked) await save(true); }
  async function open() {
    // Keep recovery reachable even if the flush fails after the game pauses.
    showShell();
    let saveError;
    try { await settle(); } catch (error) { saveError = error; }
    await renderMain();
    if (saveError) message('保存失败：' + saveError.message + '。当前进度仍在内存，请下载备份。', true);
  }
  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const a = el('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportCurrent() {
    await MD.session.pause();
    const envelope = MDSaves.createEnvelope(MD.session.snapshot(), MD.config, { name: '当前旅程', source: 'download' });
    downloadText(JSON.stringify(envelope), 'mystery-dungeon-current-' + new Date().toISOString().slice(0, 10) + '.json');
    message('当前进度已交给浏览器下载，请妥善保管文件。');
  }
  async function renderMain() {
    page = 'main'; heading('迷宫', '有些路，值得再走一次。');
    let rows = [], listUnavailable = false;
    try { rows = await store.list(); }
    catch (error) { listUnavailable = true; message('无法读取存档列表：' + error.message + (activeSlot ? '。当前旅程仍在内存，可以下载备份或回到旅程。' : '。请刷新后重试。'), true); }
    const latest = rows.filter(r => r.status === 'ready').sort((a, b) => (b.metadata.updatedAt || 0) - (a.metadata.updatedAt || 0) || a.slotId - b.slotId)[0];
    const actions = el('div', null, 'menu-main-actions');
    if (activeSlot) { const resume = button('回到旅程', () => closeShell()); resume.id = 'menuResume'; actions.appendChild(resume); }
    const next = button('继续', () => load(latest.slotId)); next.id = 'menuContinue'; next.disabled = !latest;
    const newGame = button('新游戏', () => renderSlots('new')); newGame.id = 'menuNew'; newGame.disabled = listUnavailable;
    const loadGame = button('读取存档', () => renderSlots('load')); loadGame.id = 'menuLoad'; loadGame.disabled = listUnavailable;
    const prefs = button('设置', renderSettings); prefs.id = 'menuSettings';
    const about = button('关于', renderAbout); about.id = 'menuAbout';
    actions.append(newGame, next, loadGame, prefs, about); content.appendChild(actions);
    content.appendChild(el('p', latest ? '最近旅程 · 存档 ' + latest.slotId + ' · ' + formatMeta(latest.metadata) : '选择「新游戏」，留下一段属于你的旅程。', 'menu-latest'));
    content.appendChild(el('p', storageDescription(), 'menu-storage-note'));
    if (activeSlot) content.appendChild(button('下载当前进度', exportCurrent));
    if (settingsError) message(settingsError, true);
    (activeSlot ? $('menuResume') : newGame).focus();
  }
  function formatMeta(meta) {
    if (!meta) return '';
    const dungeon = MD.config.dungeons[meta.dungeonId];
    const place = meta.mode === 'town' ? '镇子' : (dungeon ? MD.t(dungeon.nameKey) : meta.dungeonId || '') + ' · ' + meta.floor + ' 层';
    const date = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : '';
    return place + (meta.turn != null ? ' · ' + meta.turn + ' 回合' : '') + (date ? ' · ' + date : '');
  }
  async function renderSlots(mode) {
    page = mode; heading(mode === 'new' ? '选择新的起点' : '旅程档案', '10 个独立存档位 · 每次稳定行动自动保存 · 每槽保留上一版恢复点');
    let rows;
    try { rows = await store.list(); } catch (error) {
      message('无法读取存档列表：' + error.message + '。可以返回菜单或下载当前进度。', true);
      if (activeSlot) content.appendChild(button('下载当前进度', exportCurrent));
      back(); return;
    }
    const grid = el('div', null, 'save-grid');
    for (const row of rows) {
      const card = el('article', null, 'save-card'); card.dataset.slot = row.slotId;
      card.appendChild(el('h2', '存档 ' + String(row.slotId).padStart(2, '0') + (row.slotId === activeSlot ? ' · 当前' : '')));
      card.appendChild(el('p', row.status === 'empty' ? '尚未启程' : row.status === 'ready' ? formatMeta(row.metadata) : '无法读取 · ' + (row.error || row.status), 'save-meta'));
      if (row.metadata && row.metadata.source === 'legacy') card.appendChild(el('span', '旧版记录迁入', 'save-badge'));
      const actions = el('div', null, 'save-actions');
      const opts = action => ({ slot: String(row.slotId), action });
      if (mode === 'new' || row.status === 'empty') actions.appendChild(button(row.status === 'empty' ? '新游戏' : '覆盖并新建', () => start(row.slotId), opts('new')));
      if (row.status === 'ready') {
        actions.appendChild(button('继续旅程', () => load(row.slotId), opts('load')));
        actions.appendChild(button('下载', async () => { if (row.slotId === activeSlot && !persistenceBlocked) await save(true); downloadText(await store.exportSlot(row.slotId), 'mystery-dungeon-slot-' + row.slotId + '.json'); message('已交给浏览器下载。'); }, opts('export')));
      }
      actions.appendChild(button('上传读档', () => { importing = row.slotId; $('saveFileInput').value = ''; $('saveFileInput').click(); }, opts('import')));
      if (row.backupAvailable) actions.appendChild(button('恢复上一版', async () => { if (!confirm('恢复存档 ' + row.slotId + ' 的上一版？当前版本会被替换。')) return; await store.recover(row.slotId, { expectedRevision: row.metadata.revision }); if (row.slotId === activeSlot) activeSlot = null; await renderSlots(mode); message('上一版已恢复。点击继续旅程载入。'); }, opts('recover')));
      if (row.status !== 'empty') actions.appendChild(button('删除', async () => { if (!confirm('删除存档 ' + row.slotId + ' 及其恢复点？建议先下载备份。')) return; await store.delete(row.slotId, { expectedRevision: row.metadata.revision }); if (activeSlot === row.slotId) { activeSlot = null; persistenceBlocked = false; } await renderSlots(mode); message('存档位已清空。'); }, opts('delete')));
      card.appendChild(actions); grid.appendChild(card);
    }
    content.appendChild(grid); content.appendChild(el('p', storageDescription(), 'menu-storage-note'));
    if (MD.legacyData) content.appendChild(button('迁入旧版仓库与技能记录', migrateLegacy, { action: 'legacy' }));
    if (activeSlot) content.appendChild(button('下载当前进度', exportCurrent));
    back();
  }
  async function withLoading(label, action) {
    const panel = $('loadingScreen'); panel.hidden = false; $('loadingTitle').textContent = label; $('loadingDetail').textContent = '正在校验并准备本地旅程'; $('loadingProgress').removeAttribute('value');
    try { await action(); } finally { panel.hidden = true; }
  }
  async function start(slotId, legacy) {
    await settle();
    const rows = await store.list(), row = rows.find(r => r.slotId === slotId);
    if (!row) throw new Error('无效存档位');
    if (row.status !== 'empty' && !confirm('覆盖存档 ' + slotId + ' 并开始新旅程？其他存档位不受影响，建议先下载此槽。')) return;
    const previous = MD.session.snapshot(), previousSlot = activeSlot, previousRevision = revision;
    const previousSignature = lastSignature; activeSlot = null;
    try {
      await withLoading('准备新的旅程', async () => {
        const snapshot = MD.session.fresh(legacy);
        const saved = await store.write(slotId, snapshot, { expectedRevision: row.metadata.revision, source: legacy ? 'legacy' : 'new' });
        activeSlot = slotId; revision = saved.metadata.revision; lastSignature = signature(snapshot); dirty = false; persistenceBlocked = false;
      });
      message(''); closeShell(); setStatus(store.status.persistent ? '已保存 · 存档 ' + slotId : '仅本次会话 · 请下载备份', !store.status.persistent);
    } catch (error) { MD.session.restore(previous); activeSlot = previousSlot; revision = previousRevision; lastSignature = previousSignature; throw error; }
  }
  async function load(slotId) {
    await settle();
    await withLoading('读取旅程', async () => {
      const saved = await store.read(slotId); if (!saved) throw new Error('这个存档位是空的');
      const previousSlot = activeSlot; activeSlot = null;
      try { MD.session.restore(saved.snapshot); } catch (error) { activeSlot = previousSlot; throw error; }
      activeSlot = slotId; revision = saved.metadata.revision; lastSignature = signature(saved.snapshot); dirty = false; persistenceBlocked = false;
    });
    message(''); closeShell(); setStatus('存档 ' + slotId + ' · 已读取');
  }
  async function migrateLegacy() {
    const row = (await store.list()).find(r => r.status === 'empty');
    if (!row) throw new Error('需要一个空存档位才能迁入旧记录，请先下载并整理存档。');
    const data = MD.legacyData;
    let warehouse, skillMeta, expedition;
    try { warehouse = JSON.parse(data.warehouse || '[]'); skillMeta = JSON.parse(data.skills || 'null'); expedition = JSON.parse(data.expedition || 'null'); } catch (_) { throw new Error('旧记录格式损坏，原始记录已保留，未迁入任何内容。'); }
    if (!Array.isArray(warehouse)) throw new Error('旧仓库格式不正确，原始记录已保留。');
    const unknown = warehouse.filter(item => !item || !MD.config.items[item.type]);
    if (unknown.length) throw new Error('旧仓库含 ' + unknown.length + ' 件已移除或未知物品，无法安全迁入；原始记录完整保留。');
    const defaults = MD.config.rules;
    if (!skillMeta) skillMeta = { active: defaults.activeSlots, passive: defaults.passiveSlots };
    const dungeonId = expedition && MD.config.dungeons[expedition.dungeonId] ? expedition.dungeonId : MD.config.defaultDungeonId;
    if (!confirm('将旧版仓库与技能槽复制到空存档 ' + row.slotId + '？旧版没有保存地牢进度，迁入后从镇子开始；原始记录保留。')) return;
    await start(row.slotId, { warehouse, skillMeta, dungeonId });
  }
  function persistSettings() {
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
    try { localStorage.setItem('md-settings-v1', JSON.stringify(settings)); settingsError = ''; }
    catch (_) { settingsError = '设置未能写入浏览器，只在本次会话生效。'; message(settingsError, true); }
  }
  function renderSettings() {
    page = 'settings'; heading('设置', '留一点空间，按你的节奏探索。');
    const list = el('div', null, 'settings-list');
    for (const [key, title, description] of [['playOpening', '启动时播放片头', '随时可按 Esc 或点击跳过'], ['reducedMotion', '减少动态效果', '跳过开场动画，并缩短行动过渡']]) {
      const label = el('label', null, 'setting-row'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = settings[key]; input.id = 'setting-' + key;
      input.onchange = () => { settings[key] = input.checked; persistSettings(); };
      const text = el('span'); text.append(el('strong', title), el('small', description)); label.append(input, text); list.appendChild(label);
    }
    const label = el('label', '画面模式（重新启动后生效）', 'setting-row'); const select = el('select'); select.id = 'setting-renderer';
    for (const [value, text] of [['auto', '3D · 自动兼容'], ['flat', '2D · 轻量模式']]) { const option = el('option', text); option.value = value; select.appendChild(option); }
    select.value = settings.renderer; select.onchange = () => { settings.renderer = select.value; persistSettings(); message('画面模式将在下次打开或刷新时生效，当前旅程会自动保存。'); }; label.appendChild(select); list.appendChild(label);
    content.appendChild(list);
    content.appendChild(el('p', '当前原型为无声版。存档默认自动保存，无需开启额外权限。', 'menu-storage-note'));
    content.appendChild(button('重看片头', async () => { if (global.MDOpening) await MDOpening.play({ reducedMotion: settings.reducedMotion, locale: MD.locale }); }));
    back();
  }
  function renderAbout() {
    page = 'about'; heading('关于这段旅程', '一个原生 JavaScript 回合制迷宫原型');
    content.appendChild(el('p', '探索随机地牢、管理背包与饥饿，在每次冒险后回到熟悉的小镇。内容由 Excel 与 Luban 配置驱动。', 'about-copy'));
    content.appendChild(el('p', '角色、物品与地牢素材沿用本项目原创原型美术。部分基础素材来自 Kenney（CC0）；3D 渲染使用 Three.js。片头沿用项目角色设计与授权参考素材。', 'about-copy'));
    const links = el('div', null, 'about-links');
    for (const [text, href] of [['素材来源与说明', 'assets/ATTRIBUTION.txt'], ['项目许可证', 'LICENSE'], ['Three.js 项目与许可', 'https://github.com/mrdoob/three.js/blob/dev/LICENSE']]) { const a = el('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; links.appendChild(a); }
    content.appendChild(links); content.appendChild(el('p', '存档文件只在本机解析，不上传服务器。不同网址、浏览器或设备之间，请用下载／上传功能转移。', 'menu-storage-note')); back();
  }
  $('saveFileInput').addEventListener('change', () => perform(async () => {
    const file = $('saveFileInput').files[0], slot = importing; importing = null;
    if (!file || !slot) return;
    if (file.size > MDSaves.MAX_FILE_BYTES) throw new Error('存档文件过大，请选择本游戏导出的 JSON 文件。');
    const envelope = MDSaves.parseFile(await file.text(), MD.config);
    const row = (await store.list()).find(r => r.slotId === slot);
    if (!confirm('将文件「' + file.name + '」载入存档 ' + slot + '？' + (row.status !== 'empty' ? '此存档位现有进度会被替换。' : '其他存档位不受影响。'))) return;
    await store.importSlot(slot, envelope, { expectedRevision: row.metadata.revision });
    if (activeSlot === slot) activeSlot = null;
    await load(slot);
  }));
  $('btnSessionMenu').onclick = () => perform(open);
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if (root.hidden) { if (event.key === 'Escape' && !(MD.dialogue && MD.dialogue.isOpen()) && !MD_STATE.invOpen && !MD_STATE.aiming && !MD_STATE.skillAiming && $('helpOverlay').classList.contains('hidden') && $('endOverlay').classList.contains('hidden') && (!$('routeOverlay') || $('routeOverlay').classList.contains('hidden'))) { event.preventDefault(); perform(open); } return; }
    if (event.key === 'Escape' && !busy) { event.preventDefault(); if (page !== 'main') perform(renderMain); else if (activeSlot) closeShell(); }
    if (event.key === 'Tab') { const nodes = [...root.querySelectorAll('button:not(:disabled),a[href],input,select')].filter(n => !n.hidden); const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && activeSlot) save(true).catch(() => {}); });
  global.addEventListener('beforeunload', event => { if (dirty || persistenceBlocked || pendingWrites > 0 || (activeSlot && !MD.session.isStable())) { event.preventDefault(); event.returnValue = ''; } });
  MD.session.onChange = scheduleSave;
  const ready = store.init().then(() => { showShell(); return renderMain(); });
  global.MDMenu = { ready, store, open, start, load, save, settings, get activeSlot() { return activeSlot; } };
})(window);
