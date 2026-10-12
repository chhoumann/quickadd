export const guards = [
	{
		"selector": "CallExpression[callee.type=\"MemberExpression\"][callee.property.name=\"createElement\"]",
		"message": "Use Obsidian DOM helpers; use the owner document window for detached elements."
	},
	{
		"selector": "CallExpression[callee.property.name=\"createDocumentFragment\"]",
		"message": "Use createFragment(), or the owner document window for a specific realm."
	},
	{
		"selector": "CallExpression:matches([callee.name=\"createEl\"], [callee.property.name=\"createEl\"])[arguments.0.value=/^(div|span)$/]",
		"message": "Use createDiv() or createSpan() for these tags."
	},
	{
		"selector": "BinaryExpression[operator=\"instanceof\"][right.name=\"HTMLElement\"]",
		"message": "Use node.instanceOf(HTMLElement) for cross-window checks."
	},
	{
		"selector": "CallExpression[callee.type=\"MemberExpression\"][callee.property.name=\"setDynamicTooltip\"]",
		"message": "Slider values are shown inline; setDynamicTooltip has no effect."
	},
	{
		"selector": "Literal[regex.pattern=/\\(\\?<[=!]/]",
		"message": "No regex lookbehind: iOS before 16.4 cannot parse it, and Obsidian runs on iOS 15.6, so QuickAdd would not load at all."
	},
	{
		"selector": "AssignmentExpression[left.object.type=\"MemberExpression\"][left.object.computed=false][left.object.property.name=\"style\"][right.type=\"Literal\"]",
		"message": "Put a static style in styles.css; set a computed one with setCssStyles, or a CSS variable with setCssProps."
	},
	{
		"selector": "CallExpression[callee.property.name=\"setProperty\"][callee.object.property.name=\"style\"][arguments.1.type=\"Literal\"]",
		"message": "Put a static style in styles.css; set a computed one with setCssStyles, or a CSS variable with setCssProps."
	},
	{
		"selector": "CallExpression[callee.property.name=\"setAttribute\"][arguments.0.value=\"style\"][arguments.1.type=\"Literal\"]",
		"message": "Put a static style in styles.css; set a computed one with setCssStyles, or a CSS variable with setCssProps."
	},
	{
		"selector": "CallExpression[callee.property.name=/^setCss(Props|Styles)$/] > ObjectExpression > Property[key.type=\"Literal\"][key.value=/^(?!--)/]",
		"message": "Put a static style in styles.css; set a computed one with setCssStyles, or a CSS variable with setCssProps."
	}
];

export const svelteInternalGuards = [
	{
		selector: ':matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^svelte\\/internal(\\/|$)/]',
		message: "Use Svelte's public API instead of svelte/internal.",
	},
];

export const svelteRunesGuards = [
	{
		selector: ':matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value="svelte/store"]',
		message: "Use Svelte runes for component state instead of legacy stores.",
	},
	{
		selector: 'ImportDeclaration[source.value="svelte"] > ImportSpecifier[imported.name="createEventDispatcher"]',
		message: "Use callback props instead of createEventDispatcher.",
	},
];

export const svelteImportGuards = [...svelteInternalGuards, ...svelteRunesGuards];

export const svelteDebugGuards = [
	{
		selector: 'CallExpression:matches([callee.name="$inspect"], [callee.object.name="$inspect"])',
		message: "Remove $inspect before shipping.",
		rule: "no-inspect",
		severity: "warning",
	},
];

function createGuards(context, checks) {
	return Object.fromEntries(checks.map(({ selector, message }) => [
		selector,
		(node) => context.report({ node, message }),
	]));
}

export default {
	meta: { name: "quickadd" },
	rules: {
		"restricted-syntax": {
			meta: { type: "problem", schema: [] },
			create(context) {
				return createGuards(context, guards);
			},
		},
		"svelte-internal": {
			meta: { type: "problem", schema: [] },
			create(context) {
				return createGuards(context, svelteInternalGuards);
			},
		},
		"svelte-runes": {
			meta: { type: "problem", schema: [] },
			create(context) {
				return createGuards(context, svelteRunesGuards);
			},
		},
		"svelte-debug": {
			meta: { type: "problem", schema: [] },
			create(context) {
				return createGuards(context, svelteDebugGuards);
			},
		},
	},
};
