declare module 'obsidian-dataview' {
  import type { App } from 'obsidian';

  // The real Dataview API is too large to pull in; we just need placeholders
  // so that QuickAdd can compile under strict TS without the Dataview plugin
  // actually being present in node_modules.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  export type DataviewApi = any;
  export function getAPI(app: App): DataviewApi | null;
}