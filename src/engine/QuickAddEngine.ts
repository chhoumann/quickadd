import type { App } from "obsidian";
import { FrontmatterPropertyService } from "../services/FrontmatterPropertyService";
import { VaultFileService } from "../services/VaultFileService";

export abstract class QuickAddEngine {
	public app: App;
	protected readonly vaultFileService: VaultFileService;
	protected readonly frontmatterPropertyService: FrontmatterPropertyService;

	protected constructor(app: App) {
		this.app = app;
		this.vaultFileService = new VaultFileService(app);
		this.frontmatterPropertyService = new FrontmatterPropertyService(app);
	}

	public abstract run(): void | Promise<unknown>;
}
