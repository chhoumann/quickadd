const CAPTURE_CHOICE = "Capture choice";

module.exports = {
	entry: start,
	settings: {
		name: "Brain dump",
		author: "QuickAdd",
		options: {
			[CAPTURE_CHOICE]: {
				type: "text",
				defaultValue: "Add to inbox",
				placeholder: "Add to inbox",
				description: "The Capture choice to open again after each entry",
			},
		},
	},
};

async function start(params, settings) {
	const choice =
		String(settings?.[CAPTURE_CHOICE] ?? "").trim() || "Add to inbox";

	// Each entry runs the Capture once. Esc (or Cancel) rejects, which ends the
	// loop. A Capture that never asks for input would repeat forever, so stop.
	while (await askedForInput(() => params.quickAddApi.executeChoice(choice))) {}

	new params.obsidian.Notice(
		`Brain dump stopped: "${choice}" didn't ask for any input.`,
	);
}

// Runs `run` and reports whether a dialog, such as a prompt, opened meanwhile.
async function askedForInput(run) {
	let opened = false;
	const check = (records) => {
		opened ||= records.some((record) =>
			[...record.addedNodes].some((node) =>
				node.classList?.contains("modal-container"),
			),
		);
	};
	const observer = new MutationObserver(check);
	observer.observe(activeDocument.body, { childList: true });
	try {
		await run();
	} finally {
		check(observer.takeRecords());
		observer.disconnect();
	}
	return opened;
}
