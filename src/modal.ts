import { App, FuzzySuggestModal, FuzzyMatch, Command, TFolder, setIcon } from "obsidian";

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

const ICON_LIST = [
  "file", "file-text", "file-plus", "file-minus", "file-search",
  "folder", "folder-open", "folder-plus", "folder-minus",
  "home", "search", "settings", "cog", "bell", "bookmark",
  "star", "heart", "flame", "flag", "award",
  "book", "book-open", "bookmark", "code", "terminal",
  "feather", "globe", "anchor", "compass", "map", "map-pin",
  "image", "music", "video", "camera", "film",
  "edit", "pencil", "pen-tool", "eraser", "scissors",
  "check", "check-circle", "check-square", "x", "x-circle", "x-square",
  "plus", "plus-circle", "plus-square", "minus", "minus-circle",
  "trash", "trash-2", "archive", "inbox", "mail",
  "copy", "clipboard", "save", "printer", "share", "share-2",
  "link", "link-2", "external-link", "paperclip", "hash",
  "lock", "unlock", "key", "shield", "shield-off",
  "eye", "eye-off", "search", "zoom-in", "zoom-out",
  "sun", "moon", "sunrise", "sunset", "lightbulb",
  "cloud", "cloud-drizzle", "cloud-snow", "cloud-rain", "cloud-lightning",
  "circle", "square", "triangle", "hexagon", "diamond",
  "arrow-up", "arrow-down", "arrow-left", "arrow-right",
  "chevron-up", "chevron-down", "chevron-left", "chevron-right",
  "chevrons-up", "chevrons-down", "chevrons-left", "chevrons-right",
  "move", "maximize", "minimize", "expand", "collapse",
  "list", "grid", "columns", "rows", "table",
  "menu", "more-horizontal", "more-vertical", "sidebar",
  "panel-left", "panel-right", "panel-top", "panel-bottom",
  "alert-circle", "alert-triangle", "help-circle", "info", "question-mark",
  "refresh-cw", "refresh-ccw", "rotate-cw", "rotate-ccw", "sync",
  "download", "upload", "log-in", "log-out", "user",
  "users", "user-plus", "user-minus", "user-check", "user-x",
  "at-sign", "mail", "message-circle", "message-square", "send",
  "phone", "smartphone", "tablet", "monitor", "tv",
  "clock", "timer", "calendar", "watch", "alarm-clock",
  "wifi", "wifi-off", "bluetooth", "signal", "cast",
  "battery", "battery-charging", "power", "plug", "zap",
  "database", "server", "hard-drive", "cpu", "layers",
  "git-branch", "git-commit", "git-merge", "git-pull-request", "github",
  "heading", "bold", "italic", "underline", "type",
  "palette", "brush", "droplet", "paintbrush", "swatch-book",
  "target", "crosshair", "ruler", "compass", "navigation", "navigation-2",
  "volume", "volume-1", "volume-2", "volume-x", "headphones", "speaker",
  "mic", "mic-off", "radio", "disc", "music",
  "play", "pause", "stop-circle", "rewind", "fast-forward",
  "shuffle", "repeat", "skip-back", "skip-forward",
  "percent", "hash", "at-sign", "slash", "bar-chart", "pie-chart",
  "trending-up", "trending-down", "activity", "sliders",
];

export class IconSuggestModal extends FuzzySuggestModal<string> {
  private onSelect: (icon: string) => void;

  constructor(app: App, onSelect: (icon: string) => void) {
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
    return ICON_LIST;
  }

  getItemText(icon: string): string {
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
    setIcon(iconEl, icon);
    wrapper.createSpan({ text: icon });
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
