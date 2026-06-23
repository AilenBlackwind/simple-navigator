import { PluginSettingTab, Setting, App, setIcon } from "obsidian";
import { CommandSuggestModal, IconSuggestModal, FolderSuggestModal } from "./modal";
import type SimpleNavigatorPlugin from "./main";

export interface SubmenuEntry {
  label: string;
  commandId: string;
  icon?: string;
}

export interface PluginSettings {
  orderMap: Record<string, string[]>;
  hiddenPaths: string[];
  archivedPaths: string[];
  colorMap: Record<string, string>;
  iconMap: Record<string, string>;
  customColors: string[];
  collapsedPaths: string[];
  autoReveal: boolean;
  showHidden: boolean;
  iconFollowsColor: boolean;
  visibleExtensions: string;
  hideDefaultIcons: boolean;
  enableCollapseIcons: boolean;
  collapseIcon: string;
  collapseIconExpanded: string;
  folderCollapseIconMap: Record<string, { collapsed: string; expanded: string }>;
  renameOnDoubleClickFiles: boolean;
  renameOnDoubleClickFolders: boolean;
  submenus: Record<string, SubmenuEntry[]>;
  mainMenuCommands: SubmenuEntry[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  orderMap: {},
  hiddenPaths: [],
  archivedPaths: [],
  colorMap: {},
  iconMap: {},
  customColors: [],
  collapsedPaths: [],
  autoReveal: false,
  showHidden: false,
  iconFollowsColor: false,
  visibleExtensions: "",
  hideDefaultIcons: false,
  enableCollapseIcons: false,
  collapseIcon: "",
  collapseIconExpanded: "",
  folderCollapseIconMap: {},
  renameOnDoubleClickFiles: false,
  renameOnDoubleClickFolders: false,
  submenus: {},
  mainMenuCommands: [],
};

export class SimpleNavigatorSettingTab extends PluginSettingTab {
  plugin: SimpleNavigatorPlugin;

  constructor(app: App, plugin: SimpleNavigatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Simple Navigator Settings" });

    new Setting(containerEl)
      .setName("Icon follows color")
      .setDesc(
        "When enabled, file and folder icons will inherit the custom color assigned to them."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.iconFollowsColor)
          .onChange(async (value) => {
            this.plugin.settings.iconFollowsColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Visible file extensions")
      .setDesc(
        "Comma-separated list of extensions to show in filenames. Extensions not listed will be hidden. Leave empty to show all extensions."
      )
      .addText((text) =>
        text
          .setPlaceholder(".js, .pdf, .txt")
          .setValue(this.plugin.settings.visibleExtensions)
          .onChange(async (value) => {
            this.plugin.settings.visibleExtensions = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Hide default icons")
      .setDesc(
        "Hides all default folder arrows and file icons. Custom icons set via 'Change icon...' will still be shown."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideDefaultIcons)
          .onChange(async (value) => {
            this.plugin.settings.hideDefaultIcons = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable collapse indicators")
      .setDesc(
        "Show custom icons next to folders to indicate collapsed/expanded state."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCollapseIcons)
          .onChange(async (value) => {
            this.plugin.settings.enableCollapseIcons = value;
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.enableCollapseIcons) {
      new Setting(containerEl)
        .setName("Collapsed folder icon")
        .setDesc("Icon name for collapsed folders. Any Lucide icon name. Default: chevron-right")
        .addText((text) =>
          text
            .setPlaceholder("chevron-right")
            .setValue(this.plugin.settings.collapseIcon)
            .onChange(async (value) => {
              this.plugin.settings.collapseIcon = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Expanded folder icon")
        .setDesc("Icon name for expanded folders. Any Lucide icon name. Default: chevron-down")
        .addText((text) =>
          text
            .setPlaceholder("chevron-down")
            .setValue(this.plugin.settings.collapseIconExpanded)
            .onChange(async (value) => {
              this.plugin.settings.collapseIconExpanded = value;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Rename files on double-click")
      .setDesc("Double-click a file to rename it instead of opening it.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.renameOnDoubleClickFiles)
          .onChange(async (value) => {
            this.plugin.settings.renameOnDoubleClickFiles = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Rename folders on double-click")
      .setDesc("Double-click a folder to rename it.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.renameOnDoubleClickFolders)
          .onChange(async (value) => {
            this.plugin.settings.renameOnDoubleClickFolders = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Archived folders ---
    containerEl.createEl("h3", { text: "Archived folders" });
    containerEl.createEl("p", {
      text: "Archived folders are hidden from the tree and shown as a single collapsed entry.",
      cls: "setting-item-description",
    });

    const archiveDesc = containerEl.createDiv();
    archiveDesc.style.marginBottom = "8px";

    function renderArchived() {
      archiveDesc.empty();
      const list = this.plugin.settings.archivedPaths;
      for (let i = 0; i < list.length; i++) {
        const row = archiveDesc.createDiv();
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.alignItems = "center";
        row.style.marginBottom = "4px";

        const pathSpan = row.createEl("span");
        pathSpan.textContent = list[i];
        pathSpan.style.flex = "1";
        pathSpan.style.background = "var(--background-primary)";
        pathSpan.style.padding = "4px 8px";
        pathSpan.style.borderRadius = "4px";
        pathSpan.style.fontSize = "12px";

        const removeBtn = row.createEl("button");
        removeBtn.textContent = "×";
        removeBtn.style.background = "transparent";
        removeBtn.style.border = "none";
        removeBtn.style.cursor = "pointer";
        removeBtn.style.color = "var(--text-muted)";
        removeBtn.onclick = async () => {
          this.plugin.settings.archivedPaths = [
            ...this.plugin.settings.archivedPaths.slice(0, i),
            ...this.plugin.settings.archivedPaths.slice(i + 1),
          ];
          await this.plugin.saveSettings();
          renderArchived.call(this);
        };
      }

      const addRow = archiveDesc.createDiv();
      addRow.style.marginTop = "8px";

      const addBtn = addRow.createEl("button");
      addBtn.textContent = "+ Add folder";
      addBtn.onclick = () => {
        new FolderSuggestModal(this.app, (folder) => {
          if (!this.plugin.settings.archivedPaths.includes(folder.path)) {
            this.plugin.settings.archivedPaths = [
              ...this.plugin.settings.archivedPaths,
              folder.path,
            ];
            this.plugin.saveSettings();
            renderArchived.call(this);
          }
        }).open();
      };
    }

    renderArchived.call(this);

    // --- Custom colors ---
    containerEl.createEl("h3", { text: "Custom colors" });
    containerEl.createEl("p", {
      text: "Additional colors shown after the preset palette in the 'Change color...' menu.",
      cls: "setting-item-description",
    });

    const colorsDesc = containerEl.createDiv();
    colorsDesc.style.marginBottom = "8px";

    function renderCustomColors() {
      colorsDesc.empty();
      const list = this.plugin.settings.customColors;
      for (let i = 0; i < list.length; i++) {
        const row = colorsDesc.createDiv();
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.alignItems = "center";
        row.style.marginBottom = "4px";

        const colorPreview = row.createEl("span");
        colorPreview.style.width = "20px";
        colorPreview.style.height = "20px";
        colorPreview.style.borderRadius = "4px";
        colorPreview.style.backgroundColor = list[i];
        colorPreview.style.border = "1px solid var(--background-modifier-border)";
        colorPreview.style.flexShrink = "0";

        const colorInput = row.createEl("input", { type: "text" });
        colorInput.value = list[i];
        colorInput.style.width = "120px";
        colorInput.style.background = "var(--background-primary)";
        colorInput.placeholder = "#hexcolor";

        const nativePicker = row.createEl("input", { type: "color" });
        nativePicker.value = list[i];
        nativePicker.style.width = "28px";
        nativePicker.style.height = "28px";
        nativePicker.style.padding = "0";
        nativePicker.style.border = "none";
        nativePicker.style.cursor = "pointer";
        nativePicker.onchange = () => {
          colorInput.value = nativePicker.value;
          colorPreview.style.backgroundColor = nativePicker.value;
          this.plugin.settings.customColors[i] = nativePicker.value;
          this.plugin.saveSettings();
        };

        const removeBtn = row.createEl("button");
        removeBtn.textContent = "×";
        removeBtn.style.background = "transparent";
        removeBtn.style.border = "none";
        removeBtn.style.cursor = "pointer";
        removeBtn.style.color = "var(--text-muted)";
        removeBtn.onclick = async () => {
          this.plugin.settings.customColors = [
            ...this.plugin.settings.customColors.slice(0, i),
            ...this.plugin.settings.customColors.slice(i + 1),
          ];
          await this.plugin.saveSettings();
          renderCustomColors.call(this);
        };

        colorInput.onchange = () => {
          this.plugin.settings.customColors[i] = colorInput.value;
          colorPreview.style.backgroundColor = colorInput.value;
          nativePicker.value = colorInput.value;
          this.plugin.saveSettings();
        };
      }

      const addRow = colorsDesc.createDiv();
      addRow.style.marginTop = "8px";

      const addBtn = addRow.createEl("button");
      addBtn.textContent = "+ Add color";
      addBtn.onclick = async () => {
        this.plugin.settings.customColors = [
          ...this.plugin.settings.customColors,
          "#ffffff",
        ];
        await this.plugin.saveSettings();
        renderCustomColors.call(this);
      };
    }

    renderCustomColors.call(this);

    // --- Submenus ---
    containerEl.createEl("h3", { text: "Submenus" });
    containerEl.createEl("p", {
      text: "Named submenus shown in the context menu. Each contains a list of commands.",
      cls: "setting-item-description",
    });

    const submenuSection = containerEl.createDiv();
    submenuSection.style.marginBottom = "8px";

    function renderSubmenus() {
      submenuSection.empty();

      const addRow = submenuSection.createDiv();
      addRow.style.display = "flex";
      addRow.style.gap = "8px";
      addRow.style.alignItems = "center";
      addRow.style.marginBottom = "12px";

      const nameInput = addRow.createEl("input", { type: "text" });
      nameInput.placeholder = "Section name (e.g. New, Utils...)";
      nameInput.style.flex = "1";
      nameInput.style.background = "var(--background-primary)";

      const addSectionBtn = addRow.createEl("button");
      addSectionBtn.textContent = "+ Add section";
      addSectionBtn.onclick = async () => {
        const name = nameInput.value.trim();
        if (!name) return;
        if (this.plugin.settings.submenus[name]) return;
        this.plugin.settings.submenus = {
          ...this.plugin.settings.submenus,
          [name]: [],
        };
        await this.plugin.saveSettings();
        nameInput.value = "";
        renderSubmenus.call(this);
      };

      for (const [sectionName, entries] of Object.entries(this.plugin.settings.submenus)) {
        if (entries.length === 0 && sectionName === "New") {
          // skip rendering empty "New" section — user said leave it empty
        }

        const sectionDiv = submenuSection.createDiv();
        sectionDiv.style.marginBottom = "8px";
        sectionDiv.style.border = "1px solid var(--background-modifier-border)";
        sectionDiv.style.borderRadius = "4px";
        sectionDiv.style.padding = "8px";

        const headerRow = sectionDiv.createDiv();
        headerRow.style.display = "flex";
        headerRow.style.gap = "8px";
        headerRow.style.alignItems = "center";
        headerRow.style.marginBottom = "8px";

        const headerTitle = headerRow.createEl("span");
        headerTitle.textContent = sectionName;
        headerTitle.style.fontWeight = "bold";
        headerTitle.style.flex = "1";

        const removeSectionBtn = headerRow.createEl("button");
        removeSectionBtn.textContent = "× Remove section";
        removeSectionBtn.style.background = "transparent";
        removeSectionBtn.style.border = "none";
        removeSectionBtn.style.cursor = "pointer";
        removeSectionBtn.style.color = "var(--text-muted)";
        removeSectionBtn.style.fontSize = "12px";
        removeSectionBtn.onclick = async () => {
          const next = { ...this.plugin.settings.submenus };
          delete next[sectionName];
          this.plugin.settings.submenus = next;
          await this.plugin.saveSettings();
          renderSubmenus.call(this);
        };

        const entriesDiv = sectionDiv.createDiv();

        for (let i = 0; i < entries.length; i++) {
          renderEntryRow(entriesDiv, entries, i, () => this.plugin.settings.submenus[sectionName]);
        }

        const addEntryRow = sectionDiv.createDiv();
        addEntryRow.style.marginTop = "4px";

        const addEntryBtn = addEntryRow.createEl("button");
        addEntryBtn.textContent = "+ Add command";
        addEntryBtn.onclick = async () => {
          entries.push({ label: "New command", commandId: "" });
          this.plugin.settings.submenus = { ...this.plugin.settings.submenus };
          await this.plugin.saveSettings();
          renderSubmenus.call(this);
        };
      }
    }

    // --- Main menu commands ---
    containerEl.createEl("h3", { text: "Main menu commands" });
    containerEl.createEl("p", {
      text: "Commands shown at the bottom of the context menu, outside any submenu.",
      cls: "setting-item-description",
    });

    const mainDesc = containerEl.createDiv();
    mainDesc.style.marginBottom = "8px";

    function renderMainCommands() {
      mainDesc.empty();
      const list = this.plugin.settings.mainMenuCommands;

      for (let i = 0; i < list.length; i++) {
        renderEntryRow(mainDesc, list, i, () => this.plugin.settings.mainMenuCommands);
      }

      const addRow = mainDesc.createDiv();
      addRow.style.marginTop = "8px";

      const addBtn = addRow.createEl("button");
      addBtn.textContent = "+ Add command";
      addBtn.onclick = async () => {
        this.plugin.settings.mainMenuCommands = [
          ...this.plugin.settings.mainMenuCommands,
          { label: "New command", commandId: "" },
        ];
        await this.plugin.saveSettings();
        renderMainCommands.call(this);
      };
    }

    function renderEntryRow(
      container: HTMLElement,
      list: { label: string; commandId: string; icon?: string }[],
      index: number,
      getList: () => { label: string; commandId: string; icon?: string }[]
    ) {
      const row = container.createDiv();
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";
      row.style.marginBottom = "4px";

      const labelInput = row.createEl("input", { type: "text" });
      labelInput.value = list[index].label;
      labelInput.style.flex = "1";
      labelInput.style.background = "var(--background-primary)";
      labelInput.placeholder = "Label (e.g. My script)";

      const iconBtn = row.createEl("button");
      iconBtn.style.width = "28px";
      iconBtn.style.height = "28px";
      iconBtn.style.display = "flex";
      iconBtn.style.alignItems = "center";
      iconBtn.style.justifyContent = "center";
      iconBtn.style.background = "transparent";
      iconBtn.style.border = "1px solid var(--background-modifier-border)";
      iconBtn.style.borderRadius = "4px";
      iconBtn.style.cursor = "pointer";
      iconBtn.style.color = "var(--text-muted)";
      iconBtn.style.flexShrink = "0";
      iconBtn.title = "Choose icon";
      const renderIcon = () => {
        iconBtn.empty();
        if (list[index].icon) {
          setIcon(iconBtn, list[index].icon!);
        } else {
          iconBtn.setText("?");
        }
      };
      renderIcon();
      iconBtn.onclick = () => {
        new IconSuggestModal(this.app, (iconName) => {
          list[index].icon = iconName;
          getList();
          renderIcon();
          this.plugin.saveSettings();
        }).open();
      };

      const cmdInput = row.createEl("input", { type: "text" });
      cmdInput.value = list[index].commandId;
      cmdInput.style.flex = "1";
      cmdInput.style.background = "var(--background-primary)";
      cmdInput.placeholder = "Command ID (e.g. my-plugin:action)";

      const searchBtn = row.createEl("button");
      searchBtn.textContent = "Find...";
      searchBtn.style.background = "transparent";
      searchBtn.style.border = "none";
      searchBtn.style.cursor = "pointer";
      searchBtn.style.color = "var(--text-muted)";
      searchBtn.style.fontSize = "12px";
      searchBtn.title = "Search for a command";
      searchBtn.onclick = () => {
        new CommandSuggestModal(this.app, (command) => {
          labelInput.value = command.name;
          cmdInput.value = command.id;
          list[index].label = command.name;
          list[index].commandId = command.id;
          this.plugin.saveSettings();
        }).open();
      };

      const removeBtn = row.createEl("button");
      removeBtn.textContent = "×";
      removeBtn.style.background = "transparent";
      removeBtn.style.border = "none";
      removeBtn.style.cursor = "pointer";
      removeBtn.style.color = "var(--text-muted)";
      removeBtn.onclick = async () => {
        const updated = [
          ...list.slice(0, index),
          ...list.slice(index + 1),
        ];
        for (let j = 0; j < updated.length; j++) {
          list[j] = updated[j];
        }
        list.length = updated.length;
        await this.plugin.saveSettings();
        renderSubmenus.call(this);
        renderMainCommands.call(this);
        renderArchived.call(this);
      };

      labelInput.onchange = async () => {
        list[index].label = labelInput.value;
        await this.plugin.saveSettings();
      };
      cmdInput.onchange = async () => {
        list[index].commandId = cmdInput.value;
        await this.plugin.saveSettings();
      };
    }

    renderSubmenus.call(this);
    renderMainCommands.call(this);
  }
}
