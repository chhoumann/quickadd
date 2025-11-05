/**
 * Global constants injected at build time by esbuild.
 * These are only populated in development builds and are null/false in production.
 */
declare const __IS_DEV_BUILD__: boolean;
declare const __DEV_GIT_BRANCH__: string | null;
declare const __DEV_GIT_COMMIT__: string | null;
declare const __DEV_GIT_DIRTY__: boolean | null;
