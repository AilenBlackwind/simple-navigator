<script lang="ts">
  import { TFile, TFolder, setIcon, Menu, normalizePath } from "obsidian";
  import type { App, TAbstractFile } from "obsidian";
  import { sortWithOrder, defaultSortFn, countFiles, getFileIcon, getVisibleExtSet, deleteFile } from "../utils";
  import { setCustomIcon } from "../icon-utils";
  import { dragState, createDropIndicator, updateDropIndicator, removeDropIndicator, destroyDropIndicator, clearFolderHighlight, highlightFolder, resolveDropTarget, updatePathsOnMove, updateAutoScroll } from "../drag-state";
  import type { PluginSettings } from "../settings";
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
  export let onSortEnd: (detail: {
    fromPath: string;
    toPath: string;
    oldIndex: number;
    newIndex: number;
    itemPath: string;
    batchPaths?: string[];
  }) => void;
  export let onUpdateSettings: (s: PluginSettings) => Promise<void>;

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
      : sortWithOrder([...(file as TFolder).children], settings.orderMap, file.path, refreshKey)
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
    if (e.shiftKey || e.ctrlKey) {
      onSelect(file.path, e.shiftKey, e.ctrlKey);
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

  async function saveRename() {
    if (editingPath !== file.path) return;
    const newName = renameInputEl?.value.trim();
    const strippedName = !isFolder ? file.name.replace(/^(.+?)\.([^.]+)$/, "$1") : file.name;
    if (!newName || newName === strippedName) {
      editingPath = null;
      return;
    }
    const parentPath = file.parent ? file.parent.path : "";
    const ext = file instanceof TFile ? file.extension : "";
    const finalName = ext && !newName.endsWith("." + ext) ? newName + "." + ext : newName;
    const newPath = parentPath ? normalizePath(`${parentPath}/${finalName}`) : finalName;
    const oldPath = file.path;
    const savedSettings = settings;
    try {
      settings = updatePathsOnMove(settings, oldPath, newPath);
      await app.fileManager.renameFile(file, newPath);
    } catch {
      settings = savedSettings;
      editingPath = null;
      return;
    }
    await onUpdateSettings(settings);
    editingPath = null;
  }

  function cancelRename() {
    editingPath = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveRename();
    } else if (e.key === "Escape") {
      cancelRename();
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
    const pluginInstance = () => (app as any).plugins.plugins['simple-navigator'];

    function handleMoveTo() {
      const p = pluginInstance();
      if (p) p.setLastClicked(file);
      new MoveToModal(app, file, async (folder) => {
        const p2 = pluginInstance();
        if (p2) await p2.moveItemTo(file, folder);
      }).open();
    }

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

    const singleHidden = !isMultiSelected && settings.hiddenPaths.includes(file.path);
    menu.addItem((item) =>
      item
        .setTitle("Move to...")
        .setIcon("corner-up-right")
        .onClick(handleMoveTo)
    );
    menu.addSeparator();
    menu.addItem((item) =>
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

    const singleArchived = !isMultiSelected && isFolder && settings.archivedPaths.includes(file.path);
    if (isFolder) {
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

    const ctxX = event.clientX;
    const ctxY = event.clientY;

    menu.addSeparator();

    menu.addItem((item) => {
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

    menu.addItem((item) => {
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

    if (isFolder) {
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

    const submenuEntries = Object.entries(settings.submenus).filter(([, e]) => e.length > 0);
    if (submenuEntries.length > 0) {
      menu.addSeparator();
      for (const [sectionName, entries] of submenuEntries) {
        menu.addItem((item) => {
          item.setTitle(sectionName);
          const icon = settings.submenuIcons?.[sectionName];
          if (icon) item.setIcon(icon);
          const sub = item.setSubmenu();
          for (const cmd of entries) {
            if (cmd.isSeparator) { sub.addSeparator(); continue; }
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
    }

    if (settings.mainMenuCommands.length > 0) {
      for (const cmd of settings.mainMenuCommands) {
        if (cmd.isSeparator) { menu.addSeparator(); continue; }
        if (!cmd.commandId) continue;
        menu.addItem((s) => {
          s.setTitle(cmd.label);
          if (cmd.icon) s.setIcon(cmd.icon);
          s.onClick(() => {
            const p = pluginInstance();
            if (p) p.setLastClicked(file);
            app.commands.executeCommandById(cmd.commandId);
          });
        });
      }
    }

    menu.showAtMouseEvent(event);
  }

  function handleDragStart(e: DragEvent) {
    document.body.classList.add("sn-is-dragging");
    const title = e.currentTarget as HTMLElement;
    const container = title.closest("[data-folder-path]") as HTMLElement | null;
    const itemEl = title.closest(".nav-folder, .nav-file") as HTMLElement | null;
    if (!container || !itemEl) return;

    const itemPath = itemEl.dataset.path || "";
    const fromPath = container.dataset.folderPath || "";
    const parent = itemEl.parentElement;
    let oldIndex = -1;
    if (parent) {
      const children = Array.from(parent.children);
      oldIndex = children.indexOf(itemEl);
    }

    dragState.fromPath = fromPath;
    dragState.itemPath = itemPath;
    dragState.oldIndex = oldIndex;
    dragState.targetFolder = null;
    dragState.toPath = "";
    dragState.newIndex = -1;

    const sameParentSelected = Array.from(selectedPaths).filter(p => {
      const pp = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      return pp === fromPath;
    });
    const batchSet = new Set(sameParentSelected);
    batchSet.add(itemPath);
    if (batchSet.size >= 2) {
      const domChildren = Array.from(container.children);
      dragState.batchPaths = Array.from(batchSet).sort((a, b) => {
        const aEl = domChildren.find(el => (el as HTMLElement).dataset.path === a);
        const bEl = domChildren.find(el => (el as HTMLElement).dataset.path === b);
        return aEl && bEl ? Array.from(domChildren).indexOf(aEl) - Array.from(domChildren).indexOf(bEl) : 0;
      });
    } else {
      dragState.batchPaths = [];
    }

    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", itemPath);

    const color = settings.colorMap[itemPath] || "var(--text-faint)";
    createDropIndicator(color);
  }

  function handleDragOver(e: DragEvent) {
    e.stopPropagation();
    e.dataTransfer!.dropEffect = "move";
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

    const ccEl = e.currentTarget as HTMLElement;
    const containerFolder = ccEl.closest(".nav-folder") as HTMLElement | null;
    if (containerFolder && ccEl.offsetHeight > 0) {
      highlightFolder(containerFolder);
    } else {
      clearFolderHighlight();
    }
    if (target.itemEl) {
      updateDropIndicator(target.itemEl, e.clientX, e.clientY);
    } else {
      removeDropIndicator();
    }
  }

  function handleDrop(e: DragEvent) {
    dragState.lastDropTime = Date.now();
    e.stopPropagation();
    destroyDropIndicator();

    if (!dragState.itemPath) return;

    const fromPath = dragState.fromPath;
    const itemPath = dragState.itemPath;
    const oldIndex = dragState.oldIndex;
    const batchPaths = dragState.batchPaths.length > 0 ? dragState.batchPaths : undefined;

    if (dragState.targetFolder) {
      onSortEnd({ fromPath, toPath: dragState.targetFolder, oldIndex, newIndex: -1, itemPath, batchPaths });
    } else if (dragState.toPath !== "" || dragState.newIndex >= 0) {
      onSortEnd({ fromPath, toPath: dragState.toPath, oldIndex, newIndex: dragState.newIndex, itemPath, batchPaths });
    }

    dragState.itemPath = "";
    dragState.fromPath = "";
    dragState.batchPaths = [];
  }

  function handleDragLeave(e: DragEvent) {
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && target.contains(related)) return;
    clearFolderHighlight();
  }

  function handleDragEnd(e: DragEvent) {
    destroyDropIndicator();
    document.body.classList.remove("sn-is-dragging");
    dragState.batchPaths = [];
  }
</script>

  {#if isFolder}
  <div class="nav-folder" data-path={file.path} class:is-collapsed={collapsed} class:is-hidden={isHidden} class:is-selected={selectedPaths.has(file.path)}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
      class="nav-folder-title"
      draggable="true"
      on:click={handleClick}
      on:auxclick={handleAuxClick}
      on:mousedown={handleMiddleMouseDown}
      on:dblclick={handleDblClick}
      on:contextmenu={handleContextMenu}
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
      <input class="sn-rename-input" type="text" value={renameValue} bind:this={renameInputEl} on:blur={saveRename} on:keydown={handleRenameKeydown} />
      {:else}
      <div class="nav-folder-title-content">{isArchived ? `${displayName} (${fileCount})` : file.name}</div>
      {/if}
    </div>
    <div class="nav-folder-children" data-folder-path={file.path} style:display={collapsed ? 'none' : ''} style:visibility={collapsed ? 'hidden' : ''} style:overflow={collapsed ? 'hidden' : ''} style:--sn-color={settings.colorMap[file.path] || undefined} style:--guide-offset={4 + depth * 20 + 8 + "px"} style:--guide-width={1 / window.devicePixelRatio + "px"} on:dragover|preventDefault={handleDragOver} on:drop={handleDrop} on:dragleave={handleDragLeave}>
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
          {onSortEnd}
          {onUpdateSettings}
        />
      {/each}
      {/if}
    </div>
  </div>
{:else}
  <div class="nav-file" data-path={file.path} class:is-active={isActive} class:is-hidden={isHidden} class:is-selected={selectedPaths.has(file.path)}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
      class="nav-file-title"
      draggable="true"
      on:click={handleClick}
      on:auxclick={handleAuxClick}
      on:mousedown={handleMiddleMouseDown}
      on:dblclick={handleDblClick}
      on:contextmenu={handleContextMenu}
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
      <input class="sn-rename-input" type="text" value={renameValue} bind:this={renameInputEl} on:blur={saveRename} on:keydown={handleRenameKeydown} />
      {:else}
      <div class="nav-file-title-content">{displayName}</div>
      {/if}
    </div>
  </div>
{/if}
