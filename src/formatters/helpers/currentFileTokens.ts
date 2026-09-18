import { log } from "../../logger/logManager";

export interface CurrentFileTokenOptions {
	links?: boolean;
	fileName?: boolean;
	folder?: boolean;
	activeFolder?: "path" | "content";
	title?: boolean;
}

type CurrentToken = "LINKCURRENT" | "LINKSECTION" | "FILENAMECURRENT" | "FOLDER" | "FOLDERCURRENT" | "TITLE";
type Resolvers = Record<CurrentToken, () => string | null>;

/** Resolve once per token and never scan replacement text, which may itself contain tokens. */
export function replaceCurrentFileTokens(
	input: string,
	opts: CurrentFileTokenOptions,
	resolve: Resolvers,
	behavior: "required" | "optional",
): string {
	const values = new Map<string, string | null>();
	const missing = new Set<CurrentToken>();
	const enabled: Record<CurrentToken, unknown> = {
		LINKCURRENT: opts.links,
		LINKSECTION: opts.links,
		FILENAMECURRENT: opts.fileName,
		FOLDER: opts.folder,
		FOLDERCURRENT: opts.activeFolder,
		TITLE: opts.title,
	};
	const output = input.replace(
		/{{(?:(LINKCURRENT|LINKSECTION|FILENAMECURRENT|TITLE)|(FOLDERCURRENT|FOLDER)(\|name)?)}}/gi,
		(match: string, simple: string | undefined, folder: string | undefined, leaf: string | undefined) => {
			const name = (simple ?? folder ?? "").toUpperCase();
			if (!(name in resolve)) return match;
			// The regex and resolver table enumerate the same closed token domain.
			const token = name as CurrentToken;
			if (!enabled[token]) return match;
			if (!values.has(token)) values.set(token, resolve[token]());
			const value = values.get(token) ?? null;
			if (token === "FOLDERCURRENT" ? value === null :
				(token === "LINKCURRENT" || token === "LINKSECTION" || token === "FILENAMECURRENT") && !value) {
				missing.add(token);
			}
			return leaf && value !== null ? value.slice(value.lastIndexOf("/") + 1) : value ?? "";
		},
	);
	const folderError = "Unable to get the active file's folder. Make sure you have a file open in the editor.";
	if (missing.has("FOLDERCURRENT") && opts.activeFolder === "path") {
		throw new Error(folderError);
	}
	if (missing.size > 0) {
		if (behavior === "required") {
			throw new Error(
				missing.has("LINKCURRENT") || missing.has("LINKSECTION")
					? "Unable to get current file path. Make sure you have a file open in the editor."
					: missing.has("FILENAMECURRENT")
						? "Unable to get current file name. Make sure you have a file open in the editor."
						: folderError,
			);
		}
		log.logMessage("Skipping current-file token replacement because no active file is available.");
	}
	return output;
}
