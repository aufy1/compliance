import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Sparkles, Save, Loader2, AlertTriangle, ExternalLink, CalendarDays } from 'lucide-react';
import RCDDB from '../../lib/rcddb.js';
import { ASSIGNABLE_GROUPS, BY_ID } from '../../lib/substances.js';
import { api } from '../../api.js';
import { SRCL, UL, cx, keyN } from '../../lib/utils.js';
import { Modal, TagInput } from '../ui/index.jsx';
import { input, btnGhost, btnPrimary, btnDanger } from '../ui/styles.js';
import { useI18n } from '../../lib/i18n-context.js';
import { reachCompliance, reachVersion } from '../../lib/rcd.js';

let uid = 0;
const toForm = it => ({
  i: it.i || '', d: it.d || '', sup: it.sup || '', r: it.r || '',
  rc: reachCompliance(it) == null ? '' : String(reachCompliance(it)),
  rn: reachVersion(it), dt: it.dt || '',
  h: Object.entries(it.h || {}).map(([id, [s, ev]]) => ({ uid: ++uid, id, s, ev: ev || '' })),
  ex: it.ex || [], u: it.u || [], al: it.al || [], w: (it.w || []).join('\n'),
});
const fromForm = f => ({
  i: f.i.trim(), d: f.d, sup: f.sup, r: f.r,
  ...(f.rc !== '' ? { rc: f.rc === 'true' } : {}),
  ...(f.rn.trim() && Number.isFinite(Number(f.rn)) ? { rn: Number(f.rn) } : {}),
  dt: f.dt,
  h: Object.fromEntries(f.h.filter(x => x.id).map(x => [x.id, [x.s, x.ev.trim()]])),
  ex: f.ex, u: f.u, al: f.al, w: f.w.split('\n').map(s => s.trim()).filter(Boolean),
});

const Label = ({ children, hint }) => (
  <div className="text-[11px] font-semibold text-zinc-400 mb-1 flex items-center gap-2">{children}{hint && <span className="font-normal text-zinc-600">{hint}</span>}</div>
);
const SectionTitle = ({ children, right }) => (
  <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-3 mt-5 first:mt-0">
    <h3 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">{children}</h3>
    {right}
  </div>
);

export default function RecordEditor({ editing, db, onClose, onSaved, onDeleted, onOpenExisting, notify }) {
  const { t: tr, language } = useI18n();
  const isNew = !editing.key;
  const [f, setF] = useState(() => toForm(editing.item));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [substanceSearch, setSubstanceSearch] = useState({});
  const [substanceSearchOpen, setSubstanceSearchOpen] = useState({});
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const setRow = (u, patch) => setF(p => ({ ...p, h: p.h.map(x => (x.uid === u ? { ...x, ...patch } : x)) }));
  const substanceOptions = useMemo(() => ASSIGNABLE_GROUPS.flatMap(group => group.items.map(item => ({
    id: item.id,
    label: language === 'en' ? item.en || item.n : item.n,
    terms: [item.n, item.en, ...(item.cas || []), ...(item.info || []).flatMap(part => [part.n, part.en, part.cas])]
      .filter(Boolean),
  }))), [language]);
  const matchingSubstances = query => {
    const needle = query.trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!needle) return [];
    return substanceOptions.filter(option => option.terms.some(term =>
      term.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(needle)
    )).slice(0, 8);
  };

  /* podpowiedzi do pól */
  const lists = useMemo(() => {
    const sup = new Map(), r = new Map();
    const inc = (m, v) => v && m.set(v, (m.get(v) || 0) + 1);
    Object.values(db.items).forEach(it => {
      inc(sup, it.sup);
      inc(r, it.r);
    });
    const top = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(x => x[0]);
    return { sup: top(sup, 400), r: top(r, 25) };
  }, [db]);

  const newKey = keyN(f.i);
  const clash = newKey && newKey !== editing.key && db.items[newKey];
  const dupIds = f.h.map(x => x.id).filter((id, i, arr) => id && arr.indexOf(id) !== i);

  const suggest = () => {
    const cl = RCDDB.classify({ desc: f.d, rohs: f.r });
    const have = new Set(f.h.map(x => x.id));
    const add = Object.entries(cl.h).filter(([id]) => !have.has(id) && BY_ID[id]).map(([id, [s, ev]]) => ({ uid: ++uid, id, s, ev }));
    const ex = [...new Set([...f.ex, ...cl.ex])];
    setF(p => ({ ...p, h: [...p.h, ...add], ex }));
    notify(add.length || ex.length > f.ex.length
      ? tr('Dodano sugestie: {items}', { items: `${add.map(x => language === 'en' ? BY_ID[x.id].en || BY_ID[x.id].n : BY_ID[x.id].n.split(' – ')[0]).join(', ') || '—'}${ex.length > f.ex.length ? ` · ${tr('wyjątki')}: ${ex.join(', ')}` : ''}` })
      : tr('Brak nowych sugestii na podstawie opisu i statusu RoHS.'));
  };

  const save = async () => {
    setErr('');
    if (!f.i.trim()) return setErr(tr('Pole ITEM jest wymagane.'));
    if (clash) return setErr(tr('Rekord ITEM „{item}” już istnieje.', { item: db.items[newKey].i }));
    if (dupIds.length) return setErr(tr('Substancja dodana więcej niż raz: {items}', { items: [...new Set(dupIds)].map(id => language === 'en' ? BY_ID[id]?.en || BY_ID[id]?.n || id : BY_ID[id]?.n || id).join(', ') }));
    if (f.h.some(x => !x.id)) return setErr(tr('Wybierz substancję w każdym wierszu (albo usuń pusty wiersz).'));
    setBusy(true);
    try {
      const item = fromForm(f);
      const res = isNew ? await api.createItem(item) : await api.updateItem(editing.key, item, editing.item.mod);
      onSaved(res);
      notify(isNew ? tr('Dodano rekord {item}', { item: res.item.i }) : tr('Zapisano {item}', { item: res.item.i }));
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(tr('Usunąć rekord {item}?\n(Kopia dzienna bazy jest tworzona automatycznie na serwerze.)', { item: editing.item.i }))) return;
    setBusy(true);
    try { const res = await api.deleteItem(editing.key); onDeleted(editing.key, res.meta); notify(tr('Usunięto {item}', { item: editing.item.i })); onClose(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  const footer = (
    <>
      {!isNew && <button className={btnDanger} onClick={remove} disabled={busy}><Trash2 size={14} /> {tr('Usuń')}</button>}
      <div className="text-[10px] text-zinc-600 ml-2 hidden sm:block">
        {editing.item.mod && <>{tr('zmieniony ręcznie')} {new Date(editing.item.mod).toLocaleString(language === 'en' ? 'en-US' : 'pl-PL')}</>}
        {editing.item.dup > 1 && <> · w CSV ×{editing.item.dup}</>}
      </div>
      <div className="ml-auto flex gap-2">
        <button className={btnGhost} onClick={onClose}>{tr('Anuluj')}</button>
        <button className={btnPrimary} onClick={save} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {tr(isNew ? 'Dodaj rekord' : 'Zapisz zmiany')}</button>
      </div>
    </>
  );

  return (
    <Modal open wide onClose={onClose} footer={footer}
      icon={isNew ? <Plus size={16} className="text-indigo-400" /> : <Pencil size={16} className="text-indigo-400" />}
      title={isNew ? tr('Nowy rekord materiału') : <>{tr('Edycja:')} <span className="font-mono">{editing.item.i}</span></>}>
      <div onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } }}>
        {err && <div className="mb-4 text-xs bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}

        <SectionTitle>{tr('Dane podstawowe')}</SectionTitle>
        <div className="grid md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <Label>ITEM *</Label>
            <input autoFocus={isNew} className={cx(input, 'font-mono', clash && 'border-red-500')} value={f.i} onChange={e => set('i')(e.target.value)} placeholder="np. 0015903" />
            {clash && (
              <button onClick={() => onOpenExisting(newKey)} className="mt-1 text-[11px] text-red-300 hover:underline flex items-center gap-1">
                {tr('taki ITEM już istnieje – otwórz')} <ExternalLink size={11} />
              </button>
            )}
            {!isNew && newKey !== editing.key && !clash && f.i && <div className="mt-1 text-[11px] text-amber-400">{tr('zmiana numeru ITEM ({old} → {new})', { old: editing.key, new: newKey })}</div>}
          </div>
          <div className="md:col-span-2">
            <Label hint="yyyy-mm-dd">{tr('Data deklaracji')}</Label>
            <div className="flex gap-1.5">
              <input className={input} value={f.dt} onChange={e => set('dt')(e.target.value)} placeholder="2026-10-12" />
              <button type="button" title={tr('Dzisiejsza data')} className={cx(btnGhost, 'px-2.5')} onClick={() => set('dt')(new Date().toISOString().slice(0, 10))}><CalendarDays size={14} /></button>
            </div>
          </div>
          <div className="md:col-span-6">
            <Label>{tr('Opis (DESC)')}</Label>
            <input className={input} value={f.d} onChange={e => set('d')(e.target.value)} placeholder="np. CBL 2x0.75mm2 H05VV-F BLK" />
          </div>
          <div className="md:col-span-3">
            <Label>{tr('Dostawca / producent')}</Label>
            <input className={input} list="dl-sup" value={f.sup} onChange={e => set('sup')(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <Label>{tr('Status RoHS')}</Label>
            <input className={input} list="dl-r" value={f.r} onChange={e => set('r')(e.target.value)} placeholder="YES / NO / Exemption" />
          </div>
          <div className="md:col-span-3">
            <Label>{tr('REACH compliance')}</Label>
            <select className={input} value={f.rc} onChange={e => set('rc')(e.target.value)}>
              <option value="">{tr('Unknown')}</option>
              <option value="true">{tr('Compliant')}</option>
              <option value="false">{tr('Non-compliant')}</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <Label>{tr('SVHC list version')}</Label>
            <input className={input} inputMode="numeric" value={f.rn}
              onChange={e => set('rn')(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 253" />
          </div>
        </div>

        <SectionTitle right={
          <div className="flex gap-2">
            <button type="button" className={cx(btnGhost, 'py-1.5')} onClick={suggest} title={tr('Uruchamia klasyfikator z helpera na opisie i statusie RoHS')}><Sparkles size={13} className="text-amber-400" /> {tr('Sugeruj z opisu')}</button>
            <button type="button" className={cx(btnGhost, 'py-1.5')} onClick={() => setF(p => ({ ...p, h: [...p.h, { uid: ++uid, id: '', s: 'd', ev: '' }] }))}><Plus size={13} /> {tr('Dodaj substancję')}</button>
          </div>
        }>{tr('Substancje → odpowiedzi w ankiecie RCD')}</SectionTitle>
        <div className="space-y-2">
          {!f.h.length && <div className="text-xs text-zinc-500 bg-zinc-950/50 border border-dashed border-zinc-800 rounded-lg px-3 py-3">{tr('Brak substancji – element nie zaznaczy niczego w ankiecie (wszystko „Yes”).')}</div>}
          {f.h.map(x => {
            const selectedLabel = substanceOptions.find(option => option.id === x.id)?.label || x.id || '';
            const searchTerm = substanceSearch[x.uid] || '';
            const searchActive = substanceSearchOpen[x.uid] || (!x.id && Boolean(searchTerm.trim()));
            const showSuggestions = searchActive
              && searchTerm.trim()
              && searchTerm.trim().toLocaleLowerCase() !== selectedLabel.trim().toLocaleLowerCase();
            return (
            <div key={x.uid} className="grid grid-cols-12 gap-2 items-center">
              <div className={cx('relative col-span-12 sm:col-span-4', searchActive ? 'z-50' : 'z-10')}>
                <input
                  value={substanceSearchOpen[x.uid]
                    ? substanceSearch[x.uid] ?? ''
                    : selectedLabel}
                  onClick={() => {
                    if (x.id && !substanceSearchOpen[x.uid]) {
                      const selected = substanceOptions.find(option => option.id === x.id);
                      setSubstanceSearch(search => ({ ...search, [x.uid]: selected?.label || x.id }));
                      setSubstanceSearchOpen(open => ({ ...open, [x.uid]: true }));
                    }
                  }}
                  onChange={event => setSubstanceSearch(search => ({ ...search, [x.uid]: event.target.value }))}
                  readOnly={Boolean(x.id && !substanceSearchOpen[x.uid])}
                  className={x.id && !substanceSearchOpen[x.uid]
                    ? cx('w-full truncate border border-transparent bg-transparent px-0 py-2 text-xs text-indigo-300 focus:outline-none', dupIds.includes(x.id) && 'text-red-400')
                    : cx(input, dupIds.includes(x.id) && 'border-red-500')}
                  placeholder={tr('Szukaj substancji po nazwie lub CAS')}
                  autoComplete="off"
                  autoFocus={Boolean(x.id && substanceSearchOpen[x.uid])}
                />
                {showSuggestions && matchingSubstances(searchTerm).length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-56 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
                    {matchingSubstances(searchTerm).map(option => (
                      <button key={option.id} type="button" onClick={() => {
                        setRow(x.uid, { id: option.id });
                        setSubstanceSearch(search => ({ ...search, [x.uid]: '' }));
                        setSubstanceSearchOpen(open => ({ ...open, [x.uid]: false }));
                      }} className="block w-full rounded-md px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800">
                        <span className="block">{option.label}</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">{option.terms.filter(term => /^\d{2,7}-\d{2}-\d$/.test(term)).join(', ') || option.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <select value={x.s} onChange={e => setRow(x.uid, { s: e.target.value })} className={cx(input, 'col-span-4 sm:col-span-2')}>
                {Object.entries(SRCL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input value={x.ev} onChange={e => setRow(x.uid, { ev: e.target.value })} placeholder={tr('dowód / źródło, np. deklaracja dostawcy 2026-03, SVHC: lead')}
                className={cx(input, 'col-span-7 sm:col-span-5')} />
              <button type="button" onClick={() => setF(p => ({ ...p, h: p.h.filter(y => y.uid !== x.uid) }))}
                className="col-span-1 justify-self-center p-2 rounded-md text-zinc-500 hover:text-red-300 hover:bg-red-500/10"><Trash2 size={14} /></button>
            </div>
            );
          })}
        </div>

        <SectionTitle>{tr('Wyjątki, aliasy i braki danych')}</SectionTitle>
        <div className="grid md:grid-cols-2 gap-3">
          <div><Label hint={tr('Enter lub przecinek dodaje')}>{tr('Wyjątki RoHS')}</Label><TagInput mono value={f.ex} onChange={set('ex')} placeholder="e.g. 6(c), 7(c)-I" /></div>
          <div><Label hint={tr('dopasowanie BOM, np. PHLP 12NC')}>{tr('Aliasy (numery z EXTRA DESC)')}</Label><TagInput mono value={f.al} onChange={set('al')} placeholder="e.g. 453560506631" /></div>
          <div className="md:col-span-2">
            <Label hint={tr('włączają pozycje „Missing” przy analizie BOM')}>{tr('Brak danych od dostawcy')}</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(UL).map(([k, l]) => {
                const on = f.u.includes(k);
                return (
                  <button key={k} type="button" onClick={() => set('u')(on ? f.u.filter(x => x !== k) : [...f.u, k])}
                    className={cx('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                      on ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600')}>
                    {on ? '✔ ' : ''}{l} {tr('nieznany')}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="md:col-span-2">
            <Label hint={tr('jedna uwaga w linii – pokazywane przy analizie BOM')}>{tr('Uwagi')}</Label>
            <textarea className={cx(input, 'h-20 resize-y')} value={f.w} onChange={e => set('w')(e.target.value)} />
          </div>
        </div>

        <datalist id="dl-sup">{lists.sup.map(v => <option key={v} value={v} />)}</datalist>
        <datalist id="dl-r">{lists.r.map(v => <option key={v} value={v} />)}</datalist>
      </div>
    </Modal>
  );
}
