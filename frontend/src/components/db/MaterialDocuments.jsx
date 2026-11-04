import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText, Link2, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useI18n } from '../../lib/i18n-context.js';
import { DOCUMENTS_UPDATED_EVENT, documentAddedAt, documentName, notifyDocumentsUpdated } from '../../lib/documents.js';
import { fold } from '../../lib/utils.js';
import { btnGhost, input } from '../ui/styles.js';
import DocumentFormModal from './DocumentFormModal.jsx';

export default function MaterialDocuments({ materialKey, material, notify }) {
  const { t, language } = useI18n();
  const locale = language === 'en' ? 'en-US' : 'pl-PL';
  const fileRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [library, setLibrary] = useState([]);
  const [query, setQuery] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [editingDocument, setEditingDocument] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [linked, all] = await Promise.all([
      api.materialDocuments(materialKey),
      api.documents(),
    ]);
    setDocuments(linked.documents);
    setLibrary(all.documents);
  }, [materialKey]);

  useEffect(() => {
    if (!materialKey) return undefined;
    let active = true;
    Promise.all([api.materialDocuments(materialKey), api.documents()])
      .then(([linked, all]) => {
        if (!active) return;
        setDocuments(linked.documents);
        setLibrary(all.documents);
      })
      .catch(cause => {
        if (active) setError(cause.message);
      });
    return () => { active = false; };
  }, [materialKey, refresh]);

  useEffect(() => {
    if (!materialKey) return undefined;
    const refreshDocuments = () => refresh().catch(cause => setError(cause.message));
    window.addEventListener(DOCUMENTS_UPDATED_EVENT, refreshDocuments);
    return () => window.removeEventListener(DOCUMENTS_UPDATED_EVENT, refreshDocuments);
  }, [materialKey, refresh]);

  const linkedIds = useMemo(() => new Set(documents.map(document => document.i)), [documents]);
  const options = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return [];
    return library.filter(document => !linkedIds.has(document.i)
      && [
        documentName(document.n),
        ...document.materials.flatMap(key => {
          const item = material?.items?.[key];
          return [key, item?.i, item?.d, item?.sup].filter(Boolean);
        }),
      ].some(value => fold(value).includes(needle)))
      .slice(0, 10);
  }, [library, linkedIds, material, query]);

  if (!materialKey) {
    return <p className="text-xs text-zinc-500">{t('Save the material before linking documents.')}</p>;
  }

  const link = async documentId => {
    setBusy(true);
    setError('');
    try {
      await api.linkDocument(materialKey, documentId);
      notifyDocumentsUpdated();
      setQuery('');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async file => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError(t('Only PDF files can be attached.'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t('PDF files must be 5 MB or smaller.'));
      return;
    }
    setError('');
    setPendingFile(file);
  };

  const saveDocument = async ({ name, type, declarationDate }) => {
    setBusy(true);
    setError('');
    try {
      if (pendingFile) {
        const { document, existing } = await api.uploadDocument(pendingFile, { name, type, declarationDate });
        await api.linkDocument(materialKey, document.i);
        notify(t(existing ? 'Reused existing PDF {file}' : 'Attached {file}', { file: documentName(document.n) }));
      } else {
        const result = await api.updateDocument(editingDocument.i, { name, type, dt: declarationDate });
        setDocuments(current => current.map(item => item.i === editingDocument.i ? { ...item, ...result.document } : item));
      }
      await refresh();
      notifyDocumentsUpdated();
      setPendingFile(null);
      setEditingDocument(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const closeForm = () => {
    if (busy) return;
    setPendingFile(null);
    setEditingDocument(null);
    setError('');
  };

  const unlink = async document => {
    if (!window.confirm(t('Unlink document {file} from material {item}?', { file: documentName(document.n), item: materialKey }))) return;
    setBusy(true);
    setError('');
    try {
      await api.unlinkDocument(materialKey, document.i);
      notifyDocumentsUpdated();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          className={`${input} pl-8`}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t('Search document library…')}
          aria-label={t('Search document library')}
        />
      </div>
      {query.trim() ? (
        options.length ? (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {options.map(document => (
              <li key={document.i} className="flex items-center gap-2 px-3 py-2 text-xs">
                <FileText size={14} className="shrink-0 text-red-300" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-zinc-200" title={documentName(document.n)}>{documentName(document.n)}</span>
                  <span className="block text-[10px] text-zinc-500">
                    {document.type ? t(document.type) : t('Unassigned')}
                    {documentAddedAt(document.n, locale) && ` · ${t('Added')}: ${documentAddedAt(document.n, locale)}`}
                  </span>
                </span>
                <span className="shrink-0 text-zinc-500">{t('Linked to {count} materials', { count: document.materials.length })}</span>
                <button type="button" className={btnGhost} disabled={busy} onClick={() => link(document.i)}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                  {t('Link document')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-zinc-500">{t('No documents match your search.')}</p>
        )
      ) : (
        <p className="text-[11px] text-zinc-500">{t('Type to search the document library.')}</p>
      )}
      <div className="flex">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            upload(file);
          }}
        />
        <button type="button" className={btnGhost} disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t('Upload PDF')}
        </button>
      </div>
      {documents.length ? (
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {documents.map(document => (
            <li key={document.i} className="flex items-center gap-2 px-3 py-2 text-xs">
              <FileText size={14} className="shrink-0 text-red-300" />
              <span className="min-w-0 flex-1">
                <a className="block truncate text-indigo-300 hover:underline" href={api.documentUrl(document.i)} target="_blank" rel="noreferrer">{documentName(document.n)}</a>
                <span className="text-zinc-500">
                  {document.type ? t(document.type) : t('Unassigned')}
                  {` · ${(document.z / 1024).toFixed(0)} KB`}
                  {document.dt && ` · ${t('Declaration date')}: ${document.dt}`}
                  {documentAddedAt(document.n, locale) && ` · ${t('Added')}: ${documentAddedAt(document.n, locale)}`}
                </span>
              </span>
              <a className="rounded p-1 text-zinc-400 hover:text-white" href={api.documentUrl(document.i)} target="_blank" rel="noreferrer" aria-label={t('Open PDF')}><ExternalLink size={14} /></a>
              <button type="button" className="rounded p-1 text-zinc-400 hover:text-indigo-300" onClick={() => setEditingDocument(document)} disabled={busy} aria-label={t('Edit document')} title={t('Edit document')}><Pencil size={14} /></button>
              <button type="button" className="rounded p-1 text-zinc-400 hover:text-red-300" onClick={() => unlink(document)} disabled={busy} aria-label={t('Unlink document')} title={t('Unlink document')}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-zinc-600">{t('No documents linked to this material.')}</p>
      )}
      {(pendingFile || editingDocument) && (
        <DocumentFormModal
          key={editingDocument?.i || pendingFile.name}
          file={pendingFile}
          document={editingDocument}
          busy={busy}
          error={error}
          onClose={closeForm}
          onSave={saveDocument}
        />
      )}
    </div>
  );
}
