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

async function uploadFile(url, file, contentType) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* brak JSON */ }
  if (!response.ok) throw new Error(data?.error || data?.detail || `${response.status} ${response.statusText}`);
  return data;
}

export const api = {
  db: () => req('GET', '/api/db'),
  ppwr: () => req('GET', '/api/ppwr'),
  documents: () => req('GET', '/api/documents'),
  materialDocuments: key => req('GET', `/api/materials/${enc(key)}/documents`),
  uploadDocument: file => uploadFile(`/api/documents?filename=${enc(file.name)}`, file, 'application/pdf'),
  linkDocument: (key, documentId) => req('POST', `/api/materials/${enc(key)}/documents/${enc(documentId)}/link`),
  unlinkDocument: (key, documentId) => req('POST', `/api/materials/${enc(key)}/documents/${enc(documentId)}/unlink`),
  renameDocument: (documentId, name) => req('POST', `/api/documents/${enc(documentId)}/rename`, { name }),
  deleteDocument: documentId => req('POST', `/api/documents/${enc(documentId)}/delete`),
  documentUrl: documentId => `/documents/${enc(documentId)}.pdf`,
  updatePpwrItem: (key, item) => req('POST', `/api/ppwr/items/${enc(key)}`, item),
  replacePpwrDb: db => req('POST', '/api/ppwr', db),
  importBackupZip: file => uploadFile('/api/db/import-zip', file, 'application/zip'),
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
export const BACKUP_ZIP_URL = '/api/backup.zip';
export const MATERIALS_BACKUP_URL = '/api/backup/materials';
export const PPWR_BACKUP_URL = '/api/backup/ppwr';
export const DOCUMENTS_BACKUP_URL = '/api/backup/documents';
export const DOCUMENT_LINKS_BACKUP_URL = '/api/backup/document-links';
export const backupFileUrl = name => `/api/backups/${enc(name)}`;
