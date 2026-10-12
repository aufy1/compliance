import { cx } from '../../lib/utils.js';

export const btn = 'inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all disabled:opacity-40 disabled:pointer-events-none';
export const btnGhost = cx(btn, 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-zinc-600');
export const btnPrimary = cx(btn, 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20');
export const btnSuccess = cx(btn, 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20');
export const btnDanger = cx(btn, 'bg-red-600/10 hover:bg-red-600/20 text-red-300 border border-red-500/30');
export const input = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition-colors';
export const panel = 'bg-zinc-900 border border-zinc-800 rounded-xl';
export const menuItem = 'px-4 py-2.5 text-left text-xs hover:bg-zinc-800 text-zinc-300 font-medium flex items-center gap-2 w-full';
