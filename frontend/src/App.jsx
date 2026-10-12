import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Upload, RefreshCw } from 'lucide-react';
import { api } from './api.js';
import RCDDB from './lib/rcddb.js';
import { readBuf, cx } from './lib/utils.js';
import Header from './components/Header.jsx';
import HelperView from './views/HelperView.jsx';
import DatabaseView from './views/DatabaseView.jsx';
import BackupView from './views/BackupView.jsx';
import RecordEditor from './components/db/RecordEditor.jsx';
import { Modal, Check } from './components/ui/index.jsx';
import { btnGhost, btnPrimary } from './components/ui/styles.js';
import { useI18n } from './lib/i18n-context.js';

let nonce = 0;

export default function App() {
  const { t } = useI18n();
  const [db, setDb] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [view, setViewState] = useState(() => localStorage.getItem('rcdView') || 'helper');
  const [editing, setEditing] = useState(null);       // { key|null, item, n }
  const [pending, setPending] = useState(null);       // import do potwierdzenia
  const [toasts, setToasts] = useState([]);

  const setView = v => { setViewState(v); localStorage.setItem('rcdView', v); };

  const notify = useCallback((msg, type = 'ok') => {
    const id = ++nonce;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'error' ? 7000 : 3500);
  }, []);

  const load = useCallback(async (silent) => {
    try { setDb(await api.db()); setLoadErr(null); if (silent) notify(t('Baza odświeżona z serwera')); }
    catch (e) { setLoadErr(e.message); }
  }, [notify, t]);
  const clearDatabase = async () => {
    try {
      const result = await api.clearDb();
      setDb(current => ({ ...current, ...result.meta, items: {} }));
      notify(t('Baza została wyczyszczona. Utworzono kopię: {backup}', { backup: result.backup }));
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  useEffect(() => {
    let active = true;
    api.db()
      .then(data => {
        if (!active) return;
        setDb(data);
        setLoadErr(null);
      })
      .catch(e => {
        if (active) setLoadErr(e.message);
      });
    return () => { active = false; };
  }, []);

  /* --- rekordy --- */
  const openEditor = key => db.items[key] && setEditing({ key, item: db.items[key], n: ++nonce });
  const openNew = (prefill = {}) => setEditing({ key: null, item: { i: '', h: {}, ...prefill }, n: ++nonce });

  const applySaved = ({ key, oldKey, item, meta }) => setDb(prev => {
    const items = { ...prev.items };
    if (oldKey && oldKey !== key) delete items[oldKey];
    items[key] = item;
    return { ...prev, ...meta, items };
  });
  const applyDeleted = (key, meta) => setDb(prev => {
    const items = { ...prev.items }; delete items[key];
    return { ...prev, ...meta, items };
  });
  const quickDelete = async key => {
    const it = db.items[key];
    if (!window.confirm(t('Usunąć rekord {item}?\n(Kopia dzienna bazy jest tworzona automatycznie na serwerze.)', { item: it.i }))) return;
    try { const r = await api.deleteItem(key); applyDeleted(key, r.meta); notify(t('Usunięto {item}', { item: it.i })); }
    catch (e) { notify(e.message, 'error'); }
  };

  /* --- import całej bazy --- */
  const onImportCsv = async f => {
    try {
      const built = RCDDB.build(RCDDB.parseCSV(RCDDB.decode(await readBuf(f))), f.name);
      setPending({ db: built, kind: 'csv', name: f.name, keepManual: true });
    } catch (e) { notify(t('Błąd CSV: {error}', { error: e.message }), 'error'); }
  };
  const onImportJson = async f => {
    try {
      const d = JSON.parse(new TextDecoder().decode(await readBuf(f)));
      if (!d || typeof d.items !== 'object') throw new Error(t('brak pola "items"'));
      setPending({ db: d, kind: 'json', name: f.name, keepManual: false });
    } catch (e) { notify(t('Błąd JSON: {error}', { error: e.message }), 'error'); }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-zinc-950">
      <Header view={view} setView={setView} meta={db} notify={notify}
        onImportCsv={onImportCsv} onImportJson={onImportJson}
        onReload={() => load(true)} onClearDatabase={clearDatabase} />

      <main className="flex-1 min-w-0 md:h-screen md:min-h-0 md:overflow-auto">
        {!db && !loadErr && <div className="h-full flex items-center justify-center text-zinc-500 gap-2 text-sm"><Loader2 className="animate-spin" size={18} /> {t('Wczytywanie bazy…')}</div>}
        {loadErr && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-sm">
            <div className="flex items-center gap-2 text-red-300"><AlertTriangle size={18} /> {t('Nie udało się wczytać bazy: {error}', { error: loadErr })}</div>
            <button className={btnGhost} onClick={() => load()}><RefreshCw size={14} /> {t('Spróbuj ponownie')}</button>
          </div>
        )}
        {db && (
          <>
            <div className={cx(view !== 'helper' && 'hidden')}>
              <HelperView db={db} onEditRecord={openEditor} onNewRecord={openNew} notify={notify} />
            </div>
            {view === 'db' && <DatabaseView db={db} onEdit={openEditor} onDelete={quickDelete} onNew={() => openNew()} />}
          </>
        )}
        {view === 'backups' && <BackupView notify={notify} />}
      </main>

      {editing && db && (
        <RecordEditor key={editing.n} editing={editing} db={db} notify={notify}
          onClose={() => setEditing(null)} onSaved={applySaved} onDeleted={applyDeleted}
          onOpenExisting={k => openEditor(k)} />
      )}

      {pending && db && (
        <ImportDialog pending={pending} current={db} onClose={() => setPending(null)} notify={notify}
          onDone={(newDb, meta) => { setDb({ ...meta, items: newDb.items }); setPending(null); }} />
      )}

      {/* toasty */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={cx('flex items-start gap-2 px-4 py-3 rounded-lg border shadow-2xl text-xs animate-slide-down bg-zinc-900',
            t.type === 'error' ? 'border-red-500/40 text-red-200' : 'border-zinc-700 text-zinc-200')}>
            {t.type === 'error' ? <XCircle size={16} className="text-red-400 shrink-0" /> : <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportDialog({ pending, current, onClose, onDone, notify }) {
  const { t, language } = useI18n();
  const [keep, setKeep] = useState(pending.keepManual);
  const [busy, setBusy] = useState(false);
  const next = pending.db.items, cur = current.items;
  const manual = Object.entries(cur).filter(([, it]) => it.mod);
  const added = Object.keys(next).filter(k => !cur[k]).length;
  const removed = Object.keys(cur).filter(k => !next[k]).length;

  const go = async () => {
    setBusy(true);
    try {
      const items = { ...next };
      if (keep) manual.forEach(([k, it]) => { items[k] = it; });
      const body = { ...pending.db, items, n: Object.keys(items).length };
      const r = await api.replaceDb(body);
      onDone(body, r.meta);
      notify(t('Zaimportowano {count} rekordów. Poprzednia baza zapisana jako {backup}', { count: r.meta.n, backup: r.backup }));
    } catch (e) { notify(e.message, 'error'); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} icon={<Upload size={16} className="text-indigo-400" />} title={t('Import bazy z {kind}', { kind: pending.kind.toUpperCase() })}
      footer={<div className="ml-auto flex gap-2">
        <button className={btnGhost} onClick={onClose}>{t('Anuluj')}</button>
        <button className={btnPrimary} onClick={go} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {t('Zastąp bazę na serwerze')}</button>
      </div>}>
      <div className="space-y-4 text-xs text-zinc-300">
        <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 space-y-1">
          <div>{t('Plik:')} <b className="text-white">{pending.name}</b></div>
          <div>{t('Rekordów w pliku:')} <b className="text-white">{Object.keys(next).length.toLocaleString(language === 'en' ? 'en-US' : 'pl-PL')}</b>{pending.db.rows ? ` (${t('wierszy')}: ${pending.db.rows})` : ''}</div>
          <div>{t('Obecnie na serwerze:')} <b className="text-white">{Object.keys(cur).length}</b> · {t('nowych ITEM:')} <b className="text-emerald-300">{added}</b> · {t('zniknie:')} <b className="text-red-300">{removed}</b></div>
        </div>
        {manual.length > 0 && (
          <div className="border border-indigo-500/30 bg-indigo-500/5 rounded-lg p-3 space-y-2">
            <Check checked={keep} onChange={setKeep}>{t('Zachowaj {count} rekordów dodanych / edytowanych ręcznie (nadpiszą dane z pliku)', { count: manual.length })}</Check>
            <div className="text-[11px] text-zinc-500 pl-5">{t('Przy przywracaniu kopii zapasowej zwykle zostaw odznaczone.')}</div>
          </div>
        )}
        <p className="text-[11px] text-zinc-500">{t('Przed importem serwer automatycznie zapisze kopię obecnej bazy (menu „Kopia zapasowa”).')}</p>
      </div>
    </Modal>
  );
}
