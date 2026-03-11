import type { App } from "obsidian";

export async function ensureParentFolders(
	app: App,
	filePath: string,
): Promise<void> {
	const lastSlash = filePath.lastIndexOf("/");
	if (lastSlash < 0) return;

	const folderPath = filePath.slice(0, lastSlash);
	if (!folderPath) return;

	const segments = folderPath.split("/").filter(Boolean);
	let current = "";

	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const exists = await app.vault.adapter.exists(current);
		if (!exists) {
			await app.vault.createFolder(current);
		}
	}
}
