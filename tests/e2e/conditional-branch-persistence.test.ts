import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearVaultRunLockMarker,
} from "obsidian-e2e";
import type { ObsidianClient, PluginHandle, VaultRunLock } from "obsidian-e2e";
import {
	acquireQuickAddVaultRunLock,
	createQuickAddObsidianClient,
} from "./e2eVault";

const PLUGIN_ID = "quickadd";
const CHOICE_ID = "qa-e2e-cond-branch";
const COND_ID = "qa-e2e-cond";

let obsidian: ObsidianClient;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

// Obsidian 1.13 opens Settings in a popout window by default
// (settingsPopoutWindow), so the settings GUI may live in the main document
// (modal mode / Obsidian <=1.12) OR in the popout window's document. All
// queries go through `docs()`/`q()` so the test is window-agnostic and drives
// whichever surface Obsidian actually rendered - the real user path.
//
// Modals are closed the way a user closes them: Escape, routed through
// Obsidian's per-window keymap scope. Obsidian 1.13 removed the
// `.modal-close-button` DOM affordance, which silently turned class-targeted
// close clicks into no-ops; Escape is registered by Modal itself and survives
// DOM redesigns. The KeyboardEvent is constructed in the target document's
// realm so dispatch works in popout windows too.
const HELP = `
const docs=()=>{const ds=[document];const w=app.setting.popout&&app.setting.popout.win;if(w&&!w.closed)ds.push(w.document);return ds;};
const q=(sel)=>docs().flatMap((d)=>Array.from(d.querySelectorAll(sel)));
const lastBy=(l)=>{const e=q('[aria-label="'+l+'"]');return e[e.length-1]||null;};
const btnByText=(t)=>q('.modal-container button').filter((b)=>b.textContent.trim()===t);
const pressEscapeIn=(d)=>{const W=d.defaultView||window;d.body.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));};
const clickLast=(sel)=>{const e=q(sel);if(!e.length)return 'missing '+sel;e[e.length-1].click();return 'ok';};
`;
// Fast, synchronous evals only: dev.eval does not await long async bodies, but
// a synchronous click + immediate return transmits reliably. Sequencing is
// handled by waitUi(): every step waits for the observable condition it needs
// instead of guessing durations with sleeps.
// Conditions return booleans (dev.eval JSON-parses results); clicks and
// probes return strings - callers pick the type.
const sev = <T = string>(body: string) =>
	obsidian.dev.eval<T>(
		`(() => { ${HELP} try { ${body} } catch(e){ return 'ERR '+String(e&&e.message||e); } })()`,
	);

/** Poll a HELP-scoped boolean expression inside the app until it holds. */
const waitUi = (label: string, cond: string, timeoutMs = 15_000) =>
	obsidian.waitFor(async () => (await sev<boolean | string>(`return ${cond};`)) === true, {
		message: label,
		timeoutMs,
	});

async function closeAllModals() {
	// Escape closes one modal per press, in every window; six rounds covers any
	// stack this suite can produce (each sev round-trip paces the loop).
	for (let i = 0; i < 6; i++) {
		await sev(
			`docs().forEach((d)=>pressEscapeIn(d)); try{app.setting.close()}catch{} return '';`,
		);
	}
	await waitUi("all modals closed", `q('.modal-container').length === 0`);
}

beforeAll(async () => {
	obsidian = createQuickAddObsidianClient();
	lock = await acquireQuickAddVaultRunLock(obsidian);
	await lock.publishMarker(obsidian);
	// Obsidian 1.13 defaults settingsPopoutWindow=true (Settings opens in a
	// popout window). The popout's DOM adoption is nondeterministic under
	// unfocused CLI automation: across clean runs the settings tree sometimes
	// attaches to the popout document and sometimes stays detached from every
	// document forever (see #1518) - an Obsidian-internal race this testbed
	// cannot fix. Pin the supported main-window modal mode for determinism;
	// the helpers above stay window-agnostic, so if a runner-side fix ever
	// makes popouts reliable, deleting this line is the whole migration.
	await obsidian.dev.eval(
		`app.vault.setConfig('settingsPopoutWindow', false)`,
	);
	qa = obsidian.plugin(PLUGIN_ID);
	await qa.reload({ waitUntilReady: true });
}, 30_000);

afterAll(async () => {
	try { await closeAllModals(); } catch { /* ignore */ }
	try { await qa?.restoreData?.(); } catch { /* ignore */ }
	try { await qa?.reload?.(); } catch { /* ignore */ }
	try { if (obsidian) await clearVaultRunLockMarker(obsidian); } catch { /* ignore */ }
	try { await lock?.release(); } catch { /* ignore */ }
}, 20_000);

describe("conditional command branch persistence (regression for the runes rewrite)", () => {
	it("persists a command added to a Conditional's Then branch through the macro editor GUI", async () => {
		// Seed a macro choice with a single Conditional command (empty then/else).
		await qa.data<{ choices: Record<string, unknown>[] }>().patch((data) => {
			data.choices = (data.choices ?? []).filter((c) => c.id !== CHOICE_ID);
			data.choices.push({
				id: CHOICE_ID,
				name: "QA-E2E Conditional",
				type: "Macro",
				command: false,
				runOnStartup: false,
				macro: {
					id: `${CHOICE_ID}-macro`,
					name: "QA-E2E Conditional",
					commands: [
						{
							id: COND_ID,
							name: "If condition",
							type: "Conditional",
							condition: { mode: "variable", variableName: "", operator: "isTruthy", valueType: "string" },
							thenCommands: [],
							elseCommands: [],
						},
					],
				},
			});
		});
		await qa.reload({ waitUntilReady: true });
		await closeAllModals();

		// Drive the real settings GUI: configure the macro -> edit Then branch ->
		// add a Wait command -> Save -> close the macro builder. Each click waits
		// for its target first, so the popout's async materialization is covered.
		await sev(`app.setting.open(); return '';`);
		await waitUi(
			"settings UI rendered (main window or popout)",
			`q('.vertical-tab-content, .setting-item').length > 0`,
		);
		await sev(`app.setting.openTabById('${PLUGIN_ID}'); return '';`);
		await waitUi(
			"QuickAdd tab shows the seeded choice",
			`!!lastBy('Configure QA-E2E Conditional')`,
		);
		expect(await sev(`return clickLast('[aria-label="Configure QA-E2E Conditional"]');`)).toBe("ok");

		// Match by aria-label PREFIX: the label carries the condition-summary
		// suffix ("Edit then branch for <summary>"), so an exact match would miss.
		await waitUi(
			"macro builder shows the conditional row",
			`q('[aria-label^="Edit then branch"]').length > 0`,
		);
		expect(await sev(`return clickLast('[aria-label^="Edit then branch"]');`)).toBe("ok");

		await waitUi("branch editor open", `!!lastBy('Add wait command')`);
		expect(await sev(`return clickLast('[aria-label="Add wait command"]');`)).toBe("ok");

		await waitUi("wait command staged", `btnByText('Save').length > 0`);
		expect(await sev(`const s=btnByText('Save'); s[s.length-1].click(); return 'ok';`)).toBe("ok");
		await waitUi("branch editor closed", `btnByText('Save').length === 0`);

		// Close the macro builder (Escape in its window). Its onClose resolves
		// waitForClose, which is the ONLY path that commits the configured choice
		// to the settings store and schedules the debounced disk save.
		await sev(`const b=q('.macroBuilder')[0]; if(b) pressEscapeIn(b.ownerDocument); return '';`);
		await waitUi("macro builder closed", `q('.macroBuilder').length === 0`);

		// Assert the added command persisted to data.json on disk. Poll: the
		// settings store flushes through a 1s debounce after the builder closes.
		// Settings stays open until this lands so the assertion observes the
		// debounced save before any teardown runs.
		const onDiskThen = await obsidian.waitFor(
			async () => {
				const len = await obsidian.dev.eval<number>(`(async () => {
					const p=app.plugins.plugins.quickadd;
					const raw=await p.app.vault.adapter.read(p.manifest.dir+'/data.json');
					const ch=JSON.parse(raw).choices.find(c=>c.id==='${CHOICE_ID}');
					const cond=ch&&ch.macro.commands.find(c=>c.id==='${COND_ID}');
					return cond ? cond.thenCommands.length : -1;
				})()`);
				return len === 1 ? len : false;
			},
			{ message: "then-branch command persisted to data.json", timeoutMs: 10_000 },
		);
		expect(onDiskThen).toBe(1);

		await sev(`try{app.setting.close()}catch{} return '';`);
	}, 60_000);
});
