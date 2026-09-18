import { templateChoice } from "../../../tests/helpers/settings/choices";
import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import { snapshot } from "../svelte/persist.svelte";
import { createTemplateChoiceFormProps } from "./templateChoiceFormProps.svelte";

// Builds a minimal-but-valid template choice (the persisted shape).

const app = {} as unknown as App;
const plugin = {} as unknown as QuickAdd;

describe("TemplateChoiceBuilder persistence boundary (#1130 blocker)", () => {
	it("edits land on the form's $state proxy, NOT the original choice object", () => {
		const original = templateChoice({ name: "Original", templatePath: "Templates/Note.md" });
		const props = createTemplateChoiceFormProps({
			choice: original,
			app,
			plugin,
		});

		// The form mutates props.choice (a $state proxy) — exactly what bind:value
		// and the onchange handlers do inside TemplateChoiceForm.svelte.
		props.choice.name = "Edited";
		props.choice.folder.enabled = true;
		props.choice.folder.folders.push("Daily");

		// The host resolves snapshot(props.choice) (getResultChoice -> formProps.choice).
		const resolved = snapshot(props.choice);
		expect(resolved.name).toBe("Edited");
		expect(resolved.folder.enabled).toBe(true);
		expect(resolved.folder.folders).toEqual(["Daily"]);

		// The blocker this guards: a $state proxy does NOT write through to the
		// original, so resolving snapshot(original) (the reverted-design bug) would
		// silently drop every edit.
		expect(original.name).toBe("Original");
		expect(snapshot(original).name).toBe("Original");
	});

	it("resolves a plain object with no live $state proxy", () => {
		const props = createTemplateChoiceFormProps({
			choice: templateChoice({ name: "Original", templatePath: "Templates/Note.md" }),
			app,
			plugin,
		});
		props.choice.templatePath = "Templates/Other.md";

		const resolved = snapshot(props.choice);
		// Round-trip stable = plain data, safe for callers that spread + saveData.
		expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved);
		expect(resolved.templatePath).toBe("Templates/Other.md");
	});
});
