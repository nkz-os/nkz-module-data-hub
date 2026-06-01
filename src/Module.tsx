import { defineModule } from '@nekazari/module-kit';
import { lazy } from 'react';
import { i18n } from '@nekazari/sdk';
import { moduleSlots } from './slots';
import pkg from '../package.json';
import en from './locales/en.json';
import es from './locales/es.json';

// Register translations with the shared i18next singleton.
// The host initializes i18next with HTTP backend (loadPath: '/locales/{{lng}}/{{ns}}.json'),
// but module translations are bundled in JS — they must be added via addResourceBundle().
// Without this, useTranslation('datahub') falls through to a failed HTTP fetch and returns
// the raw key string.
// Guard: only runs in browser (typeof window !== 'undefined') and when the i18n singleton
// has been properly initialized (addResourceBundle is available). The build-time manifest
// emitter runs this module in Node.js where the shared i18next singleton is not yet wired.
if (typeof window !== 'undefined' && typeof i18n?.addResourceBundle === 'function') {
  i18n.addResourceBundle('en', 'datahub', en, true, true);
  i18n.addResourceBundle('es', 'datahub', es, true, true);
}

const DataHubPage = lazy(() => import('./DataHubPage'));

export default defineModule({
  id: 'datahub',
  displayName: 'DataHub',
  version: pkg.version,
  hostApiVersion: '^2.0.0',
  description: 'High-performance analytical canvas to cross variables from any source, export ranges, and run predictive models via Intelligence',
  accent: { base: '#0EA5E9', soft: '#E0F2FE', strong: '#0369A1' },
  icon: 'line-chart',
  main: DataHubPage,
  route: '/datahub',
  navigation: {
    section: 'modules',
    priority: 55,
  },
  api: { basePath: '/api/datahub' },
  requiredRoles: ['Farmer', 'TenantAdmin', 'PlatformAdmin'],
  requiredPlan: 'basic',
  slots: moduleSlots,
  i18n: { en, es },
  data: {
    entities: ['AgriParcel', 'DataHubWorkspace'],
    timeseries: ['*'],
  },
});
