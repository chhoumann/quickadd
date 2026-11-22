import { prepareFuzzySearch, type App, type SearchMatches, type SearchResult, type TFile } from "obsidian";
import { matchWithAliases } from "src/gui/suggesters/rankMatches";
import { buildFileDisplayInfos, FILE_PICK_PREFIX, fileLinkNameFromPath } from "./fileSyntax";

const WIKILINK = /^!?\[\[([^\]]+)\]\]$/;
const MARKDOWN_LINK = /^!?\[[^\]]*\]\((.+)\)$/;

/** A Markdown link's destination: `<...>` may hold anything but `>`, a bare one needs balanced parentheses. */
function markdownDestination(value: string): string | null {
	const inner = MARKDOWN_LINK.exec(value)?.[1].trim();
	if (!inner) return null;
	if (inner.startsWith("<")) {
		const close = inner.indexOf(">");
		return close > 1 && close === inner.length - 1 ? inner.slice(1, close) : null;
	}
	let depth = 0;
	for (const char of inner) {
		if (char === "(") depth++;
		else if (char === ")" && --depth < 0) return null;
	}
	return depth === 0 ? inner : null;
}

function hasLinkTarget(reference: string): boolean {
	const hash = reference.indexOf("#");
	if (hash === -1) return reference.trim().length > 0;
	const note = reference.slice(0, hash).trim();
	if (note.length > 0) return true;
	const subpath = reference.slice(hash + 1).replace(/^\^/, "").trim();
	return subpath.length > 0;
}

export function isLinkValue(value: string): boolean {
	const wikilink = WIKILINK.exec(value)?.[1];
	if (wikilink !== undefined) return hasLinkTarget(wikilink.split("|")[0]);
	const destination = markdownDestination(value);
	return destination !== null && hasLinkTarget(destination);
}

/** A typed or stored value as a link: links stay as written, anything else becomes `[[value]]`. */
export function ensureLinkValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || isLinkValue(trimmed)) return trimmed;
	return `[[${trimmed}]]`;
}

function decodeLinkPath(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

export function isRelativeLinkTarget(target: string): boolean {
	return target.startsWith("./") || target.startsWith("../");
}

export function resolveRelativeVaultPath(target: string, sourcePath: string): string {
	const dir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
	const segments = dir ? dir.split("/") : [];
	for (const part of target.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (segments.length > 0) segments.pop();
		} else {
			segments.push(part);
		}
	}
	return segments.join("/");
}

function subpathLinkOf(value: string): string | null {
	const trimmed = value.trim();
	const wikilink = WIKILINK.exec(trimmed)?.[1];
	if (wikilink !== undefined) {
		const ref = wikilink.split("|")[0].trim();
		return ref.startsWith("#") ? ref : null;
	}
	const destination = markdownDestination(trimmed);
	if (destination !== null) {
		const ref = decodeLinkPath(destination).trim();
		return ref.startsWith("#") ? ref : null;
	}
	return null;
}

/** The note a value names, without its alias, heading or block, or URL encoding. */
export function linkTargetOf(value: string): string {
	const trimmed = value.trim();
	const wikilink = WIKILINK.exec(trimmed)?.[1];
	if (wikilink !== undefined) return wikilink.split("|")[0].split("#")[0].trim();
	const destination = markdownDestination(trimmed);
	if (destination !== null) {
		return decodeLinkPath(destination.split("#")[0]).trim().replace(/\.md$/i, "");
	}
	return trimmed;
}

/**
 * Writes a FIELD answer as links. Plain text from a script, the CLI or a shared
 * `|name:` answer goes through `resolvePlain`, which links an existing note the
 * way the user's link settings write it.
 */
export function linkifyFieldValue(
	value: unknown,
	resolvePlain: (text: string) => string = ensureLinkValue,
): unknown {
	if (Array.isArray(value)) {
		return value
			.map((item) => linkifyFieldValue(item, resolvePlain))
			.filter((item) => item !== "");
	}
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed || isLinkValue(trimmed)) return trimmed;
	return resolvePlain(trimmed);
}

export type FieldLinkOption =
	| {
			readonly kind: "file";
			readonly id: string;
			readonly file: TFile;
			readonly display: string;
			readonly primary: string;
			readonly basename: string;
			readonly path: string;
			readonly subpath?: string;
			readonly aliases: readonly string[];
			/** The property already has this note as a value. */
			readonly existing: boolean;
	  }
	| {
			readonly kind: "unresolved";
			readonly id: string;
			/** The canonical `[[target]]`, without alias or heading. */
			readonly link: string;
			readonly target: string;
			readonly display: string;
			readonly aliases: readonly string[];
			readonly existing: true;
	  };

export type TypedLinkResolution =
	| { readonly kind: "empty" }
	| { readonly kind: "option"; readonly option: FieldLinkOption }
	| { readonly kind: "new"; readonly link: string; readonly display: string };

export type FieldLinkSuggestion =
	| {
			readonly kind: "option";
			readonly option: FieldLinkOption;
			/** The alias that matched, when the note's own name did not. */
			readonly alias?: string;
			readonly matches: SearchMatches;
	  }
	| {
			readonly kind: "new";
			readonly link: string;
			readonly display: string;
	  };

export type FieldLinkInputValue =
	| string
	| { readonly value: string; readonly sourcePath?: string };

/** What FieldLinkOptions reads from the vault. */
export interface FieldLinkVault {
	/** Every Markdown note, newest-modified first. */
	files: TFile[];
	resolve: (target: string, sourcePath?: string) => TFile | null;
	linkFor: (file: TFile, subpath?: string) => string;
	describe: (files: TFile[]) => Array<{ label: string; primary?: string; aliases: string[] }>;
}

export function storedFieldLinkTarget(option: FieldLinkOption): string {
	if (option.kind === "file") {
		return `${FILE_PICK_PREFIX}${option.path}${option.subpath ?? ""}`;
	}
	return option.link;
}

type FieldLinkTargetEntry = {
	answer: unknown;
	answerSnapshot?: readonly unknown[];
	targets: string | string[];
};
type FieldLinkTargetMap = Map<string, FieldLinkTargetEntry>;

const fieldLinkTargets = new WeakMap<ReadonlyMap<string, unknown>, FieldLinkTargetMap>();

export function rememberFieldLinkTarget(
	variables: Map<string, unknown>,
	key: string,
	answer: unknown,
	targets: string | string[],
): void {
	let map = fieldLinkTargets.get(variables);
	if (!map) {
		map = new Map();
		fieldLinkTargets.set(variables, map);
	}
	map.set(key, {
		answer,
		answerSnapshot: Array.isArray(answer) ? [...answer] : undefined,
		targets: Array.isArray(targets) ? [...targets] : targets,
	});
}

export function getFieldLinkTarget(
	variables: ReadonlyMap<string, unknown>,
	key: string,
): string | string[] | undefined {
	const entry = fieldLinkTargets.get(variables)?.get(key);
	const current = variables.get(key);
	if (!entry || entry.answer !== current) return undefined;
	if (!Array.isArray(current)) return entry.targets;
	if (!Array.isArray(entry.targets) || !entry.answerSnapshot) return undefined;
	if (
		current.length === entry.answerSnapshot.length &&
		current.every((item, index) => item === entry.answerSnapshot![index])
	) {
		return entry.targets;
	}
	const targetByAnswer = new Map<unknown, string[]>();
	entry.answerSnapshot.forEach((item, index) => {
		const target = entry.targets[index];
		if (target === undefined) return;
		const queue = targetByAnswer.get(item) ?? [];
		queue.push(target);
		targetByAnswer.set(item, queue);
	});
	return current.map((item) => targetByAnswer.get(item)?.shift() ?? String(item));
}

export function snapshotFieldLinkTargets(
	variables: ReadonlyMap<string, unknown>,
): FieldLinkTargetMap {
	return new Map(fieldLinkTargets.get(variables));
}

export function restoreFieldLinkTargets(
	variables: Map<string, unknown>,
	snapshot: FieldLinkTargetMap,
): void {
	fieldLinkTargets.set(variables, new Map(snapshot));
}

function setIfAbsent<T>(map: Map<string, T>, key: string, value: T): void {
	if (key && !map.has(key)) map.set(key, value);
}

function sortExistingByDisplay(
	options: readonly FieldLinkOption[],
	pinnedFirst: boolean,
): FieldLinkOption[] {
	const pinned = pinnedFirst ? options.slice(0, 1) : [];
	const rest = options
		.slice(pinned.length)
		.sort((a, b) => a.display.localeCompare(b.display, undefined, { sensitivity: "base" }));
	return [...pinned, ...rest];
}

/**
 * A link FIELD's options: the property's existing values, merged by the note
 * they name, then every other note. Lookups are indexed, and a note's link is
 * generated only when it is picked.
 */
export class FieldLinkOptions {
	readonly existingOptions: readonly FieldLinkOption[];
	readonly otherOptions: readonly FieldLinkOption[];
	readonly allOptions: readonly FieldLinkOption[];

	private readonly byId = new Map<string, FieldLinkOption>();
	private readonly byPath = new Map<string, FieldLinkOption>();
	private readonly byDisplayLower = new Map<string, FieldLinkOption>();
	private readonly byPrimaryLower = new Map<string, FieldLinkOption>();
	private readonly byBasenameLower = new Map<string, FieldLinkOption>();
	private readonly byAliasLower = new Map<string, FieldLinkOption>();
	private readonly byUnresolvedLower = new Map<string, FieldLinkOption>();
	private readonly links = new Map<string, string>();

	constructor(
		values: readonly FieldLinkInputValue[],
		private readonly vault: FieldLinkVault,
		opts?: { pinnedFirst?: boolean },
	) {
		const descriptions = new Map<string, { label: string; primary?: string; aliases: string[] }>();
		const described = vault.describe(vault.files);
		vault.files.forEach((file, index) => descriptions.set(file.path, described[index]));

		const fileByPath = new Map(vault.files.map((file) => [file.path, file]));

		const fileOption = (file: TFile, existing: boolean, subpath?: string): FieldLinkOption => {
			const info = descriptions.get(file.path) ?? vault.describe([file])[0];
			return {
				kind: "file",
				id: subpath ? `file:${file.path}${subpath.toLowerCase()}` : `file:${file.path}`,
				file,
				display: subpath ? `${info.label}${subpath}` : info.label,
				primary: subpath ? `${info.primary ?? info.label}${subpath}` : (info.primary ?? info.label),
				basename: file.basename,
				path: file.path,
				...(subpath ? { subpath } : {}),
				aliases: subpath ? [] : info.aliases,
				existing,
			};
		};

		const existing: FieldLinkOption[] = [];
		const seen = new Set<string>();
		for (const entry of values) {
			const value = typeof entry === "string" ? entry : entry.value;
			const entrySourcePath = typeof entry === "string" ? undefined : entry.sourcePath;
			const target = linkTargetOf(value);
			let option: FieldLinkOption;
			if (!target) {
				const subpath = isLinkValue(value) ? subpathLinkOf(value) : null;
				if (!subpath) continue;
				const sourceFile = entrySourcePath ? fileByPath.get(entrySourcePath) : undefined;
				if (sourceFile) {
					option = fileOption(sourceFile, true, subpath);
				} else {
					const qualified = entrySourcePath
						? `${entrySourcePath.replace(/\.md$/i, "")}${subpath}`
						: subpath;
					option = {
						kind: "unresolved",
						id: `unresolved:${qualified.toLowerCase()}`,
						link: `[[${qualified}]]`,
						target: qualified,
						display: qualified,
						aliases: [],
						existing: true,
					};
				}
			} else {
				const file = vault.resolve(target, entrySourcePath);
				if (file) {
					option = fileOption(file, true);
				} else {
					const resolvedTarget =
						entrySourcePath && isRelativeLinkTarget(target)
							? resolveRelativeVaultPath(target, entrySourcePath)
							: target;
					if (!resolvedTarget) continue;
					option = {
						kind: "unresolved",
						id: `unresolved:${resolvedTarget.toLowerCase()}`,
						link: `[[${resolvedTarget}]]`,
						target: resolvedTarget,
						display: resolvedTarget,
						aliases: [],
						existing: true,
					};
				}
			}
			if (seen.has(option.id)) continue;
			seen.add(option.id);
			existing.push(option);
		}

		this.existingOptions = sortExistingByDisplay(existing, opts?.pinnedFirst ?? false);
		this.otherOptions = vault.files
			.filter((file) => !seen.has(`file:${file.path}`))
			.map((file) => fileOption(file, false));
		this.allOptions = [...this.existingOptions, ...this.otherOptions];

		for (const option of this.allOptions) {
			this.byId.set(option.id, option);
			setIfAbsent(this.byDisplayLower, option.display.toLowerCase(), option);
			for (const alias of option.aliases) setIfAbsent(this.byAliasLower, alias.toLowerCase(), option);
			if (option.kind === "file") {
				if (!option.subpath) {
					this.byPath.set(option.path, option);
					setIfAbsent(this.byPrimaryLower, option.primary.toLowerCase(), option);
					setIfAbsent(this.byBasenameLower, option.basename.toLowerCase(), option);
				}
			} else {
				setIfAbsent(this.byUnresolvedLower, option.target.toLowerCase(), option);
			}
		}
	}

	get existingCount(): number {
		return this.existingOptions.length;
	}

	linkForOption(option: FieldLinkOption): string {
		if (option.kind === "unresolved") return option.link;
		let link = this.links.get(option.id);
		if (link === undefined) {
			link = this.vault.linkFor(option.file, option.subpath);
			this.links.set(option.id, link);
		}
		return link;
	}

	/**
	 * What a typed name, an option id or a link stands for. A note's exact name
	 * wins over another note's alias. A name no note has is a new link.
	 */
	resolveTyped(typed: string, sourcePath?: string): TypedLinkResolution {
		const trimmed = typed.trim();
		if (!trimmed) return { kind: "empty" };
		const byId = this.byId.get(trimmed);
		if (byId) return { kind: "option", option: byId };

		if (trimmed.startsWith(FILE_PICK_PREFIX)) {
			const encoded = trimmed.slice(FILE_PICK_PREFIX.length);
			const hash = encoded.indexOf("#");
			const path = hash === -1 ? encoded : encoded.slice(0, hash);
			const subpath = hash === -1 ? undefined : encoded.slice(hash);
			if (subpath) {
				const bySubpathId = this.byId.get(`file:${path}${subpath.toLowerCase()}`);
				if (bySubpathId) return { kind: "option", option: bySubpathId };
				const name = fileLinkNameFromPath(path);
				return name ? { kind: "new", link: `[[${name}${subpath}]]`, display: `${name}${subpath}` } : { kind: "empty" };
			}
			const byPath = this.byPath.get(path);
			if (byPath) return { kind: "option", option: byPath };
			const name = fileLinkNameFromPath(path);
			return name ? { kind: "new", link: `[[${name}]]`, display: name } : { kind: "empty" };
		}

		if (isLinkValue(trimmed)) {
			const target = linkTargetOf(trimmed);
			const file = target ? this.vault.resolve(target, sourcePath) : null;
			const resolvedRelative =
				target && sourcePath && isRelativeLinkTarget(target)
					? resolveRelativeVaultPath(target, sourcePath)
					: undefined;
			const unresolvedKey = target
				? (resolvedRelative ?? target)
				: (subpathLinkOf(trimmed) ?? "");
			const option = file
				? this.byPath.get(file.path)
				: this.byUnresolvedLower.get(unresolvedKey.toLowerCase());
			if (option) return { kind: "option", option };
			if (resolvedRelative) {
				return { kind: "new", link: `[[${resolvedRelative}]]`, display: resolvedRelative };
			}
			return { kind: "new", link: trimmed, display: target || trimmed };
		}

		if (sourcePath !== undefined) {
			const resolved = this.vault.resolve(trimmed, sourcePath);
			const fromSource = resolved ? this.byPath.get(resolved.path) : undefined;
			if (fromSource) return { kind: "option", option: fromSource };
		}

		const lower = trimmed.toLowerCase();
		const exact = this.byDisplayLower.get(lower) ?? this.byPrimaryLower.get(lower);
		if (exact) return { kind: "option", option: exact };

		const file = this.vault.resolve(trimmed, sourcePath);
		const byVault = file ? this.byPath.get(file.path) : undefined;
		if (byVault) return { kind: "option", option: byVault };

		const fallback = this.byBasenameLower.get(lower) ?? this.byAliasLower.get(lower);
		if (fallback) return { kind: "option", option: fallback };
		return { kind: "new", link: ensureLinkValue(trimmed), display: trimmed };
	}

	linkForTyped(typed: string, sourcePath?: string): string {
		const resolution = this.resolveTyped(typed, sourcePath);
		if (resolution.kind === "option") return this.linkForOption(resolution.option);
		return resolution.kind === "new" ? resolution.link : "";
	}

	namesOption(typed: string, sourcePath?: string): boolean {
		return this.resolveTyped(typed, sourcePath).kind === "option";
	}

	displayFor(idOrLink: string, sourcePath?: string): string {
		const resolution = this.resolveTyped(idOrLink, sourcePath);
		if (resolution.kind === "option") return resolution.option.display;
		return resolution.kind === "new" ? resolution.display : "";
	}

	/** Whether a value links to a note that does not exist. */
	isUnresolved(idOrLink: string, sourcePath?: string): boolean {
		const resolution = this.resolveTyped(idOrLink, sourcePath);
		if (resolution.kind === "option") return resolution.option.kind === "unresolved";
		return resolution.kind === "new" && !this.vault.resolve(linkTargetOf(resolution.link), sourcePath);
	}
}

export function isAmbiguousBareBasename(files: readonly TFile[], target: string): boolean {
	if (target.includes("/")) return false;
	const lower = target.toLowerCase();
	let count = 0;
	for (const file of files) {
		if (file.basename.toLowerCase() === lower && ++count > 1) return true;
	}
	return false;
}

export function createFieldLinkOptions(
	app: App,
	values: readonly FieldLinkInputValue[],
	sourcePath: string | null,
	opts?: { pinnedFirst?: boolean },
): FieldLinkOptions {
	const files = app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
	return new FieldLinkOptions(
		values,
		{
			files,
			resolve: (target, fromPath) => {
				if (
					fromPath === undefined &&
					sourcePath === null &&
					(isRelativeLinkTarget(target) || isAmbiguousBareBasename(files, target))
				) {
					return null;
				}
				return app.metadataCache.getFirstLinkpathDest(target, fromPath ?? sourcePath ?? "");
			},
			linkFor: (file, subpath) => app.fileManager.generateMarkdownLink(file, sourcePath ?? "", subpath),
			describe: (list) => buildFileDisplayInfos(list, (file) => app.metadataCache.getFileCache(file)),
		},
		opts,
	);
}

const EXISTING_VALUE_SCORE_BOOST = 0.25;

function searchByBasename(
	search: (text: string) => SearchResult | null,
	option: Extract<FieldLinkOption, { kind: "file" }>,
): { score: number; matches: SearchMatches; alias?: string } | null {
	if (option.basename === option.display) return null;
	const byName = search(option.basename);
	if (!byName) return null;
	const at = option.display.lastIndexOf(option.basename);
	return {
		score: byName.score,
		matches: at < 0 ? [] : byName.matches.map(([start, end]) => [start + at, end + at] as [number, number]),
	};
}

function searchOption(
	search: (text: string) => SearchResult | null,
	option: FieldLinkOption,
): { score: number; matches: SearchMatches; alias?: string } | null {
	const found = matchWithAliases(search, option.display, option.aliases);
	let best: { score: number; matches: SearchMatches; alias?: string } | null = found
		? { score: found.result.score, matches: found.result.matches, alias: found.alias }
		: null;
	if (option.kind === "file") {
		const byName = searchByBasename(search, option);
		if (byName && (!best || byName.score > best.score)) best = byName;
	}
	return best;
}

/**
 * Ranks a link FIELD's suggestions. With nothing typed, `"all"` lists the
 * existing values and `"other-only"` lists nothing. Typing searches the pool,
 * existing values boosted, and `includeNewRow` adds a `Link to [[...]]` row
 * after the notes when the text names no note. The row always fits in `limit`.
 */
export function rankFieldLinkOptions(
	links: FieldLinkOptions,
	query: string,
	options: {
		limit: number;
		scope: "all" | "other-only";
		excludeIds?: ReadonlySet<string>;
		includeNewRow?: boolean;
	},
): FieldLinkSuggestion[] {
	const included = (option: FieldLinkOption) => !options.excludeIds?.has(option.id);
	const trimmed = query.trim();
	if (!trimmed) {
		if (options.scope === "other-only") return [];
		return links.existingOptions
			.filter(included)
			.slice(0, options.limit)
			.map((option) => ({ kind: "option", option, matches: [] }));
	}

	const pool = options.scope === "all" ? links.allOptions : links.otherOptions;
	const linkTarget = isLinkValue(trimmed) ? linkTargetOf(trimmed) : "";
	const searchQuery = linkTarget
		? (isRelativeLinkTarget(linkTarget) ? linkTarget.replace(/^(?:\.\.?\/)+/, "") : linkTarget)
		: trimmed;
	const search = prepareFuzzySearch(searchQuery);
	const ranked: Array<{ suggestion: FieldLinkSuggestion; score: number }> = [];
	for (const option of pool) {
		if (!included(option)) continue;
		const found = searchOption(search, option);
		if (!found) continue;
		ranked.push({
			suggestion: {
				kind: "option",
				option,
				matches: found.matches,
				...(found.alias !== undefined ? { alias: found.alias } : {}),
			},
			score: found.score + (option.existing ? EXISTING_VALUE_SCORE_BOOST : 0),
		});
	}
	const matches = ranked.sort((a, b) => b.score - a.score).map(({ suggestion }) => suggestion);

	const typed = links.resolveTyped(trimmed);
	if (
		typed.kind === "option" &&
		included(typed.option) &&
		(options.scope === "all" || !typed.option.existing) &&
		!matches.some((suggestion) => suggestion.kind === "option" && suggestion.option.id === typed.option.id)
	) {
		matches.unshift({ kind: "option", option: typed.option, matches: [] });
	}
	if (!options.includeNewRow || typed.kind !== "new") return matches.slice(0, options.limit);
	return [
		...matches.slice(0, Math.max(0, options.limit - 1)),
		{ kind: "new", link: typed.link, display: typed.display },
	];
}
