/* ===== RCD material DB – parser CSV + klasyfikator (przeniesione 1:1 z helpera v12) ===== */
const RCDDB = (() => {
  const VERSION = 1;
  const fold = s => (s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const keyN = s => (s || '').toUpperCase().replace(/\s+/g, '');
  const keyA = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');

  /* --- CSV parser (cudzysłowy, wielowierszowe pola, , lub ;) --- */
  function parseCSV(text) {
    const first = text.slice(0, 2000).split(/\r?\n/)[0] || '';
    const d = (first.split(';').length > first.split(',').length) ? ';' : ',';
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === d) { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('windows-1250').decode(buf); }
  }

  /* --- mapowanie kolumn po nagłówkach --- */
  const COLS = [
    ['item', /^item$/], ['desc', /^desc/], ['extra', /extra/], ['active', /active|status/],
    ['rohs', /^rohs$/], ['phth', /phthal/], ['reach', /^reach/], ['svhc', /candidate|^svhc/],
    ['comments', /comment/], ['date', /data dekl|^date/], ['be', /^be$/], ['pvc', /pvc|sb2o3/],
    ['pip', /^pip/], ['pfas', /pfas/], ['dost', /dostawca|supplier/], ['prod', /producent|manufact/],
    ['other', /other/], ['al', /alumin/], ['stal', /^stal|^steel/], ['cu', /^mied|^copper/]];
  function mapHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const h = rows[r].map(x => fold(x).trim());
      if (h.includes('item') && h.some(x => /^rohs$/.test(x))) {
        const m = {};
        COLS.forEach(([k, re]) => { const i = h.findIndex((x, j) => re.test(x) && !Object.values(m).includes(j)); if (i >= 0) m[k] = i; });
        return { row: r, map: m };
      }
    }
    throw new Error('Nie znaleziono nagłówka (wiersz z kolumnami ITEM i ROHS).');
  }

  /* --- reguły substancji ---
     f: d = kolumny deklaracji, m = kolumny materiałowe (Be, PVC/Sb2O3, other), o = opis (DESC/EXTRA)  */
  const D = 'd', M = 'm', O = 'o';
  const R = [
    ['pb',   [D, M], /\blead\b|\bpb\b|7439-92-1|\bleaded\b|olow\b|olowiu/],
    ['cu',   [D, M, O], /copper|\bcu\b|\bcu(sn|zn|ni|be|fe|sn\d)|brass|bronze?\b|\bbecu\b|mosiadz|miedz|ecobrass|c69300|\bcw\d{3}[a-z]\b/],
    ['ni',   [D, M, O], /nickel|nikiel|\bni\b|nicel|nickiel|niciel|nickie\b|stainless|\binox\b|steel\s+a[24]\b|\ba[24]-(70|80)\b|1\.43\d\d|1\.44\d\d|\bx\d+crni|\baisi ?3\d\d|\bsus ?3\d\d|\bmonel\b|\bcuni/],
    ['pm',   [D, M], /\bgold\b|\bau\b|silver|srebr|zlot[oay]|zlocon|precious metal|metale szlachetne/],
    ['pm',   [O], /\bgold\b|\bau\b|gold.?plat|gold flash|silver.?plat/],
    ['pgm',  [D, M, O], /palladium|platinum|rhodium|iridium|ruthenium|osmium|\bpd\b|\bpdni\b|\bpgm\b|7440-05-3|7440-06-4/],
    ['pbz',  [D, M, O], /phosphor\s*bron|phosphorus|\bcusnp\b|braz fosfor|\bc5191\b|\bc5210\b/],
    ['be',   [D, M, O], /beryl|\bbecu\b|\bc17[24]\d0\b|7440-41-7/],
    ['mn',   [D, M, O], /steel|\bstal\b|stalow|manganese|\bmn\b|1\.43\d\d|1\.44\d\d|\bx\d+cr/],
    ['co',   [D, M, O], /cobalt|kobalt|7440-48-4/],
    ['al',   [D, M], /alumin(i)?um|\balu\b|\bal.?foil|\bal\/pet|\bal-pet|aluminiow|7429-90-5/],
    ['al',   [O], /alumin(i)?um|\bal.?foil|\bal\/pet|\bal-pet|aluminiow/],
    ['cd',   [D, M], /cadmium|\bcd\b|kadm|7440-43-9|1306-19-0/],
    ['cr6',  [D, M, O], /hexavalent|cr\s*\(\s*vi\s*\)|\bcr\s?vi\b|\bcr6|chromate|chromian|yellow zinc|zinc yellow/],
    ['ree',  [D, M, O], /neodym|ndfeb|dyspros|rare earth/],
    ['li',   [D, M], /lithium|7791-03-9/],
    ['pvc',  [D, M, O], /\bpvc\b|polyvinyl chloride|polichlorek winylu|9002-86-2/],
    ['sb',   [D, M], /sb2o3|antimony|antymon|1309-64-4/],
    ['dinp', [D, M], /\bdinp\b|diisononyl|di-isononyl|28553-12-0|68515-48-0/],
    ['didp', [D, M], /\bdidp\b|diisodecyl|di-isodecyl|26761-40-0|68515-49-1/],
    ['dup',  [D, M], /\bdup\b|diundecyl|3648-20-2|phthalates?\b|ftalan/],
    ['bfr',  [D, M], /\bbfr\b|brominated|bromine|\bbromo|tbbpa|decabrom|pentabrom|tetrabrom/],
    ['dbdpe',[D, M], /dbdpe|84852-53-9|ethane-1,2-diyl\)?\s*bis\s*\[?\s*pentabrom|decabromodiphenyl ethane/],
    ['tbph', [D, M], /\btbph\b|tetrabromophthalate|26040-51-7|frp-45/],
    ['dp',   [D, M], /dechlorane|13560-89-9|dodecachloropentacyclo/],
    ['pfas', [D, M, O], /\bptfe\b|\bfep\b|\bpfa\b|\bpfpe\b|\bpvdf\b|\betfe\b|\bectfe\b|teflon|fluoropolymer|fluoropolimer|9002-84-0|25067-11-2|69991-61-3|24937-79-9|contains pfas/],
    ['ppfp', [D, M, O], /polypropylene-fluoropolymer/],
    ['pfbs', [D, M], /\bpfbs\b|375-73-5|perfluorobutane sulfon/],
    ['mg',   [D, M], /magnesium hydroxide|mg\(oh\)2|1309-42-8|wodorotlenek magnezu/],
    ['b',    [D, M], /borate|boric acid|\bboron\b|138265-88-0|10043-35-3|boran/],
    ['ti',   [D, M], /titanium|\btio2\b|13463-67-7|tytan/],
    ['ba',   [D, M], /barium|\bbaso4\b|7727-43-7|baryt/],
    ['mel',  [D, M], /melamin|108-78-1|37640-57-6/],
    ['dehp', [D, M], /\bdehp\b|117-81-7|di\s*-?\(\s*2-ethylhexyl\s*\)\s*-?phthalate|bis\s*\(\s*2-ethylhexyl\s*\)\s*phthalate/],
    ['latex',[D, M, O], /latex|lateks|natural rubber|9006-04-6/],
    ['dbmc', [D, M], /\bdbmc\b|119-47-1|methylenedi-p-cresol/],
    ['bpa',  [D, M], /bisphenol a|\bbpa\b|80-05-7|isopropylidenediphenol/],
    ['sil',  [D, M], /siloxane|siloksan|556-67-2|541-02-6|540-97-6/],
    ['tpp',  [D, M], /triphenyl.?phosphate|115-86-6/],
    ['adca', [D, M], /azodicarbonamide|123-77-3|azodi\s*\(\s*formamide|diazene-1,2-dicarboxamide/],
  ];
  const NEG = /\b(no|not|non|none|free|without|nie|bez|banned|zero|absence|absent|trivalent|cr\s*\(?iii\)?|not detected|not contained)\b|-free\b|<\s*0[.,]1|\(\s*</;
  const UNSURE = /might|\bmay\b|maybe|possib|\?\?|unlikely|not sure|\bif\b|could|to verify|to be determined|perhaps|moze/;
  const RANKSRC = { d: 4, o: 3, i: 2, p: 1 };

  /* wnioskowanie z opisu (typ kabla/elementu) */
  const isCable = d => /\b(cbl|cable|wire|kabel|przewod|cord|powercord|lead wire|harness)\b/.test(d) && !/^\s*(conn|connector|plug|jack|contact|adapter|adaptor|gland|crimp|tool|label|sleeve|heat ?shrink|tie|clip|cover|housing)\b/.test(d);
  const isFiber = d => /fib(er|re)|optic|\blwl\b|\bom[1-5]\b|\bos2\b|9\/125|50\/125|62\.5\/125|\bsmf\b|\bmmf\b|\blc\b.*\blc\b|\bsc\b.*\bsc\b/.test(d);
  function infer(desc) {
    const d = fold(desc), h = [];
    if (!d) return h;
    if (isCable(d) && !isFiber(d) && /mm2|mm²|mm\?|awg|\d\s*x\s*\d|\bcore|\brg\s?\d|\bcat\s?\d|h0\d|\bliy|\bul\s?\d{4}/.test(d)) h.push(['cu', 'opis: kabel/przewód → przewodnik Cu']);
    if (/\b(contact|terminal|lug|faston|spade|ferrule|tulejk|konektor|pin|socket contact|receptacle|crimp)\b/.test(d) && !/housing|obudow|tool|label/.test(d)) h.push(['cu', 'opis: styk/końcówka → stop Cu']);
    if (isCable(d) && !/lszh|lsoh|lsnh|halogen.?free|\bhff?r?\b|\blih|\bpur\b|\bptfe\b|\bfep\b|silicone|\btpe\b|\blszh\b/.test(d)) {
      if (/\bh0[3-7]vv|\bh0[3-7]v2?-?[kuf]\b|\bh0[3-7]v\b|\bli-?y(c)?y\b|\bli-?ycy\b|\bliy\b|\blgy\b|\brvv\b|\bbvr\b|\bydyp?\b|\byky\b|\bytdy\b|\bomy\b|\bowy\b|o?l?flex classic|\bul\s?(1007|1015|1061|1569|2464|2517|20276|10269)\b|\brg\s?(58|59|6|174|213|214|217|223)\b/.test(d)) h.push(['pvc', 'opis: oznaczenie typu kabla → PVC']);
      if (/\brg\s?(316|178|179|142|400|188|196|303|393)\b/.test(d)) h.push(['pfas', 'opis: kabel RG z PTFE/FEP']);
    }
    return h;
  }

  function scan(text, f, hits, label, unsureCell) {
    if (!text) return;
    const cellUnsure = UNSURE.test(fold(text));
    const clauses = fold(text).split(/[,;\n|]+/);
    clauses.forEach(cl => {
      const exempt = /exempt|wyjat/.test(cl);
      R.forEach(([id, fs, re]) => {
        if (!fs.includes(f)) return;
        const m = cl.match(re); if (!m) return;
        if (!exempt && NEG.test(cl)) return;
        const src = (cellUnsure || unsureCell) ? 'p' : (f === O ? 'o' : 'd');
        add(hits, id, src, label + ': ' + cl.trim().slice(0, 60));
      });
    });
  }
  function add(hits, id, src, ev) {
    const e = hits[id];
    if (!e || RANKSRC[src] > RANKSRC[e[0]]) hits[id] = [src, ev];
  }

  /* wyjątki RoHS */
  const EXRE = /\b(6\s*\(?\s*[abc]\s*\)?(?:\s*-\s*(?:iii|ii|i)\b)?|7\s*\(?\s*[ac]\s*\)?(?:\s*-\s*(?:iv|iii|ii|i)\b)?|8\s*\(?\s*b\s*\)?(?:\s*-\s*i\b)?|15|27|34)(?![\d.])/g;
  function exemptions(rohs, comments) {
    const out = new Set();
    const go = t => {
      const s = fold(t).replace(/([a-z])(\d)/g, '$1 $2').replace(/2015\/863|2011\/65|\d{4}-\d\d-\d\d|\b\d{3}\b/g, ' ');
      let m; EXRE.lastIndex = 0;
      while ((m = EXRE.exec(s))) {
        let x = m[1].replace(/\s+/g, '').replace(/[()]/g, '');
        x = x.replace(/^(\d)([a-c])/, '$1($2)').replace(/-(i+v?|iv)$/, (a, r) => '-' + r.toUpperCase());
        if (/^(15|27|34)$/.test(x) && !/exempt|yes|tak/.test(fold(t))) continue;
        out.add(x);
      }
    };
    if (rohs && /\d/.test(rohs)) go(rohs);
    if (comments && /exempt|wyjat/.test(fold(comments))) go(comments);
    return [...out];
  }

  const isUnknown = v => { const s = fold(v).trim(); return !s || /^(unkn|unknown|unknnown|inknown|missing|not known|no inf|\?+|un|to be advised|not yet reviewed|under check|sent|waiting|reject|refused)/.test(s) || /missing in?formation|cannot confirm|not yet have|might use|under check|waiting for/.test(s); };

  function classify(r) {
    const hits = {}, u = [], w = [];
    // kolumny deklaracji
    scan(r.rohs, D, hits, 'RoHS');
    scan(r.svhc, D, hits, 'SVHC');
    scan(r.reach, D, hits, 'REACH');
    scan(r.pfas, D, hits, 'PFAS/POP');
    scan(r.pip, D, hits, 'PIP');
    scan(r.comments, D, hits, 'Komentarz');
    // kolumny materiałowe
    scan(r.be, M, hits, 'Be/materiał');
    scan(r.pvc, M, hits, 'PVC/Sb2O3');
    scan(r.other, M, hits, 'Other');
    // opis
    scan(r.desc, O, hits, 'Opis');
    scan(r.extra, O, hits, 'Extra');
    // flagi kolumnowe
    if (/^\s*1\b/.test(r.pvc || '')) add(hits, 'pvc', 'd', 'PVC/Sb2O3 = 1');
    if (/^\s*[123]\s*[-,]/.test(r.pfas || '') || /^\s*1\s*-\s*pfas/i.test(r.pfas || '')) add(hits, 'pfas', 'd', 'PFAS: ' + r.pfas.trim().slice(0, 50));
    if (/^\s*(yes|1)\s*$/i.test(r.cu || '')) add(hits, 'cu', 'd', 'kolumna MIEDŹ = YES');
    if (/^\s*(yes|1)\s*$/i.test(r.al || '')) add(hits, 'al', 'd', 'kolumna Aluminium = YES');
    if (/^\s*yes\s*$/i.test(r.stal || '')) add(hits, 'mn', 'd', 'kolumna Stal = YES');
    // wyjątki RoHS → ołów (6, 7, 15, 27, 34); 8(b) → kadm
    const ex = exemptions(r.rohs, r.comments);
    if (ex.some(x => /^(6|7|15|27|34)/.test(x))) add(hits, 'pb', 'd', 'wyjątek RoHS ' + ex.join(', '));
    if (ex.some(x => /^8/.test(x))) { add(hits, 'cd', 'p', 'wyjątek RoHS 8(b) – kadm w stykach'); w.push('Wyjątek 8(b) (kadm) – zweryfikuj'); }
    if (/possib|ex\.|exemption unknown/.test(fold(r.rohs)) && !ex.length) add(hits, 'pb', 'p', 'RoHS: ' + (r.rohs || '').trim().slice(0, 60));
    // wnioskowanie z opisu
    infer([r.desc, r.extra].join(' ')).forEach(([id, ev]) => add(hits, id, 'i', ev));
    // braki danych
    if (isUnknown(r.rohs) || /to be determined|tbd/.test(fold(r.rohs))) u.push('rohs');
    const sv = fold(r.svhc).trim();
    if (/^(unknown|inknown|not known|missing|\?+|not yet reviewed|to be advised|no information)/.test(sv) || (!sv && !/^\s*yes/i.test(r.reach || '')) || /missing information/.test(fold(r.reach))) u.push('svhc');
    if (isUnknown(r.pfas) || /^\s*(unknown|unkn)/i.test(r.pfas || '')) u.push('pfas');
    if (isUnknown(r.pip) && !/^\s*0/.test(r.pip || '')) u.push('pip');
    // ostrzeżenia
    if (/^\s*no\b/i.test(r.rohs || '')) w.push('RoHS = NO (niezgodny!)');
    if (/dehp/i.test(r.rohs || '')) w.push('RoHS: ' + r.rohs.trim());
    if (/^\s*no\b/i.test(r.reach || '')) w.push('REACH = NO');
    if (sv && !/^(no svhc|nosvhc|no$|no svhc|contains svhc\(s\): no|nexans|unknown|inknown|not known|missing|\?+|not yet reviewed|to be advised|no information|not active|not applicable|bomcheck report)/.test(sv) && !/^lead\b|^lead$/.test(sv)) w.push('SVHC: ' + r.svhc.trim().replace(/\s+/g, ' ').slice(0, 140));
    return { h: hits, ex, u, w };
  }

  function aliases(extra) {
    const out = new Set();
    (extra || '').toUpperCase().split(/[\s,;#]+|:\s*/).forEach(t => {
      t = t.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
      const dig = (t.match(/\d/g) || []).length;
      if (t.length >= 6 && t.length <= 30 && dig >= 4) out.add(t);
    });
    return [...out];
  }

  function build(rows, srcName) {
    const { row, map } = mapHeader(rows);
    const items = {}; let n = 0;
    for (let i = row + 1; i < rows.length; i++) {
      const c = rows[i]; const g = k => map[k] != null ? (c[map[k]] || '').trim() : '';
      const item = g('item'); if (!item || /^item$/i.test(item)) continue;
      const r = {}; COLS.forEach(([k]) => r[k] = g(k));
      const cl = classify(r); n++;
      const k = keyN(item);
      const rec = { i: item, d: r.desc, a: r.active, sup: r.dost || r.prod, r: r.rohs, reach: r.reach, dt: r.date, h: cl.h, ex: cl.ex, u: cl.u, w: cl.w, al: aliases(r.extra) };
      if (items[k]) { // duplikat → scal
        const e = items[k];
        e.h = e.h || {}; Object.entries(rec.h).forEach(([id, v]) => add(e.h, id, v[0], v[1]));
        e.h = e.h || {}; ['ex', 'u', 'w', 'al'].forEach(x => { const v = [...new Set([...(e[x] || []), ...(rec[x] || [])])]; if (v.length) e[x] = v; });
        if (rec.d && e.d && fold(rec.d) !== fold(e.d)) e.w = [...new Set([...(e.w || []), 'Duplikat ITEM w CSV z innym opisem: ' + rec.d])];
        if (!e.d && rec.d) e.d = rec.d; e.dup = (e.dup || 1) + 1;
      } else items[k] = rec;
      Object.keys(items[k]).forEach(x => { const v = items[k][x]; if (v === '' || (Array.isArray(v) && !v.length)) delete items[k][x]; });
    }
    return { v: VERSION, src: srcName || '', built: new Date().toISOString().slice(0, 10), rows: n, n: Object.keys(items).length, items };
  }

  /* indeks wyszukiwania: dokładny, bez separatorów/zer wiodących, aliasy z EXTRA DESC */
  function index(db) {
    const ix = new Map(), ax = new Map(), al = new Map();
    Object.entries(db.items).forEach(([k, it]) => {
      ix.set(k, k); const a = keyA(k); if (a && !ax.has(a)) ax.set(a, k);
      (it.al || []).forEach(t => { const x = keyA(t); if (x && !al.has(x)) al.set(x, k); });
    });
    return tok => {
      const n = keyN(tok); if (!n) return null;
      if (ix.has(n)) return { k: ix.get(n), via: 'ITEM' };
      const a = keyA(tok); if (a && ax.has(a)) return { k: ax.get(a), via: 'ITEM≈' };
      if (a && al.has(a)) return { k: al.get(a), via: 'alias' };
      return null;
    };
  }

  return { VERSION, parseCSV, decode, build, index, classify, fold, keyN, keyA };
})();

export default RCDDB;
