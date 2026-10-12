import RCDDB from './rcddb.js';

export const fold = RCDDB.fold;
export const keyN = RCDDB.keyN;

/* źródła trafień w bazie */
export const SRCL = {
  d: ['deklaracja', 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30'],
  o: ['opis', 'bg-sky-500/15 text-sky-300 ring-sky-500/30'],
  i: ['wniosek', 'bg-zinc-700/50 text-zinc-300 ring-zinc-600/40'],
  p: ['możliwe', 'bg-amber-500/15 text-amber-300 ring-amber-500/30'],
};
export const UL = { rohs: 'RoHS', svhc: 'SVHC', pfas: 'PFAS', pip: 'PIP 3:1' };

/* kolory sekcji BOMcheck (pełne nazwy klas – wymagane przez Tailwind) */
export const SECSTYLE = {
  red: ['border-red-500/30', 'bg-red-500/10 text-red-300'],
  orange: ['border-orange-500/30', 'bg-orange-500/10 text-orange-300'],
  rose: ['border-rose-500/30', 'bg-rose-500/10 text-rose-300'],
  slate: ['border-zinc-600/40', 'bg-zinc-700/30 text-zinc-300'],
  amber: ['border-amber-500/30', 'bg-amber-500/10 text-amber-300'],
  cyan: ['border-cyan-500/30', 'bg-cyan-500/10 text-cyan-300'],
  emerald: ['border-emerald-500/30', 'bg-emerald-500/10 text-emerald-300'],
  violet: ['border-violet-500/30', 'bg-violet-500/10 text-violet-300'],
  fuchsia: ['border-fuchsia-500/30', 'bg-fuchsia-500/10 text-fuchsia-300'],
  sky: ['border-sky-500/30', 'bg-sky-500/10 text-sky-300'],
};

export const cx = (...a) => a.filter(Boolean).join(' ');

export const ansTxt = a => (a === 'EX' ? 'No (but Exempt) – wyjątek ręcznie' : a);

export function readBuf(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

export const fmtDate = iso => (iso ? new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtSize = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' kB');
