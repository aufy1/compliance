import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Upload, RefreshCw } from 'lucide-react';
import { api } from './api.js';
import RCDDB from './lib/rcddb.js';
import { readBuf, cx } from './lib/utils.js';
import Header from './components/Header.jsx';
import HelperView from './views/HelperView.jsx';
import DatabaseView from './views/DatabaseView.jsx';
import PackingView from './views/PackingView.jsx';
import DocumentsView from './views/DocumentsView.jsx';
import BackupView from './views/BackupView.jsx';
import RecordEditor from './components/db/RecordEditor.jsx';
import { Modal, Check } from './components/ui/index.jsx';
import { btnGhost, btnPrimary } from './components/ui/styles.js';
import { useI18n } from './lib/i18n-context.js';

let nonce = 0;

export default function App() {
  const [user, setUser] = useState(undefined);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let active = true;
    api.currentUser()
      .then(result => { if (active) setUser(result.user); })
      .catch(error => {
        if (!active) return;
        if (error.status === 401) setUser(null);
        else {
          setAuthError(error.message);
          setUser(null);
        }
      });
    return () => { active = false; };
  }, []);

  const login = async (username, password) => {
    const result = await api.login({ username, password });
    setAuthError('');
    setUser(result.user);
  };
  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  if (user === undefined) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400"><Loader2 className="animate-spin" size={18} /></div>;
  }
  if (!user) return <LoginView onLogin={login} initialError={authError} />;
  return <AuthenticatedApp user={user} onLogout={logout} />;
}

function LoginView({ onLogin, initialError }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(username, password);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl">
        <div>
          <div className="text-xl font-semibold text-zinc-100">Compliance RCD</div>
          <p className="mt-1 text-sm text-zinc-400">{t('Zaloguj się do aplikacji')}</p>
        </div>
        <label className="block space-y-1.5 text-sm text-zinc-300">
          <span>{t('Nazwa użytkownika')}</span>
          <input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            required value={username} onChange={event => setUsername(event.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none focus:border-indigo-400" />
        </label>
        <label className="block space-y-1.5 text-sm text-zinc-300">
          <span>{t('Hasło')}</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none focus:border-indigo-400" />
        </label>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">
          {busy ? t('Logowanie…') : t('Zaloguj się')}
        </button>
      </form>
    </main>
  );
}

function AuthenticatedApp({ user, onLogout }) {
  const { t } = useI18n();
  const [db, setDb] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [view, setViewState] = useState(() => localStorage.getItem('rcdView') || 'helper');
  const [editing, setEditing] = useState(null);       // { key|null, item, n }
  const [pending, setPending] = useState(null);       // import do potwierdzenia
  const [toasts, setToasts] = useState([]);
  const [reloadSequence, setReloadSequence] = useState(0);

  const setView = v => { setViewState(v); localStorage.setItem('rcdView', v); };

  const notify = useCallback((msg, type = 'ok') => {
    const id = ++nonce;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'error' ? 7000 : 3500);
  }, []);

  const load = useCallback(async (silent) => {
    try {
      setDb(await api.meta());
      setReloadSequence(current => current + 1);
      setLoadErr(null);
      if (silent) notify(t('Baza odświeżona z serwera'));
    }
    catch (e) { setLoadErr(e.message); }
  }, [notify, t]);
  const clearDatabase = async () => {
    try {
      const result = await api.clearDb();
      setDb(current => ({ ...current, ...result.meta }));
      notify(t('Baza została wyczyszczona. Utworzono kopię PostgreSQL: {backup}', { backup: result.backup }));
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  useEffect(() => {
    let active = true;
    api.meta()
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
  const openEditor = async (key, cachedItem) => {
    try {
      const item = cachedItem || (await api.itemByKey(key)).item;
      setEditing({ key, item, n: ++nonce });
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  const openNew = (prefill = {}) => setEditing({ key: null, item: { i: '', h: {}, ...prefill }, n: ++nonce });

  const applySaved = ({ meta }) => setDb(prev => ({ ...prev, ...meta }));
  const applyDeleted = meta => setDb(prev => ({ ...prev, ...meta }));
  const quickDelete = async (key, it) => {
    if (!window.confirm(t('Usunąć rekord {item}?\n(Kopia dzienna bazy jest tworzona automatycznie na serwerze.)', { item: it.i }))) return;
    try { const r = await api.deleteItem(key); applyDeleted(r.meta); notify(t('Usunięto {item}', { item: it.i })); }
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
      if (f.name.toLocaleLowerCase().endsWith('.zip')) {
        if (!window.confirm(t('Restore the full database and PPWR files from {file}?', { file: f.name }))) return;
        const result = await api.importBackupZip(f);
        setDb(await api.meta());
        notify(t('Restored database backup ({count} materials).', { count: result.meta.n }));
        return;
      }
      const d = JSON.parse(new TextDecoder().decode(await readBuf(f)));
      if (!d || typeof d.items !== 'object') throw new Error(t('brak pola "items"'));
      setPending({
        db: d,
        kind: f.name.toLocaleLowerCase().includes('ppwr') ? 'ppwr' : 'json',
        name: f.name,
        keepManual: false,
      });
    } catch (e) { notify(t('Błąd JSON: {error}', { error: e.message }), 'error'); }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-zinc-950">
      <Header view={view} setView={setView} meta={db} notify={notify}
        user={user} onLogout={() => onLogout().catch(error => notify(error.message, 'error'))}
        onChangePassword={credentials => api.changePassword(credentials)}
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
              <HelperView onEditRecord={openEditor} onNewRecord={openNew} notify={notify} />
            </div>
            {view === 'db' && <DatabaseView db={db} reloadSequence={reloadSequence} onEdit={openEditor} onDelete={quickDelete} onNew={() => openNew()} notify={notify} />}
            {view === 'packing' && <PackingView db={db} reloadSequence={reloadSequence} onEdit={openEditor} onDelete={quickDelete} onNew={openNew} notify={notify} />}
            {view === 'documents' && <DocumentsView notify={notify} />}
          </>
        )}
        {view === 'backups' && <BackupView notify={notify} onImportFile={onImportJson} />}
      </main>

      {editing && db && (
        <RecordEditor key={editing.n} editing={editing} notify={notify}
          onClose={() => setEditing(null)} onSaved={applySaved}
          onDeleted={(key, meta) => applyDeleted(meta)}
          onOpenExisting={k => openEditor(k)} />
      )}

      {pending && db && (
        <ImportDialog pending={pending} current={db} onClose={() => setPending(null)} notify={notify}
          onDone={meta => { setDb({ ...meta }); setPending(null); }} />
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
  const [previewState, setPreviewState] = useState(null);
  const next = pending.db.items;
  const currentPreview = previewState?.pending === pending && previewState.keep === keep;
  const preview = currentPreview ? previewState.result : null;
  const previewError = currentPreview ? previewState.error : '';
  useEffect(() => {
    if (pending.kind === 'ppwr') return undefined;
    let active = true;
    api.previewImport(pending.db, keep)
      .then(result => { if (active) setPreviewState({ pending, keep, result, error: '' }); })
      .catch(error => { if (active) setPreviewState({ pending, keep, result: null, error: error.message }); });
    return () => { active = false; };
  }, [pending, keep]);

  const go = async () => {
    setBusy(true);
    try {
      if (pending.kind === 'ppwr') {
        const result = await api.replacePpwrDb(pending.db);
        onDone(current);
        notify(t('Imported PPWR records ({count}).', { count: result.items }));
        return;
      }
      const body = { ...pending.db, keepManual: keep };
      const r = await api.replaceDb(body);
      onDone(r.meta);
      notify(t('Zaimportowano {count} rekordów. Kopia PostgreSQL: {backup}', { count: r.meta.n, backup: r.backup }));
    } catch (e) { notify(e.message, 'error'); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} icon={<Upload size={16} className="text-indigo-400" />} title={t('Import bazy z {kind}', { kind: pending.kind.toUpperCase() })}
      footer={<div className="ml-auto flex gap-2">
        <button className={btnGhost} onClick={onClose}>{t('Anuluj')}</button>
        <button className={btnPrimary} onClick={go} disabled={busy || (pending.kind !== 'ppwr' && (!preview || Boolean(previewError)))}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {t('Zastąp bazę na serwerze')}</button>
      </div>}>
      <div className="space-y-4 text-xs text-zinc-300">
        <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 space-y-1">
          <div>{t('Plik:')} <b className="text-white">{pending.name}</b></div>
          <div>{t('Rekordów w pliku:')} <b className="text-white">{Object.keys(next).length.toLocaleString(language === 'en' ? 'en-US' : 'pl-PL')}</b>{pending.db.rows ? ` (${t('wierszy')}: ${pending.db.rows})` : ''}</div>
          <div>{t('Obecnie na serwerze:')} <b className="text-white">{current.n}</b>
            {pending.kind !== 'ppwr' && preview && <> · {t('nowych ITEM:')} <b className="text-emerald-300">{preview.added}</b> · {t('zniknie:')} <b className="text-red-300">{preview.removed}</b></>}
          </div>
        </div>
        {previewError && <p role="alert" className="text-xs text-red-300">{previewError}</p>}
        {pending.kind !== 'ppwr' && preview?.manualCount > 0 && (
          <div className="border border-indigo-500/30 bg-indigo-500/5 rounded-lg p-3 space-y-2">
            <Check checked={keep} onChange={setKeep}>{t('Zachowaj {count} rekordów dodanych / edytowanych ręcznie (nadpiszą dane z pliku)', { count: preview.manualCount })}</Check>
            <div className="text-[11px] text-zinc-500 pl-5">{t('Przy przywracaniu kopii zapasowej zwykle zostaw odznaczone.')}</div>
          </div>
        )}
        <p className="text-[11px] text-zinc-500">{t('Przed importem serwer automatycznie zapisze kopię obecnej bazy (menu „Kopia zapasowa”).')}</p>
      </div>
    </Modal>
  );
}
