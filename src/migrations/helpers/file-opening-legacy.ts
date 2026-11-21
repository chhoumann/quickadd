import type { FileOpeningSettings } from "../../types/fileOpening";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";

type LegacyOpenFileInNewTab = {
	enabled?: boolean;
	direction?: string;
	focus?: boolean;
};

function coerceLegacyOpenFileInNewTab(
	raw: unknown,
): LegacyOpenFileInNewTab | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "boolean") {
		return { enabled: raw };
	}
	if (typeof raw !== "object") return null;

	const obj = raw as Record<string, unknown>;
	return {
		enabled: typeof obj.enabled === "boolean" ? obj.enabled : undefined,
		direction:
			obj.direction === "horizontal" || obj.direction === "vertical"
				? obj.direction
				: undefined,
		focus: typeof obj.focus === "boolean" ? obj.focus : undefined,
	};
}

function createFileOpeningFromLegacy(
	legacyTab: LegacyOpenFileInNewTab,
	legacyMode: unknown,
): FileOpeningSettings {
	const direction =
		legacyTab.direction === "horizontal" ? "horizontal" : "vertical";
	const mode =
		typeof legacyMode === "string" && legacyMode !== "default"
			? (legacyMode as FileOpeningSettings["mode"])
			: "default";

	return normalizeFileOpening({
		location: legacyTab.enabled ? "split" : "tab",
		direction,
		focus: legacyTab.focus ?? true,
		mode,
	});
}

/**
 * The `fileOpening` a choice saved before that setting existed stands for, read
 * from its legacy `openFileInNewTab`/`openFileInMode` fields, or null when it has
 * no legacy setting. Shared by the data.json migrations and package import.
 */
export function fileOpeningFromLegacyFields(choice: {
	openFileInNewTab?: unknown;
	openFileInMode?: unknown;
}): FileOpeningSettings | null {
	const legacyTab = coerceLegacyOpenFileInNewTab(choice.openFileInNewTab);
	return legacyTab ? createFileOpeningFromLegacy(legacyTab, choice.openFileInMode) : null;
}
