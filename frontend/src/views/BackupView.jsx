import { useEffect, useState } from 'react';
import { Archive, Download, FileJson, FileSpreadsheet, Loader2, RefreshCw, Server, Trash2 } from 'lucide-react';
import { api, backupFileUrl } from '../api.js';
import { fmtSize } from '../lib/utils.js';
import { btnGhost, btnPrimary, panel } from '../components/ui/styles.js';
import { useI18n } from '../lib/i18n-context.js';
import { reachCompliance } from '../lib/rcd.js';

export default function BackupView({ notify }) {
  const { t, language } = useI18n();
  const [backups, setBackups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const downloadDatabaseCsv = async () => {
    try {
      const database = await api.db();
      const records = Object.entries(database.items || {});
      const preferredColumns = [
        ['RECORD_KEY', row => row.key],
        ['ITEM', row => row.item.i],
        ['DESC', row => row.item.d],
        [t('Dostawca'), row => row.item.sup],
        ['ROHS', row => row.item.r],
        ['REACH_COMPLIANT', row => reachCompliance(row.item)],
        ['REACH_LIST_VERSION', row => row.item.rn],
        ['DATE', row => row.item.dt],
        ['SUBSTANCES_JSON', row => row.item.h],
        ['EXCEPTIONS_JSON', row => row.item.ex],
        ['MISSING_JSON', row => row.item.u],
        ['WARNINGS_JSON', row => row.item.w],
        ['ALIASES_JSON', row => row.item.al],
        ['MODIFIED_AT', row => row.item.mod],
        ['DUPLICATES', row => row.item.dup],
      ];
      const known = new Set(['i', 'd', 'a', 'sup', 'r', 'rc', 're', 'rs', 'rn', 'rr', 'rv', 'reach', 'reachStatus', 'dt', 'h', 'ex', 'u', 'w', 'al', 'mod', 'dup']);
      const extraKeys = [...new Set(records.flatMap(([, item]) => Object.keys(item).filter(key => !known.has(key))))].sort();
      const columns = [
        ...preferredColumns,
        ...extraKeys.map(key => [key.toUpperCase(), row => row.item[key]]),
      ];
      const rows = [
        columns.map(([label]) => label),
        ...records.map(([key, item]) => columns.map(([, value]) => {
          const cell = value({ key, item });
          return cell == null ? '' : typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
        })),
      ];
      const csv = `\uFEFF${rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `material_db_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const refreshBackups = async () => {
    try {
      setBackups(await api.listBackups());
    } catch (error) {
      setBackups([]);
      notify(error.message, 'error');
    }
  };

  useEffect(() => {
    let active = true;
    api.listBackups()
      .then(data => { if (active) setBackups(data); })
      .catch(error => {
        if (active) {
          setBackups([]);
          notify(error.message, 'error');
        }
      });
    return () => { active = false; };
  }, [notify]);

  const makeServerBackup = async () => {
    setBusy(true);
    try {
      const result = await api.createBackup();
      notify(t('Utworzono kopię na serwerze: {name}', { name: result.name }));
      await refreshBackups();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteBackup = async backup => {
    if (!window.confirm(t('Usunąć kopię zapasową {name}? Tej operacji nie można cofnąć.', { name: backup.name }))) return;
    setDeleting(backup.name);
    try {
      await api.deleteBackup(backup.name);
      setBackups(current => current?.filter(item => item.name !== backup.name) ?? current);
      notify(t('Usunięto kopię {name}', { name: backup.name }));
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold text-white">{t('Kopie zapasowe')}</h1>
          <p className="mt-1 text-sm text-zinc-400">{t('Pobierz bazę lub utwórz kopię przechowywaną na serwerze.')}</p>
        </div>
        <button type="button" onClick={refreshBackups} className={btnGhost}>
          <RefreshCw size={14} /> {t('Odśwież')}
        </button>
      </header>

      <section className={`${panel} mb-5 flex flex-wrap items-center gap-3 p-4`}>
        <span className="mr-auto text-sm font-medium text-zinc-200">{t('Pobierz aktualną bazę:')}</span>
        <a href="/api/backup" download className={btnGhost}>
          <FileJson size={15} /> JSON
        </a>
        <button type="button" onClick={downloadDatabaseCsv} className={btnGhost}>
          <FileSpreadsheet size={15} /> CSV
        </button>
      </section>

      <section className={`${panel} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="mr-auto flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Archive size={16} className="text-indigo-300" />
            {t('Zapisane kopie')}
            {backups && <span className="text-xs font-normal text-zinc-500">({backups.length})</span>}
          </div>
          <button type="button" onClick={makeServerBackup} disabled={busy} className={btnPrimary}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Server size={15} />}
            {t('Utwórz kopię')}
          </button>
        </div>
        {backups === null && (
          <div className="flex items-center gap-2 p-5 text-sm text-zinc-400">
            <Loader2 size={16} className="animate-spin" /> {t('Wczytywanie kopii…')}
          </div>
        )}
        {backups?.length === 0 && (
          <p className="p-5 text-sm text-zinc-400">{t('Nie ma jeszcze kopii zapasowych na serwerze.')}</p>
        )}
        {backups?.length > 0 && (
          <ul className="divide-y divide-zinc-800">
            {backups.map(backup => (
              <li key={backup.name} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
                  <Archive size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-200" title={backup.name}>{backup.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{new Date(backup.mtime).toLocaleString(language === 'en' ? 'en-US' : 'pl-PL')} · {fmtSize(backup.size)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a href={backupFileUrl(backup.name)} download aria-label={`${t('Pobierz kopię')} ${backup.name}`} className={btnGhost}>
                    <Download size={14} /> <span className="hidden sm:inline">{t('Pobierz')}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => deleteBackup(backup)}
                    disabled={deleting !== null}
                    aria-label={`${t('Usuń kopię')} ${backup.name}`}
                    title={t('Usuń kopię')}
                    className="inline-flex items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                  >
                    {deleting === backup.name
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Trash2 size={14} />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
