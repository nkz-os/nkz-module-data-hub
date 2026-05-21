import { defineModule } from '@nekazari/module-kit';
import { lazy } from 'react';
import { moduleSlots } from './slots';
import pkg from '../package.json';
import en from './locales/en.json';
import es from './locales/es.json';

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
