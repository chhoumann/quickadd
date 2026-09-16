import type { PreviewSeverity, PreviewFlag } from "../types/packages/PackagePreview";
interface FlagMeta {
	severity: PreviewSeverity;
	/** Short uppercase pill label. */
	label: string;
	/** Plain-language hover explanation. */
	description: string;
}

// One row per flag — severity, pill label, and hover description in lockstep so
// adding a capability can't half-define it across parallel tables.
const FLAG_META: Record<PreviewFlag, FlagMeta> = {
	"user-script": {
		severity: "critical",
		label: "SCRIPT",
		description: "Runs custom JavaScript with full access to your vault and the network.",
	},
	"conditional-script": {
		severity: "critical",
		label: "CONDITIONAL",
		description: "Runs custom JavaScript to decide which branch executes.",
	},
	"bundled-script": {
		severity: "critical",
		label: "SCRIPT FILE",
		description: "Bundles a file that will be written to your vault and can be run as code.",
	},
	"run-on-startup": {
		severity: "critical",
		label: "STARTUP",
		description: "Runs automatically every time Obsidian starts.",
	},
	"mislabeled-executable": {
		severity: "critical",
		label: "EXECUTABLE",
		description: "A bundled file is run as code even though it is labeled a template.",
	},
	"registers-command": {
		severity: "warning",
		label: "COMMAND",
		description: "Adds a command to the command palette.",
	},
	"obsidian-command": {
		severity: "warning",
		label: "OBSIDIAN",
		description: "Triggers another Obsidian command.",
	},
	ai: {
		severity: "warning",
		label: "AI",
		description: "Sends note content to your AI provider over the network.",
	},
	"ai-tools": {
		severity: "critical",
		label: "AI TOOLS",
		description:
			"Lets an AI model read and write your vault: the script gives the model tools (functions) it calls with model-chosen arguments.",
	},
	"capture-writes": {
		severity: "warning",
		label: "WRITES",
		description: "Writes captured text into your notes.",
	},
	"template-write": {
		severity: "warning",
		label: "TEMPLATE",
		description: "Creates notes from a bundled template.",
	},
	"overwrites-existing-choice": {
		severity: "warning",
		label: "OVERWRITES",
		description: "Replaces a choice that already exists in your vault.",
	},
	"overwrites-existing-file": {
		severity: "warning",
		label: "OVERWRITES",
		description: "Overwrites a file that already exists in your vault.",
	},
	"missing-reference": {
		severity: "warning",
		label: "MISSING",
		description: "References a file that is not bundled in this package.",
	},
	"unknown-command": {
		severity: "warning",
		label: "UNKNOWN",
		description: "An unrecognised command type. Review it manually.",
	},
	"editor-command": {
		severity: "info",
		label: "EDITOR",
		description: "Runs a built-in editor command.",
	},
	"open-file": {
		severity: "info",
		label: "OPEN FILE",
		description: "Opens a file in your vault.",
	},
};

export function flagSeverity(flag: PreviewFlag): PreviewSeverity {
	return FLAG_META[flag].severity;
}

export function flagLabel(flag: PreviewFlag): string {
	return FLAG_META[flag].label;
}

export function flagDescription(flag: PreviewFlag): string {
	return FLAG_META[flag].description;
}

