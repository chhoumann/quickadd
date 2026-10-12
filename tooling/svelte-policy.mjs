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
const specialElements = new Set(["head", "body", "window", "document", "element", "options"]);
const ignoredKeys = new Set(["loc", "name_loc", "metadata", "css"]);

function walk(node, visit, ancestors = []) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) walk(item, visit, ancestors);
		return;
	}
	if (typeof node.type !== "string") return;
	visit(node, ancestors);
	for (const [key, child] of Object.entries(node)) {
		if (!ignoredKeys.has(key)) walk(child, visit, [node, ...ancestors]);
	}
}

function patternNames(node) {
	if (!node) return [];
	switch (node.type) {
		case "Identifier": return [node.name];
		case "RestElement": return patternNames(node.argument);
		case "AssignmentPattern": return patternNames(node.left);
		case "ArrayPattern": return node.elements.flatMap(patternNames);
		case "ObjectPattern": return node.properties.flatMap(property => patternNames(property.type === "RestElement" ? property.argument : property.value));
		default: return [];
	}
}

function references(node) {
	const names = new Set();
	walk(node, (child, ancestors) => {
		const [parent] = ancestors;
		if (child.type !== "Identifier") return;
		if (parent?.type === "MemberExpression" && parent.property === child && !parent.computed) return;
		if (parent?.type === "Property" && parent.key === child && !parent.computed && !parent.shorthand) return;
		if (isShadowed(child.name, ancestors)) return;
		names.add(child.name);
	});
	return names;
}

function isShadowed(name, ancestors) {
	for (const ancestor of ancestors) {
		if (ancestor.params?.some(param => patternNames(param).includes(name))) return true;
		if (ancestor.type === "CatchClause" && patternNames(ancestor.param).includes(name)) return true;
		if (ancestor.type === "EachBlock" && (ancestor.index === name || patternNames(ancestor.context).includes(name))) return true;
		if (["ForStatement", "ForInStatement", "ForOfStatement"].includes(ancestor.type)) {
			const declaration = ancestor.init ?? ancestor.left;
			if (declaration?.type === "VariableDeclaration" && declaration.declarations.some(item => patternNames(item.id).includes(name))) return true;
		}
		if (ancestor.type === "BlockStatement" && ancestor.body.some(statement =>
			statement.type === "VariableDeclaration" && statement.declarations.some(item => patternNames(item.id).includes(name))
			|| ["FunctionDeclaration", "ClassDeclaration"].includes(statement.type) && statement.id?.name === name
		)) return true;
	}
	return false;
}

function propertyName(node) {
	return node?.computed ? node.property?.value : node?.property?.name;
}

function fingerprint(node) {
	if (node?.type === "LogicalExpression" && ["&&", "||"].includes(node.operator)) {
		return `${node.operator}:${[fingerprint(node.left), fingerprint(node.right)].sort().join(":")}`;
	}
	return JSON.stringify(node, (name, value) => ["start", "end", "loc", "raw"].includes(name) ? undefined : value);
}

function splitCondition(node, operator) {
	return node.type === "LogicalExpression" && node.operator === operator
		? [...splitCondition(node.left, operator), ...splitCondition(node.right, operator)]
		: [node];
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
	const candidates = node.test.type === "LogicalExpression" && node.test.operator === "&&"
		? [...splitCondition(node.test, "&&"), node.test] : [node.test];
	return candidates.some(candidate => {
		let terms = splitCondition(candidate, "||").map(term => splitCondition(term, "&&").map(fingerprint));
		for (const condition of previous) {
			const priorTerms = splitCondition(condition, "||").map(term => splitCondition(term, "&&").map(fingerprint));
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
	const boundElements = new Set();
	walk(ast.fragment, node => {
		if (!["RegularElement", "SvelteElement"].includes(node.type)) return;
		for (const attribute of node.attributes) {
			if (attribute.type === "BindDirective" && attribute.name === "this" && attribute.expression?.type === "Identifier") boundElements.add(attribute.expression.name);
		}
	});
	walk(ast, (node, ancestors) => {
		const [parent] = ancestors;
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
				const key = `${attribute.type}:${attribute.name}:${fingerprint(attribute.expression)}`;
				if (directives.has(key)) report(attribute, "no-dupe-directives", "Remove the duplicate event or action directive.");
				directives.add(key);
			}
		}
		if (node.type === "MemberExpression" && node.object.type === "Identifier" && boundElements.has(node.object.name) && !isShadowed(node.object.name, ancestors)) {
			const name = propertyName(node);
			const target = parent?.type === "ChainExpression" ? ancestors[1] : parent;
			const callee = parent?.type === "ChainExpression" ? parent : node;
			if (target?.type === "CallExpression" && target.callee === callee && domMethods.has(name) || target?.type === "AssignmentExpression" && target.left === node && domProperties.has(name)) report(node, "no-dom-manipulating", "Let Svelte update bound elements instead of changing their DOM structure or text directly.");
		}
		if (node.type === "MemberExpression" && node.object.name === "console" && !["warn", "error"].includes(propertyName(node))) report(node, "no-console", "Use the logger utilities instead of console methods.");
		if (["CallExpression", "NewExpression"].includes(node.type) && node.callee.name === "Function") report(node, "no-new-func", "Do not construct code from strings.");
		if (node.type === "CallExpression" && ["setTimeout", "setInterval", "execScript"].includes(node.callee.name ?? propertyName(node.callee)) && ["Literal", "TemplateLiteral"].includes(node.arguments[0]?.type)) report(node, "no-implied-eval", "Pass a callback instead of a code string.");
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
