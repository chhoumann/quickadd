import { describe, expect, it } from "vitest";
import { QuickAddEngine } from "./QuickAddEngine";

class TestEngine extends QuickAddEngine {
	public constructor() {
		super({} as any);
	}

	public normalize(folderPath: string, fileName: string): string {
		return this.normalizeMarkdownFilePath(folderPath, fileName);
	}

	public run(): void {}
}

describe("QuickAddEngine path normalization", () => {
	const engine = new TestEngine();

	it("strips leading slashes from folder and file", () => {
		expect(engine.normalize("/daily", "/note")).toBe("daily/note.md");
	});

	it("strips leading slashes from file-only paths", () => {
		expect(engine.normalize("", "/review/daily")).toBe("review/daily.md");
	});
});
