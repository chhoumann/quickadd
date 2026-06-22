import type { App } from "obsidian";
import { Menu as ObsidianMenu } from "obsidian";
import type IChoice from "src/types/choices/IChoice";
import type IMultiChoice from "src/types/choices/IMultiChoice";

export type MoveTarget = { id: string; path: string };

/**
 * Sentinel target id for "Move to: (root)". Passed through the existing `onMove`
 * action (so no new wiring is needed in the row components); the ChoiceView handler
 * recognises it and re-appends the choice at the top level. The constant prefix
 * cannot collide with a real uuid-keyed choice.
 */
export const MOVE_TO_ROOT_TARGET_ID = "quickadd:move-to-root";

/**
 * True when `choice` lives inside a Multi (folder) rather than at the top level of
 * `roots`. Drives whether the "Move to: (root)" affordance is offered — there is
 * nowhere to move a choice that is already at root.
 */
export function isChoiceNested(
  choice: IChoice,
  roots: IChoice[] | undefined,
): boolean {
  const source: IChoice[] = Array.isArray(roots) ? roots : [];
  if (source.some((c) => c.id === choice.id)) return false;

  const walk = (list: IChoice[]): boolean => {
    for (const c of list) {
      if (c.type === "Multi") {
        const children = (c as IMultiChoice).choices ?? [];
        if (children.some((child) => child.id === choice.id)) return true;
        if (walk(children)) return true;
      }
    }
    return false;
  };

  return walk(source);
}

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
 * Build the choice context menu (shared by the mouse and keyboard entry points).
 * "Move to" is rendered as a flattened list of targets for reliability.
 */
function buildChoiceMenu(
  app: App,
  choice: IChoice,
  roots: IChoice[] | undefined,
  actions: MenuActions,
): ObsidianMenu {
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

  // Offer a way back OUT of a folder for keyboard/menu users (cross-zone drag is
  // pointer-only). Only meaningful when the choice is currently nested.
  if (isChoiceNested(choice, roots)) {
    menu.addItem((item) =>
      item
        .setTitle("Move to: (root)")
        .setIcon("folder-up")
        .onClick(() => actions.onMove(MOVE_TO_ROOT_TARGET_ID)),
    );
  }

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

  return menu;
}

/**
 * Show the context menu for a choice at the mouse event (right-click on a row).
 */
export function showChoiceContextMenu(
  app: App,
  evt: MouseEvent,
  choice: IChoice,
  roots: IChoice[] | undefined,
  actions: MenuActions,
): void {
  evt.preventDefault();
  buildChoiceMenu(app, choice, roots, actions).showAtMouseEvent(evt);
}

/**
 * Show the same menu anchored to an element (the keyboard-accessible "More options"
 * button), positioned at the element's bottom-left so it works without a mouse
 * pointer. WCAG 2.1.1 — the row's right-click menu is reachable from the keyboard.
 */
export function showChoiceContextMenuAtElement(
  app: App,
  anchor: HTMLElement,
  choice: IChoice,
  roots: IChoice[] | undefined,
  actions: MenuActions,
): void {
  const rect = anchor.getBoundingClientRect();
  buildChoiceMenu(app, choice, roots, actions).showAtPosition({
    x: rect.left,
    y: rect.bottom,
  });
}
