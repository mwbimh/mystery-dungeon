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

    def test_unknown_event(self):
        with self.assertRaises(ValueError):
            route.validate_route("workflow_dispatch", "", "", "", "owner/repo")


if __name__ == "__main__":
    unittest.main()
