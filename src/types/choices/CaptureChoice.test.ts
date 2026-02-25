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
});
