import {
	normalizeFileOpening,
	type FileOpeningSettings,
} from "../../utils/fileOpeningDefaults";

export type LegacyOpenFileInNewTab = {
	enabled?: boolean;
	direction?: string;
	focus?: boolean;
};

export function coerceLegacyOpenFileInNewTab(
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

export function createFileOpeningFromLegacy(
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
