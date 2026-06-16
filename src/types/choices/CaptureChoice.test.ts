import { describe, expect, it } from "vitest";
import { CaptureChoice } from "./CaptureChoice";

describe("CaptureChoice.Load", () => {
	it("migrates legacy active-file prepend to bottom mode", () => {
		const legacy = new CaptureChoice("Legacy");
		legacy.captureToActiveFile = true;
		legacy.prepend = true;
		legacy.activeFileWritePosition = "cursor";
		legacy.insertAfter.enabled = false;
		legacy.newLineCapture.enabled = false;

		const loaded = CaptureChoice.Load(legacy as any);

		expect(loaded.activeFileWritePosition).toBe("bottom");
		expect(loaded.prepend).toBe(false);
	});

	it("clears legacy prepend flag when active-file write position is top", () => {
		const legacy = new CaptureChoice("LegacyTop");
		legacy.captureToActiveFile = true;
		legacy.prepend = true;
		legacy.activeFileWritePosition = "top";
		legacy.insertAfter.enabled = false;
		legacy.newLineCapture.enabled = false;

		const loaded = CaptureChoice.Load(legacy as any);

		expect(loaded.activeFileWritePosition).toBe("top");
		expect(loaded.prepend).toBe(false);
	});

	it("does not migrate when capture is not active-file", () => {
		const choice = new CaptureChoice("NonActive");
		choice.captureToActiveFile = false;
		choice.prepend = true;
		choice.activeFileWritePosition = "cursor";

		const loaded = CaptureChoice.Load(choice as any);

		expect(loaded.activeFileWritePosition).toBe("cursor");
		expect(loaded.prepend).toBe(true);
	});

	it("normalizes unknown write position values", () => {
		const choice = new CaptureChoice("Invalid") as any;
		choice.activeFileWritePosition = "invalid-value";

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.activeFileWritePosition).toBe("cursor");
	});

	it("adds default insert-before settings to legacy choices", () => {
		const choice = new CaptureChoice("Legacy") as any;
		delete choice.insertBefore;

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertBefore).toEqual({
			enabled: false,
			before: "",
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
		});
	});

	it("backfills a safe ordering descriptor for an ordered choice missing orderBy", () => {
		const choice = new CaptureChoice("Ordered") as any;
		choice.insertAfter.enabled = true;
		choice.insertAfter.createIfNotFound = true;
		choice.insertAfter.createIfNotFoundLocation = "ordered";
		delete choice.insertAfter.orderBy;

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertAfter.orderBy).toEqual({
			by: "insertion",
			direction: "desc",
			unparseable: "bottom",
		});
	});

	it("preserves an existing orderBy descriptor on an ordered choice", () => {
		const choice = new CaptureChoice("OrderedDate") as any;
		choice.insertAfter.enabled = true;
		choice.insertAfter.createIfNotFound = true;
		choice.insertAfter.createIfNotFoundLocation = "ordered";
		choice.insertAfter.orderBy = {
			by: "date",
			direction: "desc",
			dateFormat: "YYYY-MM-DD",
			unparseable: "top",
		};

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertAfter.orderBy).toEqual({
			by: "date",
			direction: "desc",
			dateFormat: "YYYY-MM-DD",
			unparseable: "top",
		});
	});

	it("clears inline on an ordered choice (enforces the UI invariant at load)", () => {
		const choice = new CaptureChoice("InlineOrdered") as any;
		choice.insertAfter.enabled = true;
		choice.insertAfter.inline = true;
		choice.insertAfter.createIfNotFound = true;
		choice.insertAfter.createIfNotFoundLocation = "ordered";

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertAfter.inline).toBe(false);
		expect(loaded.insertAfter.orderBy).toEqual({
			by: "insertion",
			direction: "desc",
			unparseable: "bottom",
		});
	});

	it("does not add orderBy to non-ordered choices", () => {
		const choice = new CaptureChoice("Top") as any;
		choice.insertAfter.enabled = true;
		choice.insertAfter.createIfNotFound = true;
		choice.insertAfter.createIfNotFoundLocation = "top";

		const loaded = CaptureChoice.Load(choice);

		expect(loaded.insertAfter.orderBy).toBeUndefined();
	});
});
