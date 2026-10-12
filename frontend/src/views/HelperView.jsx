import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { PRESETS } from '../lib/substances.js';
import { countHits } from '../lib/rcd.js';
import { cx } from '../lib/utils.js';
import { panel, input } from '../components/ui/styles.js';
import BomPanel from '../components/helper/BomPanel.jsx';
import SubstanceList from '../components/helper/SubstanceList.jsx';
import Generator from '../components/helper/Generator.jsx';
import { useI18n } from '../lib/i18n-context.js';

const LS = 'bomcheckRcdHelper_v11';
const PRESET_BTNS = [
  ['typical', 'Kabel PVC + styki z Pb'],
  ['pvcnopb', 'Kabel PVC bez ołowiu'],
  ['lszh', 'LSZH / halogen-free'],
  ['coax', 'Koncentryk PTFE/FEP'],
];
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };

export default function HelperView({ db, onEditRecord, onNewRecord, notify }) {
  const { t } = useI18n();
  const [sel, setSel] = useState(() => new Set(load().sel || []));
  const [bomBy, setBomBy] = useState(() => load().bom || {});
  const [search, setSearch] = useState('');
  const groupsRef = useRef(null);
  const counts = useMemo(() => countHits(db), [db]);

  useEffect(() => {
    const bom = Object.fromEntries(Object.entries(bomBy).filter(([k]) => sel.has(k)));
    localStorage.setItem(LS, JSON.stringify({ sel: [...sel], bom }));
  }, [sel, bomBy]);

  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const preset = name => { setSel(new Set(PRESETS[name])); setBomBy({}); };

  const applyBom = (A, mode) => {
    setSel(prev => { const n = mode === 'replace' ? new Set() : new Set(prev); Object.keys(A.agg).forEach(id => n.add(id)); return n; });
    setBomBy(prev => {
      const b = mode === 'replace' ? {} : { ...prev };
      Object.entries(A.agg).forEach(([id, L]) => { b[id] = [...new Set([...(b[id] || []), ...L.map(x => x.k)])]; });
      return b;
    });
    setTimeout(() => groupsRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };
  const addCrit = (id, keys) => { setSel(s => new Set([...s, id])); setBomBy(b => ({ ...b, [id]: keys })); };

  return (
    <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-4">
      <BomPanel db={db} sel={sel} onApply={applyBom} onAddCrit={addCrit} onEditRecord={onEditRecord} onNewRecord={onNewRecord} notify={notify} />

      <section ref={groupsRef} className={cx(panel, 'p-3 flex flex-wrap gap-2 items-center scroll-mt-4')}>
        <span className="text-xs font-semibold text-zinc-400 mr-1 uppercase tracking-wider">{t('Profil')}</span>
        {PRESET_BTNS.map(([k, l], idx) => (
          <button key={k} onClick={() => preset(k)}
            className={cx('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
              idx === 0 ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500' : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30')}>{t(l)}</button>
        ))}
        <button onClick={() => preset('clear')} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700">{t('Wyczyść')}</button>
        <span className="text-xs text-zinc-500 ml-2">{t('zaznaczono:')} <b className="text-zinc-300">{sel.size}</b></span>
        <div className="relative ml-auto w-full sm:w-80">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Szukaj: PL / EN / CAS (np. złoto, gold, 7440-57-5)…')} className={cx(input, 'pl-9 pr-8')} />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"><X size={14} /></button>}
        </div>
      </section>

      <div className="grid lg:grid-cols-5 gap-4 items-start">
        <section className="lg:col-span-3 space-y-4">
          <SubstanceList sel={sel} toggle={toggle} bomBy={bomBy} search={search} counts={counts} />
        </section>
        <aside className="lg:col-span-2 lg:sticky lg:top-4">
          <Generator sel={sel} />
        </aside>
      </div>
    </div>
  );
}
