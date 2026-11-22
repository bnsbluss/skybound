/**
 * Feature-detected Fullscreen API wrapper. Browsers disagree on prefixes
 * (WebKit still needs `webkit` on many mobile builds), so every entry point
 * is resolved at call time and exposed with one uniform shape.
 */
export function fullscreenApi() {
  const el = document.documentElement;
  const request =
    el.requestFullscreen?.bind(el) ||
    el.webkitRequestFullscreen?.bind(el) ||
    null;
  const exit =
    document.exitFullscreen?.bind(document) ||
    document.webkitExitFullscreen?.bind(document) ||
    null;
  return {
    supported: !!(request || exit),
    request,
    exit,
    active: () => !!(document.fullscreenElement || document.webkitFullscreenElement),
  };
}
