import { beforeEach } from "vitest";
import { createQuickAddObsidianClient } from "./e2eVault";
import { setFocusEmulation, takeInputLog } from "./uiHelpers";

const obsidian = createQuickAddObsidianClient();

beforeEach(async (ctx) => {
	// Notices outlive the spec that raised them. They stack from the top-right
	// corner over any modal, so a busy earlier spec can cover a button this test
	// clicks, or leave a notice this test asserts on.
	//
	// On macOS, Obsidian shows menus as native OS menus unless the vault turns
	// them off, so a spec finds no `.menu` to measure or click. Draw them in the
	// page as on Linux and Windows. The vault's setting is put back, so a later
	// config save cannot write this one to a real vault (#2207).
	const inFront = await obsidian.dev.evalJson<boolean>(`(() => {
		for (const notice of document.querySelectorAll(".notice")) notice.remove();
		const nativeMenus = app.vault.config.nativeMenus;
		app.vault.config.nativeMenus = false;
		app.updateUseNativeMenu();
		app.vault.config.nativeMenus = nativeMenus;
		return document.visibilityState === "visible" && document.hasFocus();
	})()`);
	// Without this, transitions and scroll-driven animations never apply on a
	// covered window. A spec about a backgrounded window turns it off. Sent
	// only when needed, since under load a CLI call can lose its reply.
	if (!inFront) await setFocusEmulation(obsidian, true);
	takeInputLog();
	ctx.onTestFailed(() => {
		const log = takeInputLog();
		if (log.length > 0) console.warn(`Native input sent by "${ctx.task.name}":\n${log.join("\n")}`);
	});
});
