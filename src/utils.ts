import { TAbstractFile, TFile, TFolder, Vault } from "obsidian";
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
  const allPaths = new Set(vault.getAllLoadedFiles().map((f) => f.path));

  for (const parentPath of Object.keys(settings.orderMap)) {
    if (parentPath && !allPaths.has(parentPath)) {
      delete settings.orderMap[parentPath];
      continue;
    }
    settings.orderMap[parentPath] = settings.orderMap[parentPath].filter(
      (name) => {
        const fullPath = parentPath ? `${parentPath}/${name}` : name;
        return allPaths.has(fullPath);
      }
    );
  }

  settings.hiddenPaths = settings.hiddenPaths.filter((p) => allPaths.has(p));
  settings.archivedPaths = settings.archivedPaths.filter((p) =>
    allPaths.has(p)
  );

  for (const path of Object.keys(settings.colorMap)) {
    if (!allPaths.has(path)) delete settings.colorMap[path];
  }
  for (const path of Object.keys(settings.iconMap)) {
    if (!allPaths.has(path)) delete settings.iconMap[path];
  }
  for (const path of Object.keys(settings.folderCollapseIconMap)) {
    if (!allPaths.has(path)) delete settings.folderCollapseIconMap[path];
  }

  settings.collapsedPaths = settings.collapsedPaths.filter((p) =>
    allPaths.has(p)
  );

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
