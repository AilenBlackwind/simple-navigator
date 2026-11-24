import { App, TAbstractFile, TFile, TFolder, Vault, MarkdownView, Notice, normalizePath } from "obsidian";
import type { NavigatorSort, PluginSettings } from "./settings";

export function getFolderPaths(vault: Vault): string[] {
  const root = vault.getRoot();
  return vault.getAllLoadedFiles()
    .filter(file => file instanceof TFolder && file !== root)
    .map(file => file.path);
}

export function sortWithOrder(
  children: TAbstractFile[],
  orderMap: Record<string, string[]>,
  parentPath: string,
  _refreshKey?: number,
  mode: NavigatorSort = "manual"
): TAbstractFile[] {
  if (mode !== "manual") {
    return [...children].sort((a, b) => defaultSortFn(a, b, mode === "name-desc" ? -1 : 1));
  }
  const order = orderMap[parentPath];
  if (!order || order.length === 0) {
    return [...children].sort(defaultSortFn);
  }

  const orderIndex = new Map<string, number>();
  order.forEach((name, i) => orderIndex.set(name, i));

  const known: TAbstractFile[] = [];
  const unknown: TAbstractFile[] = [];

  for (const child of children) {
    if (orderIndex.has(child.name)) {
      known.push(child);
    } else {
      unknown.push(child);
    }
  }

  known.sort((a, b) => orderIndex.get(a.name)! - orderIndex.get(b.name)!);
  unknown.sort(defaultSortFn);

  return [...known, ...unknown];
}

export function defaultSortFn(a: TAbstractFile, b: TAbstractFile, direction = 1): number {
  const aIsFolder = a instanceof TFolder;
  const bIsFolder = b instanceof TFolder;
  if (aIsFolder !== bIsFolder) {
    return aIsFolder ? -1 : 1;
  }
  return direction * a.name.localeCompare(b.name);
}

export function countFiles(
  folder: TFolder,
  visibleExts: Set<string> | null = null
): number {
  let count = 0;
  for (const child of folder.children) {
    if (child instanceof TFile) {
      if (visibleExts) {
        const dotIdx = child.name.lastIndexOf(".");
        const ext = dotIdx >= 0 ? child.name.slice(dotIdx + 1).toLowerCase() : "";
        if (visibleExts.has(ext)) count++;
      } else {
        count++;
      }
    } else if (child instanceof TFolder) {
      count += countFiles(child, visibleExts);
    }
  }
  return count;
}

export function getFileIcon(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx === -1) return "file";
  const ext = name.slice(idx + 1).toLowerCase();
  const iconMap: Record<string, string> = {
    md: "file-text",
    canvas: "layout-dashboard",
    txt: "file-text",
    pdf: "file-text",
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    svg: "image",
    webp: "image",
    mp3: "music",
    wav: "music",
    ogg: "music",
    mp4: "video",
    mov: "video",
    avi: "video",
  };
  return iconMap[ext] ?? "file";
}

export function cleanUpSettings(
  settings: PluginSettings,
  vault: Vault
): PluginSettings {
  // Archived folders should not have orderMap entries — this is safe
  for (const path of settings.archivedPaths) {
    delete settings.orderMap[path];
  }
  return settings;
}

export function getVisibleExtSet(
  extensionsStr: string
): Set<string> | null {
  if (!extensionsStr || !extensionsStr.trim()) return null;
  const exts = extensionsStr
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter((s) => s.length > 0);
  return exts.length > 0 ? new Set(exts) : null;
}

export function getDefaultNoteFolder(app: App, settings: PluginSettings): TFolder | null {
  const active = app.workspace.getActiveFile();
  switch (settings.newNoteLocation) {
    case "root": return app.vault.getRoot();
    case "current": return active?.parent ?? app.vault.getRoot();
    case "folder": {
      const path = normalizePath(settings.newNoteFolder.trim());
      const folder = !path || path === "/" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(path);
      if (folder instanceof TFolder) return folder;
      new Notice("The configured new-note folder does not exist. Choose a folder in Simple Navigator settings.");
      return null;
    }
    default: return app.fileManager.getNewFileParent(active?.path ?? "");
  }
}

export async function deleteFile(app: App, file: TAbstractFile): Promise<void> {
  if (typeof app.fileManager.trashFile === "function") {
    await app.fileManager.trashFile(file);
    return;
  }
  // Compatibility with Obsidian versions before FileManager.trashFile (1.6.6).
  const vault = app.vault as Vault & { getConfig(key: string): unknown };
  const trashOption = vault.getConfig("trashOption");
  if (trashOption === "permanent") await vault.delete(file);
  else await vault.trash(file, trashOption === "system");
}

export function canDeleteSelection(event: KeyboardEvent, tree: HTMLElement | undefined): boolean {
  if (!tree || event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.key !== "Delete" && event.key !== "Backspace") return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const target = event.target as HTMLElement | null;
  return !!target && tree.contains(target) && !target.isContentEditable
    && !target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
}

export function generateFileLinks(app: App, sourcePath: string, itemPaths: string[]): string[] {
  return itemPaths
    .map((path) => app.vault.getAbstractFileByPath(path))
    .filter((file): file is TFile => file instanceof TFile && file.path !== sourcePath)
    .map((file) => app.fileManager.generateMarkdownLink(file, sourcePath));
}

// Append a wiki link for each of `itemPaths` to the end of the note at
// `targetPath`, one link per line, preserving the given order. If the note is
// open in a markdown view, insert via its editor so unsaved changes survive.
export async function appendWikiLinksToNote(
  app: App,
  targetPath: string,
  itemPaths: string[]
): Promise<void> {
  const target = app.vault.getAbstractFileByPath(targetPath);
  if (!(target instanceof TFile) || target.extension.toLowerCase() !== "md") return;

  const dragged = new Set(itemPaths);
  if (dragged.has(targetPath)) return;

  const links = generateFileLinks(app, target.path, itemPaths);
  if (links.length === 0) return;

  const text = links.join("\n") + "\n";

  const openView = app.workspace.getLeavesOfType("markdown")
    .map((leaf) => leaf.view)
    .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === targetPath);

  if (openView && openView.editor) {
    const editor = openView.editor;
    const lastLine = editor.lastLine();
    const ch = editor.getLine(lastLine).length;
    const prefix = ch > 0 ? "\n" : "";
    editor.replaceRange(prefix + text, { line: lastLine, ch });
    return;
  }

  await app.vault.process(target, (content) =>
    content + (content.length > 0 && !content.endsWith("\n") ? "\n" : "") + text
  );
}
