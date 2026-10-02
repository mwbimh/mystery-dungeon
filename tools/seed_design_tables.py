"""One-time migration seed for v2 workbooks; never used to export runtime data.

Kept for audit/reproduction only. Running this writes a JSON authoring plan, not
game.json. Designers edit XLSX thereafter; builds never recreate workbooks.
"""
import json
from pathlib import Path
from config_contract import ROOT,TABLES,GLOBALS,RULES,MAPS,write_contract

def main(destination):
 old=json.loads((ROOT/'tests/fixtures/default-config-v1.json').read_text())
 data={name:[] for name in TABLES}
 data['Settings']=[[k,v[0],v[3],v[4],f'{v[1]}–{v[2]}',str(v[0])] for k,v in GLOBALS.items()]
 for label,spec,profiles in [('Rule',RULES,['classic','gentle']),('Map',MAPS,['classic','grove'])]:
  data[label+'Profiles']=[[id] for id in profiles]
  for id in profiles:
   for k,v in spec.items():
    value=v[0]
    if id=='gentle':value={'enemyScale':.65,'maxMonsters':10,'roomEnemyChance':.25}.get(k,value)
    if id=='grove':value={'width.min':50,'width.max':50,'height.min':30,'height.max':30,'skipRoomChance':.1,'monsterHouseChance.min':0,'monsterHouseChance.max':0}.get(k,value)
    data[label+'Values'].append([id,k,value,v[3],v[4],f'{v[1]}–{v[2]}',str(v[0])])
 for id,e in old['enemies'].items():data['Enemies'].append([id,e['nameKey'],e['color'],e['hp'],e['atk'],e['def'],e['glyph'],'chase'])
 data['Enemies'].append(['emberSlime','enemy.emberSlime.name','#fb7185',8,4,0,'焰','chase'])
 data['ItemEffects']=[
  ['none','none',0,0,0,0,0],['foodSmall','food',50,0,0,0,0],['foodLarge','food',100,0,0,0,0],['foodTravel','food',75,0,0,0,0],
  ['foodImpact','damage',1,0,0,8,0],['rockImpact','damage',8,0,0,8,0],['sleepUse','sleep',0,4,6,0,0],['sleepThrow','sleep',0,4,6,8,0],
  ['knockThrow','knockback',0,0,0,10,5],['knockSwing','knockback',0,0,0,100,5]]
 specs={'onigiri':['foodSmall','foodImpact','none',0,0,0,0,1],'bigOnigiri':['foodLarge','foodImpact','none',0,0,0,0,1],
 'rock':['none','rockImpact','none',0,0,1,0,1],'sleepHerb':['sleepUse','sleepThrow','none',0,0,0,0,1],
 'knockStaff':['none','knockThrow','knockSwing',4,6,1,0,0]}
 for id,e in old['items'].items():data['Items'].append([id,e['nameKey'],e['color'],*specs[id]])
 data['Items'].append(['travelOnigiri','item.travelOnigiri.name','#fde68a','foodTravel','foodImpact','none',0,0,0,0,1])
 data['Dungeons']=[['original','dungeon.original.name',24,'classic','classic',1],['trainingGrove','dungeon.trainingGrove.name',3,'grove','gentle',0]]
 data['ThemeCatalog']=[[id,f'theme.{id}.name'] for id in old['themes']['order']]
 data['EnemyGroups']=[[id] for id in ['opening','early','deep','groveOnly']]
 for id,g in zip(['opening','early','deep'],old['enemySpawns']):
  data['EnemySpawns'] += [[id,e['id'],e['weight']] for e in g['entries']]
 data['EnemySpawns'].append(['groveOnly','emberSlime',1])
 data['ItemGroups']=[['classicLoot'],['groveLoot']]
 data['ItemSpawns']=[['classicLoot',e['id'],e['weight']] for e in old['itemDrops']]+[['groveLoot','travelOnigiri',1]]
 for start,end in [(1,1),(2,3),(4,6),(7,9),(10,12),(13,15),(16,18),(19,21),(22,24)]:
  data['FloorBands'].append([f'original{start:02d}','original',start,end,old['themes']['order'][(start-1)//3], 'opening' if start==1 else 'early' if start==2 else 'deep','classicLoot','',''])
 data['FloorBands'] += [['grove01','trainingGrove',1,2,'forest','groveOnly','groveLoot','',''],['grove03','trainingGrove',3,3,'wetcave','groveOnly','groveLoot','','classic']]
 texts={r['key']:[r['zhCN'],r['en']] for r in old['localization']['texts']}
 texts.update({
 'enemy.emberSlime.name':['焰色史莱姆','Ember Slime'],'item.travelOnigiri.name':['旅行饭团','Travel Rice Ball'],
 'dungeon.original.name':['原初迷宫','Original Dungeon'],'dungeon.trainingGrove.name':['试炼林地','Training Grove'],
 'dungeon.choose':['选择迷宫','Choose dungeon'],'dungeon.current':['{name} · 共 {floors} 层','{name} · {floors} floors'],
 'dungeon.newRun':['开始新冒险','Start new adventure'],'dungeon.return':['回镇子换迷宫','Return to town'],
 'dungeon.choiceHint':['从第 1 层开始；回镇子后可切换迷宫','Start on floor 1; return to town to change dungeons'],
 'dungeon.helpStairs':['踩上下楼楼梯进入下一层，到所选迷宫的最后一层出口通关','Take the stairs to the next floor; exit the selected dungeon’s final floor to finish'],
 'skill.help':['标记为主动的物品可拖入主动栏；按住向外拖动瞄准释放。右键卸下会丢弃物品；被动栏按物品资格开放','Drag eligible items into active slots, then drag outward to aim. Right-click discards an equipped item; passive slots accept eligible items'],
 'skill.ineligibleActive':['这个物品不能放入主动栏。','This item cannot be equipped in an active slot.'],
 'skill.ineligiblePassive':['这个物品不能放入被动栏。','This item cannot be equipped in a passive slot.'],
 'item.use':['使用','Use'],'item.eat':['吃','Eat'],'item.throw':['扔','Throw'],'item.swing':['挥','Swing'],
 'item.used':['使用了{name}。','Used {name}.'],'item.usedSleep':['使用了{name}……睡着了。','Used {name}… fell asleep.'],
 'item.hit':['{name}击中了{target}！','{name} hit {target}!'],'item.landed':['{name}落在了地上。','{name} landed on the ground.'],
 'item.broken':['{name}摔碎了。','{name} broke.'],'item.emptyCharges':['{name}的次数已经用尽了。','{name} has no charges left.']})
 data['Locales']=[['zh-CN','简体中文',1],['en','English',0]]
 data['TextKeys']=[[k,'名称（无占位符）' if k.endswith('.name') else '游戏界面/动作提示；保留占位符'] for k in texts]
 data['Translations']=[[k,locale,pair[i]] for k,pair in texts.items() for i,locale in enumerate(['zh-CN','en'])]
 books={}
 for name,t in TABLES.items():books.setdefault(t['book'],[]).append({'name':name,'fields':t['fields'],'rows':data[name]})
 notes={
  'rules.xlsx':[['规则位置','字段','说明','单位','允许范围','默认例子']]+[['Settings',k,v[3],v[4],f'{v[1]}–{v[2]}',v[0]] for k,v in GLOBALS.items()]+[['RuleValues',k,v[3],v[4],f'{v[1]}–{v[2]}',v[0]] for k,v in RULES.items()],
  'dungeons.xlsx':[['规则位置','字段','说明','单位','允许范围','默认例子']]+[['MapValues',k,v[3],v[4],f'{v[1]}–{v[2]}',v[0]] for k,v in MAPS.items()]
 }
 (Path(destination)).write_text(json.dumps({'books':books,'notes':notes},ensure_ascii=False,indent=2))
 write_contract()
if __name__=='__main__':
 import sys
 main(sys.argv[1])
