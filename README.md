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
  - Download the entire database JSON in one click (`GET /api/backup`).
  - Server backups are created automatically once per day on the first change, before every import, and on request. The latest `BACKUP_KEEP` backups are retained (30 by default).
- **JSON import** – the app's Nginx accepts requests up to 64 MB. The external reverse proxy must also set `client_max_body_size 64m;` for larger files to reach the app.

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

The `proxy_ext_net` network must exist before starting Compose. The database and backups are stored in `./rcd-data` in the project root (mounted as `/data` in the backend container). On first startup, the database is initialized from `backend/seed/rcd_material_db.json`.

## Development
```bash
docker compose up --build         # frontend with hot reload; open http://localhost:8091
```

## Project structure
```
backend/   main.py (FastAPI + JSON persistence + backups), seed/rcd_material_db.json
frontend/  React + Vite + Tailwind v4 + lucide-react
  src/lib/        substances.js (RCD mapping), rcddb.js (CSV parser/classifier), runner.js (BOMcheck script), rcd.js
  src/views/      HelperView (questionnaire), DatabaseView (database), BackupView (backups)
  src/components/ Header, helper/*, db/RecordEditor, ui/*
nginx/     reverse proxy /api → FastAPI and / → Vite
```

## API
| Method | Path | Description |
|---|---|---|
| GET | `/api/db` | Full database |
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
