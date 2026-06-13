/**
 * Whether a template path contains QuickAdd format syntax, e.g.
 * "Templates/{{value:type}} Template.md" (issue #620). Such a path can only be
 * resolved at run time, so edit-time validators and preflight scanning treat it
 * specially: the choice-builder shows a neutral "resolved at run time" hint
 * instead of a false "not found", and preflight collects the path's own tokens
 * rather than trying to read a file that does not exist yet.
 *
 * Deliberately broad — any `{{...}}` token, even an unsupported one. We cannot
 * fully validate a token at edit time, and a wrong token simply fails visibly
 * when the choice runs.
 */
export function hasTemplatePathSyntax(path: string): boolean {
	return /\{\{[^}]*\}\}/.test(path);
}
