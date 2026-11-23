import { type Component, mount, unmount } from "svelte";
import { reportError, toError } from "../../utils/errorUtils";
import MountFailed from "./MountFailed.svelte";

/** A handle to a Svelte 5 component mounted imperatively into an Obsidian host. */
export interface MountHandle {
	/** Unmount the component. Idempotent — safe to call from both onClose() and reload(). */
	destroy(): void;
	/**
	 * False when the mount threw and the fallback card is showing in its place.
	 * Hosts that would otherwise treat a mounted component's state as authoritative
	 * (the choice builders resolve `formProps.choice` at close) must check this, so a
	 * form the user never saw cannot write itself back over their data.
	 */
	readonly ok: boolean;
}

/**
 * The prop contract every fallback card implements: what could not be displayed,
 * and the underlying error text. Two components implement it — {@link MountFailed}
 * (the default) and ChoicesUnavailable (the settings choice list, which adds
 * data.json recovery instructions).
 */
type MountFallbackComponent = Component<{ what: string; detail: string }>;

interface MountOptions {
	/**
	 * Noun phrase naming what could not be displayed ("the command list"), used in
	 * both the reported error and the fallback card. Defaults to a generic phrase:
	 * a host that forgets still fails visibly, just less specifically.
	 */
	what?: string;
	/** Fallback card for this host. Defaults to {@link MountFailed}. */
	fallbackComponent?: MountFallbackComponent;
}

const DEFAULT_WHAT = "this part of QuickAdd";

/**
 * Mounts a Svelte 5 component into `target` and returns an idempotent handle;
 * `destroy()` tolerates a Modal's onClose() after reload() already tore it down.
 *
 * Never throws: a throw would stop a Modal from opening or abandon every
 * remaining group in the declarative settings tab. The error is reported once
 * and a fallback card takes the component's place. A throw from an `$effect` is
 * not covered (Svelte flushes effects on a later tick); that belongs to
 * `<svelte:boundary>`.
 *
 * For reactive updates after mount, pass a `$state`-backed props object and
 * mutate it (see reactiveProps).
 */
export function mountComponent<Props extends object, Exports extends object>(
	target: HTMLElement,
	component: Component<Props, Exports>,
	props: NoInfer<Props>,
	options: MountOptions = {},
): MountHandle {
	// Snapshotted so a failed mount can be cleaned up precisely (see below).
	const preexisting = new Set<ChildNode>(target.childNodes);

	let instance: ReturnType<typeof mount>;
	try {
		instance = mount(component, { target, props });
	} catch (error) {
		return renderMountFailure(target, preexisting, toError(error), options);
	}

	let destroyed = false;

	return {
		ok: true,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			void unmount(instance);
		},
	};
}

function renderMountFailure(
	target: HTMLElement,
	preexisting: Set<ChildNode>,
	error: Error,
	options: MountOptions,
): MountHandle {
	const what = options.what ?? DEFAULT_WHAT;

	// `mount()` appends as it renders, so a throw part-way through leaves anchors and
	// half-built nodes behind. Remove exactly the nodes THIS mount added — never empty
	// `target`, which belongs to the host (a Setting's controlEl, a Modal's contentEl)
	// and can already hold rows the host built itself.
	for (const node of Array.from(target.childNodes)) {
		if (!preexisting.has(node)) node.remove();
	}

	// No "QuickAdd" prefix: GuiLogger already renders this as
	// "QuickAdd: (ERROR) <context>: <cause>". The CARD says the full sentence,
	// because it stands alone on screen.
	reportError(error, `Couldn't display ${what}`);

	// The card gets its own container so `destroy()` is uniform with the success
	// path: remove what we added, and nothing else.
	const container = target.createDiv({ cls: "qa-mount-failed-host" });

	let fallback: ReturnType<typeof mount> | null = null;
	try {
		// Deliberately NOT a recursive mountComponent() call: a fallback that throws
		// would report a second time and mount a fallback of its own, forever.
		fallback = mount(options.fallbackComponent ?? MountFailed, {
			target: container,
			props: { what, detail: error.message },
		});
	} catch {
		// The fallback is the same machinery that just failed, so it gets one
		// plain-text last resort rather than a third layer of the same bet.
		container.textContent = `QuickAdd couldn't display ${what}.`;
	}

	let destroyed = false;

	return {
		ok: false,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			if (fallback) void unmount(fallback);
			container.remove();
		},
	};
}
