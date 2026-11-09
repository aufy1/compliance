import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit
from unittest import mock

import main


class Request:
    def __init__(self, body, headers=None):
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.headers = headers or {}
        self.state = SimpleNamespace(username="tester")

    async def body(self):
        return self._body


async def asgi_request(method, url, body=None):
    parsed_url = urlsplit(url)
    content = b"" if body is None else json.dumps(body).encode()
    headers = [(b"host", b"testserver")]
    if body is not None:
        headers.append((b"content-type", b"application/json"))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": parsed_url.path,
        "raw_path": parsed_url.path.encode(),
        "query_string": parsed_url.query.encode(),
        "root_path": "",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "state": {"username": "tester"},
    }
    received = False
    response = {"body": bytearray()}

    async def receive():
        nonlocal received
        if received:
            return {"type": "http.disconnect"}
        received = True
        return {
            "type": "http.request",
            "body": content,
            "more_body": False,
        }

    async def send(message):
        if message["type"] == "http.response.start":
            response["status"] = message["status"]
        elif message["type"] == "http.response.body":
            response["body"].extend(message.get("body", b""))

    await main.app(scope, receive, send)
    response["json"] = json.loads(response["body"]) if response["body"] else None
    return response


class MaterialKeyNormalizationTests(unittest.TestCase):
    def setUp(self):
        self.data_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.data_dir.cleanup)
        data_path = Path(self.data_dir.name)
        self.database_file = data_path / "rcd_material_db.json"
        self.database_file.write_text(
            json.dumps({
                "items": {
                    "B954033 GE321": {
                        "i": "B954033 GE321",
                        "d": "Legacy material",
                        "mod": "previous-version",
                    }
                },
                "n": 1,
            }),
            encoding="utf-8",
        )
        self.patches = [
            mock.patch.object(main, "DATA_DIR", data_path),
            mock.patch.object(main, "DATABASE_FILE", self.database_file),
            mock.patch.object(main, "remove_ppwr_item"),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_update_material_with_legacy_spaced_key(self):
        result = asyncio.run(
            main.update_item(
                "B954033 GE321",
                Request({
                    "item": {"i": "B954033 GE321", "d": "Updated material"},
                    "base": "previous-version",
                }),
            )
        )

        self.assertEqual(result["item"]["d"], "Updated material")
        self.assertEqual(result["item"]["updatedBy"], "tester")
        stored = json.loads(self.database_file.read_text(encoding="utf-8"))
        self.assertEqual(list(stored["items"]), ["B954033GE321"])

    def test_create_material_records_authenticated_editor(self):
        result = asyncio.run(
            main.create_item(Request({"item": {"i": "NEW-ITEM"}}))
        )

        self.assertEqual(result["item"]["updatedBy"], "tester")

    def test_import_preview_keeps_manual_records_when_requested(self):
        result = asyncio.run(main.preview_database_import(Request({
            "items": {"NEW-ITEM": {"i": "NEW-ITEM"}},
            "keepManual": True,
        })))

        self.assertEqual(result["manualCount"], 1)
        self.assertEqual(result["added"], 1)
        self.assertEqual(result["removed"], 0)
        self.assertEqual(result["count"], 2)

    def test_get_documents_for_material_with_legacy_spaced_key(self):
        with mock.patch.object(
            main,
            "get_document_stores",
            return_value=(
                {"documents": {"document-id": {"n": "declaration.pdf"}}},
                {"items": {"B954033GE321": ["document-id"]}},
            ),
        ):
            result = main.get_material_documents("B954033 GE321")

        self.assertEqual(
            result["documents"],
            [{"i": "document-id", "n": "declaration.pdf"}],
        )
        self.assertEqual(
            list(main.get_items(main.read_database())),
            ["B954033GE321"],
        )
        stored = json.loads(self.database_file.read_text(encoding="utf-8"))
        self.assertEqual(list(stored["items"]), ["B954033 GE321"])

    def test_upload_document_rejects_files_over_five_megabytes(self):
        request = Request(
            b"%PDF-" + b"x" * main.MAX_PDF_UPLOAD_BYTES,
            headers={
                "content-type": "application/pdf",
                "content-length": str(main.MAX_PDF_UPLOAD_BYTES + 5),
            },
        )

        with self.assertRaises(main.HTTPException) as error:
            asyncio.run(
                main.upload_document(
                    request,
                    filename="declaration.pdf",
                    document_type="RCD",
                )
            )

        self.assertEqual(error.exception.status_code, 413)

    def test_document_types_include_specification_drawing_and_fmd(self):
        for document_type in ("Specification", "Drawing", "FMD"):
            with self.subTest(document_type=document_type):
                self.assertEqual(
                    main.validate_document_type(document_type, required=True),
                    document_type,
                )

    def test_slash_key_can_be_updated_through_query_route(self):
        material_key = "B954033/GE321"
        self.database_file.write_text(
            json.dumps({
                "items": {
                    material_key: {
                        "i": material_key,
                        "d": "Legacy material",
                        "mod": "previous-version",
                    }
                },
                "n": 1,
            }),
            encoding="utf-8",
        )

        response = asyncio.run(asgi_request(
            "POST",
            "/api/items/by-key/update?key=B954033%2FGE321",
            {
                "item": {"i": material_key, "d": "Updated material"},
                "base": "previous-version",
            },
        ))

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["json"]["item"]["d"], "Updated material")
        self.assertEqual(response["json"]["item"]["updatedBy"], "tester")

    def test_slash_key_can_list_and_link_documents(self):
        material_key = "B954033/GE321"
        document_id = "12345678-1234-1234-1234-123456789012"
        self.database_file.write_text(
            json.dumps({"items": {material_key: {"i": material_key}}, "n": 1}),
            encoding="utf-8",
        )
        data_path = Path(self.data_dir.name)
        links_file = data_path / "material_document_links.json"
        document_dir = data_path / "documents"
        document_dir.mkdir()
        (document_dir / f"{document_id}.pdf").write_bytes(b"%PDF-1.4 test")
        links = {"items": {}}
        patches = [
            mock.patch.object(main, "DOCUMENT_LINKS_FILE", links_file),
            mock.patch.object(main, "DOCUMENTS_DIR", document_dir),
            mock.patch.object(
                main,
                "get_document_stores",
                return_value=(
                    {"documents": {document_id: {"n": "declaration.pdf"}}},
                    links,
                ),
            ),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

        listed = asyncio.run(asgi_request(
            "GET",
            "/api/materials/documents?key=B954033%2FGE321",
        ))
        linked = asyncio.run(asgi_request(
            "POST",
            f"/api/materials/documents/{document_id}/link?key=B954033%2FGE321",
        ))

        self.assertEqual(listed["status"], 200)
        self.assertEqual(listed["json"]["documents"], [])
        self.assertEqual(linked["status"], 200)
        self.assertEqual(linked["json"]["document"]["i"], document_id)
        stored_links = json.loads(links_file.read_text(encoding="utf-8"))
        self.assertEqual(stored_links["items"][material_key], [document_id])


if __name__ == "__main__":
    unittest.main()
