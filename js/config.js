/* Shared configuration contract. Generated data comes only from config/game.xlsx. */
(function (global) {
  'use strict';
  const MAX_BYTES = 256 * 1024;
  function validate(data, schema) {
    const errors = [];
    function visit(value, spec, path) {
      const fail = message => errors.push(path + ': ' + message);
      if (spec.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('必须是对象');
        for (const key of spec.required || []) if (!Object.hasOwn(value, key)) fail('缺少字段 ' + key);
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(spec.properties, key)) fail('未知字段 ' + key);
          else visit(value[key], spec.properties[key], path + '.' + key);
        }
      } else if (spec.type === 'array') {
        if (!Array.isArray(value)) return fail('必须是数组');
        if (value.length < spec.minItems || value.length > spec.maxItems) fail('条目数量超出范围');
        value.forEach((v, i) => visit(v, spec.items, path + '[' + i + ']'));
      } else if (spec.type === 'number' || spec.type === 'integer') {
        if (typeof value !== 'number' || !Number.isFinite(value) || (spec.type === 'integer' && !Number.isInteger(value))) return fail('必须是有限' + (spec.type === 'integer' ? '整数' : '数字'));
        if (value < spec.minimum || value > spec.maximum) fail('范围 ' + spec.minimum + '–' + spec.maximum);
      } else if (spec.type === 'string') {
        if (typeof value !== 'string') return fail('必须是文本');
        const length = Array.from(value).length;
        if (length < spec.minLength || length > spec.maxLength || value.trim() !== value) fail('文本长度或首尾空格非法');
        if (spec.pattern && !new RegExp(spec.pattern).test(value)) fail('格式非法');
      }
      if (spec.enum && !spec.enum.includes(value)) fail('未知引用，可选：' + spec.enum.join(', '));
      if (spec.type === 'object' && value && typeof value.min === 'number' && value.min > value.max) fail('min 不得大于 max');
    }
    visit(data, schema, '$');
    if (errors.length) return errors;
    if (data.effects.bellyCap < data.player.belly) errors.push('$.effects.bellyCap: 不得小于玩家初始饱食度');
    function weights(entries, path, definitions) {
      if (!(entries.reduce((sum, entry) => sum + entry.weight, 0) > 0)) errors.push(path + ': 权重总和必须大于0');
      const ids = new Set();
      entries.forEach((entry, i) => {
        if (ids.has(entry.id)) errors.push(path + '[' + i + '].id: 重复ID');
        ids.add(entry.id);
        if (!Object.hasOwn(definitions, entry.id)) errors.push(path + '[' + i + '].id: 引用不存在');
      });
    }
    weights(data.itemDrops, '$.itemDrops', data.items);
    let previous = 0;
    data.enemySpawns.forEach((group, i) => {
      if ((i === 0 && group.fromFloor !== 1) || group.fromFloor <= previous || group.fromFloor > data.rules.totalFloors) errors.push('$.enemySpawns[' + i + '].fromFloor: 必须从1开始严格递增且不超过通关楼层');
      previous = group.fromFloor;
      weights(group.entries, '$.enemySpawns[' + i + '].entries', data.enemies);
    });
    const texts = new Map();
    function placeholders(text) {
      const names = [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]);
      if (/[{}]/.test(text.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, ''))) return null;
      return [...new Set(names)].sort().join(',');
    }
    data.localization.texts.forEach((row, i) => {
      if (texts.has(row.key)) errors.push('$.localization.texts[' + i + '].key: 重复文本key');
      texts.set(row.key, row);
      const zh = placeholders(row.zhCN), en = placeholders(row.en);
      if (zh === null || en === null || zh !== en) errors.push('$.localization.texts[' + i + ']: 占位符格式或语言间占位符不一致');
    });
    for (const section of ['enemies', 'items']) for (const [id, definition] of Object.entries(data[section])) {
      if (!texts.has(definition.nameKey)) errors.push('$.' + section + '.' + id + '.nameKey: 文本key不存在');
      else if (placeholders(texts.get(definition.nameKey).zhCN) !== '') errors.push('$.' + section + '.' + id + '.nameKey: 名称不允许占位符');
      else if (texts.get(definition.nameKey).zhCN !== definition.name) errors.push('$.' + section + '.' + id + '.name: 派生名称与默认语言不一致');
    }
    for (const id of data.themes.order) {
      const key = 'theme.' + id + '.name';
      if (!texts.has(key)) errors.push('$.themes.order: 主题文本不存在 ' + id);
      else if (placeholders(texts.get(key).zhCN) !== '') errors.push('$.themes.order: 主题名称不允许占位符 ' + id);
    }
    if (!texts.has('preview.banner')) errors.push('$.localization.texts: 缺少 preview.banner');
    else if (placeholders(texts.get('preview.banner').zhCN) !== 'floor,seed') errors.push('$.localization.texts: preview.banner 必须且仅包含 {seed} 和 {floor}');
    return errors;
  }
  function createTranslator(data, locale) {
    const field = locale === 'zh-CN' ? 'zhCN' : locale === 'en' ? 'en' : null;
    if (!field) throw new Error('不支持语言 ' + locale + '；可选 zh-CN / en');
    const texts = new Map(data.localization.texts.map(row => [row.key, row[field]]));
    return function (key, params = {}) {
      if (!texts.has(key)) throw new Error('文本key不存在: ' + key);
      return texts.get(key).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name) => {
        if (!Object.hasOwn(params, name)) throw new Error('缺少占位符: ' + key + '.' + name);
        return String(params[name]);
      });
    };
  }
  function parse(text, schema) {
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('配置超过256KiB');
    const data = JSON.parse(text);
    const errors = validate(data, schema);
    if (errors.length) throw new Error(errors.join('\n'));
    return data;
  }
  async function loadDefaults() {
    async function read(path) {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
      return response.text();
    }
    const [raw, schemaText] = await Promise.all([read('config/game.json'), read('config/schema.json')]);
    const schema = JSON.parse(schemaText);
    return { data: parse(raw, schema), schema };
  }
  function seededRandom(seed) {
    let state = seed >>> 0;
    return function () {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }
  function weightedPick(entries, random) {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    const roll = random();
    let sum = 0;
    for (const entry of entries) {
      sum += entry.weight;
      // Avoid decimal summation moving a published probability boundary.
      if (roll < Math.round(sum / total * 1e12) / 1e12) return entry.id;
    }
    return entries[entries.length - 1].id;
  }
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  async function boot() {
    const { data } = await loadDefaults();
    const params = new URLSearchParams(global.location.search);
    const preview = params.get('designer') === '1';
    const seedText = params.get('seed') || '42';
    const floorText = params.get('floor') || '1';
    if (preview && (!/^\d+$/.test(seedText) || Number(seedText) > 4294967295 || !/^\d+$/.test(floorText) || Number(floorText) < 1 || Number(floorText) > data.rules.totalFloors)) {
      throw new Error('试玩 seed 必须是0–4294967295整数，floor 必须在1–通关楼层之间');
    }
    const MD = global.MD = global.MD || {};
    MD.locale = params.get('lang') || data.localization.defaultLocale;
    MD.t = createTranslator(data, MD.locale);
    MD.config = freeze(data);
    MD.preview = preview ? { seed: Number(seedText), floor: Number(floorText) } : null;
    MD.random = preview ? seededRandom(MD.preview.seed) : Math.random;
    MD.weightedPick = entries => weightedPick(entries, MD.random);
    // Preview uses memory only: neither warehouse nor skill metadata is read/written.
    const memory = new Map();
    MD.storage = preview ? {
      getItem: key => memory.get(key) || null,
      setItem: (key, value) => memory.set(key, String(value)),
    } : {
      getItem: key => global.localStorage.getItem(key),
      setItem: (key, value) => global.localStorage.setItem(key, value),
    };
  }
  global.MDConfig = { validate, parse, loadDefaults, seededRandom, weightedPick, createTranslator, boot };
})(typeof window !== 'undefined' ? window : globalThis);
