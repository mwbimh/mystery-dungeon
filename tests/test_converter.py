"""Real-Luban integration and atomicity. Adversarial cell edits also run in QA.
Runtime semantic cases live in config.test.cjs / multidungeon.test.cjs, using the
same validator the compiler invokes. No alternate XLSX exporter is used here.
"""
import json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import convert_config as converter

class ConverterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.directory=Path(self.tmp.name)/'config';self.directory.mkdir()
        for filename in {t['book'] for t in converter.TABLES.values()}:shutil.copy2(ROOT/'config'/filename,self.directory/filename)
        self.output=Path(self.tmp.name)/'game.json'
    def command(self,*args):return [sys.executable,str(ROOT/'tools/convert_config.py'),'--config-dir',str(self.directory),'--output',str(self.output),*args]
    def test_actual_six_domains_pass_real_luban_and_shared_validator(self):
        data=converter.convert(self.directory)
        self.assertEqual(data['version'],2);self.assertEqual(data['defaultDungeonId'],'original')
        self.assertIn('trainingGrove',data['dungeons']);self.assertIn('emberSlime',data['enemies']);self.assertIn('travelOnigiri',data['items'])
        self.assertNotIn('description',json.dumps(data,ensure_ascii=False))
    def test_cell_preflight_exposes_every_domain_without_exporting_values(self):
        tables,files=converter.preflight(self.directory)
        self.assertEqual(set(tables),set(converter.TABLES))
        self.assertEqual(len(set(files.values())),6)
        self.assertGreater(len(tables['MapValues']),30)
    def test_missing_workbook_reports_source(self):
        (self.directory/'items.xlsx').unlink()
        with self.assertRaisesRegex(converter.ConfigError,r'items.xlsx:Workbook!A1'):converter.convert(self.directory)
    def test_luban_missing_never_uses_fallback(self):
        with self.assertRaisesRegex(converter.ConfigError,'no fallback exporter'):converter.convert(self.directory,luban=self.directory/'missing.dll')
    def test_corrupt_workbook_reports_source(self):
        (self.directory/'monsters.xlsx').write_bytes(b'not an xlsx')
        with self.assertRaisesRegex(converter.ConfigError,r'monsters.xlsx:Workbook!A1'):converter.convert(self.directory)
    def test_deterministic_generation_and_atomic_failure(self):
        subprocess.run(self.command(),check=True,capture_output=True);first=self.output.read_bytes()
        subprocess.run(self.command(),check=True,capture_output=True);self.assertEqual(first,self.output.read_bytes())
        self.assertEqual(json.loads(first),converter.convert(self.directory))
        (self.directory/'spawns.xlsx').unlink();failed=subprocess.run(self.command(),capture_output=True)
        self.assertNotEqual(failed.returncode,0);self.assertEqual(first,self.output.read_bytes())
    def test_check_mode_does_not_publish(self):
        subprocess.run(self.command('--check'),check=True,capture_output=True);self.assertFalse(self.output.exists())
    def test_contract_schemas_are_committed_in_sync(self):
        import config_contract
        self.assertEqual(json.loads((ROOT/'config/schema.json').read_text()),config_contract.SCHEMA)
    def test_luban_defines_every_domain_and_ref(self):
        import xml.etree.ElementTree as ET
        root=ET.parse(ROOT/'config/Defines/tables.xml').getroot()
        self.assertEqual({t.attrib['name'] for t in root.findall('table')},set(converter.TABLES))
        self.assertGreater(sum('#ref=' in v.attrib['type'] for b in root.findall('bean') for v in b.findall('var')),15)
if __name__=='__main__':unittest.main()
