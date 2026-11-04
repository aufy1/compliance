import { fold } from './utils.js';

const TIMESTAMPED_DOCUMENT_NAME = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})__(.+)$/;

export const DOCUMENT_TYPES = [
  'RCD',
  'PPWR',
  'RoHS',
  'REACH',
  'CA Prop 65',
  'TSCA',
  'PFAS',
  'Specification',
  'Drawing',
  'FMD',
];
export const DOCUMENTS_UPDATED_EVENT = 'compliance:documents-updated';
export const foldDocumentSearch = fold;

export function notifyDocumentsUpdated() {
  window.dispatchEvent(new Event(DOCUMENTS_UPDATED_EVENT));
}

export function documentName(name) {
  return TIMESTAMPED_DOCUMENT_NAME.exec(name)?.[5] || name;
}

export function documentAddedAt(name, locale) {
  const match = TIMESTAMPED_DOCUMENT_NAME.exec(name);
  if (!match) return '';
  const [, date, hours, minutes, seconds] = match;
  const addedAt = new Date(`${date}T${hours}:${minutes}:${seconds}Z`);
  if (Number.isNaN(addedAt.getTime())) return '';
  return addedAt.toLocaleString(locale);
}
