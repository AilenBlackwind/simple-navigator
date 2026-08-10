import { App, FuzzySuggestModal, FuzzyMatch, Command, TFolder, TAbstractFile, renderMatches } from "obsidian";
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

export class MoveToModal extends FuzzySuggestModal<TFolder> {
  private onSelect: (folder: TFolder) => void;
  private excludes: Set<string>;
  private targetPath: string;

  constructor(app: App, target: TAbstractFile, onSelect: (folder: TFolder) => void) {
    super(app);
    this.onSelect = onSelect;
    this.targetPath = target.path;
    this.excludes = new Set<string>();
    if (target.parent) this.excludes.add(target.parent.path);
    if (target instanceof TFolder) {
      this.excludes.add(target.path);
    }
    this.setPlaceholder("Type a folder name to move to...");
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "Navigate" },
      { command: "\u21B5", purpose: "Move here" },
      { command: "esc", purpose: "Cancel" },
    ]);
  }

  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => {
      if (!(f instanceof TFolder)) return false;
      if (this.excludes.has(f.path)) return false;
      if (f.path === this.targetPath) return false;
      if (f.path.startsWith(this.targetPath + "/")) return false;
      return true;
    });
  }

  getItemText(folder: TFolder): string {
    return folder.name || "(root)";
  }

  renderSuggestion(item: FuzzyMatch<TFolder>, el: HTMLElement): void {
    const folder = item.item;
    const name = folder.name || "(root)";
    const nameEl = el.createDiv({ cls: "suggestion-title" });
    renderMatches(nameEl, name, item.match.matches);
    const parentPath = folder.parent ? folder.parent.path : "";
    if (parentPath) {
      const pathEl = el.createDiv({ cls: "suggestion-note" });
      pathEl.setText(parentPath);
      pathEl.style.opacity = "0.55";
      pathEl.style.fontSize = "var(--font-ui-small)";
      pathEl.style.color = "var(--text-muted)";
      pathEl.style.marginTop = "1px";
    }
  }

  onChooseItem(folder: TFolder): void {
    this.onSelect(folder);
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