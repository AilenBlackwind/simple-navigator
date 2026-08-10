import { App, TAbstractFile, TFile, TFolder, Vault, MarkdownView, normalizePath } from "obsidian";
import { PluginSettings } from "./settings";

export function sortWithOrder(
  children: TAbstractFile[],
  orderMap: Record<string, string[]>,
  parentPath: string
): TAbstractFile[] {
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

export function defaultSortFn(a: TAbstractFile, b: TAbstractFile): number {
  const aIsFolder = a instanceof TFolder;
  const bIsFolder = b instanceof TFolder;
  if (aIsFolder !== bIsFolder) {
    return aIsFolder ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
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

export async function deleteFile(app: App, file: TAbstractFile): Promise<void> {
  const trashOption = app.vault.getConfig("trashOption");
  if (trashOption === "permanent") {
    await app.vault.delete(file);
  } else {
    await app.vault.trash(file, trashOption === "system");
  }
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
  if (!(target instanceof TFile)) return;

  const dragged = new Set(itemPaths);
  if (dragged.has(targetPath)) return;

  const links = itemPaths
    .map((p) => app.vault.getAbstractFileByPath(p))
    .filter((f): f is TFile => f instanceof TFile && f.path !== targetPath)
    .map((f) => `[[${f.basename}]]`);
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

  let content = await app.vault.read(target);
  if (content.length > 0 && !content.endsWith("\n")) content += "\n";
  content += text;
  await app.vault.modify(target, content);
}
