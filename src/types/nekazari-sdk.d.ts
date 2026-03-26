/**
 * Minimal typings for @nekazari/sdk in this repo (devDependency / host-provided at runtime).
 */

declare module '@nekazari/sdk' {
  import type { ComponentType, ReactNode } from 'react';

  export const i18n: {
    t: (key: string, options?: Record<string, unknown> & { ns?: string }) => string;
    language?: string;
    addResourceBundle?: (
      lng: string,
      ns: string,
      resources: Record<string, unknown>,
      deep?: boolean,
      overwrite?: boolean
    ) => unknown;
  };

  export function useTranslation(ns?: string): {
    t: (key: string, options?: Record<string, unknown>) => string;
    i18n: typeof i18n;
  };

  export type ModuleViewerSlots = any;
}
