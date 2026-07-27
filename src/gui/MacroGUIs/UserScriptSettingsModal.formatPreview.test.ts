import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { CommandType } from "../../types/macros/CommandType";
import type { IUserScript } from "../../types/macros/IUserScript";
import { UserScriptSettingsModal } from "./UserScriptSettingsModal";

/**
 * A user script's `type: "format"` option is the one field of the four #1565
 * names that really is a format field - the option type is the script author's
 * own declaration, and the shipped example script resolves it with
 * `quickAddApi.format()` (docs/public/scripts/EzImport.js).
 *
 * So it gets the choice builders' preview rather than losing one: labelled,
 * below the field, a formatter per pass, a staleness token, and the parse
 * warnings inline instead of silence.
 */

const mocks = vi.hoisted(() => ({
	/** Every FormatDisplayFormatter built, in construction order. */
	instances: [] as Array<{ formatted: string[] }>,
	/** Every setTargetFolderPath argument, in call order. */
	targetFolderPaths: [] as Array<string | null>,
	/** Resolves the next format() call manually, to test out-of-order passes. */
	deferrals: [] as Array<() => void>,
	deferNext: false,
	diagnostics: [] as Array<{ severity: string; message: string }>,
}));

vi.mock("../../quickAddInstance", () => ({
	getQuickAddInstance: vi.fn(() => ({})),
}));

vi.mock("../suggesters/formatSyntaxSuggester", () => ({
	FormatSyntaxSuggester: class {},
}));

// Full contract, not just format(): FormatPreviewField also calls
// setTargetFolderPath and reads `diagnostics`.
vi.mock("../../formatters/formatDisplayFormatter", () => ({
	FormatDisplayFormatter: class {
		private readonly record = { formatted: [] as string[] };
		diagnostics = {
			list: () => mocks.diagnostics,
		};

		constructor() {
			mocks.instances.push(this.record);
		}

		setTargetFolderPath(path: string | null): void {
			mocks.targetFolderPaths.push(path);
		}

		format(value: string): Promise<string> {
			this.record.formatted.push(value);
			const resolved = `resolved(${value})`;
			if (mocks.deferNext) {
				return new Promise<string>((resolve) => {
					mocks.deferrals.push(() => resolve(resolved));
				});
			}
			return Promise.resolve(resolved);
		}
	},
}));

function createCommand(): IUserScript {
	return {
		id: "command-1",
		name: "Script",
		type: CommandType.UserScript,
		path: "scripts/script.js",
		settings: {},
	};
}

function scriptSettings(options: Record<string, unknown>) {
	return { name: "Script Settings", options };
}

function formatOption(defaultValue: string) {
	return {
		"Note format": {
			type: "format" as const,
			defaultValue,
			placeholder: "Format",
		},
	};
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function openModal(
	options: Record<string, unknown>,
): UserScriptSettingsModal & { contentEl: HTMLElement } {
	return new UserScriptSettingsModal(
		new App(),
		createCommand(),
		scriptSettings(options) as ConstructorParameters<
			typeof UserScriptSettingsModal
		>[2],
	) as UserScriptSettingsModal & { contentEl: HTMLElement };
}

function textarea(contentEl: HTMLElement): HTMLTextAreaElement {
	const el = contentEl.querySelector<HTMLTextAreaElement>(
		"textarea.qa-user-script-format-textarea",
	);
	if (!el) throw new Error("Format textarea not found");
	return el;
}

function type(el: HTMLTextAreaElement, value: string) {
	el.value = value;
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
	mocks.instances.length = 0;
	mocks.targetFolderPaths.length = 0;
	mocks.deferrals.length = 0;
	mocks.diagnostics.length = 0;
	mocks.deferNext = false;
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("UserScriptSettingsModal format option preview", () => {
	it("renders a labelled preview row BELOW the field it previews", async () => {
		const modal = openModal(formatOption("Logged on {{DATE}}"));
		await flush();

		const row = modal.contentEl.querySelector(".qa-preview-row");
		expect(row).not.toBeNull();
		expect(row?.querySelector(".qa-preview-label")?.textContent).toBe(
			"Preview: ",
		);
		expect(row?.querySelector(".qa-preview-value")?.textContent).toBe(
			"resolved(Logged on {{DATE}})",
		);
		// #1543: the bare span used to be created before the input and rendered
		// above it, where it read as the field's label.
		expect(
			textarea(modal.contentEl).compareDocumentPosition(row as Node) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		modal.close();
	});

	it("builds a formatter per pass rather than memoizing one for the modal", async () => {
		const modal = openModal(formatOption("start"));
		await flush();
		const afterMount = mocks.instances.length;

		type(textarea(modal.contentEl), "next");
		await flush();

		// A memoized instance carries a resolved `variables` map into the next
		// pass, so an edited option list kept previewing the stale value.
		expect(mocks.instances.length).toBeGreaterThan(afterMount);
		expect(mocks.instances.at(-1)?.formatted).toEqual(["next"]);

		modal.close();
	});

	it("drops a stale pass that resolves after a newer one", async () => {
		const modal = openModal(formatOption("first"));
		await flush();

		mocks.deferNext = true;
		type(textarea(modal.contentEl), "slow");
		await flush();
		type(textarea(modal.contentEl), "fast");
		await flush();

		expect(mocks.deferrals).toHaveLength(2);
		// Resolve the OLDER pass last: without a staleness token it would win.
		mocks.deferrals[1]();
		await flush();
		mocks.deferrals[0]();
		await flush();

		expect(
			modal.contentEl.querySelector(".qa-preview-value")?.textContent,
		).toBe("resolved(fast)");

		modal.close();
	});

	it("shows the pass's problems inline instead of firing nothing at all", async () => {
		mocks.diagnostics.push({
			severity: "warning",
			message: "Unsupported case option 'pasc'",
		});
		const modal = openModal(formatOption("{{VALUE:title|case:pasc}}"));
		await flush();

		// Held back until the field has been still (500ms), matching the builders.
		expect(modal.contentEl.querySelector(".qa-preview-issue")).toBeNull();
		await new Promise((resolve) => setTimeout(resolve, 600));

		const issue = modal.contentEl.querySelector(".qa-preview-issue");
		expect(issue?.textContent).toContain("Unsupported case option 'pasc'");

		modal.close();
	});

	it("previews {{FOLDER}} as empty, not as an invented folder", async () => {
		// The builders fall back to a "Folder/Name" placeholder because a choice HAS
		// a configured target folder that no caller wires in yet. A user-script
		// option has none at all, and the runtime resolves {{FOLDER}} to "" there
		// (Formatter.replaceMacrosInString: `this.targetFolderPath ?? ""`), so the
		// placeholder would preview a path the script can never produce.
		const modal = openModal(formatOption("{{FOLDER}}/{{DATE}}"));
		await flush();

		expect(mocks.targetFolderPaths).not.toHaveLength(0);
		for (const path of mocks.targetFolderPaths) expect(path).toBeNull();

		modal.close();
	});

	it("opens for a format option that declares no defaultValue", async () => {
		// `initializeUserScriptSettings` deliberately skips options with no
		// defaultValue, so `value` reaches addFormatInput as undefined despite its
		// `string` type. FormatPreviewField calls `value.trim()` during mount, so an
		// uncoerced undefined throws out of display() and out of the constructor -
		// and CommandList's `new UserScriptSettingsModal(...).open()` never reaches
		// `.open()`, so the gear button silently does nothing.
		const modal = openModal({
			"Note format": { type: "format", placeholder: "Format" },
		});
		await flush();

		expect(textarea(modal.contentEl).value).toBe("");
		// Empty field, so no dangling "Preview:" row.
		expect(modal.contentEl.querySelector(".qa-preview-row")).toBeNull();

		modal.close();
	});

	it("opens when a stored value is not a string, and shows what the script will get", async () => {
		// A script that changed an option from `type: "toggle"` to `type: "format"`
		// between versions leaves a boolean in the saved command settings. Blanking
		// the field would claim the setting is empty while
		// `resolveUserScriptSettings` still forwards `true` to the script.
		const command = createCommand();
		command.settings["Note format"] = true;
		const modal = new UserScriptSettingsModal(
			new App(),
			command,
			scriptSettings(formatOption("ignored")) as ConstructorParameters<
				typeof UserScriptSettingsModal
			>[2],
		) as UserScriptSettingsModal & { contentEl: HTMLElement };
		await flush();

		expect(textarea(modal.contentEl).value).toBe("true");
		expect(
			modal.contentEl.querySelector(".qa-preview-value")?.textContent,
		).toBe("resolved(true)");
		// Untouched until the user actually edits the field.
		expect(command.settings["Note format"]).toBe(true);

		modal.close();
	});

	it("ignores setValue after destroy, and destroys idempotently", async () => {
		const modal = openModal(formatOption("start"));
		const internals = modal as unknown as {
			previewHandles: Array<{
				setValue: (v: string) => void;
				destroy: () => void;
			}>;
		};
		await flush();
		const handle = internals.previewHandles[0];
		const passesBefore = mocks.instances.length;

		handle.destroy();
		handle.destroy();
		// The textarea outlives the handle: display() tears the previews down and
		// only THEN empties contentEl, so its onChange closure can still fire.
		handle.setValue("after destroy");
		await flush();

		expect(mocks.instances.length).toBe(passesBefore);
		expect(document.querySelectorAll(".qa-preview-row")).toHaveLength(0);

		modal.close();
	});

	it("still writes the edited value into the command settings", async () => {
		const command = createCommand();
		const modal = new UserScriptSettingsModal(
			new App(),
			command,
			scriptSettings(formatOption("start")) as ConstructorParameters<
				typeof UserScriptSettingsModal
			>[2],
		);
		await flush();

		type(textarea(modal.contentEl), "Logged on {{DATE}}");

		expect(command.settings["Note format"]).toBe("Logged on {{DATE}}");

		modal.close();
	});

	it("mounts one preview per format option and tears them all down on close", async () => {
		const modal = openModal({
			First: { type: "format", defaultValue: "one", placeholder: "" },
			Second: { type: "format", defaultValue: "two", placeholder: "" },
		});
		await flush();

		expect(modal.contentEl.querySelectorAll(".qa-preview-row")).toHaveLength(2);

		modal.close();
		expect(document.querySelectorAll(".qa-preview-row")).toHaveLength(0);
	});

	it("does not accumulate previews when display() re-runs", async () => {
		const modal = openModal(formatOption("start"));
		const internals = modal as unknown as {
			display: () => void;
			previewHandles: unknown[];
		};
		await flush();

		// migrateSecretSettings() re-runs display() from a voided promise, which
		// empties contentEl. Assert on the tracked handles, NOT on the DOM: an
		// orphaned component is detached along with contentEl's children, so it
		// disappears from every query while its effects and its 500ms diagnostics
		// timer keep running. The handle list is the only thing that can tell the
		// difference between torn down and merely invisible.
		internals.display();
		await flush();
		internals.display();
		await flush();

		expect(internals.previewHandles).toHaveLength(1);
		expect(modal.contentEl.querySelectorAll(".qa-preview-row")).toHaveLength(1);

		modal.close();
		expect(internals.previewHandles).toHaveLength(0);
		expect(document.querySelectorAll(".qa-preview-row")).toHaveLength(0);
	});
});
