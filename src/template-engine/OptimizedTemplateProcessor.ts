import { ParsedTemplate, Token, LiteralToken, VariableToken, DateToken, TemplateToken, Variables } from "./types";

/**
 * An aggressively-optimized, self-contained template processor that turns a
 * template string and a Variables map into the final rendered string using a
 * single parsing pass.  It purposefully does **not** depend on any Obsidian or
 * QuickAdd APIs so it can be unit-tested in isolation and, if needed, reused in
 * other contexts.
 */
export class OptimizedTemplateProcessor {
  /** Cache of frequently-used regular expressions. */
  private static readonly patternCache = new Map<string, RegExp>();
  /** Cache for fully-parsed template token streams. */
  private static readonly templateCache = new WeakMap<String, ParsedTemplate>();

  /**
   * Entry point – hand over a template string and variable map, receive the
   * rendered output.  Parsing is skipped if the template instance is already
   * cached.
   */
  public process(template: string, variables: Variables): string {
    let parsed = OptimizedTemplateProcessor.templateCache.get(template as unknown as String);

    if (!parsed) {
      parsed = this.parseTemplate(template);
      OptimizedTemplateProcessor.templateCache.set(template as unknown as String, parsed);
    }

    return this.renderTemplate(parsed, variables);
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Parsing helpers
  // ──────────────────────────────────────────────────────────────────────────

  private parseTemplate(template: string): ParsedTemplate {
    const tokens: Token[] = [];

    const pattern = this.getCompiledPattern("token");
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(template)) !== null) {
      // Add literal text before the current match.
      if (match.index > lastIndex) {
        tokens.push({ type: "literal", value: template.slice(lastIndex, match.index) } as LiteralToken);
      }

      const tokenContent = match[1].trim();
      tokens.push(this.parseToken(tokenContent));

      lastIndex = pattern.lastIndex;
    }

    // Trailing literal.
    if (lastIndex < template.length) {
      tokens.push({ type: "literal", value: template.slice(lastIndex) } as LiteralToken);
    }

    return { tokens, originalLength: template.length };
  }

  private parseToken(raw: string): Token {
    // Variable – {{VALUE:name}} or {{VALUE:name|default}}
    if (/^value:/i.test(raw)) {
      const [, body] = raw.split(/:/i);
      const [name, defaultValue] = body.split(/\|/);
      return {
        type: "variable",
        name: name.trim(),
        defaultValue: defaultValue?.trim(),
      } as VariableToken;
    }

    // Date – {{DATE}}  or {{DATE:yyyy-MM-dd}} or {{DATE+3}}
    if (/^date/i.test(raw)) {
      // Strip leading DATE (case-insensitive)
      const rest = raw.slice(4).replace(/^:/, "").trim();

      let format: string | undefined;
      let offset: number | undefined;

      // Look for offset (e.g. +3  or  -10 ) at the end, separated by + or -
      const offsetMatch = rest.match(/([+-]\d+)$/);
      if (offsetMatch) {
        offset = parseInt(offsetMatch[1], 10);
        format = rest.slice(0, -offsetMatch[1].length).replace(/[: ]+$/, "");
      } else {
        format = rest;
      }

      if (format === "") format = undefined;

      return { type: "date", format, offset } as DateToken;
    }

    // Template – {{TEMPLATE:path/to/file.md}}
    if (/^template:/i.test(raw)) {
      const [, path] = raw.split(/:/i);
      return { type: "template", path: path.trim() } as TemplateToken;
    }

    // Fallback – treat unknown constructs as literal text including braces.
    return { type: "literal", value: `{{${raw}}}` } as LiteralToken;
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Rendering helpers
  // ──────────────────────────────────────────────────────────────────────────

  private renderTemplate(parsed: ParsedTemplate, variables: Variables): string {
    const parts = new Array<string>(parsed.tokens.length);

    for (let i = 0; i < parsed.tokens.length; i++) {
      const token = parsed.tokens[i];
      switch (token.type) {
        case "literal":
          parts[i] = token.value;
          break;
        case "variable":
          parts[i] = this.resolveVariable(token, variables);
          break;
        case "date":
          parts[i] = this.formatDate(token);
          break;
        case "template":
          parts[i] = this.includeTemplate(token, variables);
          break;
      }
    }

    return parts.join("");
  }

  private resolveVariable(token: VariableToken, variables: Variables): string {
    const value = variables[token.name];
    if (value === undefined || value === null || value === "") {
      return token.defaultValue ?? "";
    }
    return String(value);
  }

  private formatDate(token: DateToken): string {
    const date = new Date();
    if (typeof token.offset === "number" && !Number.isNaN(token.offset)) {
      date.setDate(date.getDate() + token.offset);
    }

    const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);

    if (!token.format) {
      // ISO yyyy-MM-dd to keep things predictable.
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    }

    // Very small formatter supporting a handful of patterns used in tests.
    // For anything more sophisticated we'd plug in dayjs/moment, but that's
    // outside the scope of this low-level utility.
    return token.format
      .replace(/yyyy/g, String(date.getFullYear()))
      .replace(/MM/g, two(date.getMonth() + 1))
      .replace(/dd/g, two(date.getDate()))
      .replace(/HH/g, two(date.getHours()))
      .replace(/mm/g, two(date.getMinutes()))
      .replace(/ss/g, two(date.getSeconds()));
  }

  /**
   * Nested {{TEMPLATE:<path>}} include.  In this core engine we don't have
   * access to the Obsidian vault, so we simply leave a placeholder that the
   * higher-level formatter can post-process.  This keeps the engine entirely
   * decoupled from IO concerns.
   */
  private includeTemplate(token: TemplateToken, _variables: Variables): string {
    return `{{TEMPLATE:${token.path}}}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Misc
  // ──────────────────────────────────────────────────────────────────────────

  private getCompiledPattern(name: string): RegExp {
    const cached = OptimizedTemplateProcessor.patternCache.get(name);
    if (cached) return cached;

    let pattern: RegExp;
    switch (name) {
      case "token":
      default:
        // Global, capturing group #1 is the inside-of-braces content.
        pattern = /{{([^}]+)}}/g;
        break;
    }

    OptimizedTemplateProcessor.patternCache.set(name, pattern);
    return pattern;
  }
}