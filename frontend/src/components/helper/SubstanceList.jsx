import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { G, SEC } from '../../lib/substances.js';
import { cx, fold } from '../../lib/utils.js';
import { Chip, AnswerBadge, Hl } from '../ui/index.jsx';
import { panel } from '../ui/styles.js';
import { useI18n } from '../../lib/i18n-context.js';

const hay = o => fold([o.n, o.en, (o.cas || []).join(' '), (o.t || []).map(t => t.x).join(' '), (o.info || []).map(x => x.n + ' ' + x.en + ' ' + x.cas).join(' ')].join(' '));

export default function SubstanceList({ sel, toggle, bomBy, search, counts }) {
  const { t, language } = useI18n();
  const [openSet, setOpenSet] = useState(() => new Set());
  const q = fold(search.trim());
  const flip = id => setOpenSet(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const groups = G.map(g => ({ ...g, items: g.items.filter(i => !q || hay(i).includes(q)) })).filter(g => g.items.length);
  if (!groups.length) return <div className={cx(panel, 'p-4 text-sm text-zinc-500')}>{t('Brak wyników dla „{query}”.', { query: search })}</div>;

  return groups.map(g => (
    <div key={g.g} className={panel}>
      <div className="px-4 py-2.5 border-b border-zinc-800 font-semibold text-sm text-white flex justify-between">
        <span>{t(g.g)}</span>
        <span className="text-xs font-normal text-zinc-500">{g.items.filter(i => sel.has(i.id)).length} / {g.items.length}</span>
      </div>
      {g.items.map(i => {
        const on = sel.has(i.id), open = openSet.has(i.id), cnt = counts[i.id];
        return (
          <label key={i.id} className={cx('flex gap-3 px-4 py-2.5 border-b border-zinc-800/70 last:border-0 cursor-pointer transition-colors', on ? 'bg-indigo-500/[0.08] hover:bg-indigo-500/[0.12]' : 'hover:bg-zinc-800/40')}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-500 shrink-0" checked={on} onChange={() => toggle(i.id)} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-2 items-center">
                <span
                  className={cx('block max-w-[22rem] truncate font-medium text-sm', on ? 'text-white' : 'text-zinc-200')}
                  title={language === 'en' ? i.en : i.n}
                >
                  <Hl text={language === 'en' ? i.en : i.n} q={q} />
                </span>
                <span className="text-xs text-zinc-500 italic"><Hl text={language === 'en' ? i.n : i.en} q={q} /></span>
                {!i.info && i.cas.map(c => <Chip key={c} mono><Hl text={c} q={q} /></Chip>)}
                {cnt > 0 && <Chip className="bg-sky-500/10 text-sky-300 ring-sky-500/25" title={t('Liczba rekordów w bazie z tą substancją')}>{t('w bazie:')} {cnt}</Chip>}
                {on && bomBy[i.id] && <Chip className="bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" title={bomBy[i.id].join(', ')}>{t('z BOM:')} {bomBy[i.id].length} {t('poz.')}</Chip>}
                {i.info && (
                  <button type="button" className="text-xs text-indigo-400 hover:underline" onClick={e => { e.preventDefault(); e.stopPropagation(); flip(i.id); }}>
                    {open ? t('▾ ukryj') : t('▸ pokaż')} ({i.info.length})
                  </button>
                )}
              </div>
              {i.info && open && (
                <div className="mt-1 ml-1 text-xs leading-5">
                  {i.info.map(x => (
                    <div key={x.cas}><span className="inline-block w-48 text-zinc-300"><Hl text={language === 'en' ? x.en : x.n} q={q} /> <span className="text-zinc-500 italic"><Hl text={language === 'en' ? x.n : x.en} q={q} /></span></span><span className="font-mono text-zinc-400"><Hl text={x.cas} q={q} /></span></div>
                  ))}
                </div>
              )}
              {i.note && <div className="text-xs text-zinc-500 mt-0.5">{t(i.note)}</div>}
              {i.warn && <div className="text-xs text-red-400 mt-0.5 flex items-center gap-1"><AlertTriangle size={12} /> {t(i.warn)}</div>}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {i.t.map((t, k) => (
                  <span key={k} className="inline-flex items-center gap-1"><span className="text-zinc-500">{SEC[t.s]} →</span> <span className="text-zinc-300">{t.x}{t.m ? '…' : ''}</span> <AnswerBadge a={t.a} /></span>
                ))}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  ));
}
