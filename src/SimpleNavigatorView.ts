import { ItemView, WorkspaceLeaf, EventRef } from "obsidian";
import type SimpleNavigatorPlugin from "./main";
import TreeView from "./components/TreeView.svelte";

export const SIMPLE_NAVIGATOR_VIEW = "simple-navigator-view";

export class SimpleNavigatorView extends ItemView {
  plugin: SimpleNavigatorPlugin;
  component: TreeView | null = null;
  private showHidden: boolean;
  private vaultRefs: EventRef[] = [];
  refreshKey = 0;

  constructor(leaf: WorkspaceLeaf, plugin: SimpleNavigatorPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.showHidden = plugin.settings.showHidden;
  }

  getViewType(): string {
    return SIMPLE_NAVIGATOR_VIEW;
  }

  getDisplayText(): string {
    return "Simple Navigator";
  }

  getIcon(): string {
    return "folder-tree";
  }

  async toggleShowHidden() {
    this.showHidden = !this.showHidden;
    this.plugin.settings.showHidden = this.showHidden;
    await this.plugin.saveSettings();
    this.component?.$set({ showHidden: this.showHidden });
  }

  async onOpen() {
    this.contentEl.innerHTML = "";

    const root = this.app.vault.getRoot();
    this.component = new TreeView({
      target: this.contentEl,
      props: {
        app: this.app,
        rootFolder: root,
        settings: this.plugin.settings,
        showHidden: this.showHidden,
        refreshKey: this.refreshKey,
        onUpdateSettings: async (s: typeof this.plugin.settings) => {
          this.plugin.settings = s;
          await this.plugin.saveSettings();
          this.component?.$set({ settings: this.plugin.settings });
        },
      },
    });

    let bumpRaf: number | null = null;
    const bump = () => {
      if (bumpRaf) return;
      bumpRaf = requestAnimationFrame(() => {
        bumpRaf = null;
        this.refreshKey++;
        this.component?.$set({ refreshKey: this.refreshKey });
      });
    };

    this.vaultRefs.push(
      this.app.vault.on("create", bump),
      this.app.vault.on("delete", bump),
      this.app.vault.on("rename", bump),
    );
  }

  async onClose() {
    for (const ref of this.vaultRefs) {
      this.app.vault.offref(ref);
    }
    this.vaultRefs = [];
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }
  }
}
