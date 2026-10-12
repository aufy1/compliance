import { useMemo, useState } from 'react';
import { FileJson, FileSpreadsheet, Printer, Search } from 'lucide-react';
import RCDDB from '../../lib/rcddb.js';
import { parseBom, reachLabel } from '../../lib/rcd.js';
import { BY_ID } from '../../lib/substances.js';
import { Check, Modal } from '../ui/index.jsx';
import { btnGhost, btnPrimary, input } from '../ui/styles.js';
import { useI18n } from '../../lib/i18n-context.js';

const FIELDS = [
  { key: 'reach', label: 'REACH status' },
  { key: 'rohs', label: 'RoHS status' },
  { key: 'date', label: 'Declaration date' },
  { key: 'substances', label: 'Substances found' },
];

const missing = 'Not available';

function getSubstances(item, language, t) {
  const hits = Object.entries(item.h || {}).map(([id, [source, evidence]]) => {
    const name = language === 'en' ? BY_ID[id]?.en || BY_ID[id]?.n || id : BY_ID[id]?.n || id;
    return `${name}${source ? ` (${source})` : ''}${evidence ? `: ${evidence}` : ''}`;
  });
  return hits.length ? hits.join('; ') : t('None recorded');
}

function reportRow(database, record, language, t, includeReachVersion) {
  const item = database.items[record.k];
  const structuralOnly = !record.found && record.hasChildren;
  if (!record.found || !item) {
    return {
      ITEM: record.item || record.tok || record.k,
      'BOM level': record.level || 0,
      _found: false,
      _structuralOnly: structuralOnly,
      'REACH status': structuralOnly ? '' : t('Not found in database'),
      'RoHS status': structuralOnly ? '' : t('Not found in database'),
      'Declaration date': structuralOnly ? '' : t('Not found in database'),
      'Substances found': structuralOnly ? '' : t('Not found in database'),
    };
  }
  return {
    ITEM: item.i,
    'BOM level': record.level || 0,
    _found: true,
    'REACH status': reachLabel(item, language, includeReachVersion),
    'RoHS status': item.r || t(missing),
    'Declaration date': item.dt || t(missing),
    'Substances found': getSubstances(item, language, t),
  };
}

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export default function BatchStatusReport({ db, onClose }) {
  const { t, language } = useI18n();
  const [text, setText] = useState('');
  const [analysedText, setAnalysedText] = useState('');
  const [includeBomStructure, setIncludeBomStructure] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [includeReachVersion, setIncludeReachVersion] = useState(true);
  const [selected, setSelected] = useState(() => Object.fromEntries(FIELDS.map(({ key }) => [key, true])));
  const parsed = useMemo(() => {
    if (!analysedText.trim()) return null;
    return parseBom(analysedText, RCDDB.index(db), { skipDuplicates });
  }, [analysedText, db, skipDuplicates]);
  const rows = useMemo(() => {
    if (!parsed) return [];
    return parsed.entries.map(record => reportRow(db, record, language, t, includeReachVersion));
  }, [db, parsed, language, t, includeReachVersion]);
  const columnKeys = [
    'ITEM',
    ...(includeBomStructure ? ['BOM level'] : []),
    ...FIELDS.filter(field => selected[field.key]).map(field => field.label),
  ];
  const columns = columnKeys.map(key => key === 'ITEM' ? key : t(key));
  const reportRows = () => rows.map(row => Object.fromEntries(
    columns.map((column, index) => [
      column,
      row._structuralOnly && !['ITEM', 'BOM level'].includes(columnKeys[index])
        ? ''
        : row[columnKeys[index]] ?? t(missing),
    ]),
  ));
  const toggleField = (key, checked) => setSelected(current => ({ ...current, [key]: checked }));
  const analyze = () => setAnalysedText(text);

  const exportRows = reportRows;
  const downloadCsv = () => {
    const csvRows = [columns, ...exportRows().map(row => columns.map(column => row[column]))];
    const csv = `\uFEFF${csvRows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
    downloadFile(`material_status_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
  };
  const downloadJson = () => {
    downloadFile(
      `material_status_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(exportRows(), null, 2),
      'application/json;charset=utf-8',
    );
  };
  const print = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    const head = columns.map(column => `<th>${escapeHtml(column)}</th>`).join('');
    const body = exportRows().map((row, index) =>
      `<tr>${columns.map(column => {
        const indent = includeBomStructure && column === 'ITEM' ? ` style="padding-left:${6 + Math.min(rows[index]['BOM level'], 12) * 7}mm"` : '';
        return `<td${indent}>${escapeHtml(row[column])}</td>`;
      }).join('')}</tr>`,
    ).join('');
    const title = t('Material status report');
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      body{font:12px Arial,sans-serif;color:#111;padding:20px}h1{font-size:18px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:6px;text-align:left;vertical-align:top}
      th{background:#eee}tr{break-inside:avoid}
    </style></head><body><h1>${escapeHtml(title)}</h1><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t('Batch material status')}
      icon={<Search size={16} className="text-indigo-300" />}
      footer={parsed && (
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={downloadCsv} disabled={!rows.length} className={btnGhost}>
            <FileSpreadsheet size={14} /> {t('Download CSV')}
          </button>
          <button type="button" onClick={downloadJson} disabled={!rows.length} className={btnGhost}>
            <FileJson size={14} /> {t('Download JSON')}
          </button>
          <button type="button" onClick={print} disabled={!rows.length} className={btnPrimary}>
            <Printer size={14} /> {t('Print')}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="batch-status-bom" className="mb-1.5 block text-xs font-medium text-zinc-300">
            {t('Paste BOM items (same format as the questionnaire)')}
          </label>
          <textarea
            id="batch-status-bom"
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder={t('Paste BOM rows or item numbers, one per line.\n\n0015 903\n0-0165536-1\n0051001')}
            className={`${input} h-32 resize-y font-mono`}
          />
          <button type="button" onClick={analyze} disabled={!text.trim()} className={`${btnPrimary} mt-2`}>
            <Search size={14} /> {t('Analyze BOM')}
          </button>
        </div>

        <fieldset className="rounded-lg border border-zinc-800 p-3">
          <legend className="px-1 text-xs font-semibold text-zinc-300">{t('Include in report')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {FIELDS.map(field => (
              <Check key={field.key} checked={selected[field.key]} onChange={checked => toggleField(field.key, checked)}>
                {t(field.label)}
              </Check>
            ))}
          </div>
          {selected.reach && (
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <Check checked={includeReachVersion} onChange={setIncludeReachVersion}>
                {t('Include SVHC list version number')}
              </Check>
            </div>
          )}
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              <Check checked={includeBomStructure} onChange={setIncludeBomStructure}>{t('Rebuild BOM structure')}</Check>
              <Check checked={skipDuplicates} onChange={setSkipDuplicates}>{t('Skip duplicate items')}</Check>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">{t('BOM structure help')}</p>
          </div>
        </fieldset>

        {parsed && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
              <span>{t('Found in database:')} <b className="text-zinc-200">{rows.filter(row => row._found).length}</b></span>
              <span>{t('Not found:')} <b className="text-zinc-200">{rows.filter(row => !row._found).length}</b></span>
              <span>{t('Showing results only; no automatic download.')}</span>
            </div>
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-zinc-800">
              <table className="w-full min-w-max text-xs">
                <thead className="sticky top-0 bg-zinc-950 text-zinc-300">
                  <tr>{columns.map(column => <th key={column} className="border-b border-zinc-800 px-3 py-2 text-left">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {exportRows().map((row, index) => (
                    <tr key={`${row.ITEM}-${index}`} className="border-t border-zinc-800/70 align-top">
                      {columns.map(column => <td key={column} style={includeBomStructure && column === 'ITEM' ? { paddingLeft: `${12 + Math.min(rows[index]['BOM level'], 12) * 14}px` } : undefined} className="max-w-md whitespace-pre-wrap px-3 py-2 text-zinc-300">{row[column] ?? t(missing)}</td>)}
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-zinc-500">{t('No BOM items found to report.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
