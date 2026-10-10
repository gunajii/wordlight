// Prints "<windowId> <x> <y> <w> <h>" for the Vega Virtual Device window (macOS, JXA), or nothing if it is not on screen.
//   osascript -l JavaScript tools/vvd/vvd-window.js
// Window titles are only visible to a process with Screen Recording permission (Terminal has it for record.sh).
ObjC.import('CoreGraphics');
function run() {
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID))) || [];
  const w = all.find((x) => x.kCGWindowName === 'Vega Virtual Device' || /vega-virtual-device/i.test(x.kCGWindowOwnerName || ''));
  if (!w) return '';
  const b = w.kCGWindowBounds;
  return [w.kCGWindowNumber, b.X, b.Y, b.Width, b.Height].map((n) => Math.round(n)).join(' ');
}
