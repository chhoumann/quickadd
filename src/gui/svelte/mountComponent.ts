import { type Component, type ComponentProps, mount, unmount } from "svelte";
import { reportError, toError } from "../../utils/errorUtils";
import MountFailed from "./MountFailed.svelte";

/**
 * A handle to a Svelte 5 component mounted imperatively into an Obsidian host
 * (Modal contentEl, settings tab element, ...). Replaces the Svelte 4 class
 * instance that hosts used to keep around (and call `.$destroy()` on).
 */
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
// The props position is the one that matters (it is what makes a card missing
// `what`/`detail` a compile error); the exports position mirrors Svelte's own
// default for a `.svelte` component and gets the same `any` as `mountComponent`.
export type MountFallbackComponent = Component<
	{ what: string; detail: string },
	any
>;

export interface MountOptions {
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
 * Mount a Svelte 5 component into `target` and return an idempotent handle.
 *
 * Single seam replacing `new Component({ target, props })` + `.$destroy()` across
 * ChoiceBuilder, CommandSequenceEditor, the PackageManager modals and the settings
 * tab. The idempotent `destroy()` guards the double-teardown that arises when a
 * Modal's `onClose()` runs after a `reload()` already tore the component down.
 *
 * **This function never throws.** A throw during mount used to escape into the host,
 * where it costs far more than the component: a Modal that mounts from `onOpen()` or
 * its constructor never opens at all, and the declarative settings tab — which builds
 * every group by calling `render` closures in turn — abandons every remaining QuickAdd
 * setting (#1451, #1507, #1566). Instead the error is reported once (one Notice, via
 * `reportError`) and a card takes the component's place, so the failure is partial and
 * visible rather than total and silent (#1584).
 *
 * What this does NOT cover: a throw from an `$effect`. Svelte flushes effects on a
 * later tick, so it never reaches this try/catch — it surfaces as an uncaught error
 * and the component renders anyway (verified against svelte 5 in a scratch probe).
 * That case belongs to `<svelte:boundary>`, which ChoiceView already has. This seam
 * owns the synchronous setup the boundary itself sits inside.
 *
 * To feed reactive updates after mount, pass a `$state`-backed props object and
 * mutate its properties (see createCommandListProps) — the documented Svelte 5
 * way to update an imperatively-mounted component.
 */
// Svelte's `Component` is contravariant in its props, so a generic upper bound
// that accepts ANY component cannot avoid `any` here: an `unknown`-based bound
// makes svelte-check reject components with concrete props (CommandList,
// FolderList, ...). This mirrors how Svelte's own `mount`/`ComponentProps` are
// typed, and `ComponentProps<C>` still gives each call site full prop checking.
export function mountComponent<C extends Component<any, any>>(
	target: HTMLElement,
	component: C,
	props: ComponentProps<C>,
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
	const container = target.ownerDocument.createElement("div");
	container.className = "qa-mount-failed-host";
	target.appendChild(container);

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
