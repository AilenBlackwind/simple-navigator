# Simple Navigator

A custom file navigator (file explorer) for [Obsidian](https://obsidian.md).

Built because the default file explorer didn't fit the workflow, and none of the
existing alternatives felt right. This one focuses on manual control over the
tree: custom ordering, colors, icons, archived folders, and a configurable
context menu.

> Personal project, AI-assisted, in active development. A significant portion of
> the functionality is not yet implemented and there are rough edges.

## Features

- **Manual ordering.** Drag-and-drop to reorder files and folders; the order is
  remembered per folder. Default alphabetical sort still applies to items you
  haven't reordered.
- **Colors & icons.** Assign a custom color and icon to any file or folder from
  the context menu. Optionally make icons inherit the color. Add your own custom
  colors in settings.
- **Archived folders.** Mark a folder as archived — it collapses into a single
  entry showing an icon and a file count, and is excluded from the normal tree.
- **Hidden files.** Toggle per-file/folder visibility; a command flips global
  "show hidden" state.
- **Custom collapse indicators.** Replace the default folder arrows with any
  Lucide icon, per-folder or globally.
- **Visible extensions filter.** Show only a comma-separated set of file
  extensions in filenames (e.g. `.js, .pdf, .txt`).
- **Rename on double-click.** Optional: double-click a file/folder to rename it
  inline instead of opening/toggling.
- **Configurable context menu.** Build named submenus and standalone commands
  backed by any Obsidian command ID (search by name to fill the ID).
- **Multi-select.** Shift-click for ranges, Ctrl/Cmd-click to toggle individual
  items; Delete/Backspace removes the selection.
- **Auto-reveal.** Optionally expand parents of the active file.

## Installation (development / manual)

1. Copy this folder into `<vault>/.obsidian/plugins/simple-navigator/`.
   It must contain at least `main.js`, `manifest.json`, and `styles.css`.
2. Enable it under **Settings → Community plugins**.
3. Open it via the ribbon icon (folder-tree) or the **Open Simple Navigator**
   command.

## Building from source

```bash
npm install
npm run dev      # watch mode (rebuilds on save)
# or
npm run build    # one-shot production build → main.js
```

Requirements: Node.js, npm. Output is written to `main.js`.

## Project layout

```
src/
  main.ts                 Plugin entry: commands, view registration, settings load
  SimpleNavigatorView.ts  ItemView that hosts the Svelte tree
  settings.ts             Settings model + settings tab UI
  modal.ts                Fuzzy-suggest modals (command/icon/folder pickers)
  utils.ts                Sorting, file-icon mapping, settings cleanup
  drag-state.ts           Drag-and-drop geometry + drop-target resolution
  styles.css              (root styles.css is the canonical copy)
  components/
    TreeView.svelte       Root tree, selection, root-level DnP/context menu
    TreeNode.svelte       Recursive node: click, rename, context menu, DnD
```

## API for plugin developers

Other plugins can access Simple Navigator internals via
`app.plugins.plugins["simple-navigator"]` (the plugin instance).

### `plugin.lastClicked: TAbstractFile | null`

The last file or folder that was right-clicked (or left-clicked) in the navigator
tree. Useful for Quick Add / Templater scripts that need to know which item the
user interacted with.

```js
const plugin = app.plugins.plugins["simple-navigator"];
const target = plugin.lastClicked || app.workspace.getActiveFile();
```

### `plugin.getSortedChildren(folderPath: string): SortedChild[]`

Returns a folder's children sorted by the user's drag-and-drop order (or
alphabetically if the folder was never reordered). Hidden and archived items are
filtered out. Works for any folder, even if it has never been touched by the
plugin — no prior setup required.

```ts
interface SortedChild {
  name: string;   // "MyFile.md"
  path: string;   // "Parent/MyFile.md"
  type: "file" | "folder";
}
```

Usage example — recursive tree walk:

```js
const plugin = app.plugins.plugins["simple-navigator"];
function walk(path, depth) {
  for (const child of plugin.getSortedChildren(path)) {
    console.log("  ".repeat(depth) + child.name);
    if (child.type === "folder") walk(child.path, depth + 1);
  }
}
walk("", 0);
```

### `plugin.setFolderOrder(folderPath: string, orderedNames: string[]): Promise<void>`

Sets the custom order for a folder's children and persists it. Useful when an
external script renames items and needs to update the order map to match.

```ts
// After renaming children to "1. A", "2. B"...
await plugin.setFolderOrder(folderPath, ["1. A", "2. B"]);
```

The tree re-renders automatically after saving.

### `plugin.settings: PluginSettings`

The full settings object (read-only). Useful for checking `hiddenPaths`,
`archivedPaths`, `colorMap`, `iconMap`, etc. Refer to the `PluginSettings`
interface in `src/settings.ts` for the complete shape.

```js
const plugin = app.plugins.plugins["simple-navigator"];
const isHidden = plugin.settings.hiddenPaths.includes(target.path);
```

## Notes

- This is developed and tested against a single personal workflow. Expect rough
  edges.
- `main.js` is committed so the plugin runs without a build step; rebuild it
  after editing sources under `src/`.
