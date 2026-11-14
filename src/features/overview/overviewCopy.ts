import type { Language } from '../../types/platform'
export const localeFor = (language: Language) => language === 'de' ? 'de-DE' : 'en-GB'
