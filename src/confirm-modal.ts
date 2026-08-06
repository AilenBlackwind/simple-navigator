import { App, Modal, setIcon } from "obsidian";

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
  private resolved = false;

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
      this.resolved = true;
      this.resolve(true);
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(false);
  }
}
