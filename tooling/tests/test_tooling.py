#!/usr/bin/env python3
"""Unit tests for the repository tooling itself (no MoonBit toolchain
required). Run: python3 -m unittest discover tooling/tests -v"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from snapshot_toolchain import VERSION_RE, parse_component  # noqa: E402
from validate_skills import NAME_RE, parse_frontmatter  # noqa: E402


class TestVersionParsing(unittest.TestCase):
    def test_moon_style(self):
        c = parse_component(
            {"name": "moon", "version": "0.1.20260713 (75c7e1f 2026-07-13)"}
        )
        self.assertEqual(c["version"], "0.1.20260713")
        self.assertEqual(c["commit"], "75c7e1f")
        self.assertEqual(c["build_date"], "2026-07-13")

    def test_moonc_style_with_plus_commit(self):
        c = parse_component(
            {"name": "moonc", "version": "v0.10.4+ade96c819 (2026-07-13)"}
        )
        self.assertEqual(c["version"], "0.10.4+ade96c819")
        self.assertEqual(c["commit"], "")

    def test_moonrun_repeated_name(self):
        c = parse_component(
            {"name": "moonrun", "version": "moonrun 0.1.20260713 (75c7e1f 2026-07-13)"}
        )
        self.assertEqual(c["version"], "0.1.20260713")

    def test_rejects_garbage(self):
        self.assertIsNone(VERSION_RE.match("latest"))
        with self.assertRaises(SystemExit):
            parse_component({"name": "moon", "version": "unknown"})


class TestFrontmatter(unittest.TestCase):
    def test_parses_scalars_and_nested_metadata(self):
        fm, body, errors = parse_frontmatter(
            "---\n"
            "name: my-skill\n"
            "description: Does things. Use when things need doing.\n"
            "metadata:\n"
            "  skill-version: \"0.1.0\"\n"
            "  verified-date: 2026-07-17\n"
            "---\n"
            "# Body\n"
        )
        self.assertEqual(errors, [])
        self.assertEqual(fm["name"], "my-skill")
        self.assertEqual(fm["metadata"]["skill-version"], "0.1.0")
        self.assertEqual(fm["metadata"]["verified-date"], "2026-07-17")
        self.assertTrue(body.startswith("# Body"))

    def test_missing_frontmatter_reported(self):
        _, _, errors = parse_frontmatter("# no frontmatter\n")
        self.assertTrue(errors)

    def test_unclosed_frontmatter_reported(self):
        _, _, errors = parse_frontmatter("---\nname: x\n")
        self.assertTrue(errors)


class TestNameRule(unittest.TestCase):
    def test_valid_names(self):
        for name in ("moonbit-language", "a", "x1-y2"):
            self.assertTrue(NAME_RE.match(name), name)

    def test_invalid_names(self):
        for name in ("Moonbit", "-x", "x-", "a--b", "a_b", ""):
            self.assertFalse(NAME_RE.match(name), name)


class TestDuplicationNormalization(unittest.TestCase):
    def test_whitespace_and_case_insensitive(self):
        import re

        def norm(s: str) -> str:
            return re.sub(r"\s+", " ", s).strip().lower()

        self.assertEqual(
            norm("Errors are  raised\nwith `raise`."),
            norm("errors are raised with `raise`."),
        )


if __name__ == "__main__":
    unittest.main()
