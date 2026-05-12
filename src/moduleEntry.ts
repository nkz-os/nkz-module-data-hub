import { defineModule } from '@nekazari/module-kit';
import './i18n';
import { moduleSlots } from './slots';
import DataHubPage from './DataHubPage';
import pkg from '../package.json';

const MODULE_ID = 'datahub';

const moduleConfig = defineModule({
  id: MODULE_ID,
  displayName: 'DataHub',
  accent: { base: '#0EA5E9', soft: '#E0F2FE', strong: '#0369A1' },
  hostApiVersion: '^2.0.0',
  api: { basePath: '/api/datahub' },
});

if (typeof window !== 'undefined' && window.__NKZ__) {
  window.__NKZ__.register({
    id: MODULE_ID,
    viewerSlots: moduleSlots,
    main: DataHubPage,
    version: pkg.version,
  });
}

export default moduleConfig;
