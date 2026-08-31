import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scriptPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../docs/public/scripts/captureInboxGps.js",
);

class TFile {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
}

class Notice {
	static messages: string[] = [];
	constructor(message: string) {
		Notice.messages.push(message);
	}
}

function loadScript() {
	const source = readFileSync(scriptPath, "utf8");
	const module = {
		exports: {} as {
			entry: (
				params: unknown,
				settings?: Record<string, unknown>,
			) => Promise<void>;
			settings: unknown;
		},
	};
	const fn = new Function("require", "module", "exports", source);
	fn(() => undefined, module, module.exports);
	return module.exports;
}

function makeParams(options: {
	files?: Map<string, TFile | { folder: true; path: string }>;
	value?: string;
	coordinates?: string;
	geolocation?: {
		success?: { latitude: number; longitude: number };
		error?: boolean;
		missing?: boolean;
	};
}) {
	const files = options.files ?? new Map<string, TFile>();
	const created: { path: string; content: string }[] = [];
	const appended: { path: string; content: string }[] = [];
	const folders: string[] = [];

	const params = {
		app: {
			vault: {
				getAbstractFileByPath(filePath: string) {
					return files.get(filePath) ?? null;
				},
				append: vi.fn(async (file: TFile, content: string) => {
					appended.push({ path: file.path, content });
				}),
				create: vi.fn(async (filePath: string, content: string) => {
					created.push({ path: filePath, content });
					const file = new TFile(filePath);
					files.set(filePath, file);
					return file;
				}),
				createFolder: vi.fn(async (folderPath: string) => {
					folders.push(folderPath);
					files.set(folderPath, { folder: true, path: folderPath });
				}),
			},
		},
		quickAddApi: {
			inputPrompt: vi.fn(async () => "dictated note"),
		},
		variables: {
			...(options.value !== undefined ? { value: options.value } : {}),
			...(options.coordinates !== undefined
				? { coordinates: options.coordinates }
				: {}),
		},
		obsidian: { Notice, TFile, normalizePath: (value: string) => value },
	};

	if (options.geolocation?.missing) {
		vi.stubGlobal("navigator", {});
	} else {
		vi.stubGlobal("navigator", {
			geolocation: {
				getCurrentPosition: (
					success: (pos: GeolocationPosition) => void,
					error: () => void,
				) => {
					if (options.geolocation?.error) {
						error();
						return;
					}
					const coords = options.geolocation?.success ?? {
						latitude: 55.676098,
						longitude: 12.568337,
					};
					success({
						coords: {
							latitude: coords.latitude,
							longitude: coords.longitude,
							accuracy: 10,
							altitude: null,
							altitudeAccuracy: null,
							heading: null,
							speed: null,
						},
						timestamp: Date.now(),
					} as GeolocationPosition);
				},
			},
		});
	}

	vi.stubGlobal("moment", () => ({ format: () => "2026-08-31 15:42" }));
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		writable: true,
		value: { ...(typeof window === "undefined" ? {} : window), moment: globalThis.moment },
	});

	return { params, created, appended, folders };
}

describe("captureInboxGps script", () => {
	beforeEach(() => {
		Notice.messages = [];
		vi.unstubAllGlobals();
	});

	it("starts GPS, then appends a stamped line with coordinates", async () => {
		const existing = new TFile("Inbox.md");
		const { params, appended } = makeParams({
			files: new Map([["Inbox.md", existing]]),
		});
		const script = loadScript();

		await script.entry(params, {
			"Inbox path": "Inbox.md",
			"Create Inbox if missing": true,
		});

		expect(params.quickAddApi.inputPrompt).toHaveBeenCalled();
		expect(appended).toEqual([
			{
				path: "Inbox.md",
				content:
					"- 2026-08-31 15:42 dictated note (55.676098, 12.568337)\n",
			},
		]);
		expect(Notice.messages).toEqual([]);
	});

	it("uses preset value and coordinates without prompting or GPS", async () => {
		const existing = new TFile("Inbox.md");
		const { params, appended } = makeParams({
			files: new Map([["Inbox.md", existing]]),
			value: "Trail marker",
			coordinates: "1.000000, 2.000000",
			geolocation: { missing: true },
		});
		const script = loadScript();

		await script.entry(params, {
			"Inbox path": "Inbox.md",
			"Create Inbox if missing": true,
		});

		expect(params.quickAddApi.inputPrompt).not.toHaveBeenCalled();
		expect(appended[0]?.content).toBe(
			"- 2026-08-31 15:42 Trail marker (1.000000, 2.000000)\n",
		);
	});

	it("creates the inbox note when it is missing", async () => {
		const { params, created } = makeParams({
			value: "first capture",
			coordinates: "55.676098, 12.568337",
		});
		const script = loadScript();

		await script.entry(params, {
			"Inbox path": "Captures/Inbox.md",
			"Create Inbox if missing": true,
		});

		expect(created).toEqual([
			{
				path: "Captures/Inbox.md",
				content:
					"- 2026-08-31 15:42 first capture (55.676098, 12.568337)\n",
			},
		]);
	});

	it("saves without GPS when the location lookup fails", async () => {
		const existing = new TFile("Inbox.md");
		const { params, appended } = makeParams({
			files: new Map([["Inbox.md", existing]]),
			value: "no fix",
			geolocation: { error: true },
		});
		const script = loadScript();

		await script.entry(params, {
			"Inbox path": "Inbox.md",
			"Create Inbox if missing": true,
		});

		expect(appended[0]?.content).toBe("- 2026-08-31 15:42 no fix\n");
		expect(Notice.messages[0]).toContain("Saved without GPS");
	});
});
