import { useState } from 'react';
import { FileText, Loader2, Save, Upload } from 'lucide-react';
import { useI18n } from '../../lib/i18n-context.js';
import { DOCUMENT_TYPES, documentName } from '../../lib/documents.js';
import { btnGhost, btnPrimary, input } from '../ui/styles.js';
import { Modal } from '../ui/index.jsx';

export default function DocumentFormModal({ file, document, busy, error, onClose, onSave }) {
  const { t } = useI18n();
  const editing = Boolean(document);
  const [name, setName] = useState(() => editing ? documentName(document.n) : file.name);
  const [type, setType] = useState(() => document?.type || '');
  const [declarationDate, setDeclarationDate] = useState(() => document?.dt || '');
  const [validationError, setValidationError] = useState('');

  const submit = event => {
    event.preventDefault();
    let normalizedName = name.trim();
    if (!normalizedName) {
      setValidationError(t('Enter a PDF name.'));
      return;
    }
    if (!normalizedName.toLowerCase().endsWith('.pdf')) normalizedName += '.pdf';
    if (!type) {
      setValidationError(t('Select a document type.'));
      return;
    }
    setValidationError('');
    onSave({ name: normalizedName, type, declarationDate: declarationDate || null });
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={<FileText size={16} className="text-indigo-300" />}
      title={t(editing ? 'Edit document' : 'New document')}
      footer={(
        <>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>{t('Anuluj')}</button>
          <button type="submit" form="document-metadata-form" className={btnPrimary} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : editing ? <Save size={14} /> : <Upload size={14} />}
            {t(editing ? 'Save document changes' : 'Upload document')}
          </button>
        </>
      )}
    >
      <form id="document-metadata-form" onSubmit={submit} className="space-y-4">
        {(validationError || error) && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{validationError || error}</p>}
        {!editing && <p className="text-xs text-zinc-500">{t('Selected file')}: {file.name}</p>}
        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>{t('PDF name')}</span>
          <input autoFocus className={input} value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>{t('Declaration date')}</span>
          <input className={input} type="date" value={declarationDate} onChange={event => setDeclarationDate(event.target.value)} />
        </label>
        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>{t('Document type')}</span>
          <select className={input} value={type} onChange={event => setType(event.target.value)}>
            <option value="">{t('Select document type')}</option>
            {DOCUMENT_TYPES.map(value => <option key={value} value={value}>{t(value)}</option>)}
          </select>
        </label>
      </form>
    </Modal>
  );
}
