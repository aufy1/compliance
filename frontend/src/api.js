/* Klient REST backendu */
async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* brak JSON */ }
  if (!r.ok) throw new Error(data?.error || data?.detail || `${r.status} ${r.statusText}`);
  return data;
}

const enc = encodeURIComponent;

export const api = {
  db: () => req('GET', '/api/db'),
  createItem: item => req('POST', '/api/items', { item }),
  updateItem: (key, item, base) => req('POST', `/api/items/${enc(key)}`, { item, base: base ?? null }),
  deleteItem: key => req('POST', `/api/items/${enc(key)}/delete`),
  replaceDb: db => req('POST', '/api/db', db),
  clearDb: () => req('POST', '/api/db/clear'),
  listBackups: () => req('GET', '/api/backups'),
  createBackup: () => req('POST', '/api/backups'),
  deleteBackup: name => req('POST', `/api/backups/${enc(name)}/delete`),
};

export const BACKUP_URL = '/api/backup';
export const backupFileUrl = name => `/api/backups/${enc(name)}`;
