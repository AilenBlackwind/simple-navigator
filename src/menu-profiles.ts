import type { App, Menu, TAbstractFile } from "obsidian";
import type { MenuProfile, PluginSettings, SubmenuEntry } from "./settings";

export const NAVIGATOR_MENU_ACTIONS = [
  { id: "move", label: "Move to folder" },
  { id: "hide", label: "Hide / unhide" },
  { id: "archive", label: "Archive / unarchive folder" },
  { id: "color", label: "Change color" },
  { id: "icon", label: "Change icon" },
  { id: "collapse-icons", label: "Folder collapse icons" },
] as const;

export type NavigatorMenuAction = typeof NAVIGATOR_MENU_ACTIONS[number]["id"];

export function createMenuProfile(name = "New menu"): MenuProfile {
  return {
    name, modifiers: { alt: false, ctrl: false, shift: true, meta: false },
    actions: [], submenus: {}, submenuIcons: {}, mainMenuCommands: [],
  };
}

export function migrateMenuProfiles(settings: PluginSettings, hasSavedProfiles: boolean): void {
  if (hasSavedProfiles) return;
  const profile = createMenuProfile("Navigator");
  profile.actions = NAVIGATOR_MENU_ACTIONS.map(action => action.id);
  // Keep the legacy fields intact as well, so an older plugin can still read them.
  profile.submenus = JSON.parse(JSON.stringify(settings.submenus));
  profile.submenuIcons = { ...settings.submenuIcons };
  profile.mainMenuCommands = settings.mainMenuCommands.map(entry => ({ ...entry }));
  settings.menuProfiles = [profile];
}

export function ensureAltNavigatorMenu(settings: PluginSettings): boolean {
  if (settings.navigatorAltMenuVersion >= 1) return false;
  const modifiers = { alt: true, ctrl: false, shift: false, meta: false };
  let profile = settings.menuProfiles.find(menu => sameMenuModifiers(menu.modifiers, modifiers));
  if (!profile) {
    profile = createMenuProfile("Navigator actions");
    profile.modifiers = modifiers;
    settings.menuProfiles.push(profile);
  }
  profile.actions = [...new Set([...profile.actions, ...NAVIGATOR_MENU_ACTIONS.map(action => action.id)])];
  settings.navigatorAltMenuVersion = 1;
  return true;
}

export function hasMenuModifiers(modifiers: MenuProfile["modifiers"]): boolean {
  return modifiers.alt || modifiers.ctrl || modifiers.shift || modifiers.meta;
}

export function matchingMenuProfile(event: MouseEvent, profiles: MenuProfile[]): MenuProfile | undefined {
  return profiles.find(profile => hasMenuModifiers(profile.modifiers)
    && event.altKey === profile.modifiers.alt && event.ctrlKey === profile.modifiers.ctrl
    && event.shiftKey === profile.modifiers.shift && event.metaKey === profile.modifiers.meta);
}

export function sameMenuModifiers(a: MenuProfile["modifiers"], b: MenuProfile["modifiers"]): boolean {
  return a.alt === b.alt && a.ctrl === b.ctrl && a.shift === b.shift && a.meta === b.meta;
}

export function appendProfileCommands(menu: Menu, profile: MenuProfile, app: App, file: TAbstractFile | null): number {
  let added = 0;
  const commandApp = app as App & {
    plugins: { plugins: Record<string, { setLastClicked(file: TAbstractFile | null): void }> };
    commands: { executeCommandById(id: string): boolean };
  };
  const addEntries = (target: Menu, entries: SubmenuEntry[]) => {
    let count = 0;
    let separatorPending = false;
    for (const command of entries) {
      if (command.isSeparator) { separatorPending = count > 0; continue; }
      if (!command.commandId) continue;
      if (separatorPending) target.addSeparator();
      separatorPending = false;
      target.addItem(item => {
        item.setTitle(command.label).onClick(() => {
          commandApp.plugins.plugins["simple-navigator"]?.setLastClicked(file);
          commandApp.commands.executeCommandById(command.commandId);
        });
        if (command.icon) item.setIcon(command.icon);
      });
      count++;
    }
    return count;
  };
  for (const [name, entries] of Object.entries(profile.submenus)) {
    if (!entries.some(entry => !entry.isSeparator && entry.commandId)) continue;
    menu.addItem(item => {
      item.setTitle(name);
      if (profile.submenuIcons[name]) item.setIcon(profile.submenuIcons[name]);
      const submenu = (item as typeof item & { setSubmenu(): Menu }).setSubmenu();
      addEntries(submenu, entries);
    });
    added++;
  }
  added += addEntries(menu, profile.mainMenuCommands);
  return added;
}
