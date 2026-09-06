import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS } from "svelte-dnd-action";
import FolderList from "./FolderList.svelte";

type FolderItem = { id: string };

const fireDnd = (
	zone: Element,
	type: "consider" | "finalize",
	items: FolderItem[],
	trigger: string,
	id: string,
) =>
	fireEvent(
		zone,
		new CustomEvent(type, {
			detail: { items, info: { trigger, id, source: "pointer" } },
		}),
	);

const paths = (...ids: string[]): FolderItem[] => ids.map((id) => ({ id }));

describe("FolderList reorder", () => {
	it("does not call onChange from consider", async () => {
		const onChange = vi.fn();
		const { container } = render(FolderList, {
			props: { folders: ["Notes", "Daily", "Inbox"], onChange },
		});
		const zone = container.querySelector(".qa-folder-list") as Element;

		await fireDnd(
			zone,
			"consider",
			[{ id: SHADOW_PLACEHOLDER_ITEM_ID }, { id: "Daily" }, { id: "Inbox" }],
			TRIGGERS.DRAG_STARTED,
			"Notes",
		);

		expect(onChange).not.toHaveBeenCalled();
	});

	it("recovers membership when finalize is missing the dragged folder", async () => {
		const onChange = vi.fn();
		const { container } = render(FolderList, {
			props: { folders: ["Notes", "Daily", "Inbox"], onChange },
		});
		const zone = container.querySelector(".qa-folder-list") as Element;

		await fireDnd(
			zone,
			"consider",
			[{ id: SHADOW_PLACEHOLDER_ITEM_ID }, { id: "Daily" }, { id: "Inbox" }],
			TRIGGERS.DRAG_STARTED,
			"Notes",
		);
		await fireDnd(
			zone,
			"finalize",
			paths("Daily", "Inbox"),
			TRIGGERS.DROPPED_INTO_ZONE,
			"Notes",
		);

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0]).toEqual(["Notes", "Daily", "Inbox"]);
	});


	it("recovers membership at the placeholder index when it had already moved", async () => {
		const onChange = vi.fn();
		const { container } = render(FolderList, {
			props: { folders: ["Notes", "Daily", "Inbox"], onChange },
		});
		const zone = container.querySelector(".qa-folder-list") as Element;

		await fireDnd(
			zone,
			"consider",
			[{ id: "Daily" }, { id: SHADOW_PLACEHOLDER_ITEM_ID }, { id: "Inbox" }],
			TRIGGERS.DRAG_STARTED,
			"Notes",
		);
		await fireDnd(
			zone,
			"finalize",
			paths("Daily", "Inbox"),
			TRIGGERS.DROPPED_INTO_ZONE,
			"Notes",
		);

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0]).toEqual(["Daily", "Notes", "Inbox"]);
	});

	it("commits a genuine reorder after the same drag start", async () => {
		const onChange = vi.fn();
		const { container } = render(FolderList, {
			props: { folders: ["Notes", "Daily", "Inbox"], onChange },
		});
		const zone = container.querySelector(".qa-folder-list") as Element;

		await fireDnd(
			zone,
			"consider",
			[{ id: SHADOW_PLACEHOLDER_ITEM_ID }, { id: "Daily" }, { id: "Inbox" }],
			TRIGGERS.DRAG_STARTED,
			"Notes",
		);
		await fireDnd(
			zone,
			"finalize",
			paths("Daily", "Notes", "Inbox"),
			TRIGGERS.DROPPED_INTO_ZONE,
			"Notes",
		);

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0]).toEqual(["Daily", "Notes", "Inbox"]);
	});

	it("ArrowDown on a row's drag handle moves it down", async () => {
		const onChange = vi.fn();
		const { getByLabelText } = render(FolderList, {
			props: { folders: ["Notes", "Daily", "Inbox"], onChange },
		});

		await fireEvent.keyDown(getByLabelText("Reorder Notes"), { key: "ArrowDown" });

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0]).toEqual(["Daily", "Notes", "Inbox"]);
	});

	it("ArrowUp on the last row moves it up", async () => {
		const onChange = vi.fn();
		const { getByLabelText } = render(FolderList, {
			props: { folders: ["Notes", "Daily", "Inbox"], onChange },
		});

		await fireEvent.keyDown(getByLabelText("Reorder Inbox"), { key: "ArrowUp" });

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0]).toEqual(["Notes", "Inbox", "Daily"]);
	});


	it("keeps focus on the handle across successive ArrowDown presses", async () => {
		let folders = ["Notes", "Daily", "Inbox"];
		let view: ReturnType<typeof render>;
		const onChange = vi.fn(async (next: string[]) => {
			folders = next;
			// Parent commits before the post-move tick so refocus targets the new DOM.
			await view.rerender({ folders, onChange });
		});
		view = render(FolderList, {
			props: { folders, onChange },
		});

		const first = view.getByLabelText("Reorder Notes") as HTMLElement;
		first.focus();
		await fireEvent.keyDown(first, { key: "ArrowDown" });
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0]).toEqual(["Daily", "Notes", "Inbox"]);

		await vi.waitFor(() => {
			expect(document.activeElement).toBe(
				view.getByLabelText("Reorder Notes") as HTMLElement,
			);
		});

		await fireEvent.keyDown(document.activeElement as HTMLElement, {
			key: "ArrowDown",
		});
		expect(onChange).toHaveBeenCalledTimes(2);
		expect(onChange.mock.calls[1][0]).toEqual(["Daily", "Inbox", "Notes"]);
	});

	it("clamps at the ends — ArrowUp on the first row is a no-op", async () => {
		const onChange = vi.fn();
		const { getByLabelText } = render(FolderList, {
			props: { folders: ["Notes", "Daily"], onChange },
		});

		await fireEvent.keyDown(getByLabelText("Reorder Notes"), { key: "ArrowUp" });
		await Promise.resolve();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("trash reports the remaining folders through onChange", async () => {
		const onChange = vi.fn();
		const { getByLabelText } = render(FolderList, {
			props: { folders: ["Notes", "Daily"], onChange },
		});

		await fireEvent.click(getByLabelText("Remove folder Notes"));

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0][0]).toEqual(["Daily"]);
	});
});
