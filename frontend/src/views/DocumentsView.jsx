import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText, Filter, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useI18n } from '../lib/i18n-context.js';
import { DOCUMENT_TYPES, documentAddedAt, documentName, foldDocumentSearch, notifyDocumentsUpdated } from '../lib/documents.js';
import DocumentFormModal from '../components/db/DocumentFormModal.jsx';
import { btnGhost, btnPrimary, input, panel } from '../components/ui/styles.js';

export default function DocumentsView({ db, notify }) {
  const { t, language } = useI18n();
  const locale = language === 'en' ? 'en-US' : 'pl-PL';
  const fileRef = useRef(null);
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [editingDocument, setEditingDocument] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ type: 'all', date: 'all', linked: 'all' });

  const refresh = async () => {
    setError('');
    try {
      setDocuments((await api.documents()).documents);
    } catch (cause) {
      setError(cause.message);
      setDocuments([]);
    }
  };

  useEffect(() => {
    let active = true;
    api.documents()
      .then(result => { if (active) setDocuments(result.documents); })
      .catch(cause => {
        if (active) {
          setError(cause.message);
          setDocuments([]);
        }
      });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const needle = foldDocumentSearch(query.trim());
    return (documents || []).filter(document => {
      if (filters.type !== 'all' && (filters.type === 'unassigned' ? document.type : document.type !== filters.type)) return false;
      if (filters.date === 'with' && !document.dt) return false;
      if (filters.date === 'without' && document.dt) return false;
      if (filters.linked === 'linked' && !document.materials.length) return false;
      if (filters.linked === 'unlinked' && document.materials.length) return false;
      return !needle || foldDocumentSearch([
        documentName(document.n),
        document.type || '',
        document.dt || '',
        ...document.materials,
        ...document.materials.map(key => `${db.items[key]?.i || key} ${db.items[key]?.d || ''} ${db.items[key]?.sup || ''}`),
      ].join(' ')).includes(needle);
    });
  }, [db, documents, filters, query]);

  const selectFile = file => {
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
    setFormError('');
    setPendingFile(file);
  };

  const closeForm = () => {
    if (formBusy) return;
    setPendingFile(null);
    setEditingDocument(null);
    setFormError('');
  };

  const saveDocument = async ({ name, type, declarationDate }) => {
    setFormBusy(true);
    setFormError('');
    try {
      if (pendingFile) {
        const result = await api.uploadDocument(pendingFile, { name, type, declarationDate });
        await refresh();
        notifyDocumentsUpdated();
        notify(t(result.existing ? 'Reused existing PDF {file}' : 'Added document {file}', { file: name }));
      } else {
        const result = await api.updateDocument(editingDocument.i, { name, type, dt: declarationDate });
        setDocuments(current => current.map(item => item.i === editingDocument.i ? { ...item, ...result.document } : item));
        notifyDocumentsUpdated();
        notify(t('Document updated'));
      }
      setPendingFile(null);
      setEditingDocument(null);
    } catch (cause) {
      setFormError(cause.message);
    } finally {
      setFormBusy(false);
    }
  };

  const remove = async document => {
    if (!window.confirm(t('Delete document {file} and unlink it from {count} materials?', {
      file: documentName(document.n),
      count: document.materials.length,
    }))) return;
    try {
      await api.deleteDocument(document.i);
      setDocuments(current => current.filter(item => item.i !== document.i));
      notifyDocumentsUpdated();
      notify(t('Deleted document {file}', { file: documentName(document.n) }));
    } catch (cause) {
      setError(cause.message);
    }
  };

  const activeFilterCount = Object.values(filters).filter(value => value !== 'all').length;
  const clearFilters = () => {
    setQuery('');
    setFilters({ type: 'all', date: 'all', linked: 'all' });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold text-white">{t('PDF document library')}</h1>
          <p className="mt-1 text-sm text-zinc-400">{t('Manage reusable PDFs and search by document or linked material.')}</p>
        </div>
        <button type="button" onClick={refresh} className={btnGhost}><RefreshCw size={14} />{t('Refresh')}</button>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          selectFile(file);
        }} />
        <button type="button" className={btnPrimary} onClick={() => fileRef.current?.click()}>
          <Plus size={14} />
          {t('Add PDF')}
        </button>
      </header>
      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      <section className={`${panel} space-y-3 p-4`}>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className={`${input} pl-9 pr-9`} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search by name, ITEM or description')} aria-label={t('Search documents')} />
            {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Clear search')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"><X size={14} /></button>}
          </div>
          <button type="button" className={btnGhost} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}>
            <Filter size={14} />{t('Filters')}{activeFilterCount > 0 && <span className="rounded-full bg-indigo-500/20 px-1.5 text-indigo-200">{activeFilterCount}</span>}
          </button>
          {(query || activeFilterCount > 0) && <button type="button" className={btnGhost} onClick={clearFilters}>{t('Clear filters')}</button>}
        </div>
        {filtersOpen && (
          <div className="grid gap-3 border-t border-zinc-800 pt-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('Document type')}</span>
              <select className={input} value={filters.type} onChange={event => setFilters(current => ({ ...current, type: event.target.value }))}>
                <option value="all">{t('All types')}</option>
                <option value="unassigned">{t('Unassigned')}</option>
                {DOCUMENT_TYPES.map(type => <option key={type} value={type}>{t(type)}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('Declaration date')}</span>
              <select className={input} value={filters.date} onChange={event => setFilters(current => ({ ...current, date: event.target.value }))}>
                <option value="all">{t('Any date status')}</option>
                <option value="with">{t('Date provided')}</option>
                <option value="without">{t('No date provided')}</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span>{t('Material links')}</span>
              <select className={input} value={filters.linked} onChange={event => setFilters(current => ({ ...current, linked: event.target.value }))}>
                <option value="all">{t('All documents')}</option>
                <option value="linked">{t('Linked to materials')}</option>
                <option value="unlinked">{t('Not linked')}</option>
              </select>
            </label>
          </div>
        )}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {filters.type !== 'all' && <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300">{t('Document type')}: {t(filters.type === 'unassigned' ? 'Unassigned' : filters.type)}</span>}
            {filters.date !== 'all' && <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300">{t(filters.date === 'with' ? 'Date provided' : 'No date provided')}</span>}
            {filters.linked !== 'all' && <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300">{t(filters.linked === 'linked' ? 'Linked to materials' : 'Not linked')}</span>}
          </div>
        )}
        {documents && <p className="text-[11px] text-zinc-500">{t('Showing {shown} of {total} documents', { shown: filtered.length, total: documents.length })}</p>}
      </section>
      <section className={`${panel} overflow-hidden`}>
        {documents === null ? (
          <div className="flex items-center gap-2 p-5 text-sm text-zinc-400"><Loader2 size={16} className="animate-spin" />{t('Loading documents…')}</div>
        ) : filtered.length ? (
          <ul className="divide-y divide-zinc-800">
            {filtered.map(document => (
              <li key={document.i} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText size={17} className="shrink-0 text-red-300" />
                <div className="min-w-0 flex-1">
                  <a className="truncate text-sm font-medium text-indigo-300 hover:underline" href={api.documentUrl(document.i)} target="_blank" rel="noreferrer">{documentName(document.n)}</a>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {document.type ? t(document.type) : t('Unassigned')} · {(document.z / 1024).toFixed(0)} KB
                    {document.dt && ` · ${t('Declaration date')}: ${document.dt}`}
                    {' · '}{t('Linked to {count} materials', { count: document.materials.length })}
                    {document.materials.length > 0 && ` · ${document.materials.map(key => db.items[key]?.i || key).join(', ')}`}
                    {documentAddedAt(document.n, locale) && ` · ${t('Added')}: ${documentAddedAt(document.n, locale)}`}
                  </p>
                </div>
                <a className="rounded p-2 text-zinc-400 hover:text-white" href={api.documentUrl(document.i)} target="_blank" rel="noreferrer" aria-label={t('Open PDF')}><ExternalLink size={15} /></a>
                <button type="button" className="rounded p-2 text-zinc-400 hover:text-white" onClick={() => { setEditingDocument(document); setFormError(''); }} aria-label={t('Edit document')} title={t('Edit document')}><Pencil size={15} /></button>
                <button type="button" className="rounded p-2 text-zinc-400 hover:text-red-300" onClick={() => remove(document)} aria-label={t('Delete document')} title={t('Delete document')}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-zinc-400">{t(documents?.length ? 'No documents match the selected search and filters.' : 'No documents in the library yet.')}</p>
        )}
      </section>
      {(pendingFile || editingDocument) && (
        <DocumentFormModal
          key={editingDocument?.i || pendingFile.name}
          file={pendingFile}
          document={editingDocument}
          busy={formBusy}
          error={formError}
          onClose={closeForm}
          onSave={saveDocument}
        />
      )}
    </div>
  );
}
