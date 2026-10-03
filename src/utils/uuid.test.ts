import { afterEach, describe, expect, it, vi } from "vitest";
import { uuidv4 } from "./uuid";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("uuidv4", () => {
	it("uses the platform's randomUUID when it has one", () => {
		const spy = vi.spyOn(crypto, "randomUUID");
		const id = uuidv4();
		expect(spy).toHaveBeenCalledOnce();
		expect(id).toBe(spy.mock.results[0].value);
	});

	it("builds a version 4 UUID from random bytes where randomUUID is missing", () => {
		const randomUUID = crypto.randomUUID;
		Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
		try {
			const fill = (byte: number) =>
				vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
					(array as Uint8Array).fill(byte);
					return array;
				});
			fill(0x00);
			expect(uuidv4()).toBe("00000000-0000-4000-8000-000000000000");
			fill(0xff);
			expect(uuidv4()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
		} finally {
			Object.defineProperty(crypto, "randomUUID", { value: randomUUID, configurable: true });
		}
	});
});
