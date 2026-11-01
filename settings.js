/* Settings window (settings.html). Every change goes through the main process,
 * which saves it and tells both windows (event 'config'): this page and the
 * dashboard stay in step whichever one made the change. */

const $ = (id) => document.getElementById(id);
const { i18n } = window;
const { t } = i18n;

/** Element with text: data from an API or the OS never goes through innerHTML. */
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

let config = {};
let lastNight = null;

const chipsOf = (id) => document.querySelectorAll(`#${id} .chip`);
const near = (a, b) => Math.abs(a - b) < 0.01;

/** Hours and minutes, in the time format of the settings. */
const hhmm = (ms) => new Date(ms).toLocaleTimeString(i18n.locale,
  { hour: 'numeric', minute: '2-digit', ...i18n.timeOptions(config.timeFormat) });

/* ---------------- texts ---------------- */

/** Texts written in settings.html, by their data-i18n* attributes. */
function applyStaticTexts() {
  document.documentElement.lang = i18n.lang;
  document.title = t('settings.windowTitle');
  for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const e of document.querySelectorAll('[data-i18n-placeholder]')) e.placeholder = t(e.dataset.i18nPlaceholder);
}

function applyLanguage({ lang, locale }) {
  i18n.setLanguage(lang, locale);
  applyStaticTexts();
  buildDisplayList();
  if (lastNight) renderNight(lastNight);
  sync();
}

/* ---------------- state -> controls ---------------- */

/** Shows the current settings on every control. */
function sync() {
  document.documentElement.dataset.theme = config.theme || 'dark';
  chipsOf('themes').forEach((c) => c.classList.toggle('active', c.dataset.theme === (config.theme || 'dark')));
  chipsOf('zooms').forEach((c) => c.classList.toggle('active', near(Number(c.dataset.z), config.zoom || 1)));
  chipsOf('languages').forEach((c) => c.classList.toggle('active', c.dataset.lang === (config.language || 'auto')));
  chipsOf('timeFormats').forEach((c) => c.classList.toggle('active', c.dataset.tf === (config.timeFormat || 'auto')));
  chipsOf('resList').forEach((c) => c.classList.toggle('active',
    !config.coverTaskbar && Number(c.dataset.w) === config.bounds?.width && Number(c.dataset.h) === config.bounds?.height));
  chipsOf('intervals').forEach((c) => c.classList.toggle('active', Number(c.dataset.ms) === config.refreshMs));
  chipsOf('nightDims').forEach((c) => c.classList.toggle('active', near(Number(c.dataset.dim), config.night?.dim ?? 0.5)));

  $('coverTgl').checked = !!config.coverTaskbar;
  $('nightTgl').checked = !!config.night?.enabled;
  $('nightTgl').closest('.sCard').classList.toggle('off', !config.night?.enabled);
  $('siteNow').textContent = config.weatherSite?.label || '--';
  if (lastNight) renderNight(lastNight);
}

function renderNight({ from, until, current }) {
  const span = from ? `${hhmm(from)} → ${until ? hhmm(until) : '?'}` : t('night.until', { time: hhmm(until) });
  const city = config.weatherSite?.label || t('night.theCity');
  $('nightHint').textContent = until || from
    ? t('night.line', { when: t(current ? 'night.current' : 'night.next'), span, city })
    : t(config.weatherSite ? 'night.unknown' : 'night.noCity');
}

/** Detected screens; a click shows the dashboard full screen on it. */
async function buildDisplayList() {
  const list = $('dispList');
  const displays = await window.dash.getDisplays();
  list.replaceChildren(...displays.map((d) => {
    const b = el('button', 'dispBtn' + (d.current ? ' current' : ''));
    const tags = [d.primary ? t('display.primary') : null, d.scaleFactor !== 1 ? `${Math.round(d.scaleFactor * 100)} %` : null]
      .filter(Boolean)
      .join(' · ');
    b.append(el('span', 'dName', d.label), el('span', 'dRes', `${d.width} × ${d.height}${tags ? ' · ' + tags : ''}`));
    b.addEventListener('click', () => window.dash.snapToDisplay(d.id));
    return b;
  }));
}

/* ---------------- controls -> main process ---------------- */

/** Click on a chip of `id`: calls `fn(chip)`; the 'config' event brings the new state back. */
function onChip(id, fn) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) fn(b);
  });
}

onChip('themes', (b) => {
  document.documentElement.dataset.theme = b.dataset.theme;   // at once, without waiting for the round trip
  window.dash.setTheme(b.dataset.theme);
});
onChip('zooms', (b) => window.dash.setZoom(Number(b.dataset.z)));
onChip('languages', (b) => window.dash.setLanguage(b.dataset.lang));
onChip('timeFormats', (b) => window.dash.setTimeFormat(b.dataset.tf));
onChip('resList', (b) => window.dash.setResolution({ width: Number(b.dataset.w), height: Number(b.dataset.h) }));
onChip('intervals', (b) => window.dash.setRefresh(Number(b.dataset.ms)));
onChip('nightDims', (b) => window.dash.setNight({ dim: Number(b.dataset.dim) }));

$('coverTgl').addEventListener('change', (e) => window.dash.setCoverTaskbar(e.target.checked));
$('nightTgl').addEventListener('change', (e) => window.dash.setNight({ enabled: e.target.checked }));
$('autoTgl').addEventListener('change', async (e) => {
  // Set the box back to the state actually applied: if Windows refuses the
  // registry write, it must not stay checked.
  e.target.checked = await window.dash.setAutoLaunch(e.target.checked);
});

/** Read from the OS, not the config: the entry may have been disabled from Task Manager. */
async function refreshAutoLaunch() {
  $('autoTgl').checked = await window.dash.getAutoLaunch();
}

/* ---------------- weather city ---------------- */

let siteTimer;
$('siteSearch').addEventListener('input', (e) => {
  clearTimeout(siteTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('siteResults').replaceChildren(); return; }
  siteTimer = setTimeout(async () => {
    const places = await window.dash.searchPlaces(q);
    const ul = $('siteResults');
    ul.replaceChildren(...places.map((p) => {
      const li = el('li');
      li.append(el('span', 'rsSym', p.label), el('span', 'rsVs', p.detail));
      li.addEventListener('click', () => {
        window.dash.setWeatherSite(p);
        $('siteSearch').value = '';
        ul.replaceChildren();
      });
      return li;
    }));
    if (!places.length) ul.appendChild(el('li', 'rsNone', t('settings.noCity')));
  }, 350);
});

/* ---------------- events from the main process ---------------- */

window.dash.onConfig((next) => {
  config = next;
  sync();
  buildDisplayList();   // the dashboard may have moved to another screen
});
window.dash.onLanguage(applyLanguage);
window.dash.onNight((n) => {
  lastNight = n;
  renderNight(n);
});
// "Pick a city" in the dashboard opens the settings on the city search.
window.dash.onFocusSetting((name) => {
  if (name !== 'city') return;
  $('siteSearch').scrollIntoView({ block: 'center' });
  $('siteSearch').focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.target.closest('input')) window.close();
});
// Screens may have been plugged in while the window was in the background.
window.addEventListener('focus', () => {
  buildDisplayList();
  refreshAutoLaunch();
});

/* ---------------- startup ---------------- */

(async function init() {
  config = await window.dash.getConfig();
  lastNight = await window.dash.getNight();
  applyLanguage(await window.dash.getLanguage());
  refreshAutoLaunch();
})();
