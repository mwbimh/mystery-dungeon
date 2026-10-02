/* Real startup stages, with visible failure and retry. No simulated progress. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('loadingScreen'), progress = $('loadingProgress');
  const settings = { version: 1, playOpening: true, reducedMotion: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), renderer: 'auto' };
  const designer = new URLSearchParams(location.search).get('designer') === '1';
  if (!designer) {
    try {
      const saved = JSON.parse(localStorage.getItem('md-settings-v1') || 'null');
      if (saved && saved.version === 1) {
        for (const key of ['playOpening', 'reducedMotion']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
        if (['auto', 'flat'].includes(saved.renderer)) settings.renderer = saved.renderer;
      }
    } catch (_) { /* Storage can be unavailable; the menu reports persistence. */ }
  }
  document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
  let done = 0, total = 1;
  function stage(title, detail) { $('loadingTitle').textContent = title; $('loadingDetail').textContent = detail; progress.max = total; progress.value = done; }
  function script(src) {
    return new Promise((resolve, reject) => {
      const node = document.createElement('script'); const timer = setTimeout(() => reject(new Error('脚本加载超时：' + src)), 20000);
      node.src = src; node.onload = () => { clearTimeout(timer); resolve(); }; node.onerror = () => { clearTimeout(timer); reject(new Error('脚本加载失败：' + src)); }; document.body.appendChild(node);
    });
  }
  function image(src) {
    return new Promise(resolve => {
      const img = new Image(); let finished = false; const timer = setTimeout(() => finish(false), 12000);
      function finish(ok) { if (finished) return; finished = true; clearTimeout(timer); resolve(ok); }
      img.onload = () => finish(true); img.onerror = () => finish(false); img.src = src;
    });
  }
  function readLegacy() {
    try {
      const data = { warehouse: localStorage.getItem('md_warehouse_v1'), skills: localStorage.getItem('md-skill-meta'), expedition: localStorage.getItem('md-expedition-v1') };
      return data.warehouse || data.skills ? data : null;
    } catch (_) { return null; }
  }
  async function boot() {
    stage('展开地图', '读取并校验 Excel 生成的游戏配置');
    await MDConfig.boot(); done++;
    MD.settings = settings; MD.shellManaged = !MD.preview;
    MD.legacyData = MD.preview ? null : readLegacy();
    // Legacy helpers are scoped to the in-memory active session. Old browser keys
    // are never rewritten by new journeys; explicit migration copies them once.
    const sessionStorage = new Map();
    MD.storage = { getItem: key => sessionStorage.get(key) || null, setItem: (key, value) => sessionStorage.set(key, String(value)) };
    const flat = /(?:\?|&)flat=1(?:&|$)/.test(location.search) || settings.renderer === 'flat';
    const files = ['js/themes.js', 'js/map.js', 'js/fov.js', 'js/items.js', 'js/actors.js'];
    if (!flat) { files.unshift('vendor/three.min.js'); files.push('js/sprites.js', 'js/view3d.js'); }
    files.push('js/ui.js', 'js/saves.js', 'js/game.js', 'js/opening.js', 'js/menu.js');
    const images = ['assets/runtime/ui/town/town-map.png', 'assets/runtime/ui/town/deepseek-idle.png', 'assets/runtime/ui/avatar-face.png'];
    total = 1 + files.length + images.length + (flat ? 0 : 1);
    let optionalFailure = false;
    for (const file of files) {
      stage('点亮小镇', '载入程序 · ' + file);
      try { await script(file + '?v=68'); } catch (error) {
        if (!['vendor/three.min.js', 'js/sprites.js', 'js/view3d.js'].includes(file)) throw error;
        optionalFailure = true; console.warn(error.message + '，尝试兼容绘制');
      }
      done++;
    }
    stage('整理行囊', '读取小镇与角色贴图');
    let missing = 0;
    await Promise.all(images.map(async src => { if (!await image(src)) missing++; done++; stage('整理行囊', '贴图准备 ' + (done - 1 - files.length) + ' / ' + images.length); }));
    if (!flat && MD.sprites) {
      stage('整理行囊', '等待地牢贴图；缺失素材会使用兼容绘制');
      await Promise.race([MD.sprites.ready, new Promise(resolve => setTimeout(resolve, 15000))]); done++;
    }
    if (MDMenu.ready) await MDMenu.ready;
    progress.value = total;
    if (MD.preview) {
      const banner = document.createElement('div'); banner.id = 'previewBanner'; banner.textContent = MD.t('preview.banner', MD.preview);
      banner.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:#153a30;color:white;padding:4px 12px;font:14px sans-serif;pointer-events:none'; document.body.appendChild(banner);
      document.body.classList.remove('shell-open');
    }
    panel.hidden = true;
    if (!MD.preview && settings.playOpening && !settings.reducedMotion && window.MDOpening) await MDOpening.play({ reducedMotion: settings.reducedMotion, locale: MD.locale });
    if (missing || optionalFailure) $('menuNotice').textContent = '部分贴图加载失败。可继续游戏，或刷新重新尝试。';
    if (!MD.preview) $('menuNew').focus();
  }
  boot().catch(error => {
    panel.hidden = false; progress.removeAttribute('value');
    $('loadingTitle').textContent = '暂时无法开始';
    $('loadingDetail').textContent = '配置或资源加载失败，游戏未启动。请检查网络，并通过 HTTP 网址打开。';
    const detail = document.createElement('pre'); detail.id = 'configError'; detail.textContent = '配置加载失败或必需资源不可用：' + error.message; panel.querySelector('.loading-card').appendChild(detail);
    $('loadingRetry').hidden = false; $('loadingRetry').onclick = () => location.reload(); console.error(error);
  });
})();
