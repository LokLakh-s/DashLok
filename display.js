/**
 * Picks the dashboard screen. No Electron dependency: screens are passed as
 * arguments (shape of screen.getAllDisplays()).
 */

/**
 * Screen to cover: the one saved in the settings, found by id or else by
 * resolution (the id may change when the screen moves to another port).
 * Without a saved choice, the small secondary screen: 960 x 640, or else the
 * smallest dashboard-shaped secondary screen (see isDashboardShaped). null when
 * none fits: the primary screen is never covered unless it was picked.
 *
 * @param {Array} displays        connected screens
 * @param {number} primaryId      id of the primary screen
 * @param {?{id, width, height}} remembered  screen picked in the settings
 */
function findTargetDisplay(displays, primaryId, remembered) {
  if (remembered) {
    return displays.find((d) => d.id === remembered.id)
      || displays.find((d) => d.bounds.width === remembered.width && d.bounds.height === remembered.height)
      || null;
  }
  const secondary = displays.filter((d) => d.id !== primaryId);
  const exact = secondary.find((d) => d.bounds.width === 960 && d.bounds.height === 640);
  if (exact) return exact;
  const small = secondary
    .filter((d) => isDashboardShaped(d.bounds))
    .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
  return small[0] || null;
}

/**
 * Small panel, landscape or portrait (up to 1100 x 800), or bar screen (at
 * least 2.4:1 with a short side up to 800, e.g. 1920 x 480, 2560 x 720). Excludes
 * ordinary monitors and laptop panels, even rotated (16:9 is 1.78:1).
 */
function isDashboardShaped({ width, height }) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return short <= 800 && (long <= 1100 || long / short >= 2.4);
}

/** What is kept of a screen to find it again at the next launch. */
function displayKey(d) {
  return { id: d.id, width: d.bounds.width, height: d.bounds.height };
}

/** True when rectangle `b` overlaps at least one screen: otherwise the window would be off-screen. */
function isOnScreen(displays, b) {
  return displays.some(({ bounds: d }) =>
    b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y);
}

/**
 * Screen whose work area the rectangle `b` fills, to within the width of a
 * window border. Before DashLok remembered the maximized state, a maximized
 * window was saved as its bounds, which on Windows stick out of the work area
 * by the invisible border (-8, -8 and 16 px larger): those bounds are the trace
 * of a maximized window. null when `b` is an ordinary window.
 */
function maximizedOn(displays, b, tolerance = 16) {
  const near = (a, c, tol) => Math.abs(a - c) <= tol;
  return displays.find(({ workArea: w }) =>
    near(b.x, w.x, tolerance) && near(b.y, w.y, tolerance)
    && near(b.width, w.width, 2 * tolerance) && near(b.height, w.height, 2 * tolerance)) || null;
}

/** Rectangle of the given size centred in `area`, clamped to it. */
function centeredIn(area, width, height) {
  const w = Math.min(width, area.width);
  const h = Math.min(height, area.height);
  return {
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + (area.height - h) / 2),
    width: w,
    height: h,
  };
}

module.exports = { findTargetDisplay, isDashboardShaped, displayKey, isOnScreen, maximizedOn, centeredIn };
