import type { AIProvider } from "src/ai/Provider";

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function formatTimeAgo(at: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The status line under a provider's Auto-sync setting. */
export function describeSyncStatus(
	provider: Pick<AIProvider, "lastModelSync" | "models">,
	now: number,
): string {
	const last = provider.lastModelSync;
	if (!last) return "Not synced yet.";
	const when = formatTimeAgo(last.at, now);
	if (last.error) return `Last sync failed ${when}: ${last.error}`;
	return `Last synced ${when} · ${provider.models.length} model(s).`;
}
