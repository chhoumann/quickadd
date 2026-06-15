import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { createTemplateChoiceFormProps } from "./templateChoiceFormProps.svelte";
import { createCaptureChoiceFormProps } from "./captureChoiceFormProps.svelte";

// The app/plugin are passed through the factory untouched (only the choice is
// cloned), so minimal stubs suffice.
const app = {} as unknown as App;
const plugin = {} as unknown as QuickAdd;

/**
 * Regression for the DataCloneError when configuring a choice whose object is a
 * live Svelte `$state` PROXY. The real trigger is the Macro builder: a nested
 * command's `choice` is a `$state` proxy (CommandList.svelte), so configuring it
 * calls the form-props factory with a proxy. Under Svelte's dev build (active when
 * Obsidian runs with NODE_ENV=development), a proxy's NESTED objects are
 * non-cloneable, so `structuredClone(choice)` throws
 * "#<Object> could not be cloned." — the user-reported crash. `$state.snapshot`
 * detaches the proxy instead and never throws.
 *
 * Vitest compiles Svelte in dev mode, so this models that exact condition: the
 * test throws on the old `structuredClone(initial.choice)` and passes on
 * `$state.snapshot(initial.choice)`.
 */
function asSavedProxy<T>(choice: T): T {
	const plain = JSON.parse(JSON.stringify(choice)) as T;
	const holder = $state({ choices: [plain] });
	return holder.choices[0];
}

describe("choice form props: existing (proxied plain-object) choices", () => {
	it("builds Template props from a $state proxy without DataCloneError", () => {
		const proxied = asSavedProxy<ITemplateChoice>(new TemplateChoice("Saved"));
		const props = createTemplateChoiceFormProps({ choice: proxied, app, plugin });
		// props.choice must be a fresh, reactive (plain-prototype) clone.
		expect(Object.getPrototypeOf(props.choice)).toBe(Object.prototype);
		expect(props.choice.name).toBe("Saved");
		expect(props.choice).not.toBe(proxied);
	});

	it("builds Capture props from a $state proxy without DataCloneError", () => {
		const proxied = asSavedProxy<ICaptureChoice>(new CaptureChoice("Saved"));
		const props = createCaptureChoiceFormProps({ choice: proxied, app, plugin });
		expect(Object.getPrototypeOf(props.choice)).toBe(Object.prototype);
		expect(props.choice.name).toBe("Saved");
		expect(props.choice).not.toBe(proxied);
	});

	it("still builds Template props from a freshly created class instance", () => {
		// The add-new flow: createChoice() returns a class instance. Must remain
		// reactive (plain-prototype clone) — the original reason the clone exists.
		const props = createTemplateChoiceFormProps({
			choice: new TemplateChoice("New"),
			app,
			plugin,
		});
		expect(Object.getPrototypeOf(props.choice)).toBe(Object.prototype);
		expect(props.choice.name).toBe("New");
	});

	// The clone must be DEEP: the form mutates props.choice freely (incl. nested
	// arrays/objects), and those edits must NOT leak into the original choice — the
	// builder only commits on save (onClose snapshots props.choice). A shallow clone
	// would alias nested branches and silently mutate the source proxy. These lock
	// that contract so a future shallow-clone regression fails loudly.
	it("Template: nested mutations on props.choice do not leak into the original", () => {
		const source = new TemplateChoice("Saved");
		source.folder = {
			enabled: true,
			folders: ["A", "B"],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		};
		source.appendLink = { type: "all", placement: "afterContent" } as never;
		source.fileExistsBehavior = { kind: "append" } as never;
		const proxied = asSavedProxy<ITemplateChoice>(source);

		const props = createTemplateChoiceFormProps({ choice: proxied, app, plugin });
		(props.choice.folder.folders as string[]).push("C");
		props.choice.folder.enabled = false;
		(props.choice.appendLink as { placement: string }).placement = "beforeContent";
		(props.choice.fileExistsBehavior as { kind: string }).kind = "prompt";

		expect(proxied.folder.folders).toEqual(["A", "B"]);
		expect(proxied.folder.enabled).toBe(true);
		expect((proxied.appendLink as { placement: string }).placement).toBe("afterContent");
		expect((proxied.fileExistsBehavior as { kind: string }).kind).toBe("append");
	});

	it("Capture: nested mutations on props.choice do not leak into the original", () => {
		const source = new CaptureChoice("Saved");
		source.insertAfter = {
			enabled: true,
			after: "## Heading",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
		} as never;
		const proxied = asSavedProxy<ICaptureChoice>(source);

		const props = createCaptureChoiceFormProps({ choice: proxied, app, plugin });
		props.choice.insertAfter.after = "## Changed";
		props.choice.insertAfter.enabled = false;

		expect(proxied.insertAfter.after).toBe("## Heading");
		expect(proxied.insertAfter.enabled).toBe(true);
	});
});
