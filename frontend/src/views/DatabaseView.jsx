import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ClipboardList, Database, Filter,
  PenLine, Pencil, Plus, Search, Trash2, X,
} from 'lucide-react';
import { BY_ID } from '../lib/substances.js';
import { SRCL, UL, cx, fold } from '../lib/utils.js';
import { Chip } from '../components/ui/index.jsx';
import BatchStatusReport from '../components/db/BatchStatusReport.jsx';
import { panel, input, btnGhost, btnPrimary } from '../components/ui/styles.js';
import { useI18n } from '../lib/i18n-context.js';
import { reachStatus } from '../lib/rcd.js';

const PER = 50;
const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const isoDt = s => { const m = /^(\d\d)\.(\d\d)\.(\d{4})/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : (s || ''); };
const substanceName = (id, language) => language === 'en' ? BY_ID[id]?.en || BY_ID[id]?.n : BY_ID[id]?.n;
const FILTER_COLUMNS = {
  item: {
    label: 'ITEM',
    value: row => [row.k, row.it.i, ...(row.it.al || [])].join(' '),
  },
  description: {
    label: 'Opis / dostawca',
    value: row => [row.it.d, ...(row.it.w || [])].filter(Boolean).join(' '),
  },
  supplier: {
    label: 'Supplier',
    value: row => row.it.sup || '',
  },
  status: {
    label: 'Status',
    value: row => row.it.a || '',
  },
  rohs: {
    label: 'RoHS',
    value: row => [row.it.r, ...(row.it.ex || [])].filter(Boolean).join(' '),
  },
  reach: {
    label: 'Status REACH',
    value: row => reachStatus(row.it),
  },
  date: {
    label: 'Data dekl.',
    value: row => row.it.dt || '',
  },
  substances: {
    label: 'Substancje',
    value: row => Object.entries(row.it.h || {}).flatMap(([id, [source, evidence]]) => [
      id, BY_ID[id]?.n || '', source, evidence || '',
    ]).join(' '),
  },
  missing: {
    label: 'Braki',
    value: row => (row.it.u || []).flatMap(key => [key, UL[key] || '']).join(' '),
  },
};

export default function DatabaseView({ db, onEdit, onDelete, onNew }) {
  const { t, language } = useI18n();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(() => Object.fromEntries(
    Object.keys(FILTER_COLUMNS).map(key => [key, { mode: 'all', query: '', match: 'contains' }]),
  ));
  const [sort, setSort] = useState({ key: 'item', direction: 'asc' });
  const [batchReportOpen, setBatchReportOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const filterPopupRef = useRef(null);
  const [page, setPage] = useState(0);
  const dq = useDeferredValue(q);
  useEffect(() => {
    if (!openFilter) return undefined;
    const onPointerDown = event => {
      if (event.target.closest('[data-filter-trigger]')) return;
      if (!filterPopupRef.current?.contains(event.target)) setOpenFilter(null);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') setOpenFilter(null);
    };
    const onScroll = () => setOpenFilter(null);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [openFilter]);
  const toggleSort = key => {
    setSort(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
    setPage(0);
  };

  const rows = useMemo(() => Object.entries(db.items).map(([k, it]) => ({
    k, it, hay: fold([k, it.i, it.d, it.sup, it.a, it.r, reachStatus(it), (it.al || []).join(' ')].join(' ')),
  })), [db]);

  const filtered = useMemo(() => {
    const words = fold(dq.trim()).split(/\s+/).filter(Boolean);
    const r = rows.filter(row => {
      if (!words.every(word => row.hay.includes(word))) return false;
      return Object.entries(filters).every(([key, filter]) => {
        const value = FILTER_COLUMNS[key].value(row).trim();
        if (filter.mode === 'empty') return !value;
        if (filter.mode === 'nonempty') return Boolean(value);
        if (filter.mode === 'text') {
          if (key === 'supplier') {
            const query = fold(filter.query.trim());
            return !query || (filter.match === 'exact' ? fold(value) === query : fold(value).includes(query));
          }
          const terms = fold(filter.query.trim()).split(/\s+/).filter(Boolean);
          const candidate = fold(value);
          return !terms.length || terms.every(term => candidate.includes(term));
        }
        return true;
      });
    });
    const value = row => {
      if (sort.key === 'item') return row.k;
      if (sort.key === 'description') return row.it.d || '';
      if (sort.key === 'status') return row.it.a || '';
      if (sort.key === 'rohs') return row.it.r || '';
      if (sort.key === 'reach') return row.it.reach || row.it.reachStatus || reachStatus(row.it, language);
      if (sort.key === 'date') return isoDt(row.it.dt || '');
      if (sort.key === 'substances') return Object.keys(row.it.h || {}).length;
      if (sort.key === 'missing') return (row.it.u || []).length;
      return '';
    };
    r.sort((a, b) => {
      const left = value(a), right = value(b);
      const order = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : coll.compare(left, right);
      return (sort.direction === 'asc' ? order : -order) || coll.compare(a.k, b.k);
    });
    return r;
  }, [rows, dq, filters, sort, language]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const p = Math.min(page, pages - 1);
  const view = filtered.slice(p * PER, p * PER + PER);
  const anyFilter = Boolean(q) || Object.values(filters).some(filter => filter.mode !== 'all');
  const updateFilter = (key, patch) => {
    setFilters(current => ({ ...current, [key]: { ...current[key], ...patch } }));
    setPage(0);
  };
  const clearFilters = () => {
    setQ('');
    setFilters(Object.fromEntries(Object.keys(FILTER_COLUMNS).map(key => [key, { mode: 'all', query: '', match: 'contains' }])));
    setPage(0);
  };
  const filterControl = key => {
    const filter = filters[key];
    const label = FILTER_COLUMNS[key].label;
    return (
      <div className="w-64 space-y-2">
        <label className="block text-[11px] font-medium text-zinc-400">
          {t('Filtr:')} {t(label)}
          <select
            aria-label={`Typ filtra: ${label}`}
            value={filter.mode}
            onChange={event => updateFilter(key, { mode: event.target.value })}
            className={cx(input, 'mt-1')}
          >
            <option value="all">{t('Wszystkie wartości')}</option>
            <option value="nonempty">{t('Tylko niepuste')}</option>
            <option value="empty">{t('Tylko puste')}</option>
            <option value="text">{t('Szukaj słów')}</option>
          </select>
        </label>
        {filter.mode === 'text' && (
          <>
            <input
              autoFocus
              value={filter.query}
              onChange={event => updateFilter(key, { query: event.target.value })}
              placeholder={t(key === 'supplier' ? 'Enter supplier name…' : 'Wpisz słowa do wyszukania…')}
              aria-label={`${t('Szukaj w kolumnie')} ${t(label)}`}
              className={input}
            />
            {key === 'supplier' && (
              <label className="block text-[11px] font-medium text-zinc-400">
                {t('Supplier match')}
                <select
                  value={filter.match}
                  onChange={event => updateFilter(key, { match: event.target.value })}
                  className={cx(input, 'mt-1')}
                >
                  <option value="contains">{t('Contains text')}</option>
                  <option value="exact">{t('Exact match')}</option>
                </select>
              </label>
            )}
          </>
        )}
      </div>
    );
  };
  const sortHeader = (label, key, className = '', filterKey = null) => {
    const filterKeys = Array.isArray(filterKey) ? filterKey : filterKey ? [filterKey] : [];
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2.5 text-left ${className}`}>
        <div className="min-w-28">
          <div className="flex items-center gap-1 whitespace-nowrap">
            <button
              type="button"
              onClick={() => toggleSort(key)}
              className={`inline-flex items-center gap-1.5 font-semibold transition-colors ${active ? 'text-indigo-200' : 'text-zinc-300 hover:text-white'}`}
            >
              {t(label)}<Icon size={13} className={active ? 'text-indigo-300' : 'text-zinc-500'} />
            </button>
            {filterKeys.map(activeFilterKey => (
              <button
                key={activeFilterKey}
                type="button"
                data-filter-trigger
                onClick={event => {
                  if (openFilter?.key === activeFilterKey) {
                    setOpenFilter(null);
                    return;
                  }
                  const rect = event.currentTarget.getBoundingClientRect();
                  setOpenFilter({
                    key: activeFilterKey,
                    top: rect.bottom + 6,
                    left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)),
                  });
                }}
                aria-label={`${t('Otwórz filtr:')} ${t(FILTER_COLUMNS[activeFilterKey].label)}`}
                aria-expanded={openFilter?.key === activeFilterKey}
                title={`${t('Filtruj')}: ${t(FILTER_COLUMNS[activeFilterKey].label)}`}
                className={cx(
                  'rounded p-1 transition-colors',
                  filters[activeFilterKey].mode !== 'all'
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200',
                )}
              >
                <Filter size={13} />
              </button>
            ))}
          </div>
        </div>
      </th>
    );
  };

  return (
    <div className="max-w-[1800px] mx-auto">
      <header className="sticky top-0 z-20 border-b border-zinc-700 bg-zinc-950/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
          <div className="relative min-w-[180px] flex-1 basis-48">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={e => { setQ(e.target.value); setPage(0); }}
              className={cx(input, 'pl-10 pr-9 py-2.5')}
              placeholder={t('Szukaj ITEM, opisu, dostawcy…')}
              aria-label={t('Szukaj w bazie materiałów')}
            />
            {q && (
              <button
                type="button"
                onClick={() => { setQ(''); setPage(0); }}
                aria-label={t('Wyczyść wyszukiwanie')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-white"
              >
                <X size={15} />
              </button>
            )}
          </div>
          {anyFilter && (
            <button type="button" className={btnGhost} onClick={clearFilters}>
              <X size={14} /> {t('Wyczyść filtry')}
            </button>
          )}
          <button type="button" className={`${btnPrimary} shrink-0`} onClick={onNew}>
            <Plus size={15} /> {t('Nowy rekord')}
          </button>
          <button type="button" className={`${btnGhost} shrink-0`} onClick={() => setBatchReportOpen(true)}>
            <ClipboardList size={15} /> {t('Batch statuses')}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {t('Baza materiałów')} · {filtered.length.toLocaleString(language === 'en' ? 'en-US' : 'pl-PL')} {t('pasujących rekordów')}
        </p>
      </header>
      {openFilter && createPortal(
        <div
          ref={filterPopupRef}
          className="fixed z-[100] rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-2xl shadow-black/50"
          style={{ top: openFilter.top, left: openFilter.left }}
        >
          {filterControl(openFilter.key)}
        </div>,
        document.body,
      )}

      <div className="p-4 md:p-6 space-y-4">
      {/* tabela */}
      <section className={cx(panel, 'overflow-hidden')}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-950/60 text-zinc-500 border-b border-zinc-800">
              <tr className="text-left">
                {sortHeader('ITEM', 'item', '', 'item')}
                {sortHeader('Opis / dostawca', 'description', '', ['description', 'supplier'])}
                {sortHeader('Status', 'status', '', 'status')}
                {sortHeader('RoHS', 'rohs', '', 'rohs')}
                {sortHeader('REACH', 'reach', '', 'reach')}
                {sortHeader('Data dekl.', 'date', 'whitespace-nowrap', 'date')}
                {sortHeader('Substancje', 'substances', '', 'substances')}
                {sortHeader('Braki', 'missing', '', 'missing')}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {view.map(({ k, it }) => (
                <tr key={k} onClick={() => onEdit(k)} className="border-t border-zinc-800/70 align-top hover:bg-zinc-800/40 cursor-pointer group">
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-zinc-100">
                    <div className="flex items-center gap-1.5">{it.i}{it.mod && <span title={`${t('zmieniony ręcznie')} ${new Date(it.mod).toLocaleString(language === 'en' ? 'en-US' : 'pl-PL')}`}><PenLine size={12} className="text-indigo-400" /></span>}</div>
                    {(it.al || []).length > 0 && <div className="text-[10px] text-zinc-500" title={it.al.join(', ')}>{t('alias:')} {it.al[0]}{it.al.length > 1 ? ` +${it.al.length - 1}` : ''}</div>}
                  </td>
                  <td className="px-3 py-2 text-zinc-300 min-w-[260px]">
                    {it.d || <span className="text-zinc-600">—</span>}
                    {it.sup && <div className="text-[10px] text-zinc-500">{it.sup}</div>}
                    {(it.w || []).length > 0 && <div className="text-[10px] text-amber-400/90 truncate max-w-md" title={it.w.join('\n')}>⚠ {it.w[0]}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{it.a}</td>
                  <td className="px-3 py-2 text-zinc-400 max-w-[180px]"><div className="truncate" title={it.r}>{it.r}</div>
                    {(it.ex || []).length > 0 && <div className="text-[10px] text-orange-300">{t('wyj.')} {it.ex.join(', ')}</div>}</td>
                  <td className="px-3 py-2 text-zinc-400 max-w-[200px]">
                    <div className="truncate" title={`${reachStatus(it, language)}${it.reach || it.reachStatus ? '' : ` (${t('inferred from existing data')})`}`}>
                      {reachStatus(it, language)}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{it.dt}</td>
                  <td className="px-3 py-2"><div className="flex flex-wrap gap-0.5 max-w-xs">
                    {Object.entries(it.h || {}).map(([id, [s, ev]]) => {
                      const name = substanceName(id, language) || id;
                      return <Chip key={id} className={`${SRCL[s]?.[1]} max-w-44 truncate`} title={`${name}${s === 'p' ? '?' : ''} — ${t(SRCL[s]?.[0])}: ${ev}`}>
                        <span className="truncate">{name}{s === 'p' ? '?' : ''}</span>
                      </Chip>;
                    })}
                  </div></td>
                  <td className="px-3 py-2"><div className="flex flex-wrap gap-0.5">{(it.u || []).map(u => <Chip key={u}>{UL[u]}</Chip>)}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <span className="inline-flex gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); onEdit(k); }} title={t('Edytuj')} className="p-1.5 rounded-md text-zinc-400 hover:text-indigo-300 hover:bg-zinc-800"><Pencil size={13} /></button>
                      <button onClick={e => { e.stopPropagation(); onDelete(k); }} title={t('Usuń')} className="p-1.5 rounded-md text-zinc-400 hover:text-red-300 hover:bg-red-500/10"><Trash2 size={13} /></button>
                    </span>
                  </td>
                </tr>
              ))}
              {!view.length && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-zinc-500">
                  <Database size={22} className="mx-auto mb-2 text-zinc-700" />
                  {t('Brak rekordów dla wybranych filtrów.')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-3 py-2 border-t border-zinc-800 bg-zinc-950/40 text-xs text-zinc-500">
          <span>{filtered.length ? `${p * PER + 1}–${Math.min(filtered.length, (p + 1) * PER)} ${t('z')} ${filtered.length}` : '0'}{filtered.length !== rows.length && <> ({t('cała baza')}: {rows.length})</>}</span>
          <div className="flex items-center gap-1">
            <button className={cx(btnGhost, 'px-2 py-1.5')} disabled={p === 0} onClick={() => setPage(p - 1)}><ChevronLeft size={14} /></button>
            <span className="px-2">{p + 1} / {pages}</span>
            <button className={cx(btnGhost, 'px-2 py-1.5')} disabled={p >= pages - 1} onClick={() => setPage(p + 1)}><ChevronRight size={14} /></button>
          </div>
        </div>
      </section>
      </div>
      {batchReportOpen && <BatchStatusReport db={db} onClose={() => setBatchReportOpen(false)} />}
    </div>
  );
}
