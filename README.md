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
- **Toolbar.** Create a note or folder, switch between manual order and either
  alphabetical order, follow the active file, or collapse/expand all folders. Alphabetical sorting preserves
  your saved manual order and still lets you move items between folders.
- **Folder drop targets.** The middle of a folder title drops items into that
  folder. Hover over a collapsed folder while dragging to expand it. In manual
  mode, the edges show where to insert the items as siblings. Use **Reset folder
  order** from a folder's context menu to clear its manual order.
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
- **Configurable context menus.** Keep ordinary right-click short and assign
  separate menus to Ctrl/Alt/Shift/Meta combinations. Each profile has its own
  navigator actions, named submenus, and Obsidian commands.
- **Multi-select.** Shift-click for ranges, Ctrl/Cmd-click to toggle individual
  items; Delete/Backspace removes the selection.
- **Auto-reveal.** Optionally expand parents of the active file and scroll its
  row into view. Use **Reveal active file in navigator** from the command palette
  to reveal and briefly highlight it once.
- **Keyboard navigation.** Use the arrow keys and Home/End to move around the
  tree, Enter or Space to open a file or toggle a folder, and F2 to rename.

## Context menu profiles

Ordinary right-click shows the basic actions: create notes/folders, the configured
`New...` commands, duplicate, rename, and delete. Right-clicking empty space shows
the creation actions.

On the first upgrade, existing custom submenus and standalone commands move into
a `Navigator` profile opened with **Shift + right-click**, together with move,
hide/archive, colors, and icons. Existing `New...` commands stay in the basic menu.

The built-in navigator actions are also available in an **Alt + right-click**
profile. This profile is added once when upgrading; custom command profiles stay
as configured, and later changes to the Alt profile are preserved.

Open **Simple Navigator Settings → Additional context menus** to add, rename,
or remove profiles. Select the exact key combination, choose navigator actions,
and edit that profile's commands and submenus. Combinations must be unique;
a profile with no keys selected is inactive. An unassigned combination opens the
basic menu. Commands receive the file or folder that was right-clicked through
`plugin.lastClicked`.

## Location of new notes

In **Simple Navigator Settings → Default location for new notes**, choose Obsidian's
setting (the default), the vault root, the active note's folder, or a specific
folder selected from the vault. This applies to **New note** on empty tree space.
Creating a note from a folder's context menu always uses that folder. Custom
creation scripts and **New folder** retain their own behavior. If a specified
folder is missing, creation stops with a notice instead of silently using another
location. Renaming or moving that folder updates the setting automatically.

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
npm run build    # one-shot production build → main.js in this vault
npm test         # regression checks
npm run typecheck
npm run deploy:main # explicitly build and copy to MainVault
```

Requirements: Node.js, npm. Output is written to `main.js`.

## Project layout

```
src/
  main.ts                 Plugin entry: commands, view registration, settings load
  SimpleNavigatorView.ts  ItemView that hosts the Svelte tree
  settings.ts             Settings model + settings tab UI
  modal.ts                Fuzzy-suggest modals (command/icon/folder pickers)
  menu-profiles.ts        Modifier matching, legacy migration, custom commands
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
