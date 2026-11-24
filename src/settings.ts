import { PluginSettingTab, Setting, App, Notice, setIcon } from "obsidian";
import { listCommands, CommandSuggestModal, IconSuggestModal, FolderSuggestModal } from "./modal";
import { setCustomIcon, refreshCustomIcons } from "./icon-utils";
import type SimpleNavigatorPlugin from "./main";
import { createMenuProfile, NAVIGATOR_MENU_ACTIONS, hasMenuModifiers, sameMenuModifiers } from "./menu-profiles";
import type { NavigatorMenuAction } from "./menu-profiles";

export interface MenuProfile {
  name: string;
  modifiers: { alt: boolean; ctrl: boolean; shift: boolean; meta: boolean };
  actions: NavigatorMenuAction[];
  submenus: Record<string, SubmenuEntry[]>;
  submenuIcons: Record<string, string>;
  mainMenuCommands: SubmenuEntry[];
}

export interface SubmenuEntry {
  label: string;
  commandId: string;
  commandName?: string;
  icon?: string;
  isSeparator?: boolean;
}

export type NavigatorSort = "manual" | "name-asc" | "name-desc";

export interface PluginSettings {
  orderMap: Record<string, string[]>;
  sortMode: NavigatorSort;
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
  submenuIcons: Record<string, string>;
  mainMenuCommands: SubmenuEntry[];
  newMenuCommands: SubmenuEntry[];
  customIconsFolder: string;
  confirmDelete: boolean;
  menuProfiles: MenuProfile[];
  navigatorAltMenuVersion: number;
  newNoteLocation: "obsidian" | "root" | "current" | "folder";
  newNoteFolder: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  orderMap: {},
  sortMode: "manual",
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
  submenuIcons: {},
  mainMenuCommands: [],
  newMenuCommands: [],
  customIconsFolder: "",
  confirmDelete: true,
  menuProfiles: [],
  navigatorAltMenuVersion: 0,
  newNoteLocation: "obsidian",
  newNoteFolder: "",
};

export class SimpleNavigatorSettingTab extends PluginSettingTab {
  plugin: SimpleNavigatorPlugin;
  private selectedMenuIndex = 0;

  constructor(app: App, plugin: SimpleNavigatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Simple Navigator Settings" });

    new Setting(containerEl)
      .setName("Default location for new notes")
      .setDesc("Used by New note on empty space in the navigator. Right-clicking a folder always creates the note inside that folder. New folders and script commands use their own rules.")
      .addDropdown(dropdown => dropdown
        .addOption("obsidian", "Follow Obsidian settings")
        .addOption("root", "Vault root")
        .addOption("current", "Same folder as current note")
        .addOption("folder", "Specified folder")
        .setValue(this.plugin.settings.newNoteLocation)
        .onChange(async value => {
          this.plugin.settings.newNoteLocation = value as PluginSettings["newNoteLocation"];
          await this.plugin.saveSettings();
          this.display();
        }));
    if (this.plugin.settings.newNoteLocation === "folder") {
      new Setting(containerEl)
        .setName("Folder for new notes")
        .setDesc(this.plugin.settings.newNoteFolder || "/ (vault root)")
        .addButton(button => button.setButtonText("Choose folder").onClick(() => {
          new FolderSuggestModal(this.app, async folder => {
            this.plugin.settings.newNoteFolder = folder.path === "/" ? "" : folder.path;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        }));
    }

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
      .setName("Custom SVG icons folder")
      .setDesc(
        "Path to a folder in your vault containing .svg files. Icons will appear in the icon search by filename. Leave empty to disable."
      )
      .addText((text) =>
        text
          .setPlaceholder("path/to/icons")
          .setValue(this.plugin.settings.customIconsFolder)
          .onChange(async (value) => {
            this.plugin.settings.customIconsFolder = value;
            await this.plugin.saveSettings();
            refreshCustomIcons(this.app, value);
          })
      );

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

    // --- Deletion ---
    containerEl.createEl("h3", { text: "Deletion" });

    new Setting(containerEl)
      .setName("Confirm before deleting")
      .setDesc(
        "Show a confirmation dialog before deleting files and folders."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.confirmDelete)
          .onChange(async (value) => {
            this.plugin.settings.confirmDelete = value;
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
            const orderMap = { ...this.plugin.settings.orderMap };
            delete orderMap[folder.path];
            this.plugin.settings.archivedPaths = [
              ...this.plugin.settings.archivedPaths,
              folder.path,
            ];
            this.plugin.settings.orderMap = orderMap;
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

    containerEl.createEl("h3", { text: "Additional context menus" });
    containerEl.createEl("p", {
      text: "Plain right-click always opens the basic menu. Each additional menu has its own exact Ctrl / Alt / Shift / Meta combination, navigator actions, commands, and submenus. Unassigned combinations open the basic menu.",
      cls: "setting-item-description",
    });
    const profiles = this.plugin.settings.menuProfiles;
    this.selectedMenuIndex = Math.max(0, Math.min(this.selectedMenuIndex, profiles.length - 1));
    const profilePicker = new Setting(containerEl).setName("Menu profile");
    if (profiles.length > 0) profilePicker.addDropdown(dropdown => {
      profiles.forEach((entry, index) => dropdown.addOption(String(index), entry.name || "Unnamed menu"));
      dropdown.setValue(String(this.selectedMenuIndex)).onChange(value => {
        this.selectedMenuIndex = Number(value);
        this.display();
      });
    });
    profilePicker.addButton(button => button.setButtonText("Add menu").onClick(async () => {
      const next = createMenuProfile();
      // Prefer simple single-key combinations, then combinations of several keys.
      const masks = [1, 2, 4, 8, ...Array.from({ length: 15 }, (_, index) => index + 1)];
      next.modifiers = { alt: false, ctrl: false, shift: false, meta: false };
      for (const mask of masks) {
        const modifiers = { shift: !!(mask & 1), alt: !!(mask & 2), ctrl: !!(mask & 4), meta: !!(mask & 8) };
        if (!profiles.some(existing => sameMenuModifiers(existing.modifiers, modifiers))) {
          next.modifiers = modifiers;
          break;
        }
      }
      profiles.push(next);
      this.selectedMenuIndex = profiles.length - 1;
      await this.plugin.saveSettings();
      this.display();
    }));
    const profile = profiles[this.selectedMenuIndex];
    const profileEditor = containerEl.createDiv({ cls: "sn-profile-editor" });
    if (profile) {
      new Setting(profileEditor).setName("Menu name").addText(text => text.setValue(profile.name).onChange(async value => {
        profile.name = value;
        await this.plugin.saveSettings();
      })).addButton(button => button.setButtonText("Remove menu").onClick(async () => {
        this.plugin.settings.menuProfiles = profiles.filter(entry => entry !== profile);
        await this.plugin.saveSettings();
        this.display();
      }));
      const modifierRow = new Setting(profileEditor).setName("Hold while right-clicking");
      modifierRow.controlEl.style.flexWrap = "wrap";
      modifierRow.controlEl.style.gap = "6px";
      const warning = profileEditor.createDiv({ cls: "setting-item-description" });
      const updateWarning = () => {
        warning.textContent = hasMenuModifiers(profile.modifiers) ? "" : "Choose at least one key to enable this menu. Plain right-click is reserved for the basic menu.";
      };
      for (const [key, label] of [["ctrl", "Ctrl"], ["alt", "Alt"], ["shift", "Shift"], ["meta", "Meta / Command"]] as const) {
        modifierRow.addToggle(toggle => {
          toggle.setTooltip(label).setValue(profile.modifiers[key]).onChange(async value => {
            const next = { ...profile.modifiers, [key]: value };
            if (hasMenuModifiers(next) && profiles.some(other => other !== profile && sameMenuModifiers(other.modifiers, next))) {
              toggle.setValue(!value);
              new Notice("This key combination is already assigned to another menu");
              return;
            }
            profile.modifiers = next;
            updateWarning();
            await this.plugin.saveSettings();
          });
          const labelEl = modifierRow.controlEl.createSpan({ text: label });
          labelEl.style.marginRight = "12px";
        });
      }
      updateWarning();
      profileEditor.createEl("h4", { text: "Navigator actions" });
      for (const action of NAVIGATOR_MENU_ACTIONS) {
        new Setting(profileEditor).setName(action.label).addToggle(toggle => toggle.setValue(profile.actions.includes(action.id)).onChange(async value => {
          profile.actions = value ? [...profile.actions, action.id] : profile.actions.filter(id => id !== action.id);
          await this.plugin.saveSettings();
        }));
      }
    } else {
      profileEditor.createEl("p", { text: "No additional menus configured. Use Add menu to create one." });
    }

    // --- Submenus ---
    if (profile) profileEditor.createEl("h4", { text: "Submenus" });
    profileEditor.createEl("p", {
      text: "Named submenus shown in the context menu. Each contains a list of commands.",
      cls: "setting-item-description",
    });

    const commandNames = new Map(listCommands(this.app)
      .map(({ id, name }) => [id, name]));
    const submenuSection = profileEditor.createDiv({ cls: "sn-command-settings" });
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
        if (profile.submenus[name]) return;
        profile.submenus = {
          ...profile.submenus,
          [name]: [],
        };
        await this.plugin.saveSettings();
        nameInput.value = "";
        renderSubmenus.call(this);
      };

      renderSubmenuSections.call(this);
    }

    function renderSubmenuSections(this: SimpleNavigatorSettingTab) {
      const existing = submenuSection.querySelectorAll(".sn-submenu-section");
      for (const el of existing) el.remove();

      for (const [sectionName, entries] of Object.entries(profile.submenus)) {


        const sectionDiv = submenuSection.createDiv();
        sectionDiv.className = "sn-submenu-section";
        sectionDiv.style.marginBottom = "8px";
        sectionDiv.style.border = "1px solid var(--background-modifier-border)";
        sectionDiv.style.borderRadius = "4px";
        sectionDiv.style.padding = "8px";

        const headerRow = sectionDiv.createDiv();
        headerRow.style.display = "flex";
        headerRow.style.gap = "8px";
        headerRow.style.alignItems = "center";
        headerRow.style.marginBottom = "8px";

        const sectionIconBtn = action(headerRow, "", "Choose section icon");
        const renderSectionIcon = () => {
          sectionIconBtn.empty();
          const icon = profile.submenuIcons[sectionName];
          if (icon) {
            setCustomIcon(sectionIconBtn, icon, this.app);
          } else {
            sectionIconBtn.setText("?");
          }
        };
        renderSectionIcon();
        sectionIconBtn.onclick = () => {
          new IconSuggestModal(this.app, this.plugin.settings.customIconsFolder ?? "", (iconName) => {
            profile.submenuIcons = {
              ...profile.submenuIcons,
              [sectionName]: iconName,
            };
            renderSectionIcon();
            this.plugin.saveSettings();
          }).open();
        };

        const headerTitle = headerRow.createEl("span");
        headerTitle.textContent = sectionName;
        headerTitle.style.fontWeight = "bold";
        headerTitle.style.flex = "1";

        const removeSectionBtn = action(headerRow, "trash-2", "Remove section");
        removeSectionBtn.onclick = async () => {
          const next = { ...profile.submenus };
          delete next[sectionName];
          profile.submenus = next;
          await this.plugin.saveSettings();
          renderSubmenuSections.call(this);
        };

        const entriesDiv = sectionDiv.createDiv();

        for (let i = 0; i < entries.length; i++) {
          renderEntryRow.call(this, entriesDiv, entries, i, () => renderSubmenuSections.call(this));
        }

        const addEntryRow = sectionDiv.createDiv();
        addEntryRow.style.marginTop = "4px";
        addEntryRow.style.display = "flex";
        addEntryRow.style.gap = "8px";

        addCommand.call(this, addEntryRow, entries, () => renderSubmenuSections.call(this));

        const addSepBtn = addEntryRow.createEl("button");
        addSepBtn.textContent = "+ Separator";
        addSepBtn.onclick = async () => {
          entries.push({ label: "", commandId: "", isSeparator: true });
          profile.submenus = { ...profile.submenus };
          await this.plugin.saveSettings();
          renderSubmenuSections.call(this);
        };
      }
    }

    // --- Main menu commands ---
    if (profile) profileEditor.createEl("h4", { text: "Menu commands" });
    profileEditor.createEl("p", {
      text: "Commands shown in this profile, outside any submenu.",
      cls: "setting-item-description",
    });

    const mainDesc = profileEditor.createDiv({ cls: "sn-command-settings" });
    mainDesc.style.marginBottom = "8px";

    function renderMainCommands() {
      mainDesc.empty();
      const list = profile.mainMenuCommands;

      for (let i = 0; i < list.length; i++) {
        renderEntryRow.call(this, mainDesc, list, i, () => renderMainCommands.call(this));
      }

      const addRow = mainDesc.createDiv();
      addRow.style.marginTop = "8px";
      addRow.style.display = "flex";
      addRow.style.gap = "8px";

      addCommand.call(this, addRow, list, () => renderMainCommands.call(this));

      const addSepBtn = addRow.createEl("button");
      addSepBtn.textContent = "+ Separator";
      addSepBtn.onclick = async () => {
        profile.mainMenuCommands = [
          ...profile.mainMenuCommands,
          { label: "", commandId: "", isSeparator: true },
        ];
        await this.plugin.saveSettings();
        renderMainCommands.call(this);
      };
    }

    function action(parent: HTMLElement, icon: string, title: string): HTMLButtonElement {
      const button = parent.createEl("button", {
        cls: "sn-cmd-entry-action",
        attr: { type: "button", title, "aria-label": title },
      });
      if (icon) setIcon(button, icon);
      return button;
    }

    function addCommand(this: SimpleNavigatorSettingTab, parent: HTMLElement, list: SubmenuEntry[], render: () => void) {
      const button = parent.createEl("button", { text: "+ Add command" });
      button.onclick = () => new CommandSuggestModal(this.app, async ({ id, name }) => {
        commandNames.set(id, name);
        list.push({ label: name, commandId: id, commandName: name });
        await this.plugin.saveSettings();
        render();
      }).open();
    }

    function renderEntryRow(
      this: SimpleNavigatorSettingTab,
      container: HTMLElement,
      list: SubmenuEntry[],
      index: number,
      render: () => void
    ): void {
      const entry = list[index];
      const row = container.createDiv({ cls: entry.isSeparator ? "sn-cmd-entry-row sn-cmd-entry-separator" : "sn-cmd-entry-row" });
      const order = row.createDiv({ cls: "sn-cmd-entry-controls" });

      for (const [offset, title] of [[-1, "Move up"], [1, "Move down"]] as const) {
        const button = action(order, offset < 0 ? "chevron-up" : "chevron-down", title);
        const next = index + offset;
        button.disabled = next < 0 || next >= list.length;
        button.onclick = async () => {
          [list[index], list[next]] = [list[next], list[index]];
          await this.plugin.saveSettings();
          render();
        };
      }

      const details = row.createDiv({ cls: "sn-cmd-entry-details" });
      const controls = row.createDiv({ cls: "sn-cmd-entry-controls" });

      if (entry.isSeparator) {
        details.createDiv({ cls: "sn-cmd-entry-separator-line", attr: { role: "separator" } });
      } else {
        const labelButton = details.createEl("button", {
          cls: "sn-cmd-entry-label",
          attr: { type: "button" },
        });
        const description = details.createDiv({ cls: "sn-cmd-entry-description sn-cmd-entry-command-name" });
        const renderLabel = () => {
          const name = commandNames.get(entry.commandId);
          const original = name ?? entry.commandName;
          const label = entry.label || original || "Menu label";
          const distinctName = original && original.trim() !== label.trim() ? original : "";
          const status = name ? "" : entry.commandId ? "Command unavailable" : "No command selected";
          const subtitle = [distinctName, status].filter(Boolean).join(" · ");
          labelButton.setText(label);
          labelButton.title = label + " — click to edit";
          labelButton.setAttribute("aria-label", "Edit menu label: " + label);
          description.setText(subtitle);
          description.title = subtitle;
          description.hidden = !subtitle;
        };
        renderLabel();

        labelButton.onclick = () => {
          labelButton.hidden = true;
          const input = details.createEl("input", {
            type: "text",
            cls: "sn-cmd-entry-label-input",
            attr: { "aria-label": "Menu label", placeholder: "Menu label" },
          });
          details.insertBefore(input, description);
          input.value = entry.label;

          const finish = (save: boolean, restoreFocus: boolean) => {
            if (!labelButton.hidden) return;
            labelButton.hidden = false;
            input.remove();
            if (restoreFocus) labelButton.focus();
            if (!save || input.value === entry.label) return;
            entry.label = input.value;
            renderLabel();
            void this.plugin.saveSettings();
          };

          input.onblur = () => finish(true, false);
          input.onkeydown = (event) => {
            if (event.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return;
            event.preventDefault();
            event.stopPropagation();
            finish(event.key === "Enter", true);
          };
          input.focus();
          input.select();
        };

        const iconBtn = action(controls, "", "Choose icon");
        const renderIcon = () => {
          if (entry.icon) setCustomIcon(iconBtn, entry.icon, this.app);
          if (!iconBtn.querySelector("svg")) iconBtn.setText("?");
        };
        renderIcon();
        iconBtn.onclick = () => {
          new IconSuggestModal(this.app, this.plugin.settings.customIconsFolder ?? "", async (iconName) => {
            entry.icon = iconName;
            renderIcon();
            await this.plugin.saveSettings();
          }).open();
        };

        const replaceCommand = action(controls, "search", "Change command");
        replaceCommand.onclick = () => {
          new CommandSuggestModal(this.app, async ({ id, name }) => {
            const previousName = commandNames.get(entry.commandId) ?? entry.commandName;
            if (!entry.commandId || !entry.label || entry.label === previousName) {
              entry.label = name;
            }
            entry.commandId = id;
            entry.commandName = name;
            commandNames.set(id, name);
            renderLabel();
            await this.plugin.saveSettings();
          }).open();
        };
      }

      const remove = action(controls, "trash-2", entry.isSeparator ? "Remove separator" : "Remove command");
      remove.onclick = async () => {
        list.splice(index, 1);
        await this.plugin.saveSettings();
        render();
      };
    }

    // --- New menu commands ---
    containerEl.createEl("h3", { text: "New menu commands" });
    containerEl.createEl("p", {
      text: "Commands shown in the \"New...\" submenu, right after \"New note\" and \"New folder\" in the context menu.",
      cls: "setting-item-description",
    });

    const newDesc = containerEl.createDiv({ cls: "sn-command-settings" });
    newDesc.style.marginBottom = "8px";

    function renderNewCommands() {
      newDesc.empty();
      const list = this.plugin.settings.newMenuCommands;

      for (let i = 0; i < list.length; i++) {
        renderEntryRow.call(this, newDesc, list, i, () => renderNewCommands.call(this));
      }

      const addRow = newDesc.createDiv();
      addRow.style.marginTop = "8px";
      addRow.style.display = "flex";
      addRow.style.gap = "8px";

      addCommand.call(this, addRow, list, () => renderNewCommands.call(this));

      const addSepBtn = addRow.createEl("button");
      addSepBtn.textContent = "+ Separator";
      addSepBtn.onclick = async () => {
        this.plugin.settings.newMenuCommands = [
          ...this.plugin.settings.newMenuCommands,
          { label: "", commandId: "", isSeparator: true },
        ];
        await this.plugin.saveSettings();
        renderNewCommands.call(this);
      };
    }

    renderNewCommands.call(this);
    if (profile) {
      renderSubmenus.call(this);
      renderMainCommands.call(this);
    }
  }
}
