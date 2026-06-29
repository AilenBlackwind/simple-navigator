<script lang="ts">
  import { App, TFolder, EventRef, TFile, Menu, Notice } from "obsidian";
  import { onMount, onDestroy } from "svelte";
  import TreeNode from "./TreeNode.svelte";
  import { sortWithOrder, deleteFile } from "../utils";
  import { dragState, createDropIndicator, updateDropIndicator, removeDropIndicator, destroyDropIndicator, clearFolderHighlight, highlightFolder, resolveDropTarget, updatePathsOnMove, updateAutoScroll, DROP_ZONE_BUFFER } from "../drag-state";
  import type { PluginSettings } from "../settings";
  import { showConfirmModal } from "../modal";

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

  let activeFilePath = "";
  let activeLeafRef: EventRef;
  let selectedPaths = new Set<string>();
  let lastClickedPath: string | null = null;

  function handleSelect(path: string, shiftKey: boolean, ctrlKey: boolean) {
    if (shiftKey && lastClickedPath) {
      const container = document.querySelector(".simple-navigator-tree");
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
      selectedPaths = new Set([path]);
    }
    lastClickedPath = path;
  }

  function clearSelection() {
    selectedPaths = new Set();
  }

  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let rootContextHandler: ((e: MouseEvent) => void) | null = null;

  $: rawChildren = sortWithOrder(
    [...rootFolder.children],
    settings.orderMap,
    "",
    refreshKey
  );

  $: hiddenSet = new Set(settings.hiddenPaths);

  $: children = showHidden
    ? rawChildren
    : rawChildren.filter((c) => !hiddenSet.has(c.path));

  function handleRootDragOver(e: DragEvent) {
    updateAutoScroll(e.clientY);
    const target = resolveDropTarget(e.clientX, e.clientY);

    if (!target) { clearFolderHighlight(); removeDropIndicator(); return; }

    dragState.toPath = target.containerPath;
    dragState.newIndex = target.newIndex;
    dragState.targetFolder = target.targetFolder;

    if (target.targetFolder && target.itemEl) {
      clearFolderHighlight();
      removeDropIndicator();
      highlightFolder(target.itemEl);
      return;
    }

    clearFolderHighlight();
    if (target.itemEl) {
      updateDropIndicator(target.itemEl, e.clientX, e.clientY);
    } else {
      removeDropIndicator();
    }
  }

  function handleRootDrop(e: DragEvent) {
    if (!dragState.itemPath) return;
    dragState.lastDropTime = Date.now();
    destroyDropIndicator();

    const fromPath = dragState.fromPath;
    const itemPath = dragState.itemPath;
    const oldIndex = dragState.oldIndex;

    try {
      if (dragState.targetFolder) {
        handleSortEnd({ fromPath, toPath: dragState.targetFolder, oldIndex, newIndex: -1, itemPath });
      } else if (dragState.toPath !== "" || dragState.newIndex >= 0) {
        handleSortEnd({ fromPath, toPath: dragState.toPath, oldIndex, newIndex: dragState.newIndex, itemPath });
      }
    } catch (err) {
      console.error("ROOT DROP ERROR", err);
    }
  }

  function handleRootDragLeave(e: DragEvent) {
    const el = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && el.contains(related)) return;
    clearFolderHighlight();
  }

  function handleWindowDragOver(e: DragEvent) {
    if (!dragState.itemPath) return;
    const tree = document.querySelector(".simple-navigator-tree");
    if (!tree) return;
    const tr = tree.getBoundingClientRect();
    if (e.clientY < tr.top - DROP_ZONE_BUFFER || e.clientY > tr.bottom) return;
    // Within tree — let TreeNode and the tree's own handlers deal with it
    if (e.clientY >= tr.top && e.clientY <= tr.bottom) return;
    // Above tree (buffer zone) — stop propagation so Obsidian's handlers
    // on ancestor elements (workspace-tabs, etc.) never see this event
    e.stopPropagation();
    e.preventDefault();
    handleRootDragOver(e);
  }

  function handleWindowDrop(e: DragEvent) {
    if (!dragState.itemPath) return;
    const tree = document.querySelector(".simple-navigator-tree");
    if (!tree) return;
    if (tree.contains(e.target as Node)) return;
    const tr = tree.getBoundingClientRect();
    if (e.clientY < tr.top - DROP_ZONE_BUFFER || e.clientY > tr.bottom) return;
    e.stopPropagation();
    e.preventDefault();
    handleRootDrop(e);
  }

  async function handleSortEnd(detail: {
    fromPath: string;
    toPath: string;
    oldIndex: number;
    newIndex: number;
    itemPath: string;
  }) {
    if (detail.fromPath === detail.toPath && detail.newIndex >= 0) {
      // Archived folders use alphabetical sort — skip orderMap
      if (detail.fromPath && settings.archivedPaths.includes(detail.fromPath)) return;

      const container = document.querySelector(
        `.simple-navigator-tree [data-folder-path="${detail.fromPath}"]`
      ) as HTMLElement | null;
      if (!container) {
        console.warn("Container not found for", detail.fromPath);
        return;
      }

      const itemName = detail.itemPath.split("/").pop() || detail.itemPath;

      let adjustedNewIndex = detail.newIndex;
      if (adjustedNewIndex > detail.oldIndex) {
        adjustedNewIndex--;
      }

      const orderedNames: string[] = [];
      for (let i = 0; i < container.children.length; i++) {
        const child = container.children[i] as HTMLElement;
        const path = child.dataset.path;
        if (path) {
          const name = path.split("/").pop();
          if (name) orderedNames.push(name);
        }
      }

      const idx = orderedNames.indexOf(itemName);
      if (idx >= 0) {
        orderedNames.splice(idx, 1);
        orderedNames.splice(adjustedNewIndex, 0, itemName);
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
      const file = app.vault.getAbstractFileByPath(detail.itemPath);
      if (!file) return;

      if (file instanceof TFolder && detail.toPath && (detail.toPath === detail.itemPath || detail.toPath.startsWith(detail.itemPath + "/"))) {
        console.warn("Cannot move folder into itself or descendant", detail.itemPath, detail.toPath);
        return;
      }

      const targetPath = detail.toPath
        ? `${detail.toPath}/${file.name}`
        : file.name;

      const savedSettings = settings;

      try {
        const itemPathPrefix = detail.itemPath + "/";
        app.workspace.iterateAllLeaves((leaf) => {
          const leafPath = (leaf.view as any)?.file?.path;
          if (leafPath && (leafPath === detail.itemPath || leafPath.startsWith(itemPathPrefix))) {
            leaf.detach();
          }
        });
        await app.fileManager.renameFile(file, targetPath);
        settings = updatePathsOnMove(settings, detail.itemPath, targetPath);
      } catch (e) {
        console.error("Failed to move file:", e);
        new Notice(`Cannot move "${file.name}": file is locked`);
        settings = savedSettings;
        return;
      }

      const getFolder = (p: string) =>
        p === "" ? app.vault.getRoot() : (app.vault.getAbstractFileByPath(p) as TFolder | null);
      const sourceFolder = getFolder(detail.fromPath);
      const targetFolder = getFolder(detail.toPath);

      const newOrderMap = { ...settings.orderMap };

      const sourceContainer = document.querySelector(
        `.simple-navigator-tree [data-folder-path="${detail.fromPath}"]`
      ) as HTMLElement | null;
      if (sourceContainer) {
        const sourceNames: string[] = [];
        for (let i = 0; i < sourceContainer.children.length; i++) {
          const child = sourceContainer.children[i] as HTMLElement;
          const p = child.dataset.path;
          if (p) {
            const n = p.split("/").pop();
            if (n) sourceNames.push(n);
          }
        }
        if (!detail.fromPath || !settings.archivedPaths.includes(detail.fromPath)) {
          newOrderMap[detail.fromPath] = sourceNames;
        } else {
          delete newOrderMap[detail.fromPath];
        }
      } else {
        if (!detail.fromPath || !settings.archivedPaths.includes(detail.fromPath)) {
          newOrderMap[detail.fromPath] = (sourceFolder?.children || []).map((c) => c.name);
        }
      }

      const isArchivedTarget = detail.toPath && settings.archivedPaths.includes(detail.toPath);

      const targetContainer = document.querySelector(
        `.simple-navigator-tree [data-folder-path="${detail.toPath}"]`
      ) as HTMLElement | null;
      let orderedNames: string[];
      if (targetContainer) {
        orderedNames = [];
        for (let i = 0; i < targetContainer.children.length; i++) {
          const child = targetContainer.children[i] as HTMLElement;
          const p = child.dataset.path;
          if (p) {
            const n = p.split("/").pop();
            if (n) orderedNames.push(n);
          }
        }
        if (detail.newIndex >= 0 && !isArchivedTarget) {
          const itemName = file.name;
          const idx = orderedNames.indexOf(itemName);
          if (idx >= 0) {
            orderedNames.splice(idx, 1);
          }
          const safeIndex = Math.min(detail.newIndex, orderedNames.length);
          orderedNames.splice(safeIndex, 0, itemName);
        }
      } else {
        orderedNames = (targetFolder?.children || []).map((c) => c.name);
        if (detail.newIndex >= 0 && !isArchivedTarget) {
          const itemName = file.name;
          const idx = orderedNames.indexOf(itemName);
          if (idx >= 0) {
            orderedNames.splice(idx, 1);
          }
          const safeIndex = Math.min(detail.newIndex, orderedNames.length);
          orderedNames.splice(safeIndex, 0, itemName);
        }
      }
      if (!isArchivedTarget) {
        newOrderMap[detail.toPath] = orderedNames;
      }

      settings = { ...settings, orderMap: newOrderMap };
      await onUpdateSettings(settings);
    }
  }

  function handleRootContextMenu(event: MouseEvent) {
    event.preventDefault();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("New note")
        .setIcon("file-plus")
        .onClick(async () => {
          const path = app.vault.getAvailablePath("Untitled", "md");
          await app.vault.create(path, "");
          const f = app.vault.getAbstractFileByPath(path);
          if (f instanceof TFile) {
            await app.workspace.getLeaf().openFile(f);
          }
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("New folder")
        .setIcon("folder-plus")
        .onClick(async () => {
          const path = app.vault.getAvailablePath("New folder", "");
          await app.vault.createFolder(path);
        })
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
              if (p) p.lastClicked = null;
              app.commands.executeCommandById(cmd.commandId);
            });
          });
        }
      });
    }
    for (const [sectionName, entries] of Object.entries(settings.submenus)) {
      if (entries.length === 0) continue;
      menu.addItem((item) => {
        item.setTitle(sectionName).setIcon("terminal");
        const sub = item.setSubmenu();
        for (const cmd of entries) {
          if (!cmd.commandId) continue;
          sub.addItem((s) => {
            s.setTitle(cmd.label);
            if (cmd.icon) s.setIcon(cmd.icon);
            s.onClick(() => {
              const p = (app as any).plugins.plugins['simple-navigator'];
              if (p) p.lastClicked = null;
              app.commands.executeCommandById(cmd.commandId);
            });
          });
        }
      });
    }

    if (settings.mainMenuCommands.length > 0) {
      menu.addSeparator();
      for (const cmd of settings.mainMenuCommands) {
        if (!cmd.commandId) continue;
        menu.addItem((s) => {
          s.setTitle(cmd.label);
          if (cmd.icon) s.setIcon(cmd.icon);
          s.onClick(() => {
            const p = (app as any).plugins.plugins['simple-navigator'];
            if (p) p.lastClicked = null;
            app.commands.executeCommandById(cmd.commandId);
          });
        });
      }
    }

    menu.showAtMouseEvent(event);
  }

  onMount(() => {
    activeFilePath = app.workspace.getActiveFile()?.path ?? "";
    activeLeafRef = app.workspace.on("active-leaf-change", async () => {
      const file = app.workspace.getActiveFile();
      activeFilePath = file?.path ?? "";
      if (file && settings.autoReveal) {
        let parent = file.parent;
        const toExpand: string[] = [];
        while (parent) {
          toExpand.push(parent.path);
          parent = parent.parent;
        }
        if (toExpand.length > 0) {
          const cp = new Set(settings.collapsedPaths);
          for (const p of toExpand) {
            cp.delete(p);
          }
          settings = { ...settings, collapsedPaths: Array.from(cp) };
          await onUpdateSettings(settings);
        }
      }
    });
    keydownHandler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedPaths.size > 0) {
        e.preventDefault();
        (async () => {
          if (settings.confirmDelete) {
            const title = "Delete";
            const desc = `Are you sure you want to delete these ${selectedPaths.size} items?`;
            const confirmed = await showConfirmModal(app, title, desc);
            if (!confirmed) return;
          }
          for (const p of selectedPaths) {
            const f = app.vault.getAbstractFileByPath(p);
            if (f) await deleteFile(app, f);
          }
          clearSelection();
        })();
      }
    };
    registerDomEvent(document, "keydown", keydownHandler);
    rootContextHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".simple-navigator-tree")) return;
      if (target.closest(".nav-folder-title, .nav-file-title")) return;
      handleRootContextMenu(e);
    };
    registerDomEvent(document, "contextmenu", rootContextHandler);
    registerDomEvent(window, "dragover", handleWindowDragOver, true);
    registerDomEvent(window, "drop", handleWindowDrop, true);
  });

  onDestroy(() => {
    if (activeLeafRef) {
      app.workspace.offref(activeLeafRef);
    }
    window.removeEventListener("dragover", handleWindowDragOver, true);
    window.removeEventListener("drop", handleWindowDrop, true);
    if (keydownHandler) {
      document.removeEventListener("keydown", keydownHandler);
    }
    if (rootContextHandler) {
      document.removeEventListener("contextmenu", rootContextHandler);
    }
  });
</script>

<div
  class="simple-navigator-tree nav-folder mod-root"
  on:click|self={clearSelection}
  on:dragover|preventDefault={handleRootDragOver}
  on:drop={handleRootDrop}
  on:dragleave={handleRootDragLeave}
>
  <div class="nav-folder-children" data-folder-path="">
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
      />
    {/each}
  </div>
</div>
