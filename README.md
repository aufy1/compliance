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
- **Backups** – a separate view for listing, downloading, deleting, and manually creating compressed PostgreSQL backups. Legacy JSON backup files are removed after the next successful PostgreSQL backup.
  - One automatic PostgreSQL backup is created before the first data-changing operation each UTC day; full PostgreSQL backups are also created before database replacement and clearing.
  - Legacy JSON or ZIP files can still be imported; imported records are written to PostgreSQL.
- **Packing materials / PPWR** – mark existing material records as packing materials, search them, and expand a record to edit its packaging type, weight, manufacturer, multiple packaging stages, and heavy-metals compliance status.
- **PDF document library** – manage shared PDFs separately from PPWR and link multiple documents to any material from its material editor. The library supports search by document name, ITEM, and material description. Uploading identical PDF contents reuses the existing document; removing a material link does not delete the library document. Renaming updates the shared document name everywhere, while deleting a library document removes all its links.
- **JSON/ZIP import** – JSON requests are limited to 64 MB; ZIP backups are limited to 100 MB (300 MB unpacked). The app's Nginx allows 110 MB requests. An external reverse proxy must allow at least `client_max_body_size 110m;` for ZIP uploads to reach the app.

## Run with Docker
```bash
cp .env.example .env
# Set unique POSTGRES_PASSWORD and BOOTSTRAP_ADMIN_PASSWORD values in .env.
# Generate secrets locally, e.g. with: openssl rand -hex 32
# The initial application password must be at least 12 characters.
# For local HTTP, use SESSION_COOKIE_SECURE=false; keep it true behind HTTPS.
docker network inspect proxy_ext_net >/dev/null 2>&1 || docker network create proxy_ext_net
docker compose up -d --build
# http://localhost:8091
```
The first start creates one local account from `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD`; the password is Argon2-hashed and is not reset on later restarts. Sessions use a 12-hour HttpOnly, SameSite=Strict cookie. Set `SESSION_COOKIE_SECURE=true` whenever users access the app over HTTPS. Keep database and bootstrap secrets outside source control.

Nginx limits traffic to 100 requests per second with a burst of 100; further requests receive HTTP 429. Use HTTPS outside local development.

Compose runs PostgreSQL (`compl-postgres`), FastAPI (`compl-backend`), the Vite frontend (`compl-frontend`), and Nginx (`compl-nginx`). PostgreSQL uses a named Docker volume. The frontend and API are available through Nginx; a reverse proxy can route traffic to `compl-nginx` on the external `proxy_ext_net` network.

On first startup, existing material, PPWR, PDF metadata, and material-document link JSON files in `./rcd-data` are imported transactionally into PostgreSQL. The source files are left untouched; existing database rows are never overwritten by the import. Existing PPWR-attached PDFs are migrated automatically to the shared document library on first access. Application records and document metadata are persisted in PostgreSQL; PDF bytes and compressed PostgreSQL backups remain in `./rcd-data`. PDF downloads go through the authenticated API.

Write requests are recorded in PostgreSQL's `app_audit_log` (actor, route, HTTP method/status, timestamp, and client IP; request bodies and credentials are not stored). Signed-in users can read recent entries at `GET /api/audit?limit=100` (1–500 entries).

Authentication currently uses the local account behind a provider interface. Active Directory/LDAP or OIDC is not enabled until its directory/identity-provider details are available. The initial local account is not deleted or replaced on later starts.

Users can change their password in **Settings** by providing the current password and a new password of at least 12 characters. Other active sessions for that account are revoked after a successful change. Material creates and edits record the signed-in username in `updatedBy`; legacy records without this field remain valid.

The materials and packing lists use server-side pagination (50 and 25 records per page). Search, filters, and sorting are applied before pagination. The application loads metadata and the current page rather than the entire materials JSON; BOM lookup returns only matched records. CSV export and legacy JSON/ZIP import remain available.

The backend image includes the PostgreSQL 17 client. Before the first authenticated data-changing API request each UTC day, the backend creates one atomic `pg_dump` custom-format archive (`-Fc`, compression level 9) under `./rcd-data/backups`. If the dump fails, the requested change is rejected with HTTP 503 rather than proceeding without a backup. Manual database replacements also create a PostgreSQL dump first. PostgreSQL dump files can be downloaded or deleted from **Backups**. Dumps contain all PostgreSQL records and document metadata, but not PDF bytes; back up `./rcd-data/documents` separately. Keep `rcd-data` until PostgreSQL has started successfully and the imported data has been verified; the Compose mount remains unchanged to preserve existing files.

## Development
```bash
docker compose up --build         # frontend with hot reload; open http://localhost:8091
```

## Project structure
```
backend/   main.py (FastAPI), auth_provider.py, storage.py (PostgreSQL + legacy JSON migration), seed/rcd_material_db.json
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
| POST | `/api/auth/login` | Start a local account session |
| POST | `/api/auth/logout` | End the current session |
| POST | `/api/auth/change-password` | Change the current user's password and revoke other sessions |
| GET | `/api/auth/me` | Current signed-in user |
| GET | `/api/audit` | Recent write operations (up to 500) |
| GET | `/api/ppwr` | PPWR database |
| POST | `/api/ppwr/items/:key` | Save compact PPWR data for a packing material |
| GET | `/api/documents` | Shared PDF document library with linked material keys |
| POST | `/api/documents` | Add a PDF with its display name, type, and optional declaration date (20 MB max; duplicate content reuses the existing document) |
| POST | `/api/documents/:id/metadata` | Update a PDF's display name, type, and declaration date |
| POST | `/api/materials/:key/documents/:id/link` | Link a PDF document to any material |
| POST | `/api/materials/:key/documents/:id/unlink` | Remove a document link from a material |
| POST | `/api/documents/:id/rename` | Rename a shared PDF document |
| POST | `/api/documents/:id/delete` | Delete a PDF document and all its links |
| GET | `/api/documents/:id/file` | Serve an authenticated PDF inline |
| POST | `/api/db/import-zip` | Restore a complete ZIP backup |
| POST | `/api/ppwr` | Import/replace a standalone PPWR JSON |
| GET | `/api/meta` | Metadata (n, src, built, updated) |
| GET | `/api/items/page` | Filtered and sorted material page (`page`, `page_size`, `query`, `filters`, `sort`, `direction`) |
| GET | `/api/items/packing` | Paginated packing materials and their PPWR data |
| GET | `/api/items/by-key` | Load one material by its ITEM key |
| POST | `/api/items/lookup` | Match BOM tokens against ITEM keys and aliases |
| GET | `/api/items/counts` | Aggregate substance and missing-data counts for the questionnaire |
| GET | `/api/items/suggestions` | Supplier and RoHS editor suggestions |
| POST | `/api/items` | Create a record `{ item }` |
| PUT | `/api/items/:key` | Update a record `{ item, base }` (`base` = previous `mod` value) |
| DELETE | `/api/items/:key` | Delete a record |
| PUT | `/api/db` | Replace the entire database (import) |
| GET | `/api/backups` | List PostgreSQL backups |
| POST | `/api/backups/postgresql` | Create a PostgreSQL custom-format compressed dump |
| GET | `/api/backups/:name` | Download a specific backup |
| POST | `/api/backups/:name/delete` | Delete a specific backup |

Record schema: `i` ITEM, `d` description, `a` status, `sup` supplier, `r` RoHS, `dt` declaration date,
`h` substances `{ id: [source d|o|i|p, evidence] }`, `ex` RoHS exemptions, `u` missing data (`rohs|svhc|pfas|pip`),
`al` aliases, `w` notes, `dup` number of duplicates in the CSV, `mod` date of manual change, `updatedBy` username of the last authenticated editor.

PPWR data is stored separately in PostgreSQL as JSONB. Its compact format is:

```json
{"items":{"ITEM":{"t":"box","w":12.5,"m":"Manufacturer","s":["p","s"],"h":"c"}}}
```

PPWR fields: `t` packaging type, `w` packaging weight in grams, `m` manufacturer (MFG), `s` packaging stages (`p` primary, `s` secondary, `t` tertiary/grouped transport; multiple values are allowed), and `h` heavy-metals compliance (`u` not assessed, `c` compliant, `n` non-compliant). PDFs are independent of PPWR.

The shared PDF document catalog and material links are stored as JSONB in PostgreSQL. Document types include RCD, PPWR, RoHS, REACH, CA Prop 65, TSCA, PFAS, Specification (Specyfikacja), Drawing (Rysunek), and FMD; `dt` is the optional declaration date. PDF bytes remain in `rcd-data/documents/UUID.pdf`; ZIP backups include the database JSON exports and every PDF.
