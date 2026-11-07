import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import test from 'node:test';

test('hidden and loading articles return late focus to the app', async () => {
  let view;
  globalThis.__focusTestView = class {
    constructor() {
      view = this;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { setWindowOpenHandler() {}, isFocused: () => false });
    }
    setBackgroundColor() {}
    setVisible() {}
  };
  const source = readFileSync(new URL('../dist/main/browser/articleBrowserController.js', import.meta.url), 'utf8')
    .replace(/import .* from "electron";/, 'const WebContentsView = globalThis.__focusTestView;')
    .replace(/import .* from "\.\/articleBlocker.js";/, '');
  const { ArticleBrowserController } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  let focused = 0;
  const children = new Set();
  const owner = { isDestroyed: () => false, webContents: {
    isDestroyed: () => false, focus: () => focused++, isFocused: () => true
  }, contentView: { addChildView(view) { children.add(view); }, removeChildView(view) { children.delete(view); } } };
  const blocker = new EventEmitter();
  blocker.getStatus = () => 'active';
  const controller = new ArticleBrowserController(owner, new EventEmitter(), blocker);
  try {
    controller.ensureView();
    assert.equal(children.size, 0, "loading view is detached");
    view.webContents.emit('focus');
    assert.equal(focused, 1);
    controller.isVisible = true;
    controller.awaitingPage = true;
    view.webContents.emit('focus');
    assert.equal(focused, 2);
    controller.awaitingPage = false;
    view.webContents.emit('focus');
    assert.equal(focused, 2, 'visible article can be focused');
    controller.showNativeView();
    assert.equal(focused, 3, 'show preserves application focus');
    assert.equal(children.size, 1);
    controller.showNativeView();
    assert.equal(children.size, 1, "repeated show does not duplicate attachment");
    focused = 3;
    controller.hide();
    assert.equal(children.size, 0, "hidden view is removed from native focus hierarchy");
    view.webContents.emit('focus');
    assert.equal(focused, 5, 'late focus after hide is restored');
  } finally { delete globalThis.__focusTestView; }
});
