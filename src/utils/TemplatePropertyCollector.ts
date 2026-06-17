import type { App } from "obsidian";
import { findYamlFrontMatterRange, getYamlContextForMatch } from "./yamlContext";
import {
	parseStructuredPropertyValueFromString,
	type ParseOptions,
} from "./templatePropertyStringParser";
import { isContainerYamlValue, isStructuredYamlValue } from "./yamlValues";

const PATH_SEPARATOR = "\u0000";

type CollectArgs = {
  input: string;
  matchStart: number;
  matchEnd: number;
  rawValue: unknown;
  fallbackKey: string;
  /**
   * Whether collection is active at all (inside a withTemplatePropertyCollection
   * scope). Collecting already-structured values (arrays/objects/numbers/booleans)
   * for a native processFrontMatter pass is always-on so scripts that return real
   * arrays produce valid Obsidian properties regardless of the beta toggle.
   */
  collectionActive: boolean;
  /**
   * Whether the opt-in string -> structured heuristic may run (turning a comma /
   * bullet-list string into a List, "42" into a Number, etc.). Gated by the
   * `enableTemplatePropertyTypes` setting because it changes a value's type.
   */
  heuristicEnabled: boolean;
};

export class TemplatePropertyCollector {
  private map = new Map<string, unknown>();
  private propertyTypeCache = new Map<string, string | null>();

  constructor(private readonly app?: App) {}

  /**
   * Collects a variable for YAML post-processing when it is a complete value for a YAML key
   * and the raw value is a structured type (object/array/number/boolean/null).
   */
  public maybeCollect(args: CollectArgs): unknown {
    const { input, matchStart, matchEnd, rawValue, fallbackKey, collectionActive, heuristicEnabled } = args;
    if (!collectionActive) return undefined;
    const yamlRange = findYamlFrontMatterRange(input);
    const context = getYamlContextForMatch(input, matchStart, matchEnd, yamlRange);

    if (!context.isInYaml) return undefined;

    const lineContent = input.slice(context.lineStart, context.lineEnd);
    const trimmedLine = lineContent.trim();

    const propertyKeyMatch = lineContent.match(/^\s*([^:]+):/);
    const fallbackPathKey = propertyKeyMatch ? propertyKeyMatch[1].trim() : fallbackKey;

	const listItemPattern = /^-\s*['"]?\{\{(?:VALUE|FIELD):[^}]+\}\}['"]?\s*$/i;
    let propertyPath: string[] | null = null;

    if (context.isKeyValuePosition) {
      propertyPath = [fallbackPathKey];
    } else if (listItemPattern.test(trimmedLine)) {
      propertyPath = this.findListParentPath(input, context.lineStart, context.baseIndent ?? "");
    }

    if (!propertyPath || propertyPath.length === 0) return undefined;
    const effectiveKey = propertyPath[propertyPath.length - 1];

    let structuredValue = rawValue;

    // The string -> structured heuristic is opt-in: it changes a value's type
    // (comma/bullet string -> List, "42" -> Number). Real arrays/objects from
    // scripts skip this branch and are collected as-is below.
    if (heuristicEnabled && typeof rawValue === "string") {
      const parsed = parseStructuredPropertyValueFromString(rawValue, this.buildParseOptions(effectiveKey));
      if (parsed !== undefined) {
        structuredValue = parsed;
      }
    }

    if (!isStructuredYamlValue(structuredValue)) return undefined;

    // Always-on (flag-off) collection is limited to container types
    // (arrays/objects) that break when inlined as text. Scalars
    // (number/boolean/null) are already YAML-safe inline, so they are only
    // collected under the opt-in heuristic to avoid forcing a whole-frontmatter
    // rewrite (which would strip comments / normalise quoting) for no benefit.
    if (!heuristicEnabled && !isContainerYamlValue(structuredValue)) return undefined;

    const mapKey = propertyPath.join(PATH_SEPARATOR);
    this.map.set(mapKey, structuredValue);
    return structuredValue;
  }

  /** Returns a copy and clears the collector. */
  public drain(): Map<string, unknown> {
    const result = new Map(this.map);
    this.map.clear();
    return result;
  }

	public merge(vars: Map<string, unknown>): void {
		for (const [key, value] of vars) {
			this.map.set(key, value);
		}
	}

  private buildParseOptions(propertyKey: string): ParseOptions {
    return {
      propertyKey,
      propertyType: this.resolvePropertyType(propertyKey),
      app: this.app,
    };
  }

  private findListParentPath(input: string, currentLineStart: number, currentIndent: string): string[] | null {
    let endIndex = currentLineStart - 1;
    const path: string[] = [];
    let targetIndent = currentIndent.length;

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
        const indentLength = indent.length;

        if (indentLength < targetIndent) {
          path.unshift(keyMatch[2].trim());
          targetIndent = indentLength;
          if (targetIndent === 0) {
            break;
          }
        }
      }

      endIndex = lineStart - 2;
    }

    return path.length > 0 ? path : null;
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

  public static readonly PATH_SEPARATOR = PATH_SEPARATOR;
}
