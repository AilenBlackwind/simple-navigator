export const dragState: {
  fromPath: string;
  itemPath: string;
  oldIndex: number;
  targetFolder: string | null;
  toPath: string;
  newIndex: number;
  lastDropTime: number;
} = {
  fromPath: "",
  itemPath: "",
  oldIndex: -1,
  targetFolder: null,
  toPath: "",
  newIndex: -1,
  lastDropTime: 0,
};

let dropIndicatorEl: HTMLDivElement | null = null;
let _lastHighlightAt = 0;

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

export function updateDropIndicator(relatedEl: HTMLElement, x: number, y: number) {
  if (!dropIndicatorEl || !dropIndicatorEl.isConnected) return;
  const rect = relatedEl.getBoundingClientRect();
  const tree = relatedEl.closest(".simple-navigator-tree") as HTMLElement;
  if (!tree) return;
  const treeRect = tree.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const left = treeRect.left + 4;
  const width = treeRect.width - 8;
  const px = 1 / window.devicePixelRatio;
  dropIndicatorEl.style.height = px + "px";
  dropIndicatorEl.style.top = `${Math.round(y > midY ? rect.bottom : rect.top)}px`;
  dropIndicatorEl.style.left = `${left}px`;
  dropIndicatorEl.style.width = `${width}px`;
  dropIndicatorEl.style.display = "block";
}

let guideLineAnimEl: HTMLDivElement | null = null;

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

export function clearFolderHighlight(force = false) {
  if (!force && Date.now() - _lastHighlightAt < 100) return;
  hideGuideLineAnim();
  document.querySelectorAll(".sn-drop-target").forEach((el) => {
    el.classList.remove("sn-drop-target");
    const title = el.querySelector(".nav-folder-title") as HTMLElement | null;
    if (title) title.style.removeProperty("background-color");
  });
}

export function highlightFolder(el: HTMLElement) {
  clearFolderHighlight(true);
  el.classList.add("sn-drop-target");
  const title = el.querySelector(".nav-folder-title") as HTMLElement | null;
  if (!title) { _lastHighlightAt = Date.now(); return; }
  const snColor = title.style.getPropertyValue("--sn-color").trim();
  if (snColor) {
    title.style.backgroundColor = `color-mix(in srgb, ${snColor} 8%, transparent)`;
  } else {
    title.style.backgroundColor = "var(--background-modifier-hover)";
  }

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
  _lastHighlightAt = Date.now();
}

export function removeDropIndicator() {
  stopDragScroll();
  clearFolderHighlight();
  hideGuideLineAnim();
  if (dropIndicatorEl) {
    dropIndicatorEl.style.display = "none";
  }
}

export function destroyDropIndicator() {
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

export function resolveDropTarget(x: number, y: number): DropTarget | null {
  const tree = document.querySelector(".simple-navigator-tree");
  if (!tree) return null;
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
        if (folderEl && folderEl.dataset.path && folderEl.dataset.path !== dragState.itemPath) {
          return { itemEl: folderEl, containerPath, newIndex: -1, targetFolder: containerPath };
        }
      }
      return { itemEl: child, containerPath, newIndex: i, targetFolder: null };
    }

    if (y >= cr.top && y <= cr.bottom) {
      if (child.classList.contains("nav-folder")) {
        const childrenContainer = child.querySelector(".nav-folder-children") as HTMLElement | null;

        if (childrenContainer && childrenContainer.offsetHeight === 0) {
          const edgeSize = cr.height * 0.25;
          if (y <= cr.top + edgeSize) {
            return { itemEl: child, containerPath, newIndex: computeNewIndex(child, y), targetFolder: null };
          }
          if (y >= cr.bottom - edgeSize) {
            return { itemEl: child, containerPath, newIndex: computeNewIndex(child, y), targetFolder: null };
          }
          return { itemEl: child, containerPath, newIndex: -1, targetFolder: child.dataset.path || null };
        }

        const title = child.querySelector(".nav-folder-title");

        if (title) {
          const tr = title.getBoundingClientRect();
    if (y >= tr.top - DROP_ZONE_BUFFER && y <= tr.bottom) {
            const mid = tr.top + tr.height / 2;
            const r = { itemEl: child, containerPath, newIndex: y > mid ? i + 1 : i, targetFolder: null };
            return r;
          }
        }

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

      const fileEdge = cr.height * 0.25;
      if (y <= cr.top + fileEdge) {
        return { itemEl: child, containerPath, newIndex: i, targetFolder: null };
      }
      if (y >= cr.bottom - fileEdge) {
        return { itemEl: child, containerPath, newIndex: i + 1, targetFolder: null };
      }
      const ccFolderEl = container.closest(".nav-folder") as HTMLElement;
        if (ccFolderEl && ccFolderEl.dataset.path && ccFolderEl.dataset.path !== dragState.itemPath) {
          return { itemEl: ccFolderEl, containerPath, newIndex: -1, targetFolder: containerPath };
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
    if (folderEl && folderEl.dataset.path && folderEl.dataset.path !== dragState.itemPath) {
      return { itemEl: folderEl, containerPath, newIndex: -1, targetFolder: containerPath };
    }
  }
  return { itemEl: children.length > 0 ? children[children.length - 1] : null, containerPath, newIndex: children.length, targetFolder: null };
}

export function updatePathsOnMove<T extends Record<string, unknown>>(settings: T, oldPath: string, newPath: string): T {
  const prefix = oldPath ? oldPath + "/" : "";
  const replace = (key: string) => {
    if (key === oldPath) return newPath;
    if (prefix && key.startsWith(prefix)) return newPath + "/" + key.slice(prefix.length);
    return key;
  };
  const next = { ...settings };
  for (const mapKey of ["colorMap", "iconMap", "orderMap", "folderCollapseIconMap"] as const) {
    const val = next[mapKey];
    if (!val) continue;
    const obj = val as Record<string, unknown>;
    const newObj: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      newObj[replace(k)] = obj[k];
    }
    (next as Record<string, unknown>)[mapKey] = newObj;
  }
  for (const arrKey of ["hiddenPaths", "collapsedPaths", "archivedPaths"] as const) {
    const val = next[arrKey];
    if (!val) continue;
    (next as Record<string, unknown>)[arrKey] = (val as string[]).map((p: string) => replace(p));
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
