import { useRef, useState } from 'react';
import { Archive, Database, FileJson, FileSpreadsheet, ListChecks, RefreshCw, Settings, ShieldCheck, Trash2, X } from 'lucide-react';
import { cx } from '../lib/utils.js';
import { useI18n } from '../lib/i18n-context.js';

const navItems = [
  { value: 'helper', label: 'Ankieta RCD', icon: ListChecks },
  { value: 'db', label: 'Baza materiałów', icon: Database },
  { value: 'backups', label: 'Kopie zapasowe', icon: Archive },
];

export default function Header({ view, setView, meta, onImportCsv, onImportJson, onReload, onClearDatabase }) {
  const csvRef = useRef(null);
  const jsonRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { language, setLanguage, t } = useI18n();
  const pickFile = callback => event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) {
      setSettingsOpen(false);
      callback(file);
    }
  };
  const clearDatabase = async () => {
    const count = meta?.n || 0;
    if (!window.confirm(t('Wyczyścić wszystkie rekordy ({count})? Najpierw zostanie utworzona kopia zapasowa.', { count }))) return;
    setClearing(true);
    try {
      await onClearDatabase();
    } finally {
      setClearing(false);
    }
  };

  return (
    <aside className="w-full md:w-64 lg:w-72 md:h-screen md:sticky md:top-0 shrink-0 border-b md:border-b-0 md:border-r border-zinc-700 bg-zinc-900 flex flex-col">
      <div className="p-5">
        <div className="flex items-center gap-3 text-white font-bold tracking-tight text-lg">
          <span className="h-10 w-10 rounded-xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center"><ShieldCheck size={22} /></span>
          <span>Compliance RCD</span>
        </div>
      </div>

      <nav className="px-3" aria-label={t('Menu')}>
        <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t('Menu')}</div>
        <div className="space-y-1">
          {navItems.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" onClick={() => setView(value)} aria-current={view === value ? 'page' : undefined}
              className={cx('w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                view === value ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100')}>
              <Icon size={17} className={view === value ? 'text-indigo-300' : 'text-zinc-500'} /> {t(label)}
            </button>
          ))}
        </div>
      </nav>

      <div className="mt-auto p-3">
        <button type="button" onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white">
          <Settings size={16} /> {t('Ustawienia')}
        </button>
        {meta && <div className="mt-2 border-t border-zinc-800 px-3 pt-3 text-xs text-zinc-500">
          {meta.n.toLocaleString(language === 'en' ? 'en-US' : 'pl-PL')} {t('rekordów')}
        </div>}
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="settings-title" className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <h2 id="settings-title" className="font-semibold text-zinc-100">{t('Ustawienia aplikacji')}</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label={t('Zamknij')} className="text-zinc-400 hover:text-white"><X size={18} /></button>
            </header>
            <div className="space-y-5 p-5">
              <label className="block space-y-1.5 text-sm text-zinc-300">
                <span>{t('Wybierz język')}</span>
                <select value={language} onChange={event => setLanguage(event.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100">
                  <option value="pl">Polski</option>
                  <option value="en">English</option>
                </select>
              </label>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <h3 className="mb-3 text-sm font-semibold text-zinc-200">{t('Aktualnie wczytana baza')}</h3>
                <div className="space-y-1 text-sm text-zinc-400">
                  <div>{t('Liczba rekordów')}: <b className="text-zinc-100">{meta?.n?.toLocaleString(language === 'en' ? 'en-US' : 'pl-PL') ?? '—'}</b></div>
                  <div>{t('Źródło bazy')}: <span className="break-all text-zinc-300">{meta?.src || '—'}</span></div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 p-4">
                <h3 className="mb-3 text-sm font-semibold text-zinc-200">{t('Wczytywanie bazy')}</h3>
                <input ref={csvRef} type="file" accept=".csv,.txt" hidden onChange={pickFile(onImportCsv)} />
                <input ref={jsonRef} type="file" accept=".json" hidden onChange={pickFile(onImportJson)} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={onReload} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                    <RefreshCw size={14} /> {t('Odśwież bazę')}
                  </button>
                  <button type="button" onClick={() => csvRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                    <FileSpreadsheet size={14} className="text-emerald-300" /> CSV
                  </button>
                  <button type="button" onClick={() => jsonRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                    <FileJson size={14} className="text-amber-300" /> JSON
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                <h3 className="mb-2 text-sm font-semibold text-red-200">{t('Strefa niebezpieczna')}</h3>
                <p className="mb-3 text-xs leading-relaxed text-zinc-400">{t('Wszystkie rekordy materiałów zostaną usunięte. Serwer utworzy kopię zapasową przed wyczyszczeniem bazy.')}</p>
                <button type="button" onClick={clearDatabase} disabled={clearing}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50">
                  <Trash2 size={14} /> {clearing ? t('Czyszczenie…') : t('Wyczyść bazę')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
