/**
 * Throwaway port of obsidian-paste-image-rename 1.6.1
 * (src/template.ts + generateNewName + deduplicateNewName).
 * {{VALUE}} is a QuickAdd-only extra for the Pattern variant.
 */

const DATE_TMPL = /{{DATE:([^}]+)}}/g;
const FRONTMATTER_TMPL = /{{frontmatter:([^}]+)}}/g;
const FILENAME_NOT_ALLOWED = /[^\p{L}0-9~`!@$&*()\-_=+{};'",<.>? ]/gu;

export const PASTED_IMAGE_PREFIX = "Pasted image ";
export const QUICKADD_CLIPBOARD_PREFIX = "Clipboard image ";

export const DEFAULT_SETTINGS = {
	imageNamePattern: "{{fileName}}",
	dupNumberAtStart: false,
	dupNumberDelimiter: "-",
	dupNumberAlways: false,
};

export function sanitizerFilename(s) {
	return s.replace(FILENAME_NOT_ALLOWED, "").trim();
}

export function pad2(n) {
	return String(n).padStart(2, "0");
}

export function formatClipboardAttachmentTimestamp(date) {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
		date.getDate(),
	)} ${pad2(date.getHours())}.${pad2(date.getMinutes())}.${pad2(
		date.getSeconds(),
	)}`;
}

function formatMomentish(date, format) {
	const tokens = {
		YYYY: String(date.getFullYear()),
		MM: pad2(date.getMonth() + 1),
		DD: pad2(date.getDate()),
		HH: pad2(date.getHours()),
		mm: pad2(date.getMinutes()),
		ss: pad2(date.getSeconds()),
	};
	return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => tokens[t] ?? t);
}

function replaceOnce(regex, text, replacer) {
	regex.lastIndex = 0;
	const m = regex.exec(text);
	if (!m) return text;
	return text.replace(m[0], replacer(m));
}

export function renderTemplate(tmpl, data, frontmatter, now) {
	let text = tmpl;
	let next;
	while ((next = replaceOnce(DATE_TMPL, text, (m) => formatMomentish(now, m[1]))) !== text) {
		text = next;
	}
	while (
		(next = replaceOnce(FRONTMATTER_TMPL, text, (m) => {
			if (!frontmatter) return "";
			return frontmatter[m[1]] ?? "";
		})) !== text
	) {
		text = next;
	}
	return text
		.replace(/{{imageNameKey}}/g, data.imageNameKey ?? "")
		.replace(/{{fileName}}/g, data.fileName ?? "")
		.replace(/{{dirName}}/g, data.dirName ?? "")
		.replace(/{{firstHeading}}/g, data.firstHeading ?? "")
		.replace(/{{VALUE}}/g, data.value ?? "");
}

export function generateNewName(fileExt, activeFile, settings, extras, now) {
	const stem = sanitizerFilename(
		renderTemplate(
			settings.imageNamePattern,
			{
				imageNameKey: extras.imageNameKey ?? "",
				fileName: activeFile.basename,
				dirName: extras.dirName ?? "",
				firstHeading: extras.firstHeading ?? "",
				value: extras.value ?? "",
			},
			extras.frontmatter,
			now,
		),
	);
	const delim = settings.dupNumberDelimiter || "-";
	const meaningless = new RegExp(`[${delim}\\s]`, "gm");
	return {
		stem,
		newName: `${stem}.${fileExt}`,
		isMeaningful: stem.replace(meaningless, "") !== "",
	};
}

function escapeRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extensionOf(name) {
	const i = name.lastIndexOf(".");
	return i === -1 ? "" : name.slice(i + 1);
}

/**
 * `existing` is sibling basenames in the attachment folder.
 */
export function deduplicateNewName(newName, existing, settings) {
	const newNameExt = extensionOf(newName);
	const newNameStem = newName.slice(0, newName.length - newNameExt.length - 1);
	const delim = settings.dupNumberDelimiter;
	const stemEsc = escapeRegExp(newNameStem);
	const delimEsc = escapeRegExp(delim);
	const dupNameRegex = settings.dupNumberAtStart
		? new RegExp(`^(?<number>\\d+)${delimEsc}(?<name>${stemEsc})\\.${newNameExt}$`)
		: new RegExp(
				`^(?<name>${stemEsc})${delimEsc}(?<number>\\d+)\\.${newNameExt}$`,
			);

	const dupNameNumbers = [];
	let isNewNameExist = false;
	for (const sibling of existing) {
		const base = sibling.split("/").pop();
		if (base === newName) {
			isNewNameExist = true;
			continue;
		}
		const m = dupNameRegex.exec(base);
		if (!m) continue;
		dupNameNumbers.push(parseInt(m.groups.number, 10));
	}

	let name = newName;
	if (isNewNameExist || settings.dupNumberAlways) {
		const newNumber = dupNameNumbers.length > 0 ? Math.max(...dupNameNumbers) + 1 : 1;
		name = settings.dupNumberAtStart
			? `${newNumber}${delim}${newNameStem}.${newNameExt}`
			: `${newNameStem}${delim}${newNumber}.${newNameExt}`;
	}

	return {
		name,
		stem: name.slice(0, name.length - newNameExt.length - 1),
		extension: newNameExt,
	};
}

export function wouldPasteImageRenameCatch(filename, handleAllAttachments) {
	if (filename.startsWith(PASTED_IMAGE_PREFIX)) return { catch: true, reason: "prefix" };
	if (handleAllAttachments) return { catch: true, reason: "handleAllAttachments" };
	return { catch: false, reason: "quickadd-prefix" };
}

export function planPaste(variant, ctx) {
	const ext = ctx.extension || "png";
	const folder = ctx.attachmentFolder || "attachments";
	const existing = ctx.existing.slice();
	const now = ctx.now ?? new Date();
	const settings = { ...DEFAULT_SETTINGS, ...ctx.settings };

	if (variant === "today") {
		const name = `${QUICKADD_CLIPBOARD_PREFIX}${formatClipboardAttachmentTimestamp(now)}.${ext}`;
		return {
			originName: name,
			finalName: name,
			path: `${folder}/${name}`,
			namedAt: "write",
			needsModal: false,
			pluginWouldCatch: wouldPasteImageRenameCatch(name, false),
		};
	}

	if (variant === "silent" || variant === "pattern") {
		const { stem, newName, isMeaningful } = generateNewName(
			ext,
			{ basename: ctx.fileName },
			settings,
			ctx,
			now,
		);
		if (!isMeaningful) {
			const fallback = `${QUICKADD_CLIPBOARD_PREFIX}${formatClipboardAttachmentTimestamp(now)}.${ext}`;
			return {
				originName: fallback,
				finalName: fallback,
				finalStem: fallback.slice(0, -ext.length - 1),
				path: `${folder}/${fallback}`,
				namedAt: "write",
				needsModal: false,
				isMeaningful: false,
				pluginWouldCatch: wouldPasteImageRenameCatch(fallback, false),
			};
		}
		const { name } = deduplicateNewName(newName, existing, settings);
		return {
			originName: name,
			finalName: name,
			finalStem: name.slice(0, -ext.length - 1),
			stem,
			path: `${folder}/${name}`,
			namedAt: "write",
			needsModal: false,
			isMeaningful: true,
			pluginWouldCatch: wouldPasteImageRenameCatch(name, false),
		};
	}

	const originName = `${PASTED_IMAGE_PREFIX}${formatClipboardAttachmentTimestamp(now).replace(/[-:. ]/g, "")}.${ext}`;
	const { stem, newName, isMeaningful } = generateNewName(
		ext,
		{ basename: ctx.fileName },
		settings,
		ctx,
		now,
	);
	const suggested = isMeaningful
		? deduplicateNewName(newName, existing, settings).name
		: "";
	return {
		originName,
		finalName: suggested || originName,
		finalStem: isMeaningful ? suggested.slice(0, -ext.length - 1) : "",
		stem: isMeaningful ? stem : "",
		path: `${folder}/${suggested || originName}`,
		namedAt: "after-create",
		needsModal: true,
		isMeaningful,
		pluginWouldCatch: wouldPasteImageRenameCatch(originName, false),
	};
}
