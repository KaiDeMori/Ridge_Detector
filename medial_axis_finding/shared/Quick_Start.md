# Quick Start

This folder contains the active browser-side inner ridge experiment.

## Files

- `medial_ridge.js` contains the ridge code.
- `medial_ridge_visualizer.html` loads a PNG stencil and shows debug images.
- `medial_ridge_tests.html` runs browser tests.

## Basic Use

Include the script in a browser page:

```html
<script src="Ridge_Test/medial_ridge.js"></script>
```

Call the public API (recommended):

```javascript
const inner_ridge_mask = window.medial_ridge.compute_inner_ridge_mask_advanced(
  stencil,
  width,
  height,
  // options are optional; defaults shown below
  { seed: 0 } 
);
```

Inputs:

- `stencil`: `Uint8Array` with `width * height` entries.
- nonzero stencil pixel means inside.
- zero stencil pixel means outside.

Defaults used by `compute_inner_ridge_mask_advanced`:
- thinning: synchronous plateau thinning
- tie-breaking: deterministic
- connectivity: 8-connected (engine default)
- pruning: endpoint-based low-radius pruning

Output:

- `inner_ridge_mask`: `Uint8Array` with `255` for ridge pixels and `0` for everything else.

## Three.js Upload

```javascript
const inner_ridge_texture = new THREE.DataTexture(
  inner_ridge_mask,
  width,
  height,
  THREE.RedFormat,
  THREE.UnsignedByteType
);

inner_ridge_texture.magFilter = THREE.NearestFilter;
inner_ridge_texture.minFilter = THREE.NearestFilter;
inner_ridge_texture.needsUpdate = true;
```

## Visualizer

Open the visualizer from the `Work_Permit_Olympus_Mons` webroot with a PNG path relative to that webroot:

```text
Ridge_Test/medial_ridge_visualizer.html?file=Ridge_Test/ridge_test_texture.png
```

The PNG stencil should use black for outside and white or red-channel-nonzero pixels for inside.

## Debug API

Use `compute_ridge_data` when you need intermediate images or want to override defaults:

```javascript
const ridge_data = window.medial_ridge.compute_ridge_data(stencil, width, height, {
  seed: 0,
  thinningMode: 'synchronous',        // or 'sequential'
  deterministic: true                  // or false
});
```

Useful debug fields:

- `foreground`
- `distance_squared`
- `cornerness`
- `order`
- `ridge_binary`
- `pruned_ridge_binary`
- `removed_ridge_binary`
- `pruning_iteration`
- `pruning_iteration_count`

## Modularity Note

The current state is modular enough for use in the project:

- `compute_inner_ridge_mask` is the small runtime-facing API.
- `compute_inner_ridge_mask_advanced` uses the recommended defaults and is preferred.
- `compute_ridge_data` is the debug and visualizer API.
- the raw medial ridge remains available as an intermediate for comparison.
- the final project output is the low-radius-pruned inner ridge mask.