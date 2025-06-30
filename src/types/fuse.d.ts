declare module "fuse.js" {
    /** A single search result from Fuse.js */
    export interface FuseResult<T> {
        item: T;
        /** Index of the item in the original collection */
        refIndex: number;
        /** Normalised score (0 = perfect match, 1 = no match). */
        score?: number;
        /** Optional matches metadata when `includeMatches` is enabled. */
        matches?: Array<{
            key?: string | string[];
            value?: string;
            indices: Array<[number, number]>;
        }>;
    }

    /** Core options supported by Fuse.js – trimmed down to what QuickAdd uses. */
    export interface FuseOptions<T> {
        /** Include the score in the result set. */
        includeScore?: boolean;
        /** Include match metadata in the result set. */
        includeMatches?: boolean;
        /** Threshold for the fuzzy search (0–1). */
        threshold?: number;
        /** Keys (properties) to search within the items. */
        keys?: Array<keyof T | string>;
    }

    /** Additional options that can be supplied to the `search` method. */
    export interface FuseSearchOptions {
        /** Maximum number of results to return. */
        limit?: number;
    }

    /** Minimal class definition sufficient for QuickAdd. */
    export default class Fuse<T> {
        constructor(list: readonly T[] | T[], options?: FuseOptions<T>);

        /**
         * Perform a fuzzy search.
         * @param pattern The pattern to search for
         * @param opts    Optional search options (e.g. limit)
         */
        search(pattern: string, opts?: FuseSearchOptions): FuseResult<T>[];

        /** Replace the underlying collection with a new one. */
        setCollection(list: readonly T[] | T[]): void;

        /** Add a single item to the collection. */
        add(item: T): void;

        /** Remove items matching the predicate from the collection. */
        remove(pred: (item: T) => boolean): void;
    }

    /* Allow qualified access like Fuse.FuseResult */
    export namespace Fuse {
        export type FuseResult<T> = import("fuse.js").FuseResult<T>;
        export type FuseOptions<T> = import("fuse.js").FuseOptions<T>;
        export type FuseSearchOptions = import("fuse.js").FuseSearchOptions;
    }
}