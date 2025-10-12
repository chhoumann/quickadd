import type IChoice from "../../types/choices/IChoice";

export const QUICKADD_PACKAGE_SCHEMA_VERSION = 1 as const;

export type QuickAddPackageAssetKind =
	| "user-script"
	| "conditional-script"
	| "template"
	| "capture-template";

export interface QuickAddPackageAsset {
	kind: QuickAddPackageAssetKind;
	originalPath: string;
	contentEncoding: "base64";
	content: string;
}

export interface QuickAddPackageChoice {
	choice: IChoice;
	pathHint: string[];
	parentChoiceId: string | null;
}

export interface QuickAddPackage {
	schemaVersion: typeof QUICKADD_PACKAGE_SCHEMA_VERSION;
	quickAddVersion: string;
	createdAt: string;
	rootChoiceIds: string[];
	choices: QuickAddPackageChoice[];
	assets: QuickAddPackageAsset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isChoiceLike(value: unknown): value is IChoice {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		typeof value.type === "string"
	);
}

function isPackageChoice(value: unknown): value is QuickAddPackageChoice {
	if (!isRecord(value)) return false;
	return (
		isChoiceLike(value.choice) &&
		isStringArray(value.pathHint) &&
		(value.parentChoiceId === null || typeof value.parentChoiceId === "string")
	);
}

function isPackageAsset(value: unknown): value is QuickAddPackageAsset {
	if (!isRecord(value)) return false;

	const { kind, originalPath, contentEncoding, content } = value;
	const validKind =
		kind === "user-script" ||
		kind === "conditional-script" ||
		kind === "template" ||
		kind === "capture-template";
	return (
		validKind &&
		typeof originalPath === "string" &&
		contentEncoding === "base64" &&
		typeof content === "string"
	);
}

export function isQuickAddPackage(value: unknown): value is QuickAddPackage {
	if (!isRecord(value)) return false;

	const {
		schemaVersion,
		quickAddVersion,
		createdAt,
		rootChoiceIds,
		choices,
		assets,
	} = value;

	const schemaMatches =
		schemaVersion === QUICKADD_PACKAGE_SCHEMA_VERSION;

	return (
		schemaMatches &&
		typeof quickAddVersion === "string" &&
		typeof createdAt === "string" &&
		isStringArray(rootChoiceIds) &&
		Array.isArray(choices) &&
		choices.every(isPackageChoice) &&
		Array.isArray(assets) &&
		assets.every(isPackageAsset)
	);
}
