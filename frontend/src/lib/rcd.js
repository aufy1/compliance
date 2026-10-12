/* Logika ankiety RCD: scalanie celów, lista ręczna, analiza BOM (przeniesione z helpera v12) */
import { ALL, BY_ID, SEC, RANK } from './substances.js';
import { SRCL, UL, ansTxt } from './utils.js';

/* scalanie: ta sama pozycja z kilku substancji → silniejsza odpowiedź wygrywa (Missing < No < No but Exempt) */
export function targets(sel) {
  const m = new Map();
  ALL.filter(i => sel.has(i.id)).forEach(i => i.t.forEach(t => {
    const k = t.s + '|' + t.x;
    if (!m.has(k)) m.set(k, { s: t.s, sec: SEC[t.s], x: t.x, m: t.m || 'exact', a: t.a, src: [i.id], cas: [...i.cas] });
    else {
      const e = m.get(k);
      if (RANK[t.a] > RANK[e.a]) e.a = t.a;
      if (!e.src.includes(i.id)) e.src.push(i.id);
      i.cas.forEach(c => { if (!e.cas.includes(c)) e.cas.push(c); });
    }
  }));
  return [...m.values()];
}

export function bySection(T) {
  return Object.keys(SEC).map(s => ({ s, name: SEC[s], rows: T.filter(t => t.s === s) })).filter(g => g.rows.length);
}

export function listText(S, language = 'pl') {
  const english = language === 'en';
  if (!S.length) return english ? 'Nothing selected.' : 'Nic nie zaznaczono.';
  const answer = value => value === 'EX' && english ? 'No (but Exempt) – manual exemption' : ansTxt(value);
  const sourceName = id => english ? (BY_ID[id]?.en || BY_ID[id]?.n || id) : (BY_ID[id]?.n || id);
  const L = [];
  S.forEach(g => {
    L.push('══════ ' + g.name.toUpperCase() + ' ══════');
    L.push(english ? 'Item\tAnswer\tCAS\tSource' : 'Pozycja\tOdpowiedź\tCAS\tŹródło');
    g.rows.forEach(t => L.push([t.x + (t.m === 'prefix' ? '…' : ''), answer(t.a), t.cas.length ? t.cas.join(', ') : english ? '— (group)' : '— (grupa)', t.src.map(sourceName).join('; ')].join('\t')));
    if (g.s === 'soc') L.push((english ? '→ CAS to enter in the SoC dialog:\t' : '→ CAS do wpisania w oknie SoC:\t') + [...new Set(g.rows.flatMap(t => t.cas))].join(', '));
    L.push('');
  });
  L.push(english ? 'All remaining items: Yes' : 'Wszystkie pozostałe pozycje: Yes');
  return L.join('\n');
}

/* liczba rekordów w bazie z daną substancją */
export function countHits(db) {
  const c = {};
  if (!db) return c;
  for (const it of Object.values(db.items)) {
    for (const id of Object.keys(it.h || {})) c[id] = (c[id] || 0) + 1;
    if ((it.u || []).includes('pfas')) c.pfasu = (c.pfasu || 0) + 1;
    if ((it.u || []).includes('pip')) c.pipu = (c.pipu || 0) + 1;
  }
  return c;
}

export function reachVersion(item) {
  const version = item.rn;
  return version == null ? '' : String(version);
}

const REACH_STATES = [
  'compliant_no_svhc',
  'compliant_svhc',
  'compliant_unspecified_svhc',
  'svhc_verify',
  'non_compliant',
  'pending_verify',
  'not_applicable',
  'no_data',
  'verify',
];
const COMPLIANT_REACH_STATES = new Set([
  'compliant_no_svhc',
  'compliant_svhc',
  'compliant_unspecified_svhc',
]);

export function reachCompliance(item) {
  if (typeof item.rc === 'boolean') return item.rc;
  const state = Number.isInteger(item.rs)
    ? REACH_STATES[item.rs]
    : item.re?.s;
  if (COMPLIANT_REACH_STATES.has(state)) return true;
  if (state === 'non_compliant') return false;
  return null;
}

export function reachLabel(item, language = 'en', includeVersion = true) {
  const compliant = reachCompliance(item);
  const label = compliant === true
    ? (language === 'en' ? 'Compliant' : 'Zgodny')
    : compliant === false
      ? (language === 'en' ? 'Non-compliant' : 'Niezgodny')
      : (language === 'en' ? 'Unknown' : 'Nieznany');
  const version = includeVersion ? reachVersion(item) : '';
  return version ? `${label} · SVHC ${version}` : label;
}

/* ===== BOM ===== */
export const CRIT = new Set(['dehp', 'cd', 'cr6', 'dp']); // „No” = niezgodność → tylko ręcznie

export function parseBom(text, LOOK, { skipDuplicates = true } = {}) {
  const out = new Map(), nf = new Map(), entries = [];
  text.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const trimmedLine = line.trim();
    const levelMatch = trimmedLine.match(/^(?:(?:__\s*)+)/);
    const level = levelMatch ? (levelMatch[0].match(/__/g) || []).length : 0;
    const content = levelMatch ? trimmedLine.slice(levelMatch[0].length).trim() : trimmedLine;
    const cells = content.split('\t').map(c => c.trim()).filter(Boolean);
    const cand = [...cells, content, ...content.split(/[\s,;\t]+/)]
      .filter(c => c && c.replace(/[^A-Za-z0-9]/g, '').length >= 4);
    let hit = null, tok = null;
    for (const c of cand) { const r = LOOK(c); if (r) { hit = r; tok = c; break; } }
    let entry;
    if (hit) {
      const existing = out.get(hit.k);
      if (skipDuplicates && existing) {
        existing.n++;
        return;
      }
      entry = { k: hit.k, via: hit.via, tok, n: 1, level, found: true };
      if (!existing) out.set(hit.k, entry);
    } else {
      const c = cells.find(x => /\d/.test(x) && x.replace(/[^A-Za-z0-9]/g, '').length >= 4 && x.length <= 40) || '';
      if (c) {
        const existing = nf.get(c);
        if (skipDuplicates && existing) {
          existing.n++;
          return;
        }
        entry = { item: c, n: 1, level, found: false };
        if (!existing) nf.set(c, entry);
      }
    }
    if (!entry) return;
    entries.push(entry);
  });
  const hierarchy = [];
  entries.forEach(entry => {
    let parent = entry.level > 0 ? hierarchy[entry.level - 1] : null;
    if (!parent && entry.level > 0) {
      parent = [...hierarchy].reverse().find(candidate => candidate && candidate.level < entry.level) || null;
    }
    entry.parent = parent;
    hierarchy.length = entry.level;
    hierarchy[entry.level] = entry;
  });
  entries.forEach((entry, index) => {
    entry.hasChildren = (entries[index + 1]?.level ?? -1) > entry.level;
  });
  return {
    found: skipDuplicates ? [...out.values()] : entries.filter(entry => entry.found),
    nf: (skipDuplicates ? [...nf.values()] : entries.filter(entry => !entry.found)).map(record => record.item),
    nfRecords: skipDuplicates ? [...nf.values()] : entries.filter(entry => !entry.found),
    entries,
  };
}

export function analyse(parsed, o, db) {
  const agg = {}, crit = {}, rows = [];
  const src = new Set(o.src);
  const push = (m, id, it, s, ev) => { (m[id] = m[id] || []).push({ k: it.i, d: it.d, s, ev }); };
  parsed.found.forEach(f => {
    const it = db.items[f.k];
    if (!it) return; // rekord usunięty w międzyczasie
    const used = [], skipped = [];
    Object.entries(it.h || {}).forEach(([id, [s, ev]]) => {
      if (!BY_ID[id]) return;
      if (!src.has(s)) { skipped.push([id, s, ev]); return; }
      if (CRIT.has(id)) push(crit, id, it, s, ev); else push(agg, id, it, s, ev);
      used.push([id, s, ev]);
    });
    const u = it.u || [];
    if (o.pfasU && u.includes('pfas') && !(it.h && it.h.pfas && src.has(it.h.pfas[0]))) push(agg, 'pfasu', it, 'd', 'brak danych PFAS w bazie');
    if (o.pipU && u.includes('pip')) push(agg, 'pipu', it, 'd', 'brak danych PIP 3:1 w bazie');
    rows.push({ f, it, used, skipped });
  });
  return { agg, crit, rows };
}

export function bomReport(P, A, language = 'pl') {
  const en = language === 'en';
  const L = [[...(en
    ? ['ITEM', 'Description', 'Supplier', 'Substance', 'Source', 'Evidence', 'RoHS exemptions', 'Missing data', 'Notes']
    : ['ITEM', 'Opis', 'Dostawca', 'Substancja', 'Źródło', 'Dowód', 'Wyjątki RoHS', 'Braki danych', 'Uwagi'])].join('\t')];
  A.rows.forEach(r => {
    const base = [r.it.i, r.it.d || '', r.it.sup || ''];
    const tail = [(r.it.ex || []).join(', '), (r.it.u || []).map(k => UL[k]).join(', '), (r.it.w || []).join(' | ')];
    if (!r.used.length) L.push([...base, '', '', '', ...tail].join('\t'));
    r.used.forEach(([id, s, ev]) => L.push([...base, en ? BY_ID[id].en || BY_ID[id].n : BY_ID[id].n, en ? ({ deklaracja: 'declaration', opis: 'description', wniosek: 'inference', możliwe: 'possible' }[SRCL[s][0]] || SRCL[s][0]) : SRCL[s][0], ev, ...tail].join('\t')));
  });
  P.nf.forEach(x => L.push([x, en ? 'NOT IN DATABASE' : 'NIE MA W BAZIE', '', '', '', '', '', '', '', ''].join('\t')));
  return L.join('\n');
}
