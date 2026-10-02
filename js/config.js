/* v2: one validated catalog, immutable content, explicit expedition selection. */
(function (global) {
  'use strict';
  const MAX_BYTES = 4 * 1024 * 1024;
  const own = (o,k) => Object.hasOwn(o,k);
  const reserved = new Set(['__proto__','constructor','prototype']);
  const visualReserved = new Set(['player','floor','wall','wallCap','stairs','crystal','mushroom','lantern','vine','flower','slimeDirs','batDirs']);
  const themes = ['cave','forest','wetcave','ruins','wooden','modern','cyber','future'];
  function validate(data, schema) {
    const errors=[];
    const fail=(path,message)=>errors.push(path+': '+message);
    function visit(value,spec,path) {
      if(spec.type==='object') {
        if(!value||typeof value!=='object'||Array.isArray(value))return fail(path,'必须是对象');
        if(Object.keys(value).length < (spec.minProperties||0))fail(path,'至少需要一条记录');
        for(const key of spec.required||[])if(!own(value,key))fail(path+'.'+key,'缺少字段');
        for(const key of Object.keys(value)) {
          if(reserved.has(key)) {fail(path+'.'+key,'保留ID');continue;}
          if(spec.propertyNames)visit(key,spec.propertyNames,path+'.'+key);
          const child=(spec.properties && own(spec.properties,key)?spec.properties[key]:null) || (typeof spec.additionalProperties==='object'?spec.additionalProperties:null);
          if(!child)fail(path+'.'+key,'未知字段');else visit(value[key],child,path+'.'+key);
        }
        if(typeof value.min==='number'&&typeof value.max==='number'&&value.min>value.max)fail(path+'.max','max 不得小于 min');
      } else if(spec.type==='array') {
        if(!Array.isArray(value))return fail(path,'必须是数组');
        if(value.length<(spec.minItems||0)||value.length>(spec.maxItems??Infinity))fail(path,'条目数量超出范围');
        value.forEach((v,i)=>visit(v,spec.items,path+'['+i+']'));
      } else if(spec.type==='number'||spec.type==='integer') {
        if(typeof value!=='number'||!Number.isFinite(value)||(spec.type==='integer'&&!Number.isInteger(value)))return fail(path,'必须是有限'+(spec.type==='integer'?'整数':'数字'));
        if(value<(spec.minimum??-Infinity)||value>(spec.maximum??Infinity))fail(path,'范围 '+spec.minimum+'–'+spec.maximum);
      } else if(spec.type==='string') {
        if(typeof value!=='string')return fail(path,'必须是文本');
        if(value.trim()!==value||Array.from(value).length<(spec.minLength||0)||Array.from(value).length>(spec.maxLength??Infinity))fail(path,'文本长度或首尾空格非法');
        if(spec.pattern&&!new RegExp(spec.pattern).test(value))fail(path,'格式非法');
      }
      if(spec.enum&&!spec.enum.includes(value))fail(path,'未知模板/枚举 '+value);
    }
    visit(data,schema,'$');if(errors.length)return errors;
    function ref(catalog,id,path){if(!own(catalog,id)||reserved.has(id))fail(path,'引用不存在: '+id);}
    function unique(rows,key,path){const seen=new Set();rows.forEach((r,i)=>{if(seen.has(r[key]))fail(path+'['+i+'].'+key,'重复ID');seen.add(r[key]);});}
    if(data.effects.bellyCap<data.player.belly)fail('$.effects.bellyCap','不得小于玩家初始饱食');
    for(const kind of ['Active','Passive'])if(data.rules[kind.toLowerCase()+'Slots']>data.rules['max'+kind+'Slots'])fail('$.rules.max'+kind+'Slots','不得小于初始栏位');
    if(data.rules.hungerCritical>data.rules.hungerWarning)fail('$.rules.hungerCritical','不得大于预警阈值');
    for(const [id,r]of Object.entries(data.ruleProfiles)) {
      if(r.houseEnemyMin>r.houseEnemyMax)fail('$.ruleProfiles.'+id+'.houseEnemyMax','不得小于 houseEnemyMin');
      if(r.houseEnemyMax>r.maxMonsters)fail('$.ruleProfiles.'+id+'.houseEnemyMax','不得超过 maxMonsters');
    }
    for(const [id,m]of Object.entries(data.mapProfiles)) {
      const p='$.mapProfiles.'+id;
      for(const prefix of ['roomWidth','roomHeight','hallWidth','hallHeight'])if(m[prefix+'Min']>m[prefix+'Max'])fail(p+'.'+prefix+'Max','不得小于下限');
      for(let w=m.width.min;w<=m.width.max;w++) {
        const cols=w>=m.gridThreshold?m.gridColsLarge:m.gridColsSmall;
        const cw=Math.floor((w-2)/cols),ch=Math.floor((m.height.min-2)/m.gridRows);
        if(m.minRooms>cols*m.gridRows) {fail(p+'.minRooms','超过网格槽数');break;}
        if(cw<m.roomWidthMin+2||ch<m.roomHeightMin+2) {fail(p+'.roomWidthMin','最小地图容不下最小房间；调整尺寸/网格/房间范围');break;}
        if(m.hallChance>0&&(m.hallHeightMin>ch-2||m.hallWidthMin>cw*2-2)) {fail(p+'.hallHeightMin','最小地图容不下大厅');break;}
      }
    }
    ref(data.dungeons,data.defaultDungeonId,'$.defaultDungeonId');
    for(const [id,d]of Object.entries(data.dungeons)) {
      const p='$.dungeons.'+id;
      if(d.id!==id)fail(p+'.id','必须与字典ID相同');
      ref(data.mapProfiles,d.mapProfileId,p+'.mapProfileId');ref(data.ruleProfiles,d.ruleProfileId,p+'.ruleProfileId');
      const bands=data.floorBands.map((b,i)=>({b,i})).filter(x=>x.b.dungeonId===id).sort((a,b)=>a.b.fromFloor-b.b.fromFloor);
      let next=1;
      for(const {b,i}of bands) {const q='$.floorBands['+i+']';if(b.fromFloor!==next)fail(q+'.fromFloor','楼层必须连续覆盖且不能重叠；期望 '+next);if(b.toFloor<b.fromFloor||b.toFloor>d.totalFloors)fail(q+'.toFloor','楼层区间超出迷宫');next=b.toFloor+1;}
      if(next!==d.totalFloors+1)fail(p+'.totalFloors','楼层段未完整覆盖1–'+d.totalFloors);
    }
    unique(data.floorBands,'id','$.floorBands');
    data.floorBands.forEach((b,i)=>{const p='$.floorBands['+i+']';ref(data.dungeons,b.dungeonId,p+'.dungeonId');ref(data.themeCatalog,b.themeId,p+'.themeId');ref(data.enemyGroups,b.enemyGroupId,p+'.enemyGroupId');ref(data.itemGroups,b.itemGroupId,p+'.itemGroupId');if(b.mapProfileOverride)ref(data.mapProfiles,b.mapProfileOverride,p+'.mapProfileOverride');if(b.ruleProfileOverride)ref(data.ruleProfiles,b.ruleProfileOverride,p+'.ruleProfileOverride');});
    for(const [section,catalog]of [['enemyGroups','enemies'],['itemGroups','items']])for(const[id,entries]of Object.entries(data[section])) {
      const p='$.'+section+'.'+id;unique(entries,'id',p);if(entries.reduce((a,b)=>a+b.weight,0)<=0)fail(p+'[0].weight','权重总和必须大于0');entries.forEach((e,i)=>ref(data[catalog],e.id,p+'['+i+'].id'));
    }
    for(const [id,e]of Object.entries(data.itemEffects)) {
      const p='$.itemEffects.'+id;
      if(e.kind==='none'&&id!=='none')fail(p+'.kind','仅ID none可使用none模板');
      if(e.turnsMax<e.turnsMin)fail(p+'.turnsMax','不得小于turnsMin');
      if(e.kind==='sleep'&&e.turnsMin<1)fail(p+'.turnsMin','睡眠至少1回合');
      if(e.kind!=='sleep'&&(e.turnsMin||e.turnsMax))fail(p+'.turnsMin','非睡眠效果回合数必须0');
      if(e.kind!=='knockback'&&e.wallDamage)fail(p+'.wallDamage','非击退效果撞墙伤害必须0');
      if(!['food','damage'].includes(e.kind)&&e.power)fail(p+'.power','此模板强度必须0');
      if(e.kind==='none'&&(e.range||e.power||e.turnsMin||e.turnsMax||e.wallDamage))fail(p+'.kind','none所有参数必须0');
    }
    if(!own(data.itemEffects,'none')||data.itemEffects.none.kind!=='none')fail('$.itemEffects.none','需要none空效果');
    for(const[id,item]of Object.entries(data.items)) {
      const p='$.items.'+id;
      for(const action of ['use','throw','swing']) {
        const key=action+'EffectId';ref(data.itemEffects,item[key],p+'.'+key);const e=data.itemEffects[item[key]];
        if(!e||e.kind==='none')continue;
        if(action==='use'&&!['food','sleep','damage'].includes(e.kind))fail(p+'.'+key,'使用动作仅支持food/sleep/damage');
        if(action!=='use'&&(!['sleep','damage','knockback'].includes(e.kind)||e.range<1))fail(p+'.'+key,'远程动作需要sleep/damage/knockback且射程≥1');
        if(action==='use'&&e.range!==0)fail(p+'.'+key,'使用效果射程必须0');
      }
      if(item.chargesMax<item.chargesMin)fail(p+'.chargesMax','不得小于初始次数下限');
      if(item.swingEffectId==='none'&&(item.chargesMin||item.chargesMax))fail(p+'.chargesMin','非杖次数必须0');
      if(item.swingEffectId!=='none'&&item.chargesMin<1)fail(p+'.chargesMin','杖次数至少1');
      if(item.activeSkill&&item.throwEffectId==='none'&&item.swingEffectId==='none')fail(p+'.activeSkill','主动栏需要投掷或挥杖动作');
      if(item.passiveSkill)fail(p+'.passiveSkill','当前没有被动效果模板；必须0');
    }
    for(const section of ['enemies','items'])for(const id of Object.keys(data[section]))if(visualReserved.has(id)||(section==='items'&&own(data.enemies,id)))fail('$.'+section+'.'+id,'与渲染保留ID/其他实体冲突');
    for(const id of Object.keys(data.themeCatalog))if(!themes.includes(id))fail('$.themeCatalog.'+id,'不支持的渲染主题');
    const loc=data.localization,texts=new Map();
    if(new Set(loc.locales).size!==loc.locales.length)fail('$.localization.locales','重复语言');
    if(!loc.locales.includes(loc.defaultLocale))fail('$.localization.defaultLocale','默认语言不存在');
    function placeholders(t){if(typeof t!=='string')return null;const names=[...t.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(m=>m[1]);return /[{}]/.test(t.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,''))?null:[...new Set(names)].sort().join(',');}
    loc.texts.forEach((row,i)=>{const p='$.localization.texts['+i+']';if(texts.has(row.key))fail(p+'.key','重复文本key');texts.set(row.key,row);let expected;for(const lang of loc.locales){if(!own(row.values,lang)){fail(p+'.values.'+lang,'缺少译文');continue;}const signature=placeholders(row.values[lang]);if(signature===null||expected!==undefined&&expected!==signature)fail(p+'.values.'+lang,'占位符格式/各语言参数不一致');expected=signature;}for(const lang of Object.keys(row.values))if(!loc.locales.includes(lang))fail(p+'.values.'+lang,'未声明语言');});
    for(const section of ['enemies','items','dungeons','themeCatalog'])for(const[id,r]of Object.entries(data[section])){const row=texts.get(r.nameKey),p='$.'+section+'.'+id;if(!row)fail(p+'.nameKey','文本key不存在');else{if(placeholders(row.values[loc.defaultLocale]||'')!=='')fail(p+'.nameKey','名称不能包含占位符');if(r.name!==undefined&&r.name!==row.values[loc.defaultLocale])fail(p+'.name','派生名称与默认语言不符');}}
    for(const[key,signature]of Object.entries({'preview.banner':'floor,seed','dungeon.current':'floors,name','item.used':'name','item.hit':'name,target','preview.floor':'floor','item.usedSleep':'name','item.landed':'name','item.broken':'name','item.emptyCharges':'name','item.eat':'','item.use':'','item.throw':'','item.swing':'','dungeon.choose':'','dungeon.newRun':'','dungeon.return':'','dungeon.choiceHint':'','dungeon.helpStairs':'','skill.help':'','skill.ineligibleActive':'','skill.ineligiblePassive':''})) {const row=texts.get(key);if(!row)fail('$.localization.texts','缺少运行文本 '+key);else if(placeholders(row.values[loc.defaultLocale])!==signature)fail('$.localization.texts['+loc.texts.indexOf(row)+'].values.'+loc.defaultLocale,'运行文本参数必须为 '+signature);}
    for(const key of ['item.eat','item.use','item.throw','item.swing','item.usedSleep','item.landed','item.broken','item.emptyCharges','dungeon.choose','dungeon.newRun','dungeon.return','dungeon.choiceHint','dungeon.helpStairs','skill.help','skill.ineligibleActive','skill.ineligiblePassive'])if(!texts.has(key))fail('$.localization.texts','缺少运行文本 '+key);
    return errors;
  }
  function createTranslator(data,locale) {
    if(!data.localization.locales.includes(locale))throw new Error('不支持语言 '+locale);
    const texts=new Map(data.localization.texts.map(r=>[r.key,r.values[locale]]));
    return (key,params={})=>{if(!texts.has(key))throw new Error('文本key不存在: '+key);return texts.get(key).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(_,name)=>{if(!own(params,name))throw new Error('缺少占位符: '+key+'.'+name);return String(params[name]);});};
  }
  function parse(text,schema){if(new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('配置超过4MiB');const data=JSON.parse(text),errors=validate(data,schema);if(errors.length)throw new Error(errors.join('\n'));return data;}
  async function loadDefaults(){async function read(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw new Error(path+': HTTP '+r.status);return r.text();}const[raw,st]=await Promise.all([read('config/game.json'),read('config/schema.json')]);const schema=JSON.parse(st);return{data:parse(raw,schema),schema};}
  function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  function installRuntime(MD,data,options={}) {
    MD.config=freeze(data);MD.locale=options.locale||data.localization.defaultLocale;MD.t=createTranslator(data,MD.locale);
    MD.selectDungeon=function(id){if(!own(data.dungeons,id)||reserved.has(id))throw new Error('未知迷宫 '+id);if(MD.canSelectDungeon&&!MD.canSelectDungeon()&&id!==MD.dungeonId)throw new Error('冒险中不能切换迷宫，请回镇子后选择');MD.dungeonId=id;if(MD.storage){try{MD.storage.setItem('md-expedition-v1',JSON.stringify({version:1,dungeonId:id}));}catch(_){/* Unavailable browser storage must not prevent this session's selection. */}}return data.dungeons[id];};
    MD.floorConfig=function(floor=1){const dungeon=data.dungeons[MD.dungeonId];if(!Number.isInteger(floor)||floor<1||floor>dungeon.totalFloors)throw new Error('楼层超出迷宫 '+MD.dungeonId);const band=data.floorBands.find(b=>b.dungeonId===MD.dungeonId&&floor>=b.fromFloor&&floor<=b.toFloor);if(!band)throw new Error('楼层段缺失');return{dungeon,band,map:data.mapProfiles[band.mapProfileOverride||dungeon.mapProfileId],rules:Object.freeze({...data.rules,...data.ruleProfiles[band.ruleProfileOverride||dungeon.ruleProfileId]}),enemyEntries:data.enemyGroups[band.enemyGroupId],itemEntries:data.itemGroups[band.itemGroupId],themeId:band.themeId};};
    MD.dungeonId=options.dungeonId||data.defaultDungeonId;
    if(!own(data.dungeons,MD.dungeonId)||reserved.has(MD.dungeonId))throw new Error('未知迷宫 '+MD.dungeonId);
  }
  function seededRandom(seed){let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};random.getState=()=>state;random.setState=value=>{if(!Number.isInteger(value)||value<0||value>4294967295)throw new Error("Invalid random state");state=value>>>0;};return random;}
  function weightedPick(entries,random){const total=entries.reduce((s,e)=>s+e.weight,0),roll=random();let sum=0;for(const e of entries){sum+=e.weight;if(roll<Math.round(sum/total*1e12)/1e12)return e.id;}return entries[entries.length-1].id;}
  async function boot(){const{data}=await loadDefaults();const params=new URLSearchParams(global.location.search),preview=params.get('designer')==='1';const memory=new Map();const storage=preview?{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v))}:{getItem:k=>global.localStorage.getItem(k),setItem:(k,v)=>global.localStorage.setItem(k,String(v))};let savedId=data.defaultDungeonId;if(!preview){try{const saved=JSON.parse(storage.getItem('md-expedition-v1')||'null');if(saved&&saved.version===1&&own(data.dungeons,saved.dungeonId)&&!reserved.has(saved.dungeonId))savedId=saved.dungeonId;}catch(_){}}
    const dungeonId=params.has('dungeon')?params.get('dungeon'):savedId;if(!own(data.dungeons,dungeonId)||reserved.has(dungeonId))throw new Error('未知迷宫 '+dungeonId);
    const seedText=params.get('seed')||'42',floorText=params.get('floor')||'1';if(preview&&(!/^\d+$/.test(seedText)||Number(seedText)>4294967295||!/^\d+$/.test(floorText)||Number(floorText)<1||Number(floorText)>data.dungeons[dungeonId].totalFloors))throw new Error('试玩 seed 必须是0–4294967295整数，floor 必须在所选迷宫楼层内');
    const MD={storage};installRuntime(MD,data,{dungeonId,locale:params.get('lang')||data.localization.defaultLocale});MD.preview=preview?{seed:Number(seedText),floor:Number(floorText),dungeonId}:null;MD.random=seededRandom(preview?MD.preview.seed:(global.crypto&&global.crypto.getRandomValues?global.crypto.getRandomValues(new Uint32Array(1))[0]:Date.now()>>>0));MD.weightedPick=e=>weightedPick(e,MD.random);global.MD=MD;
  }
  global.MDConfig={validate,parse,loadDefaults,createTranslator,installRuntime,seededRandom,weightedPick,boot,MAX_BYTES};
})(typeof window!=='undefined'?window:globalThis);
