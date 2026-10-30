import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText, Link2, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useI18n } from '../../lib/i18n-context.js';
import { btnGhost, input } from '../ui/styles.js';

export default function MaterialDocuments({ materialKey, material, notify }) {
  const { t } = useI18n();
  const fileRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [library, setLibrary] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    const [linked, all] = await Promise.all([
      api.materialDocuments(materialKey),
      api.documents(),
    ]);
    setDocuments(linked.documents);
    setLibrary(all.documents);
  };

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
  }, [materialKey]);

  const linkedIds = useMemo(() => new Set(documents.map(document => document.i)), [documents]);
  const options = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return library.filter(document => !linkedIds.has(document.i)
      && (!needle || [
        document.n,
        ...document.materials,
        ...document.materials.map(key => `${key} ${material?.items?.[key]?.d || ''}`),
      ].join(' ').toLocaleLowerCase().includes(needle)));
  }, [library, linkedIds, material, query]);

  if (!materialKey) {
    return <p className="text-xs text-zinc-500">{t('Save the material before linking documents.')}</p>;
  }

  const link = async documentId => {
    setBusy(true);
    setError('');
    try {
      await api.linkDocument(materialKey, documentId);
      await refresh();
      setSelected('');
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
    if (file.size > 20 * 1024 * 1024) {
      setError(t('PDF files must be 20 MB or smaller.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { document, existing } = await api.uploadDocument(file);
      await api.linkDocument(materialKey, document.i);
      await refresh();
      notify(t(existing ? 'Reused existing PDF {file}' : 'Attached {file}', { file: document.n }));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async document => {
    if (!window.confirm(t('Unlink document {file} from material {item}?', { file: document.n, item: materialKey }))) return;
    setBusy(true);
    setError('');
    try {
      await api.unlinkDocument(materialKey, document.i);
      await refresh();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className={`${input} pl-8`}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('Search document library…')}
            aria-label={t('Search document library')}
          />
        </div>
        <select
          className={`${input} min-w-48 flex-1`}
          value={selected}
          onChange={event => setSelected(event.target.value)}
          aria-label={t('Select a document to link')}
        >
          <option value="">{t('Select a document')}</option>
          {options.map(document => (
            <option key={document.i} value={document.i}>{document.n}</option>
          ))}
        </select>
        <button type="button" className={btnGhost} disabled={!selected || busy} onClick={() => link(selected)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          {t('Link document')}
        </button>
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
              <a className="min-w-0 flex-1 truncate text-indigo-300 hover:underline" href={api.documentUrl(document.i)} target="_blank" rel="noreferrer">{document.n}</a>
              <span className="text-zinc-500">{(document.z / 1024).toFixed(0)} KB</span>
              <a className="rounded p-1 text-zinc-400 hover:text-white" href={api.documentUrl(document.i)} target="_blank" rel="noreferrer" aria-label={t('Open PDF')}><ExternalLink size={14} /></a>
              <button type="button" className="rounded p-1 text-zinc-400 hover:text-red-300" onClick={() => unlink(document)} disabled={busy} aria-label={t('Unlink document')} title={t('Unlink document')}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-zinc-600">{t('No documents linked to this material.')}</p>
      )}
    </div>
  );
}
