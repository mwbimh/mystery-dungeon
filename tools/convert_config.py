#!/usr/bin/env python3
"""Six Excel domains → pinned Luban 5.1 → shared runtime validation → atomic JSON.

openpyxl reads cell types/coordinates only. Every exported value comes from
Luban's typed JSON. There is deliberately no alternate Excel-to-JSON exporter.
"""
import argparse,json,math,os,re,shutil,subprocess,sys,tempfile
from pathlib import Path
import openpyxl
from config_contract import ROOT,TABLES,GLOBALS,RULES,MAPS

MAX_BYTES=4*1024*1024
class ConfigError(ValueError):pass

def preflight(directory):
    tables={}; files={}
    for filename in sorted({t['book'] for t in TABLES.values()}):
        path=directory/filename
        try:book=openpyxl.load_workbook(path,data_only=False)
        except Exception as e:raise ConfigError(f'{path}:Workbook!A1: cannot read workbook: {e}') from e
        try:
            expected={n for n,t in TABLES.items() if t['book']==filename}|{'Guide','Fields'}
            if set(book.sheetnames)!=expected:raise ConfigError(f'{path}:Workbook!A1: expected sheets {sorted(expected)}, got {book.sheetnames}')
            for name in book.sheetnames:
                ws=book[name]
                for cells in ws:
                    for c in cells:
                        if c.data_type in ('f','e'):raise ConfigError(f'{path}:{name}!{c.coordinate}: formulas and Excel errors forbidden; use literal values (notes are not exported)')
                if name not in TABLES:continue
                fields=TABLES[name]['fields'];headers=['##var']+[f['name'] for f in fields]
                if ws.sheet_state != 'visible':raise ConfigError(f'{path}:{name}!A1: data sheets must remain visible')
                if ws.merged_cells.ranges:raise ConfigError(f'{path}:{name}!A1: merged data cells forbidden')
                if [ws.cell(1,i+1).value for i in range(len(headers))]!=headers:raise ConfigError(f'{path}:{name}!A1: expected headers {headers}')
                for cells in ws.iter_rows():
                    for cell in cells:
                        if cell.column>len(headers) and cell.value is not None:raise ConfigError(f'{path}:{name}!{cell.coordinate}: unexpected extra column')
                if ws.cell(2,1).value!='##':raise ConfigError(f'{path}:{name}!A2: missing description row')
                records=[]
                for row in range(3,ws.max_row+1):
                    values=[ws.cell(row,i+2).value for i in range(len(fields))]
                    if not any(v is not None for v in values):continue
                    if ws.row_dimensions[row].hidden:raise ConfigError(f'{path}:{name}!A{row}: hidden data rows forbidden; show rows before compiling')
                    if ws.cell(row,1).value is not None:raise ConfigError(f'{path}:{name}!A{row}: data marker must be blank')
                    for col,field in enumerate(fields,2):
                        value=ws.cell(row,col).value;where=f'{path}:{name}!{openpyxl.utils.get_column_letter(col)}{row}'
                        if value is None or value=='':
                            if field['optional']:continue
                            raise ConfigError(f'{where}: required cell is blank')
                        if field['type'] in ('int','double'):
                            if type(value) not in (int,float) or not math.isfinite(value) or (field['type']=='int' and value!=int(value)):raise ConfigError(f'{where}: expected finite native {field["type"]}; numeric text, fractions/boolean forbidden')
                        elif not isinstance(value,str) or value!=value.strip():raise ConfigError(f'{where}: expected trimmed text')
                    for col in range(len(headers)+1,ws.max_column+1):
                        if ws.cell(row,col).value is not None:raise ConfigError(f'{path}:{name}!{openpyxl.utils.get_column_letter(col)}{row}: unexpected extra column')
                    records.append((row,values))
                tables[name]=records;files[name]=path
        finally:book.close()
    return tables,files

def convert(directory=None,dotnet=None,luban=None):
    directory=Path(directory or ROOT/'config');tables,files=preflight(directory)
    locations={}
    def at(sheet,i=0,field=None):
        row=tables[sheet][i][0] if i<len(tables[sheet]) else 1
        col=2+[f['name'] for f in TABLES[sheet]['fields']].index(field) if field else 2
        return f'{files[sheet]}:{sheet}!{openpyxl.utils.get_column_letter(col)}{row}'
    def loc(path,sheet,i=0,field=None):locations[path]=at(sheet,i,field)
    def fail(sheet,i,field,message):raise ConfigError(f'{at(sheet,i,field)}: {message}')
    dotnet=dotnet or os.environ.get('DOTNET_COMMAND','dotnet');luban=Path(luban or os.environ.get('LUBAN_DLL',str(ROOT/'.tools/luban/Luban/Luban.dll')))
    if not luban.is_file():raise ConfigError(f'{directory}:Workbook!A1: Luban missing; run python tools/install_luban.py (no fallback exporter)')
    with tempfile.TemporaryDirectory(prefix='mystery-luban-') as tmp:
        stage=Path(tmp)
        for filename in sorted({t['book'] for t in TABLES.values()}):shutil.copy2(directory/filename,stage/filename)
        shutil.copytree(ROOT/'config/Defines',stage/'Defines');shutil.copy2(ROOT/'config/luban.conf',stage/'luban.conf')
        command=[str(dotnet),str(luban.resolve()),'--conf',str(stage/'luban.conf'),'-t','client','-d','json','--strict','--errorFormat','json','-x',f'outputDataDir={stage/"output"}']
        try:compiled=subprocess.run(command,cwd=stage,text=True,capture_output=True,timeout=120)
        except (OSError,subprocess.TimeoutExpired) as e:raise ConfigError(f'{directory}:Workbook!A1: could not run Luban: {e}') from e
        if compiled.returncode:
            diagnostics=compiled.stdout+compiled.stderr;pointers=[]
            def point(sheet,field,value):
                if sheet not in TABLES:return
                names=[f['name'] for f in TABLES[sheet]['fields']]
                if field not in names:return
                for i,(_,values) in enumerate(tables[sheet]):
                    if values[names.index(field)]==value:pointers.append(at(sheet,i,field))
            for m in re.finditer(r'record (\w+)(?:\[[^\]]*\])?\.(\w+)(?: = |:)(.*?) \(from file:',diagnostics):
                try:point(m[1],m[2],json.loads(m[3]))
                except ValueError:pass
            for m in re.finditer(r'\{\s*"version"\s*:',diagnostics):
                try:
                    report,_=json.JSONDecoder().raw_decode(diagnostics[m.start():])
                    for error in report.get('errors',[]):
                        if error.get('code')=='error.data.duplicate_key':
                            sheet,field,value=error['args'][:3];point(sheet,field,json.loads(value))
                except (ValueError,KeyError):pass
            for filename in {t['book'] for t in TABLES.values()}:diagnostics=diagnostics.replace(str(stage)+'/./'+filename,str(directory/filename)).replace(str(stage/filename),str(directory/filename))
            raise ConfigError('\n'.join(dict.fromkeys(pointers))+f'\n{directory}:Workbook!A1: Luban failed; no outputs published\n'+diagnostics)
        exported={name:json.loads((stage/'output'/f'{name.lower()}.json').read_text()) for name in TABLES}
    def nested_set(target,path,value):
        keys=path.split('.');p=target
        for k in keys[:-1]:p=p.setdefault(k,{})
        p[keys[-1]]=value
    data={'version':2}
    def settings(sheet,specs,target,prefix,rows):
        seen=set()
        for i,row in rows:
            key=row['path'];loc(prefix+'.'+key,sheet,i,'value')
            if key not in specs:fail(sheet,i,'path','unknown setting path')
            if key in seen:fail(sheet,i,'path','duplicate setting path')
            seen.add(key);value=row['value'];spec=specs[key]
            if spec[5] and value!=int(value):fail(sheet,i,'value','expected integer')
            nested_set(target,key,int(value) if spec[5] else value)
        for key in specs.keys()-seen:fail(sheet,0,'path','missing setting '+key)
    settings('Settings',GLOBALS,data,'$',list(enumerate(exported['Settings'])))
    for label,specs in [('Rule',RULES),('Map',MAPS)]:
        section=label.lower()+'Profiles';data[section]={}
        for pi,profile in enumerate(exported[label+'Profiles']):
            id=profile['id'];data[section][id]={};loc('$.'+section+'.'+id,label+'Profiles',pi,'id')
            settings(label+'Values',specs,data[section][id],'$.'+section+'.'+id,[(i,r) for i,r in enumerate(exported[label+'Values']) if r['profileId']==id])
    locales=exported['Locales'];defaults=[r['id'] for r in locales if r['isDefault']==1]
    if len(defaults)!=1:fail('Locales',0,'isDefault','exactly one default locale is required')
    for i,r in enumerate(locales):
        if r['isDefault'] not in (0,1):fail('Locales',i,'isDefault','expected 0 or 1')
        if not re.fullmatch(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*',r['id']):fail('Locales',i,'id','expected locale such as zh-CN, en, ja')
    textrows={r['key']:{'key':r['key'],'values':{}} for r in exported['TextKeys']}
    for i,r in enumerate(exported['Translations']):
        if r['locale'] in textrows[r['key']]['values']:fail('Translations',i,'locale','duplicate key+locale translation')
        textrows[r['key']]['values'][r['locale']]=r['text']
    texts=sorted(textrows.values(),key=lambda r:r['key']);indices={r['key']:i for i,r in enumerate(texts)}
    for i,r in enumerate(exported['TextKeys']):loc('$.localization.texts['+str(indices[r['key']])+']','TextKeys',i,'key')
    for i,r in enumerate(exported['Translations']):loc('$.localization.texts['+str(indices[r['key']])+'].values.'+r['locale'],'Translations',i,'text')
    loc('$.localization.defaultLocale','Locales',0,'isDefault');loc('$.localization.texts','TextKeys',0,'key')
    data['localization']={'defaultLocale':defaults[0],'locales':sorted(r['id'] for r in locales),'texts':texts}
    for sheet,section in [('Enemies','enemies'),('Items','items'),('ItemEffects','itemEffects'),('ThemeCatalog','themeCatalog'),('Dungeons','dungeons')]:
        data[section]={}
        for i,row in enumerate(exported[sheet]):
            id=row['id'];entry={k:v for k,v in row.items() if k not in ('id','isDefault')};data[section][id]=entry
            if sheet=='Dungeons':entry['id']=id
            if sheet in ('Enemies','Items'):entry['name']=textrows[entry['nameKey']]['values'].get(defaults[0],'')
            loc('$.'+section+'.'+id,sheet,i,'id')
            for field in row:loc('$.'+section+'.'+id+'.'+field,sheet,i,field)
            if sheet in ('Enemies','Items'):loc('$.'+section+'.'+id+'.name',sheet,i,'nameKey')
    defaults=[r['id'] for r in exported['Dungeons'] if r['isDefault']==1]
    if len(defaults)!=1:fail('Dungeons',0,'isDefault','exactly one default dungeon required')
    for i,r in enumerate(exported['Dungeons']):
        if r['isDefault'] not in (0,1):fail('Dungeons',i,'isDefault','expected 0 or 1')
    data['defaultDungeonId']=defaults[0]
    data['floorBands']=sorted(exported['FloorBands'],key=lambda r:(r['dungeonId'],r['fromFloor'],r['id']))
    for i,r in enumerate(exported['FloorBands']):
        n=data['floorBands'].index(r)
        for f in r:loc(f'$.floorBands[{n}].{f}','FloorBands',i,f)
        loc(f'$.floorBands[{n}]','FloorBands',i,'id')
    for prefix in ['Enemy','Item']:
        section=prefix.lower()+'Groups';data[section]={r['id']:[] for r in exported[prefix+'Groups']}
        for gi,r in enumerate(exported[prefix+'Groups']):loc('$.'+section+'.'+r['id'],prefix+'Groups',gi,'id')
        for i,r in enumerate(exported[prefix+'Spawns']):
            group=data[section][r['groupId']];n=len(group);group.append({'id':r['id'],'weight':r['weight']})
            for f in ['id','weight']:loc(f'$.{section}.{r["groupId"]}[{n}].{f}',prefix+'Spawns',i,f)
    # Shared semantic validator is also the browser's untrusted-import validator.
    validator="const fs=require('fs'),vm=require('vm');vm.runInThisContext(fs.readFileSync(process.argv[1],'utf8'));const p=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(MDConfig.validate(p,JSON.parse(fs.readFileSync(process.argv[2],'utf8')))));"
    result=subprocess.run(['node','-e',validator,str(ROOT/'js/config.js'),str(ROOT/'config/schema.json')],input=json.dumps(data,ensure_ascii=False),text=True,capture_output=True,timeout=30)
    if result.returncode:raise ConfigError(f'{directory}:Workbook!A1: runtime validator failed: {result.stderr}')
    errors=json.loads(result.stdout)
    if errors:
        messages=[]
        for e in errors:
            path=e.split(': ',1)[0];candidates=[p for p in locations if path==p or path.startswith(p+'.') or path.startswith(p+'[')]
            source=locations[max(candidates,key=len)] if candidates else f'{directory}:Workbook!A1'
            messages.append(source+': '+e)
        raise ConfigError('\n'.join(messages))
    for section in ['enemies','items']:
        for id in data[section]:
            filename={'sleepHerb':'herb','knockStaff':'staff'}.get(id,id)
            asset=ROOT/'assets/runtime'/f'{filename}.png'
            if not asset.is_file() or asset.read_bytes()[:8]!=b'\x89PNG\r\n\x1a\n':raise ConfigError(f'{locations["$."+section+"."+id]}: missing valid asset {asset}; IDs map directly to filenames')
    if len((json.dumps(data,ensure_ascii=False,indent=2,sort_keys=True)+'\n').encode())>MAX_BYTES:raise ConfigError(f'{directory}:Workbook!A1: generated config exceeds 4MiB; split delivery before expanding further')
    return data

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-dir',type=Path,default=ROOT/'config');parser.add_argument('--output',type=Path,default=ROOT/'config/game.json');parser.add_argument('--dotnet');parser.add_argument('--luban');parser.add_argument('--check',action='store_true');args=parser.parse_args()
    try:
        data=convert(args.config_dir,args.dotnet,args.luban)
        if not args.check:
            args.output.parent.mkdir(parents=True,exist_ok=True);temporary=None
            try:
                with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',newline='\n',dir=args.output.parent,delete=False) as handle:
                    temporary=Path(handle.name);handle.write(json.dumps(data,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+'\n')
                temporary.replace(args.output)
            finally:
                if temporary and temporary.exists():temporary.unlink()
        print(f'Validated six domain workbooks at {args.config_dir}'+('' if args.check else f' -> {args.output}'));return 0
    except (ConfigError,OSError) as e:print(str(e),file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
