const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadMain, makeDisplay, sleep } = require('./electron-mock');

// Primary screen 2560 x 1440 and small 960 x 640 screen on its right.
const primary = () => makeDisplay(1, 0, 0, 2560, 1440);
const small = () => makeDisplay(2, 2560, 0, 960, 640);
const DEBOUNCE = 600; // > onDisplaysChanged delay

test('covers the small screen at startup', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  assert.deepEqual(app.window.bounds, small().bounds);
  assert.equal(app.window.visible, true);
  assert.equal(app.window.onTop, 'screen-saver');
});

test('small screen unplugged: hidden, then back when it returns', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  app.unplug(2);
  await sleep(DEBOUNCE);
  assert.equal(app.window.visible, false, 'must not cover the primary screen');

  app.plug(small());
  await sleep(DEBOUNCE);
  assert.equal(app.window.visible, true);
  assert.deepEqual(app.window.bounds, small().bounds);
  assert.equal(app.window.onTop, 'screen-saver');
});

test('hidden by the user: stays hidden when the screen returns', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  app.clickTray(); // hide
  app.unplug(2);
  await sleep(DEBOUNCE);
  app.plug(small());
  await sleep(DEBOUNCE);
  assert.equal(app.window.visible, false);
});

test('small screen missing at startup: waits without covering the primary', async () => {
  const app = await loadMain({ displays: [primary()] });
  assert.equal(app.window.visible, false);

  app.plug(small());
  await sleep(DEBOUNCE);
  assert.equal(app.window.visible, true);
  assert.deepEqual(app.window.bounds, small().bounds);
});

test('shown without its screen: ordinary window on the primary', async () => {
  const app = await loadMain({ displays: [primary()] });
  app.clickTray();
  assert.equal(app.window.visible, true);
  assert.equal(app.window.onTop, false);
  assert.deepEqual(app.window.bounds, { x: 800, y: 380, width: 960, height: 640 });
});

test('the picked screen is remembered across launches', async () => {
  const first = await loadMain({ displays: [primary(), small()] });
  await first.invoke('snap-to-display', 1);
  assert.deepEqual(first.window.bounds, primary().bounds);
  const saved = JSON.parse(fs.readFileSync(path.join(first.userData, 'dashboard.json'), 'utf8'));
  assert.deepEqual(saved.display, { id: 1, width: 2560, height: 1440 });

  const second = await loadMain({ displays: [primary(), small()], config: saved });
  assert.deepEqual(second.window.bounds, primary().bounds);
});

test('remembered screen found by resolution when its id changed', async () => {
  const config = { display: { id: 99, width: 960, height: 640 } };
  const app = await loadMain({ displays: [primary(), small()], config });
  assert.deepEqual(app.window.bounds, small().bounds);
});

test('window mode: never on top, position kept', async () => {
  const bounds = { x: 100, y: 100, width: 800, height: 600 };
  const app = await loadMain({ displays: [primary(), small()], config: { coverTaskbar: false, bounds } });
  assert.deepEqual(app.window.bounds, bounds);
  assert.equal(app.window.visible, true);
  assert.equal(app.window.onTop, false);
});

test('unreadable config: set aside, not overwritten', async () => {
  const app = await loadMain({ displays: [primary(), small()], config: '{"items": [truncated' });
  const files = fs.readdirSync(app.userData);
  assert.ok(files.some((f) => f.startsWith('dashboard.json.illisible-')), files.join(', '));
  await app.invoke('set-theme', 'red');
  const saved = JSON.parse(fs.readFileSync(path.join(app.userData, 'dashboard.json'), 'utf8'));
  assert.equal(saved.theme, 'red');
  assert.ok(!files.includes('dashboard.json.tmp'));
});

test('windowed size: switches to window mode and stays there', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  const config = await app.invoke('set-resolution', { width: 800, height: 600 });
  assert.equal(config.coverTaskbar, false);
  assert.equal(app.window.onTop, false);
  assert.equal(app.window.bounds.width, 800);

  app.plug(makeDisplay(3, -1920, 0, 1920, 1080));
  await sleep(DEBOUNCE);
  assert.equal(app.window.bounds.width, 800, 'a screen change must not enlarge it again');
});

test('weather city: none by default, valid choice kept, invalid input ignored', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  let config = await app.invoke('get-config');
  assert.equal(config.weatherSite, null);

  config = await app.invoke('set-weather-site', { label: 'Paris (75)', lat: 48.85, lon: 2.35, timezone: 'Europe/Paris' });
  assert.deepEqual(config.weatherSite, { label: 'Paris (75)', lat: 48.85, lon: 2.35, timezone: 'Europe/Paris' });

  config = await app.invoke('set-weather-site', { label: 'x', lat: 'abc', lon: 3 });
  assert.equal(config.weatherSite.label, 'Paris (75)');
  config = await app.invoke('set-weather-site', { label: 'Pole', lat: 89, lon: 0, timezone: 'x; rm -rf' });
  assert.equal(config.weatherSite.timezone, 'auto');
});

test('night mode: on by default at 50 %, settings clamped and saved', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  let config = await app.invoke('get-config');
  assert.deepEqual(config.night, { enabled: true, dim: 0.5 });
  config = await app.invoke('set-night', { dim: 5 });
  assert.deepEqual(config.night, { enabled: true, dim: 0.9 });
  config = await app.invoke('set-night', { enabled: false });
  assert.deepEqual(config.night, { enabled: false, dim: 0.9 });
  const saved = JSON.parse(fs.readFileSync(path.join(app.userData, 'dashboard.json'), 'utf8'));
  assert.deepEqual(saved.night, { enabled: false, dim: 0.9 });
});

test('language: follows the system, can be forced, invalid values ignored', async () => {
  let app = await loadMain({ displays: [primary(), small()], locales: ['fr-CA', 'en-US'] });
  assert.deepEqual(await app.invoke('get-language'), { setting: 'auto', lang: 'fr', locale: 'fr-CA' });

  assert.deepEqual(await app.invoke('set-language', 'en'), { setting: 'en', lang: 'en', locale: 'en-US' });
  assert.equal((await app.invoke('set-language', 'xx')).setting, 'auto');

  app = await loadMain({ displays: [primary(), small()], locales: ['de-DE'] });
  assert.deepEqual(await app.invoke('get-language'), { setting: 'auto', lang: 'en', locale: 'en-US' });
});

/* ---------------- maximized state ---------------- */

const savedConfig = (app) => JSON.parse(fs.readFileSync(path.join(app.userData, 'dashboard.json'), 'utf8'));

test('window mode: starts maximized again when it was, and keeps the size to restore to', async () => {
  const bounds = { x: 300, y: 200, width: 800, height: 600 };
  const app = await loadMain({ displays: [primary(), small()], config: { coverTaskbar: false, maximized: true, bounds } });
  assert.equal(app.window.isMaximized(), true);
  assert.equal(app.window.visible, true);
  assert.deepEqual(app.window.getNormalBounds(), bounds);

  app.window.unmaximize();
  assert.deepEqual(app.window.bounds, bounds, 'restored where it was');
});

test('window mode: maximizing and restoring are saved, with the normal bounds', async () => {
  const bounds = { x: 300, y: 200, width: 800, height: 600 };
  const app = await loadMain({ displays: [primary(), small()], config: { coverTaskbar: false, maximized: false, bounds } });
  app.window.maximize();
  await sleep(500);
  let saved = savedConfig(app);
  assert.equal(saved.maximized, true);
  assert.deepEqual(saved.bounds, bounds, 'the work area of the maximized window is not kept as its size');

  app.window.unmaximize();
  await sleep(500);
  saved = savedConfig(app);
  assert.equal(saved.maximized, false);
  assert.deepEqual(saved.bounds, bounds);
});

test('config from before the maximized state was saved: bounds of a maximized window mean it was maximized', async () => {
  // What a maximized frameless window left in the config: the work area and its border.
  const wa = primary().workArea;
  const bounds = { x: wa.x - 8, y: wa.y - 8, width: wa.width + 16, height: wa.height + 16 };
  const app = await loadMain({ displays: [primary(), small()], config: { coverTaskbar: false, bounds } });
  assert.equal(app.window.isMaximized(), true);
  assert.deepEqual(app.window.getNormalBounds(), { x: 800, y: 380, width: 960, height: 640 }, 'restores to a standard size, on its screen');
  assert.equal(savedConfig(app).maximized, undefined, 'saved with the next change, not before');

  // An ordinary window is not mistaken for a maximized one.
  const plain = await loadMain({ displays: [primary(), small()], config: { coverTaskbar: false, bounds: { x: 100, y: 100, width: 800, height: 600 } } });
  assert.equal(plain.window.isMaximized(), false);
});

test('cover mode: the window is not maximized, and the choice is not forgotten', async () => {
  const bounds = { x: 300, y: 200, width: 800, height: 600 };
  const app = await loadMain({ displays: [primary(), small()], config: { coverTaskbar: true, maximized: true, bounds } });
  assert.equal(app.window.isMaximized(), false);
  assert.deepEqual(app.window.bounds, small().bounds);

  // Windowed again: maximized again.
  await app.invoke('set-cover-taskbar', false);
  assert.equal(app.window.isMaximized(), true);
  assert.equal(app.window.onTop, false);
  // And back to cover mode: un-maximized to fit the screen, flag kept.
  await app.invoke('set-cover-taskbar', true);
  assert.equal(app.window.isMaximized(), false);
  assert.equal((await app.invoke('get-config')).maximized, true);
});

test('picking a windowed size replaces the maximized state', async () => {
  const app = await loadMain({ displays: [primary(), small()], config: { coverTaskbar: false, maximized: true, bounds: { x: 300, y: 200, width: 800, height: 600 } } });
  const config = await app.invoke('set-resolution', { width: 1024, height: 600 });
  assert.equal(config.maximized, false);
  assert.equal(app.window.isMaximized(), false);
  assert.equal(app.window.bounds.width, 1024);
});

/* ---------------- settings window ---------------- */

test('settings: their own window, opened from the tray menu, one at a time', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  assert.equal(app.settings, null);
  const item = app.trayMenu().find((i) => i.label === 'Settings…');
  item.click();
  const win = app.settings;
  assert.ok(win, 'a settings window exists');
  assert.notEqual(win, app.window, 'it is not the dashboard');
  win.emit('ready-to-show');
  assert.equal(win.visible, true);
  // On the primary screen, not on the small dashboard screen.
  assert.deepEqual(app.displays.find((d) => d.id === 1).bounds.x <= win.bounds.x, true);
  assert.ok(win.bounds.x + win.bounds.width <= 2560);
  assert.equal(win.onTop, false);

  item.click();
  assert.equal(app.windows.filter((w) => w.file === 'settings.html').length, 1, 'no second window');
  // The dashboard is untouched.
  assert.deepEqual(app.window.bounds, small().bounds);
});

test('settings: position remembered, window really closes', async () => {
  const first = await loadMain({ displays: [primary(), small()] });
  await first.invoke('open-settings');
  first.settings.emit('ready-to-show');
  first.settings.setBounds({ x: 1000, y: 100, width: 600, height: 700 });
  first.settings.emit('move');
  await sleep(500);
  assert.deepEqual(savedConfig(first).settingsBounds, { x: 1000, y: 100, width: 600, height: 700 });

  first.settings.close();
  assert.equal(first.settings, null);
  await first.invoke('open-settings');
  assert.deepEqual(first.settings.bounds, { x: 1000, y: 100, width: 600, height: 700 });

  // After a restart, and not off-screen when its screen is gone.
  const second = await loadMain({ displays: [primary()], config: { settingsBounds: { x: 2800, y: 50, width: 500, height: 600 } } });
  await second.invoke('open-settings');
  assert.ok(second.settings.bounds.x < 2560, 'back on a connected screen');
});

test('settings: above the dashboard only on its screen', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  await app.invoke('open-settings');
  const win = app.settings;
  win.emit('ready-to-show');
  assert.equal(win.onTop, false, 'other screen: an ordinary window');

  win.setBounds({ x: 2600, y: 20, width: 500, height: 600 });   // on the small screen, under the covering dashboard
  win.emit('move');
  assert.equal(win.onTop, 'screen-saver');
  win.setBounds({ x: 100, y: 100, width: 500, height: 600 });
  win.emit('move');
  assert.equal(win.onTop, false);
});

test('settings: a change reaches both windows', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  await app.invoke('open-settings');
  const win = app.settings;
  await app.invoke('set-theme', 'purple');
  const last = (w, channel) => w.sent.filter(([c]) => c === channel).at(-1)?.[1];
  assert.equal(last(app.window, 'config').theme, 'purple');
  assert.equal(last(win, 'config').theme, 'purple');

  await app.invoke('set-language', 'fr');
  assert.equal(last(app.window, 'language').lang, 'fr');
  assert.equal(last(win, 'language').lang, 'fr');
  assert.equal(win.title, 'DashLok — Réglages');
});

test('settings: "pick a city" from the dashboard opens them on the search', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  await app.invoke('open-settings', 'city');
  app.settings.emit('ready-to-show');
  assert.deepEqual(app.settings.sent.filter(([c]) => c === 'focus-setting'), [['focus-setting', 'city']]);
  await app.invoke('open-settings', 'city');
  assert.equal(app.settings.sent.filter(([c]) => c === 'focus-setting').length, 2, 'asked again on the open window');
  await app.invoke('open-settings', 'rm -rf');
  assert.equal(app.settings.sent.filter(([c]) => c === 'focus-setting').length, 2, 'unknown targets ignored');
});

/* ---------------- time format ---------------- */

test('time format: automatic by default, only known values kept, saved', async () => {
  const app = await loadMain({ displays: [primary(), small()] });
  assert.equal((await app.invoke('get-config')).timeFormat, 'auto');
  assert.equal((await app.invoke('set-time-format', '24h')).timeFormat, '24h');
  assert.equal(savedConfig(app).timeFormat, '24h');
  assert.equal((await app.invoke('set-time-format', '12h')).timeFormat, '12h');
  assert.equal((await app.invoke('set-time-format', 'banana')).timeFormat, 'auto');
});
