<script lang="ts">
  import { TFile, TFolder, setIcon, Menu, Notice, normalizePath } from "obsidian";
  import type { App, TAbstractFile } from "obsidian";
  import { sortWithOrder, defaultSortFn, countFiles, getFileIcon, getVisibleExtSet, deleteFile, appendWikiLinksToNote } from "../utils";
  import { setCustomIcon } from "../icon-utils";
  import { dragState, getDragBatchPaths, createDropIndicator, removeDropIndicator, destroyDropIndicator, updateMoveDrop, updateAutoScroll, highlightLinkTarget, clearLinkTargetHighlight } from "../drag-state";
  import type { PluginSettings } from "../settings";
  import { matchingMenuProfile, appendProfileCommands } from "../menu-profiles";
  import { IconSuggestModal, MoveToModal } from "../modal";
import { showConfirmModal } from "../confirm-modal";

  export let app: App;
  export let file: TAbstractFile;
  export let depth: number = 0;
  export let activeFilePath: string = "";
  export let settings: PluginSettings;
  export let showHidden: boolean = false;
  export let refreshKey: number = 0;
  export let selectedPaths: Set<string> = new Set();
  export let onSelect: (path: string, shiftKey: boolean, ctrlKey: boolean) => void = () => {};
  export let onClearSelection: () => void = () => {};
  export let onExpandDropFolder: (path: string) => void;
  export let onResetFolderOrder: (path: string) => Promise<void>;
  export let onSortEnd: (detail: {
    toPath: string;
    newIndex: number;
    itemPath: string;
    batchPaths?: string[];
  }) => Promise<void>;
  export let onUpdateSettings: (s: PluginSettings) => Promise<void>;

  export let renameItem: (file: TAbstractFile, path: string) => Promise<void>;

  let collapsed = settings.collapsedPaths.includes(file.path);
  $: collapsed = settings.collapsedPaths.includes(file.path);
  let collapseIconEl: HTMLSpanElement;
  let typeIconEl: HTMLSpanElement;
  let editingPath: string | null = null;
  let renameInputEl: HTMLInputElement | null = null;

  $: if (renameInputEl && editingPath === file.path) {
    renameInputEl.focus();
    const dotIdx = !isFolder ? file.name.lastIndexOf(".") : -1;
    if (dotIdx > 0) {
      renameInputEl.setSelectionRange(0, dotIdx);
    } else {
      renameInputEl.select();
    }
  }

  $: isFolder = file instanceof TFolder;
  $: isArchived = isFolder && settings.archivedPaths.includes(file.path);

  $: hiddenSet = new Set(settings.hiddenPaths);
  $: isHidden = hiddenSet.has(file.path);

  $: visibleExtSet = getVisibleExtSet(settings.visibleExtensions);
  $: extHidden = !isFolder && visibleExtSet !== null
    && !visibleExtSet.has(
      (() => {
        const dotIdx = file.name.lastIndexOf(".");
        return dotIdx >= 0 ? file.name.slice(dotIdx + 1).toLowerCase() : "";
      })()
    );
  $: displayName = extHidden
    ? file.name.slice(0, file.name.lastIndexOf("."))
    : file.name;
  $: renameValue = !isFolder ? file.name.replace(/^(.+?)\.([^.]+)$/, "$1") : file.name;

  $: rawChildren = isFolder
    ? isArchived
      ? [...(file as TFolder).children].sort(defaultSortFn)
      : sortWithOrder([...(file as TFolder).children], settings.orderMap, file.path, refreshKey, settings.sortMode)
    : [];

  $: children = showHidden
    ? rawChildren
    : rawChildren.filter((c) => !hiddenSet.has(c.path));

  $: fileCount = isArchived && file instanceof TFolder ? countFiles(file) : 0;

  $: iconId = settings.iconMap[file.path]
    || (isArchived ? "archive"
      : isFolder ? "folder"
        : extHidden ? "file-text"
          : getFileIcon(file.name));

  $: if (typeIconEl && typeIconEl.dataset.snIcon !== iconId) {
    typeIconEl.dataset.snIcon = iconId;
    setCustomIcon(typeIconEl, iconId, app);
  }
  $: collapseIconId = settings.folderCollapseIconMap[file.path]?.collapsed || settings.collapseIcon || "chevron-right";

  $: collapseIconExpandedId = settings.folderCollapseIconMap[file.path]?.expanded || settings.collapseIconExpanded || "chevron-down";

  $: curColIcon = collapsed ? collapseIconId : collapseIconExpandedId;
  $: curColColor = settings.colorMap[file.path] || "";
  $: if (collapseIconEl && collapsed !== undefined && (collapseIconEl.dataset.snIcon !== curColIcon || collapseIconEl.dataset.snColor !== curColColor)) {
    collapseIconEl.dataset.snIcon = curColIcon;
    collapseIconEl.dataset.snColor = curColColor;
    collapseIconEl.innerHTML = "";
    setCustomIcon(collapseIconEl, curColIcon, app);
    if (curColColor) {
      collapseIconEl.style.setProperty("color", curColColor, "important");
      const svg = collapseIconEl.querySelector("svg");
      if (svg) {
        svg.style.setProperty("stroke", curColColor, "important");
        svg.style.setProperty("fill", "none", "important");
      }
    } else {
      collapseIconEl.style.color = "";
      const svg = collapseIconEl.querySelector("svg");
      if (svg) {
        svg.style.stroke = "";
        svg.style.fill = "";
      }
    }
    collapseIconEl.style.transition = "transform 100ms ease";
  }

  $: isActive = !isFolder && file instanceof TFile && file.path === activeFilePath;

  $: iconColor = settings.colorMap[file.path] || undefined;

  $: isMultiSelected = selectedPaths.size > 1 && selectedPaths.has(file.path);
  $: targetPaths = isMultiSelected ? Array.from(selectedPaths) : [file.path];

  function handleMiddleMouseDown(e: MouseEvent) {
    if (e.button === 1) e.preventDefault();
  }

  function handleAuxClick(e: MouseEvent) {
    if (e.button !== 1) return;
    e.preventDefault();
    if (file instanceof TFile) {
      onClearSelection();
      app.workspace.getLeaf('tab').openFile(file);
    }
  }

  function handleClick(e: MouseEvent) {
    if (Date.now() - dragState.lastDropTime < 300) return;
    if (editingPath === file.path) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      onSelect(file.path, e.shiftKey, e.ctrlKey || e.metaKey);
      return;
    }
    onClearSelection();
    onSelect(file.path, false, false);
    if (file instanceof TFile) {
      app.workspace.getLeaf().openFile(file);
    } else {
      collapsed = !collapsed;
      saveCollapsedState();
    }
  }

  async function saveCollapsedState() {
    const cp = new Set(settings.collapsedPaths);
    if (collapsed) {
      cp.add(file.path);
    } else {
      cp.delete(file.path);
    }
    settings = { ...settings, collapsedPaths: Array.from(cp) };
    await onUpdateSettings(settings);
  }

  function handleRename() {
    editingPath = file.path;
  }

  async function saveRename(restoreFocus = false) {
    if (editingPath !== file.path) return;
    const row = renameInputEl?.closest<HTMLElement>('[role="treeitem"]');
    const tree = row?.closest<HTMLElement>(".simple-navigator-tree");
    const newName = renameInputEl?.value.trim();
    const strippedName = !isFolder ? file.name.replace(/^(.+?)\.([^.]+)$/, "$1") : file.name;
    if (!newName || newName === strippedName) {
      editingPath = null;
      if (restoreFocus) row?.focus({ preventScroll: true });
      return;
    }
    const parentPath = file.parent ? file.parent.path : "";
    const ext = file instanceof TFile ? file.extension : "";
    const finalName = ext && !newName.endsWith("." + ext) ? newName + "." + ext : newName;
    const newPath = parentPath ? normalizePath(`${parentPath}/${finalName}`) : finalName;
    // Clear editing before awaiting: blur must not submit this rename twice.
    editingPath = null;
    if (restoreFocus) row?.focus({ preventScroll: true });
    try {
      await renameItem(file, newPath);
      if (restoreFocus && row && tree) {
        requestAnimationFrame(() => {
          if (!tree.isConnected || (document.activeElement !== row && document.activeElement !== document.body)) return;
          tree.querySelector<HTMLElement>(`[role="treeitem"][data-path="${CSS.escape(newPath)}"]`)?.focus({ preventScroll: true });
        });
      }
    } catch (error) {
      console.error("Rename failed:", error);
      new Notice("Could not rename: " + (error instanceof Error ? error.message : String(error)));
    }
    editingPath = null;
  }

  function cancelRename() {
    editingPath = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveRename(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      const row = renameInputEl?.closest<HTMLElement>('[role="treeitem"]');
      cancelRename();
      row?.focus({ preventScroll: true });
    }
  }

  function handleDblClick() {
    if (editingPath === file.path) return;
    if (isFolder && settings.renameOnDoubleClickFolders) {
      handleRename();
    } else if (!isFolder && settings.renameOnDoubleClickFiles) {
      handleRename();
    }
  }

  async function duplicateFolderRecursive(src: TFolder, destPath: string): Promise<void> {
    const foldersToCreate: string[] = [];
    const filesToCopy: { src: TFile; dest: string }[] = [];

    function collect(s: TFolder, d: string) {
      foldersToCreate.push(d);
      for (const child of s.children) {
        const childDest = normalizePath(`${d}/${child.name}`);
        if (child instanceof TFile) {
          filesToCopy.push({ src: child, dest: childDest });
        } else if (child instanceof TFolder) {
          collect(child, childDest);
        }
      }
    }
    collect(src, destPath);

    for (const fp of foldersToCreate) {
      await app.vault.createFolder(fp);
    }

    const batchSize = 10;
    for (let i = 0; i < filesToCopy.length; i += batchSize) {
      const batch = filesToCopy.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map((f) => app.vault.copy(f.src, f.dest)));
      for (const r of results) {
        if (r.status === "rejected") {
          console.error("Duplicate file failed:", r.reason);
        }
      }
    }
  }

  async function duplicateFile(file: TFile): Promise<TFile | null> {
    const parentPath = file.parent?.path || "";
    const ext = file.extension;
    const baseName = file.name.slice(0, -(ext.length + 1));
    let newName = `${baseName} (copy).${ext}`;
    let newPath = parentPath ? normalizePath(`${parentPath}/${newName}`) : newName;
    let counter = 1;
    while (app.vault.getAbstractFileByPath(newPath)) {
      newName = `${baseName} (copy ${counter}).${ext}`;
      newPath = parentPath ? normalizePath(`${parentPath}/${newName}`) : newName;
      counter++;
    }
    await app.vault.copy(file, newPath);
    const result = app.vault.getAbstractFileByPath(newPath);
    return result instanceof TFile ? result : null;
  }

  const COLOR_PRESETS: { label: string; value: string }[] = [
    { label: "Red", value: "#e03131" },
    { label: "Orange", value: "#e8590c" },
    { label: "Yellow", value: "#f08c00" },
    { label: "Green", value: "#2f9e44" },
    { label: "Cyan", value: "#0c8599" },
    { label: "Blue", value: "#1971c2" },
    { label: "Purple", value: "#6741d9" },
    { label: "Pink", value: "#c2255c" },
    { label: "Default (remove)", value: "" },
  ];

  const ICON_OPTIONS = [
    "star", "heart", "flame", "bookmark", "flag",
    "bell", "alert-circle", "check-circle", "help-circle", "info",
    "book", "file-text", "code", "terminal",
    "image", "music", "video", "globe", "feather",
    "settings", "search", "home", "user", "clock",
  ];

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const menu = new Menu();
    const profile = matchingMenuProfile(event, settings.menuProfiles);
    const pluginInstance = () => (app as any).plugins.plugins['simple-navigator'];

    function handleMoveTo() {
      const p = pluginInstance();
      if (p) p.setLastClicked(file);
      new MoveToModal(app, file, async (folder) => {
        const p2 = pluginInstance();
        if (p2) await p2.moveItemTo(file, folder);
      }).open();
    }

    if (!profile) {
      if (isFolder) {
        menu.addItem((item) =>
          item
            .setTitle("New note")
            .setIcon("file-plus")
            .onClick(async () => {
              const folder = file as TFolder;
              const path = app.vault.getAvailablePath(normalizePath(folder.path + "/Untitled"), "md");
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
              const folder = file as TFolder;
              const path = app.vault.getAvailablePath(normalizePath(folder.path + "/New folder"), "");
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
                  const p = pluginInstance();
                  if (p) p.setLastClicked(file);
                  app.commands.executeCommandById(cmd.commandId);
                });
              });
            }
          });
        }
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("Duplicate")
            .setIcon("copy")
            .onClick(async () => {
              if (file instanceof TFolder) {
                const parentPath = file.parent?.path || "";
                let newName = file.name + " (copy)";
                let newPath = parentPath ? normalizePath(`${parentPath}/${newName}`) : newName;
                let counter = 1;
                while (app.vault.getAbstractFileByPath(newPath)) {
                  newName = file.name + ` (copy ${counter})`;
                  newPath = parentPath ? normalizePath(`${parentPath}/${newName}`) : newName;
                  counter++;
                }
                try {
                  await duplicateFolderRecursive(file, newPath);
                  const srcPrefix = file.path + "/";
                  const orderMap = { ...settings.orderMap };
                  for (const [key, val] of Object.entries(settings.orderMap)) {
                    if (key === file.path) {
                      orderMap[newPath] = [...val];
                    } else if (key.startsWith(srcPrefix)) {
                      orderMap[newPath + key.slice(srcPrefix.length - 1)] = [...val];
                    }
                  }
                  settings = { ...settings, orderMap };
                  await onUpdateSettings(settings);
                } catch (e) {
                  console.error("Duplicate folder error:", e);
                }
              }
            })
        );
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("Rename")
            .setIcon("pencil")
            .onClick(handleRename)
        );
        menu.addItem((item) =>
          item
            .setTitle("Delete")
            .setIcon("trash-2")
            .setWarning(true)
            .onClick(async () => {
              if (settings.confirmDelete) {
                const title = "Delete";
                const desc = targetPaths.length > 1
                  ? `Are you sure you want to delete these ${targetPaths.length} items?`
                  : `Are you sure you want to delete "${file.name}"?`;
                const confirmed = await showConfirmModal(app, title, desc);
                if (!confirmed) return;
              }
              for (const p of targetPaths) {
                const f = app.vault.getAbstractFileByPath(p);
                if (f) await deleteFile(app, f);
              }
            })
        );
        menu.addSeparator();
      } else if (!isFolder) {
        menu.addItem((item) =>
          item
            .setTitle("Duplicate")
            .setIcon("copy")
            .onClick(async () => {
              if (file instanceof TFile) {
                try {
                  await duplicateFile(file);
                } catch (e) {
                  console.error("Duplicate file error:", e);
                }
              }
            })
        );
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("Rename")
            .setIcon("pencil")
            .onClick(handleRename)
        );
        menu.addItem((item) =>
          item
            .setTitle("Delete")
            .setIcon("trash-2")
            .setWarning(true)
            .onClick(async () => {
              if (settings.confirmDelete) {
                const title = "Delete";
                const desc = targetPaths.length > 1
                  ? `Are you sure you want to delete these ${targetPaths.length} items?`
                  : `Are you sure you want to delete "${file.name}"?`;
                const confirmed = await showConfirmModal(app, title, desc);
                if (!confirmed) return;
              }
              for (const p of targetPaths) {
                const f = app.vault.getAbstractFileByPath(p);
                if (f) await deleteFile(app, f);
              }
            })
        );
        menu.addSeparator();
      }

    } else {
      const actions = new Set(profile.actions);
      const singleHidden = !isMultiSelected && settings.hiddenPaths.includes(file.path);
      if (actions.has("move")) menu.addItem((item) =>
        item
          .setTitle("Move to...")
          .setIcon("corner-up-right")
          .onClick(handleMoveTo)
      );
      if (actions.has("hide")) menu.addItem((item) =>
        item
          .setTitle(isMultiSelected ? "Toggle hide" : singleHidden ? "Unhide" : "Hide")
          .setIcon(isMultiSelected ? "eye" : singleHidden ? "eye" : "eye-off")
          .onClick(async () => {
            const next = { ...settings };
            for (const p of targetPaths) {
              if (next.hiddenPaths.includes(p)) {
                next.hiddenPaths = next.hiddenPaths.filter((hp) => hp !== p);
              } else {
                next.hiddenPaths = [...next.hiddenPaths, p];
              }
            }
            settings = next;
            await onUpdateSettings(settings);
          })
      );

      if (isFolder && actions.has("archive")) {
        const isArchivedFolder = settings.archivedPaths.includes(file.path);
        menu.addItem((item) =>
          item
            .setTitle(isArchivedFolder ? "Unarchive folder" : "Archive folder")
            .setIcon(isArchivedFolder ? "folder" : "archive")
            .onClick(async () => {
              const next = { ...settings };
              if (isArchivedFolder) {
                next.archivedPaths = next.archivedPaths.filter((p) => p !== file.path);
              } else {
                next.archivedPaths = [...next.archivedPaths, file.path];
                // Clear orderMap for this folder – archived uses alphabetical sort
                const om = { ...next.orderMap };
                delete om[file.path];
                next.orderMap = om;
              }
              settings = next;
              await onUpdateSettings(settings);
            })
        );
      }

      if (actions.has("color")) menu.addItem((item) => {
        item.setTitle("Change color...").setIcon("palette");
        const submenu = item.setSubmenu();
        for (const c of COLOR_PRESETS) {
          submenu.addItem((sub) =>
            sub
              .setTitle(c.label)
              .onClick(async () => {
                const next = { ...settings };
                if (c.value) {
                  next.colorMap = { ...next.colorMap, [file.path]: c.value };
                } else {
                  const cm = { ...next.colorMap };
                  delete cm[file.path];
                  next.colorMap = cm;
                }
                settings = next;
                await onUpdateSettings(settings);
              })
          );
        }
        if (settings.customColors.length > 0) {
          submenu.addSeparator();
          submenu.addItem((sub) => {
            sub.setTitle("More colors...").setIcon("palette");
            const subsub = sub.setSubmenu();
            for (const color of settings.customColors) {
              subsub.addItem((s) => {
                const frag = document.createDocumentFragment();
                const circle = document.createElement("span");
                circle.style.display = "inline-block";
                circle.style.width = "12px";
                circle.style.height = "12px";
                circle.style.borderRadius = "50%";
                circle.style.backgroundColor = color;
                circle.style.marginRight = "8px";
                circle.style.verticalAlign = "middle";
                circle.style.border = "1px solid var(--background-modifier-border)";
                frag.appendChild(circle);
                frag.appendChild(document.createTextNode(color));
                s.setTitle(frag);
                s.onClick(async () => {
                  const next = { ...settings };
                  next.colorMap = { ...next.colorMap, [file.path]: color };
                  settings = next;
                  await onUpdateSettings(settings);
                });
              });
            }
          });
        }
      });

      if (actions.has("icon")) menu.addItem((item) => {
        item.setTitle("Change icon...").setIcon("image");
        const submenu = item.setSubmenu();
        for (const icon of ICON_OPTIONS) {
          submenu.addItem((sub) =>
            sub
              .setTitle(icon)
              .setIcon(icon)
              .onClick(async () => {
                const next = { ...settings };
                next.iconMap = { ...next.iconMap, [file.path]: icon };
                settings = next;
                await onUpdateSettings(settings);
              })
          );
        }
        submenu.addSeparator();
        submenu.addItem((sub) =>
          sub
            .setTitle("Default (remove)")
            .setIcon("x")
            .onClick(async () => {
              const next = { ...settings };
              const im = { ...next.iconMap };
              delete im[file.path];
              next.iconMap = im;
              settings = next;
              await onUpdateSettings(settings);
            })
        );
        submenu.addItem((sub) =>
          sub
            .setTitle("More icons...")
            .setIcon("search")
            .onClick(() => {
              new IconSuggestModal(app, settings.customIconsFolder ?? "", async (iconName) => {
                const next = { ...settings };
                next.iconMap = { ...next.iconMap, [file.path]: iconName };
                settings = next;
                await onUpdateSettings(settings);
              }).open();
            })
        );
      });

      if (isFolder && actions.has("collapse-icons")) {
        menu.addItem((item) => {
          item.setTitle("Set collapse icons...").setIcon("chevrons-right");
          const submenu = item.setSubmenu();

          const currCollapsed = settings.folderCollapseIconMap[file.path]?.collapsed || settings.collapseIcon || "chevron-right";
          const currExpanded = settings.folderCollapseIconMap[file.path]?.expanded || settings.collapseIconExpanded || "chevron-down";

          submenu.addItem((sub) =>
            sub
              .setTitle(`Collapse icon: ${currCollapsed}`)
              .setIcon(currCollapsed)
              .onClick(() => {
                new IconSuggestModal(app, settings.customIconsFolder ?? "", async (iconName) => {
                  const next = { ...settings };
                  const fcm = { ...next.folderCollapseIconMap };
                  const current: { collapsed: string; expanded: string } = fcm[file.path] || { collapsed: "", expanded: "" };
                  fcm[file.path] = { ...current, collapsed: iconName };
                  next.folderCollapseIconMap = fcm;
                  settings = next;
                  await onUpdateSettings(settings);
                }).open();
              })
          );

          submenu.addItem((sub) =>
            sub
              .setTitle(`Expand icon: ${currExpanded}`)
              .setIcon(currExpanded)
              .onClick(() => {
                new IconSuggestModal(app, settings.customIconsFolder ?? "", async (iconName) => {
                  const next = { ...settings };
                  const fcm = { ...next.folderCollapseIconMap };
                  const current: { collapsed: string; expanded: string } = fcm[file.path] || { collapsed: "", expanded: "" };
                  fcm[file.path] = { ...current, expanded: iconName };
                  next.folderCollapseIconMap = fcm;
                  settings = next;
                  await onUpdateSettings(settings);
                }).open();
              })
          );

          submenu.addSeparator();
          submenu.addItem((sub) =>
            sub
              .setTitle("Reset chevron icons")
              .setIcon("x")
              .onClick(async () => {
                const next = { ...settings };
                const fcm = { ...next.folderCollapseIconMap };
                delete fcm[file.path];
                next.folderCollapseIconMap = fcm;
                settings = next;
                await onUpdateSettings(settings);
              })
          );
        });
      }

      const commandCount = appendProfileCommands(menu, profile, app, file);
      const applicableActions = profile.actions.filter(action => isFolder || (action !== "archive" && action !== "collapse-icons"));
      if (applicableActions.length === 0 && commandCount === 0) {
        menu.addItem(item => item.setTitle("No actions configured for this menu").setDisabled(true));
      }
    }

    if (!profile && isFolder && settings.orderMap[file.path]?.length) {
      menu.addSeparator();
      menu.addItem(item => item.setTitle("Reset folder order").setIcon("rotate-ccw")
        .onClick(() => { void onResetFolderOrder(file.path); }));
    }

    menu.showAtMouseEvent(event);
  }

  function handleDragStart(e: DragEvent) {
    const title = e.currentTarget as HTMLElement;
    const tree = title.closest(".simple-navigator-tree");
    if (!tree || !e.dataTransfer) return;
    document.body.classList.add("sn-is-dragging");

    const itemPath = file.path;
    dragState.itemPath = itemPath;
    dragState.targetFolder = null;
    dragState.toPath = "";
    dragState.newIndex = -1;

    if (selectedPaths.has(itemPath)) {
      const visiblePaths = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"][data-path]'), row => row.dataset.path!);
      dragState.batchPaths = getDragBatchPaths(itemPath, visiblePaths, selectedPaths);
    } else {
      dragState.batchPaths = [];
    }

    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", itemPath);

    const color = settings.colorMap[itemPath] || "var(--text-faint)";
    createDropIndicator(color);
  }

  function handleDragOver(e: DragEvent) {
    e.stopPropagation();
    if (!dragState.itemPath) return;

    // Ctrl held + cursor over a note -> link-insert mode: highlight the target
    // note instead of showing move indicators.
    if (e.ctrlKey) {
      const noteEl = findNoteUnderPointer(e.clientX, e.clientY);
      if (noteEl && noteEl.dataset.path !== dragState.itemPath && !dragState.batchPaths.includes(noteEl.dataset.path)) {
        dragState.linkTarget = noteEl.dataset.path;
        dragState.toPath = "";
        dragState.targetFolder = null;
        dragState.newIndex = -1;
        e.dataTransfer!.dropEffect = "copy";
        removeDropIndicator();
        highlightLinkTarget(noteEl);
        updateAutoScroll(e.clientY);
        return;
      }
    }

    dragState.linkTarget = null;
    clearLinkTargetHighlight();
    const tree = (e.currentTarget as HTMLElement).closest(".simple-navigator-tree");
    if (tree) updateMoveDrop(e, tree, settings.sortMode !== "manual", onExpandDropFolder);
  }

  function findNoteUnderPointer(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y);
    const item = el ? el.closest<HTMLElement>(".nav-file") : null;
    const target = item?.dataset.path ? app.vault.getAbstractFileByPath(item.dataset.path) : null;
    return target instanceof TFile && target.extension.toLowerCase() === "md" ? item : null;
  }

  async function handleDrop(e: DragEvent) {
    dragState.lastDropTime = Date.now();
    e.stopPropagation();
    destroyDropIndicator();
    clearLinkTargetHighlight();

    if (!dragState.itemPath) return;

    if (e.ctrlKey && dragState.linkTarget) {
      e.preventDefault();
      const targetPath = dragState.linkTarget;
      const items = dragState.batchPaths.length > 0 ? dragState.batchPaths : [dragState.itemPath];
      dragState.itemPath = "";
      dragState.batchPaths = [];
      dragState.linkTarget = null;
      document.body.classList.remove("sn-is-dragging");
      appendWikiLinksToNote(app, targetPath, items).catch((err) => console.error("SN append links failed:", err));
      return;
    }

    dragState.linkTarget = null;

    const itemPath = dragState.itemPath;
    const batchPaths = dragState.batchPaths.length > 0 ? dragState.batchPaths : undefined;

    // Capture the target before clearing the shared drag state.
    const toPath = dragState.targetFolder ?? dragState.toPath;
    const newIndex = dragState.targetFolder ? -1 : dragState.newIndex;
    const hasTarget = !!dragState.targetFolder || dragState.toPath !== "" || dragState.newIndex >= 0;
    dragState.itemPath = "";
    dragState.batchPaths = [];
    document.body.classList.remove("sn-is-dragging");
    try {
      if (hasTarget) {
        await onSortEnd({ toPath, newIndex, itemPath, batchPaths });
      }
    } catch (error) {
      console.error("Drop failed:", error);
      new Notice("Could not save the navigator order");
    }
  }

  function handleDragLeave(e: DragEvent) {
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && target.contains(related)) return;
    removeDropIndicator();
    clearLinkTargetHighlight();
    dragState.linkTarget = null;
  }

  function handleDragEnd(e: DragEvent) {
    destroyDropIndicator();
    clearLinkTargetHighlight();
    dragState.linkTarget = null;
    dragState.itemPath = "";
    document.body.classList.remove("sn-is-dragging");
    dragState.batchPaths = [];
  }
</script>

  {#if isFolder}
  <div class="nav-folder" data-path={file.path} role="treeitem" tabindex="-1" aria-label={file.name} aria-expanded={!collapsed} aria-selected={selectedPaths.has(file.path)} class:is-collapsed={collapsed} class:is-hidden={isHidden} class:is-selected={selectedPaths.has(file.path)}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
      class="nav-folder-title"
      draggable="true"
      on:click={handleClick}
      on:auxclick={handleAuxClick}
      on:mousedown={handleMiddleMouseDown}
      on:dblclick={handleDblClick}
      on:contextmenu={handleContextMenu}
      on:sn-contextmenu={(event) => handleContextMenu(event.detail)}
      on:sn-rename={handleRename}
      on:dragstart={handleDragStart}
      on:dragend={handleDragEnd}
      style="padding-left: {4 + depth * 20}px;display:flex;align-items:center"
      style:color={settings.colorMap[file.path] || undefined}
      style:--sn-color={settings.colorMap[file.path] || undefined}
    >
      {#if settings.enableCollapseIcons}
      <span class="nav-folder-collapse-indicator collapse-icon" bind:this={collapseIconEl} style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;margin:0;padding:0" />
      {/if}
      {#if settings.iconMap[file.path] || !settings.hideDefaultIcons}
      <span class="nav-file-icon" bind:this={typeIconEl} style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;margin:0;padding:0;color:{iconColor}" />
      {/if}
      {#if editingPath === file.path}
      <input class="sn-rename-input" type="text" value={renameValue} bind:this={renameInputEl} on:blur={() => saveRename()} on:keydown={handleRenameKeydown} />
      {:else}
      <div class="nav-folder-title-content">{isArchived ? `${displayName} (${fileCount})` : file.name}</div>
      {/if}
    </div>
    <div class="nav-folder-children" role="group" data-folder-path={file.path} style:display={collapsed ? 'none' : ''} style:visibility={collapsed ? 'hidden' : ''} style:overflow={collapsed ? 'hidden' : ''} style:--sn-color={settings.colorMap[file.path] || undefined} style:--guide-offset={4 + depth * 20 + 8 + "px"} style:--guide-width={1 / window.devicePixelRatio + "px"} on:dragover|preventDefault={handleDragOver} on:drop={handleDrop} on:dragleave={handleDragLeave}>
      {#if !collapsed}
      {#each children as child (child.path)}
        <svelte:self
          {app}
          file={child}
          depth={depth + 1}
          {activeFilePath}
          {settings}
          {showHidden}
          {refreshKey}
          {selectedPaths}
          {onSelect}
          {onClearSelection}
          {onExpandDropFolder}
          {onResetFolderOrder}
          {onSortEnd}
          {onUpdateSettings}
          {renameItem}
        />
      {/each}
      {/if}
    </div>
  </div>
{:else}
  <div class="nav-file" data-path={file.path} role="treeitem" tabindex="-1" aria-label={file.name} aria-current={isActive ? "page" : undefined} aria-selected={selectedPaths.has(file.path)} class:is-active={isActive} class:is-hidden={isHidden} class:is-selected={selectedPaths.has(file.path)}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
      class="nav-file-title"
      draggable="true"
      on:click={handleClick}
      on:auxclick={handleAuxClick}
      on:mousedown={handleMiddleMouseDown}
      on:dblclick={handleDblClick}
      on:contextmenu={handleContextMenu}
      on:sn-contextmenu={(event) => handleContextMenu(event.detail)}
      on:sn-rename={handleRename}
      on:dragstart={handleDragStart}
      on:dragend={handleDragEnd}
      style="padding-left: {4 + depth * 20}px;display:flex;align-items:center"
      style:color={settings.colorMap[file.path] || undefined}
      style:--sn-color={settings.colorMap[file.path] || undefined}
    >
      {#if settings.iconMap[file.path] || !settings.hideDefaultIcons}
      <span class="nav-file-icon" bind:this={typeIconEl} style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;margin:0;padding:0;color:{iconColor}" />
      {/if}
      {#if editingPath === file.path}
      <input class="sn-rename-input" type="text" value={renameValue} bind:this={renameInputEl} on:blur={() => saveRename()} on:keydown={handleRenameKeydown} />
      {:else}
      <div class="nav-file-title-content">{displayName}</div>
      {/if}
    </div>
  </div>
{/if}
