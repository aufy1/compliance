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
  if (!r.ok) {
    const error = new Error(data?.error || data?.detail || `${r.status} ${r.statusText}`);
    error.status = r.status;
    throw error;
  }
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
  if (!response.ok) {
    const error = new Error(data?.error || data?.detail || `${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = {
  currentUser: () => req('GET', '/api/auth/me'),
  login: credentials => req('POST', '/api/auth/login', credentials),
  logout: () => req('POST', '/api/auth/logout'),
  changePassword: credentials => req('POST', '/api/auth/change-password', credentials),
  db: () => req('GET', '/api/db'),
  meta: () => req('GET', '/api/meta'),
  itemsPage: params => {
    const query = new URLSearchParams({
      page: String(params.page),
      page_size: String(params.pageSize),
      query: params.query,
      filters: JSON.stringify(params.filters),
      sort: params.sort.key,
      direction: params.sort.direction,
    });
    return req('GET', `/api/items/page?${query}`);
  },
  itemByKey: key => req('GET', `/api/items/by-key?key=${enc(key)}`),
  lookupItems: tokens => req('POST', '/api/items/lookup', { tokens }),
  itemCounts: () => req('GET', '/api/items/counts'),
  itemSuggestions: () => req('GET', '/api/items/suggestions'),
  packingPage: params => {
    const query = new URLSearchParams({
      page: String(params.page),
      page_size: String(params.pageSize),
      query: params.query,
      ppwr_filter: params.ppwrFilter,
    });
    return req('GET', `/api/items/packing?${query}`);
  },
  ppwr: () => req('GET', '/api/ppwr'),
  documents: () => req('GET', '/api/documents'),
  materialDocuments: key => req('GET', `/api/materials/documents?key=${enc(key)}`),
  uploadDocument: (file, { name, type, declarationDate }) => uploadFile(
    `/api/documents?filename=${enc(name)}&document_type=${enc(type)}&declaration_date=${enc(declarationDate || '')}`,
    file,
    'application/pdf',
  ),
  linkDocument: (key, documentId) => req('POST', `/api/materials/documents/${enc(documentId)}/link?key=${enc(key)}`),
  unlinkDocument: (key, documentId) => req('POST', `/api/materials/documents/${enc(documentId)}/unlink?key=${enc(key)}`),
  setDocumentType: (documentId, type) => req('POST', `/api/documents/${enc(documentId)}/type`, { type }),
  updateDocument: (documentId, metadata) => req('POST', `/api/documents/${enc(documentId)}/metadata`, metadata),
  renameDocument: (documentId, name) => req('POST', `/api/documents/${enc(documentId)}/rename`, { name }),
  deleteDocument: documentId => req('POST', `/api/documents/${enc(documentId)}/delete`),
  documentUrl: documentId => `/api/documents/${enc(documentId)}/file`,
  updatePpwrItem: (key, item) => req('POST', `/api/ppwr/item?key=${enc(key)}`, item),
  replacePpwrDb: db => req('POST', '/api/ppwr', db),
  importBackupZip: file => uploadFile('/api/db/import-zip', file, 'application/zip'),
  createItem: item => req('POST', '/api/items', { item }),
  updateItem: (key, item, base) => req('POST', `/api/items/by-key/update?key=${enc(key)}`, { item, base: base ?? null }),
  deleteItem: key => req('POST', `/api/items/by-key/delete?key=${enc(key)}`),
  replaceDb: db => req('POST', '/api/db', db),
  previewImport: (db, keepManual) => req('POST', '/api/db/import-preview', {
    items: db.items,
    keepManual,
  }),
  clearDb: () => req('POST', '/api/db/clear'),
  listBackups: () => req('GET', '/api/backups'),
  createPostgresBackup: () => req('POST', '/api/backups/postgresql'),
  deleteBackup: name => req('POST', `/api/backups/${enc(name)}/delete`),
};

export const backupFileUrl = name => `/api/backups/${enc(name)}`;
