import type { QuickAddPackageAssetKind } from "./QuickAddPackage";
export type PreviewSeverity = "critical" | "warning" | "info";

export type PreviewFlag =
	| "user-script"
	| "conditional-script"
	| "bundled-script"
	| "run-on-startup"
	| "mislabeled-executable"
	| "registers-command"
	| "obsidian-command"
	| "ai"
	| "ai-tools"
	| "capture-writes"
	| "template-write"
	| "overwrites-existing-choice"
	| "overwrites-existing-file"
	| "missing-reference"
	| "unknown-command"
	| "editor-command"
	| "open-file";

/** A site where a script/template file path is referenced. */
export interface PreviewUsageSite {
	choiceId: string;
	path: string;
	/** Referenced as an executable script (UserScript / script-mode Conditional). */
	asScript: boolean;
	/** The asset kind this reference implies, regardless of the bundled kind. */
	impliedKind: QuickAddPackageAssetKind;
	/** Human-readable location, e.g. "Daily Sync › fetch (User Script)". */
	breadcrumb: string;
}

/** A flattened command in a macro, for the read-only "Show macro" disclosure. */
export interface PreviewCommand {
	name: string;
	type: string;
	depth: number;
	flag?: PreviewFlag;
	scriptPath?: string;
	summary?: string;
}

export interface PreviewChoice {
	choiceId: string;
	name: string;
	type: string;
	/** Folder location (does not include the choice's own name). */
	location: string;
	/** Id already present in the importer's vault -> will overwrite a choice. */
	exists: boolean;
	registersCommand: boolean;
	flags: PreviewFlag[];
	commands: PreviewCommand[];
}

export interface PreviewFile {
	originalPath: string;
	kind: QuickAddPackageAssetKind;
	/** Present in pkg.assets (content available to preview). */
	bundled: boolean;
	/** Decided from the command graph, NOT from `kind`. */
	executable: boolean;
	/** Must be opened before the package import acknowledgement gate can pass. */
	requiresReview: boolean;
	/** Default destination already exists -> import will overwrite it. */
	exists: boolean;
	/** Cheap decoded-size estimate from base64 length (no decode). */
	sizeBytes: number;
	/** Bundled but referenced by no choice/command. */
	orphan: boolean;
	referencedBy: PreviewUsageSite[];
}

export interface CapabilityRow {
	flag: PreviewFlag;
	severity: PreviewSeverity;
	/** Plain-language description of what the capability does. */
	title: string;
	/** Location / count detail. */
	detail: string;
	/** Set for critical script rows; ties the row to the disclosure gate. */
	scriptPath?: string;
}

export interface MissingReference {
	path: string;
	asScript: boolean;
	breadcrumb: string;
}

export interface PreviewSummary {
	hasCritical: boolean;
	hasWarning: boolean;
	criticalCount: number;
	warningCount: number;
	runsOnStartup: boolean;
	scriptCount: number;
	registersCommandCount: number;
	overwritesChoices: number;
	overwritesFiles: number;
	missingCount: number;
}

export interface PackagePreview {
	quickAddVersion: string;
	createdAt: string;
	choiceCount: number;
	fileCount: number;
	choices: PreviewChoice[];
	files: PreviewFile[];
	capabilityRows: CapabilityRow[];
	missingReferences: MissingReference[];
	orphanAssets: string[];
	/** Bundled executable scripts the user must review to satisfy the gate. */
	criticalScriptPaths: string[];
	summary: PreviewSummary;
}

