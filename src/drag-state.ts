import { normalizePath } from "obsidian";
import type { PluginSettings } from "./settings";

export const dragState: {
  fromPath: string;
  itemPath: string;
  oldIndex: number;
  targetFolder: string | null;
  toPath: string;
  newIndex: number;
  lastDropTime: number;
  batchPaths: string[];
  linkTarget: string | null;
} = {
  fromPath: "",
  itemPath: "",
  oldIndex: -1,
  targetFolder: null,
  toPath: "",
  newIndex: -1,
  lastDropTime: 0,
  batchPaths: [],
  linkTarget: null,
};

let dropIndicatorEl: HTMLDivElement | null = null;

export function createDropIndicator(color: string) {
  document.querySelectorAll(".sn-drop-indicator").forEach((el) => el.remove());
  dropIndicatorEl = document.createElement("div");
  const px = 1 / window.devicePixelRatio;
  dropIndicatorEl.className = "sn-drop-indicator";
  dropIndicatorEl.style.position = "fixed";
  dropIndicatorEl.style.height = px + "px";
  dropIndicatorEl.style.pointerEvents = "none";
  dropIndicatorEl.style.zIndex = "1000";
  dropIndicatorEl.style.backgroundColor = color || "var(--text-faint)";
  dropIndicatorEl.style.display = "block";
  document.body.appendChild(dropIndicatorEl);
}

function updateDropIndicator(relatedEl: HTMLElement, after: boolean) {
  if (!dropIndicatorEl || !dropIndicatorEl.isConnected) return;
  const rect = relatedEl.getBoundingClientRect();
  const tree = relatedEl.closest(".simple-navigator-tree") as HTMLElement;
  if (!tree) return;
  const treeRect = tree.getBoundingClientRect();
  const left = treeRect.left + 4;
  const width = treeRect.width - 8;
  const px = 1 / window.devicePixelRatio;
  dropIndicatorEl.style.height = px + "px";
  dropIndicatorEl.style.top = `${Math.round(after ? rect.bottom : rect.top)}px`;
  dropIndicatorEl.style.left = `${left}px`;
  dropIndicatorEl.style.width = `${width}px`;
  dropIndicatorEl.style.display = "block";
}

let guideLineAnimEl: HTMLDivElement | null = null;
let expandTimer: ReturnType<typeof setTimeout> | undefined;
let expandTarget: HTMLElement | null = null;
let expandPointerY = 0;

function cancelDropExpansion() {
  if (expandTimer !== undefined) clearTimeout(expandTimer);
  expandTimer = undefined;
  expandTarget = null;
}

function scheduleDropExpansion(target: DropTarget, tree: Element, y: number, expand?: (path: string) => void) {
  const folder = target.itemEl;
  const path = target.targetFolder;
  if (!expand || !path || !folder?.classList.contains("is-collapsed")) {
    cancelDropExpansion();
    return;
  }
  expandPointerY = y;
  if (expandTarget === folder) return;
  cancelDropExpansion();
  expandTarget = folder;
  expandTimer = setTimeout(() => {
    cancelDropExpansion();
    if (dragState.itemPath && dragState.targetFolder === path && folder.isConnected
      && resolveDropTarget(tree, expandPointerY)?.targetFolder === path) expand(path);
  }, 600);
}

function ensureGuideLineEl(): HTMLDivElement {
  if (guideLineAnimEl?.isConnected) return guideLineAnimEl;
  guideLineAnimEl = document.createElement("div");
  guideLineAnimEl.className = "sn-guide-line-anim";
  guideLineAnimEl.style.position = "fixed";
  guideLineAnimEl.style.pointerEvents = "none";
  guideLineAnimEl.style.zIndex = "100";
  guideLineAnimEl.style.visibility = "hidden";
  document.body.appendChild(guideLineAnimEl);
  return guideLineAnimEl;
}

function hideGuideLineAnim() {
  if (guideLineAnimEl) guideLineAnimEl.style.visibility = "hidden";
}

export function clearFolderHighlight() {
  hideGuideLineAnim();
  document.querySelectorAll(".sn-drop-target").forEach(el => el.classList.remove("sn-drop-target"));
}

export function highlightFolder(el: HTMLElement) {
  clearFolderHighlight();
  el.classList.add("sn-drop-target");
  const title = el.querySelector(".nav-folder-title") as HTMLElement | null;
  const snColor = title?.style.getPropertyValue("--sn-color").trim();

  const childrenContainer = el.querySelector(".nav-folder-children") as HTMLElement | null;
  const tree = el.closest(".simple-navigator-tree") as HTMLElement | null;
  if (tree && childrenContainer && childrenContainer.offsetHeight > 0) {
    const guideOffset = parseFloat(childrenContainer.style.getPropertyValue("--guide-offset") || "24");
    const ccRect = childrenContainer.getBoundingClientRect();
    const treeRect = tree.getBoundingClientRect();

    const desiredTop = ccRect.top;
    const desiredBottom = ccRect.top + ccRect.height;
    const clampedTop = Math.max(desiredTop, treeRect.top);
    const clampedBottom = Math.min(desiredBottom, treeRect.bottom);
    const clampedHeight = clampedBottom - clampedTop;

    if (clampedHeight > 0) {
      const anim = ensureGuideLineEl();
      anim.style.visibility = "visible";
      anim.style.left = `${Math.round(ccRect.left + guideOffset)}px`;
      anim.style.top = `${Math.round(clampedTop)}px`;
      anim.style.height = `${Math.round(clampedHeight)}px`;
      anim.style.backgroundColor = snColor || "var(--text-faint)";
      anim.style.width = (1 / window.devicePixelRatio) + "px";
    }
  }
}

export function removeDropIndicator() {
  cancelDropExpansion();
  stopDragScroll();
  clearFolderHighlight();
  if (dropIndicatorEl) {
    dropIndicatorEl.style.display = "none";
  }
}

export function destroyDropIndicator() {
  cancelDropExpansion();
  stopDragScroll();
  clearFolderHighlight();
  hideGuideLineAnim();
  if (guideLineAnimEl) {
    guideLineAnimEl.remove();
    guideLineAnimEl = null;
  }
  if (dropIndicatorEl) {
    dropIndicatorEl.remove();
    dropIndicatorEl = null;
  }
}

let linkTargetEl: HTMLElement | null = null;

export function clearLinkTargetHighlight() {
  if (linkTargetEl) {
    linkTargetEl.classList.remove("sn-link-target");
    linkTargetEl = null;
  }
}

export function highlightLinkTarget(el: HTMLElement) {
  clearLinkTargetHighlight();
  linkTargetEl = el;
  el.classList.add("sn-link-target");
}

export function computeNewIndex(target: HTMLElement, y: number): number {
  const parent = target.parentElement;
  if (!parent) return -1;
  const children = Array.from(parent.children);
  const idx = children.indexOf(target);
  if (idx < 0) return -1;
  const rect = target.getBoundingClientRect();
  return y > rect.top + rect.height / 2 ? idx + 1 : idx;
}

export interface DropTarget {
  itemEl: HTMLElement | null;
  containerPath: string;
  newIndex: number;
  targetFolder: string | null;
}

export function updateMoveDrop(event: DragEvent, tree: Element, alphabetical: boolean, expandFolder?: (path: string) => void) {
  const { clientY, dataTransfer } = event;
  const target = resolveDropTarget(tree, clientY);
  const destination = target?.targetFolder ?? target?.containerPath ?? "";
  const paths = dragState.batchPaths.length ? dragState.batchPaths : [dragState.itemPath];
  const valid = target && !paths.some(path => destination === path || destination.startsWith(path + "/"))
    && (!alphabetical || paths.some(path => path.split("/").slice(0, -1).join("/") !== destination));

  dragState.toPath = valid ? destination : "";
  dragState.targetFolder = valid ? target.targetFolder : null;
  dragState.newIndex = valid ? target.newIndex : -1;
  if (dataTransfer) dataTransfer.dropEffect = valid ? "move" : "none";
  if (!valid) {
    removeDropIndicator();
    return;
  }

  const insert = !alphabetical && !target.targetFolder && target.itemEl;
  if (insert) {
    const siblings = Array.from(insert.parentElement?.children ?? []);
    updateDropIndicator(insert, target.newIndex > siblings.indexOf(insert));
  }
  else if (dropIndicatorEl) dropIndicatorEl.style.display = "none";

  const folder = target.targetFolder ? target.itemEl : target.itemEl?.parentElement?.closest<HTMLElement>(".nav-folder[data-path]")
    ?? Array.from(tree.querySelectorAll<HTMLElement>(".nav-folder[data-path]")).find(el => el.dataset.path === destination);
  if (folder) highlightFolder(folder);
  else clearFolderHighlight();
  scheduleDropExpansion(target, tree, clientY, expandFolder);
  updateAutoScroll(clientY);
}

function resolveDropTarget(tree: Element, y: number): DropTarget | null {
  const all = tree.querySelectorAll<HTMLElement>(".nav-folder-children[data-folder-path]");
  const matching: { container: HTMLElement; rect: DOMRect }[] = [];

  for (const c of all) {
    const r = c.getBoundingClientRect();
    if (y >= r.top - 2 && y <= r.bottom + 2) {
      matching.push({ container: c, rect: r });
    }
  }

  if (matching.length === 0) {
    // Cursor is outside any .nav-folder-children — check if within tree bounds
    // or the drop-zone buffer above the tree
    const tr = tree.getBoundingClientRect();
    const topBoundary = tr.top - DROP_ZONE_BUFFER;
    if (y >= topBoundary && y <= tr.bottom) {
      const rootContainer = tree.querySelector<HTMLElement>('.nav-folder-children[data-folder-path=""]');
      if (rootContainer) {
        const rootChildren = Array.from(rootContainer.children).filter(
          (el) => el.classList.contains("nav-folder") || el.classList.contains("nav-file")
        ) as HTMLElement[];
        if (rootChildren.length > 0 && y < rootChildren[0].getBoundingClientRect().top) {
          // Above the first root-level item — insert before it
          return { itemEl: rootChildren[0], containerPath: "", newIndex: 0, targetFolder: null };
        }
        if (rootChildren.length > 0) {
          const lastRoot = rootChildren[rootChildren.length - 1];
          if (y > lastRoot.getBoundingClientRect().bottom) {
            // Below the last root-level item — insert after it
            return { itemEl: lastRoot, containerPath: "", newIndex: rootChildren.length, targetFolder: null };
          }
        }
      }
    }
    return null;
  }

  let container = matching[matching.length - 1].container;
  let rect = matching[matching.length - 1].rect;

  const EDGE = 48;
  if (matching.length > 1) {
    const nearBottom = y > rect.bottom - EDGE;
    if (nearBottom) {
      const lastChildren = Array.from(container.children).filter(
        (el) => el.classList.contains("nav-folder") || el.classList.contains("nav-file")
      ) as HTMLElement[];
      const belowLastChild = lastChildren.length === 0 || y > lastChildren[lastChildren.length - 1].getBoundingClientRect().bottom;
      if (belowLastChild) {
        container = matching[matching.length - 2].container;
        rect = matching[matching.length - 2].rect;
      }
    }
  }

  const containerPath = container.dataset.folderPath || "";

  const children = Array.from(container.children).filter(
    (el) => el.classList.contains("nav-folder") || el.classList.contains("nav-file")
  ) as HTMLElement[];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const cr = child.getBoundingClientRect();

    if (y < cr.top) {
      const ccGapRect = container.getBoundingClientRect();
      if (y > ccGapRect.top + EDGE && y < ccGapRect.bottom - EDGE) {
        const folderEl = container.closest(".nav-folder") as HTMLElement;
        if (folderEl && folderEl.dataset.path && folderEl.dataset.path !== dragState.itemPath && !dragState.batchPaths.includes(folderEl.dataset.path)) {
          return { itemEl: folderEl, containerPath, newIndex: -1, targetFolder: containerPath };
        }
      }
      return { itemEl: child, containerPath, newIndex: i, targetFolder: null };
    }

    if (y >= cr.top && y <= cr.bottom) {
      if (child.classList.contains("nav-folder")) {
        const title = child.querySelector(".nav-folder-title");
        if (title) {
          const tr = title.getBoundingClientRect();
          if (y <= tr.bottom && tr.height > 0) {
            const ratio = (y - tr.top) / tr.height;
            if (ratio > 0.25 && ratio < 0.75) {
              return { itemEl: child, containerPath, newIndex: -1, targetFolder: child.dataset.path || null };
            }
            return { itemEl: child, containerPath, newIndex: ratio >= 0.75 ? i + 1 : i, targetFolder: null };
          }
        }

        const childrenContainer = child.querySelector(".nav-folder-children") as HTMLElement | null;
        if (!childrenContainer) {
          return { itemEl: child, containerPath, newIndex: -1, targetFolder: child.dataset.path || null };
        }

        const ccRect = childrenContainer.getBoundingClientRect();
        const hasChildren = Array.from(childrenContainer.children).some(
          (el) => el.classList.contains("nav-folder") || el.classList.contains("nav-file")
        );

        if (!hasChildren) {
          return { itemEl: child, containerPath, newIndex: -1, targetFolder: child.dataset.path || null };
        }

        if (y < ccRect.top || y > ccRect.bottom) {
          return { itemEl: child, containerPath, newIndex: computeNewIndex(child, y), targetFolder: null };
        }

        const nearEdge = y < ccRect.top + EDGE || y > ccRect.bottom - EDGE;
        if (nearEdge) {
          return { itemEl: child, containerPath, newIndex: computeNewIndex(child, y), targetFolder: null };
        }

        return { itemEl: child, containerPath, newIndex: -1, targetFolder: child.dataset.path || null };
      }

      // Files (non-folders) should have no dead zone — always snap to above/below
      const fileEdge = cr.height * 0.25;
      if (y <= cr.top + fileEdge) {
        return { itemEl: child, containerPath, newIndex: i, targetFolder: null };
      }
      if (y >= cr.bottom - fileEdge) {
        return { itemEl: child, containerPath, newIndex: i + 1, targetFolder: null };
      }
      return { itemEl: child, containerPath, newIndex: i, targetFolder: null };
      }
    }

    const ccRect2 = container.getBoundingClientRect();
  const nearEdge2 = y < ccRect2.top + EDGE || y > ccRect2.bottom - EDGE;

  // Root container can't be highlighted as a drop folder, and its 200px bottom
  // padding breaks the edge check above. If the cursor sits below the last item,
  // snap the indicator right under it instead of the oversized container rect.
  if (containerPath === "" && children.length > 0) {
    const lastChild = children[children.length - 1];
    if (y >= lastChild.getBoundingClientRect().bottom) {
      return { itemEl: lastChild, containerPath, newIndex: children.length, targetFolder: null };
    }
  }

    if (!nearEdge2) {
      const folderEl = container.closest(".nav-folder") as HTMLElement;
      // Only a real nested folder (with a path) can be a drop target — never the
      // root tree, which has no data-path and would break the indicator geometry.
      if (folderEl && folderEl.dataset.path && folderEl.dataset.path !== dragState.itemPath && !dragState.batchPaths.includes(folderEl.dataset.path)) {
        return { itemEl: folderEl, containerPath, newIndex: -1, targetFolder: containerPath };
      }
    }
  return { itemEl: children.length > 0 ? children[children.length - 1] : null, containerPath, newIndex: children.length, targetFolder: null };
}

export function updatePathsOnMove(settings: PluginSettings, oldPath: string, newPath: string): PluginSettings {
  if (oldPath === newPath) return settings;
  const prefix = oldPath ? oldPath + "/" : "";
  const replace = (key: string) => {
    if (key === oldPath) return newPath;
    if (prefix && key.startsWith(prefix)) return normalizePath(newPath + "/" + key.slice(prefix.length));
    return key;
  };
  const next = { ...settings };
  if (settings.newNoteFolder) next.newNoteFolder = replace(settings.newNoteFolder);
  for (const mapKey of ["colorMap", "iconMap", "orderMap", "folderCollapseIconMap"] as const) {
    const val = next[mapKey];
    if (!val) continue;
    const obj = val as Record<string, unknown>;
    const newObj: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      newObj[replace(k)] = obj[k];
    }
    Object.assign(next, { [mapKey]: newObj });
  }
  for (const arrKey of ["hiddenPaths", "collapsedPaths", "archivedPaths"] as const) {
    const val = next[arrKey];
    if (!val) continue;
    Object.assign(next, { [arrKey]: (val as string[]).map((p: string) => replace(p)) });
  }
  const parentOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const oldParent = parentOf(oldPath);
  const newParent = parentOf(newPath);
  const oldName = oldPath.split("/").pop()!;
  const newName = newPath.split("/").pop()!;
  const oldOrder = next.orderMap[oldParent];
  if (oldParent === newParent) {
    if (oldOrder) next.orderMap[oldParent] = [...new Set(oldOrder.map(name => name === oldName ? newName : name))];
  } else {
    if (oldOrder) next.orderMap[oldParent] = oldOrder.filter(name => name !== oldName);
    const targetOrder = next.orderMap[newParent];
    if (targetOrder && !targetOrder.includes(newName)) next.orderMap[newParent] = [...targetOrder, newName];
  }
  return next;
}

// --- Drag-time scroll support ---

let autoScrollRaf: number | null = null;
let autoScrollDir = 0;
export const DROP_ZONE_BUFFER = 60;
const SCROLL_EDGE = 50;
const MAX_SCROLL_SPEED = 12;

function autoScrollLoop() {
  const tree = document.querySelector(".simple-navigator-tree") as HTMLElement | null;
  if (!tree || autoScrollDir === 0) {
    autoScrollRaf = null;
    return;
  }
  tree.scrollTop += autoScrollDir * MAX_SCROLL_SPEED;
  autoScrollRaf = requestAnimationFrame(autoScrollLoop);
}

export function updateAutoScroll(clientY: number) {
  const tree = document.querySelector(".simple-navigator-tree") as HTMLElement | null;
  if (!tree) { stopDragScroll(); return; }

  const rect = tree.getBoundingClientRect();
  const distTop = clientY - rect.top;
  const distBottom = rect.bottom - clientY;

  if (distTop < SCROLL_EDGE && tree.scrollTop > 0) {
    autoScrollDir = -1;
    if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(autoScrollLoop);
  } else if (distBottom < SCROLL_EDGE && tree.scrollTop < tree.scrollHeight - tree.clientHeight) {
    autoScrollDir = 1;
    if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(autoScrollLoop);
  } else {
    stopDragScroll();
  }
}

function stopDragScroll() {
  autoScrollDir = 0;
  if (autoScrollRaf !== null) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }
}
