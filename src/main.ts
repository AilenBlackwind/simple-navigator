import { Plugin, WorkspaceLeaf, TFolder } from "obsidian";
import { SIMPLE_NAVIGATOR_VIEW, SimpleNavigatorView } from "./SimpleNavigatorView";
import { PluginSettings, DEFAULT_SETTINGS, SimpleNavigatorSettingTab } from "./settings";
import { cleanUpSettings } from "./utils";

export default class SimpleNavigatorPlugin extends Plugin {
  settings!: PluginSettings;

  async onload() {
    const rawData = await this.loadData() as Record<string, unknown> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData);

    // Migrate old customCommands → submenus["Other"]
    if (rawData?.customCommands && Array.isArray(rawData.customCommands) && rawData.customCommands.length > 0) {
      if (!this.settings.submenus["Other"]) {
        this.settings.submenus["Other"] = rawData.customCommands as any;
      }
    }
    // Remove old fields from in-memory settings so saveSettings() drops them
    delete (this.settings as any).customCommands;
    delete (this.settings as any).customTemplates;

    // Drop settings entries that point to files no longer present in the vault
    this.settings = cleanUpSettings(this.settings, this.app.vault);
    await this.saveSettings();

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

    this.addRibbonIcon("folder-tree", "Simple Navigator", () => {
      this.activateView();
    });

    this.addSettingTab(new SimpleNavigatorSettingTab(this.app, this));
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
