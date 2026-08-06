import { App, setIcon } from "obsidian";

export const CUSTOM_ICON_PREFIX = "svg::";

export const customSvgContent = new Map<string, string>();
export let cachedCustomItems: string[] = [];
const MAX_CACHED_ICONS = 500;
const MAX_SVG_SIZE_BYTES = 65536;

export function clearIconCache() {
  cachedCustomItems = [];
  customSvgContent.clear();
}

export async function refreshCustomIcons(app: App, folderPath: string) {
  cachedCustomItems = [];
  customSvgContent.clear();
  if (!folderPath) return;
  try {
    const adapter = app.vault.adapter;
    const exists = await adapter.exists(folderPath);
    if (!exists) return;

    const walk = async (dir: string) => {
      if (cachedCustomItems.length >= MAX_CACHED_ICONS) return;
      const entries = await adapter.list(dir);
      for (const filePath of entries.files) {
        if (cachedCustomItems.length >= MAX_CACHED_ICONS) return;
        if (filePath.toLowerCase().endsWith(".svg")) {
          const stat = await adapter.stat(filePath);
          if (stat && stat.size > MAX_SVG_SIZE_BYTES) continue;
          const svg = await adapter.read(filePath);
          const key = `${CUSTOM_ICON_PREFIX}${filePath}`;
          cachedCustomItems.push(key);
          customSvgContent.set(key, svg);
        }
      }
      for (const sub of entries.folders) {
        if (cachedCustomItems.length >= MAX_CACHED_ICONS) return;
        await walk(sub);
      }
    };

    await walk(folderPath);
  } catch {}
}

export function isCustomIcon(value: string): boolean {
  return value.startsWith(CUSTOM_ICON_PREFIX);
}

export function setCustomIcon(el: HTMLElement, value: string, app: App): void {
  try {
    el.innerHTML = "";
    if (isCustomIcon(value)) {
      const svg = customSvgContent.get(value);
      if (svg) {
        el.innerHTML = svg;
        const svgEl = el.querySelector("svg");
        if (svgEl) {
          svgEl.style.width = "16px";
          svgEl.style.height = "16px";
        }
        return;
      }
    }
    el.style.display = "";
    setIcon(el, value);
    const svgEl = el.querySelector("svg");
    if (svgEl) {
      svgEl.style.width = "16px";
      svgEl.style.height = "16px";
      svgEl.style.strokeWidth = "2px";
    }
  } catch {}
}
