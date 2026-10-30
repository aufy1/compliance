import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, ChevronDown, ChevronRight, Loader2, Package, PackageOpen, RefreshCw, Save, Search, X } from 'lucide-react';
import { api } from '../api.js';
import { useI18n } from '../lib/i18n-context.js';
import { btnGhost, btnPrimary, input } from '../components/ui/styles.js';

const STAGES = [
  { key: 'p', label: 'Primary', Icon: Package },
  { key: 's', label: 'Secondary', Icon: PackageOpen },
  { key: 't', label: 'Tertiary / grouped transport', Icon: Boxes },
];
const toForm = (item, material) => ({
  t: item?.t || '',
  w: item?.w == null ? '' : String(item.w),
  m: item?.m || material?.sup || '',
  s: item?.s || [],
  h: item?.h || 'u',
});

export default function PackingView({ db, onEdit, onNew, notify }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(() => new Set());
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let active = true;
    setLoadError('');
    api.ppwr()
      .then(result => {
        if (active) setData(result);
      })
      .catch(error => {
        if (active) setLoadError(error.message);
      });
    return () => { active = false; };
  }, [reload]);

  const items = useMemo(() => Object.entries(db.items)
    .filter(([, item]) => item.packing)
    .sort(([, left], [, right]) => left.i.localeCompare(right.i, undefined, { numeric: true }))
    .map(([key, item]) => ({ key, item }))
    .filter(({ key, item }) => {
        const haystack = [
          key, item.i, item.d, item.sup, data?.items?.[key]?.m, data?.items?.[key]?.t,
        ].filter(Boolean).join(' ').toLocaleLowerCase();
      return haystack.includes(query.trim().toLocaleLowerCase());
    }), [db, data, query]);
  const manufacturers = useMemo(() => [...new Set(Object.values(db.items)
    .map(item => typeof item.sup === 'string' ? item.sup.trim() : '')
    .filter(Boolean))].sort((left, right) => left.localeCompare(right)), [db]);
  const setField = (key, field, value) => {
    setDrafts(current => ({
      ...current,
      [key]: { ...(current[key] || toForm(data.items[key], db.items[key])), [field]: value },
    }));
    setErrors(current => ({ ...current, [key]: '' }));
  };

  const save = async key => {
    const form = drafts[key] || toForm(data.items[key], db.items[key]);
    const parseNumber = (value, label) => {
      if (value === '') return null;
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) throw new Error(t('{field} must be a non-negative number.', { field: label }));
      return number;
    };

    let item;
    try {
      item = {
        t: form.t.trim(),
        w: parseNumber(form.w, t('Packaging weight')),
        m: form.m.trim(),
        s: form.s,
        h: form.h,
      };
    } catch (error) {
      setErrors(current => ({ ...current, [key]: error.message }));
      return;
    }

    setSaving(current => new Set(current).add(key));
    setErrors(current => ({ ...current, [key]: '' }));
    try {
      const result = await api.updatePpwrItem(key, item);
      setData(current => ({ ...current, items: { ...current.items, [key]: result.item } }));
      setDrafts(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      notify(t('Saved PPWR data for {item}', { item: db.items[key].i }));
    } catch (error) {
      setErrors(current => ({ ...current, [key]: error.message }));
    } finally {
      setSaving(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  if (!data && loadError) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-sm">
        <div className="flex items-center gap-2 text-red-300"><AlertTriangle size={17} />{t('Could not load PPWR data: {error}', { error: loadError })}</div>
        <button type="button" className={btnGhost} onClick={() => setReload(value => value + 1)}>
          <RefreshCw size={14} /> {t('Try again')}
        </button>
      </div>
    );
  }

  if (!data) {
    return <div className="flex min-h-64 items-center justify-center gap-2 p-6 text-sm text-zinc-500"><Loader2 size={17} className="animate-spin" />{t('Loading PPWR data…')}</div>;
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      <datalist id="packing-mfg-options">
        {manufacturers.map(manufacturer => <option key={manufacturer} value={manufacturer} />)}
      </datalist>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100"><Package size={19} className="text-indigo-300" />{t('Packing materials')}</h1>
          <p className="mt-1 text-xs text-zinc-500">{t('PPWR information is stored separately and linked to each material ITEM.')}</p>
        </div>
        <button type="button" className={btnPrimary} onClick={() => onNew({ packing: true })}>
          <Package size={14} /> {t('New packaging material')}
        </button>
      </header>

      <div className="relative max-w-xl">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          className={`${input} pl-9 ${query ? 'pr-9' : ''}`}
          placeholder={t('Search packing materials by ITEM, description or MFG…')}
          aria-label={t('Search packing materials')}
        />
        {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Clear search')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"><X size={15} /></button>}
      </div>

      <div className="grid gap-3">
        {items.map(({ key, item }) => {
          const ppwrItem = data.items[key];
          const form = drafts[key] || toForm(ppwrItem, item);
          const isExpanded = expanded === key;
          return (
            <section key={key} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70">
              <div className="flex items-center gap-2 px-4 py-3">
                <button type="button" aria-expanded={isExpanded} onClick={() => setExpanded(current => current === key ? null : key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {isExpanded ? <ChevronDown size={16} className="shrink-0 text-zinc-500" /> : <ChevronRight size={16} className="shrink-0 text-zinc-500" />}
                  <span className="font-mono text-sm font-semibold text-zinc-100">{item.i}</span>
                  {item.d && <span className="truncate text-xs text-zinc-400">{item.d}</span>}
                  {(ppwrItem?.s || []).map(stage => {
                    const selected = STAGES.find(option => option.key === stage);
                    if (!selected) return null;
                    const { Icon } = selected;
                    return <Icon key={stage} size={15} title={t(selected.label)} className="shrink-0 text-indigo-300" />;
                  })}
                  {item.sup && <span className="ml-auto hidden max-w-48 truncate text-xs text-zinc-500 sm:block">{item.sup}</span>}
                </button>
                <button type="button" className={`${btnGhost} shrink-0 py-1.5`} onClick={() => onEdit(key)}>{t('Edit material')}</button>
              </div>

              {isExpanded && (
                <div className="border-t border-zinc-800 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="space-y-1 text-xs text-zinc-400">
                      <span>{t('Packaging type')}</span>
                      <input className={input} value={form.t} onChange={event => setField(key, 't', event.target.value)} placeholder={t('e.g. flexible, rigid')} />
                    </label>
                    <label className="space-y-1 text-xs text-zinc-400">
                      <span>{t('Packaging weight')} (g)</span>
                      <input className={input} type="number" min="0" step="any" value={form.w} onChange={event => setField(key, 'w', event.target.value)} />
                    </label>
                    <label className="space-y-1 text-xs text-zinc-400">
                      <span>{t('MFG')}</span>
                      <input className={input} list="packing-mfg-options" value={form.m} onChange={event => setField(key, 'm', event.target.value)} placeholder={t('Search or enter manufacturer')} />
                    </label>
                    <fieldset className="space-y-2">
                      <legend className="mb-1 text-xs text-zinc-400">{t('Packaging stage')}</legend>
                      <div className="flex flex-wrap gap-2">
                        {STAGES.map(({ key: stage, label, Icon }) => {
                          const checked = form.s.includes(stage);
                          return (
                            <button key={stage} type="button" aria-pressed={checked} onClick={() => setField(key, 's', checked ? form.s.filter(value => value !== stage) : [...form.s, stage])}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors ${checked ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'}`}>
                              <Icon size={15} />{t(label)}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                    <label className="space-y-1 text-xs text-zinc-400">
                      <span>{t('Heavy metals compliance')}</span>
                      <select className={input} value={form.h} onChange={event => setField(key, 'h', event.target.value)}>
                        <option value="u">{t('Not assessed')}</option>
                        <option value="c">{t('Compliant')}</option>
                        <option value="n">{t('Non-compliant')}</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <button type="button" className={btnPrimary} onClick={() => save(key)} disabled={saving.has(key)}>
                      {saving.has(key) ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {saving.has(key) ? t('Zapisywanie…') : t('Save PPWR data')}
                    </button>
                  </div>
                  {errors[key] && <p role="alert" className="mt-2 text-xs text-red-300">{errors[key]}</p>}
                </div>
              )}
            </section>
          );
        })}
        {!items.length && (
          <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-12 text-center text-sm text-zinc-500">
            {query ? t('No packing materials match your search.') : t('No packaging materials yet. Mark a material as a packing material to see it here.')}
          </div>
        )}
      </div>
    </div>
  );
}
