import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "sites_preview", Path(__file__).resolve().parents[1] / "tools/prepare_sites_preview.py")
sites = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sites)


class SitesPreviewGuards(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.site = self.root / "site"
        (self.site / ".openai").mkdir(parents=True)
        self.manifest = self.site / ".openai/hosting.json"
        self.manifest.write_text(json.dumps({"project_id": sites.PROJECT_ID,
                                            "static": {"directory": "dist"}}))

    def tearDown(self):
        self.temporary.cleanup()

    def prior(self):
        dist = self.site / "dist"
        dist.mkdir()
        (dist / "deployment.json").write_text(json.dumps({
            "repository": sites.REPOSITORY, "branch": sites.BRANCH,
            "source_sha": "a" * 40}))
        (dist / "index.html").write_text("last working preview")

    def test_requires_full_sha(self):
        self.assertEqual(sites.validate_sha("a" * 40), "a" * 40)
        for value in ("main", "abcdef1", "g" * 40):
            with self.assertRaises(ValueError):
                sites.validate_sha(value)

    def test_rejects_wrong_site(self):
        self.manifest.write_text(json.dumps({"project_id": "different"}))
        with self.assertRaisesRegex(ValueError, "not the registered"):
            sites.check_destination(self.site, "unpublished")

    def test_rejects_unattributed_existing_output(self):
        (self.site / "dist").mkdir()
        with self.assertRaisesRegex(ValueError, "lacks provenance"):
            sites.check_destination(self.site, "unpublished")

    def test_compares_previous_sha_before_overwrite(self):
        self.prior()
        sites.check_destination(self.site, "a" * 40)
        with self.assertRaisesRegex(ValueError, "source moved"):
            sites.check_destination(self.site, "b" * 40)

    def test_rejects_dirty_site(self):
        (self.site / ".git").mkdir()
        with patch.object(sites, "run", return_value=" M dist/index.html\n"):
            with self.assertRaisesRegex(ValueError, "local changes"):
                sites.check_destination(self.site, "unpublished")

    def test_failed_checks_preserve_last_working_output(self):
        self.prior()
        source = self.root / "source"
        source.mkdir()
        with patch.object(sites, "check_source"), patch.object(
                sites, "run", side_effect=subprocess.CalledProcessError(1, "npm run check")):
            with self.assertRaises(subprocess.CalledProcessError):
                sites.prepare(source, self.site, "b" * 40, "a" * 40)
        self.assertEqual((self.site / "dist/index.html").read_text(), "last working preview")


if __name__ == "__main__":
    unittest.main()
