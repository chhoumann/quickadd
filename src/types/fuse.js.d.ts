declare module "fuse.js" {
  // re-export to satisfy tsc in case bundled types missing
  export interface FuseOptions<T> {
    keys: Array<string | { name: keyof T; weight: number }>;
    threshold?: number;
    ignoreLocation?: boolean;
    findAllMatches?: boolean;
    shouldSort?: boolean;
    includeMatches?: boolean;
  }

  export default class Fuse<T> {
    constructor(list: ReadonlyArray<T>, options?: FuseOptions<T>);
    add(item: T): void;
    setCollection(list: ReadonlyArray<T>): void;
    remove(predicate: (item: T) => boolean): void;
    search(pattern: string, options?: unknown): unknown;
  }
}