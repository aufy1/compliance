import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cx, fold } from '../../lib/utils.js';
import { SRCL } from '../../lib/utils.js';
import { useI18n } from '../../lib/i18n-context.js';

export function Chip({ className, children, title, mono }) {
  return (
    <span title={title} className={cx('inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-medium ring-1 ring-inset whitespace-nowrap', mono && 'font-mono', className || 'bg-zinc-800 text-zinc-300 ring-zinc-700')}>
      {children}
    </span>
  );
}

export function SrcChip({ s, children, title }) {
  const { t } = useI18n();
  return <Chip className={SRCL[s]?.[1]} title={title}>{children ?? t(SRCL[s]?.[0])}</Chip>;
}

export function AnswerBadge({ a }) {
  const { t } = useI18n();
  if (a === 'EX') return <Chip className="bg-orange-500/15 text-orange-300 ring-orange-500/30">{t('No (but Exempt)')}</Chip>;
  if (a === 'Missing') return <Chip className="bg-zinc-700/50 text-zinc-300 ring-zinc-600/40">{t('Missing')}</Chip>;
  return <Chip className="bg-red-500/15 text-red-300 ring-red-500/30">{t('No')}</Chip>;
}

export function Check({ checked, onChange, children, className }) {
  return (
    <label className={cx('flex gap-2 items-center cursor-pointer select-none text-xs text-zinc-300', className)}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-500" />
      {children}
    </label>
  );
}

/* podświetlenie fragmentu tekstu (wyszukiwanie bez polskich znaków) */
export function Hl({ text, q }) {
  const t = text || '';
  if (!q) return t;
  const i = fold(t).indexOf(q);
  if (i < 0) return t;
  return <>{t.slice(0, i)}<mark>{t.slice(i, i + q.length)}</mark>{t.slice(i + q.length)}</>;
}

/* segmentowany przełącznik jak PL/EN w nagłówku */
export function Segmented({ value, onChange, options }) {
  return (
    <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} title={o.title}
          className={cx('flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-md transition-all',
            value === o.value ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300')}>
          {o.icon}{o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, icon, children, footer, wide }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-10 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={cx('w-full bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl animate-slide-down flex flex-col max-h-[calc(100vh-2.5rem)] md:max-h-[calc(100vh-5rem)]', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">{icon}{title}</div>
          <button onClick={onClose} aria-label={t('Zamknij')} className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"><X size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-800 bg-zinc-950/40 rounded-b-xl shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

/* lista tagów: Enter / przecinek dodaje, ✕ usuwa */
export function TagInput({ value, onChange, placeholder, mono }) {
  const add = raw => {
    const parts = raw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
  };
  return (
    <div className="flex flex-wrap gap-1.5 items-center bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 focus-within:border-indigo-500 min-h-[34px]">
      {value.map(v => (
        <span key={v} className={cx('inline-flex items-center gap-1 bg-zinc-800 text-zinc-200 text-[11px] rounded-md pl-2 pr-1 py-0.5', mono && 'font-mono')}>
          {v}
          <button type="button" onClick={() => onChange(value.filter(x => x !== v))} className="text-zinc-500 hover:text-red-300"><X size={12} /></button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[120px] bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none py-0.5"
        placeholder={placeholder}
        onKeyDown={e => {
          if ((e.key === 'Enter' || e.key === ',') && e.currentTarget.value.trim()) { e.preventDefault(); add(e.currentTarget.value); e.currentTarget.value = ''; }
          if (e.key === 'Backspace' && !e.currentTarget.value && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={e => { if (e.target.value.trim()) { add(e.target.value); e.target.value = ''; } }}
      />
    </div>
  );
}

/* proste dropdown menu z nakładką zamykającą (jak w nagłówku) */
export function Dropdown({ open, onClose, children, align = 'left', width = 'w-56' }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className={cx('absolute top-full mt-2 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-50 flex flex-col py-1 overflow-hidden animate-slide-down', align === 'right' ? 'right-0' : 'left-0', width)}>
        {children}
      </div>
    </>
  );
}
