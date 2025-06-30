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