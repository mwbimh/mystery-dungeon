"""Versioned table/schema contract. Excel is the sole content authority."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def number(lo,hi,integer=True): return {'type':'integer' if integer else 'number','minimum':lo,'maximum':hi}
def string(lo=1,hi=100,**kw): return {'type':'string','minLength':lo,'maxLength':hi,**kw}
ID=string(1,64,pattern=r'^[A-Za-z][A-Za-z0-9_]*$')
KEY=string(1,100,pattern=r'^[A-Za-z][A-Za-z0-9_.-]*$')
def obj(props): return {'type':'object','properties':props,'required':list(props),'additionalProperties':False}
def mapping(spec): return {'type':'object','properties':{},'additionalProperties':spec,'minProperties':1,'propertyNames':ID}
def array(spec,lo=1,hi=100000): return {'type':'array','items':spec,'minItems':lo,'maxItems':hi}
def bounds(lo,hi,integer=True): return obj({'min':number(lo,hi,integer),'max':number(lo,hi,integer)})

# (default, minimum, maximum, Chinese description, unit, integer)
GLOBALS={
'player.hp':(30,1,10000,'玩家初始生命与生命上限','点',True),
'player.atk':(7,0,1000,'玩家基础攻击','点',True),'player.def':(2,0,1000,'玩家基础防御','点',True),
'player.belly':(100,1,1000,'玩家初始饱食与上限','点',True),
'rules.maxBag':(20,1,100,'背包容量','格',True),
'rules.activeSlots':(2,1,12,'新账号主动栏数量','格',True),'rules.passiveSlots':(1,1,12,'新账号被动栏数量','格',True),
'rules.maxActiveSlots':(4,1,12,'主动栏可解锁上限','格',True),'rules.maxPassiveSlots':(3,1,12,'被动栏可解锁上限','格',True),
'rules.hungerEvery':(10,1,10000,'每多少回合消耗一点饱食','回合',True),'rules.regenEvery':(8,1,10000,'生命自动回复周期','回合',True),
'rules.regenAmount':(1,1,1000,'每次生命回复量','点',True),'rules.starvationDamage':(1,0,1000,'饥饿每回合伤害','点',True),
'rules.hungerWarning':(20,1,1000,'低饱食提示阈值','点',True),'rules.hungerCritical':(10,0,1000,'危险饱食提示阈值','点',True),
'rules.starvationLogEvery':(3,1,10000,'饥饿伤害提示周期','回合',True),
'effects.bellyCap':(200,1,1000,'饱食上限最大值','点',True),'effects.bellyGrowth':(5,0,1000,'满腹进食时上限成长','点',True),
'effects.damageRoll.min':(-1,-1000,1000,'近战随机伤害下限','点',True),'effects.damageRoll.max':(1,-1000,1000,'近战随机伤害上限','点',True),
}
RULES={
'maxMonsters':(16,1,100,'同时存活怪物上限','只',True),'enemyScale':(.85,.01,10,'怪物生命和攻击倍率；取整下限1','倍率',False),
'wandererEvery':(55,1,10000,'游荡怪补充周期','回合',True),'roomEnemyChance':(.45,0,1,'普通房间初始怪出现概率','概率0–1',False),
'idleMoveChance':(.3,0,1,'非追击怪闲逛概率','概率0–1',False),
'floorItems.min':(3,0,100,'全层额外物品数量下限','个',True),'floorItems.max':(6,0,100,'全层额外物品数量上限','个',True),
'houseItems.min':(4,0,100,'怪物房初始物品数量下限','个',True),'houseItems.max':(7,0,100,'怪物房初始物品数量上限','个',True),
'houseTriggerItems.min':(1,0,100,'触发怪物房追加物品下限','个',True),'houseTriggerItems.max':(3,0,100,'触发怪物房追加物品上限','个',True),
'houseEnemyMin':(5,0,100,'触发怪物房刷怪下限','只',True),'houseEnemyMax':(10,0,100,'触发怪物房刷怪上限','只',True),
'houseEnemyAreaDivisor':(4,1,1000,'房间面积除以此值估算触发刷怪量','格/只',True),
'housePreEnemyMax':(2,0,100,'怪物房预放怪上限','只',True),'housePreEnemyAreaDivisor':(12,1,1000,'预放怪按房间面积除数','格/只',True),
'floorEnemySoftMax':(5,0,100,'全层初始怪补足软上限','只',True),'floorEnemyBase':(2,0,100,'全层初始怪补足基础量','只',True),
'floorEnemyEvery':(3,1,240,'每多少层提升补足数量','层',True),'floorEnemyEmptyReserve':(5,0,100,'补足后至少预留空格','格',True),
}
MAPS={
'width.min':(50,30,100,'地图宽度下限','格',True),'width.max':(60,30,100,'地图宽度上限','格',True),
'height.min':(30,24,80,'地图高度下限','格',True),'height.max':(36,24,80,'地图高度上限','格',True),
'skipRoomChance':(.18,0,1,'网格槽位跳过概率','概率0–1',False),'hallChance':(.28,0,1,'相邻房间合成大厅概率','概率0–1',False),
'loopChance':(.4,0,1,'额外连通走廊概率','概率0–1',False),
'monsterHouseChance.min':(.15,0,1,'每房间怪物房概率下限','概率0–1',False),'monsterHouseChance.max':(.25,0,1,'每房间怪物房概率上限','概率0–1',False),
}
for k,v,lo,hi,desc in [
('gridColsSmall',3,2,6,'窄地图网格列数'),('gridColsLarge',4,2,6,'宽地图网格列数'),('gridThreshold',56,30,101,'采用宽地图列数的宽度阈值'),
('gridRows',3,2,6,'网格行数'),('minRooms',5,2,36,'保证的有效房间槽数；合并大厅后房间数可少1'),
('roomWidthMin',5,3,30,'普通房间宽度下限'),('roomWidthMax',12,3,30,'普通房间宽度上限'),
('roomHeightMin',4,3,20,'普通房间高度下限'),('roomHeightMax',9,3,20,'普通房间高度上限'),
('hallWidthMin',14,3,60,'大厅宽度下限'),('hallWidthMax',22,3,60,'大厅宽度上限'),
('hallHeightMin',6,3,30,'大厅高度下限'),('hallHeightMax',10,3,30,'大厅高度上限'),
('extraLoopMax',2,0,20,'额外走廊最大条数'),('extraLoopDivisor',4,1,100,'候选连接边数除以此值决定额外走廊数')]:
 MAPS[k]=(v,lo,hi,desc,'格/条' if 'Loop' in k else '格/个',True)

def nested(specs):
 out={}
 for path,(_,lo,hi,_,_,integer) in specs.items():
  p=out
  parts=path.split('.')
  for part in parts[:-1]: p=p.setdefault(part,{})
  p[parts[-1]]=number(lo,hi,integer)
 def wrap(p): return obj({k:v if 'type' in v else wrap(v) for k,v in p.items()})
 return wrap(out)

SCHEMA=nested(GLOBALS)
SCHEMA['properties'].update({
'version':number(2,2),'defaultDungeonId':ID,
'enemies':mapping(obj({'name':string(1,100),'nameKey':KEY,'color':string(7,7,pattern=r'^#[0-9a-fA-F]{6}$'),'hp':number(1,10000),'atk':number(0,1000),'def':number(0,1000),'glyph':string(1,2),'behaviorTemplate':string(enum=['chase'])})),
'items':mapping(obj({'name':string(1,100),'nameKey':KEY,'color':string(7,7,pattern=r'^#[0-9a-fA-F]{6}$'),'useEffectId':ID,'throwEffectId':ID,'swingEffectId':ID,'chargesMin':number(0,100),'chargesMax':number(0,100),'activeSkill':number(0,1),'passiveSkill':number(0,1),'dropOnMiss':number(0,1)})),
'itemEffects':mapping(obj({'kind':string(enum=['none','food','sleep','damage','knockback']),'power':number(0,10000),'turnsMin':number(0,1000),'turnsMax':number(0,1000),'range':number(0,200),'wallDamage':number(0,10000)})),
'ruleProfiles':mapping(nested(RULES)),'mapProfiles':mapping(nested(MAPS)),
'dungeons':mapping(obj({'id':ID,'nameKey':KEY,'totalFloors':number(1,240),'mapProfileId':ID,'ruleProfileId':ID})),
'floorBands':array(obj({'id':ID,'dungeonId':ID,'fromFloor':number(1,240),'toFloor':number(1,240),'themeId':ID,'enemyGroupId':ID,'itemGroupId':ID,'mapProfileOverride':string(0,64),'ruleProfileOverride':string(0,64)}),1,10000),
'enemyGroups':mapping(array(obj({'id':ID,'weight':number(0,100000,False)}),1,1000)),
'itemGroups':mapping(array(obj({'id':ID,'weight':number(0,100000,False)}),1,1000)),
'themeCatalog':mapping(obj({'nameKey':KEY})),
'localization':obj({'defaultLocale':string(2,32),'locales':array(string(2,32),1,100),'texts':array(obj({'key':KEY,'values':{'type':'object','properties':{},'additionalProperties':string(1,4000),'minProperties':1}}),1,100000)})
})
SCHEMA['required']=list(SCHEMA['properties'])

TABLES={}
def table(book,name,fields,index='id'):
 TABLES[name]={'book':book+'.xlsx','fields':fields,'index':index}
def f(name,kind='string',desc='',ref=None,optional=False):return {'name':name,'type':kind,'description':desc or name,'ref':ref,'optional':optional}
table('rules','Settings',[f('path',desc='固定规则路径；请修改数值，不改路径'),f('value','double','数值；单位和范围见字段说明')],'path')
for name,book,specs in [('Rule','rules',RULES),('Map','dungeons',MAPS)]:
 table(book,name+'Profiles',[f('id',desc='配置组稳定ID；可新增并复制整组参数')])
 table(book,name+'Values',[f('profileId',desc='所属配置组ID',ref=name+'Profiles'),f('path',desc='参数路径；单位和范围见字段说明'),f('value','double','参数数值')],None)
table('monsters','Enemies',[f('id',desc='怪物稳定ID；对应 assets/runtime/<id>.png'),f('nameKey',desc='显示名称文本key',ref='TextKeys'),f('color',desc='后备颜色 #RRGGBB'),f('hp','int','基础生命 1–10000'),f('atk','int','基础攻击 0–1000'),f('def','int','基础防御 0–1000'),f('glyph',desc='后备字符 1–2字'),f('behaviorTemplate',desc='已有行为模板：chase（追击近战）')])
table('items','ItemEffects',[f('id',desc='效果稳定ID；none代表无动作'),f('kind',desc='none / food / sleep / damage / knockback'),f('power','int','饱食/伤害强度 0–10000；其他模板填0'),f('turnsMin','int','睡眠回合下限；非sleep填0'),f('turnsMax','int','睡眠回合上限；非sleep填0'),f('range','int','投掷/挥杖射程 1–200；use填0'),f('wallDamage','int','击退撞墙伤害；非knockback填0')])
table('items','Items',[f('id',desc='物品稳定ID；对应 assets/runtime/<id>.png'),f('nameKey',desc='显示名称文本key',ref='TextKeys'),f('color',desc='后备颜色 #RRGGBB'),*[f(k,desc=d,ref='ItemEffects') for k,d in [('useEffectId','使用/吃效果；无动作填none'),('throwEffectId','投掷效果；无动作填none'),('swingEffectId','挥杖效果；无动作填none')]],f('chargesMin','int','杖初始次数下限；非杖填0'),f('chargesMax','int','杖初始次数上限；非杖填0'),f('activeSkill','int','可放主动栏：0否/1是'),f('passiveSkill','int','当前必须0；尚无被动效果模板'),f('dropOnMiss','int','投掷落空落地：0销毁/1掉落')])
table('dungeons','Dungeons',[f('id',desc='迷宫稳定ID；original为旧版默认'),f('nameKey',desc='迷宫名称文本key',ref='TextKeys'),f('totalFloors','int','通关层数 1–240'),f('mapProfileId',desc='默认地图配置',ref='MapProfiles'),f('ruleProfileId',desc='默认规则配置',ref='RuleProfiles'),f('isDefault','int','默认迷宫：只能一行填1，其余0')])
table('dungeons','ThemeCatalog',[f('id',desc='代码支持的渲染主题ID'),f('nameKey',desc='主题名称文本key',ref='TextKeys')])
table('dungeons','FloorBands',[f('id',desc='楼层段唯一ID'),f('dungeonId',desc='所属迷宫；不可跨迷宫串用',ref='Dungeons'),f('fromFloor','int','起始层（含）'),f('toFloor','int','终止层（含）；连续覆盖整个迷宫'),f('themeId',desc='本段环境主题',ref='ThemeCatalog'),f('enemyGroupId',desc='本段怪物权重组',ref='EnemyGroups'),f('itemGroupId',desc='本段物品权重组',ref='ItemGroups'),f('mapProfileOverride',desc='留空继承迷宫；填写则整组覆盖',optional=True),f('ruleProfileOverride',desc='留空继承迷宫；填写则整组覆盖',optional=True)])
for prefix,entity in [('Enemy','Enemies'),('Item','Items')]:
 table('spawns',prefix+'Groups',[f('id',desc='可共享的权重组ID')])
 table('spawns',prefix+'Spawns',[f('groupId',desc='所属权重组',ref=prefix+'Groups'),f('id',desc='内容稳定ID',ref=entity),f('weight','double','相对权重 ≥0；同组总和>0，不需加到100')],None)
table('texts','Locales',[f('id',desc='语言ID；例如 zh-CN / en / ja'),f('name',desc='语言名称'),f('isDefault','int','默认语言：只能一行填1，其余0')])
table('texts','TextKeys',[f('key',desc='稳定文本key；名称不可带占位符'),f('context',desc='翻译语境/用途，不进入运行配置')],'key')
table('texts','Translations',[f('key',desc='文本key',ref='TextKeys'),f('locale',desc='语言ID',ref='Locales'),f('text',desc='译文；各语言 {参数名} 必须一致')],None)

def write_contract():
 (ROOT/'config/schema.json').write_text(json.dumps(SCHEMA,ensure_ascii=False,indent=2)+'\n')
 lines=['<module name="">']
 for name,t in TABLES.items():
  lines.append(f'  <bean name="{name}Row">')
  for field in t['fields']:
   typ=field['type']+('#ref='+field['ref'] if field['ref'] else '')
   lines.append(f'    <var name="{field["name"]}" type="{typ}" />')
  lines.append('  </bean>')
  index=f'index="{t["index"]}"' if t['index'] else 'mode="list"'
  lines.append(f'  <table name="{name}" value="{name}Row" input="{name}@{t["book"]}" {index} />')
 lines.append('</module>')
 (ROOT/'config/Defines/tables.xml').write_text('\n'.join(lines)+'\n')

# Human-facing annotations are compiled by Luban, then intentionally omitted from runtime.
for name in ['Settings','RuleValues','MapValues']:
 TABLES[name]['fields'] += [f('description',desc='中文说明（不进入运行配置）'),f('unit',desc='单位（不进入运行配置）'),f('allowedRange',desc='范围/约束（不进入运行配置）'),f('example',desc='参考例子（不进入运行配置）')]

if __name__=='__main__':write_contract()
