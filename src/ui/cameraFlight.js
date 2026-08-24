/**
 * src/ui/cameraFlight.js
 *
 * Eased camera flights for the Explore presets and the "Return to overview"
 * control. The flights compose with OrbitControls without fighting it:
 *
 *   - While a flight is active we drive the camera position + target directly
 *     with a smoothstep ease and disable OrbitControls' own damping deltas.
 *   - OrbitControls.update() is still called every frame (so its internal
 *     spherical state stays coherent), but its pointer-driven deltas are
 *     zeroed while flying, so it cannot fight the eased path.
 *   - When the flight finishes, OrbitControls resumes normally; the user can
 *     orbit/zoom/pan again from the bookmarked view.
 *
 * Camera bookmarks are data-driven from each era's declared metadata.presets
 * (read via src/ui/metadata.js).
 */
const EASE = (t) => t * t * (3 - 2 * t);

/**
 * @param {object} ctx  shared app context ({ THREE, camera, controls })
 */
export function createCameraFlight(ctx) {
  const { THREE, camera, controls } = ctx;

  const state = {
    active: false,
    fromPos: null,
    fromTarget: null,
    toPos: null,
    toTarget: null,
    elapsed: 0,
    duration: 1.6,
  };

  /** Begin an eased flight to a { position, target } camera bookmark. */
  function flyTo(bookmark) {
    if (!bookmark) return false;
    state.active = true;
    state.fromPos = camera.position.clone();
    state.fromTarget = controls.target.clone();
    state.toPos = new THREE.Vector3(...bookmark.position);
    state.toTarget = new THREE.Vector3(...bookmark.target);
    state.elapsed = 0;
    // Neutralise any residual OrbitControls damping so it can't fight us.
    controls.enableDamping = false;
    return true;
  }

  /** Per-frame advance; returns true while the flight is still running. */
  function update(delta = 0) {
    if (!state.active) return false;
    state.elapsed = Math.min(state.duration, state.elapsed + Math.min(delta, 0.1));
    const t = EASE(state.elapsed / state.duration);

    camera.position.x = THREE.MathUtils.lerp(state.fromPos.x, state.toPos.x, t);
    camera.position.y = THREE.MathUtils.lerp(state.fromPos.y, state.toPos.y, t);
    camera.position.z = THREE.MathUtils.lerp(state.fromPos.z, state.toPos.z, t);
    controls.target.x = THREE.MathUtils.lerp(state.fromTarget.x, state.toTarget.x, t);
    controls.target.y = THREE.MathUtils.lerp(state.fromTarget.y, state.toTarget.y, t);
    controls.target.z = THREE.MathUtils.lerp(state.fromTarget.z, state.toTarget.z, t);
    camera.lookAt(controls.target);

    if (state.elapsed >= state.duration) {
      state.active = false;
      // Re-enable damping so the user can orbit/zoom from the bookmark.
      controls.enableDamping = true;
      return false;
    }
    return true;
  }

  /** Interrupt a running flight (e.g. the user grabs the orbit). */
  function cancel() {
    if (state.active) {
      state.active = false;
      controls.enableDamping = true;
    }
  }

  return {
    flyTo,
    update,
    cancel,
    get active() { return state.active; },
  };
}