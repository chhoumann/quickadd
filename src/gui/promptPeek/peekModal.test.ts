import { describe, expect, it, vi } from "vitest";
import {
	PEEK_INSTANT_CLASS,
	closeModalForPeek,
	remountModalFromPeek,
} from "./peekModal";

function makeModal() {
	const containerEl = document.createElement("div");
	return {
		containerEl,
		close: vi.fn(),
		open: vi.fn(),
	};
}

describe("peekModal", () => {
	it("closes without leaving the instant class as the only change", () => {
		const modal = makeModal();
		closeModalForPeek(modal);
		expect(modal.containerEl.classList.contains(PEEK_INSTANT_CLASS)).toBe(true);
		expect(modal.close).toHaveBeenCalledOnce();
	});

	it("rebuilds then opens under the instant class", () => {
		const modal = makeModal();
		const rebuild = vi.fn();
		remountModalFromPeek(modal, rebuild);
		expect(rebuild).toHaveBeenCalledOnce();
		expect(modal.open).toHaveBeenCalledOnce();
		expect(rebuild.mock.invocationCallOrder[0]).toBeLessThan(
			modal.open.mock.invocationCallOrder[0],
		);
		expect(modal.containerEl.classList.contains(PEEK_INSTANT_CLASS)).toBe(true);
	});
});