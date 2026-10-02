/* Browser-native journey storage. No network, cookies, or legacy-store writes. */
(function (global) {
  'use strict';
  const VERSION = 1;
  const SLOT_COUNT = 10;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const DB_NAME = 'mystery-dungeon-saves';
  const STORE_NAME = 'journeys';
  const FORMAT = 'mystery-dungeon-save';
  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const reserved = new Set(['__proto__', 'constructor', 'prototype']);
  const snapshotFields = ['mode', 'dungeonId', 'floor', 'turn', 'map', 'player', 'enemies', 'items', 'bag', 'skills', 'warehouse', 'explored', 'triggeredMH', 'log', 'skillMeta', 'lastBellyWarn', 'spawnCounter', 'endKind', 'rngState', 'playTimeMs'];
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function error(code, message, cause) { const e = new Error(message); e.code = code; if (cause) e.cause = cause; return e; }
  function bytes(text) { return new TextEncoder().encode(text).length; }
  function boundedJSON(value) {
    const issue = inspectJSON(value);
    if (issue) throw error('INVALID_SAVE', issue);
    const text = JSON.stringify(value);
    if (bytes(text) > MAX_FILE_BYTES) throw error('TOO_LARGE', '存档超过 8 MiB；没有删减任何物品。');
    return text;
  }
  // Validate before stringify: JSON would otherwise erase NaN, undefined and getters.
  function inspectJSON(root) {
    const active = new Set(); let nodes = 0;
    function visit(value, depth) {
      if (++nodes > MAX_FILE_BYTES || depth > 40) return '存档结构过大或嵌套过深';
      if (value === null || typeof value === 'boolean') return null;
      if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? null : '存档含无效数字';
      if (typeof value === 'string') return value.length <= MAX_FILE_BYTES ? null : '存档文本过长';
      if (!value || typeof value !== 'object') return '存档必须仅含 JSON 数据';
      if (active.has(value)) return '存档存在循环引用';
      const proto = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && proto !== null && !(Object.getPrototypeOf(proto) === null && own(proto, 'constructor') && proto.constructor.name === 'Object')) return '存档含非普通对象';
      if (Object.getOwnPropertySymbols(value).length) return '存档含非 JSON 字段';
      if (Array.isArray(value) && (value.length > MAX_FILE_BYTES || Object.keys(value).length !== value.length)) return '存档数组不连续或过大';
      active.add(value);
      for (const key of Object.keys(value)) {
        if (reserved.has(key)) return '存档含保留字段 ' + key;
        if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) return '存档数组含额外字段';
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !own(descriptor, 'value')) return '存档含动态属性';
        const issue = visit(descriptor.value, depth + 1);
        if (issue) return issue;
      }
      active.delete(value); return null;
    }
    return visit(root, 0);
  }
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  // An integrity checksum, not an authenticity signature. Saves remain user-editable.
  function digest(text) {
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x85ebca6b); b ^= b >>> 13; }
    return 'fnv2-' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function configFingerprint(config) {
    const selected = {};
    for (const key of ['version', 'player', 'rules', 'effects', 'mapProfiles', 'ruleProfiles', 'itemEffects', 'dungeons', 'floorBands', 'enemies', 'items', 'enemyGroups', 'itemGroups']) if (own(config, key)) selected[key] = copy(config[key]);
    // Strip presentation fields only from records, never from catalog ID keys.
    for (const section of ['dungeons', 'enemies', 'items']) for (const row of Object.values(selected[section] || {})) for (const key of ['name', 'nameKey', 'color', 'glyph']) delete row[key];
    for (const row of selected.floorBands || []) delete row.themeId;
    return digest(canonical(selected));
  }
  function validateSnapshot(s, config) {
    try { return inspectSnapshot(s, config); }
    catch (e) { return ['存档结构无效: ' + (e.message || String(e))]; }
  }
  function inspectSnapshot(s, config) {
    const errors = [], fail = (path, msg) => { if (errors.length < 32) errors.push(path + ': ' + msg); };
    try { boundedJSON(s); } catch (e) { return [e.message]; }
    const obj = (v, path) => { if (!v || typeof v !== 'object' || Array.isArray(v)) { fail(path, '必须是对象'); return false; } return true; };
    const fields = (v, keys, path, required = keys) => {
      if (!obj(v, path)) return false;
      for (const k of required) if (!own(v, k)) fail(path + '.' + k, '缺少字段');
      for (const k of Object.keys(v)) if (!keys.includes(k)) fail(path + '.' + k, '未知字段');
      return true;
    };
    const integer = (v, min, max, path) => { if (!Number.isSafeInteger(v) || v < min || v > max) { fail(path, '整数范围 ' + min + '–' + max); return false; } return true; };
    const number = (v, min, max, path) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) { fail(path, '数字超出范围'); return false; } return true; };
    const string = (v, max, path, min = 0) => { if (typeof v !== 'string' || v.length < min || v.length > max) { fail(path, '文本长度无效'); return false; } return true; };
    const bool = (v, path) => { if (typeof v !== 'boolean') fail(path, '必须是布尔值'); };
    const array = (v, path, max = MAX_FILE_BYTES) => { if (!Array.isArray(v) || v.length > max) { fail(path, '数组长度无效'); return false; } return true; };
    if (!fields(s, snapshotFields, '$')) return errors;
    if (!config || !config.rules || !config.dungeons || !config.items || !config.enemies) return ['当前游戏配置不可用'];
    const rules = config.rules;
    if (!['town', 'dungeon'].includes(s.mode)) fail('$.mode', '未知游戏状态');
    if (typeof s.dungeonId !== 'string' || !own(config.dungeons, s.dungeonId)) fail('$.dungeonId', '未知迷宫 ' + String(s.dungeonId));
    const dungeon = config.dungeons[s.dungeonId];
    const band = Array.isArray(config.floorBands) ? config.floorBands.find(b => b.dungeonId === s.dungeonId && s.floor >= b.fromFloor && s.floor <= b.toFloor) : null;
    const ruleProfile = config.ruleProfiles?.[band?.ruleProfileOverride || dungeon?.ruleProfileId] || rules;
    const mapProfile = config.mapProfiles?.[band?.mapProfileOverride || dungeon?.mapProfileId];
    const maxEnemies = Math.min(100, Number.isInteger(ruleProfile.maxMonsters) ? ruleProfile.maxMonsters : 100);
    integer(s.floor, s.mode === 'town' ? 0 : 1, s.mode === 'town' ? 0 : (dungeon ? dungeon.totalFloors : 240), '$.floor');
    integer(s.turn, 0, Number.MAX_SAFE_INTEGER, '$.turn');
    integer(s.rngState, 0, 4294967295, '$.rngState');
    number(s.playTimeMs, 0, Number.MAX_SAFE_INTEGER, '$.playTimeMs');
    number(s.lastBellyWarn, 0, 1000000, '$.lastBellyWarn');
    integer(s.spawnCounter, 0, Number.MAX_SAFE_INTEGER, '$.spawnCounter');
    if (![null, 'death', 'clear'].includes(s.endKind)) fail('$.endKind', '未知结束状态');
    if (s.mode === 'town' && s.endKind !== null) fail('$.endKind', '镇子不能是结束画面');
    if (fields(s.skillMeta, ['active', 'passive'], '$.skillMeta')) {
      integer(s.skillMeta.active, 0, rules.maxActiveSlots, '$.skillMeta.active');
      integer(s.skillMeta.passive, 0, rules.maxPassiveSlots, '$.skillMeta.passive');
    }
    function item(v, path, positioned) {
      if (!fields(v, ['type', 'name', 'uid', 'charges', 'x', 'y'], path, ['type'])) return;
      if (typeof v.type !== 'string' || !own(config.items, v.type)) { fail(path + '.type', '未知物品 ' + String(v.type)); return; }
      const definition = config.items[v.type];
      if (own(v, 'name')) string(v.name, 1024, path + '.name');
      if (own(v, 'uid')) string(v.uid, 128, path + '.uid');
      if (definition.swingEffectId && definition.swingEffectId !== 'none') integer(v.charges, 0, definition.chargesMax, path + '.charges');
      else if (own(v, 'charges')) integer(v.charges, 0, 1000000, path + '.charges');
      if (positioned) position(v, path, true);
      else { if (own(v, 'x')) integer(v.x, 0, 255, path + '.x'); if (own(v, 'y')) integer(v.y, 0, 255, path + '.y'); }
    }
    if (array(s.bag, '$.bag', rules.maxBag)) { if (s.bag.length !== rules.maxBag) fail('$.bag', '背包栏位数量不匹配'); s.bag.forEach((v, i) => { if (v !== null) item(v, '$.bag[' + i + ']', false); }); }
    if (array(s.warehouse, '$.warehouse')) s.warehouse.forEach((v, i) => item(v, '$.warehouse[' + i + ']', false));
    if (fields(s.skills, ['active', 'passive'], '$.skills')) for (const kind of ['active', 'passive']) {
      if (array(s.skills[kind], '$.skills.' + kind, rules[kind === 'active' ? 'maxActiveSlots' : 'maxPassiveSlots'])) {
        if (!s.skillMeta || s.skills[kind].length !== s.skillMeta[kind]) fail('$.skills.' + kind, '技能栏位数量不匹配');
        s.skills[kind].forEach((v, i) => {
          if (v === null) return;
          item(v, '$.skills.' + kind + '[' + i + ']', false);
          if (v && typeof v.type === 'string' && own(config.items, v.type) && config.items[v.type][kind + 'Skill'] !== 1) fail('$.skills.' + kind + '[' + i + ']', '物品不能装备在此栏位');
        });
      }
    }
    if (array(s.log, '$.log', 80)) s.log.forEach((v, i) => { if (fields(v, ['text', 'cls'], '$.log[' + i + ']')) { string(v.text, 4096, '$.log[' + i + '].text'); if (!['', 'good', 'bad', 'warn', 'info', 'special'].includes(v.cls)) fail('$.log[' + i + '].cls', '未知日志样式'); } });
    const map = s.map;
    let mapOK = false, roomIds = new Set();
    function position(v, path, walkable) {
      if (!obj(v, path)) return;
      const xOK = integer(v.x, 0, mapOK ? map.width - 1 : 255, path + '.x');
      const yOK = integer(v.y, 0, mapOK ? map.height - 1 : 255, path + '.y');
      if (mapOK && walkable && xOK && yOK && (!Array.isArray(map.tiles?.[v.y]) || ![1, 2].includes(map.tiles[v.y][v.x]))) fail(path, '坐标必须在可行走地格');
    }
    if (s.mode === 'town') {
      if (map !== null || s.player !== null) fail('$.map', '镇子中地图和角色必须为空');
    } else if (fields(map, ['width', 'height', 'tiles', 'roomIds', 'rooms', 'stairs', 'playerSpawn', 'spawnRoomId', 'monsterHouseRooms', 'floorNum', 'TILE'], '$.map', ['width', 'height', 'tiles', 'roomIds', 'rooms', 'stairs', 'playerSpawn', 'spawnRoomId', 'monsterHouseRooms'])) {
      mapOK = integer(map.width, mapProfile?.width?.min || 1, mapProfile?.width?.max || 256, '$.map.width') && integer(map.height, mapProfile?.height?.min || 1, mapProfile?.height?.max || 256, '$.map.height');
      const maxRooms = mapProfile ? Math.max(mapProfile.gridColsSmall, mapProfile.gridColsLarge) * mapProfile.gridRows : 4096;
      if (own(map, 'floorNum') && map.floorNum !== s.floor) fail('$.map.floorNum', '地图楼层不匹配');
      if (own(map, 'TILE') && (canonical(map.TILE) !== canonical({ WALL: 0, FLOOR: 1, STAIRS: 2 }))) fail('$.map.TILE', '地格定义不匹配');
      if (array(map.rooms, '$.map.rooms', maxRooms)) map.rooms.forEach((r, i) => {
        const p = '$.map.rooms[' + i + ']';
        if (!fields(r, ['id', 'x', 'y', 'w', 'h', 'cx', 'cy', 'slotR', 'slotC', 'isMonsterHouse', 'merged'], p, ['id', 'x', 'y', 'w', 'h', 'cx', 'cy', 'slotR', 'slotC', 'isMonsterHouse', 'merged'])) return;
        if (integer(r.id, 0, 4095, p + '.id')) { if (roomIds.has(r.id)) fail(p + '.id', '重复房间'); roomIds.add(r.id); }
        position(r, p, false); integer(r.w, 1, mapOK ? map.width : 256, p + '.w'); integer(r.h, 1, mapOK ? map.height : 256, p + '.h');
        integer(r.cx, r.x, r.x + r.w - 1, p + '.cx'); integer(r.cy, r.y, r.y + r.h - 1, p + '.cy');
        if (mapOK && (r.x + r.w > map.width || r.y + r.h > map.height)) fail(p, '房间超出地图');
        integer(r.slotR, 0, 255, p + '.slotR'); integer(r.slotC, 0, 255, p + '.slotC'); bool(r.isMonsterHouse, p + '.isMonsterHouse'); bool(r.merged, p + '.merged');
      });
      for (const key of ['tiles', 'roomIds']) if (array(map[key], '$.map.' + key, 256)) {
        if (map[key].length !== map.height) fail('$.map.' + key, '地图行数不匹配');
        map[key].forEach((row, y) => { if (!array(row, '$.map.' + key + '[' + y + ']', 256)) return;
          if (row.length !== map.width) fail('$.map.' + key + '[' + y + ']', '地图列数不匹配');
          row.forEach((v, x) => { if (key === 'tiles' ? ![0, 1, 2].includes(v) : v !== null && v !== -1 && !roomIds.has(v)) fail('$.map.' + key + '[' + y + '][' + x + ']', '未知地格或房间'); });
        });
      }
      for (const key of ['stairs', 'playerSpawn']) if (fields(map[key], ['x', 'y'], '$.map.' + key)) position(map[key], '$.map.' + key, true);
      if (mapOK && map.stairs && map.tiles?.[map.stairs.y]?.[map.stairs.x] !== 2) fail('$.map.stairs', '楼梯地格不匹配');
      if (!roomIds.has(map.spawnRoomId)) fail('$.map.spawnRoomId', '未知出生房间');
      if (array(map.monsterHouseRooms, '$.map.monsterHouseRooms', 4096)) { const seen = new Set(); for (const id of map.monsterHouseRooms) { if (!roomIds.has(id) || seen.has(id)) fail('$.map.monsterHouseRooms', '未知或重复房间'); seen.add(id); } }
    }
    function actor(v, path, player) {
      const allowed = ['kind', 'type', 'behaviorTemplate', 'name', 'x', 'y', 'hp', 'maxHp', 'atk', 'def', 'belly', 'maxBelly', 'statuses', 'alive', 'color', 'glyph', 'facingDx', 'facingDy', 'anim', 'animT0'];
      if (!fields(v, allowed, path, ['kind', 'x', 'y', 'hp', 'maxHp', 'atk', 'def', 'statuses', 'alive', 'facingDx', 'facingDy'])) return;
      if (v.kind !== (player ? 'player' : 'enemy')) fail(path + '.kind', '角色类型不匹配');
      if (!player && (typeof v.type !== 'string' || !own(config.enemies, v.type))) fail(path + '.type', '未知敌人 ' + String(v.type));
      if (!player && typeof v.type === 'string' && own(config.enemies, v.type) && v.behaviorTemplate !== config.enemies[v.type].behaviorTemplate) fail(path + '.behaviorTemplate', '敌人行为不匹配');
      position(v, path, true); bool(v.alive, path + '.alive');
      number(v.maxHp, 1, 1000000, path + '.maxHp'); number(v.hp, -1000000, v.maxHp, path + '.hp'); number(v.atk, 0, 1000000, path + '.atk'); number(v.def, 0, 1000000, path + '.def');
      if (v.alive && v.hp <= 0 || !v.alive && v.hp > 0) fail(path + '.alive', '生命状态与生命值不匹配');
      if (player) { number(v.maxBelly, 1, 1000000, path + '.maxBelly'); number(v.belly, 0, v.maxBelly, path + '.belly'); }
      integer(v.facingDx, -1, 1, path + '.facingDx'); integer(v.facingDy, -1, 1, path + '.facingDy');
      if (own(v, 'name')) string(v.name, 1024, path + '.name'); if (own(v, 'color')) string(v.color, 64, path + '.color'); if (own(v, 'glyph')) string(v.glyph, 32, path + '.glyph');
      if (own(v, 'anim') && !['idle', 'walk', 'run', 'attack', 'hurt', 'fail', 'hit', 'eat', 'throw', 'swing', 'sleep', 'climb'].includes(v.anim)) fail(path + '.anim', '未知动画');
      if (own(v, 'animT0')) number(v.animT0, 0, Number.MAX_SAFE_INTEGER, path + '.animT0');
      if (array(v.statuses, path + '.statuses', 16)) { const seen = new Set(); v.statuses.forEach((status, i) => {
        const p = path + '.statuses[' + i + ']'; if (!fields(status, ['type', 'turns'], p)) return;
        if (!['sleep', 'para', 'confuse', 'slow'].includes(status.type) || seen.has(status.type)) fail(p + '.type', '未知或重复状态');
        seen.add(status.type); integer(status.turns, 1, 1000000, p + '.turns');
      }); }
    }
    if (s.mode === 'dungeon') {
      actor(s.player, '$.player', true);
      if (s.player && (s.endKind === 'death') !== !s.player.alive) fail('$.endKind', '结束状态与角色不匹配');
    }
    const livePositions = new Set();
    if (s.player?.alive) livePositions.add(s.player.x + ',' + s.player.y);
    // Floor items can stack after a throw. The initial map, one trigger per room,
    // and carried inventory bound their legitimate total; warehouse is unbounded
    // except for the explicit 8 MiB file limit. Nothing is silently truncated.
    const maxFloorItems = mapOK ? map.width * map.height + roomIds.size * (ruleProfile.houseTriggerItems?.max || 0) + rules.maxBag + rules.maxActiveSlots + rules.maxPassiveSlots : 0;
    for (const key of ['enemies', 'items']) if (array(s[key], '$.' + key, key === 'enemies' ? maxEnemies : maxFloorItems)) {
      if (s.mode === 'town' && s[key].length) fail('$.' + key, '镇子中不能有地图实体');
      s[key].forEach((v, i) => {
        if (key === 'enemies') {
          actor(v, '$.enemies[' + i + ']', false);
          if (v?.alive) { const k = v.x + ',' + v.y; if (livePositions.has(k)) fail('$.enemies[' + i + ']', '存活角色不能重叠'); livePositions.add(k); }
        } else item(v, '$.items[' + i + ']', true);
      });
    }
    if (array(s.explored, '$.explored', 256 * 256)) { const seen = new Set(); s.explored.forEach((v, i) => {
      if (typeof v !== 'string' || !/^(0|[1-9]\d{0,2}),(0|[1-9]\d{0,2})$/.test(v) || seen.has(v)) { fail('$.explored[' + i + ']', '无效或重复地格'); return; }
      seen.add(v); const [x, y] = v.split(',').map(Number); position({ x, y }, '$.explored[' + i + ']', false);
    }); if (s.mode === 'town' && s.explored.length) fail('$.explored', '镇子中探索记录必须为空'); }
    if (array(s.triggeredMH, '$.triggeredMH', 4096)) { const seen = new Set(); for (const id of s.triggeredMH) { if (!roomIds.has(id) || !(Array.isArray(map?.monsterHouseRooms) && map.monsterHouseRooms.includes(id)) || seen.has(id)) fail('$.triggeredMH', '未知或重复怪物房'); seen.add(id); } }
    return errors;
  }
  function checksum(envelope) {
    const payload = {}; for (const key of ['format', 'version', 'configFingerprint', 'metadata', 'snapshot']) payload[key] = envelope[key];
    return digest(canonical(payload));
  }
  function createEnvelope(snapshot, config, options = {}) {
    const errors = validateSnapshot(snapshot, config);
    if (errors.length) throw error('INVALID_SAVE', errors.join('\n'));
    const now = options.now === undefined ? Date.now() : options.now;
    const metadata = {
      name: options.name === undefined ? '旅程' : options.name,
      source: options.source === undefined ? 'game' : options.source,
      createdAt: options.createdAt === undefined ? now : options.createdAt,
      updatedAt: now,
      revision: options.revision === undefined ? 1 : options.revision,
      mode: snapshot.mode, dungeonId: snapshot.dungeonId, floor: snapshot.floor,
      turn: snapshot.turn, playTimeMs: snapshot.playTimeMs,
    };
    const envelope = { format: FORMAT, version: VERSION, configFingerprint: configFingerprint(config), metadata, snapshot: copy(snapshot) };
    envelope.checksum = checksum(envelope);
    validateEnvelope(envelope, config);
    return envelope;
  }
  function validateEnvelope(envelope, config) {
    boundedJSON(envelope);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw error('INVALID_SAVE', '存档必须是对象');
    const keys = ['format', 'version', 'configFingerprint', 'metadata', 'snapshot', 'checksum'];
    if (Object.keys(envelope).length !== keys.length || keys.some(k => !own(envelope, k))) throw error('INVALID_SAVE', '存档封装字段不完整');
    if (envelope.format !== FORMAT) throw error('INVALID_SAVE', '文件不是迷宫旅程存档');
    if (envelope.version !== VERSION) throw error('INCOMPATIBLE_SAVE', '不支持此存档版本');
    if (typeof envelope.configFingerprint !== 'string' || envelope.configFingerprint !== configFingerprint(config)) throw error('INCOMPATIBLE_SAVE', '存档游戏规则与当前配置不兼容；原存档未改动。');
    if (typeof envelope.checksum !== 'string' || envelope.checksum !== checksum(envelope)) throw error('CORRUPT_SAVE', '存档校验失败，文件可能已损坏');
    const m = envelope.metadata;
    const metaKeys = ['name', 'source', 'createdAt', 'updatedAt', 'revision', 'mode', 'dungeonId', 'floor', 'turn', 'playTimeMs'];
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length !== metaKeys.length || metaKeys.some(k => !own(m, k))) throw error('INVALID_SAVE', '存档摘要字段不完整');
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80 || typeof m.source !== 'string' || m.source.length > 80) throw error('INVALID_SAVE', '存档名称或来源无效');
    if (![m.createdAt, m.updatedAt].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000) || !Number.isSafeInteger(m.revision) || m.revision < 1) throw error('INVALID_SAVE', '存档时间或版本序号无效');
    const errors = validateSnapshot(envelope.snapshot, config);
    if (errors.length) throw error('INVALID_SAVE', errors.join('\n'));
    for (const key of ['mode', 'dungeonId', 'floor', 'turn', 'playTimeMs']) if (m[key] !== envelope.snapshot[key]) throw error('CORRUPT_SAVE', '存档摘要与内容不匹配');
    return envelope;
  }
  function parseFile(text, config) {
    if (typeof text !== 'string') throw error('INVALID_SAVE', '请选择 JSON 存档文件');
    if (text.length > MAX_FILE_BYTES || bytes(text) > MAX_FILE_BYTES) throw error('TOO_LARGE', '存档文件超过 8 MiB');
    let envelope; try { envelope = JSON.parse(text); } catch (e) { throw error('INVALID_SAVE', '无法解析存档 JSON', e); }
    return validateEnvelope(envelope, config);
  }
  function slotId(id) { if (!Number.isInteger(id) || id < 1 || id > SLOT_COUNT) throw error('INVALID_SLOT', '存档位置必须是 1–10'); return id; }
  function createMemoryBackend() {
    const rows = new Map(); let tail = Promise.resolve();
    return {
      kind: 'memory',
      async init() {},
      async read(id) { await tail; return copy(rows.get(id) || null); },
      async list() { await tail; return Array.from(rows.values(), copy); },
      mutate(id, updater) {
        const task = tail.then(() => { const result = updater(copy(rows.get(id) || null)); if (result.record === null) rows.delete(id); else rows.set(id, copy(result.record)); return copy(result.value); });
        tail = task.catch(() => {}); return task;
      },
      close() {},
    };
  }
  function createIndexedDBBackend(factory, options) {
    let db = null;
    function transaction(mode, run) {
      return new Promise((resolve, reject) => {
        if (!db) { reject(error('STORAGE_UNAVAILABLE', '浏览器存档连接已关闭，请重新打开页面')); return; }
        let tx, value, thrown;
        try {
          tx = db.transaction(STORE_NAME, mode);
          tx.oncomplete = () => resolve(value);
          tx.onabort = () => reject(thrown || tx.error || error('STORAGE_ABORTED', '存档事务已取消；上一次存档未改动。'));
          tx.onerror = () => { /* onabort is the terminal event; never report an uncommitted write as saved. */ };
          run(tx.objectStore(STORE_NAME), v => { value = v; }, e => { thrown = e; tx.abort(); });
        } catch (e) { if (tx) { thrown = e; try { tx.abort(); } catch (_) { reject(e); } } else reject(e); }
      });
    }
    return {
      kind: 'indexeddb',
      init() {
        return new Promise((resolve, reject) => {
          let request, settled = false;
          const timeout = global.setTimeout(() => finish(error('STORAGE_BLOCKED', '浏览器存档被其他页面阻塞')), options.openTimeoutMs === undefined ? 2500 : options.openTimeoutMs);
          function finish(e, result) { if (settled) { if (result) result.close(); return; } settled = true; global.clearTimeout(timeout); if (e) reject(e); else { db = result; db.onversionchange = () => { db.close(); db = null; }; resolve(); } }
          try { request = factory.open(options.dbName || DB_NAME, 1); } catch (e) { finish(e); return; }
          request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'slotId' }); };
          request.onsuccess = () => finish(null, request.result);
          request.onerror = () => finish(request.error || error('STORAGE_UNAVAILABLE', '无法打开浏览器存档'));
          request.onblocked = () => finish(error('STORAGE_BLOCKED', '浏览器存档被其他页面阻塞'));
        });
      },
      read(id) { return transaction('readonly', (store, done) => { const request = store.get(id); request.onsuccess = () => done(request.result || null); }); },
      list() { return transaction('readonly', (store, done) => { const request = store.getAll(); request.onsuccess = () => done(request.result); }); },
      mutate(id, updater) {
        return transaction('readwrite', (store, done, fail) => {
          const request = store.get(id);
          request.onsuccess = () => {
            try { const result = updater(request.result || null); if (result.record === null) store.delete(id); else store.put(result.record); done(result.value); } catch (e) { fail(e); }
          };
        });
      },
      close() { if (db) db.close(); db = null; },
    };
  }
  function createStore(options) {
    if (!options || !options.config) throw error('CONFIG_REQUIRED', '创建存档库需要游戏配置');
    const config = options.config, now = options.now || (() => Date.now());
    const status = { kind: 'pending', persistent: false, reason: '', lastError: null };
    let backend, initialized;
    function init() {
      if (initialized) return initialized;
      initialized = (async () => {
        if (options.volatileOnly) { backend = createMemoryBackend(); status.reason = '试玩模式仅使用临时存档，不读取正式存档'; }
        else if (options.backend) backend = options.backend;
        else {
          try { const factory = own(options, 'indexedDB') ? options.indexedDB : global.indexedDB; if (!factory) throw error('STORAGE_UNAVAILABLE', '浏览器不支持 IndexedDB'); backend = createIndexedDBBackend(factory, options); await backend.init(); }
          catch (e) { backend = createMemoryBackend(); status.reason = '浏览器持久存档不可用，当前仅临时保存，关闭或刷新页面后丢失。' + (e.message || ''); status.lastError = e.message || String(e); }
        }
        if (backend.kind !== 'indexeddb' || options.backend) await backend.init();
        status.kind = backend.kind || 'memory'; status.persistent = status.kind === 'indexeddb';
        if (!status.persistent && !status.reason) status.reason = '当前仅临时保存，关闭或刷新页面后丢失';
        return { ...status };
      })();
      return initialized;
    }
    async function use(fn) { await init(); try { const result = await fn(); status.lastError = null; return result; } catch (e) { status.lastError = e.message || String(e); throw e; } }
    function inspect(envelope) { if (envelope === null || envelope === undefined) return { valid: false, status: 'empty', error: null }; try { validateEnvelope(envelope, config); return { valid: true, status: 'ready', error: null }; } catch (e) { return { valid: false, status: e.code === 'INCOMPATIBLE_SAVE' ? 'incompatible' : 'corrupt', error: e.message }; } }
    function revision(record) {
      if (!record) return 0;
      if (!Number.isSafeInteger(record.revision) || record.revision < 0) throw error('CORRUPT_SAVE', '存档版本序号损坏');
      return record.revision;
    }
    function expect(record, settings) {
      const current = revision(record);
      if (settings.expectedRevision !== undefined && settings.expectedRevision !== current) throw error('CONFLICT', '此存档已在其他页面更新。请重新读取后再操作，避免覆盖新进度。');
      if (current >= Number.MAX_SAFE_INTEGER) throw error('REVISION_LIMIT', '存档版本序号已达到上限');
      return current + 1;
    }
    function row(id, record) {
      if (!record) return { slotId: id, status: 'empty', metadata: { revision: 0 }, backupAvailable: false, error: null };
      const validRevision = Number.isSafeInteger(record.revision) && record.revision >= 1;
      if (record.current === null && record.backup === null && validRevision) return { slotId: id, status: 'empty', metadata: { revision: record.revision }, backupAvailable: false, error: null };
      const current = inspect(record.current), backup = inspect(record.backup);
      if (!validRevision || !current.valid && current.status === 'empty' || current.valid && record.current.metadata.revision !== record.revision) { current.valid = false; current.status = 'corrupt'; current.error = '存档内容或版本序号损坏'; }
      return { slotId: id, status: current.status, metadata: current.valid ? copy(record.current.metadata) : { revision: record.revision }, backupAvailable: backup.valid, error: current.error, backupError: backup.error };
    }
    async function save(id, snapshot, settings = {}) {
      slotId(id);
      // Freeze the caller's state before any asynchronous work or queued transaction.
      const candidate = createEnvelope(snapshot, config, { name: settings.name === undefined ? '旅程 ' + id : settings.name, source: settings.source === undefined ? 'game' : settings.source, now: now() });
      return use(() => backend.mutate(id, record => {
        const next = expect(record, settings), current = inspect(record && record.current);
        const envelope = createEnvelope(candidate.snapshot, config, {
          name: settings.name === undefined && current.valid ? record.current.metadata.name : candidate.metadata.name,
          source: settings.source === undefined && current.valid ? record.current.metadata.source : candidate.metadata.source,
          createdAt: current.valid ? record.current.metadata.createdAt : candidate.metadata.createdAt,
          now: candidate.metadata.updatedAt, revision: next,
        });
        const backup = current.valid ? record.current : record && inspect(record.backup).valid ? record.backup : null;
        return { record: { slotId: id, revision: next, current: envelope, backup }, value: envelope };
      }));
    }
    const store = {
      status, init,
      list() { return use(async () => { const records = await backend.list(); const byId = new Map(records.map(r => [r.slotId, r])); return Array.from({ length: SLOT_COUNT }, (_, i) => row(i + 1, byId.get(i + 1))); }); },
      async read(id) { slotId(id); return use(async () => { const record = await backend.read(id); if (!record) return null; const entry = row(id, record); if (entry.status === 'empty') return null; if (entry.status !== 'ready') throw error(entry.status === 'incompatible' ? 'INCOMPATIBLE_SAVE' : 'CORRUPT_SAVE', entry.error); return copy(record.current); }); },
      write: save,
      async delete(id, settings = {}) { slotId(id); return use(() => backend.mutate(id, record => { const next = expect(record, settings); return { record: { slotId: id, revision: next, current: null, backup: null }, value: next }; })); },
      async recover(id, settings = {}) { slotId(id); return use(() => backend.mutate(id, record => {
        const next = expect(record, settings);
        if (!record || !inspect(record.backup).valid) throw error('NO_BACKUP', '此位置没有可用的兼容备份');
        const restored = createEnvelope(record.backup.snapshot, config, { ...record.backup.metadata, now: now(), revision: next });
        const previous = inspect(record.current).valid ? record.current : record.backup;
        return { record: { slotId: id, revision: next, current: restored, backup: previous }, value: restored };
      })); },
      async exportSlot(id) { const envelope = await store.read(id); if (!envelope) throw error('EMPTY_SLOT', '此位置没有存档'); return boundedJSON(envelope); },
      async importSlot(id, envelope, settings = {}) { slotId(id); const validated = typeof envelope === 'string' ? parseFile(envelope, config) : validateEnvelope(envelope, config); return save(id, validated.snapshot, { ...settings, name: settings.name === undefined ? validated.metadata.name : settings.name, source: 'import' }); },
      close() { if (backend) backend.close(); },
    };
    return store;
  }
  global.MDSaves = { VERSION, SLOT_COUNT, MAX_FILE_BYTES, MAX_BYTES: MAX_FILE_BYTES, DB_NAME, FORMAT, createStore, createMemoryBackend, validateSnapshot, validateEnvelope, createEnvelope, parseFile, configFingerprint };
})(typeof window !== 'undefined' ? window : globalThis);
