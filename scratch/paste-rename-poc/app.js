import { deduplicateNewName, planPaste, sanitizerFilename } from "./engine.js";

const BLURBS = {
	today:
		"Today. QuickAdd writes Clipboard image plus a timestamp. paste-image-rename never sees it, because it only auto-hooks files named Pasted image …",
	silent:
		"Silent title. The file is created as the destination note stem. No second modal. Collision adds -1. This is the issue request, done at write time instead of as a rename.",
	confirm:
		"Confirm modal. The plugin default. A second dialog stacks on the capture prompt. Enter is already Capture. This is the hostile one.",
	pattern:
		"Pattern at write. Same tokens as the plugin, plus {{VALUE}} from the prompt. No modal. Empty stems fall back to the timestamp name.",
};

const state = {
	variant: "today",
	files: [],
	pending: null,
	previewUrl: "",
	seq: 0,
};

const els = {
	tabs: [...document.querySelectorAll("[data-variant]")],
	blurb: document.getElementById("variant-blurb"),
	fileName: document.getElementById("file-name"),
	dirName: document.getElementById("dir-name"),
	value: document.getElementById("value"),
	imageNameKey: document.getElementById("image-name-key"),
	pattern: document.getElementById("pattern"),
	patternField: document.getElementById("pattern-field"),
	dupAlways: document.getElementById("dup-always"),
	field: document.getElementById("capture-field"),
	destLabel: document.getElementById("dest-label"),
	fileList: document.getElementById("file-list"),
	pluginCatch: document.getElementById("plugin-catch"),
	pasteSample: document.getElementById("paste-sample"),
	reset: document.getElementById("reset"),
	overlay: document.getElementById("rename-modal"),
	originPath: document.getElementById("origin-path"),
	newPath: document.getElementById("new-path"),
	renameStem: document.getElementById("rename-stem"),
	renameError: document.getElementById("rename-error"),
	confirmRename: document.getElementById("confirm-rename"),
	cancelRename: document.getElementById("cancel-rename"),
	previewImg: document.getElementById("preview-img"),
};

function ctx() {
	const pattern =
		state.variant === "pattern" ? els.pattern.value : "{{fileName}}";
	return {
		fileName: els.fileName.value || "Untitled",
		dirName: els.dirName.value,
		value: els.value.value,
		imageNameKey: els.imageNameKey.value,
		extension: "png",
		existing: state.files.map((f) => f.name),
		now: new Date(),
		settings: {
			imageNamePattern: pattern,
			dupNumberAtStart: false,
			dupNumberDelimiter: "-",
			dupNumberAlways: els.dupAlways.checked,
		},
	};
}

function setVariant(variant) {
	state.variant = variant;
	for (const tab of els.tabs) {
		tab.setAttribute("aria-selected", String(tab.dataset.variant === variant));
	}
	els.blurb.textContent = BLURBS[variant];
	els.patternField.hidden = variant !== "pattern";
	els.destLabel.textContent = `${els.dirName.value}/${els.fileName.value}.md`;
}

function renderFiles(highlight) {
	els.fileList.replaceChildren();
	if (state.files.length === 0) {
		const empty = document.createElement("li");
		empty.textContent = "(empty)";
		els.fileList.append(empty);
	}
	for (const file of state.files) {
		const li = document.createElement("li");
		li.textContent = file.name;
		if (file.name === highlight) li.classList.add("new");
		els.fileList.append(li);
	}
}

function insertEmbed(path) {
	const embed = `![[${path}]]`;
	const start = els.field.selectionStart ?? els.field.value.length;
	const end = els.field.selectionEnd ?? start;
	els.field.setRangeText(embed, start, end, "end");
	els.field.dispatchEvent(new Event("input"));
}

function rewriteLastEmbed(fromPath, toPath) {
	const from = `![[${fromPath}]]`;
	const to = `![[${toPath}]]`;
	if (els.field.value.includes(from)) {
		els.field.value = els.field.value.replace(from, to);
	} else {
		insertEmbed(toPath);
	}
}

function showCatch(plan) {
	const el = els.pluginCatch;
	if (plan.pluginWouldCatch.catch) {
		el.className = "catch hit";
		el.textContent =
			plan.pluginWouldCatch.reason === "prefix"
				? "paste-image-rename would catch this (Pasted image prefix)."
				: "paste-image-rename would catch this only because Handle all attachments is on.";
		return;
	}
	el.className = "catch miss";
	el.textContent =
		"paste-image-rename would ignore this. QuickAdd's Clipboard image prefix is not Pasted image …";
}

function makePreview() {
	const canvas = document.createElement("canvas");
	canvas.width = 640;
	canvas.height = 360;
	const g = canvas.getContext("2d");
	g.fillStyle = "#1b2430";
	g.fillRect(0, 0, 640, 360);
	g.fillStyle = "#7f6df2";
	g.fillRect(0, 0, 640, 8);
	g.fillStyle = "#e8e6ff";
	g.font = "28px sans-serif";
	g.fillText("Screenshot " + ++state.seq, 32, 80);
	g.fillStyle = "#9aa4b5";
	g.font = "16px sans-serif";
	g.fillText("Destination: " + els.fileName.value, 32, 130);
	g.fillText("VALUE: " + els.value.value, 32, 160);
	g.fillText("Variant: " + state.variant, 32, 190);
	return canvas.toDataURL("image/png");
}

function applyPlan(plan, previewUrl) {
	if (plan.needsModal) {
		state.pending = { plan, previewUrl };
		els.originPath.textContent = `attachments/${plan.originName}`;
		els.renameStem.value = plan.stem || "";
		els.newPath.textContent = `attachments/${plan.finalName}`;
		els.previewImg.src = previewUrl;
		els.renameError.hidden = true;
		els.overlay.hidden = false;
		els.renameStem.focus();
		els.renameStem.select();
		state.files.push({ name: plan.originName });
		insertEmbed(`attachments/${plan.originName}`);
		renderFiles(plan.originName);
		showCatch(plan);
		return;
	}
	state.files.push({ name: plan.finalName });
	insertEmbed(plan.path);
	renderFiles(plan.finalName);
	showCatch(plan);
}

function pasteOnce() {
	const previewUrl = makePreview();
	state.previewUrl = previewUrl;
	applyPlan(planPaste(state.variant, ctx()), previewUrl);
}

function confirmRename() {
	const pending = state.pending;
	if (!pending) return;
	const stem = sanitizerFilename(els.renameStem.value);
	if (!stem) {
		els.renameError.hidden = false;
		return;
	}
	const siblings = state.files
		.map((f) => f.name)
		.filter((n) => n !== pending.plan.originName);
	const { name } = deduplicateNewName(
		`${stem}.png`,
		siblings,
		ctx().settings,
	);
	const idx = state.files.findIndex((f) => f.name === pending.plan.originName);
	if (idx !== -1) state.files[idx] = { name };
	rewriteLastEmbed(
		`attachments/${pending.plan.originName}`,
		`attachments/${name}`,
	);
	renderFiles(name);
	els.overlay.hidden = true;
	state.pending = null;
}

els.tabs.forEach((tab) => {
	tab.addEventListener("click", () => setVariant(tab.dataset.variant));
});
window.addEventListener("keydown", (e) => {
	if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
		if (!["1", "2", "3", "4"].includes(e.key) || e.metaKey || e.ctrlKey) return;
		if (e.target === els.field && !e.altKey) return;
	}
	const map = { 1: "today", 2: "silent", 3: "confirm", 4: "pattern" };
	if (map[e.key]) {
		e.preventDefault();
		setVariant(map[e.key]);
	}
});

els.fileName.addEventListener("input", () => {
	els.destLabel.textContent = `${els.dirName.value}/${els.fileName.value}.md`;
});
els.dirName.addEventListener("input", () => {
	els.destLabel.textContent = `${els.dirName.value}/${els.fileName.value}.md`;
});
els.renameStem.addEventListener("input", () => {
	const stem = sanitizerFilename(els.renameStem.value);
	els.newPath.textContent = `attachments/${stem || "?"}.png`;
});
els.renameStem.addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault();
		confirmRename();
	}
});

els.pasteSample.addEventListener("click", pasteOnce);
els.reset.addEventListener("click", () => {
	state.files = [];
	els.field.value = "";
	els.pluginCatch.textContent = "";
	els.overlay.hidden = true;
	state.pending = null;
	renderFiles();
});
els.confirmRename.addEventListener("click", confirmRename);
els.cancelRename.addEventListener("click", () => {
	els.overlay.hidden = true;
	state.pending = null;
});

els.field.addEventListener("paste", (event) => {
	const items = [...(event.clipboardData?.items ?? [])];
	const hasImage = items.some((i) => i.type.startsWith("image/"));
	if (!hasImage) return;
	event.preventDefault();
	pasteOnce();
});

setVariant("today");
renderFiles();
