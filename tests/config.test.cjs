'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const defaults=()=>JSON.parse(read('tests/fixtures/default-config-v2.json')),schema=JSON.parse(read('config/schema.json'));
function env(options={}) {const data=options.data||defaults(),calls=[],persisted=new Map();const context=vm.createContext({TextEncoder,URLSearchParams,console,location:{search:options.search||''},localStorage:{getItem:k=>{calls.push(['get',k]);return persisted.get(k)||null;},setItem:(k,v)=>{calls.push(['set',k]);persisted.set(k,v);}},fetch:async url=>({ok:url!==options.failPath,status:404,text:async()=>url.endsWith('schema.json')?JSON.stringify(schema):options.corrupt?'{':JSON.stringify(data)})});vm.runInContext(read('js/config.js'),context);return{api:context.MDConfig,context,calls,persisted};}
const cases=[
 ['missing global section',d=>delete d.player],['unknown field',d=>d.player.hpTypo=1],['null object',d=>d.mapProfiles=null],['array object',d=>d.player=[]],
 ['numeric text',d=>d.player.hp='30'],['fractional integer',d=>d.player.hp=1.5],['infinity',d=>d.ruleProfiles.classic.enemyScale=Infinity],['range',d=>d.player.hp=0],
 ['chance',d=>d.mapProfiles.classic.hallChance=1.1],['version',d=>d.version=3],['min/max',d=>d.mapProfiles.classic.width={min:60,max:50}],
 ['belly cap',d=>d.effects.bellyCap=1],['skill caps',d=>d.rules.activeSlots=5],['color',d=>d.items.rock.color='red'],['padded name',d=>d.items.rock.name=' x'],
 ['ranged food',d=>d.items.rock.throwEffectId='foodSmall'],['use knockback',d=>d.items.onigiri.useEffectId='knockSwing'],['negative effect',d=>d.itemEffects.rockImpact.power=-1],
 ['empty group',d=>d.itemGroups.classicLoot=[]],['reserved sprite',d=>d.items.player={...d.items.rock}],['cross-catalog ID',d=>d.items.slime={...d.items.rock}],
 ['active no action',d=>{d.items.rock.throwEffectId='none';}],['unsupported passive',d=>d.items.rock.passiveSkill=1],['zero sleep',d=>d.itemEffects.sleepUse.turnsMin=0],
 ['map grid overflow',d=>{d.mapProfiles.classic.gridColsSmall=6;d.mapProfiles.classic.width={min:30,max:30};}],['map room overflow',d=>d.mapProfiles.classic.minRooms=36],
 ['unknown locale',d=>d.localization.defaultLocale='xx'],['missing translation',d=>delete d.localization.texts[0].values['zh-CN']],
];
for(const[label,change]of cases)test('v2 rejects '+label,()=>{const{api}=env(),d=defaults();change(d);const errors=api.validate(d,schema);assert.ok(errors.length,label);assert.match(errors[0],/^\$/);});
test('default validates and parser returns unchanged catalog',()=>{const{api}=env();assert.deepEqual(Array.from(api.validate(defaults(),schema)),[]);assert.deepEqual(JSON.parse(JSON.stringify(api.parse(JSON.stringify(defaults()),schema))),defaults());});
test('parse rejects invalid JSON, unknown structures and 4MiB UTF8 limit',()=>{const{api}=env();assert.throws(()=>api.parse('{',schema));assert.throws(()=>api.parse('{}',schema),/缺少字段/);assert.throws(()=>api.parse('"'+'汉'.repeat(1400000)+'"',schema),/4MiB/);});
test('boot failure never exposes unvalidated globals',async()=>{for(const options of[{failPath:'config/game.json'},{failPath:'config/schema.json'},{corrupt:true},{data:{}}]){const{api,context}=env(options);await assert.rejects(api.boot());assert.equal(context.MD,undefined);}});
test('boot freezes nested shared content',async()=>{const{api,context}=env();await api.boot();function check(v){if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(check);}}check(context.MD.config);});
test('preview has reproducible RNG with no account storage use',async()=>{const a=env({search:'?designer=1&seed=0'}),b=env({search:'?designer=1&seed=0'});await a.api.boot();await b.api.boot();a.context.MD.selectDungeon('trainingGrove');assert.equal(a.calls.length,0);for(let i=0;i<20;i++)assert.equal(a.context.MD.random(),b.context.MD.random());});
test('preview validates all seed/floor boundaries',async()=>{for(const q of ['seed=-1','seed=4294967296','seed=1.5','seed=abc','floor=0','floor=25','floor=1.5'])await assert.rejects(env({search:'?designer=1&'+q}).api.boot(),/seed/);await env({search:'?designer=1&seed=4294967295'}).api.boot();});
test('normal mode ignores preview-only invalid seed/floor',async()=>{const{api,context}=env({search:'?seed=no&floor=999'});await api.boot();assert.equal(context.MD.preview,null);});
test('dynamic locale translates and enforces placeholder arguments',()=>{const{api}=env(),d=defaults();const t=api.createTranslator(d,'en');assert.equal(t('dungeon.current',{name:'Grove',floors:3}),'Grove · 3 floors');assert.throws(()=>t('dungeon.current',{}),/占位符/);assert.throws(()=>t('missing.key'),/不存在/);assert.throws(()=>api.createTranslator(d,'unknown'),/语言/);});

test('selection remains playable when browser storage is unavailable',async()=>{const{api,context}=env();await api.boot();context.MD.storage.setItem=()=>{throw new Error('quota');};context.MD.selectDungeon('trainingGrove');assert.equal(context.MD.floorConfig(1).dungeon.id,'trainingGrove');});
