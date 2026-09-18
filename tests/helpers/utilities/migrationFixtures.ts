import { vi } from "vitest";
import type QuickAdd from "src/main";

/** Keep the fixture's concrete settings shape available after mutation. */
export function migrationPlugin<T extends object>(settings: T) {
	return { settings, saveSettings: vi.fn() } as unknown as QuickAdd & { settings: T };
}

export function nestedChoice<T>(choice: T) {
	return { type: "NestedChoice", choice };
}

export function legacyMacro<T>(commands: T[], id = "macro-1", name = "Macro") {
	return { id, name, commands };
}
