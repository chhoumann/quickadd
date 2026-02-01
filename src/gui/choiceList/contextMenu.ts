import type { App } from "obsidian";
import { Menu as ObsidianMenu } from "obsidian";
import type IChoice from "src/types/choices/IChoice";
import type IMultiChoice from "src/types/choices/IMultiChoice";

export type MoveTarget = { id: string; path: string };

/**
 * Compute eligible Multi targets for moving `moving` into, excluding self and descendants.
 * Returns label paths as "Parent / Child".
 */
export function computeEligibleMultiTargets(
  moving: IChoice,
  roots: IChoice[] | undefined,
): MoveTarget[] {
  const multiNodes: MoveTarget[] = [];
  const source: IChoice[] = Array.isArray(roots) ? roots : [];

  const walk = (list: IChoice[], prefix: string[] = []) => {
    for (const c of list) {
      const name = c.name ?? "";
      if (c.type === "Multi") {
        const path = [...prefix, name];
        if (!isInvalidTarget(moving, c)) {
          multiNodes.push({ id: c.id, path: path.join(" / ") });
        }
        walk((c as IMultiChoice).choices ?? [], [...prefix, name]);
      }
    }
  };

  walk(source, []);
  return multiNodes;
}

function isInvalidTarget(moving: IChoice, target: IChoice): boolean {
  if (target.type !== "Multi") return true;
  if (moving.id === target.id) return true;
  if (moving.type === "Multi") {
    const ids = new Set<string>();
    const collect = (c: IChoice) => {
      ids.add(c.id);
      if (c.type === "Multi") (c as IMultiChoice).choices?.forEach(collect);
    };
    (moving as IMultiChoice).choices?.forEach(collect);
    if (ids.has(target.id)) return true;
  }
  return false;
}

type MenuActions = {
  onRename: () => void;
  onToggle: () => void;
  onConfigure: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (targetId: string) => void;
};

/**
 * Build and show the context menu for a choice at the mouse event.
 * "Move to" is rendered as flattened list of targets for reliability.
 */
export function showChoiceContextMenu(
  app: App,
  evt: MouseEvent,
  choice: IChoice,
  roots: IChoice[] | undefined,
  actions: MenuActions,
): void {
  evt.preventDefault();
  const menu = new ObsidianMenu();

  menu
    .addItem((item) =>
      item
        .setTitle(
          choice.command ? "Disable in Command Palette" : "Enable in Command Palette",
        )
        .setIcon("zap")
        .onClick(actions.onToggle),
    )
    .addItem((item) => item.setTitle("Rename").setIcon("pencil").onClick(actions.onRename))
    .addItem((item) => item.setTitle("Configure").setIcon("settings").onClick(actions.onConfigure))
    .addItem((item) => item.setTitle("Duplicate").setIcon("copy").onClick(actions.onDuplicate))
    .addItem((item) => item.setTitle("Delete").setIcon("trash-2").onClick(actions.onDelete))
    .addSeparator();

  const targets = computeEligibleMultiTargets(choice, roots);
  if (targets.length === 0) {
    menu.addItem((item) =>
      item.setTitle("Move to: (no folders)").setDisabled(true).setIcon("folder"),
    );
  } else {
    targets.forEach((t) =>
      menu.addItem((item) =>
        item
          .setTitle(`Move to: ${t.path}`)
          .setIcon("folder-open")
          .onClick(() => actions.onMove(t.id)),
      ),
    );
  }

  menu.showAtMouseEvent(evt);
}
