/**
 * The orbit's 3D tilt, expressed as a plain vertical squash factor rather
 * than a real CSS `rotateX` + `perspective`. `rotateX(deg)` on a flat plane
 * IS a vertical scale by cos(deg) under orthographic projection — visually
 * indistinguishable from a "real" 3D transform for a flat, thin-lined shape
 * like this orbit, at any angle, not just shallow ones (the only thing a
 * true perspective camera adds is near/far size falloff, which doesn't
 * read as meaningfully different here since every ring/node is roughly the
 * same distance from center).
 *
 * Using a plain scaleY instead of rotateX/perspective/offset-path sidesteps
 * a real risk in this codebase specifically: every visual bug found in this
 * orbit view so far (upside-down labels, the radar sweep bleeding off the
 * layout, the zoom effect starting from the wrong point) has come from two
 * transforms silently fighting over the same element, or a transform on
 * one element not composing the way a *different* element's geometry
 * assumed it would. `rotateX` + `preserve-3d` + `offset-path` all
 * interacting correctly (node positioned along a tilted ellipse, but its
 * own icon/label counter-tilted back to upright) is exactly that kind of
 * composition, with less consistent cross-browser behavior to boot. A
 * scaleY wrapper around the whole rotating ring (so the ring's own
 * rotation produces the circular motion first, then gets uniformly
 * flattened into an ellipse) plus a counter scaleY on each node (to undo
 * the flattening for its own content) achieves the identical visual result
 * with two plain, well-understood 2D transforms.
 *
 * (A genuine Three.js/WebGL rebuild of this view was also tried and
 * reverted — real 3D geometry, real camera tilt — but the result read as
 * too heavy/too much for this dashboard: a boxed rectangular canvas with a
 * blown-out light glow that clashed with the flat, borderless rest of the
 * UI. This CSS approach's subtlety is the better fit here, not a fallback.)
 */
export const ORBIT_TILT_DEG = 37;
export const ORBIT_TILT_Y_SCALE = Math.cos((ORBIT_TILT_DEG * Math.PI) / 180);

/**
 * An additional in-plane rotation ("bank") on top of the vertical squash —
 * a squash alone gives a symmetric, level ellipse (major axis perfectly
 * horizontal), which reads as looking straight down at a flat disc. Banking
 * it a bit gives the "hanging"/tilted-plane look instead: one side reads as
 * nearer, the other farther, like a real orbit's plane doesn't happen to
 * align with the screen's own horizontal.
 *
 * Applied two ways, both natively (no extra ancestor transform needed):
 * the ring outline/radar sweep wrapper gets a plain CSS `rotate()` added
 * alongside its existing `scaleY()`, and each node's elliptical
 * `offset-path` gets this same angle passed as the SVG arc command's own
 * x-axis-rotation parameter — arcs support rotating the ellipse they
 * describe natively, so the path itself is just a differently-oriented
 * curve; `offset-rotate: 0deg` still holds each node upright regardless of
 * how the path is oriented, exactly as before.
 */
// Explicitly rejected ("not to side") — a level, symmetric rotateX-style
// tilt only. Kept as a named constant (rather than removing the plumbing)
// since ellipsePath()/the ring wrapper both take it as a parameter; 0
// means no banking anywhere.
export const ORBIT_BANK_DEG = 0;
