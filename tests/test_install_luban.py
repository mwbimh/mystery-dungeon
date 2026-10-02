"""Offline integrity tests for installing the pinned official binary."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

SPEC = importlib.util.spec_from_file_location("install_luban", Path(__file__).resolve().parents[1] / "tools/install_luban.py")
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_pin_is_official_version_and_digest(self):
        self.assertEqual(installer.VERSION, "5.1.0")
        self.assertEqual(installer.SHA256, "bac9a1b8d69cfeaa7ef1d8c67b34a007324d1cd158e0b14294521b3879ba5213")
        self.assertEqual(installer.URL, "https://github.com/focus-creative-games/luban/releases/download/v5.1.0/Luban.7z")

    def test_bad_archive_never_replaces_existing_installation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            existing = root / ".tools/luban/Luban/Luban.dll"
            existing.parent.mkdir(parents=True)
            existing.write_bytes(b"previous installation")
            archive = root / "tampered.7z"
            archive.write_bytes(b"not the official release")
            extractor = Mock()
            with patch.object(installer, "ROOT", root), patch.dict(sys.modules, {"py7zr": extractor}):
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    installer.install(archive)
            self.assertEqual(existing.read_bytes(), b"previous installation")
            extractor.SevenZipFile.assert_not_called()
            self.assertEqual(sorted(p.name for p in (root / ".tools").iterdir()), ["luban"])


if __name__ == "__main__":
    unittest.main()
