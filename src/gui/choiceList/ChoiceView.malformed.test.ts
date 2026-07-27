import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("../choiceRename", () => ({
	promptRenameChoice: vi.fn().mockResolvedValue(undefined),
}));

import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import ChoiceView from "./ChoiceView.svelte";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Plain } from "../svelte/persist.svelte";
import {
	folder,
	leaf,
	malformedFolder,
	malformedTree,
	MALFORMED_CHILDREN_SHAPES,
} from "../../utils/malformedChoices.fixture";

/**
 * #1566. A folder in data.json whose `choices` value is missing or is not an
 * array used to throw during MOUNT, and a throw during mount does not degrade
 * one row: it escapes `mount()` and abandons the whole declarative settings tab,
 * so QuickAdd's settings came up as a bare heading with nothing under it.
 */

const renderChoiceView = (
	choices: IChoice[],
	saveChoices: (next: Plain<IChoice[]>) => void = vi.fn(),
) =>
	render(ChoiceView, {
		props: {
			app: new App() as never,
			plugin: {} as unknown as QuickAdd,
			choices,
			saveChoices,
		},
	});

describe("ChoiceView over a malformed tree (#1566)", () => {
	it("renders every healthy row around the malformed folders", () => {
		const { getByLabelText, queryByText } = renderChoiceView(malformedTree());

		// The rows on both sides of the corruption, which is what proves the mount
		// ran to completion rather than dying partway.
		expect(getByLabelText("Configure Head template")).toBeInTheDocument();
		expect(getByLabelText("Configure Tail template")).toBeInTheDocument();
		expect(getByLabelText("Toggle Healthy folder")).toBeInTheDocument();
		// ...and the malformed folders are present and operable, not swallowed.
		for (const shape of MALFORMED_CHILDREN_SHAPES) {
			expect(getByLabelText(`Toggle Broken ${shape.key}`)).toBeInTheDocument();
		}
		// The whole view is alive, not just the list.
		expect(getByLabelText("New choice")).toBeInTheDocument();
		expect(queryByText("QuickAdd couldn't display your choices")).toBeNull();
	});

	it("shows a folder that lost nothing as an ordinary empty folder", () => {
		for (const shape of MALFORMED_CHILDREN_SHAPES.filter((s) => !s.lossy)) {
			const { container, unmount } = renderChoiceView([
				malformedFolder("Broken", "broken", shape.value),
			]);

			// No count badge (there is nothing to count) and no unreadable notice:
			// it reads exactly like a folder the user emptied themselves, which is
			// the truth for these shapes.
			expect(container.querySelector(".qaFolderCount"), shape.key).toBeNull();
			expect(
				container.querySelector(".qaUnreadableFolder"),
				shape.key,
			).toBeNull();
			// The empty-folder drop band is offered, so the folder can be refilled.
			expect(
				container.querySelector(".qa-folder-empty"),
				shape.key,
			).not.toBeNull();
			unmount();
		}
	});

	it("says so, and offers no way to overwrite it, when the value could still hold choices", () => {
		for (const shape of MALFORMED_CHILDREN_SHAPES.filter((s) => s.lossy)) {
			const { container, queryByLabelText, unmount } = renderChoiceView([
				malformedFolder("Broken", "broken", shape.value),
			]);

			expect(
				container.querySelector(".qaUnreadableFolder")?.textContent,
				shape.key,
			).toContain("couldn't read this folder's contents");
			// No nested list and no add-into-folder control: both write to this
			// folder's children, and that write would discard the value.
			expect(container.querySelector(".qa-nested"), shape.key).toBeNull();
			expect(
				queryByLabelText("Add a choice to Broken"),
				shape.key,
			).toBeNull();
			unmount();
		}
	});

	it("counts only the children it can actually read", () => {
		const collapsed = (choice: IChoice): IChoice =>
			({ ...choice, collapsed: true }) as IChoice;
		const { container } = renderChoiceView([
			collapsed(folder("Two kids", "two", [leaf("a", "a"), leaf("b", "b")])),
			collapsed(malformedFolder("Broken", "broken", {})),
		]);

		const counts = [...container.querySelectorAll(".qaFolderCount")].map(
			(el) => el.textContent,
		);
		expect(counts).toEqual(["2"]);
	});

	it("steps over a hole in the list instead of blanking the tab", () => {
		// A `null` entry has no id, so the keyed {#each} and svelte-dnd-action both
		// threw on it before it was filtered out at render time.
		const { getByLabelText } = renderChoiceView([
			null as unknown as IChoice,
			leaf("Survivor", "survivor"),
		]);

		expect(getByLabelText("Configure Survivor")).toBeInTheDocument();
	});

	it("refuses to render, rather than to offer a CTA, when the root list is unreadable", () => {
		// Coercing a corrupt root to [] would show the "No choices yet" hero, whose
		// single CTA writes a fresh list straight over whatever is in data.json.
		const saveChoices = vi.fn();
		const { getByText, queryByLabelText } = renderChoiceView(
			{ invalid: true } as unknown as IChoice[],
			saveChoices,
		);

		expect(
			getByText("QuickAdd couldn't display your choices"),
		).toBeInTheDocument();
		expect(queryByLabelText("New choice")).toBeNull();
		expect(queryByLabelText("New folder")).toBeNull();
		expect(saveChoices).not.toHaveBeenCalled();
	});

	it("does not persist a fabricated [] when an unrelated folder is collapsed", () => {
		// The regression that a naive "use the accessor everywhere" fix introduces:
		// updateMultiById re-spreads every folder it walks past, and collapsing runs
		// straight into save().
		const saveChoices = vi.fn<(next: Plain<IChoice[]>) => void>();
		const tree = [
			folder("Healthy folder", "healthy", [leaf("Child", "child")]),
			malformedFolder("Broken", "broken", { "0": leaf("Hidden", "hidden") }),
		];
		const { getByLabelText } = renderChoiceView(tree, saveChoices);

		getByLabelText("Toggle Healthy folder").click();

		expect(saveChoices).toHaveBeenCalled();
		const saved = saveChoices.mock.calls.at(-1)![0] as unknown as Record<
			string,
			unknown
		>[];
		const broken = saved.find((c) => c.id === "broken")!;
		expect(broken.choices).toEqual({ "0": leaf("Hidden", "hidden") });
	});
});
