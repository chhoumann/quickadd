import type { SplitDirection } from "obsidian";

/** Where to open the file */
export type OpenLocation =
  | "reuse"         // reuse a navigable leaf
  | "tab"           // new tab in the active pane
  | "split"         // split from the active pane
  | "window"        // new popout window
  | "left-sidebar"  // new leaf in the left sidebar
  | "right-sidebar";// new leaf in the right sidebar

/** View mode: accept simple tags or full state */
export type FileViewMode2 =
  | "preview"              // Reading view
  | "source"               // Source mode (raw Markdown)
  | "live" | "live-preview"// Live Preview (source=false)
  | "default"              // Leave as default
  | { mode: "preview" }
  | { mode: "source"; source: boolean }  // advanced override
  | { mode: "default" };

export interface OpenFileOptions {
  location?: OpenLocation;           // default: "tab"
  direction?: SplitDirection;        // for location="split" only
  mode?: FileViewMode2;              // default: leave as-is
  focus?: boolean;                   // default: true
  /** Optional ephemeral state passed to setViewState */
  eState?: any;
}
