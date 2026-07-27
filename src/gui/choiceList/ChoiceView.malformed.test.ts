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
import { settingsStore } from "../../settingsStore";
import { tick } from "svelte";
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
			// Both insertion CTAs write to the same children value, so both must be
			// absent - covering only one would leave the other destructive path
			// unguarded by this test.
			expect(
				queryByLabelText("Add a choice to Broken"),
				shape.key,
			).toBeNull();
			expect(
				queryByLabelText("Add a folder to Broken"),
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

	it("repairs entries that cannot be keyed instead of hiding them", () => {
		// Two entries with no id give the keyed {#each} the same (undefined) key,
		// which raises `each_key_duplicate` - the #1451 crash. Hiding them avoided
		// the crash and cost the user the choices instead: the list the view renders
		// is the list it persists, so the first reorder deleted them (#1608). They
		// are given a fresh uuid at the seam and KEPT, so they can finally be seen,
		// edited and deleted.
		const { getByLabelText, getByText, container } = renderChoiceView([
			{ name: "Missing id" } as IChoice,
			{ name: "No id" } as IChoice,
			leaf("Survivor", "survivor"),
		]);

		expect(getByLabelText("Configure Survivor")).toBeInTheDocument();
		expect(getByText("Missing id")).toBeInTheDocument();
		expect(getByText("No id")).toBeInTheDocument();
		expect(container.querySelector(".qaChoicesUnavailable")).toBeNull();
		// Every row keyed, and keyed DISTINCTLY - the repair must not hand the two
		// id-less entries the same replacement.
		const ids = [...container.querySelectorAll("[data-choice-id]")].map((el) =>
			el.getAttribute("data-choice-id"),
		);
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
		expect(ids).toContain("survivor");
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

	it("a reorder can only reorder - it can never delete", () => {
		// #1608, the headline. `renderable` seeded the drop zone AND was what the
		// persist path wrote back, so the first drag or ArrowDown committed the
		// FILTERED list and every entry the filter had dropped was gone from
		// data.json - including a complete, working choice whose id happened to be a
		// JSON number, from a row the user could never see.
		const saveChoices = vi.fn<(next: Plain<IChoice[]>) => void>();
		const numeric = {
			id: 12,
			name: "Daily note",
			type: "Template",
			command: false,
			templatePath: "Templates/Daily.md",
		} as unknown as IChoice;
		const tree = [
			leaf("Alpha", "alpha"),
			numeric,
			null as unknown as IChoice,
			{ name: "No id", type: "Capture", command: false } as IChoice,
			leaf("Beta", "beta"),
		];
		const { container } = renderChoiceView(tree, saveChoices);

		const handle = container.querySelector<HTMLElement>(
			'[data-choice-id="alpha"] .qa-drag-handle',
		)!;
		handle.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);

		expect(saveChoices).toHaveBeenCalled();
		const saved = saveChoices.mock.calls.at(-1)![0] as unknown as Record<
			string,
			unknown
		>[];

		// Everything that carried data survived; only the `null` hole is gone.
		expect(saved.map((c) => c.name)).toEqual([
			"Daily note",
			"Alpha",
			"No id",
			"Beta",
		]);
		// ...and byte-identical apart from the reorder and the repaired ids.
		const daily = saved.find((c) => c.name === "Daily note")!;
		expect(daily.templatePath).toBe("Templates/Daily.md");
		expect(daily.type).toBe("Template");
		expect(typeof daily.id).toBe("string");
		expect(saved.filter((c) => c.name === "Alpha")[0].id).toBe("alpha");
	});

	it("keeps repaired ids STABLE across an unrelated settings store write", async () => {
		// The seam is fed by a subscription that fires on EVERY settingsStore write,
		// including ones nothing in this view caused (the AI provider auto-sync lands
		// one a few seconds after launch). Re-minting on each of those would not just
		// churn rows: every by-id write here resolves its target before an await -
		// handleConfigureChoice captures the choice, awaits the builder, then matches
		// on `oldChoice.id === newChoice.id` - so a re-mint inside that window turns
		// the match into a no-op and silently discards the user's edits.
		const tree = [{ name: "No id", type: "Capture", command: false } as IChoice];
		settingsStore.setState({ choices: tree });
		const { container } = renderChoiceView(tree);
		const idBefore = container
			.querySelector("[data-choice-id]")!
			.getAttribute("data-choice-id");

		// zustand merges partials, so `state.choices` stays reference-identical.
		settingsStore.setState({ disableOnlineFeatures: true });
		await tick();

		const row = container.querySelector("[data-choice-id]");
		expect(row).not.toBeNull();
		expect(row!.getAttribute("data-choice-id")).toBe(idBefore);
	});

	it("keeps repaired ids stable, and registers one command, across a RE-MOUNT", () => {
		// The settings tab destroys and re-mounts this view every time it is opened,
		// so a memo living in the component would miss it: each open would mint a
		// fresh uuid for the same unrepaired choice and register another command for
		// it, leaving one dead palette entry per open (nothing is persisted at seed
		// time, so the old id is still what `getChoice` resolves).
		const addCommandForChoice = vi.fn();
		const tree = [
			{ name: "No id", type: "Capture", command: true } as IChoice,
		];

		const ids = [0, 1, 2].map(() => {
			const { container, unmount } = render(ChoiceView, {
				props: {
					app: new App() as never,
					plugin: { addCommandForChoice } as unknown as QuickAdd,
					choices: tree,
					saveChoices: vi.fn(),
				},
			});
			const id = container
				.querySelector("[data-choice-id]")!
				.getAttribute("data-choice-id");
			unmount();
			return id;
		});

		expect(new Set(ids).size, `ids across mounts: ${ids.join(", ")}`).toBe(1);
		expect(addCommandForChoice).toHaveBeenCalledTimes(1);
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
