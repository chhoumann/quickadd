import { TFile, type App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import { CommandType } from "../types/macros/CommandType";
import type { IUserScript } from "../types/macros/IUserScript";
import { executeUserScript, type ScriptParameters } from "./userScriptExecution";

// Same shape as docs/public/scripts/TodoistScript.js: `settings` lives on
// module.exports next to `entry` and the member functions.
const SCRIPT_SOURCE = `
const API_TOKEN = "Todoist API token";
const COMPLETE_TASKS = "Complete imported tasks in Todoist";
module.exports = {
	entry: async () => "entry ran",
	settings: {
		name: "Todoist",
		options: {
			[API_TOKEN]: { type: "secret", id: "todoist-api-token" },
			[COMPLETE_TASKS]: { type: "checkbox", defaultValue: true },
		},
	},
	GetAllTasksFromProject: async (params, settings) => {
		params.received.push({ ...settings });
		return "member ran";
	},
};
`;

function createApp(secrets: Map<string, string>, source = SCRIPT_SOURCE): App {
	const file = new TFile();
	file.path = "scripts/todoist.js";
	file.extension = "js";
	return {
		vault: {
			getAbstractFileByPath: vi.fn(() => file),
			read: vi.fn(async () => source),
		},
		secretStorage: {
			getSecret: vi.fn((id: string) => secrets.get(id) ?? null),
			setSecret: vi.fn((id: string, value: string) => void secrets.set(id, value)),
		},
	} as unknown as App;
}

async function run(command: IUserScript, app: App) {
	const received: Record<string, unknown>[] = [];
	const result = await executeUserScript(command, {
		app,
		plugin: { saveSettings: vi.fn() } as unknown as QuickAdd,
		choiceName: "Todoist",
		params: { received } as unknown as ScriptParameters,
		executor: {} as IChoiceExecutor,
		preloadedUserScripts: new Map(),
	});
	return { result, received };
}

describe("executeUserScript settings with `Script::Export` member access", () => {
	function createCommand(settings: Record<string, unknown>): IUserScript {
		return {
			id: "todoist-command",
			name: "todoistTaskSync::GetAllTasksFromProject",
			type: CommandType.UserScript,
			path: "scripts/todoist.js",
			settings,
		};
	}

	// Regression: the drilled export is a bare function without `.settings`, so
	// defaults were never initialized and the member got `{}`.
	it("initializes defaults from the module's settings for a drilled member", async () => {
		const command = createCommand({});

		const { result, received } = await run(command, createApp(new Map()));

		expect(result).toEqual({ output: "member ran" });
		expect(received).toEqual([
			{ "Complete imported tasks in Todoist": true },
		]);
		expect(command.settings).toEqual({
			"Complete imported tasks in Todoist": true,
		});
	});

	it("passes a resolved secret and keeps a user-changed checkbox", async () => {
		const secrets = new Map([["stored-token-id", "fake-token"]]);
		const command = createCommand({
			"Todoist API token": {
				__quickaddSecret: true,
				secretRef: "stored-token-id",
			},
			"Complete imported tasks in Todoist": false,
		});

		const { received } = await run(command, createApp(secrets));

		expect(received).toEqual([
			{
				"Todoist API token": "fake-token",
				"Complete imported tasks in Todoist": false,
			},
		]);
	});

	// Secret migration needs the definition to know which settings are secret;
	// without it a legacy plaintext token stayed in data.json.
	it("migrates a legacy plaintext secret for a drilled member", async () => {
		const secrets = new Map<string, string>();
		const command = createCommand({ "Todoist API token": "legacy-token" });

		const { received } = await run(command, createApp(secrets));

		expect(received[0]["Todoist API token"]).toBe("legacy-token");
		expect(command.settings["Todoist API token"]).toMatchObject({
			__quickaddSecret: true,
		});
		expect([...secrets.values()]).toEqual(["legacy-token"]);
	});
});

describe("executeUserScript with a script that exports nothing", () => {
	afterEach(() => vi.unstubAllGlobals());

	// #2208: all of the script's work happens at the top level while it loads.
	it("runs the top-level code and finishes without output", async () => {
		const ran: string[] = [];
		vi.stubGlobal("window", { require: () => ran });
		const command: IUserScript = {
			id: "side-effect-command",
			name: "create_wp_folder",
			type: CommandType.UserScript,
			path: "scripts/todoist.js",
			settings: {},
		};

		const { result } = await run(
			command,
			createApp(new Map(), "require('ran').push('top level');"),
		);

		expect(ran).toEqual(["top level"]);
		expect(result).toBeUndefined();
	});
});
