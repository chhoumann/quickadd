import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esquery from "esquery";
import { compile, parse } from "svelte/compiler";
import { guards, svelteDebugGuards, svelteImportGuards } from "./oxlint-plugin.mjs";

const selectors = [...guards, ...svelteImportGuards, ...svelteDebugGuards].map(check => ({
	...check,
	query: esquery.parse(check.selector),
}));
const domMethods = new Set([
	"appendChild", "insertBefore", "normalize", "removeChild", "replaceChild",
	"after", "append", "before", "insertAdjacentElement", "insertAdjacentHTML",
	"insertAdjacentText", "prepend", "remove", "replaceChildren", "replaceWith",
]);
const domProperties = new Set(["textContent", "innerHTML", "outerHTML", "innerText", "outerText"]);
const timerFunctions = new Set(["setTimeout", "setInterval", "execScript"]);
const globalObjects = new Set(["window", "globalThis", "self", "global"]);
const specialElements = new Set(["head", "body", "window", "document", "element", "options"]);
const ignoredKeys = new Set(["loc", "name_loc", "metadata", "css"]);
const functionTypes = new Set(["FunctionExpression", "FunctionDeclaration", "ArrowFunctionExpression"]);
const hoistedBindings = new WeakMap();

function walk(node, visit, ancestors = []) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) walk(item, visit, ancestors);
		return;
	}
	if (typeof node.type !== "string") return;
	if (visit(node, ancestors) === false) return;
	for (const [key, child] of Object.entries(node)) {
		if (!ignoredKeys.has(key)) walk(child, visit, [node, ...ancestors]);
	}
}

function patternNames(node) {
	if (!node) return [];
	switch (node.type) {
		case "Identifier": return [node.name];
		case "RestElement":
		case "SpreadElement": return patternNames(node.argument);
		case "AssignmentPattern": return patternNames(node.left);
		case "ArrayPattern":
		case "ArrayExpression": return node.elements.flatMap(patternNames);
		case "ObjectPattern":
		case "ObjectExpression": return node.properties.flatMap(property => patternNames(["RestElement", "SpreadElement"].includes(property.type) ? property.argument : property.value));
		default: return [];
	}
}

function references(node) {
	const names = new Set();
	walk(node, (child, ancestors) => {
		const [parent] = ancestors;
		if (child.type !== "Identifier") return;
		if (["FunctionExpression", "ClassExpression"].includes(parent?.type) && parent.id === child) return;
		if (parent?.type === "MemberExpression" && parent.property === child && !parent.computed) return;
		if (parent?.type === "Property" && parent.key === child && !parent.computed && !parent.shorthand) return;
		if (isShadowed(child.name, ancestors)) return;
		names.add(child.name);
	});
	return names;
}

function declaresName(statement, name) {
	const declaration = statement.declaration ?? statement;
	switch (declaration.type) {
		case "VariableDeclaration": return declaration.kind !== "var" && declaration.declarations.some(item => patternNames(item.id).includes(name));
		case "FunctionDeclaration":
		case "ClassDeclaration": return declaration.id?.name === name;
		case "ImportDeclaration": return declaration.specifiers.some(item => item.local.name === name);
		case "SnippetBlock": return declaration.expression.name === name;
		default: return false;
	}
}

function hoistedVarNames(scope) {
	if (hoistedBindings.has(scope)) return hoistedBindings.get(scope);
	const names = new Set();
	walk(scope, node => {
		if (node !== scope && (functionTypes.has(node.type) || ["ClassExpression", "ClassDeclaration", "StaticBlock"].includes(node.type))) return false;
		if (node.type === "VariableDeclaration" && node.kind === "var") {
			for (const declaration of node.declarations) {
				for (const name of patternNames(declaration.id)) names.add(name);
			}
		}
	});
	hoistedBindings.set(scope, names);
	return names;
}

function bindingScope(name, ancestors) {
	for (const ancestor of ancestors) {
		if (["FunctionExpression", "ClassExpression"].includes(ancestor.type) && ancestor.id?.name === name) return ancestor;
		if (ancestor.params?.some(param => patternNames(param).includes(name))) return ancestor;
		if (functionTypes.has(ancestor.type) && ancestors.includes(ancestor.body) && hoistedVarNames(ancestor.body).has(name)) return ancestor;
		if (ancestor.type === "CatchClause" && patternNames(ancestor.param).includes(name)) return ancestor;
		if (ancestor.type === "EachBlock" && (ancestors.includes(ancestor.body) || ancestors.includes(ancestor.key))
			&& (ancestor.index === name || patternNames(ancestor.context).includes(name))) return ancestor;
		if (ancestor.type === "SnippetBlock" && ancestor.parameters.some(param => patternNames(param).includes(name))) return ancestor;
		if (ancestor.type === "AwaitBlock" && ancestors.includes(ancestor.then) && patternNames(ancestor.value).includes(name)) return ancestor.then;
		if (ancestor.type === "AwaitBlock" && ancestors.includes(ancestor.catch) && patternNames(ancestor.error).includes(name)) return ancestor.catch;
		if (ancestors.includes(ancestor.fragment) && ancestor.attributes?.some(attribute => attribute.type === "LetDirective"
			&& (attribute.expression ? patternNames(attribute.expression).includes(name) : attribute.name === name))) return ancestor.fragment;
		if (ancestor.type === "SwitchStatement" && ancestors.some(child => ancestor.cases.includes(child))
			&& ancestor.cases.some(branch => branch.consequent.some(statement => declaresName(statement, name)))) return ancestor;
		if (["ForStatement", "ForInStatement", "ForOfStatement"].includes(ancestor.type)) {
			const declaration = ancestor.init ?? ancestor.left;
			if (declaration?.type === "VariableDeclaration" && declaresName(declaration, name)) return ancestor;
		}
		if (["BlockStatement", "Program", "StaticBlock"].includes(ancestor.type) && ancestor.body.some(statement => declaresName(statement, name))) return ancestor;
		if (["Program", "StaticBlock"].includes(ancestor.type) && hoistedVarNames(ancestor).has(name)) return ancestor;
		if (ancestor.type === "Fragment" && ancestor.nodes.some(statement => declaresName(statement, name))) return ancestor;
	}
	return undefined;
}

function isShadowed(name, ancestors) {
	return bindingScope(name, ancestors) !== undefined;
}

function propertyName(node) {
	return node?.computed ? node.property?.value : node?.property?.name;
}

function globalIdentifier(node, ancestors) {
	return node.type === "Identifier" && !isShadowed(node.name, ancestors);
}

function globalTimer(callee, ancestors) {
	if (callee.type === "Identifier") return timerFunctions.has(callee.name) && globalIdentifier(callee, ancestors);
	return callee.type === "MemberExpression" && globalObjects.has(callee.object.name)
		&& globalIdentifier(callee.object, ancestors) && timerFunctions.has(propertyName(callee));
}

function fingerprint(node) {
	return JSON.stringify(node, (name, value) => {
		if (["start", "end", "loc", "raw"].includes(name)) return undefined;
		return typeof value === "bigint" ? { bigint: value.toString() } : value;
	});
}

function conditionFingerprint(node) {
	if (node?.type === "LogicalExpression" && ["&&", "||"].includes(node.operator)) {
		return `${node.operator}:${[conditionFingerprint(node.left), conditionFingerprint(node.right)].sort().join(":")}`;
	}
	return fingerprint(node);
}

function splitCondition(node, operator) {
	return node.type === "LogicalExpression" && node.operator === operator
		? [...splitCondition(node.left, operator), ...splitCondition(node.right, operator)]
		: [node];
}

function stableCondition(node) {
	switch (node.type) {
		case "Identifier":
		case "Literal": return true;
		case "UnaryExpression": return node.operator === "!" && stableCondition(node.argument);
		case "LogicalExpression": return ["&&", "||"].includes(node.operator) && stableCondition(node.left) && stableCondition(node.right);
		case "BinaryExpression": return ["===", "!=="].includes(node.operator) && stableCondition(node.left) && stableCondition(node.right);
		default: return false;
	}
}

function coveredCondition(node, ancestors) {
	let current = node;
	const previous = [];
	for (let index = 0; index < ancestors.length; index += 2) {
		const [fragment, block] = ancestors.slice(index, index + 2);
		if (!current.elseif || fragment?.type !== "Fragment" || block?.type !== "IfBlock" || block.alternate !== fragment) break;
		previous.push(block.test);
		current = block;
	}
	if (![node.test, ...previous].every(stableCondition)) return false;
	const candidates = node.test.type === "LogicalExpression" && node.test.operator === "&&"
		? [...splitCondition(node.test, "&&"), node.test] : [node.test];
	return candidates.some(candidate => {
		let terms = splitCondition(candidate, "||").map(term => splitCondition(term, "&&").map(conditionFingerprint));
		for (const condition of previous) {
			const priorTerms = splitCondition(condition, "||").map(term => splitCondition(term, "&&").map(conditionFingerprint));
			terms = terms.filter(term => !priorTerms.some(prior => prior.every(part => term.includes(part))));
		}
		return terms.length === 0;
	});
}

function checkIgnores(ast, source, filename, report) {
	const directives = [];
	walk(ast.fragment, (node, [parent]) => {
		if (node.type !== "Comment" || !node.data.trim().startsWith("svelte-ignore ")) return;
		const index = parent.nodes.indexOf(node);
		const target = parent.nodes.slice(index + 1).find(item => item.type !== "Comment" && !(item.type === "Text" && !item.data.trim()));
		const codes = node.data.trim().slice("svelte-ignore ".length).split("(")[0].match(/[a-z][a-z_0-9]*/g) ?? [];
		directives.push({ node, target, codes });
	});
	if (!directives.length) return;
	let unignored = source;
	for (const { node } of [...directives].reverse()) {
		unignored = unignored.slice(0, node.start) + source.slice(node.start, node.end).replace(/[^\n]/g, " ") + unignored.slice(node.end);
	}
	let warnings;
	try {
		warnings = compile(unignored, { filename, runes: true, generate: false }).warnings;
	} catch {
		// Strict svelte-check reports compiler errors before suppression checks can run.
		return;
	}
	for (const { node, target, codes } of directives) {
		for (const code of codes) {
			if (!target || !warnings.some(warning => warning.code === code && warning.start.character >= target.start && warning.start.character < target.end)) report(node, "no-unused-svelte-ignore", `Remove the unused svelte-ignore for ${code}.`);
		}
	}
}

export function checkSvelte(source, filename = "Component.svelte") {
	const diagnostics = [];
	function report(node, rule, message, severity = "error") {
		const offset = node.start ?? 0;
		const before = source.slice(0, offset);
		diagnostics.push({ filename, line: before.split("\n").length, column: offset - before.lastIndexOf("\n"), rule, message, severity });
	}
	let ast;
	try {
		ast = parse(source, { modern: true, filename });
	} catch (error) {
		report({ start: error.position?.[0] }, error.code ?? "parse", error.message);
		return diagnostics;
	}
	checkIgnores(ast, source, filename, report);
	const componentScopes = [ast.instance?.content, ast.module?.content].filter(Boolean);
	const boundElements = new Map();
	walk(ast.fragment, (node, ancestors) => {
		if (!["RegularElement", "SvelteElement"].includes(node.type)) return;
		for (const attribute of node.attributes) {
			if (attribute.type !== "BindDirective" || attribute.name !== "this" || attribute.expression?.type !== "Identifier") continue;
			const name = attribute.expression.name;
			const scopes = boundElements.get(name) ?? new Set();
			scopes.add(bindingScope(name, [node, ...ancestors, ...componentScopes]));
			boundElements.set(name, scopes);
		}
	});
	walk(ast, (node, ancestors) => {
		const [parent] = ancestors;
		const globalScopes = ancestors.includes(ast.module?.content) ? [node, ...ancestors] : [node, ...ancestors, ...componentScopes];
		for (const check of selectors) {
			if (esquery.matches(node, check.query, ancestors, { fallback: "iteration" })) report(node, check.rule ?? "restricted-syntax", check.message, check.severity ?? "error");
		}
		if (node.type === "HtmlTag") report(node, "no-at-html-tags", "Render text or a Svelte component instead of raw HTML.");
		if (node.type === "DebugTag") report(node, "no-at-debug-tags", "Remove debugging tags before shipping.", "warning");
		if (node.type === "LabeledStatement" && node.label.name === "$") report(node, "runes-only", "Use $derived or $effect instead of legacy $: statements.");
		if (node.type === "EachBlock") {
			if (!node.key) report(node, "require-each-key", "Give each block a stable key.");
			else {
				const names = [...patternNames(node.context), node.index];
				if (!names.some(name => references(node.key).has(name))) report(node.key, "valid-each-key", "The key must reference this block's item or index.");
			}
		}
		if (node.type === "IfBlock" && node.elseif && coveredCondition(node, ancestors)) report(node.test, "no-dupe-else-if-blocks", "This condition is already covered by an earlier branch.");
		if (node.type === "ExpressionTag" && parent?.type === "Fragment" && ["ObjectExpression", "ArrayExpression", "ArrowFunctionExpression", "FunctionExpression", "ClassExpression"].includes(node.expression.type)) report(node, "no-object-in-text-mustaches", "Interpolate a display value instead of an object or function.");
		if (node.type === "RegularElement" && specialElements.has(node.name)) report(node, "no-raw-special-elements", `Use <svelte:${node.name}> for this special element.`);
		if (node.attributes) {
			const directives = new Set();
			for (const attribute of node.attributes) {
				if (!["OnDirective", "UseDirective"].includes(attribute.type)) continue;
				const key = `${attribute.type}:${attribute.name}:${[...(attribute.modifiers ?? [])].sort().join(",")}:${fingerprint(attribute.expression)}`;
				if (directives.has(key)) report(attribute, "no-dupe-directives", "Remove the duplicate event or action directive.");
				directives.add(key);
			}
		}
		if (node.type === "MemberExpression" && node.object.type === "Identifier" && boundElements.get(node.object.name)?.has(bindingScope(node.object.name, globalScopes))) {
			const name = propertyName(node);
			const target = parent?.type === "ChainExpression" ? ancestors[1] : parent;
			const callee = parent?.type === "ChainExpression" ? parent : node;
			if (target?.type === "CallExpression" && target.callee === callee && domMethods.has(name) || target?.type === "AssignmentExpression" && target.left === node && domProperties.has(name)) report(node, "no-dom-manipulating", "Let Svelte update bound elements instead of changing their DOM structure or text directly.");
		}
		if (node.type === "MemberExpression" && node.object.name === "console" && globalIdentifier(node.object, globalScopes) && !["warn", "error"].includes(propertyName(node))) report(node, "no-console", "Use the logger utilities instead of console methods.");
		if (["CallExpression", "NewExpression"].includes(node.type) && node.callee.name === "Function" && globalIdentifier(node.callee, globalScopes)) report(node, "no-new-func", "Do not construct code from strings.");
		if (node.type === "CallExpression" && globalTimer(node.callee, globalScopes) && (typeof node.arguments[0]?.value === "string" || node.arguments[0]?.type === "TemplateLiteral")) report(node, "no-implied-eval", "Pass a callback instead of a code string.");
	});
	return diagnostics;
}

function componentFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? componentFiles(path) : path.endsWith(".svelte") ? [path] : [];
	}).sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const diagnostics = componentFiles("src").flatMap(filename => checkSvelte(readFileSync(filename, "utf8"), filename));
	for (const diagnostic of diagnostics) console.log(`${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.rule}: ${diagnostic.message}`);
	const errors = diagnostics.filter(item => item.severity === "error").length;
	console.log(`Svelte policies: ${errors} errors, ${diagnostics.length - errors} warnings.`);
	process.exitCode = errors ? 1 : 0;
}
