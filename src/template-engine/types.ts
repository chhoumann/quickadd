export type Variables = Record<string, unknown>;

export interface ParsedTemplate {
  /**
   * Array of tokens (literals, variables, dates, nested templates …) that were
   * discovered in a single pass over the template string.
   */
  tokens: Token[];
  /**
   * Original template length.  Exposed so the renderer can make informed
   * allocation decisions (e.g. pre-sizing output buffers).
   */
  originalLength: number;
}

export type Token =
  | LiteralToken
  | VariableToken
  | DateToken
  | TemplateToken;

export interface LiteralToken {
  type: "literal";
  value: string;
}

export interface VariableToken {
  type: "variable";
  /**
   * Name of the variable inside the {{VALUE:name}} construct.
   */
  name: string;
  /**
   * Optional default specified via {{VALUE:name|default}}.
   */
  defaultValue?: string;
}

export interface DateToken {
  type: "date";
  /** Optional custom format: {{DATE:yyyy-MM-dd}} */
  format?: string;
  /** Optional day offset specified with +N / -N. */
  offset?: number;
}

export interface TemplateToken {
  type: "template";
  /** Relative path used in {{TEMPLATE:someFile.md}} */
  path: string;
}