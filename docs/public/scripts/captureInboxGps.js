const INBOX_PATH = "Inbox path";
const CREATE_IF_MISSING = "Create Inbox if missing";

module.exports = {
	entry: start,
	settings: {
		name: "Capture to Inbox with GPS",
		author: "QuickAdd",
		options: {
			[INBOX_PATH]: {
				type: "text",
				defaultValue: "Inbox.md",
				placeholder: "Inbox.md",
				description: "Vault path of the note to append to",
			},
			[CREATE_IF_MISSING]: {
				type: "toggle",
				defaultValue: true,
				description: "Create the Inbox note when it does not exist",
			},
		},
	},
};

async function start(params, settings) {
	const { Notice, TFile, normalizePath } = params.obsidian;
	const inboxPath = normalizePath(
		String(settings?.[INBOX_PATH] || "Inbox.md").trim() || "Inbox.md",
	);
	const createIfMissing = settings?.[CREATE_IF_MISSING] !== false;

	const coordsPromise = resolveCoordinates(params.variables);
	const text = await resolveNoteText(params);
	if (!text) return;

	const coords = await coordsPromise;
	const stamp = formatStamp();
	const suffix = coords ? ` (${coords})` : "";
	const line = `- ${stamp} ${text}${suffix}\n`;

	const existing = params.app.vault.getAbstractFileByPath(inboxPath);
	if (existing instanceof TFile) {
		await params.app.vault.append(existing, line);
	} else if (existing) {
		new Notice(`QuickAdd: ${inboxPath} is a folder, not a note`);
		return;
	} else if (createIfMissing) {
		await ensureParentFolders(params.app, inboxPath);
		await params.app.vault.create(inboxPath, line);
	} else {
		new Notice(`QuickAdd: ${inboxPath} not found`);
		return;
	}

	if (!coords) {
		new Notice("Saved without GPS (no fix, permission denied, or desktop)");
	}
}

async function resolveNoteText(params) {
	const preset = params.variables?.value;
	if (typeof preset === "string") {
		return preset.trim();
	}
	const typed = await params.quickAddApi.inputPrompt("Inbox");
	return typeof typed === "string" ? typed.trim() : "";
}

function resolveCoordinates(variables) {
	const preset = variables?.coordinates;
	if (typeof preset === "string" && preset.trim()) {
		return Promise.resolve(preset.trim());
	}

	return new Promise((resolve) => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			resolve("");
			return;
		}

		navigator.geolocation.getCurrentPosition(
			(pos) => {
				resolve(
					`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`,
				);
			},
			() => resolve(""),
			{
				enableHighAccuracy: true,
				timeout: 30000,
				maximumAge: 60000,
			},
		);
	});
}

function formatStamp() {
	if (typeof window !== "undefined" && window.moment) {
		return window.moment().format("YYYY-MM-DD HH:mm");
	}
	return new Date().toISOString().slice(0, 16).replace("T", " ");
}

async function ensureParentFolders(app, filePath) {
	const parts = filePath.split("/").filter(Boolean);
	parts.pop();
	let folder = "";
	for (const part of parts) {
		folder = folder ? `${folder}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(folder)) {
			await app.vault.createFolder(folder);
		}
	}
}
