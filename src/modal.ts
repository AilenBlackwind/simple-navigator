import { App, FuzzySuggestModal, FuzzyMatch, Command, TFolder, TFile, Modal, setIcon } from "obsidian";
import { ICON_LIST } from "./generated/icon-list";
import { CUSTOM_ICON_PREFIX, customSvgContent, setCustomIcon } from "./utils";

let cachedCustomItems: string[] = [];

export async function refreshCustomIcons(app: App, folderPath: string) {
  cachedCustomItems = [];
  customSvgContent.clear();
  if (!folderPath) return;
  try {
    const adapter = app.vault.adapter;
    const exists = await adapter.exists(folderPath);
    if (!exists) return;

    const walk = async (dir: string) => {
      const entries = await adapter.list(dir);
      for (const filePath of entries.files) {
        if (filePath.toLowerCase().endsWith(".svg")) {
          const svg = await adapter.read(filePath);
          const key = `${CUSTOM_ICON_PREFIX}${filePath}`;
          cachedCustomItems.push(key);
          customSvgContent.set(key, svg);
        }
      }
      for (const sub of entries.folders) {
        await walk(sub);
      }
    };

    await walk(folderPath);
  } catch {}
}

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

export function showConfirmModal(
  app: App,
  title: string,
  description: string | DocumentFragment,
  confirmText?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, title, description, confirmText || "Delete", resolve);
    modal.open();
  });
}

export class ConfirmModal extends Modal {
  private titleText: string;
  private desc: string | DocumentFragment;
  private confirmText: string;
  private resolve: (value: boolean) => void;

  constructor(
    app: App,
    titleText: string,
    desc: string | DocumentFragment,
    confirmText: string,
    resolve: (value: boolean) => void
  ) {
    super(app);
    this.titleText = titleText;
    this.desc = desc;
    this.confirmText = confirmText;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const headerDiv = contentEl.createDiv({ cls: "modal-header" });
    const iconEl = headerDiv.createSpan();
    setIcon(iconEl, "trash-2");
    iconEl.style.marginRight = "8px";
    iconEl.style.color = "var(--color-red)";
    headerDiv.createEl("h2", { text: this.titleText });

    if (typeof this.desc === "string") {
      contentEl.createEl("p", { text: this.desc });
    } else {
      contentEl.appendChild(this.desc);
    }

    const buttonDiv = contentEl.createDiv({ cls: "modal-button-container" });
    buttonDiv.style.display = "flex";
    buttonDiv.style.justifyContent = "flex-end";
    buttonDiv.style.gap = "8px";
    buttonDiv.style.marginTop = "24px";

    const cancelBtn = buttonDiv.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const deleteBtn = buttonDiv.createEl("button", {
      text: this.confirmText,
      cls: "mod-warning",
    });
    deleteBtn.onclick = () => {
      this.resolve(true);
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
    this.resolve(false);
  }
}
