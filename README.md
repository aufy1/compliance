# Compliance – BOMcheck RCD Helper

Tool for preparing BOMcheck RCD responses (RoHS, REACH/SVHC, PFAS, Prop 65, TSCA, CRM, etc.) for cables and wire harnesses, and a materials database with substance matches.

## Features
- **RCD questionnaire** – substance list, profiles, BOM analysis (paste / XLSX / CSV), console script generator, bookmarklet, and manual list.
- **Materials database** – search and filters (substance, missing data, notes, exemptions, manual changes), with **record creation, editing, and deletion**.
  - “Suggest from description” uses the same classifier as the CSV import.
  - BOM items not found in the database can be added with one click.
  - Protection against overwriting someone else's changes (HTTP 409).
  - BOM status report (RoHS, REACH/SVHC, declaration date, detected substances) with preview, CSV/JSON export, and printing.
- **Import** – rebuild the database from a status CSV or load JSON, with an option to preserve manually edited records.
- **Backups** – a separate view for listing, downloading, deleting, and manually creating backups. New files use the `material_db_` prefix.
  - Download the complete backup ZIP with material JSON, PPWR JSON, and supplier declaration PDFs (`GET /api/backup.zip`).
  - Download the material and PPWR JSON databases separately (`GET /api/backup/materials` and `GET /api/backup/ppwr`).
  - Download the shared PDF document metadata and material-to-document links separately (`GET /api/backup/documents` and `GET /api/backup/document-links`).
  - Import a complete ZIP backup or an individual material/PPWR JSON file.
  - Server backups are created automatically once per day on the first change, before every import, and on request. The latest `BACKUP_KEEP` backups are retained (30 by default).
- **Packing materials / PPWR** – mark existing material records as packing materials, search them, and expand a record to edit its packaging type, weight, manufacturer, multiple packaging stages, and heavy-metals compliance status.
- **PDF document library** – manage shared PDFs separately from PPWR and link multiple documents to any material from its material editor. The library supports search by document name, ITEM, and material description. Uploading identical PDF contents reuses the existing document; removing a material link does not delete the library document. Renaming updates the shared document name everywhere, while deleting a library document removes all its links.
- **JSON/ZIP import** – JSON requests are limited to 64 MB; ZIP backups are limited to 100 MB (300 MB unpacked). The app's Nginx allows 110 MB requests. An external reverse proxy must allow at least `client_max_body_size 110m;` for ZIP uploads to reach the app.

## Run with Docker
```bash
htpasswd -cB nginx/auth/.htpasswd USERNAME
docker compose up -d --build
# http://localhost:8091
```
The `htpasswd` command (from the `apache2-utils` package) creates a local file containing a password hash. The file is ignored by Git. To add more users, run `htpasswd -B nginx/auth/.htpasswd USERNAME` (without `-c`, which would overwrite existing accounts).

The Nginx worker runs as the `nginx` user (GID 101 in the `nginx:alpine` image), so the directory and password file must be readable by that group. Set the group and permissions, then recreate the container:
```bash
sudo chgrp -R 101 nginx/auth
chmod 750 nginx/auth
chmod 640 nginx/auth/.htpasswd
docker compose up -d --force-recreate nginx
```
If you use a different Nginx image, check the worker process GID with `docker exec compl-nginx id nginx` and use that GID instead of `101`.

Nginx requires authentication for the entire app, including the API, and limits total traffic to 100 requests per second regardless of client address, allowing a burst of up to 100 additional requests. Further requests receive HTTP 429. The burst allows browsers to load multiple page assets at once. The app does not interpret the `X-Real-IP` header from the reverse proxy, so it sees the proxy's address as the client address. Serve the app over HTTPS, especially outside local development: Basic Auth sends credentials in a header that is not encrypted without TLS.

Compose runs the FastAPI API (`compl-backend`), Vite development frontend (`compl-frontend`), and Nginx (`compl-nginx`) as separate services. The frontend and API are available through Nginx; a reverse proxy can route traffic to `compl-nginx` on the external `proxy_ext_net` network.

The `proxy_ext_net` network must exist before starting Compose. The database, PPWR JSON, PDF document metadata, material-document links, PDF files, and backups are stored in `./rcd-data` in the project root (mounted as `/data` in the backend container and read-only by Nginx for inline PDF viewing). Existing PPWR-attached PDFs are migrated automatically to the shared document library on first access. On first startup, the material database is initialized from `backend/seed/rcd_material_db.json`.

## Development
```bash
docker compose up --build         # frontend with hot reload; open http://localhost:8091
```

## Project structure
```
backend/   main.py (FastAPI + JSON persistence + backups), seed/rcd_material_db.json
frontend/  React + Vite + Tailwind v4 + lucide-react
  src/lib/        substances.js (RCD mapping), rcddb.js (CSV parser/classifier), runner.js (BOMcheck script), rcd.js
  src/views/      HelperView (questionnaire), DatabaseView (database), DocumentsView (PDFs), BackupView (backups)
  src/components/ Header, helper/*, db/RecordEditor and MaterialDocuments, ui/*
nginx/     reverse proxy /api → FastAPI and / → Vite
```

## API
| Method | Path | Description |
|---|---|---|
| GET | `/api/db` | Full database |
| GET | `/api/ppwr` | PPWR database |
| POST | `/api/ppwr/items/:key` | Save compact PPWR data for a packing material |
| GET | `/api/documents` | Shared PDF document library with linked material keys |
| POST | `/api/documents` | Add a PDF to the library (20 MB max; duplicate content reuses the existing document) |
| POST | `/api/materials/:key/documents/:id/link` | Link a PDF document to any material |
| POST | `/api/materials/:key/documents/:id/unlink` | Remove a document link from a material |
| POST | `/api/documents/:id/rename` | Rename a shared PDF document |
| POST | `/api/documents/:id/delete` | Delete a PDF document and all its links |
| GET | `/api/backup.zip` | Download material JSON, PPWR JSON, document metadata, links, and PDFs as a ZIP |
| GET | `/api/backup/materials` | Download the material database JSON |
| GET | `/api/backup/ppwr` | Download the PPWR database JSON |
| GET | `/api/backup/documents` | Download the PDF document metadata JSON |
| GET | `/api/backup/document-links` | Download material-to-document links JSON |
| GET | `/documents/:id.pdf` | Serve a PDF inline through Nginx |
| POST | `/api/db/import-zip` | Restore a complete ZIP backup |
| POST | `/api/ppwr` | Import/replace a standalone PPWR JSON |
| GET | `/api/meta` | Metadata (n, src, built, updated) |
| POST | `/api/items` | Create a record `{ item }` |
| PUT | `/api/items/:key` | Update a record `{ item, base }` (`base` = previous `mod` value) |
| DELETE | `/api/items/:key` | Delete a record |
| PUT | `/api/db` | Replace the entire database (import) |
| GET | `/api/backup` | Download a backup of the entire database |
| GET/POST | `/api/backups` | List / create a server-side backup |
| GET | `/api/backups/:name` | Download a specific backup |
| POST | `/api/backups/:name/delete` | Delete a specific backup |

Record schema: `i` ITEM, `d` description, `a` status, `sup` supplier, `r` RoHS, `dt` declaration date,
`h` substances `{ id: [source d|o|i|p, evidence] }`, `ex` RoHS exemptions, `u` missing data (`rohs|svhc|pfas|pip`),
`al` aliases, `w` notes, `dup` number of duplicates in the CSV, `mod` date of manual change.

PPWR data is stored separately in `rcd-data/ppwr_material_db.json`. Its compact format is:

```json
{"items":{"ITEM":{"t":"box","w":12.5,"m":"Manufacturer","s":["p","s"],"h":"c"}}}
```

PPWR fields: `t` packaging type, `w` packaging weight in grams, `m` manufacturer (MFG), `s` packaging stages (`p` primary, `s` secondary, `t` tertiary/grouped transport; multiple values are allowed), and `h` heavy-metals compliance (`u` not assessed, `c` compliant, `n` non-compliant). PDFs are independent of PPWR.

The shared PDF document catalog is stored in `rcd-data/pdf_documents.json` as `{"documents":{"UUID":{"n":"declaration.pdf","z":12345,"h":"SHA-256"}}}`. The separate `rcd-data/material_document_links.json` stores material links as `{"items":{"ITEM":["UUID"]}}`. PDF bytes are stored in `rcd-data/documents/UUID.pdf`; ZIP backups include both JSON files and every PDF.
