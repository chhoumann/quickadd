import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	acquireVaultRunLock,
	clearVaultRunLockMarker,
	createObsidianClient,
} from "obsidian-e2e";
import type { ObsidianClient, PluginHandle, VaultRunLock } from "obsidian-e2e";

const VAULT = "dev";
const PLUGIN_ID = "quickadd";
const CHOICE_ID = "qa-e2e-cond-branch";
const COND_ID = "qa-e2e-cond";

let obsidian: ObsidianClient;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HELP = `const allBy=(l)=>Array.from(document.querySelectorAll('[aria-label="'+l+'"]')); const lastBy=(l)=>{const e=allBy(l);return e[e.length-1]||null;}; const byText=(t)=>Array.from(document.querySelectorAll('.modal-container button')).filter(b=>b.textContent.trim()===t);`;
// Fast, synchronous evals only: dev.eval does not await long async bodies, but a
// synchronous click + immediate return transmits reliably. Timing is orchestrated
// here in Node (sleep between steps) so the app's async work settles.
const sev = (body: string) =>
	obsidian.dev.eval<string>(
		`(() => { ${HELP} try { ${body} } catch(e){ return 'ERR '+String(e&&e.message||e); } })()`,
	);

async function closeAllModals() {
	for (let i = 0; i < 6; i++) {
		await sev(
			`document.querySelectorAll('.modal-close-button').forEach(b=>b.click()); try{app.setting.close()}catch{} return '';`,
		);
		await sleep(150);
	}
}

beforeAll(async () => {
	obsidian = createObsidianClient({ vault: VAULT });
	await obsidian.verify();
	lock = await acquireVaultRunLock({
		vaultName: VAULT,
		vaultPath: await obsidian.vaultPath(),
	});
	await lock.publishMarker(obsidian);
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
		// add a Wait command -> Save -> close the macro builder.
		await sev(`app.setting.open(); return '';`);
		await sleep(600);
		await sev(`app.setting.openTabById('${PLUGIN_ID}'); return '';`);
		await sleep(1500);

		const cfg = await sev(`const c=lastBy('Configure QA-E2E Conditional'); c&&c.click(); return 'cfg='+!!c;`);
		expect(cfg).toBe("cfg=true");
		await sleep(1500);

		// Match by aria-label PREFIX: the label now carries the condition-summary
		// suffix ("Edit then branch for <summary>"), so an exact match would miss.
		const then = await sev(`const els=Array.from(document.querySelectorAll('[aria-label^="Edit then branch"]')); const t=els[els.length-1]; t&&t.click(); return 'then='+!!t;`);
		expect(then).toBe("then=true");
		await sleep(1500);

		const wait = await sev(`const w=lastBy('Add wait command'); w&&w.click(); return 'wait='+!!w;`);
		expect(wait).toBe("wait=true");
		await sleep(800);

		const saved = await sev(`const s=byText('Save'); s.length&&s[s.length-1].click(); return 'save='+s.length;`);
		expect(saved).toBe("save=1");
		await sleep(1200);

		await sev(`const x=Array.from(document.querySelectorAll('.modal-container .modal-close-button')); x.length&&x[x.length-1].click(); return '';`);
		await sleep(1200);
		await sev(`try{app.setting.close()}catch{} return '';`);
		await sleep(500);

		// Assert the added command persisted to data.json on disk.
		const onDiskThen = await obsidian.dev.eval<number>(`(async () => {
			const p=app.plugins.plugins.quickadd;
			const raw=await p.app.vault.adapter.read(p.manifest.dir+'/data.json');
			const ch=JSON.parse(raw).choices.find(c=>c.id==='${CHOICE_ID}');
			const cond=ch&&ch.macro.commands.find(c=>c.id==='${COND_ID}');
			return cond ? cond.thenCommands.length : -1;
		})()`);

		expect(onDiskThen).toBe(1);
	}, 60_000);
});
