import { Plugin, WorkspaceLeaf, TFolder, TAbstractFile, Notice, normalizePath } from "obsidian";
import { SIMPLE_NAVIGATOR_VIEW, SimpleNavigatorView } from "./SimpleNavigatorView";
import { PluginSettings, DEFAULT_SETTINGS, SimpleNavigatorSettingTab } from "./settings";
import { refreshCustomIcons } from "./icon-utils";
import { cleanUpSettings } from "./utils";
import { MoveToModal } from "./modal";
import { updatePathsOnMove } from "./drag-state";

export default class SimpleNavigatorPlugin extends Plugin {
  settings!: PluginSettings;
  lastClicked: TAbstractFile | null = null;
  lastClickedAt = 0;

  async onload() {
    const rawData = await this.loadData() as Record<string, unknown> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData);

    // Migrate old customCommands → submenus["Other"]
    if (rawData?.customCommands && Array.isArray(rawData.customCommands) && rawData.customCommands.length > 0) {
      if (!this.settings.submenus["Other"]) {
        this.settings.submenus["Other"] = rawData.customCommands as any;
      }
    }
    // Remove old fields from in-memory settings
    delete (this.settings as any).customCommands;
    delete (this.settings as any).customTemplates;

    this.settings = cleanUpSettings(this.settings, this.app.vault);

    refreshCustomIcons(this.app, this.settings.customIconsFolder);

    this.registerView(SIMPLE_NAVIGATOR_VIEW, (leaf) => {
      return new SimpleNavigatorView(leaf, this);
    });

    this.addCommand({
      id: "open-simple-navigator",
      name: "Open Simple Navigator",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "toggle-hidden-files",
      name: "Toggle hidden files visibility",
      callback: () => {
        const view = this.app.workspace
          .getLeavesOfType(SIMPLE_NAVIGATOR_VIEW)[0]
          ?.view as SimpleNavigatorView | undefined;
        view?.toggleShowHidden();
      },
    });

    this.addCommand({
      id: "collapse-all",
      name: "Collapse all folders",
      callback: async () => {
        const allPaths = this.app.vault
          .getAllLoadedFiles()
          .filter((f): f is TFolder => f instanceof TFolder)
          .map((f) => f.path);
        this.settings = { ...this.settings, collapsedPaths: allPaths };
        await this.saveSettings();
      },
    });

    this.addCommand({
      id: "toggle-auto-reveal",
      name: "Toggle auto-reveal active file",
      callback: async () => {
        this.settings = { ...this.settings, autoReveal: !this.settings.autoReveal };
        await this.saveSettings();
      },
    });

    this.addCommand({
      id: "move-to",
      name: "Move to...",
      callback: () => this.showMoveToDialog(),
    });

    this.addRibbonIcon("folder-tree", "Simple Navigator", () => {
      this.activateView();
    });

    this.addSettingTab(new SimpleNavigatorSettingTab(this.app, this));
  }

  async onunload() {
    const { clearIconCache } = await import("./icon-utils");
    clearIconCache();
  }

  setLastClicked(file: TAbstractFile | null) {
    this.lastClicked = file;
    this.lastClickedAt = file ? Date.now() : 0;
  }

  showMoveToDialog() {
    let target: TAbstractFile | null = null;
    if (this.lastClicked && Date.now() - this.lastClickedAt < 5000) {
      target = this.lastClicked;
    } else {
      target = this.app.workspace.getActiveFile();
    }
    this.lastClicked = null;
    this.lastClickedAt = 0;

    if (!target) {
      new Notice("No file or folder selected");
      return;
    }
    const item = target;

    new MoveToModal(this.app, item, (folder) => {
      this.moveItemTo(item, folder);
    }).open();
  }

  async moveItemTo(item: TAbstractFile, targetFolder: TFolder): Promise<void> {
    if (item instanceof TFolder) {
      if (targetFolder.path === item.path || targetFolder.path.startsWith(item.path + "/")) {
        new Notice("Cannot move a folder into itself");
        return;
      }
    }
    const targetPath = targetFolder.path
      ? normalizePath(`${targetFolder.path}/${item.name}`)
      : item.name;
    if (targetPath === item.path) return;

    const savedSettings = this.settings;
    try {
      this.settings = updatePathsOnMove(this.settings, item.path, targetPath);
      await this.app.fileManager.renameFile(item, targetPath);
    } catch (e) {
      console.error("Move failed:", e);
      this.settings = savedSettings;
      new Notice(`Cannot move "${item.name}": file is locked`);
      return;
    }
    await this.saveSettings();
  }

  async moveOrderKey(oldPath: string, newPath: string): Promise<void> {
    const orderMap = { ...this.settings.orderMap };
    let changed = false;

    if (oldPath in orderMap) {
      orderMap[newPath] = orderMap[oldPath];
      delete orderMap[oldPath];
      changed = true;
    }

    const prefix = oldPath + "/";
    const newPrefix = newPath + "/";
    for (const key of Object.keys(orderMap)) {
      if (key.startsWith(prefix)) {
        orderMap[newPrefix + key.slice(prefix.length)] = orderMap[key];
        delete orderMap[key];
        changed = true;
      }
    }

    if (changed) {
      this.settings = { ...this.settings, orderMap };
      await this.saveSettings();
    }
  }

  async setFolderOrder(folderPath: string, orderedNames: string[]): Promise<void> {
    this.settings = {
      ...this.settings,
      orderMap: { ...this.settings.orderMap, [folderPath]: orderedNames },
    };
    await this.saveSettings();
  }

  getSortedChildren(folderPath: string): { name: string; path: string; type: "file" | "folder" }[] {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder || !(folder instanceof TFolder)) return [];

    const hiddenSet = new Set(this.settings.hiddenPaths);
    const archivedSet = new Set(this.settings.archivedPaths);

    let children = folder.children.filter(
      (child) => !hiddenSet.has(child.path) && !archivedSet.has(child.path)
    );

    const order = this.settings.orderMap[folderPath];
    if (order && order.length > 0) {
      const orderIndex = new Map(order.map((name, i) => [name, i]));
      children.sort((a, b) => {
        const ai = orderIndex.get(a.name);
        const bi = orderIndex.get(b.name);
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return a.name.localeCompare(b.name);
      });
    } else {
      children.sort((a, b) => a.name.localeCompare(b.name));
    }

    return children.map((child) => ({
      name: child.name,
      path: child.path,
      type: child instanceof TFolder ? "folder" : "file",
    }));
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // propagate settings to the view so Svelte re-renders
    const view = this.app.workspace
      .getLeavesOfType(SIMPLE_NAVIGATOR_VIEW)[0]
      ?.view as SimpleNavigatorView | undefined;
    if (view) {
      view.component?.$set({
        settings: this.settings,
        showHidden: this.settings.showHidden,
      });
    }
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(SIMPLE_NAVIGATOR_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        leaf = workspace.getLeaf(true);
      }
      await leaf.setViewState({
        type: SIMPLE_NAVIGATOR_VIEW,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }
}
