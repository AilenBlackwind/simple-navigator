<script lang="ts">
  import { App, TFolder, EventRef, TFile, Menu, Notice, normalizePath, MarkdownView, setIcon } from "obsidian";
  import type { Editor, TAbstractFile } from "obsidian";
  import { onMount, onDestroy, tick } from "svelte";
  import TreeNode from "./TreeNode.svelte";
  import { sortWithOrder, deleteFile, canDeleteSelection, generateFileLinks, getDefaultNoteFolder, getFolderPaths } from "../utils";
  import { dragState, removeDropIndicator, destroyDropIndicator, updateMoveDrop, DROP_ZONE_BUFFER, clearLinkTargetHighlight } from "../drag-state";
  import type { NavigatorSort, PluginSettings } from "../settings";
  import { matchingMenuProfile, appendProfileCommands } from "../menu-profiles";
  import { showConfirmModal } from "../confirm-modal";

  export let app: App;
  export let rootFolder: TFolder;
  export let settings: PluginSettings;
  export let showHidden: boolean = false;
  export let refreshKey: number = 0;
  export let onUpdateSettings: (s: PluginSettings) => Promise<void>;
  export let registerDomEvent: (
    el: HTMLElement | Window | Document,
    event: string,
    callback: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => void;

  export let getSettings: () => PluginSettings;
  export let renameItem: (file: TAbstractFile, path: string) => Promise<void>;
  let treeEl: HTMLDivElement;
  let deleting = false;
  let activeFilePath = "";
  let activeFileRef: EventRef;
  let selectedPaths = new Set<string>();
  let lastClickedPath: string | null = null;

  function rowForPath(path: string) {
    return treeEl?.querySelector<HTMLElement>(`[role="treeitem"][data-path="${CSS.escape(path)}"]`);
  }

  function focusRow(row: HTMLElement, scroll = true) {
    row.focus({ preventScroll: true });
    if (scroll) row.firstElementChild?.scrollIntoView({ block: "nearest" });
  }

  function handleSelect(path: string, shiftKey: boolean, ctrlKey: boolean) {
    const row = rowForPath(path);
    if (row) focusRow(row, false);
    if (shiftKey && lastClickedPath) {
      const container = treeEl;
      if (container) {
        const allItems = container.querySelectorAll<HTMLElement>(
          ".nav-folder[data-path], .nav-file[data-path]"
        );
        const paths = Array.from(allItems)
          .map((el) => el.dataset.path || "")
          .filter(Boolean);
        const lastIdx = paths.indexOf(lastClickedPath);
        const curIdx = paths.indexOf(path);
        if (lastIdx !== -1 && curIdx !== -1) {
          const start = Math.min(lastIdx, curIdx);
          const end = Math.max(lastIdx, curIdx);
          selectedPaths = new Set(paths.slice(start, end + 1));
        } else {
          selectedPaths = new Set([path]);
        }
      } else {
        selectedPaths = new Set([path]);
      }
    } else if (ctrlKey) {
      if (selectedPaths.has(path)) {
        selectedPaths.delete(path);
      } else {
        selectedPaths.add(path);
      }
      selectedPaths = new Set(selectedPaths);
    } else {
      lastClickedPath = path;
    }
  }

  function clearSelection() {
    selectedPaths = new Set();
  }

  function handleTreeKeydown(event: KeyboardEvent) {
    const target = event.target;
    if (event.defaultPrevented || event.isComposing || !(target instanceof HTMLElement)) return;
    if (target !== treeEl && !target.matches('[role="treeitem"]')) return;
    const key = event.key;
    const contextMenu = key === "ContextMenu" || (key === "F10" && event.shiftKey);
    const toggleSelection = key === " " && (event.ctrlKey || event.metaKey);
    if (!contextMenu && !toggleSelection && (event.ctrlKey || event.metaKey || event.altKey)) return;

    if (key === "Escape" && selectedPaths.size) {
      event.preventDefault();
      event.stopPropagation();
      clearSelection();
      return;
    }

    const rows = Array.from(treeEl.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const index = rows.indexOf(target);
    const path = target.dataset.path;
    const title = path ? target.firstElementChild as HTMLElement : null;
    let next: HTMLElement | undefined;
    if (key === "ArrowDown") next = rows[Math.min(index + 1, rows.length - 1)];
    else if (key === "ArrowUp") next = rows[index < 0 ? rows.length - 1 : Math.max(0, index - 1)];
    else if (key === "Home") next = rows[0];
    else if (key === "End") next = rows[rows.length - 1];
    else if (path && key === "ArrowRight") {
      if (target.getAttribute("aria-expanded") === "false") void setFolderExpanded(path, true);
      else next = target.querySelector<HTMLElement>(':scope > [role="group"] > [role="treeitem"]') ?? undefined;
    } else if (path && key === "ArrowLeft") {
      if (target.getAttribute("aria-expanded") === "true") void setFolderExpanded(path, false);
      else next = target.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined;
    } else if (path && title && key === "F2") title.dispatchEvent(new Event("sn-rename"));
    else if (path && toggleSelection) {
      lastClickedPath = path;
      handleSelect(path, false, true);
    } else if (title && (key === "Enter" || key === " ")) title.click();
    else if (title && contextMenu) {
      const rect = title.getBoundingClientRect();
      title.dispatchEvent(new MouseEvent("contextmenu", { clientX: rect.left + 16, clientY: rect.bottom, altKey: event.altKey, bubbles: true, cancelable: true }));
    } else return;

    event.preventDefault();
    event.stopPropagation();
    if (next && event.shiftKey && (key === "ArrowDown" || key === "ArrowUp") && path && next.dataset.path) {
      lastClickedPath ??= path;
      handleSelect(next.dataset.path, true, false);
      focusRow(next);
    } else if (next) {
      lastClickedPath = next.dataset.path ?? null;
      focusRow(next);
    }
  }

  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let rootContextHandler: ((e: MouseEvent) => void) | null = null;

  $: rawChildren = sortWithOrder(
    [...rootFolder.children],
    settings.orderMap,
    "",
    refreshKey,
    settings.sortMode
  );

  $: hiddenSet = new Set(settings.hiddenPaths);

  $: children = showHidden
    ? rawChildren
    : rawChildren.filter((c) => !hiddenSet.has(c.path));

  function handleRootDragOver(e: DragEvent) {
    if (!dragState.itemPath) return;
    dragState.linkTarget = null;
    clearLinkTargetHighlight();
    updateMoveDrop(e, treeEl, settings.sortMode !== "manual", expandDropFolder);
  }

  async function handleRootDrop(e: DragEvent) {
    if (!dragState.itemPath) return;
    dragState.lastDropTime = Date.now();
    destroyDropIndicator();

    const fromPath = dragState.fromPath;
    const itemPath = dragState.itemPath;
    const oldIndex = dragState.oldIndex;
    const batchPaths = dragState.batchPaths.length > 0 ? dragState.batchPaths : undefined;
    const targetFolder = dragState.targetFolder;
    const toPath = dragState.toPath;
    const newIndex = dragState.newIndex;
    resetDragState();

    try {
      if (targetFolder) {
        await handleSortEnd({ fromPath, toPath: targetFolder, oldIndex, newIndex: -1, itemPath, batchPaths });
      } else if (toPath !== "" || newIndex >= 0) {
        await handleSortEnd({ fromPath, toPath, oldIndex, newIndex, itemPath, batchPaths });
      }
    } catch (err) {
      console.error("ROOT DROP ERROR", err);
      new Notice("Could not save the navigator order");
    }
  }

  function handleRootDragLeave(e: DragEvent) {
    const el = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && el.contains(related)) return;
    removeDropIndicator();
  }

  function handleWindowDragOver(e: DragEvent) {
    if (!dragState.itemPath) return;

    // Over a markdown editor — allow the drop so we can insert a link
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el.closest(".markdown-source-view")) {
      removeDropIndicator();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      e.preventDefault();
      return;
    }

    const tr = treeEl.getBoundingClientRect();
    if (e.clientX < tr.left || e.clientX > tr.right || e.clientY < tr.top - DROP_ZONE_BUFFER || e.clientY > tr.bottom) return;
    // Within tree — let TreeNode and the tree's own handlers deal with it
    if (e.clientY >= tr.top && e.clientY <= tr.bottom) return;
    // Above tree (buffer zone) — stop propagation so Obsidian's handlers
    // on ancestor elements (workspace-tabs, etc.) never see this event
    e.stopPropagation();
    e.preventDefault();
    handleRootDragOver(e);
  }

  function getEditorAt(x: number, y: number): Editor | null {
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest(".markdown-source-view")) return null;
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      try {
        if (view.getMode() !== "source") continue;
      } catch {
        continue;
      }
      if (!view.editor) continue;
      if (view.containerEl.contains(el)) return view.editor;
    }
    return null;
  }

  function lineCharOffset(lineEl: HTMLElement, startContainer: Node, startOffset: number): number {
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
      let ch = 0;
      let node: Node | null = walker.nextNode();
      while (node) {
        if (node === startContainer) return ch + startOffset;
        ch += node.textContent?.length ?? 0;
        node = walker.nextNode();
      }
    }
    return 0;
  }

  function getDropPos(editor: Editor, x: number, y: number): { line: number; ch: number } | null {
    const anyEditor = editor as any;
    if (typeof anyEditor.posAtCoords === "function") {
      const pos = anyEditor.posAtCoords({ left: x, top: y });
      if (pos && typeof pos.line === "number") return pos;
    }
    // Use the CM6 EditorView directly (stored on the .cm-content element as
    // "cmView") to map viewport coords to an exact doc offset, then convert
    // to a line/ch position. This avoids the rendered-vs-source mismatch that
    // the caretRangeFromPoint fallback suffers from in Live Preview.
    const el = document.elementFromPoint(x, y);
    const content = el ? el.closest(".cm-content") as any : null;
    if (content) {
      let cmView = content.cmView;
      if (cmView && typeof cmView.posAtCoords !== "function") cmView = cmView.view;
      if (cmView && typeof cmView.posAtCoords === "function") {
        try {
          const offset = cmView.posAtCoords({ left: x, top: y }, true);
          if (typeof offset === "number") {
            const pos = editor.offsetToPos(offset);
            if (pos && typeof pos.line === "number") return pos;
          }
        } catch (err) {
          console.warn("SN posAtCoords failed:", err);
        }
      }
    }
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range) {
        let node: Node | null = range.startContainer;
        while (node && !(node instanceof HTMLElement && node.classList.contains("cm-line"))) {
          node = node.parentElement || null;
        }
        if (node instanceof HTMLElement) {
          const content = node.closest(".cm-content");
          if (content) {
            const lines = Array.from(content.querySelectorAll(".cm-line"));
            const lineIdx = lines.indexOf(node);
            if (lineIdx >= 0) {
              const ch = lineCharOffset(node, range.startContainer, range.startOffset);
              return { line: lineIdx, ch };
            }
          }
        }
      }
    }
    return null;
  }

  // In Live Preview a wikilink renders without its [[ ]] brackets, so the
  // coordinate-to-position mapping can land inside an existing link. Shift
  // the insertion point to just after the closing ]] of any link it is inside.
  function clampPosOutOfLinks(editor: Editor, pos: { line: number; ch: number }): { line: number; ch: number } {
    if (pos.line < 0) return pos;
    const text = editor.getLine(pos.line);
    let ch = pos.ch;
    let search = 0;
    for (;;) {
      const open = text.indexOf("[[", search);
      if (open === -1) break;
      const close = text.indexOf("]]", open + 2);
      if (close === -1) break;
      if (ch > open && ch < close + 2) {
        ch = close + 2;
      }
      search = close + 2;
    }
    return { line: pos.line, ch };
  }

  function insertLinksAt(editor: Editor, x: number, y: number) {
    const pos = getDropPos(editor, x, y);
    if (!pos) return;
    const safePos = clampPosOutOfLinks(editor, pos);
    const items = dragState.batchPaths.length > 0 ? dragState.batchPaths : [dragState.itemPath];
    const sourcePath = app.workspace.getLeavesOfType("markdown")
      .map(leaf => leaf.view)
      .find((view): view is MarkdownView => view instanceof MarkdownView && view.editor === editor)?.file?.path;
    if (!sourcePath) return;
    const links = generateFileLinks(app, sourcePath, items);
    if (links.length === 0) return;
    editor.replaceRange(links.join(" "), safePos, safePos);
    editor.focus();
  }

  function resetDragState() {
    document.body.classList.remove("sn-is-dragging");
    destroyDropIndicator();
    clearLinkTargetHighlight();
    dragState.itemPath = "";
    dragState.fromPath = "";
    dragState.batchPaths = [];
    dragState.targetFolder = null;
    dragState.toPath = "";
    dragState.newIndex = -1;
    dragState.linkTarget = null;
  }

  function handleWindowDrop(e: DragEvent) {
    if (!dragState.itemPath) return;
    if (treeEl.contains(e.target as Node)) return;

    const editor = getEditorAt(e.clientX, e.clientY);
    if (editor) {
      e.stopPropagation();
      e.preventDefault();
      insertLinksAt(editor, e.clientX, e.clientY);
      resetDragState();
      return;
    }

    const tr = treeEl.getBoundingClientRect();
    if (e.clientX < tr.left || e.clientX > tr.right || e.clientY < tr.top - DROP_ZONE_BUFFER || e.clientY >= tr.top) return;
    e.stopPropagation();
    e.preventDefault();
    handleRootDragOver(e);
    handleRootDrop(e);
  }

  async function handleSortEnd(detail: {
    fromPath: string;
    toPath: string;
    oldIndex: number;
    newIndex: number;
    itemPath: string;
    batchPaths?: string[];
  }) {
    const items = detail.batchPaths && detail.batchPaths.length > 0 ? detail.batchPaths : [detail.itemPath];
    const alphabetical = getSettings().sortMode === "name-asc" || getSettings().sortMode === "name-desc";
    if (!alphabetical && detail.fromPath === detail.toPath && detail.newIndex >= 0) {
      // Archived folders use alphabetical sort — skip orderMap
      if (detail.fromPath && settings.archivedPaths.includes(detail.fromPath)) return;

      const container = document.querySelector(
        `.simple-navigator-tree [data-folder-path="${detail.fromPath}"]`
      ) as HTMLElement | null;
      if (!container) {
        console.warn("Container not found for", detail.fromPath);
        return;
      }

      const itemNames = items.map(p => p.split("/").pop() || p);

      let orderedNames: string[] = [];
      for (let i = 0; i < container.children.length; i++) {
        const child = container.children[i] as HTMLElement;
        const path = child.dataset.path;
        if (path) {
          const name = path.split("/").pop();
          if (name) orderedNames.push(name);
        }
      }

      if (items.length === 1) {
        const itemName = itemNames[0];
        let adjustedNewIndex = detail.newIndex;
        if (adjustedNewIndex > detail.oldIndex) adjustedNewIndex--;
        const idx = orderedNames.indexOf(itemName);
        if (idx >= 0) {
          orderedNames.splice(idx, 1);
          orderedNames.splice(adjustedNewIndex, 0, itemName);
        }
      } else {
        const preRemoveIndices = itemNames.map(name => orderedNames.indexOf(name)).filter(idx => idx >= 0);
        const sortedDesc = [...preRemoveIndices].sort((a, b) => b - a);
        for (const idx of sortedDesc) orderedNames.splice(idx, 1);
        const numBeforeNew = preRemoveIndices.filter(idx => idx < detail.newIndex).length;
        const adjustedNewIndex = Math.max(0, detail.newIndex - numBeforeNew);
        const safeIndex = Math.min(adjustedNewIndex, orderedNames.length);
        orderedNames.splice(safeIndex, 0, ...itemNames);
      }

      settings = {
        ...settings,
        orderMap: {
          ...settings.orderMap,
          [detail.fromPath]: orderedNames,
        },
      };
      await onUpdateSettings(settings);
    } else {
      const targetFolder = detail.toPath
        ? app.vault.getAbstractFileByPath(detail.toPath) : rootFolder;
      if (!(targetFolder instanceof TFolder)) return;
      const before = getSettings();
      const targetChildren = sortWithOrder([...targetFolder.children], before.orderMap, detail.toPath);
      const visibleTargets = targetChildren.filter(child => showHidden || !before.hiddenPaths.includes(child.path));
      const anchorName = !alphabetical && detail.newIndex >= 0 ? visibleTargets[detail.newIndex]?.name : undefined;
      const movedNames: string[] = [];
      const failed: string[] = [];
      for (const itemPath of items) {
        const file = app.vault.getAbstractFileByPath(itemPath);
        if (!file) continue;
        if (file instanceof TFolder && (targetFolder.path === itemPath || targetFolder.path.startsWith(itemPath + "/"))) {
          failed.push(file.name);
          continue;
        }
        const targetPath = normalizePath(detail.toPath ? detail.toPath + "/" + file.name : file.name);
        if (targetPath === file.path) continue;
        try {
          await renameItem(file, targetPath);
          movedNames.push(file.name);
        } catch (error) {
          console.error("Failed to move " + itemPath, error);
          failed.push(file.name);
        }
      }
      // Successful renames are already persisted by the plugin's vault listener.
      settings = getSettings();
      if (!alphabetical && movedNames.length > 0 && !settings.archivedPaths.includes(detail.toPath)) {
        const orderedNames = sortWithOrder([...targetFolder.children], settings.orderMap, detail.toPath)
          .map(child => child.name).filter(name => !movedNames.includes(name));
        const anchorIndex = anchorName ? orderedNames.indexOf(anchorName) : -1;
        orderedNames.splice(anchorIndex >= 0 ? anchorIndex : orderedNames.length, 0, ...movedNames);
        settings = { ...settings, orderMap: { ...settings.orderMap, [detail.toPath]: orderedNames } };
        await onUpdateSettings(settings);
      }
      clearSelection();
      if (failed.length > 0) new Notice("Could not move: " + failed.join(", "));

    }
  }

  async function createNote() {
    const parent = getDefaultNoteFolder(app, getSettings());
    if (!parent) return;
    try {
      const basePath = parent.path ? normalizePath(`${parent.path}/Untitled`) : "Untitled";
      const path = app.vault.getAvailablePath(basePath, "md");
      const file = await app.vault.create(path, "");
      await app.workspace.getLeaf().openFile(file);
    } catch (error) {
      console.error("Could not create or open note:", error);
      new Notice("Could not create or open the note");
    }
  }

  async function createFolder() {
    try {
      const parent = app.fileManager.getNewFileParent("");
      const basePath = parent.path ? normalizePath(`${parent.path}/New folder`) : "New folder";
      await app.vault.createFolder(app.vault.getAvailablePath(basePath, ""));
    } catch (error) {
      console.error("Could not create folder:", error);
      new Notice("Could not create the folder");
    }
  }

  const sortLabels: Record<NavigatorSort, string> = {
    manual: "Manual order",
    "name-asc": "Name (A to Z)",
    "name-desc": "Name (Z to A)",
  };

  function toolbarIcon(button: HTMLButtonElement, icon: string) {
    setIcon(button, icon);
    return { update: (nextIcon: string) => setIcon(button, nextIcon) };
  }

  let folderPaths: string[] = [];
  $: {
    refreshKey;
    folderPaths = getFolderPaths(app.vault);
  }
  $: collapsedFolders = new Set(settings.collapsedPaths);
  $: allCollapsed = folderPaths.length > 0 && folderPaths.every(path => collapsedFolders.has(path));
  $: toggleFoldersLabel = allCollapsed ? "Expand all folders" : "Collapse all folders";

  async function updateToolbarSettings(change: Partial<PluginSettings>) {
    try {
      await onUpdateSettings({ ...getSettings(), ...change });
    } catch (error) {
      console.error("Could not save navigator settings:", error);
      new Notice("Could not save navigator settings");
    }
  }

  async function setFolderExpanded(path: string, expanded: boolean) {
    const paths = new Set(getSettings().collapsedPaths);
    if (paths.has(path) === !expanded) return;
    if (expanded) paths.delete(path);
    else paths.add(path);
    await updateToolbarSettings({ collapsedPaths: Array.from(paths) });
  }

  function expandDropFolder(path: string) {
    void setFolderExpanded(path, true);
  }

  async function resetFolderOrder(path: string) {
    const orderMap = { ...getSettings().orderMap };
    if (!orderMap[path]?.length) return;
    delete orderMap[path];
    await updateToolbarSettings({ orderMap });
  }

  function showSortMenu(event: MouseEvent) {
    const menu = new Menu();
    for (const mode of Object.keys(sortLabels) as NavigatorSort[]) {
      menu.addItem(item => item.setTitle(sortLabels[mode]).setChecked(mode === settings.sortMode)
        .onClick(() => { void updateToolbarSettings({ sortMode: mode }); }));
    }
    const anchor = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
    menu.showAtPosition({ x: anchor.left, y: anchor.bottom });
  }

  function handleRootContextMenu(event: MouseEvent) {
    event.preventDefault();
    const menu = new Menu();
    const profile = matchingMenuProfile(event, settings.menuProfiles);
    if (!profile) {
      menu.addItem((item) =>
        item
          .setTitle("New note")
          .setIcon("file-plus")
          .onClick(createNote)
      );
      menu.addItem((item) =>
        item
          .setTitle("New folder")
          .setIcon("folder-plus")
          .onClick(createFolder)
      );
      if (settings.newMenuCommands && settings.newMenuCommands.length > 0) {
        menu.addItem((item) => {
          item.setTitle("New...").setIcon("plus-circle");
          const sub = item.setSubmenu();
          for (const cmd of settings.newMenuCommands) {
            if (!cmd.commandId) continue;
            sub.addItem((s) => {
              s.setTitle(cmd.label);
              if (cmd.icon) s.setIcon(cmd.icon);
              s.onClick(() => {
                const p = (app as any).plugins.plugins['simple-navigator'];
                if (p) p.setLastClicked(null);
                app.commands.executeCommandById(cmd.commandId);
              });
            });
          }
        });
      }
      if (settings.orderMap[""]?.length) {
        menu.addSeparator();
        menu.addItem(item => item.setTitle("Reset root order").setIcon("rotate-ccw")
          .onClick(() => { void resetFolderOrder(""); }));
      }
    } else {
      const count = appendProfileCommands(menu, profile, app, null);
      if (count === 0) menu.addItem(item => item.setTitle("Select a file or folder for navigator actions").setDisabled(true));
    }

    menu.showAtMouseEvent(event);
  }

  function revealActiveFile() {
    const file = app.workspace.getActiveFile();
    activeFilePath = file?.path ?? "";
    if (file && getSettings().autoReveal) return revealFile(file, false);
  }

  let revealSequence = 0;
  let flashRow: HTMLElement | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function clearRevealFlash() {
    clearTimeout(flashTimer);
    flashRow?.classList.remove("sn-reveal-flash");
    flashRow = undefined;
  }

  export async function revealFile(file: TFile, flash = true) {
    const sequence = ++revealSequence;
    const current = getSettings();
    if (flash) clearRevealFlash();
    const collapsed = new Set(current.collapsedPaths);
    const hidden = new Set(current.hiddenPaths);
    let visible = showHidden || !hidden.has(file.path);
    let changed = false;
    for (let parent = file.parent; parent; parent = parent.parent) {
      if (!showHidden && hidden.has(parent.path)) visible = false;
      if (collapsed.delete(parent.path)) changed = true;
    }
    if (!visible) {
      if (flash) new Notice("This file is hidden in Simple Navigator");
      return;
    }
    if (changed) {
      settings = { ...current, collapsedPaths: Array.from(collapsed) };
      try { await onUpdateSettings(settings); }
      catch (error) { console.error("Auto-reveal failed:", error); }
    }
    if (!treeEl) return;
    await tick();
    if (!treeEl.isConnected || sequence !== revealSequence) return;
    if (!flash && (activeFilePath !== file.path || !getSettings().autoReveal)) return;
    const row = rowForPath(file.path);
    if (!row) return;
    if (flash) {
      focusRow(row);
      flashRow = row;
      row.classList.add("sn-reveal-flash");
      flashTimer = setTimeout(clearRevealFlash, 750);
    } else {
      row.firstElementChild?.scrollIntoView({ block: "nearest" });
    }
  }

  let wasFollowing = false;
  $: if (treeEl) followWhenEnabled(settings.autoReveal);

  function followWhenEnabled(enabled: boolean) {
    const starting = enabled && !wasFollowing;
    wasFollowing = enabled;
    if (starting) void revealActiveFile();
  }

  onMount(() => {
    wasFollowing = getSettings().autoReveal;
    activeFileRef = app.workspace.on("file-open", () => { void revealActiveFile(); });
    void revealActiveFile();
    keydownHandler = (e: KeyboardEvent) => {
      if (deleting || selectedPaths.size === 0 || !canDeleteSelection(e, treeEl)) return;
      e.preventDefault();
      const paths = Array.from(selectedPaths);
      deleting = true;
      void (async () => {
        try {
          if (settings.confirmDelete) {
            const confirmed = await showConfirmModal(app, "Delete", "Are you sure you want to delete these " + paths.length + " items?");
            if (!confirmed) return;
          }
          for (const path of paths) {
            const file = app.vault.getAbstractFileByPath(path);
            if (file) await deleteFile(app, file);
          }
          clearSelection();
        } catch (error) {
          console.error("Delete failed:", error);
          new Notice("Some selected items could not be deleted");
        } finally {
          deleting = false;
        }
      })();
    };
    registerDomEvent(document, "keydown", keydownHandler);
    rootContextHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!treeEl.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      const title = target.closest(".nav-folder-title, .nav-file-title");
      if (title) {
        title.dispatchEvent(new CustomEvent("sn-contextmenu", { detail: e }));
      } else {
        handleRootContextMenu(e);
      }
    };
    registerDomEvent(window, "contextmenu", rootContextHandler, true);
    registerDomEvent(window, "dragover", handleWindowDragOver, true);
    registerDomEvent(window, "drop", handleWindowDrop, true);
  });

  onDestroy(() => {
    clearRevealFlash();
    if (activeFileRef) {
      app.workspace.offref(activeFileRef);
    }
    window.removeEventListener("dragover", handleWindowDragOver, true);
    window.removeEventListener("drop", handleWindowDrop, true);
    if (keydownHandler) {
      document.removeEventListener("keydown", keydownHandler);
    }
    if (rootContextHandler) {
      window.removeEventListener("contextmenu", rootContextHandler, true);
    }
    destroyDropIndicator();
    document.body.classList.remove("sn-is-dragging");
    dragState.fromPath = "";
    dragState.itemPath = "";
    dragState.batchPaths = [];
    dragState.targetFolder = null;
    dragState.toPath = "";
  });
</script>

<div class="sn-toolbar" role="group" aria-label="Navigator actions">
  <button type="button" class="clickable-icon" use:toolbarIcon={"square-pen"} title="New note" aria-label="New note" on:click={createNote}></button>
  <button type="button" class="clickable-icon" use:toolbarIcon={"folder-plus"} title="New folder" aria-label="New folder" on:click={createFolder}></button>
  <button type="button" class="clickable-icon" use:toolbarIcon={"align-left"} title={`Sort: ${sortLabels[settings.sortMode]}`} aria-label="Sort" aria-haspopup="menu" on:click={showSortMenu}></button>
  <button type="button" class="clickable-icon" use:toolbarIcon={"file-search"} title="Follow active file" aria-label="Follow active file" aria-pressed={settings.autoReveal} on:click={() => updateToolbarSettings({ autoReveal: !getSettings().autoReveal })}></button>
  <button type="button" class="clickable-icon" use:toolbarIcon={allCollapsed ? "chevrons-up-down" : "chevrons-down-up"} title={toggleFoldersLabel} aria-label={toggleFoldersLabel} disabled={folderPaths.length === 0} on:click={() => updateToolbarSettings({ collapsedPaths: allCollapsed ? [] : folderPaths })}></button>
</div>

<div
  bind:this={treeEl}
  role="tree"
  aria-label="Simple Navigator"
  aria-multiselectable="true"
  tabindex="0"
  class="simple-navigator-tree nav-folder mod-root"
  on:dragover|preventDefault={handleRootDragOver}
  on:drop={handleRootDrop}
  on:dragleave={handleRootDragLeave}
  on:keydown={handleTreeKeydown}
>
  <div class="nav-folder-children" role="group" data-folder-path="" on:click|self={clearSelection}>
    {#each children as child (child.path)}
      <TreeNode
        {app}
        file={child}
        depth={0}
        {activeFilePath}
        {settings}
        {showHidden}
        {refreshKey}
        {selectedPaths}
        onSelect={handleSelect}
        onClearSelection={clearSelection}
        onSortEnd={handleSortEnd}
        {onUpdateSettings}
        onExpandDropFolder={expandDropFolder}
        onResetFolderOrder={resetFolderOrder}
        {renameItem}
      />
    {/each}
  </div>
</div>
