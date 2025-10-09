/**
 * Decodes common escape sequences (e.g., \n, \t, \\) used within variable hint arguments.
 */
export function decodeEscapedCharacters(input: string): string {
  return input
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}
