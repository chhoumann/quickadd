import type { App, TFile } from "obsidian";
import { TextInputSuggest } from "./suggest";
import { FieldSuggestionParser, type FieldFilter } from "src/utils/FieldSuggestionParser";
import { DataviewIntegration } from "src/utils/DataviewIntegration";
import { EnhancedFieldSuggestionFileFilter } from "src/utils/EnhancedFieldSuggestionFileFilter";
import { FieldSuggestionCache } from "src/utils/FieldSuggestionCache";
import { FieldValueProcessor } from "src/utils/FieldValueProcessor";

export class FieldValueInputSuggest extends TextInputSuggest<string> {
  private readonly fieldInput: string;
  private readonly fieldName: string;
  private readonly filters: FieldFilter;
  private cachedValues: string[] | null = null;

  constructor(app: App, inputEl: HTMLInputElement, fieldInput: string) {
    super(app, inputEl);
    this.fieldInput = fieldInput;
    const parsed = FieldSuggestionParser.parse(fieldInput);
    this.fieldName = parsed.fieldName;
    this.filters = parsed.filters;
  }

  async getSuggestions(inputStr: string): Promise<string[]> {
    if (!this.cachedValues) {
      this.cachedValues = await this.collectValues();
    }

    const query = (inputStr || "").toLowerCase();
    if (!query) return this.cachedValues.slice(0, 200);
    return this.cachedValues.filter((v) => v.toLowerCase().includes(query)).slice(0, 200);
  }

  renderSuggestion(item: string, el: HTMLElement): void {
    el.innerHTML = this.renderMatch(item, this.getCurrentQuery());
  }

  selectSuggestion(item: string): void {
    // Fill input and dispatch a synthetic input event to trigger onChange listeners
    this.inputEl.value = item;
    const event = new Event("input", { bubbles: true });
    (event as any).fromCompletion = true;
    this.inputEl.dispatchEvent(event);
    this.close();
  }

  private async collectValues(): Promise<string[]> {
    const cache = FieldSuggestionCache.getInstance();
    const cacheKey = this.generateCacheKey(this.filters);
    const cached = cache.get(this.fieldName, cacheKey);
    if (cached) {
      return Array.from(cached).sort();
    }

    let rawValues = new Set<string>();

    try {
      if (!this.filters.inline && DataviewIntegration.isAvailable(this.app)) {
        rawValues = await DataviewIntegration.getFieldValuesWithFilter(
          this.app,
          this.fieldName,
          this.filters.folder,
          this.filters.tags,
          this.filters.excludeFolders,
          this.filters.excludeTags
        );

        if (rawValues.size === 0) {
          rawValues = await this.collectValuesManually();
        }
      } else {
        rawValues = await this.collectValuesManually();
      }
    } catch {
      // Ignore errors and fall back to empty list
    }

    cache.set(this.fieldName, rawValues, cacheKey);

    const processed = FieldValueProcessor.processValues(rawValues, this.filters);
    return processed.values;
  }

  private async collectValuesManually(): Promise<Set<string>> {
    const result = new Set<string>();
    // Get all markdown files and apply filtering
    let files = this.app.vault.getMarkdownFiles();
    files = EnhancedFieldSuggestionFileFilter.filterFiles(
      files,
      this.filters,
      (file: TFile) => this.app.metadataCache.getFileCache(file)
    );

    const batchSize = 50;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const proms = batch.map(async (file) => {
        const values = new Set<string>();
        try {
          const metadataCache = this.app.metadataCache.getFileCache(file);
          const v: unknown = metadataCache?.frontmatter?.[this.fieldName];
          if (v !== undefined && v !== null) {
            if (Array.isArray(v)) {
              v.forEach((x) => {
                const s = String(x).trim();
                if (s) values.add(s);
              });
            } else if (typeof v !== "object") {
              const s = String(v).trim();
              if (s) values.add(s);
            }
          }

          if (this.filters.inline) {
            try {
              const content = await this.app.vault.read(file);
              const regex = new RegExp(`\\b${this.escapeRegex(this.fieldName)}\\s*::\\s*([^\n]+)`, "gi");
              let m: RegExpExecArray | null;
              while ((m = regex.exec(content)) !== null) {
                const s = (m[1] || "").trim();
                if (s) values.add(s);
              }
            } catch {}
          }
        } catch {}
        return values;
      });

      const batchResults = await Promise.all(proms);
      for (const vset of batchResults) {
        for (const v of vset) result.add(v);
      }
    }

    return result;
  }

  private generateCacheKey(filters: FieldFilter): string {
    const parts: string[] = [];
    if (filters.folder) parts.push(`folder:${filters.folder}`);
    if (filters.tags) parts.push(`tags:${filters.tags.join(",")}`);
    if (filters.inline) parts.push("inline:true");
    if (filters.caseSensitive) parts.push("case-sensitive:true");
    if (filters.excludeFolders) parts.push(`exclude-folders:${filters.excludeFolders.join(",")}`);
    if (filters.excludeTags) parts.push(`exclude-tags:${filters.excludeTags.join(",")}`);
    if (filters.excludeFiles) parts.push(`exclude-files:${filters.excludeFiles.join(",")}`);
    if (filters.defaultValue) parts.push(`default:${filters.defaultValue}`);
    if (filters.defaultEmpty) parts.push("default-empty:true");
    if (filters.defaultAlways) parts.push("default-always:true");
    return parts.join("|");
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
