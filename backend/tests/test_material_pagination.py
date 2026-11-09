import json
import unittest
from unittest import mock

import main


class MaterialPaginationTests(unittest.TestCase):
    def setUp(self):
        self.database = {
            "items": {
                "ITEM10": {"i": "ITEM10", "d": "Ten", "sup": "Acme", "r": "YES"},
                "ITEM2": {"i": "ITEM2", "d": "Two", "sup": "Acme", "r": "NO"},
                "ITEM1": {"i": "ITEM1", "d": "One", "sup": "Beta", "r": "YES"},
            }
        }

    @mock.patch("main.read_database")
    def test_returns_only_requested_page_in_natural_order(self, read_database):
        read_database.return_value = self.database

        result = main.get_material_page(
            page=1,
            page_size=1,
            query="",
            filters="{}",
            sort="item",
            direction="asc",
        )

        self.assertEqual(result["total"], 3)
        self.assertEqual(result["pages"], 3)
        self.assertEqual(list(result["items"]), ["ITEM2"])
        self.assertEqual(len(result["items"]), 1)

    @mock.patch("main.read_database")
    def test_applies_search_and_column_filters_before_pagination(self, read_database):
        read_database.return_value = self.database
        filters = {
            "supplier": {"mode": "text", "query": "acme", "match": "exact"},
            "rohs": {"mode": "text", "query": "yes", "match": "contains"},
        }

        result = main.get_material_page(
            page=0,
            page_size=50,
            query="item",
            filters=json.dumps(filters),
            sort="item",
            direction="asc",
        )

        self.assertEqual(result["total"], 1)
        self.assertEqual(list(result["items"]), ["ITEM10"])

    def test_rejects_unknown_sort_and_invalid_filter_fields(self):
        with self.assertRaises(main.HTTPException):
            main.get_material_page(0, 50, "", "{}", "payload", "asc")
        with self.assertRaises(main.HTTPException):
            main.validate_material_filters('{"unknown":{"mode":"all"}}')

    def test_bom_lookup_matches_normalized_item_keys_and_aliases(self):
        database = {
            "items": {
                "ITEM0012": {"i": "ITEM0012", "al": ["ALT-9001"]},
                "ITEM2": {"i": "ITEM2"},
            }
        }

        result = main.lookup_materials(["item 12", "ALT9001", "ITEM 2"], database)

        self.assertEqual(set(result), {"ITEM0012", "ITEM2"})


if __name__ == "__main__":
    unittest.main()
