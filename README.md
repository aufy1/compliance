# compliance – BOMcheck RCD helper

Narzędzie do przygotowania odpowiedzi w BOMcheck RCD (RoHS, REACH/SVHC, PFAS, Prop 65, TSCA, CRM…) dla przewodów i wiązek
oraz baza materiałów (surowców) z trafieniami substancji.

## Funkcje
- **Ankieta RCD** – lista substancji, profile, analiza BOM (wklejka / xlsx / csv), generator skryptu do konsoli, bookmarklet i lista ręczna.
- **Baza materiałów** – wyszukiwanie, filtry (substancja, braki danych, uwagi, wyjątki, zmiany ręczne), **dodawanie, edycja i usuwanie rekordów**.
  - „Sugeruj z opisu” uruchamia ten sam klasyfikator co import CSV.
  - Pozycje BOM spoza bazy można dodać jednym kliknięciem.
  - Ochrona przed nadpisaniem cudzej zmiany (HTTP 409).
  - Raport statusów BOM (RoHS, REACH/SVHC, data deklaracji, wykryte substancje) z podglądem oraz eksportem CSV/JSON i drukowaniem.
- **Import** – przebudowa bazy z CSV statusów lub wczytanie JSON, z opcją zachowania rekordów edytowanych ręcznie.
- **Kopie zapasowe** – osobny widok z listą kopii, pobieraniem, usuwaniem i ręcznym tworzeniem kopii. Nowe pliki mają prefiks `material_db_`.
  - pobranie całego JSON-a jednym kliknięciem (`GET /api/backup`),
  - kopie na serwerze: automatycznie raz dziennie przy pierwszej zmianie, przed każdym importem i na żądanie (trzymane ostatnie `BACKUP_KEEP`, domyślnie 30).
- **Import JSON** – Nginx aplikacji przyjmuje żądania do 64 MB; zewnętrzny reverse proxy również musi mieć `client_max_body_size 64m;`, aby większy plik mógł dotrzeć do aplikacji.

## Uruchomienie (Docker)
```bash
htpasswd -cB nginx/auth/.htpasswd NAZWA_UZYTKOWNIKA
docker compose up -d --build
# http://localhost:8091
```
Polecenie `htpasswd` (z pakietu `apache2-utils`) utworzy lokalny plik z hashem hasła. Plik jest ignorowany przez Git. Przy dodawaniu kolejnych użytkowników użyj `htpasswd -B nginx/auth/.htpasswd NAZWA_UZYTKOWNIKA` (bez `-c`, aby nie nadpisać istniejących kont).

Worker Nginx działa jako użytkownik `nginx` (GID 101 w obrazie `nginx:alpine`), więc katalog i plik haseł muszą być czytelne dla tej grupy. Ustaw grupę i prawa, a następnie odtwórz kontener:
```bash
sudo chgrp -R 101 nginx/auth
chmod 750 nginx/auth
chmod 640 nginx/auth/.htpasswd
docker compose up -d --force-recreate nginx
```
Jeżeli używasz innego obrazu Nginx, sprawdź GID procesu worker poleceniem `docker exec compl-nginx id nginx` i użyj tego GID zamiast `101`.

Nginx wymaga logowania do całej aplikacji, włącznie z API, i ogranicza łączny ruch do 100 żądań/s niezależnie od adresu klienta, dopuszczając burst do 100 dodatkowych żądań; po przekroczeniu zwraca HTTP 429. Burst pozwala przeglądarce załadować wiele plików strony jednocześnie. Nie interpretuje nagłówka `X-Real-IP` z reverse proxy — adres klienta widziany przez aplikację będzie adresem proxy. Udostępniaj aplikację przez HTTPS, zwłaszcza poza lokalnym środowiskiem — Basic Auth przesyła dane logowania w nagłówku, który bez TLS nie jest szyfrowany.

Compose uruchamia osobno API FastAPI (`compl-backend`), frontend developerski Vite (`compl-frontend`) i Nginx (`compl-nginx`). Frontend i API są dostępne przez Nginx; reverse proxy może kierować ruch do `compl-nginx` w zewnętrznej sieci `proxy_ext_net`.

Sieć `proxy_ext_net` musi już istnieć przed uruchomieniem Compose. Baza i kopie leżą w katalogu `./rcd-data` w katalogu głównym projektu (montowanym jako `/data` w kontenerze backendu). Przy pierwszym starcie baza jest tworzona z `backend/seed/rcd_material_db.json`.

## Development
```bash
docker compose up --build         # frontend z hot reloadem; wejście przez http://localhost:8091
```

## Struktura
```
backend/   main.py (FastAPI + zapis JSON + kopie), seed/rcd_material_db.json
frontend/  React + Vite + Tailwind v4 + lucide-react
  src/lib/        substances.js (mapowanie na RCD), rcddb.js (parser CSV/klasyfikator), runner.js (skrypt BOMcheck), rcd.js
  src/views/      HelperView (ankieta), DatabaseView (baza), BackupView (kopie)
  src/components/ Header, helper/*, db/RecordEditor, ui/*
nginx/     reverse proxy /api → FastAPI oraz / → Vite
```

## API
| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/db` | cała baza |
| GET | `/api/meta` | metadane (n, src, built, updated) |
| POST | `/api/items` | nowy rekord `{ item }` |
| PUT | `/api/items/:key` | edycja `{ item, base }` (`base` = poprzednie `mod`) |
| DELETE | `/api/items/:key` | usunięcie |
| PUT | `/api/db` | zastąpienie całej bazy (import) |
| GET | `/api/backup` | pobranie kopii całej bazy |
| GET/POST | `/api/backups` | lista / utworzenie kopii na serwerze |
| GET | `/api/backups/:name` | pobranie konkretnej kopii |
| POST | `/api/backups/:name/delete` | usunięcie konkretnej kopii |

Schemat rekordu: `i` ITEM, `d` opis, `a` status, `sup` dostawca, `r` RoHS, `dt` data deklaracji,
`h` substancje `{ id: [źródło d|o|i|p, dowód] }`, `ex` wyjątki RoHS, `u` braki danych (`rohs|svhc|pfas|pip`),
`al` aliasy, `w` uwagi, `dup` liczba duplikatów w CSV, `mod` data ręcznej zmiany.
