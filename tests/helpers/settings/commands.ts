import { App } from "obsidian";
import { vi } from "vitest";
import type QuickAdd from "../../../src/main";
import type { ICommand } from "../../../src/types/macros/ICommand";
import { createCommandListProps } from "../../../src/gui/MacroGUIs/commandListProps.svelte";

export const makeProps = (commands: ICommand[], saveCommands = vi.fn()) =>
	createCommandListProps({
		commands,
		app: new App(),
		plugin: {} as QuickAdd,
		deleteCommand: vi.fn(),
		saveCommands,
	});
