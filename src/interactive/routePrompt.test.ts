import { describe, expect, it, vi } from "vitest";
import { routePrompt } from "./routePrompt";
import { promptEngineChoice } from "./engineChoice";
import { UserCancelError } from "../errors/UserCancelError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import type { PromptProvider } from "./promptProvider";
import type { PromptRoutingContext } from "./routePrompt";

const routes = () => ({
	remote: vi.fn(async () => "remote"),
	headless: vi.fn(async () => "headless"),
	app: vi.fn(async () => "app"),
});

describe("routePrompt (#1614)", () => {
	it("sends an engine prompt to the connected client when one is driving the run", async () => {
		const r = routes();
		const provider = {} as PromptProvider;

		await expect(
			routePrompt({ promptProvider: provider, interactive: true } as PromptRoutingContext, r),
		).resolves.toBe("remote");
		expect(r.app).not.toHaveBeenCalled();
		expect(r.remote).toHaveBeenCalledWith(provider);
	});

	// `interactive = true` is what an interactive run sets, and it used to do nothing
	// but DISABLE the headless guards - so the modal opened on a desktop nobody was
	// watching. The provider check has to come first, not the interactive flag.
	it("prefers the client over the modal even though the run is marked interactive", async () => {
		const r = routes();

		await routePrompt(
			{ promptProvider: {} as PromptProvider, interactive: true } as PromptRoutingContext,
			r,
		);

		expect(r.remote).toHaveBeenCalledTimes(1);
		expect(r.app).not.toHaveBeenCalled();
		expect(r.headless).not.toHaveBeenCalled();
	});

	it("takes the site's own headless branch on a non-interactive run", async () => {
		const r = routes();

		await expect(
			routePrompt({ interactive: false } as PromptRoutingContext, r),
		).resolves.toBe("headless");
		expect(r.app).not.toHaveBeenCalled();
	});

	// Not every site aborts headlessly: MacroChoiceEngine runs a sole exported member
	// without asking. A fixed ladder that always threw would have regressed that, which
	// is why `headless` is a closure the site owns rather than a behaviour the seam picks.
	it("lets a headless branch resolve instead of throwing", async () => {
		await expect(
			routePrompt({ interactive: false } as PromptRoutingContext, {
				remote: async () => "remote",
				headless: async () => "the only export",
				app: async () => "app",
			}),
		).resolves.toBe("the only export");
	});

	it("opens the Obsidian modal for an ordinary in-app run", async () => {
		const r = routes();

		await expect(routePrompt({} as PromptRoutingContext, r)).resolves.toBe("app");
	});

	it.each([
		["app", { app: true }],
		["remote", { promptProvider: {} as PromptProvider }],
	])(
		"maps a %s dismissal to UserCancelError, so every route reads the same",
		async (_label, ctx) => {
			const dismissal = new UserCancelError("Prompt cancelled");
			const throwing = {
				remote: async () => {
					throw dismissal;
				},
				headless: async () => "headless",
				app: async () => {
					throw dismissal;
				},
			};

			await expect(
				routePrompt(ctx as PromptRoutingContext, throwing),
			).rejects.toBeInstanceOf(UserCancelError);
		},
	);

	it("passes a non-cancellation failure through untouched", async () => {
		const boom = new ChoiceAbortError("needs a specific action");

		await expect(
			routePrompt({ interactive: false } as PromptRoutingContext, {
				remote: async () => "remote",
				headless: async () => {
					throw boom;
				},
				app: async () => "app",
			}),
		).rejects.toBe(boom);
	});
});

describe("promptEngineChoice enforces what the in-app modal enforces structurally", () => {
	const items = [
		{ value: "appendBottom", title: "Append to bottom" },
		{ value: "doNothing", title: "Do nothing" },
	];
	const what = 'the "file already exists" chooser';

	const providerReturning = (answer: unknown) =>
		({ suggester: vi.fn(async () => answer) }) as unknown as PromptProvider;

	it("refuses a reply that echoes a raw value instead of the row's handle", async () => {
		await expect(
			promptEngineChoice(providerReturning("doNothing"), { items, what }),
		).rejects.toThrow(/has to be one of the offered options/);
	});

	// GenericSuggester can only ever resolve an element of its list. Routing the prompt
	// must not quietly widen a closed list into free text just because the answer now
	// arrives over HTTP - `getFileExistsMode` would throw `Unknown file exists mode:`.
	it("refuses an off-list reply on a closed list, naming the fix", async () => {
		await expect(
			promptEngineChoice(providerReturning("Archive/Secret"), { items, what }),
		).rejects.toThrow(/has to be one of the offered options/);
	});

	// `RemotePromptProvider.suggester` maps a missing value to "" for the script callers
	// that treat it as "skipped". At an engine picker there is no empty row, and acting
	// on "" is how the folder chooser used to create the note in the VAULT ROOT.
	it.each([[""], [null], [undefined]])(
		"treats an empty reply (%s) as a dismissal, never as an answer",
		async (answer) => {
			await expect(
				promptEngineChoice(providerReturning(answer), { items, what }),
			).rejects.toBeInstanceOf(UserCancelError);
		},
	);

	it("accepts a typed-in value only where the site allows custom input", async () => {
		await expect(
			promptEngineChoice(providerReturning("A brand new note"), {
				items,
				what,
				allowCustomInput: true,
			}),
		).resolves.toBe("A brand new note");
	});

	// A folder list CAN legitimately contain "" (a `{{VALUE:sub}}` entry that resolved to
	// nothing is the vault root). Picking that row and answering nothing at all must not
	// collapse into the same thing: one creates the note at the vault root, the other has
	// to abort. The row handles are what keep them apart.
	describe("when '' is one of the offered rows", () => {
		const withRoot = [
			{ value: "", title: "/" },
			{ value: "Archive", title: "Archive" },
		];

		it("returns the root value when the client PICKS that row", async () => {
			// The client echoes the row's opaque handle, as it does for any row.
			const provider = {
				suggester: vi.fn(
					async (_display: unknown, handles: string[]) => handles[0],
				),
			} as unknown as PromptProvider;

			await expect(
				promptEngineChoice(provider, { items: withRoot, what }),
			).resolves.toBe("");
		});

		it("cancels when the client answers NOTHING", async () => {
			await expect(
				promptEngineChoice(providerReturning(""), { items: withRoot, what }),
			).rejects.toBeInstanceOf(UserCancelError);
		});
	});

	it("still refuses an empty reply where custom input is allowed", async () => {
		await expect(
			promptEngineChoice(providerReturning(""), {
				items,
				what,
				allowCustomInput: true,
			}),
		).rejects.toBeInstanceOf(UserCancelError);
	});

	it("sends titles and opaque handles, never the underlying values, and closes the list by default", async () => {
		const provider = providerReturning("appendBottom");

		await promptEngineChoice(provider, { items, what, placeholder: "Pick one" }).catch(
			() => undefined,
		);

		const [displays, handles, placeholder, allowCustom] = (
			provider.suggester as ReturnType<typeof vi.fn>
		).mock.calls[0];
		expect(displays).toEqual(["Append to bottom", "Do nothing"]);
		expect(handles).toHaveLength(2);
		expect(handles[0]).not.toBe("appendBottom");
		expect(placeholder).toBe("Pick one");
		expect(allowCustom).toBe(false);
	});

	it("round-trips a picked row back to its original value", async () => {
		const provider = {
			suggester: vi.fn(async (_d: unknown, handles: string[]) => handles[1]),
		} as unknown as PromptProvider;

		await expect(
			promptEngineChoice(provider, { items, what }),
		).resolves.toBe("doNothing");
	});
});
