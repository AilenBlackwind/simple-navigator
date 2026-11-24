const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
class TFile {
  constructor(filePath) {
    this.path = filePath;
    this.name = filePath.split('/').pop();
    this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    this.basename = this.extension ? this.name.slice(0, -this.extension.length - 1) : this.name;
    this.parent = null;
  }
}
class TFolder {
  constructor(folderPath, children = []) {
    this.path = folderPath;
    this.name = folderPath.split('/').pop();
    this.children = children;
    this.parent = null;
    for (const child of children) child.parent = this;
  }
}
class MarkdownView {}
const notices = [];
class Notice { constructor(text) { notices.push(text); } }
const obsidian = { TFile, TFolder, MarkdownView, Notice, normalizePath: p => p.replace(/^\/+|\/+$/g, '') };
const plain = value => JSON.parse(JSON.stringify(value));
const quietConsole = { error() {}, warn() {}, log() {} };
const source = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const transpile = text => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
function load(file, modules = {}, globals = {}) {
  const context = { ...globals, exports: {}, console: quietConsole, require(name) {
    if (name === 'obsidian') return obsidian;
    if (name in modules) return modules[name];
    throw new Error('Unexpected dependency: ' + name);
  } };
  vm.runInNewContext(transpile(source(file)), context, { filename: file });
  return context.exports;
}
const utils = load('src/utils.ts');
const drag = load('src/drag-state.ts');
const menuProfiles = load('src/menu-profiles.ts');

test('alphabetical views keep folders first and returning to Manual restores the saved order', () => {
  const a = new TFile('A.md'), z = new TFile('Z.md'), b = new TFolder('B'), c = new TFolder('C');
  const children = [a, z, b, c];
  const order = { '': ['Z.md', 'A.md', 'C', 'B'] };
  const names = mode => plain(utils.sortWithOrder(children, order, '', 0, mode).map(item => item.name));
  assert.deepEqual(names('name-asc'), ['B', 'C', 'A.md', 'Z.md']);
  assert.deepEqual(names('name-desc'), ['C', 'B', 'Z.md', 'A.md']);
  assert.deepEqual(names('manual'), order['']);
});

test('an expanded folder accepts drops in its title center and keeps sibling insertion at both edges', () => {
  const rect = (top, bottom) => ({ top, bottom, height: bottom - top });
  const classes = new Set(['nav-folder']);
  const title = { getBoundingClientRect: () => rect(10, 30), style: { getPropertyValue: () => '' } };
  const nested = { dataset: { folderPath: 'Folder' }, children: [], offsetHeight: 70, style: { getPropertyValue: () => '24' }, getBoundingClientRect: () => rect(30, 100) };
  const folder = {
    dataset: { path: 'Folder' }, isConnected: true, getBoundingClientRect: () => rect(10, 100),
    classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) },
    querySelector: selector => selector === '.nav-folder-title' ? title : nested,
    closest: () => tree
  };
  const root = { dataset: { folderPath: '' }, children: [folder], closest: () => null, getBoundingClientRect: () => rect(0, 200) };
  folder.parentElement = root;
  const tree = { getBoundingClientRect: () => rect(0, 200), querySelectorAll: selector => selector.includes('data-folder-path') ? [root, nested] : [folder] };
  let pending;
  const { dragState, updateMoveDrop, destroyDropIndicator } = load('src/drag-state.ts', {}, {
    setTimeout: (fn, delay) => { assert.equal(delay, 600); pending = fn; return 1; },
    clearTimeout: () => { pending = undefined; },
    window: { devicePixelRatio: 1 }, document: {
      querySelectorAll: () => classes.has('sn-drop-target') ? [folder] : [], querySelector: () => null,
      createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} }
    }
  });
  const event = { clientY: 20, dataTransfer: {} };
  dragState.itemPath = 'Note.md';
  updateMoveDrop(event, tree, false);
  assert.equal(dragState.targetFolder, 'Folder');
  assert.equal(classes.has('sn-drop-target'), true);
  for (const [y, index] of [[12, 0], [27, 1]]) {
    event.clientY = y;
    updateMoveDrop(event, tree, false);
    assert.equal(dragState.targetFolder, null);
    assert.equal(dragState.newIndex, index);
    assert.equal(classes.has('sn-drop-target'), false);
  }
  updateMoveDrop(event, tree, true);
  assert.equal(event.dataTransfer.dropEffect, 'none');
  assert.equal(dragState.newIndex, -1);

  classes.add('is-collapsed');
  const opened = [];
  const expand = path => opened.push(path);
  event.clientY = 20;
  updateMoveDrop(event, tree, false, expand);
  const firstTimer = pending;
  event.clientY = 21;
  updateMoveDrop(event, tree, false, expand);
  assert.equal(pending, firstTimer);
  event.clientY = 27;
  updateMoveDrop(event, tree, false, expand);
  assert.equal(pending, undefined);
  event.clientY = 20;
  updateMoveDrop(event, tree, false, expand);
  pending();
  assert.deepEqual(opened, ['Folder']);
  updateMoveDrop(event, tree, false, expand);
  destroyDropIndicator();
  assert.equal(pending, undefined);
});
function settings() {
  return { orderMap: {}, colorMap: {}, iconMap: {}, folderCollapseIconMap: {}, hiddenPaths: [],
    collapsedPaths: [], archivedPaths: [], submenus: {}, submenuIcons: {}, mainMenuCommands: [], newMenuCommands: [], menuProfiles: [], navigatorAltMenuVersion: 1, newNoteLocation: 'obsidian', newNoteFolder: '', showHidden: false, autoReveal: false };
}
function componentScript(file) { return source(file).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]; }
function componentFunctions(file, names, globals) {
  const script = componentScript(file);
  const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true);
  const functions = names.map(name => {
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === name);
    assert.ok(node, 'Missing function ' + name);
    return node.getText(ast).replace(/^export\s+/, '');
  }).join('\n');
  const context = vm.createContext({ console: quietConsole, ...obsidian, ...globals });
  vm.runInContext(transpile(functions), context);
  return context;
}

class Menu {
  constructor() { this.items = []; }
  addItem(build) {
    const item = {
      setTitle(value) { this.title = value; return this; },
      setIcon(value) { this.icon = value; return this; },
      setWarning(value) { this.warning = value; return this; },
      setDisabled(value) { this.disabled = value; return this; },
      onClick(callback) { this.click = callback; return this; },
      setSubmenu() { this.submenu = new Menu(); return this.submenu; }
    };
    build(item); this.items.push(item); return this;
  }
  addSeparator() { this.items.push({ separator: true }); return this; }
  showAtMouseEvent() { Menu.shown = this; }
}

function mouseEvent(modifiers = {}) {
  return { altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
    preventDefault() {}, stopPropagation() {}, ...modifiers };
}

function nodeMenu(file, config, event) {
  const context = componentFunctions('src/components/TreeNode.svelte', ['handleContextMenu'], {
    file, settings: { customColors: [], ...config }, Menu,
    isFolder: file instanceof TFolder, isMultiSelected: false, targetPaths: [file.path],
    handleRename() {}, ICON_OPTIONS: [], COLOR_PRESETS: [],
    matchingMenuProfile: menuProfiles.matchingMenuProfile, appendProfileCommands: menuProfiles.appendProfileCommands,
    app: { plugins: { plugins: {} } }
  });
  context.handleContextMenu(event);
  return Menu.shown;
}

test('legacy menu migration preserves commands, icons, separators and original data', () => {
  const s = settings();
  s.submenus = { Scripts: [{ label: 'Run', commandId: 'script:run', icon: 'star' }, { isSeparator: true }] };
  s.submenuIcons = { Scripts: 'code' };
  s.mainMenuCommands = [{ label: 'Collapse', commandId: 'simple-navigator:collapse-all' }];
  s.newMenuCommands = [{ label: 'Template', commandId: 'template:new' }];
  const legacy = plain(s);
  menuProfiles.migrateMenuProfiles(s, false);
  const profile = s.menuProfiles[0];
  assert.equal(profile.name, 'Navigator');
  assert.deepEqual(plain(profile.modifiers), { shift: true, alt: false, ctrl: false, meta: false });
  assert.deepEqual(plain(profile.submenus), legacy.submenus);
  assert.deepEqual(plain(profile.submenuIcons), legacy.submenuIcons);
  assert.deepEqual(plain(profile.mainMenuCommands), legacy.mainMenuCommands);
  assert.deepEqual(plain(s.newMenuCommands), legacy.newMenuCommands);
  profile.submenus.Scripts[0].label = 'Changed';
  assert.equal(s.submenus.Scripts[0].label, 'Run');
  menuProfiles.migrateMenuProfiles(s, true);
  assert.equal(s.menuProfiles[0], profile);
  const empty = settings(); menuProfiles.migrateMenuProfiles(empty, true);
  assert.equal(empty.menuProfiles.length, 0, 'Do not recreate deliberately removed profiles');
});

test('all modifier combinations match exactly and plain right-click stays reserved', () => {
  const profiles = Array.from({ length: 16 }, (_, mask) => ({
    ...menuProfiles.createMenuProfile('Menu ' + mask),
    modifiers: { alt: !!(mask & 1), ctrl: !!(mask & 2), shift: !!(mask & 4), meta: !!(mask & 8) }
  }));
  for (let mask = 0; mask < 16; mask++) {
    const m = profiles[mask].modifiers;
    const found = menuProfiles.matchingMenuProfile(mouseEvent({ altKey: m.alt, ctrlKey: m.ctrl, shiftKey: m.shift, metaKey: m.meta }), profiles);
    assert.equal(found, mask === 0 ? undefined : profiles[mask]);
  }
  assert.equal(menuProfiles.matchingMenuProfile(mouseEvent({ altKey: true }), [profiles[4]]), undefined);
});

test('Alt menu upgrade adds all built-in actions without moving custom commands', () => {
  const s = settings(); s.navigatorAltMenuVersion = 0;
  const scripts = menuProfiles.createMenuProfile('Scripts');
  scripts.submenus = { Scripts: [{ label: 'Run', commandId: 'script:run' }] };
  s.menuProfiles = [scripts];
  const before = plain(scripts);
  assert.equal(menuProfiles.ensureAltNavigatorMenu(s), true);
  const alt = menuProfiles.matchingMenuProfile(mouseEvent({ altKey: true }), s.menuProfiles);
  assert.deepEqual(plain(alt.actions), plain(menuProfiles.NAVIGATOR_MENU_ACTIONS.map(action => action.id)));
  assert.deepEqual(plain(alt.mainMenuCommands), []);
  assert.deepEqual(plain(alt.submenus), {});
  assert.deepEqual(plain(scripts), before);
  alt.actions = [];
  assert.equal(menuProfiles.ensureAltNavigatorMenu(s), false);
  assert.equal(s.menuProfiles.length, 2);
  assert.equal(alt.actions.length, 0, 'Later user customization must survive reload');
});

test('Alt menu upgrade reuses an existing Alt profile and preserves its commands', () => {
  const s = settings(); s.navigatorAltMenuVersion = 0;
  const alt = menuProfiles.createMenuProfile('My Alt menu');
  alt.modifiers = { alt: true, ctrl: false, shift: false, meta: false };
  alt.actions = ['color']; alt.mainMenuCommands = [{ label: 'Run', commandId: 'script:run' }];
  s.menuProfiles = [alt];
  menuProfiles.ensureAltNavigatorMenu(s);
  assert.equal(s.menuProfiles.length, 1);
  assert.equal(alt.name, 'My Alt menu');
  assert.equal(alt.actions.length, 6);
  assert.deepEqual(alt.mainMenuCommands, [{ label: 'Run', commandId: 'script:run' }]);
});

test('plain folder and file menus contain only basic actions, including New templates', () => {
  const s = settings(); menuProfiles.migrateMenuProfiles(s, false);
  s.newMenuCommands = [{ label: 'Template', commandId: 'template:new' }];
  const folder = nodeMenu(new TFolder('Folder'), s, mouseEvent());
  assert.deepEqual(folder.items.filter(item => !item.separator).map(item => item.title),
    ['New note', 'New folder', 'New...', 'Duplicate', 'Rename', 'Delete']);
  assert.equal(folder.items.find(item => item.title === 'New...').submenu.items[0].title, 'Template');
  const file = nodeMenu(new TFile('A.md'), s, mouseEvent());
  assert.deepEqual(file.items.filter(item => !item.separator).map(item => item.title), ['Duplicate', 'Rename', 'Delete']);
});

test('profiles show only their selected navigator actions and commands', () => {
  const s = settings();
  const color = menuProfiles.createMenuProfile('Appearance'); color.actions = ['color'];
  color.modifiers = { alt: true, ctrl: false, shift: false, meta: false };
  const scripts = menuProfiles.createMenuProfile('Scripts');
  scripts.modifiers = { alt: false, ctrl: true, shift: false, meta: false };
  scripts.mainMenuCommands = [{ label: 'Run script', commandId: 'script:run' }];
  s.menuProfiles = [color, scripts];
  assert.deepEqual(nodeMenu(new TFolder('Folder'), s, mouseEvent({ altKey: true })).items.map(item => item.title), ['Change color...']);
  assert.deepEqual(nodeMenu(new TFolder('Folder'), s, mouseEvent({ ctrlKey: true })).items.map(item => item.title), ['Run script']);
  assert.deepEqual(nodeMenu(new TFile('A.md'), s, mouseEvent({ altKey: true, ctrlKey: true })).items.filter(item => !item.separator).map(item => item.title), ['Duplicate', 'Rename', 'Delete']);
});

test('profile commands retain target context and clean empty sections and separators', () => {
  const profile = menuProfiles.createMenuProfile();
  profile.submenus = { Empty: [{ isSeparator: true }], Scripts: [
    { isSeparator: true }, { label: 'First', commandId: 'one', icon: 'star' },
    { isSeparator: true }, { isSeparator: true }, { label: 'Second', commandId: 'two' }, { isSeparator: true }
  ] };
  profile.submenuIcons = { Scripts: 'code' };
  profile.mainMenuCommands = [{ label: 'Main command', commandId: 'three' }];
  const calls = [], target = new TFile('Target.md');
  const app = { plugins: { plugins: { 'simple-navigator': { setLastClicked: file => calls.push(file) } } },
    commands: { executeCommandById: id => calls.push(id) } };
  const menu = new Menu();
  assert.equal(menuProfiles.appendProfileCommands(menu, profile, app, target), 2);
  assert.deepEqual(menu.items.map(item => item.title), ['Scripts', 'Main command']);
  assert.equal(menu.items[0].icon, 'code');
  assert.deepEqual(menu.items[0].submenu.items.map(item => item.title || '|'), ['First', '|', 'Second']);
  menu.items[0].submenu.items[0].click(); assert.deepEqual(calls, [target, 'one']);
  const background = new Menu(); menuProfiles.appendProfileCommands(background, profile, app, null);
  background.items[1].click(); assert.deepEqual(calls.slice(-2), [null, 'three']);
});

test('background context menu uses the chosen profile without restoring basic actions', () => {
  const profile = menuProfiles.createMenuProfile();
  profile.mainMenuCommands = [{ label: 'Run', commandId: 'script:run' }];
  const s = settings(); s.menuProfiles = [profile];
  const context = componentFunctions('src/components/TreeView.svelte', ['handleRootContextMenu', 'createNote', 'createFolder'], {
    settings: s, Menu, matchingMenuProfile: menuProfiles.matchingMenuProfile,
    appendProfileCommands: menuProfiles.appendProfileCommands, app: {}
  });
  context.handleRootContextMenu(mouseEvent({ shiftKey: true }));
  assert.deepEqual(Menu.shown.items.map(item => item.title), ['Run']);
  context.handleRootContextMenu(mouseEvent());
  assert.deepEqual(Menu.shown.items.map(item => item.title), ['New note', 'New folder']);
});

test('new-note folder follows Obsidian with active note context and supports explicit alternatives', () => {
  const root = new TFolder('/'), current = new TFolder('Current'), inbox = new TFolder('Inbox');
  const file = new TFile('Current/Note.md'); file.parent = current;
  let active = file;
  let nativeSource;
  const app = { workspace: { getActiveFile: () => active },
    vault: { getRoot: () => root, getAbstractFileByPath: path => path === 'Inbox' ? inbox : null },
    fileManager: { getNewFileParent: path => { nativeSource = path; return inbox; } } };
  const s = settings();
  assert.equal(utils.getDefaultNoteFolder(app, s), inbox);
  assert.equal(nativeSource, file.path);
  s.newNoteLocation = 'root'; assert.equal(utils.getDefaultNoteFolder(app, s), root);
  s.newNoteLocation = 'current'; assert.equal(utils.getDefaultNoteFolder(app, s), current);
  active = null; assert.equal(utils.getDefaultNoteFolder(app, s), root);
  s.newNoteLocation = 'folder'; s.newNoteFolder = 'Inbox';
  assert.equal(utils.getDefaultNoteFolder(app, s), inbox);
  s.newNoteFolder = ''; assert.equal(utils.getDefaultNoteFolder(app, s), root);
  s.newNoteFolder = 'Deleted'; assert.equal(utils.getDefaultNoteFolder(app, s), null);
});

test('renaming the specified new-note folder updates its path and leaves unrelated folders alone', () => {
  const s = settings(); s.newNoteLocation = 'folder'; s.newNoteFolder = 'Inbox/Sub';
  const moved = drag.updatePathsOnMove(s, 'Inbox', 'Notes');
  assert.equal(moved.newNoteFolder, 'Notes/Sub');
  assert.equal(s.newNoteFolder, 'Inbox/Sub');
  assert.equal(drag.updatePathsOnMove(s, 'Inbox2', 'Other').newNoteFolder, 'Inbox/Sub');
});

test('background New note uses the configured location and does not create anything if it is unavailable', async () => {
  const inbox = new TFolder('Inbox');
  let destination = inbox;
  const created = [], opened = [];
  const app = { vault: {
    getAvailablePath: (base, extension) => base + ' (2).' + extension,
    create: async path => { created.push(path); return new TFile(path); }
  }, workspace: { getLeaf: () => ({ openFile: async file => opened.push(file.path) }) } };
  const s = settings();
  const context = componentFunctions('src/components/TreeView.svelte', ['handleRootContextMenu', 'createNote', 'createFolder'], {
    settings: s, Menu, app, getSettings: () => s, getDefaultNoteFolder: () => destination,
    matchingMenuProfile: menuProfiles.matchingMenuProfile, appendProfileCommands: menuProfiles.appendProfileCommands
  });
  context.handleRootContextMenu(mouseEvent());
  await Menu.shown.items.find(item => item.title === 'New note').click();
  assert.deepEqual(created, ['Inbox/Untitled (2).md']);
  assert.deepEqual(opened, created);
  destination = null;
  await Menu.shown.items.find(item => item.title === 'New note').click();
  assert.equal(created.length, 1);
});

test('navigator context routing intercepts document-level menus only inside its own tree', () => {
  const script = componentScript('src/components/TreeView.svelte');
  const start = script.indexOf('    rootContextHandler =');
  const end = script.indexOf('    registerDomEvent(window, "contextmenu"', start);
  const calls = [];
  const title = { dispatchEvent: event => calls.push(['dispatch', event.type, event.detail]) };
  const inside = { closest: () => title }, outside = { closest: () => null }, background = { closest: () => null };
  const context = vm.createContext({ treeEl: { contains: target => target !== outside },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    handleRootContextMenu: event => calls.push(['root', event]) });
  vm.runInContext(transpile(script.slice(start, end)), context);
  const event = mouseEvent({ target: inside, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') });
  context.rootContextHandler(event);
  assert.equal(calls[0], 'prevent'); assert.equal(calls[1], 'stop');
  assert.equal(calls[2][0], 'dispatch'); assert.equal(calls[2][1], 'sn-contextmenu');
  calls.length = 0; context.rootContextHandler(mouseEvent({ target: outside })); assert.equal(calls.length, 0);
  context.rootContextHandler(mouseEvent({ target: background })); assert.equal(calls[0][0], 'root');
});
function linkApp(files, content = '') {
  const app = {
    content, writes: 0, linkCalls: [],
    vault: { getAbstractFileByPath: p => files.find(f => f.path === p),
      process: async (file, fn) => { app.content = fn(app.content); app.writes++; return app.content; } },
    fileManager: { generateMarkdownLink(file, from) {
      app.linkCalls.push([file.path, from]);
      return '[[' + (file.extension === 'md' ? file.path.slice(0, -3) : file.path) + ']]';
    } },
    workspace: { getLeavesOfType: () => [] }
  };
  return app;
}

test('non-Markdown targets cannot be written, including direct helper calls', async () => {
  const dragged = new TFile('Notes/Source.md');
  for (const extension of ['canvas', 'pdf', 'png', 'svg', 'json']) {
    const target = new TFile('Target.' + extension);
    const app = linkApp([target, dragged], 'original bytes');
    await utils.appendWikiLinksToNote(app, target.path, [dragged.path]);
    assert.equal(app.content, 'original bytes');
    assert.equal(app.writes, 0);
  }
});

test('Ctrl-drop highlights Markdown targets only', () => {
  for (const extension of ['md', 'canvas', 'pdf', 'png']) {
    const file = new TFile('Target.' + extension);
    const element = { dataset: { path: file.path } };
    const c = componentFunctions('src/components/TreeNode.svelte', ['findNoteUnderPointer'], {
      document: { elementFromPoint: () => ({ closest: () => element }) },
      app: { vault: { getAbstractFileByPath: () => file } }
    });
    assert.equal(c.findNoteUnderPointer(0, 0), extension === 'md' ? element : null);
  }
});

test('links use Obsidian generation with source path, duplicate names and attachment extensions', async () => {
  const target = new TFile('Target.md');
  const files = [target, new TFile('one/Same.md'), new TFile('two/Same.md'), new TFile('manual.pdf')];
  const app = linkApp(files, 'intro');
  await utils.appendWikiLinksToNote(app, target.path, files.slice(1).map(f => f.path));
  assert.equal(app.content, 'intro\n[[one/Same]]\n[[two/Same]]\n[[manual.pdf]]\n');
  assert.deepEqual(app.linkCalls, files.slice(1).map(f => [f.path, target.path]));
});

test('concurrent appends preserve both edits through atomic process', async () => {
  const target = new TFile('Target.md'), a = new TFile('A.md'), b = new TFile('B.md');
  const app = linkApp([target, a, b], 'original\n');
  await Promise.all([utils.appendWikiLinksToNote(app, target.path, [a.path]), utils.appendWikiLinksToNote(app, target.path, [b.path])]);
  assert.equal(app.content, 'original\n[[A]]\n[[B]]\n');
  assert.equal(app.writes, 2);
});

test('open editor insertion preserves unsaved text and never writes a disk snapshot', async () => {
  const target = new TFile('Target.md'), dragged = new TFile('A.md');
  const app = linkApp([target, dragged], 'disk');
  const view = new MarkdownView();
  view.file = target;
  let unsaved = 'unsaved edit';
  view.editor = { lastLine: () => 0, getLine: () => unsaved, replaceRange: text => { unsaved += text; } };
  app.workspace.getLeavesOfType = () => [{ view }];
  await utils.appendWikiLinksToNote(app, target.path, [dragged.path]);
  assert.equal(unsaved, 'unsaved edit\n[[A]]\n');
  assert.equal(app.writes, 0);
});

test('Backspace only deletes within this navigator, excluding editors, modifiers and repeats', () => {
  const title = { isContentEditable: false, closest: () => null };
  const outside = { isContentEditable: true, closest: () => null };
  const input = { isContentEditable: false, closest: () => ({}) };
  const tree = { contains: element => element !== outside };
  const event = { key: 'Backspace', target: title };
  assert.equal(utils.canDeleteSelection(event, tree), true);
  for (const patch of [{ target: outside }, { target: input }, { target: { isContentEditable: true } },
    { defaultPrevented: true }, { repeat: true }, { isComposing: true }, { ctrlKey: true },
    { metaKey: true }, { altKey: true }, { shiftKey: true }, { key: 'x' }]) {
    assert.equal(utils.canDeleteSelection({ ...event, ...patch }, tree), false);
  }
  assert.equal(utils.canDeleteSelection(event, undefined), false);
});

test('deletion respects the native trash preference, including older Obsidian', async () => {
  const file = new TFile('A.md');
  let nativeCalls = 0;
  await utils.deleteFile({ fileManager: { trashFile: async target => { assert.equal(target, file); nativeCalls++; } } }, file);
  assert.equal(nativeCalls, 1);
  for (const preference of ['permanent', 'system', 'local']) {
    const calls = [];
    await utils.deleteFile({ fileManager: {}, vault: {
      getConfig: () => preference,
      delete: async target => calls.push(['delete', target]),
      trash: async (target, system) => calls.push(['trash', target, system])
    } }, file);
    assert.deepEqual(calls, preference === 'permanent' ? [['delete', file]] : [['trash', file, preference === 'system']]);
  }
});

test('keyboard deletion snapshots confirmed selection and ignores a repeated pending request', async () => {
  const script = componentScript('src/components/TreeView.svelte');
  const start = script.indexOf('    keydownHandler =');
  const end = script.indexOf('    registerDomEvent(document, "keydown"', start);
  let confirm;
  const confirmation = new Promise(resolve => { confirm = resolve; });
  const removed = [];
  const context = vm.createContext({ deleting: false, selectedPaths: new Set(['A.md']), settings: { confirmDelete: true },
    treeEl: {}, canDeleteSelection: () => true, showConfirmModal: () => confirmation,
    app: { vault: { getAbstractFileByPath: path => ({ path }) } },
    deleteFile: async (app, file) => { removed.push(file.path); }, clearSelection() {}, console: quietConsole });
  vm.runInContext(transpile(script.slice(start, end)), context);
  const event = { preventDefault() {} };
  context.keydownHandler(event);
  context.selectedPaths = new Set(['B.md']);
  context.keydownHandler(event);
  confirm(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(removed, ['A.md']);
  assert.equal(context.deleting, false);
});

test('editor drop generates links relative to the actual destination editor', () => {
  const target = new TFile('Folder/Target.md'), pdf = new TFile('Docs/manual.pdf');
  const app = linkApp([target, pdf]);
  const editor = { replaceRange: text => { editor.inserted = text; }, focus() {} };
  const view = new MarkdownView(); view.editor = editor; view.file = target;
  app.workspace.getLeavesOfType = () => [{ view }];
  const context = componentFunctions('src/components/TreeView.svelte', ['insertLinksAt'], {
    app, getDropPos: () => ({ line: 0, ch: 0 }), clampPosOutOfLinks: (editor, pos) => pos,
    dragState: { batchPaths: [], itemPath: pdf.path }, generateFileLinks: utils.generateFileLinks
  });
  context.insertLinksAt(editor, 0, 0);
  assert.deepEqual(app.linkCalls, [[pdf.path, target.path]]);
  assert.equal(editor.inserted, '[[Docs/manual.pdf]]');
});

test('rename retains position in parent order without mutating previous settings', () => {
  const s = settings();
  s.orderMap.F = ['B.md', 'A.md']; s.colorMap['F/B.md'] = 'red';
  const next = drag.updatePathsOnMove(s, 'F/B.md', 'F/Z.md');
  assert.deepEqual(plain(next.orderMap.F), ['Z.md', 'A.md']);
  assert.deepEqual(plain(s.orderMap.F), ['B.md', 'A.md']);
  assert.equal(next.colorMap['F/Z.md'], 'red');
  assert.equal(s.colorMap['F/B.md'], 'red');
  assert.deepEqual(plain(utils.sortWithOrder([new TFile('F/A.md'), new TFile('F/Z.md')], next.orderMap, 'F').map(f => f.name)), ['Z.md', 'A.md']);
});

test('folder moves migrate descendants and update source and target orders', () => {
  const s = settings();
  s.orderMap = { '': ['F', 'Other'], F: ['Sub'], 'F/Sub': ['A.md'], Dest: ['Existing.md'] };
  s.colorMap['F/Sub/A.md'] = 'red'; s.iconMap.F = 'star';
  s.folderCollapseIconMap['F/Sub'] = { collapsed: 'plus', expanded: 'minus' };
  s.hiddenPaths = ['F/Sub/A.md']; s.collapsedPaths = ['F/Sub']; s.archivedPaths = ['F'];
  const next = drag.updatePathsOnMove(s, 'F', 'Dest/F');
  assert.deepEqual(plain(next.orderMap), { '': ['Other'], 'Dest/F': ['Sub'], 'Dest/F/Sub': ['A.md'], Dest: ['Existing.md', 'F'] });
  assert.equal(next.colorMap['Dest/F/Sub/A.md'], 'red');
  assert.equal(next.iconMap['Dest/F'], 'star');
  assert.deepEqual(plain(next.hiddenPaths), ['Dest/F/Sub/A.md']);
  assert.deepEqual(plain(next.collapsedPaths), ['Dest/F/Sub']);
  assert.deepEqual(plain(next.archivedPaths), ['Dest/F']);
  assert.ok(next.folderCollapseIconMap['Dest/F/Sub']);
});

function pluginHarness(initial = settings()) {
  const handlers = new Map(), writes = [], views = [];
  class Plugin {
    async loadData() { return initial; }
    async saveData(data) { writes.push(plain(data)); }
    registerEvent() {} registerView() {} addCommand() {} addRibbonIcon() {} addSettingTab() {}
  }
  obsidian.Plugin = Plugin;
  const PluginClass = load('src/main.ts', {
    './SimpleNavigatorView': { SIMPLE_NAVIGATOR_VIEW: 'simple-navigator-view' },
    './settings': { DEFAULT_SETTINGS: settings(), SimpleNavigatorSettingTab: class {} },
    './utils': utils, './modal': {}, './drag-state': drag,
    './menu-profiles': menuProfiles,
    './icon-utils': { refreshCustomIcons() {} }
  }).default;
  const plugin = new PluginClass();
  plugin.app = { vault: { on: (name, fn) => { handlers.set(name, fn); return {}; } },
    workspace: { getLeavesOfType: () => views }, fileManager: {} };
  return { plugin, handlers, writes, views };
}

test('external rename migrates and saves metadata while navigator is closed', async () => {
  const s = settings(); s.colorMap['Old.md'] = 'red'; s.orderMap[''] = ['Old.md', 'Other.md'];
  const h = pluginHarness(s); await h.plugin.onload();
  h.handlers.get('rename')(new TFile('New.md'), 'Old.md');
  await h.plugin.settingsSaveQueue;
  assert.equal(h.plugin.settings.colorMap['New.md'], 'red');
  assert.deepEqual(plain(h.plugin.settings.orderMap['']), ['New.md', 'Other.md']);
  assert.equal(h.writes.at(-1).colorMap['New.md'], 'red');
});

test('plugin renames apply metadata exactly once and failed renames keep original metadata', async () => {
  const s = settings(); s.orderMap[''] = ['A.md', 'B.md']; s.colorMap['A.md'] = 'red';
  const h = pluginHarness(s); await h.plugin.onload();
  h.plugin.app.fileManager.renameFile = async (file, target) => {
    if (target === 'B.md') throw new Error('Already exists');
    const old = file.path; file.path = target;
    h.handlers.get('rename')(file, old);
  };
  const a = new TFile('A.md');
  await assert.rejects(h.plugin.renameItem(a, 'B.md'));
  assert.equal(h.plugin.settings.colorMap['A.md'], 'red');
  await h.plugin.renameItem(a, 'Z.md');
  assert.deepEqual(plain(h.plugin.settings.orderMap['']), ['Z.md', 'B.md']);
  assert.equal(h.plugin.settings.colorMap['Z.md'], 'red');
  assert.equal(h.writes.length, 1);
});

test('settings writes are serialized, snapshot mutable values, and recover after failure', async () => {
  const h = pluginHarness(); await h.plugin.onload();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const started = [];
  h.plugin.saveData = async data => { started.push(plain(data)); if (started.length === 1) { await gate; throw new Error('Disk error'); } };
  h.plugin.settings.colorMap.A = 'red'; const first = h.plugin.saveSettings();
  h.plugin.settings.colorMap.A = 'blue'; const second = h.plugin.saveSettings();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(started.length, 1);
  release(); await assert.rejects(first); await second;
  assert.equal(started[0].colorMap.A, 'red'); assert.equal(started[1].colorMap.A, 'blue');
});

test('partial batch move retains successful metadata, preserves hidden target order, and continues', async () => {
  const a = new TFile('Src/A.md'), b = new TFile('Src/B.md'), c = new TFile('Src/C.md');
  const src = new TFolder('Src', [a, b, c]);
  const hidden = new TFile('Dest/Hidden.md'), existing = new TFile('Dest/Existing.md');
  const dest = new TFolder('Dest', [hidden, existing]);
  const rootFolder = new TFolder('', [src, dest]);
  const files = [rootFolder, src, dest, a, b, c, hidden, existing];
  let current = settings(); current.orderMap = { Src: ['A.md', 'B.md', 'C.md'], Dest: ['Hidden.md', 'Existing.md'] };
  current.hiddenPaths = [hidden.path]; current.colorMap[a.path] = 'red';
  const persisted = [];
  const context = componentFunctions('src/components/TreeView.svelte', ['handleSortEnd'], {
    rootFolder, settings: current, showHidden: false, sortWithOrder: utils.sortWithOrder,
    getSettings: () => current, clearSelection() {},
    app: { vault: { getAbstractFileByPath: p => files.find(f => f.path === p) } },
    renameItem: async (file, target) => {
      if (file === b) throw new Error('Conflict');
      const old = file.path; file.parent.children.splice(file.parent.children.indexOf(file), 1);
      file.path = target; file.parent = dest; dest.children.push(file);
      current = drag.updatePathsOnMove(current, old, target); persisted.push(plain(current));
    }, onUpdateSettings: async next => { current = next; persisted.push(plain(next)); }
  });
  await context.handleSortEnd({ fromPath: 'Src', toPath: 'Dest', itemPath: a.path,
    batchPaths: [a.path, b.path, c.path], oldIndex: 0, newIndex: 0 });
  assert.equal(a.path, 'Dest/A.md'); assert.equal(b.path, 'Src/B.md'); assert.equal(c.path, 'Dest/C.md');
  assert.equal(current.colorMap[a.path], 'red'); assert.equal(current.colorMap['Src/A.md'], undefined);
  assert.deepEqual(plain(current.orderMap.Src), ['B.md']);
  assert.deepEqual(plain(current.orderMap.Dest), ['Hidden.md', 'A.md', 'C.md', 'Existing.md']);
  assert.equal(persisted.at(-1).colorMap[a.path], 'red');
});

test('auto-reveal updates active file and expands ancestors, including initial opening', async () => {
  const a = new TFile('Folder/A.md'), b = new TFile('Other/B.md');
  const folder = new TFolder('Folder', [a]), other = new TFolder('Other', [b]);
  let active = a;
  let current = settings(); current.autoReveal = true; current.collapsedPaths = ['Folder', 'Other'];
  const classes = new Set();
  const row = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  let focused, timer;
  const context = componentFunctions('src/components/TreeView.svelte', ['revealActiveFile', 'revealFile', 'clearRevealFlash'], {
    app: { workspace: { getActiveFile: () => active } }, settings: current,
    getSettings: () => current, onUpdateSettings: async next => { current = next; },
    treeEl: null, revealSequence: 0, showHidden: false, flashRow: undefined, flashTimer: undefined,
    rowForPath: path => path === b.path ? row : undefined, tick: async () => {}, focusRow: item => { focused = item; },
    setTimeout: fn => { timer = fn; }, clearTimeout() {}
  });
  await context.revealActiveFile();
  assert.equal(context.activeFilePath, a.path); assert.deepEqual(plain(current.collapsedPaths), ['Other']);
  active = b; await context.revealActiveFile();
  assert.equal(context.activeFilePath, b.path); assert.deepEqual(plain(current.collapsedPaths), []);
  current.autoReveal = false;
  current.collapsedPaths = ['Folder', 'Other'];
  context.treeEl = { isConnected: true };
  await context.revealActiveFile();
  assert.deepEqual(plain(current.collapsedPaths), ['Folder', 'Other']);
  await context.revealFile(b);
  assert.deepEqual(plain(current.collapsedPaths), ['Folder']);
  assert.equal(current.autoReveal, false);
  assert.equal(focused, row);
  assert.ok(classes.has('sn-reveal-flash'));
  timer();
  assert.equal(classes.size, 0);
  const script = componentScript('src/components/TreeView.svelte');
  const mount = script.slice(script.indexOf('  onMount('), script.indexOf('  onDestroy('));
  const subscriptions = [];
  const mounted = vm.createContext({ app: { workspace: { on: (event, fn) => { subscriptions.push([event, fn]); return {}; } } },
    onMount: fn => fn(), revealActiveFile: () => { mounted.reveals++; }, reveals: 0, getSettings: () => current,
    registerDomEvent() {}, document: {}, window: {}, handleWindowDrop() {}, handleWindowDragOver() {} });
  vm.runInContext(transpile(mount), mounted);
  assert.equal(subscriptions[0][0], 'file-open');
  assert.equal(mounted.reveals, 1); subscriptions[0][1](); assert.equal(mounted.reveals, 2);
});

test('resetting a folder clears only its own manual order', async () => {
  const current = { ...settings(), orderMap: { '': ['Area'], Area: ['B', 'A'], 'Area/Child': ['D', 'C'] } };
  let change;
  const context = componentFunctions('src/components/TreeView.svelte', ['resetFolderOrder'], {
    getSettings: () => current, updateToolbarSettings: async next => { change = next; }
  });
  const entry = nodeMenu(new TFolder('Area'), current, mouseEvent()).items.find(item => item.title === 'Reset folder order');
  assert.ok(entry);
  assert.ok(!nodeMenu(new TFolder('Other'), current, mouseEvent()).items.some(item => item.title === 'Reset folder order'));
  await context.resetFolderOrder('Area');
  assert.deepEqual(plain(change.orderMap), { '': ['Area'], 'Area/Child': ['D', 'C'] });
  assert.deepEqual(current.orderMap.Area, ['B', 'A']);
});

test('keyboard navigation opens folders, moves between rows and leaves rename keystrokes to the input', () => {
  class Element {}
  const treeEl = Object.assign(new Element(), { dataset: {}, querySelectorAll: () => [folder, note] });
  const actions = [];
  let expanded = false;
  const note = Object.assign(new Element(), {
    dataset: { path: 'Folder/Note.md' }, matches: () => true,
    getAttribute: () => null, parentElement: { closest: () => folder },
    firstElementChild: { click: () => actions.push('open'), dispatchEvent: event => actions.push(event.type) }
  });
  const folder = Object.assign(new Element(), {
    dataset: { path: 'Folder' }, matches: () => true, firstElementChild: {},
    getAttribute: () => String(expanded), querySelector: () => note
  });
  const input = Object.assign(new Element(), { matches: () => false });
  const context = componentFunctions('src/components/TreeView.svelte', ['handleTreeKeydown'], {
    treeEl, HTMLElement: Element, Event, focusRow: row => actions.push(row.dataset.path),
    setFolderExpanded: (path, open) => { actions.push([path, open]); expanded = open; }
  });
  function press(target, key) {
    let consumed = false;
    context.handleTreeKeydown({ target, key, preventDefault() { consumed = true; }, stopPropagation() {} });
    return consumed;
  }
  assert.equal(press(treeEl, 'ArrowDown'), true);
  press(folder, 'ArrowRight');
  press(folder, 'ArrowRight');
  press(note, 'Enter');
  press(note, 'F2');
  assert.equal(press(input, 'Enter'), false);
  press(note, 'ArrowLeft');
  press(folder, 'ArrowLeft');
  assert.deepEqual(actions, ['Folder', ['Folder', true], 'Folder/Note.md', 'open', 'sn-rename', 'Folder', ['Folder', false]]);
});
