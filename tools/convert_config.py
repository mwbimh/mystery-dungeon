#!/usr/bin/env python3
"""Validate Excel cell literals, invoke pinned Luban, adapt its typed JSON for the game."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
HEADERS = {
    'Settings': ['path', 'value'],
    'Enemies': ['id', 'nameKey', 'color', 'hp', 'atk', 'def', 'glyph'],
    'Items': ['id', 'nameKey', 'color'],
    'EnemySpawns': ['fromFloor', 'id', 'weight'],
    'ItemDrops': ['id', 'weight'],
    'Themes': ['position', 'id'],
    'ThemeCatalog': ['id', 'nameKey'],
    'Texts': ['key', 'zhCN', 'en'],
    'Documentation': ['field', 'type', 'description', 'constraints', 'example'],
}
NUMERIC = {('Settings', 'value'), ('Enemies', 'hp'), ('Enemies', 'atk'), ('Enemies', 'def'), ('EnemySpawns', 'fromFloor'), ('EnemySpawns', 'weight'), ('ItemDrops', 'weight'), ('Themes', 'position')}

class ConfigError(ValueError):
    pass


def leaves(schema, prefix=()):
    if schema['type'] == 'object':
        for key, child in schema['properties'].items():
            yield from leaves(child, (*prefix, key))
    else:
        yield prefix, schema


def preflight(workbook, expected):
    """Check Excel representation only; Luban owns table types, indices and refs."""
    result = {}
    try:
        book = openpyxl.load_workbook(workbook, data_only=False)
    except Exception as exc:
        raise ConfigError(f'{workbook}:Workbook!A1: cannot read workbook: {exc}') from exc
    try:
        if set(book.sheetnames) != set(expected):
            raise ConfigError(f'{workbook}:Workbook!A1: expected sheets {expected}, got {book.sheetnames}')
        for name in expected:
            ws = book[name]
            headers = HEADERS[name]
            if name != 'Documentation':
                headers = ['##var', *headers]
            if ws.merged_cells.ranges:
                raise ConfigError(f'{workbook}:{name}!A1: merged cells are forbidden')
            if [ws.cell(1, i+1).value for i in range(len(headers))] != headers:
                raise ConfigError(f'{workbook}:{name}!A1: expected headers {headers}')
            rows = []
            for cells in ws.iter_rows():
                for cell in cells:
                    if cell.data_type in ('f', 'e'):
                        raise ConfigError(f'{workbook}:{name}!{cell.coordinate}: formulas and Excel errors are forbidden; paste literal values')
                    if cell.column > len(headers) and cell.value is not None:
                        raise ConfigError(f'{workbook}:{name}!{cell.coordinate}: unexpected extra column')
                row = cells[0].row
                if row == 1 or name == 'Documentation':
                    continue
                values = [ws.cell(row, col+1).value for col in range(len(headers))]
                if row == 2:
                    if values[0] != '##':
                        raise ConfigError(f'{workbook}:{name}!A2: required ## description row')
                    continue
                if all(v is None for v in values):
                    continue
                if values[0] is not None:
                    raise ConfigError(f'{workbook}:{name}!A{row}: data marker must be empty; hidden/comment data rows forbidden')
                for col, value in enumerate(values[1:], 2):
                    address = f'{workbook}:{name}!{openpyxl.utils.get_column_letter(col)}{row}'
                    field = headers[col-1]
                    if value is None or value == '':
                        raise ConfigError(f'{address}: required cell is blank')
                    if (name, field) in NUMERIC:
                        if type(value) not in (int, float) or not math.isfinite(value):
                            raise ConfigError(f'{address}: expected finite native number; numeric text and boolean forbidden')
                        if (name, field) not in {('Settings','value'),('EnemySpawns','weight'),('ItemDrops','weight')} and value != int(value):
                            raise ConfigError(f'{address}: expected integer')
                    elif not isinstance(value, str) or value != value.strip():
                        raise ConfigError(f'{address}: expected text with no leading/trailing whitespace')
                rows.append((row, values[1:]))
            result[name] = rows
    finally:
        book.close()
    return result


def convert(workbook, texts=None, dotnet=None, luban=None):
    workbook = Path(workbook)
    texts = Path(texts) if texts else ROOT / 'config/texts.xlsx'
    locations = {}
    tables = preflight(workbook, [name for name in HEADERS if name != 'Texts'])
    tables.update(preflight(texts, ['Texts']))
    schema = json.loads((ROOT / 'config/schema.json').read_text(encoding='utf-8'))
    def loc(path, sheet, row=1, col='B'):
        locations[tuple(path)] = (texts if sheet == 'Texts' else workbook, sheet, row, col)
    def fail(path, message):
        file, sheet, row, col = locations.get(tuple(path), (workbook, 'Documentation', 1, 'A'))
        raise ConfigError(f'{file}:{sheet}!{col}{row}: {".".join(map(str,path))}: {message}')
    dotnet = dotnet or os.environ.get('DOTNET_COMMAND', 'dotnet')
    luban = Path(luban or os.environ.get('LUBAN_DLL', str(ROOT / '.tools/luban/Luban/Luban.dll')))
    if not luban.is_file():
        raise ConfigError(f'{workbook}:Workbook!A1: Luban missing at {luban}; run python tools/install_luban.py (no fallback exporter)')
    with tempfile.TemporaryDirectory(prefix='mystery-dungeon-luban-') as temporary:
        stage = Path(temporary)
        shutil.copy2(workbook, stage / 'game.xlsx')
        shutil.copy2(texts, stage / 'texts.xlsx')
        shutil.copytree(ROOT / 'config/Defines', stage / 'Defines')
        shutil.copy2(ROOT / 'config/luban.conf', stage / 'luban.conf')
        command = [str(dotnet), str(luban.resolve()), '--conf', str(stage / 'luban.conf'), '-t', 'client', '-d', 'json', '--strict', '--errorFormat', 'json', '-x', f'outputDataDir={stage / "output"}']
        try:
            compiled = subprocess.run(command, cwd=stage, text=True, capture_output=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ConfigError(f'{workbook}:Workbook!A1: could not run Luban: {exc}') from exc
        if compiled.returncode:
            diagnostics = compiled.stdout + compiled.stderr
            # Luban's reference diagnostics identify table/field/value but omit
            # cells. Add source coordinates from preflight without re-exporting.
            pointers = []
            def point(sheet, field, value):
                if sheet not in tables or field not in HEADERS[sheet]:
                    return
                column = HEADERS[sheet].index(field)
                for row, values in tables[sheet]:
                    if values[column] == value:
                        file = texts if sheet == 'Texts' else workbook
                        pointers.append(f'{file}:{sheet}!{openpyxl.utils.get_column_letter(column+2)}{row}')
            for match in re.finditer(r'record (\w+)(?:\[[^\]]*\])?\.(\w+)(?: = |:)(.*?) \(from file:', diagnostics):
                try:
                    point(match[1], match[2], json.loads(match[3]))
                except ValueError:
                    pass
            for match in re.finditer(r'\{\s*"version"\s*:', diagnostics):
                try:
                    report, _ = json.JSONDecoder().raw_decode(diagnostics[match.start():])
                    for error in report.get('errors', []):
                        if error.get('code') == 'error.data.duplicate_key':
                            sheet, field, value = error['args'][:3]
                            point(sheet, field, json.loads(value))
                except (ValueError, KeyError):
                    pass
            if pointers:
                diagnostics = '\n'.join(dict.fromkeys(pointers)) + '\n' + diagnostics
            diagnostics = diagnostics.replace(str(stage) + '/./game.xlsx', str(workbook)).replace(str(stage) + '/./texts.xlsx', str(texts)).replace(str(stage / 'game.xlsx'), str(workbook)).replace(str(stage / 'texts.xlsx'), str(texts))
            raise ConfigError(f'{workbook}:Workbook!A1: Luban failed (exit {compiled.returncode}); no outputs published\n{diagnostics}')
        exported = {name: json.loads((stage / 'output' / f'{name.lower()}.json').read_text(encoding='utf-8')) for name in HEADERS if name != 'Documentation'}
    data = {}
    setting_specs = {'.'.join(path): (path, spec) for path, spec in leaves(schema) if path[0] in ('version','player','rules','map','effects') or path == ('themes','floorsPerTheme')}
    seen = set()
    for i, entry in enumerate(exported['Settings']):
        key, value = entry['path'], entry['value']
        row = tables['Settings'][i][0]
        loc((key,), 'Settings', row)
        if key not in setting_specs:
            fail((key,), 'unknown setting path')
        path, _ = setting_specs[key]
        loc(path, 'Settings', row, 'C')
        seen.add(key)
        target = data
        for part in path[:-1]:
            target = target.setdefault(part, {})
        target[path[-1]] = value
    for key in setting_specs.keys() - seen:
        loc((key,), 'Settings')
        fail((key,), 'missing required setting')
    text_by_key = {entry['key']:entry for entry in exported['Texts']}
    name_keys = {entry['nameKey'] for sheet in ('Enemies','Items','ThemeCatalog') for entry in exported[sheet]}
    data['localization'] = {'defaultLocale': 'zh-CN', 'texts': exported['Texts']}
    loc(('localization','texts'), 'Texts')
    for i, entry in enumerate(exported['Texts']):
        for col, field in enumerate(HEADERS['Texts'], 2):
            loc(('localization','texts',i,field), 'Texts', tables['Texts'][i][0], openpyxl.utils.get_column_letter(col))
        placeholders = []
        for field in ('zhCN','en'):
            value = entry[field]
            names = re.findall(r'\{([A-Za-z][A-Za-z0-9_]*)\}', value)
            if '{' in re.sub(r'\{[A-Za-z][A-Za-z0-9_]*\}', '', value) or '}' in re.sub(r'\{[A-Za-z][A-Za-z0-9_]*\}', '', value):
                fail(('localization','texts',i,field), 'malformed placeholder; use {identifier}')
            placeholders.append(set(names))
        if entry['key'] in name_keys and placeholders[0]:
            fail(('localization','texts',i,'zhCN'), 'display names cannot contain placeholders')
        if entry['key'] == 'preview.banner' and placeholders[0] != {'seed','floor'}:
            fail(('localization','texts',i,'zhCN'), 'preview.banner must contain exactly {seed} and {floor}')
        if placeholders[0] != placeholders[1]:
            fail(('localization','texts',i,'en'), 'placeholder names must match zhCN exactly')
    for sheet, section in [('Enemies','enemies'),('Items','items')]:
        data[section] = {}
        for i, entry in enumerate(exported[sheet]):
            key = entry['id']; row = tables[sheet][i][0]
            loc((section,key), sheet, row)
            if key not in schema['properties'][section]['properties']:
                fail((section,key), 'unknown stable ID: behavior/assets require code support')
            value = {k:v for k,v in entry.items() if k != 'id'}
            value['name'] = text_by_key[value['nameKey']]['zhCN']
            data[section][key] = value
            for col, field in enumerate(HEADERS[sheet], 2):
                loc((section,key,field), sheet, row, openpyxl.utils.get_column_letter(col))
        for key in schema['properties'][section]['properties'].keys() - data[section].keys():
            loc((section,key), sheet)
            fail((section,key), 'missing stable ID')
    data['enemySpawns'] = []
    for n, entry in enumerate(exported['EnemySpawns']):
        row = tables['EnemySpawns'][n][0]
        floor = entry['fromFloor']
        if not data['enemySpawns'] or data['enemySpawns'][-1]['fromFloor'] != floor:
            data['enemySpawns'].append({'fromFloor':floor,'entries':[]})
        i = len(data['enemySpawns'])-1; entries = data['enemySpawns'][i]['entries']; j = len(entries)
        loc(('enemySpawns',i,'fromFloor'), 'EnemySpawns', row, 'B')
        loc(('enemySpawns',i,'entries'), 'EnemySpawns', row, 'C')
        loc(('enemySpawns',i,'entries',j,'id'), 'EnemySpawns', row, 'C')
        loc(('enemySpawns',i,'entries',j,'weight'), 'EnemySpawns', row, 'D')
        entries.append({'id':entry['id'],'weight':entry['weight']})
    data['itemDrops'] = exported['ItemDrops']
    for i, entry in enumerate(data['itemDrops']):
        loc(('itemDrops',i,'id'), 'ItemDrops', tables['ItemDrops'][i][0], 'B')
        loc(('itemDrops',i,'weight'), 'ItemDrops', tables['ItemDrops'][i][0], 'C')
    data['themes']['order'] = []
    for i, entry in enumerate(exported['Themes']):
        loc(('themes','order',i), 'Themes', tables['Themes'][i][0], 'C')
        if entry['position'] != i+1:
            loc(('position',), 'Themes', tables['Themes'][i][0], 'B'); fail(('position',), f'position must be {i+1}')
        data['themes']['order'].append(entry['id'])
    expected_themes = schema['properties']['themes']['properties']['order']['items']['enum']
    catalog = {entry['id']:entry['nameKey'] for entry in exported['ThemeCatalog']}
    if set(catalog) != set(expected_themes):
        loc(('themeCatalog',), 'ThemeCatalog'); fail(('themeCatalog',), 'catalog must match supported renderer IDs')
    for key in expected_themes:
        if catalog[key] != f'theme.{key}.name':
            loc(('themeCatalog',key), 'ThemeCatalog'); fail(('themeCatalog',key), 'expected nameKey theme.<id>.name')
    if 'preview.banner' not in text_by_key:
        loc(('preview.banner',), 'Texts'); fail(('preview.banner',), 'required runtime text key missing')
    for section, sheet in [('enemySpawns','EnemySpawns'),('itemDrops','ItemDrops')]:loc((section,),sheet)
    loc(('themes','order'),'Themes')
    def validate(value, spec, path=()):
        kind = spec['type']
        if kind in ('integer', 'number'):
            if type(value) not in (int, float) or not math.isfinite(value) or (kind == 'integer' and value != int(value)):
                fail(path, f'expected finite {kind} cell (numeric text/booleans forbidden)')
            if not spec.get('minimum', -math.inf) <= value <= spec.get('maximum', math.inf):
                fail(path, f'value outside [{spec.get("minimum")}, {spec.get("maximum")}]')
        elif kind == 'string':
            if not isinstance(value, str):
                fail(path, 'expected text cell')
            if not spec.get('minLength', 0) <= len(value) <= spec.get('maxLength', math.inf):
                fail(path, 'invalid text length')
            if 'pattern' in spec and not re.fullmatch(spec['pattern'], value):
                fail(path, f'must match {spec["pattern"]}')
            if 'enum' in spec and value not in spec['enum']:
                fail(path, f'unknown ID; expected one of {spec["enum"]}')
        elif kind == 'object':
            if type(value) != dict or set(value) != set(spec['properties']):
                fail(path, 'missing or unknown object keys')
            for key, child in spec['properties'].items():
                validate(value[key], child, (*path, key))
            if 'min' in value and 'max' in value and value['min'] > value['max']:
                fail((*path, 'max'), 'max must be >= min')
        elif kind == 'array':
            if type(value) != list or not spec.get('minItems', 0) <= len(value) <= spec.get('maxItems', math.inf):
                fail(path, 'invalid number of rows')
            for i, child in enumerate(value):
                validate(child, spec['items'], (*path, i))
        else:
            fail(path, f'unsupported schema type {kind}')
    validate(data, schema)
    if data['effects']['bellyCap'] < data['player']['belly']:
        fail(('effects', 'bellyCap'), 'must be >= player.belly')
    previous = 0
    for i, group in enumerate(data['enemySpawns']):
        floor = group['fromFloor']
        if (i == 0 and floor != 1) or floor <= previous or floor > data['rules']['totalFloors']:
            fail(('enemySpawns', i, 'fromFloor'), 'floors must start at 1, strictly ascend, and not exceed rules.totalFloors')
        previous = floor
    for path, entries in [(('itemDrops',), data['itemDrops'])] + [(('enemySpawns', i, 'entries'), g['entries']) for i,g in enumerate(data['enemySpawns'])]:
        ids = set()
        for i, entry in enumerate(entries):
            if entry['id'] in ids:
                fail((*path, i, 'id'), 'duplicate ID in weight group')
            ids.add(entry['id'])
        if sum(entry['weight'] for entry in entries) <= 0:
            fail((*path, 0, 'weight'), 'group weights must sum to > 0')
    # Canonical keys and native integer normalization make output independent of row ordering.
    def canonical(value, spec):
        if spec['type'] == 'object':
            return {key: canonical(value[key], child) for key, child in spec['properties'].items()}
        if spec['type'] == 'array':
            return [canonical(v, spec['items']) for v in value]
        return int(value) if spec['type'] == 'integer' else value
    result = canonical(data, schema)
    if len((json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')) > 256 * 1024:
        fail((), 'generated game.json exceeds runtime limit of 256 KiB')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook', type=Path, default=ROOT / 'config/game.xlsx')
    parser.add_argument('--output', type=Path, default=ROOT / 'config/game.json')
    parser.add_argument('--texts', type=Path, default=ROOT / 'config/texts.xlsx')
    parser.add_argument('--dotnet', help='dotnet executable; defaults to DOTNET_COMMAND or PATH')
    parser.add_argument('--luban', help='Luban.dll; defaults to LUBAN_DLL or .tools installation')
    parser.add_argument('--check', action='store_true', help='validate only; do not write output')
    args = parser.parse_args()
    try:
        data = convert(args.workbook, args.texts, args.dotnet, args.luban)
        if not args.check:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            content = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', dir=args.output.parent, delete=False) as handle:
                    temporary = Path(handle.name)
                    handle.write(content)
                temporary.replace(args.output)
            finally:
                if temporary and temporary.exists():
                    temporary.unlink()
        print(f'Validated {args.workbook}' + ('' if args.check else f' -> {args.output}'))
        return 0
    except (ConfigError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
