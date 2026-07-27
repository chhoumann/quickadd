import { applyDateSnap, type DateSnap } from "../../utils/dateModifiers";

/**
 * "Today", snapped the way `|startof:`/`|endof:` will snap it at run time - for
 * the EXAMPLE a `{{VDATE:}}` preview shows when the user has not answered yet.
 *
 * #1595 deliberately left snap out of the file-name preview, on the grounds
 * that snapping only that row would split it from the body row. Both rows use
 * this now, so that reason is gone - and the alternative was worse: the
 * ANSWERED branch beside it snaps (it runs the run's own renderer), and
 * `{{DATE:...|startof:month}}` in the same pass has always snapped, so one row
 * gave two answers depending on which token you used.
 *
 * Without a snap it returns a plain `new Date()` and never touches moment. That
 * matters: `window.moment` is Obsidian's, and routing every dateless preview
 * through it would make the common case depend on a global the callers'
 * `catch` would otherwise turn into a `[YYYY-MM-DD]` placeholder.
 */
export function snappedExampleDate(snap: DateSnap | undefined): Date {
	const now = new Date();
	if (!snap) return now;
	return applyDateSnap(window.moment(now), snap).toDate();
}
