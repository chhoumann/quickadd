declare module "obsidian" {
    interface MetadataCache {
        /**
         * Returns an object whose keys are tag names (including the leading
         * `#`) and whose values are the number of occurrences of that tag in
         * the vault.
         */
        getTags(): Record<string, number>;

        /**
         * Register an event listener for the given metadata cache event.
         * The concrete list of events is managed by Obsidian internally. For
         * the QuickAdd code-base we only need the return type to be
         * compatible with `registerEvent` which treats the returned value as
         * an opaque *event reference* used for deregistration.
         */
        on(name: string, callback: (...args: any[]) => unknown): unknown;

        /** Collection of unresolved links, exposed by Obsidian. */
        unresolvedLinks: Record<string, Record<string, number>>;

        /** Retrieve the cached metadata for a file. */
        getFileCache(pathOrFile: string | unknown): unknown;
    }
}

// Extend the `App` interface with the members that QuickAdd relies on but are
// not present (or not typed) in the official Obsidian declarations.

declare module "obsidian" {
    interface App {
        /** The global metadata cache instance. */
        metadataCache: MetadataCache;

        /** Various DOM references exposed by Obsidian's app. */
        dom: {
            /** The root (scroll) container for the app. */
            appContainerEl: HTMLElement;
        };

        /** Keymap helper for temporarily overriding keyboard shortcuts. */
        keymap: {
            pushScope(scope: import("obsidian").Scope): void;
            popScope(scope: import("obsidian").Scope): void;
        };
    }
}

// If, for some reason, `Scope` is not re-exported correctly from the original
// Obsidian type declarations, we provide a minimal fallback so that imports
// like `import { Scope } from "obsidian"` continue to work. This *will* be
// merged with the real declaration when available, so defining a subset here
// is safe.

declare module "obsidian" {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    export interface Scope {}
}