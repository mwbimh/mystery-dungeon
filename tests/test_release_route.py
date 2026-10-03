import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "release_route", Path(__file__).resolve().parents[1] / "tools/check_release_route.py"
)
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)


class ReleaseRouteTests(unittest.TestCase):
    def test_design_to_preview(self):
        route.validate_route("pull_request", "preview", "design", "owner/repo", "owner/repo")

    def test_preview_to_main(self):
        route.validate_route("pull_request", "main", "preview", "owner/repo", "owner/repo")

    def test_push(self):
        route.validate_route("push", "", "", "", "owner/repo")

    def test_disallowed_routes(self):
        for base, head, head_repo in [
            ("main", "design", "owner/repo"),
            ("main", "feature/designer-config", "owner/repo"),
            ("preview", "feature/change", "owner/repo"),
            ("main", "preview", "someone/fork"),
            ("preview", "design", "someone/fork"),
            ("unknown", "design", "owner/repo"),
        ]:
            with self.subTest(base=base, head=head, head_repo=head_repo):
                with self.assertRaises(ValueError):
                    route.validate_route("pull_request", base, head, head_repo, "owner/repo")

    def test_design_push_runs_full_checks_before_any_pr(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/config.yml").read_text()
        self.assertIn("push:\n    branches: [design, preview, main]", workflow)
        self.assertIn("run: npm run test:browser:stable", workflow)
        self.assertIn("if: github.event_name == 'push' && github.ref == 'refs/heads/main'", workflow)
        import json
        package = json.loads((root / "package.json").read_text())
        self.assertEqual(package["scripts"]["test:browser:stable"], "npm run test:browser && npm run test:browser")

    def test_unknown_event(self):
        with self.assertRaises(ValueError):
            route.validate_route("workflow_dispatch", "", "", "", "owner/repo")

    def test_screenshot_archives_partition_all_pngs_without_dropping_evidence(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/config.yml").read_text()

        def paths_for(artifact):
            section = workflow.split("name: " + artifact, 1)[1]
            lines = section.split("path: |", 1)[1].split("if-no-files-found:", 1)[0]
            return [line.strip() for line in lines.splitlines() if line.strip()]

        dungeon = paths_for("mystery-dungeon-browser-dungeon-${{ github.sha }}")
        interface = paths_for("mystery-dungeon-browser-interface-${{ github.sha }}")
        self.assertTrue(dungeon)
        self.assertTrue(all(path.startswith("test-results/") and path.endswith(".png") for path in dungeon))
        self.assertEqual(interface[0], "test-results/*.png")
        # Every exclusion in the catch-all archive is included in the dungeon
        # archive, so even a new screenshot name cannot silently disappear.
        self.assertEqual(set(interface[1:]), {"!" + path for path in dungeon})
        self.assertEqual(len(interface), len(dungeon) + 1)


if __name__ == "__main__":
    unittest.main()
