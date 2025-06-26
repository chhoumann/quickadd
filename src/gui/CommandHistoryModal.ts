import { Modal, App } from "obsidian";
import { commandHistory } from "../history/CommandHistory";

export class CommandHistoryModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "QuickAdd History" });

    const list = contentEl.createEl("ul");

    const max = 20;
    const entries = (commandHistory as any)["history"] as unknown[]; // internal but okay for read
    entries.slice(Math.max(0, entries.length - max)).reverse().forEach((cmd: any, idx) => {
      const li = list.createEl("li", { text: cmd.getDescription ? cmd.getDescription() : `Command ${idx}` });
      if (idx === 0) {
        li.addClass("qa-history-current");
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}