import { useMemo, useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Play, FileSpreadsheet, Eraser, CheckCheck, Copy, Plus, Pencil, AlertTriangle, Info, Settings2 } from 'lucide-react';
import RCDDB from '../../lib/rcddb.js';
import { BY_ID, ALL } from '../../lib/substances.js';
import { parseBom, analyse, bomReport, CRIT } from '../../lib/rcd.js';
import { SRCL, UL, cx, readBuf, copyText } from '../../lib/utils.js';
import { Chip, SrcChip, Check, Modal } from '../ui/index.jsx';
import { btnGhost, btnPrimary, btnSuccess, panel } from '../ui/styles.js';
import { useI18n } from '../../lib/i18n-context.js';

const BOMOPT = 'bomcheckRcdBomOpt_v1';
const BOMOPEN = 'bomcheckRcdBomOpen';
const DEF_OPTS = { src: ['d', 'o', 'i', 'p'], pfasU: false, pipU: false, mode: 'replace' };
const SRC_DESC = {
  d: 'kolumny statusów / materiałów',
  o: 'materiał wprost w DESC (PVC, PTFE, GOLD, STEEL…)',
  i: 'typ elementu (kabel → Cu, H05VV/LiYY/UL1007 → PVC, RG316 → PTFE)',
  p: '„may/might/possible/???” u dostawcy',
};
const shortName = id => (BY_ID[id] ? BY_ID[id].n.split(' – ')[0].split(' (')[0] : id);

export default function BomPanel({ db, sel, onApply, onAddCrit, onEditRecord, onNewRecord, notify }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(() => localStorage.getItem(BOMOPEN) === '1');
  const [text, setText] = useState('');
  const [analysed, setAnalysed] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opts, setOpts] = useState(() => {
    try { return { ...DEF_OPTS, ...JSON.parse(localStorage.getItem(BOMOPT) || '{}') }; } catch { return DEF_OPTS; }
  });
  useEffect(() => { localStorage.setItem(BOMOPT, JSON.stringify(opts)); }, [opts]);
  useEffect(() => { localStorage.setItem(BOMOPEN, open ? '1' : '0'); }, [open]);

  const LOOK = useMemo(() => (db ? RCDDB.index(db) : null), [db]);
  const P = useMemo(() => (analysed && LOOK ? parseBom(analysed, LOOK) : null), [analysed, LOOK]);
  const A = useMemo(() => (P ? analyse(P, opts, db) : null), [P, opts, db]);

  const setOpt = (k, v) => setOpts(o => ({ ...o, [k]: v }));
  const toggleSrc = (s, on) => setOpts(o => ({ ...o, src: on ? [...new Set([...o.src, s])] : o.src.filter(x => x !== s) }));

  const onFile = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const buf = await readBuf(f);
      let t;
      if (/\.xlsx?$/i.test(f.name)) {
        const XLSX = await import('@e965/xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        t = wb.SheetNames.map(n =>
          XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false })
            .map(row => row.join('\t'))
            .join('\n'),
        ).join('\n');
      } else t = RCDDB.decode(buf).replace(/[;,]/g, '\t');
      setText(t); setAnalysed(t); setOpen(true);
    } catch (error) {
      notify(t('Nie udało się odczytać pliku BOM: {error}', { error: error.message }), 'error');
    }
  };

  const ids = A ? Object.keys(A.agg).sort((a, b) => ALL.indexOf(BY_ID[a]) - ALL.indexOf(BY_ID[b])) : [];
  const cids = A ? Object.keys(A.crit) : [];
  const nU = k => A.rows.filter(r => (r.it.u || []).includes(k)).length;
  const warnRows = A ? A.rows.filter(r => (r.it.w || []).length) : [];

  return (
    <section className={panel}>
      <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap gap-3 items-center">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 font-semibold text-sm text-white">
          {open ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
          {t('BOM → automatyczne zaznaczenie')}
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)} className={`${btnGhost} ml-auto`}>
          <Settings2 size={14} /> {t('Ustawienia')}
        </button>
        {A && !open && <span className="text-xs text-zinc-500">{t('ostatnia analiza: {found} rozpoznanych, {missing} spoza bazy', { found: P.found.length, missing: P.nf.length })}</span>}
      </div>

      {open && (
        <div className="p-4 grid lg:grid-cols-5 gap-4">
          {/* wejście + opcje */}
          <div className="lg:col-span-2 space-y-3">
            <textarea value={text} onChange={e => setText(e.target.value)}
              className="w-full h-44 font-mono text-xs bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
              placeholder={t('Wklej BOM z Excela (całe wiersze lub sama kolumna z numerami surowców).\nRozpoznaje ITEM, ITEM bez zer wiodących/separatorów oraz numery z EXTRA DESC (np. PHLP 12NC).\n\n0015 903\n0-0165536-1\n0051001')} />
            <div className="flex flex-wrap gap-2 items-center">
              <button className={btnPrimary} onClick={() => setAnalysed(text)} disabled={!text.trim()}><Play size={14} /> {t('Analizuj BOM')}</button>
              <label className={cx(btnGhost, 'cursor-pointer')}><FileSpreadsheet size={14} /> {t('Plik BOM (xlsx/csv)')}
                <input type="file" accept=".xlsx,.xls,.csv,.txt" hidden onChange={onFile} /></label>
              <button className={btnGhost} onClick={() => { setText(''); setAnalysed(''); }}><Eraser size={14} /> {t('Wyczyść')}</button>
            </div>
          </div>

          {/* wyniki */}
          <div className="lg:col-span-3 space-y-3 min-w-0">
            {!A && <div className="text-sm text-zinc-500 flex items-center gap-2"><Info size={14} /> {t('Wklej BOM i kliknij „Analizuj BOM”.')}</div>}
            {A && (
              <>
                <div className="flex flex-wrap gap-2 items-center">
                  <Chip className="bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 !text-xs">{t('rozpoznane:')} {P.found.length}</Chip>
                  {P.nf.length > 0 && <Chip className="bg-red-500/15 text-red-300 ring-red-500/30 !text-xs">{t('nie ma w bazie:')} {P.nf.length}</Chip>}
                  {['rohs', 'svhc', 'pfas', 'pip'].map(k => nU(k) ? <Chip key={k}>{t('brak')} {UL[k]}: {nU(k)}</Chip> : null)}
                  <div className="ml-auto flex gap-2">
                    <button className={btnSuccess} onClick={() => onApply(A, opts.mode)} disabled={!ids.length}><CheckCheck size={14} /> {t('Zastosuj do ankiety ({count})', { count: ids.length })}</button>
                    <button className={btnGhost} onClick={async () => { await copyText(bomReport(P, A, language)); notify(t('Raport skopiowany – wklej do Excela.')); }}><Copy size={14} /> {t('Kopiuj raport')}</button>
                  </div>
                </div>

                {P.nf.length > 0 && (
                  <div className="text-xs bg-red-500/5 border border-red-500/30 rounded-lg p-2.5">
                    <div className="font-semibold text-red-300 mb-1.5">{t('Nie znaleziono w bazie – kliknij, aby dodać rekord:')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {P.nf.map(x => (
                        <button key={x} onClick={() => onNewRecord({ i: x })} title={t('Dodaj nowy rekord z tym ITEM')}
                          className="inline-flex items-center gap-1 font-mono text-[11px] bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-indigo-500 rounded-md px-2 py-0.5 text-zinc-300">
                          <Plus size={11} className="text-indigo-400" />{x}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-zinc-800">
                  <div className="px-3 py-2 bg-zinc-950/50 text-xs font-semibold border-b border-zinc-800 text-zinc-300">{t('Substancje do zaznaczenia')}</div>
                  <div className="p-2 space-y-1 text-xs">
                    {ids.length ? ids.map(id => {
                      const L = A.agg[id]; const srcs = [...new Set(L.map(x => x.s))]; const keys = [...new Set(L.map(x => x.k))];
                      return (
                        <div key={id} className="flex gap-2 items-start">
                          <span className="w-56 shrink-0 font-medium text-zinc-200">{language === 'en' ? BY_ID[id].en || BY_ID[id].n : BY_ID[id].n}</span>
                          <span className="shrink-0 flex gap-1">{srcs.map(s => <SrcChip key={s} s={s} />)}</span>
                          <span className="text-zinc-500 truncate" title={L.map(x => x.k + ' – ' + x.ev).join('\n')}>{L.length} {t('poz.')}: {keys.slice(0, 6).join(', ')}{keys.length > 6 ? '…' : ''}</span>
                        </div>
                      );
                    }) : <div className="text-zinc-500">{t('Brak substancji z wybranych źródeł.')}</div>}
                  </div>
                </div>

                {cids.length > 0 && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs space-y-1.5">
                    <div className="font-semibold text-red-300 flex items-center gap-1.5"><AlertTriangle size={14} /> {t('Wymaga decyzji – „No” oznacza niezgodność (nie zaznaczam automatycznie)')}</div>
                    {cids.map(id => (
                      <div key={id} className="flex gap-2 items-center">
                        <span className="w-56 shrink-0 font-medium text-zinc-200">{language === 'en' ? BY_ID[id].en || BY_ID[id].n : BY_ID[id].n}</span>
                        <span className="truncate text-zinc-400" title={A.crit[id].map(x => x.k + ' – ' + x.ev).join('\n')}>{A.crit[id].map(x => x.k + ' (' + x.ev + ')').join('; ')}</span>
                        <button onClick={() => onAddCrit(id, [...new Set(A.crit[id].map(x => x.k))])}
                          className="ml-auto shrink-0 px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-500 text-white font-semibold">{sel.has(id) ? `✔ ${t('dodane')}` : t('dodaj')}</button>
                      </div>
                    ))}
                  </div>
                )}

                {warnRows.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
                    <div className="font-semibold text-amber-300 mb-1">{t('Uwagi z bazy')}</div>
                    {warnRows.map(r => <div key={r.f.k} className="text-zinc-400"><span className="font-mono text-zinc-300">{r.it.i}</span>: {r.it.w.join(' · ')}</div>)}
                  </div>
                )}

                <details className="rounded-lg border border-zinc-800" open={A.rows.length <= 40}>
                  <summary className="px-3 py-2 bg-zinc-950/50 text-xs font-semibold cursor-pointer text-zinc-300">{t('Szczegóły pozycji BOM ({count})', { count: A.rows.length })}</summary>
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-900 sticky top-0 text-zinc-500">
                        <tr className="text-left"><th className="px-2 py-1.5">ITEM</th><th className="px-2 py-1.5">{t('Opis (DESC)')}</th><th className="px-2 py-1.5">{t('Substancje')}</th><th className="px-2 py-1.5">{t('RoHS wyj.')}</th><th className="px-2 py-1.5">{t('Braki')}</th><th /></tr>
                      </thead>
                      <tbody>
                        {A.rows.map(r => (
                          <tr key={r.f.k} className="border-t border-zinc-800 align-top hover:bg-zinc-800/30">
                            <td className="px-2 py-1.5 font-mono whitespace-nowrap text-zinc-200">{r.it.i}
                              {r.f.via !== 'ITEM' && <div className="text-[10px] text-zinc-500">{r.f.via}: {r.f.tok}</div>}
                              {r.f.n > 1 && <div className="text-[10px] text-zinc-500">×{r.f.n} w BOM</div>}
                            </td>
                            <td className="px-2 py-1.5 text-zinc-300">{r.it.d || ''}<div className="text-[10px] text-zinc-500">{[r.it.sup, r.it.dt].filter(Boolean).join(' · ')}</div></td>
                            <td className="px-2 py-1.5"><div className="flex flex-wrap gap-0.5">
                              {r.used.map(([id, s, ev]) => (
                                <Chip key={id} title={SRCL[s][0] + ': ' + ev} className={CRIT.has(id) ? 'bg-red-500/20 text-red-200 ring-red-500/50' : SRCL[s][1]}>{shortName(id)}{s === 'p' ? '?' : ''}</Chip>
                              ))}
                              {r.skipped.length > 0 && <span className="text-[10px] text-zinc-500" title={r.skipped.map(x => x[0] + ' – ' + x[2]).join('\n')}> +{r.skipped.length} {t('pominięte')}</span>}
                              {!r.used.length && !r.skipped.length && <span className="text-zinc-600">—</span>}
                            </div></td>
                            <td className="px-2 py-1.5 whitespace-nowrap">{(r.it.ex || []).join(', ')}</td>
                            <td className="px-2 py-1.5"><div className="flex flex-wrap gap-0.5">{(r.it.u || []).map(k => <Chip key={k}>{UL[k]}</Chip>)}</div></td>
                            <td className="px-2 py-1.5"><button onClick={() => onEditRecord(r.f.k)} title={t('Edytuj rekord')} className="p-1 rounded text-zinc-500 hover:text-indigo-300 hover:bg-zinc-800"><Pencil size={13} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        </div>
      )}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t('Ustawienia automatycznego zaznaczania')}
        icon={<Settings2 size={16} className="text-indigo-300" />}
      >
        <div className="space-y-4 text-xs bg-zinc-950/60 border border-zinc-800 rounded-lg p-3">
          <div className="font-semibold text-zinc-300">{t('Uwzględniaj trafienia z:')}</div>
          {['d', 'o', 'i', 'p'].map(s => (
            <Check key={s} checked={opts.src.includes(s)} onChange={v => toggleSrc(s, v)}>
              <SrcChip s={s} /> <span className="text-zinc-400">{t(SRC_DESC[s])}</span>
            </Check>
          ))}
          <div className="font-semibold text-zinc-300 pt-1">{t('Braki danych w bazie:')}</div>
          <Check checked={opts.pfasU} onChange={v => setOpt('pfasU', v)}>{t('PFAS nieznany → BOMcheck PFAS = Missing')}</Check>
          <Check checked={opts.pipU} onChange={v => setOpt('pipU', v)}>{t('PIP (3:1) nieznany → TSCA = Missing')}</Check>
          <div className="font-semibold text-zinc-300 pt-1">{t('Zastosowanie:')}</div>
          {[['replace', 'zastąp obecne zaznaczenie'], ['add', 'dodaj do obecnego zaznaczenia']].map(([v, l]) => (
            <label key={v} className="flex gap-2 items-center cursor-pointer text-zinc-300">
              <input type="radio" name="bomMode" className="accent-indigo-500" checked={opts.mode === v} onChange={() => setOpt('mode', v)} /> {t(l)}
            </label>
          ))}
        </div>
      </Modal>
    </section>
  );
}
