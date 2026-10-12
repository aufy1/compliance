import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check as CheckIcon, Bookmark, Lightbulb, Terminal, List, Settings2 } from 'lucide-react';
import runnerSrc from '../../lib/runner.js?raw';
import { targets, bySection, listText } from '../../lib/rcd.js';
import { BY_ID, SECCOL } from '../../lib/substances.js';
import { SECSTYLE, cx, copyText } from '../../lib/utils.js';
import { Check, Segmented, AnswerBadge, Chip, Modal } from '../ui/index.jsx';
import { panel, btnGhost, btnSuccess } from '../ui/styles.js';
import { useI18n } from '../../lib/i18n-context.js';

const GENOPT = 'bomcheckRcdGenOpt_v1';
const DEF = { fillYes: true, overwrite: false, expand: true, socManual: true, exManual: true, mode: 'fill' };

export default function Generator({ sel }) {
  const { t: tr, language } = useI18n();
  const [o, setO] = useState(() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(GENOPT) || '{}') }; } catch { return DEF; } });
  const [tab, setTab] = useState('script');
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bmRef = useRef(null);
  useEffect(() => { localStorage.setItem(GENOPT, JSON.stringify(o)); }, [o]);
  const set = k => v => setO(p => ({ ...p, [k]: v }));

  const T = useMemo(() => targets(sel), [sel]);
  const S = useMemo(() => bySection(T), [T]);
  const code = useMemo(() => {
    const targets = T.map(t => {
      const target = { ...t };
      delete target.src;
      return target;
    });
    const cfg = { ...o, targets };
    return '(' + runnerSrc.trim() + ')(' + JSON.stringify(cfg) + ');';
  }, [o, T]);
  const bmUrl = 'javascript:' + encodeURIComponent(code);
  const out = tab === 'script' ? code : tab === 'bm' ? bmUrl : listText(S, language);

  // React blokuje href="javascript:…" – ustawiamy atrybut bezpośrednio w DOM
  useEffect(() => { if (bmRef.current) bmRef.current.setAttribute('href', bmUrl); }, [bmUrl, tab]);

  const doCopy = async () => { await copyText(out); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div className={cx(panel, 'p-4 space-y-3')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-white">{tr('Generator polecenia')}</h2>
        <button type="button" onClick={() => setSettingsOpen(true)} className={btnGhost}>
          <Settings2 size={14} /> {tr('Ustawienia')}
        </button>
      </div>

      <Segmented value={tab} onChange={setTab} options={[
        { value: 'script', icon: <Terminal size={14} />, label: tr('Skrypt (Console)') },
        { value: 'bm', icon: <Bookmark size={14} />, label: tr('Bookmarklet') },
        { value: 'list', icon: <List size={14} />, label: tr('Lista ręczna') },
      ]} />

      {tab !== 'list' ? (
        <textarea readOnly value={out} className="w-full h-56 font-mono text-[11px] bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-400 focus:outline-none" />
      ) : (
        <div className="space-y-3">
          {!S.length && <p className="text-sm text-zinc-500">{tr('Nic nie zaznaczono.')}</p>}
          {S.map(g => {
            const [box, head] = SECSTYLE[SECCOL[g.s]] || SECSTYLE.slate;
            const socCas = g.s === 'soc' ? [...new Set(g.rows.flatMap(t => t.cas))] : [];
            return (
              <div key={g.s} className={cx('rounded-lg border overflow-hidden', box)}>
                <div className={cx('px-3 py-1.5 text-xs font-semibold flex justify-between', head)}><span>{g.name}</span><span className="font-normal">{g.rows.length} poz.</span></div>
                <table className="w-full text-xs"><tbody>
                  {g.rows.map(t => (
                    <tr key={t.x} className="border-t border-zinc-800">
                      <td className="px-3 py-1.5 align-top text-zinc-200">{t.x}{t.m === 'prefix' ? '…' : ''}<div className="text-[10px] text-zinc-500">{t.src.map(id => language === 'en' ? BY_ID[id]?.en || id : BY_ID[id]?.n || id).join('; ')}</div></td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap"><AnswerBadge a={t.a} /></td>
                      <td className="px-2 py-1.5 align-top font-mono text-[11px] text-zinc-400">{t.cas.length ? t.cas.map(c => <div key={c}>{c}</div>) : <span className="text-zinc-600">— grupa</span>}</td>
                    </tr>
                  ))}
                </tbody></table>
                {socCas.length > 0 && <div className="bg-fuchsia-500/10 border-t border-fuchsia-500/30 px-3 py-2 text-xs text-zinc-300"><b>{tr('CAS do wpisania w oknie SoC:')}</b> <span className="font-mono">{socCas.join(', ')}</span></div>}
              </div>
            );
          })}
          {S.length > 0 && <p className="text-xs text-zinc-500">{tr('Wszystkie pozostałe pozycje:')} <Chip className="bg-emerald-500/15 text-emerald-300 ring-emerald-500/30">Yes</Chip></p>}
        </div>
      )}

      <div className="flex gap-2 items-center flex-wrap">
        <button onClick={doCopy} className={btnSuccess}>{copied ? <CheckIcon size={14} /> : <Copy size={14} />} {copied ? tr('Skopiowano') : tr('Kopiuj')}</button>
        {tab === 'bm' && (
          <a ref={bmRef} onClick={e => e.preventDefault()} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-grab" title={tr('Przeciągnij na pasek zakładek')}>
            <Bookmark size={14} /> {tr(o.mode === 'fill' ? 'RCD WYPEŁNIJ – przeciągnij na pasek' : 'RCD PODGLĄD – przeciągnij na pasek')}
          </a>
        )}
        {tab === 'list' && <span className="text-[11px] text-zinc-500">{tr('kopiuje listę jako tekst (wkleja się do Excela)')}</span>}
      </div>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title={tr('Ustawienia generatora')} icon={<Settings2 size={16} className="text-indigo-300" />}>
        <div className="space-y-4">
          <div className="space-y-3">
            <Check checked={o.fillYes} onChange={set('fillYes')}>{tr('Pozostałe puste wiersze → „Yes”')}</Check>
            <Check checked={o.overwrite} onChange={set('overwrite')}>{tr('Nadpisz już zaznaczone (ostrożnie)')}</Check>
            <Check checked={o.expand} onChange={set('expand')}>{tr('Rozwiń wszystkie sekcje')}</Check>
          </div>
          <div className="space-y-3 border-t border-zinc-800 pt-4">
            <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{tr('Wyskakujące okna po „No”')}</div>
            <Check checked={o.socManual} onChange={set('socManual')}>{tr('SoC: zatrzymaj i daj mi wpisać CAS')}</Check>
            <Check checked={o.exManual} onChange={set('exManual')}>{tr('No (but Exempt): zatrzymaj i daj mi wybrać wyjątek')}</Check>
            <p className="text-[11px] text-zinc-500">{tr('Pozostałe okna: skrypt klika „Concentration not known?” → „Save”. Jeśli okno się nie zamknie, zatrzyma się i poczeka na Ciebie.')}</p>
          </div>
          <label className="block text-xs text-zinc-400">{tr('Tryb')}
            <select value={o.mode} onChange={e => set('mode')(e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500">
              <option value="fill">{tr('WYPEŁNIJ – klika przyciski Yes/No')}</option>
              <option value="preview">{tr('PODGLĄD – tylko obrysuje przyciski, bez zmian')}</option>
            </select>
          </label>
          <div className="border-t border-zinc-800 pt-3">
            <button type="button" onClick={() => setHint(h => !h)} className="text-xs text-indigo-400 hover:underline flex items-center gap-1">
              <Lightbulb size={12} /> {hint ? tr('Ukryj wskazówkę') : tr('Wyświetl wskazówkę')}
            </button>
            {hint && (
              <ol className="mt-3 text-xs text-zinc-400 bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 pl-7 list-decimal space-y-0.5">
                <li>{tr('Zaznacz substancje lub wybierz profil.')}</li>
                <li>{tr('W BOMcheck otwórz stronę z sekcjami RCD.')}</li>
                <li>{tr('F12 → Console → wklej → Enter (Edge/Chrome: najpierw wpisz')} <code className="text-zinc-200">allow pasting</code>).</li>
                <li>{tr('WYPEŁNIJ klika przyciski. PODGLĄD tylko obrysowuje przycisk, który zostałby kliknięty.')}</li>
                <li>Gdy pojawi się granatowy pasek „RCD helper czeka”, uzupełnij okno (CAS / wyjątek) i kliknij Save – skrypt ruszy dalej sam. „Przerwij” zatrzymuje całość.</li>
              </ol>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
