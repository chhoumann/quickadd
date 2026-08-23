/**
 * In-app body for `seedVaultFile`. Kept as a standalone function so
 * `Function.prototype.toString()` can send it through `evalJsonAsync`, and so
 * unit tests can exercise the on-disk-but-unindexed folder path without
 * importing the e2e env resolver.
 *
 * `createSandboxApi` mkdir's the sandbox root on disk. If the vault watcher is
 * delayed, `getAbstractFileByPath` is still null and `createFolder` rejects
 * because the directory already exists. `reconcileFolderCreation` (or
 * `reconcileFile`) registers that folder in the in-memory index without
 * waiting for fsevents.
 */
export interface SeedVaultFile {
	path: string;
}

export interface SeedVaultAdapter {
	exists(path: string): Promise<boolean>;
	reconcileFolderCreation?(path: string, newPath: string): Promise<void> | void;
	reconcileFile?(path: string): Promise<void> | void;
}

export interface SeedVaultApp {
	vault: {
		getAbstractFileByPath(path: string): SeedVaultFile | null;
		createFolder(path: string): Promise<unknown>;
		create(path: string, content: string): Promise<unknown>;
		modify(file: SeedVaultFile, content: string): Promise<unknown>;
		adapter: SeedVaultAdapter;
	};
}

export async function seedVaultFileInApp(
	app: SeedVaultApp,
	path: string,
	content: string,
): Promise<string | null> {
	const adapter = app.vault.adapter;

	const indexed = (target: string) => app.vault.getAbstractFileByPath(target);

	const reconcileFolder = async (folder: string) => {
		if (typeof adapter.reconcileFolderCreation === "function") {
			await adapter.reconcileFolderCreation(folder, folder);
			return;
		}
		if (typeof adapter.reconcileFile === "function") {
			await adapter.reconcileFile(folder);
		}
	};

	const ensureFolder = async (folder: string) => {
		if (indexed(folder)) return;

		if (await adapter.exists(folder)) {
			await reconcileFolder(folder);
			if (indexed(folder)) return;
		}

		try {
			await app.vault.createFolder(folder);
		} catch (error) {
			if (indexed(folder)) return;
			if (await adapter.exists(folder)) {
				await reconcileFolder(folder);
				if (indexed(folder)) return;
			}
			throw error;
		}
	};

	const segments = path.split("/").filter(Boolean);
	segments.pop();
	let folder = "";
	for (const segment of segments) {
		folder = folder ? `${folder}/${segment}` : segment;
		await ensureFolder(folder);
	}

	const existing = indexed(path);
	if (existing) {
		await app.vault.modify(existing, content);
	} else {
		await app.vault.create(path, content);
	}

	const file = indexed(path);
	return file ? file.path : null;
}
