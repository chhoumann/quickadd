#!/usr/bin/env node
import {
	DEFAULT_SETTINGS,
	deduplicateNewName,
	generateNewName,
	planPaste,
	renderTemplate,
	wouldPasteImageRenameCatch,
} from "./engine.js";

const now = new Date("2026-08-29T21:40:00");

function heading(title) {
	console.log("");
	console.log(`== ${title}`);
}

heading("README examples (fileName=My note, imageNameKey=foo)");
const cases = [
	["{{fileName}}", "My note"],
	["{{imageNameKey}}", "foo"],
	["{{imageNameKey}}-{{DATE:YYYYMMDD}}", "foo-20260829"],
];
for (const [pattern, expectStem] of cases) {
	const stem = renderTemplate(
		pattern,
		{ fileName: "My note", imageNameKey: "foo", dirName: "", firstHeading: "", value: "" },
		{},
		now,
	);
	console.log(`  ${pattern} -> ${stem}  (readme wants ${expectStem})`);
}

heading("Collision suffix (plugin default: delimiter -, number at end)");
let existing = [];
for (let i = 0; i < 3; i++) {
	const { newName } = generateNewName(
		"png",
		{ basename: "Meeting notes" },
		DEFAULT_SETTINGS,
		{ imageNameKey: "", dirName: "Meetings", value: "standup" },
		now,
	);
	const { name } = deduplicateNewName(newName, existing, DEFAULT_SETTINGS);
	console.log(`  paste ${i + 1}: ${name}`);
	existing.push(name);
}

heading("Always-add duplicate number");
existing = [];
const always = { ...DEFAULT_SETTINGS, dupNumberAlways: true };
for (let i = 0; i < 2; i++) {
	const { newName } = generateNewName(
		"png",
		{ basename: "Meeting notes" },
		always,
		{ imageNameKey: "", value: "" },
		now,
	);
	const { name } = deduplicateNewName(newName, existing, always);
	console.log(`  paste ${i + 1}: ${name}`);
	existing.push(name);
}

heading("Prefix duplicate numbers");
existing = [];
const atStart = { ...DEFAULT_SETTINGS, dupNumberAtStart: true };
for (let i = 0; i < 2; i++) {
	const { newName } = generateNewName(
		"png",
		{ basename: "Meeting notes" },
		atStart,
		{ imageNameKey: "", value: "" },
		now,
	);
	const { name } = deduplicateNewName(newName, existing, atStart);
	console.log(`  paste ${i + 1}: ${name}`);
	existing.push(name);
}

heading("Would paste-image-rename catch QuickAdd's current filename?");
const today = planPaste("today", {
	fileName: "Meeting notes",
	extension: "png",
	existing: [],
	now,
	settings: DEFAULT_SETTINGS,
	imageNameKey: "",
	value: "",
});
console.log(`  QuickAdd writes: ${today.finalName}`);
console.log(
	`  plugin catch: ${JSON.stringify(wouldPasteImageRenameCatch(today.finalName, false))}`,
);
console.log(
	`  plugin catch if handleAllAttachments: ${JSON.stringify(wouldPasteImageRenameCatch(today.finalName, true))}`,
);

heading("Four variants, one paste into Capture targeting Meetings/Meeting notes.md");
for (const variant of ["today", "silent", "confirm", "pattern"]) {
	const plan = planPaste(variant, {
		fileName: "Meeting notes",
		extension: "png",
		existing: ["Meeting notes.png"],
		now,
		settings: {
			...DEFAULT_SETTINGS,
			imageNamePattern: variant === "pattern" ? "{{VALUE}}-{{DATE:YYYY-MM-DD}}" : "{{fileName}}",
		},
		imageNameKey: "my-blog",
		value: "standup",
		dirName: "Meetings",
	});
	console.log(
		`  ${variant}: ${plan.originName} -> ${plan.finalName}  namedAt=${plan.namedAt} modal=${plan.needsModal}`,
	);
}

heading("Meaningless pattern falls back ({{imageNameKey}} with empty key)");
const empty = generateNewName(
	"png",
	{ basename: "Meeting notes" },
	{ ...DEFAULT_SETTINGS, imageNamePattern: "{{imageNameKey}}" },
	{ imageNameKey: "", value: "" },
	now,
);
console.log(`  stem=${JSON.stringify(empty.stem)} meaningful=${empty.isMeaningful}`);
