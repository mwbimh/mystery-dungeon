import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_assets', ROOT / 'tools/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class AssetValidationTests(unittest.TestCase):
    def test_real_runtime_images_are_materialized(self):
        build.check_runtime_images(ROOT / 'assets/runtime')

    def test_lfs_pointer_and_empty_directory_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaisesRegex(ValueError, 'No runtime PNGs'):
                build.check_runtime_images(directory)
            (directory / 'slime.png').write_text('version https://git-lfs.github.com/spec/v1\n')
            with self.assertRaisesRegex(ValueError, r'slime.png: expected PNG'):
                build.check_runtime_images(directory)
