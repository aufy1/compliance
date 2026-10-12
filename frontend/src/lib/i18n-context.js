import { createContext, useContext } from 'react';

export const LanguageContext = createContext(null);

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useI18n must be used within LanguageProvider');
  return context;
}
