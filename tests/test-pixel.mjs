import assert from 'node:assert/strict';
import { PixelRenderer } from '../src/render/PixelRenderer.js';
import { QUALITY_PRESETS } from '../src/core/Quality.js';

/**
 * Sharpness guards: quality presets must never render at a quarter of the
 * screen (mushy pixels), and the renderer must clamp the effective scale so
 * small phones stay above `minRenderWidth`.
 */

// --- Presets ---------------------------------------------------------------
assert.equal(QUALITY_PRESETS.low.pixelScale, 2, 'low preset renders half-res, not quarter');
assert.ok(QUALITY_PRESETS.low.colorLevels >= 32, 'low preset keeps enough colours');
assert.equal(QUALITY_PRESETS.medium.pixelScale, 2, 'medium preset half-res');
assert.ok(QUALITY_PRESETS.medium.colorLevels >= 48, 'medium preset colour budget');
assert.equal(QUALITY_PRESETS.high.pixelScale, 1, 'high preset is native resolution');
assert.equal(QUALITY_PRESETS.high.colorLevels, 0, 'high preset skips quantisation');
assert.equal(QUALITY_PRESETS.high.dither, false, 'high preset skips dithering');

// --- Effective scale clamp -------------------------------------------------
function stubRenderer(cssW, cssH) {
  return {
    drawingBufferWidth: cssW,
    drawingBufferHeight: cssH,
    getSize(target) {
      target.set(cssW, cssH);
      return target;
    },
    getDrawingBufferSize(target) {
      target.set(cssW, cssH);
      return target;
    },
    setRenderTarget() {},
    render() {},
  };
}

// Wide desktop: scale 2 applies fully.
const wide = new PixelRenderer(stubRenderer(1920, 1080));
wide.setQuality(QUALITY_PRESETS.low);
assert.equal(wide.effectiveScale, 2, 'initial effective scale equals preset');
const statsWide = (() => {
  wide.render({ isScene: true }, { isCamera: true });
  return wide.getStats();
})();
assert.equal(statsWide.effectiveScale, 2, 'desktop keeps the pixel scale');
assert.equal(statsWide.width, 960, 'target is half the drawing width');

// Small phone: 480 CSS px wide with a 760 px minimum would need scale < 1,
// so it clamps to 1 and renders at full resolution instead of 1/4 width.
const phone = new PixelRenderer(stubRenderer(480, 800));
phone.setQuality(QUALITY_PRESETS.low);
phone.render({ isScene: true }, { isCamera: true });
assert.equal(phone.effectiveScale, 1, 'small screens clamp to native');
assert.equal(phone.getStats().effectiveScale, 1, 'stats report the clamp');
assert.equal(phone.target, null, 'clamped to 1 renders straight, no pixel pass');

// Mid-size screen: partial clamp between 1 and the preset scale.
const mid = new PixelRenderer(stubRenderer(1000, 700));
mid.setQuality(QUALITY_PRESETS.low);
mid.render({ isScene: true }, { isCamera: true });
assert.ok(mid.effectiveScale > 1 && mid.effectiveScale < 2, 'mid screens partially clamp');
assert.ok(mid.getStats().width >= 760 - 1, 'mid screen stays above min width');

// Preset switching updates min width / scale.
mid.setQuality({ ...QUALITY_PRESETS.high, minRenderWidth: 900 });
mid.render({ isScene: true }, { isCamera: true });
assert.equal(mid.getStats().effectiveScale, 1, 'high preset renders native');

console.log('PIXEL PIPELINE TESTS PASSED');
