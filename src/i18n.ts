import { i18n } from '@nekazari/sdk';
import en from './locales/en.json';
import es from './locales/es.json';

const DATAHUB_NAMESPACE = 'datahub';

export function registerDataHubTranslations(): void {
  const add = i18n && 'addResourceBundle' in i18n ? i18n.addResourceBundle : undefined;
  if (typeof add !== 'function') return;
  add.call(i18n, 'en', DATAHUB_NAMESPACE, en, true, true);
  add.call(i18n, 'es', DATAHUB_NAMESPACE, es, true, true);
}

registerDataHubTranslations();
