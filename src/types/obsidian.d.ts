declare module "obsidian" {
    interface MetadataCache {
        /**
         * Returns an object whose keys are tag names (including the leading
         * `#`) and whose values are the number of occurrences of that tag in
         * the vault.
         */
        getTags(): Record<string, number>;
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