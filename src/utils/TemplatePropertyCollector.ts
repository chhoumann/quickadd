import type { App } from "obsidian";
import { findYamlFrontMatterRange, getYamlContextForMatch } from "./yamlContext";
import {
	parseStructuredPropertyValueFromString,
	type ParseOptions,
} from "./templatePropertyStringParser";

type CollectArgs = {
  input: string;
  matchStart: number;
  matchEnd: number;
  rawValue: unknown;
  fallbackKey: string;
  featureEnabled: boolean;
};

export class TemplatePropertyCollector {
  private map = new Map<string, unknown>();
  private propertyTypeCache = new Map<string, string | null>();

  constructor(private readonly app?: App) {}

  /**
   * Collects a variable for YAML post-processing when it is a complete value for a YAML key
   * and the raw value is a structured type (object/array/number/boolean/null).
   */
  public maybeCollect(args: CollectArgs): void {
    const { input, matchStart, matchEnd, rawValue, fallbackKey, featureEnabled } = args;
    if (!featureEnabled) return;
    const yamlRange = findYamlFrontMatterRange(input);
    const context = getYamlContextForMatch(input, matchStart, matchEnd, yamlRange);

    if (!context.isInYaml) return;

    const lineContent = input.slice(context.lineStart, context.lineEnd);
    const trimmedLine = lineContent.trim();

    const propertyKeyMatch = lineContent.match(/^\s*([^:]+):/);
    let propertyKey = propertyKeyMatch ? propertyKeyMatch[1].trim() : fallbackKey;

    const listItemPattern = /^-\s*['"]?\{\{VALUE:[^}]+\}\}['"]?\s*$/i;
    let isListContext = false;

    if (!context.isKeyValuePosition && listItemPattern.test(trimmedLine)) {
      const parentKey = this.findListParentKey(input, context.lineStart, context.baseIndent ?? "");
      if (parentKey) {
        propertyKey = parentKey;
        isListContext = true;
      }
    }

    if (!context.isKeyValuePosition && !isListContext) return;

    let structuredValue = rawValue;

    if (typeof rawValue === "string") {
      const parsed = parseStructuredPropertyValueFromString(rawValue, this.buildParseOptions(propertyKey));
      if (parsed !== undefined) {
        structuredValue = parsed;
      }
    }

    const isStructured =
      typeof structuredValue !== "string" &&
      (Array.isArray(structuredValue) ||
        (typeof structuredValue === "object" && structuredValue !== null) ||
        typeof structuredValue === "number" ||
        typeof structuredValue === "boolean" ||
        structuredValue === null);
    if (!isStructured) return;

    this.map.set(propertyKey, structuredValue);
  }

  /** Returns a copy and clears the collector. */
  public drain(): Map<string, unknown> {
    const result = new Map(this.map);
    this.map.clear();
    return result;
  }

  private buildParseOptions(propertyKey: string): ParseOptions {
    return {
      propertyKey,
      propertyType: this.resolvePropertyType(propertyKey),
      app: this.app,
    };
  }

  private findListParentKey(input: string, currentLineStart: number, currentIndent: string): string | null {
    let endIndex = currentLineStart - 1;

    while (endIndex >= 0) {
      const lineBreak = input.lastIndexOf("\n", endIndex);
      const lineStart = lineBreak === -1 ? 0 : lineBreak + 1;
      const line = input.slice(lineStart, endIndex + 1);
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        endIndex = lineStart - 2;
        continue;
      }

      if (trimmed === "---" || trimmed === "...") {
        break;
      }

      if (trimmed.startsWith("-")) {
        endIndex = lineStart - 2;
        continue;
      }

      const keyMatch = line.match(/^(\s*)([^:\n]+):/);
      if (keyMatch) {
        const indent = keyMatch[1] ?? "";
        if (currentIndent.length >= indent.length) {
          return keyMatch[2].trim();
        }
      }

      endIndex = lineStart - 2;
    }

    return null;
  }

  private resolvePropertyType(propertyKey: string): string | null {
    if (!this.app) return null;
    if (this.propertyTypeCache.has(propertyKey)) {
      return this.propertyTypeCache.get(propertyKey) ?? null;
    }

    const appAny = this.app as unknown as {
      metadataTypeManager?: { getTypeInfo?: (key: string) => unknown };
      metadataCache?: { app?: { metadataTypeManager?: { getTypeInfo?: (key: string) => unknown } } };
    };

    const manager =
      appAny.metadataTypeManager ?? appAny.metadataCache?.app?.metadataTypeManager;

    if (!manager || typeof manager.getTypeInfo !== "function") {
      this.propertyTypeCache.set(propertyKey, null);
      return null;
    }

    const info = manager.getTypeInfo(propertyKey) as
      | {
          expected?: { type?: string } | null;
          inferred?: { type?: string } | null;
        }
      | undefined;

    const type = info?.expected?.type ?? info?.inferred?.type ?? null;
    const normalized = typeof type === "string" ? type : null;
    this.propertyTypeCache.set(propertyKey, normalized);
    return normalized;
  }
}
