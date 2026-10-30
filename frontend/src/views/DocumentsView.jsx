import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useI18n } from '../lib/i18n-context.js';
import { btnGhost, btnPrimary, input, panel } from '../components/ui/styles.js';

export default function DocumentsView({ db, notify }) {
  const { t } = useI18n();
  const fileRef = useRef(null);
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);

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
    const needle = query.trim().toLocaleLowerCase();
    return (documents || []).filter(document => !needle || [
      document.n,
      ...document.materials,
      ...document.materials.map(key => `${db.items[key]?.i || key} ${db.items[key]?.d || ''} ${db.items[key]?.sup || ''}`),
    ].join(' ').toLocaleLowerCase().includes(needle));
  }, [db, documents, query]);

  const upload = async file => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError(t('Only PDF files can be attached.'));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError(t('PDF files must be 20 MB or smaller.'));
      return;
    }
    setUploading(true);
    setError('');
    try {
      const result = await api.uploadDocument(file);
      await refresh();
      notify(t(result.existing ? 'Reused existing PDF {file}' : 'Added document {file}', { file: result.document.n }));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setUploading(false);
    }
  };

  const rename = async document => {
    const proposedName = window.prompt(t('Enter a new PDF name'), document.n);
    if (proposedName === null) return;
    let name = proposedName.trim();
    if (!name) return;
    if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
    try {
      const result = await api.renameDocument(document.i, name);
      setDocuments(current => current.map(item => item.i === document.i ? { ...item, ...result.document } : item));
      notify(t('Renamed PDF to {file}', { file: result.document.n }));
    } catch (cause) {
      setError(cause.message);
    }
  };

  const remove = async document => {
    if (!window.confirm(t('Delete document {file} and unlink it from {count} materials?', {
      file: document.n,
      count: document.materials.length,
    }))) return;
    try {
      await api.deleteDocument(document.i);
      setDocuments(current => current.filter(item => item.i !== document.i));
      notify(t('Deleted document {file}', { file: document.n }));
    } catch (cause) {
      setError(cause.message);
    }
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
          upload(file);
        }} />
        <button type="button" className={btnPrimary} disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t('Add PDF')}
        </button>
      </header>
      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input className={`${input} pl-9`} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search documents by name, ITEM or material description…')} aria-label={t('Search documents')} />
      </div>
      <section className={`${panel} overflow-hidden`}>
        {documents === null ? (
          <div className="flex items-center gap-2 p-5 text-sm text-zinc-400"><Loader2 size={16} className="animate-spin" />{t('Loading documents…')}</div>
        ) : filtered.length ? (
          <ul className="divide-y divide-zinc-800">
            {filtered.map(document => (
              <li key={document.i} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText size={17} className="shrink-0 text-red-300" />
                <div className="min-w-0 flex-1">
                  <a className="truncate text-sm font-medium text-indigo-300 hover:underline" href={api.documentUrl(document.i)} target="_blank" rel="noreferrer">{document.n}</a>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {(document.z / 1024).toFixed(0)} KB · {t('Linked to {count} materials', { count: document.materials.length })}
                    {document.materials.length > 0 && ` · ${document.materials.map(key => db.items[key]?.i || key).join(', ')}`}
                  </p>
                </div>
                <a className="rounded p-2 text-zinc-400 hover:text-white" href={api.documentUrl(document.i)} target="_blank" rel="noreferrer" aria-label={t('Open PDF')}><ExternalLink size={15} /></a>
                <button type="button" className="rounded p-2 text-zinc-400 hover:text-white" onClick={() => rename(document)} aria-label={t('Rename PDF')} title={t('Rename PDF')}><Pencil size={15} /></button>
                <button type="button" className="rounded p-2 text-zinc-400 hover:text-red-300" onClick={() => remove(document)} aria-label={t('Delete document')} title={t('Delete document')}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-zinc-400">{t(query ? 'No documents match your search.' : 'No documents in the library yet.')}</p>
        )}
      </section>
    </div>
  );
}
