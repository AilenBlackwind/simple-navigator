import { App, FuzzySuggestModal, FuzzyMatch, Command, TFolder, TFile } from "obsidian";
import { ICON_LIST } from "./generated/icon-list";
import { CUSTOM_ICON_PREFIX, setCustomIcon, cachedCustomItems } from "./icon-utils";

export class CommandSuggestModal extends FuzzySuggestModal<Command> {
  private onSelect: (command: Command) => void;

  constructor(app: App, onSelect: (command: Command) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Type to search for a command...");
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "Navigate" },
      { command: "\u21B5", purpose: "Select command" },
      { command: "esc", purpose: "Close" },
    ]);
  }

  getItems(): Command[] {
    return this.app.commands.listCommands();
  }

  getItemText(command: Command): string {
    return command.name;
  }

  onChooseItem(command: Command): void {
    this.onSelect(command);
  }
}

export class IconSuggestModal extends FuzzySuggestModal<string> {
  private onSelect: (icon: string) => void;

  constructor(app: App, customIconsFolder: string, onSelect: (icon: string) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Type to search for an icon...");
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "Navigate" },
      { command: "\u21B5", purpose: "Select icon" },
      { command: "esc", purpose: "Close" },
    ]);
  }

  getItems(): string[] {
    return [...ICON_LIST, ...cachedCustomItems];
  }

  getItemText(icon: string): string {
    if (icon.startsWith(CUSTOM_ICON_PREFIX)) {
      return icon.slice(CUSTOM_ICON_PREFIX.length).replace(/\.svg$/i, "");
    }
    return icon;
  }

  renderSuggestion(item: FuzzyMatch<string>, el: HTMLElement): void {
    const icon = item.item;
    const wrapper = el.createSpan({ cls: "sn-icon-suggestion" });
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "8px";
    const iconEl = wrapper.createSpan();
    iconEl.style.width = "16px";
    iconEl.style.height = "16px";
    iconEl.style.flexShrink = "0";
    iconEl.style.overflow = "hidden";
    iconEl.style.display = "flex";
    iconEl.style.alignItems = "center";
    iconEl.style.justifyContent = "center";
    setCustomIcon(iconEl, icon, this.app);
    wrapper.createSpan({ text: this.getItemText(icon) });
  }

  onChooseItem(icon: string): void {
    this.onSelect(icon);
  }
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private onSelect: (folder: TFolder) => void;

  constructor(app: App, onSelect: (folder: TFolder) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Type to search for a folder...");
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "Navigate" },
      { command: "\u21B5", purpose: "Select folder" },
      { command: "esc", purpose: "Close" },
    ]);
  }

  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
  }

  getItemText(folder: TFolder): string {
    return folder.path || "(root)";
  }

  onChooseItem(folder: TFolder): void {
    this.onSelect(folder);
  }
}