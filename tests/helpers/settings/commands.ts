import { App } from "obsidian";
import { vi } from "vitest";
import type QuickAdd from "../../../src/main";
import type { ICommand } from "../../../src/types/macros/ICommand";
import type { CommandListProps } from "../../../src/gui/MacroGUIs/commandListProps";
import { reactiveProps } from "../../../src/gui/svelte/reactiveProps.svelte";

export const makeProps = (commands: ICommand[], saveCommands = vi.fn()) =>
	reactiveProps<CommandListProps>({
		commands,
		app: new App(),
		plugin: {} as QuickAdd,
		deleteCommand: vi.fn(),
		saveCommands,
	});
