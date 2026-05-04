# Inner Ridge Detection From A Binary Stencil Texture

## Goal

Given a binary stencil texture, produce a binary ridge mask of the same resolution that marks the inner ridge pixels of the stencil.

- `stencil`: `Uint8Array` of length `width * height`.
- `stencil[p] != 0`: inside / foreground.
- `stencil[p] == 0`: outside / background.
- `ridge_mask[p] == 255`: ridge pixel.
- `ridge_mask[p] == 0`: not a ridge pixel.

This document describes the current browser-friendly inner-ridge approach. It starts with a JavaScript port of the 2D behavior of `skimage.morphology.medial_axis` in scikit-image v0.24.0, then applies a project pruning pass that removes low-radius ridge branches that fan toward sharp corners.

## Version Target

Source behavior is based on:

- scikit-image v0.24.0 `skimage/morphology/_skeletonize.py`
- scikit-image v0.24.0 `skimage/morphology/_skeletonize_cy.pyx`
- SciPy v1.14.0 `scipy/ndimage/_morphology.py`
- SciPy v1.14.0 `scipy/ndimage/src/ni_morphology.c`

## Source Behavior Summary

The source algorithm:

- converts input to a boolean foreground image;
- builds a 512-entry keep lookup table for 3x3 neighborhoods;
- computes an exact Euclidean distance transform of the foreground;
- computes a cornerness score from the original foreground image;
- sorts foreground pixels by distance, cornerness, and a random permutation tiebreaker;
- runs one ordered thinning pass over the original foreground pixels;
- returns a boolean ridge result, with optional full distance output.

The thinning stage is a single ordered pass. It is not an iterative convergence loop.

The raw scikit-style medial ridge is useful as an intermediate, but it is not the final project output. For sharp rectangular corners, the raw medial ridge can contain corner-fan branches. The project output is the pruned inner ridge.

## Browser Port Decisions

### Project Conventions

- Output is a byte inner ridge mask: `255` for ridge, `0` for not ridge.
- The browser port uses zero-padding before EDT so texture edges count as exterior.
- The browser port may use a deterministic project PRNG for the tiebreaker permutation.
- Mask support from scikit-image is outside the core project API unless explicitly added later.
- The raw medial ridge is kept as a debug/intermediate result. The public project output is the pruned inner ridge.

### Browser Replacements

- SciPy uses an exact Euclidean feature transform. The browser port uses an exact squared Euclidean distance transform for ordering.
- Squared distances are used for sorting because `sqrt` is monotonic.
- Distance is an internal sorting value. The project API returns only `inner_ridge_mask`.

## Inputs

```javascript
function compute_inner_ridge_mask(stencil, width, height, options = {}) {
  // returns Uint8Array inner ridge mask
}
```

Recommended options:

- `seed`: optional deterministic seed for the tiebreaker permutation.

## Outputs

```javascript
inner_ridge_mask
```

## Algorithm

### Normalize Foreground

Category: **scikit parity**

```javascript
function build_binary_foreground(stencil, width, height) {
  const total_pixels = width * height;
  const foreground = new Uint8Array(total_pixels);

  for (let pixel_index = 0; pixel_index < total_pixels; pixel_index++) {
    foreground[pixel_index] = stencil[pixel_index] ? 1 : 0;
  }

  return foreground;
}
```

All later 3x3 packing and thinning uses `0` or `1`, not raw stencil bytes.

### Build The Keep Lookup Table

Category: **scikit parity**

The 3x3 bit layout is:

```text
bit 0  bit 1  bit 2
bit 3  bit 4  bit 5
bit 6  bit 7  bit 8
```

Bit 4 is the center pixel and has value `16`.

For each `neighborhood_index` in `0..511`, keep the center when:

- the center bit is foreground; and
- clearing the center changes the number of 8-connected foreground components in the 3x3 pattern, or the foreground count is less than `3`.

```javascript
function build_keep_lut() {
  const keep_lut = new Uint8Array(512);

  for (let neighborhood_index = 0; neighborhood_index < 512; neighborhood_index++) {
    const center_is_foreground = (neighborhood_index & 16) !== 0;
    if (!center_is_foreground) continue;

    const foreground_count = count_pattern_foreground(neighborhood_index);
    const components_with_center = count_pattern_components(neighborhood_index);
    const components_without_center = count_pattern_components(neighborhood_index & ~16);

    if (components_with_center !== components_without_center || foreground_count < 3) {
      keep_lut[neighborhood_index] = 1;
    }
  }

  return keep_lut;
}

function count_pattern_foreground(neighborhood_index) {
  let foreground_count = 0;

  for (let bit_index = 0; bit_index < 9; bit_index++) {
    foreground_count += (neighborhood_index >> bit_index) & 1;
  }

  return foreground_count;
}

function count_pattern_components(neighborhood_index) {
  const visited = new Uint8Array(9);
  let component_count = 0;

  for (let start_cell = 0; start_cell < 9; start_cell++) {
    if (visited[start_cell]) continue;
    if (((neighborhood_index >> start_cell) & 1) === 0) continue;

    component_count++;
    flood_pattern_component(neighborhood_index, start_cell, visited);
  }

  return component_count;
}

function flood_pattern_component(neighborhood_index, start_cell, visited) {
  const stack = [start_cell];
  visited[start_cell] = 1;

  while (stack.length > 0) {
    const cell = stack.pop();
    const cell_column = cell % 3;
    const cell_row = Math.floor(cell / 3);

    for (let offset_row = -1; offset_row <= 1; offset_row++) {
      for (let offset_column = -1; offset_column <= 1; offset_column++) {
        if (offset_row === 0 && offset_column === 0) continue;

        const neighbor_row = cell_row + offset_row;
        const neighbor_column = cell_column + offset_column;
        if (neighbor_row < 0 || neighbor_row >= 3) continue;
        if (neighbor_column < 0 || neighbor_column >= 3) continue;

        const neighbor_cell = neighbor_row * 3 + neighbor_column;
        if (visited[neighbor_cell]) continue;
        if (((neighborhood_index >> neighbor_cell) & 1) === 0) continue;

        visited[neighbor_cell] = 1;
        stack.push(neighbor_cell);
      }
    }
  }
}
```

### Compute Exact Squared EDT

Category: **browser replacement** plus **project convention**

The project treats the texture edge as exterior for EDT. Compute EDT on a one-pixel zero-padded scratch image, then crop distances back to the original texture size.

Use exact squared Euclidean distance for sorting.

```javascript
function compute_project_distance_squared(foreground, width, height) {
  const padded_width = width + 2;
  const padded_height = height + 2;
  const padded_foreground = new Uint8Array(padded_width * padded_height);

  for (let row_index = 0; row_index < height; row_index++) {
    const source_row_offset = row_index * width;
    const padded_row_offset = (row_index + 1) * padded_width + 1;

    for (let column_index = 0; column_index < width; column_index++) {
      padded_foreground[padded_row_offset + column_index] = foreground[source_row_offset + column_index];
    }
  }

  const padded_distance_squared = compute_exact_distance_squared(
    padded_foreground,
    padded_width,
    padded_height
  );

  const distance_squared = new Float64Array(width * height);

  for (let row_index = 0; row_index < height; row_index++) {
    const target_row_offset = row_index * width;
    const padded_row_offset = (row_index + 1) * padded_width + 1;

    for (let column_index = 0; column_index < width; column_index++) {
      distance_squared[target_row_offset + column_index] = padded_distance_squared[padded_row_offset + column_index];
    }
  }

  return distance_squared;
}
```

The exact separable squared EDT can use a finite-site lower-envelope pass:

```javascript
function edt_1d(samples, sample_count) {
  const distances = new Float64Array(sample_count);
  const locations = new Int32Array(sample_count);
  const boundaries = new Float64Array(sample_count + 1);
  let site_count = 0;

  for (let sample_index = 0; sample_index < sample_count; sample_index++) {
    const sample_value = samples[sample_index];
    if (!Number.isFinite(sample_value)) continue;

    if (site_count === 0) {
      locations[0] = sample_index;
      boundaries[0] = Number.NEGATIVE_INFINITY;
      boundaries[1] = Number.POSITIVE_INFINITY;
      site_count = 1;
      continue;
    }

    let envelope_index = site_count - 1;
    let intersection = 0;

    while (true) {
      const location = locations[envelope_index];
      intersection = (
        (sample_value + sample_index * sample_index)
        - (samples[location] + location * location)
      ) / (2 * sample_index - 2 * location);

      if (intersection > boundaries[envelope_index]) break;

      envelope_index--;
      if (envelope_index < 0) {
        intersection = Number.NEGATIVE_INFINITY;
        break;
      }
    }

    site_count = envelope_index + 2;
    locations[site_count - 1] = sample_index;
    boundaries[site_count - 1] = intersection;
    boundaries[site_count] = Number.POSITIVE_INFINITY;
  }

  if (site_count === 0) {
    distances.fill(Number.POSITIVE_INFINITY);
    return distances;
  }

  let envelope_index = 0;

  for (let sample_index = 0; sample_index < sample_count; sample_index++) {
    while (
      envelope_index + 1 < site_count
      && boundaries[envelope_index + 1] < sample_index
    ) {
      envelope_index++;
    }

    const location = locations[envelope_index];
    const delta = sample_index - location;
    distances[sample_index] = delta * delta + samples[location];
  }

  return distances;
}

function compute_exact_distance_squared(foreground, width, height) {
  const total_pixels = width * height;
  const row_pass = new Float64Array(total_pixels);
  const distance_squared = new Float64Array(total_pixels);
  const row_samples = new Float64Array(width);
  const column_samples = new Float64Array(height);

  for (let row_index = 0; row_index < height; row_index++) {
    const row_offset = row_index * width;

    for (let column_index = 0; column_index < width; column_index++) {
      row_samples[column_index] = foreground[row_offset + column_index]
        ? Number.POSITIVE_INFINITY
        : 0;
    }

    const row_distances = edt_1d(row_samples, width);

    for (let column_index = 0; column_index < width; column_index++) {
      row_pass[row_offset + column_index] = row_distances[column_index];
    }
  }

  for (let column_index = 0; column_index < width; column_index++) {
    for (let row_index = 0; row_index < height; row_index++) {
      column_samples[row_index] = row_pass[row_index * width + column_index];
    }

    const column_distances = edt_1d(column_samples, height);

    for (let row_index = 0; row_index < height; row_index++) {
      distance_squared[row_index * width + column_index] = column_distances[row_index];
    }
  }

  return distance_squared;
}
```

### Compute Cornerness

Category: **scikit parity**

Cornerness is the number of background cells in the 3x3 neighborhood of the original foreground image. Out-of-bounds cells count as background.

```javascript
function compute_cornerness(foreground, width, height) {
  const cornerness = new Uint8Array(width * height);

  for (let row_index = 0; row_index < height; row_index++) {
    for (let column_index = 0; column_index < width; column_index++) {
      const pixel_index = row_index * width + column_index;
      if (!foreground[pixel_index]) continue;

      let foreground_count = 0;

      for (let offset_row = -1; offset_row <= 1; offset_row++) {
        for (let offset_column = -1; offset_column <= 1; offset_column++) {
          const neighbor_row = row_index + offset_row;
          const neighbor_column = column_index + offset_column;
          if (neighbor_row < 0 || neighbor_row >= height) continue;
          if (neighbor_column < 0 || neighbor_column >= width) continue;

          foreground_count += foreground[neighbor_row * width + neighbor_column] ? 1 : 0;
        }
      }

      cornerness[pixel_index] = 9 - foreground_count;
    }
  }

  return cornerness;
}
```

### Determine Processing Order

Category: **scikit parity** for ordering semantics, **project convention** for PRNG identity

Sort foreground pixels by:

- distance ascending;
- cornerness ascending;
- unique random-permutation tiebreaker ascending.

```javascript
function build_processing_order(foreground, distance_squared, cornerness, seed) {
  const foreground_indices = [];

  for (let pixel_index = 0; pixel_index < foreground.length; pixel_index++) {
    if (foreground[pixel_index]) foreground_indices.push(pixel_index);
  }

  const tiebreaker = build_random_permutation(foreground_indices.length, seed);
  const entries = foreground_indices.map((pixel_index, foreground_order_index) => ({
    pixel_index,
    tie_value: tiebreaker[foreground_order_index]
  }));

  entries.sort((left_entry, right_entry) => {
    const left_pixel = left_entry.pixel_index;
    const right_pixel = right_entry.pixel_index;

    const distance_delta = distance_squared[left_pixel] - distance_squared[right_pixel];
    if (distance_delta !== 0) return distance_delta;

    const cornerness_delta = cornerness[left_pixel] - cornerness[right_pixel];
    if (cornerness_delta !== 0) return cornerness_delta;

    return left_entry.tie_value - right_entry.tie_value;
  });

  const order = new Int32Array(entries.length);

  for (let order_index = 0; order_index < entries.length; order_index++) {
    order[order_index] = entries[order_index].pixel_index;
  }

  return order;
}
```

Use Fisher-Yates for the permutation. The permutation values must be unique.

Project PRNG convention:

```javascript
function create_seeded_random(seed = 0) {
  let random_state = seed >>> 0;

  return function next_random_unit() {
    random_state = (random_state + 0x6D2B79F5) >>> 0;
    let mixed_value = random_state;
    mixed_value = Math.imul(mixed_value ^ (mixed_value >>> 15), mixed_value | 1);
    mixed_value ^= mixed_value + Math.imul(mixed_value ^ (mixed_value >>> 7), mixed_value | 61);
    return ((mixed_value ^ (mixed_value >>> 14)) >>> 0) / 4294967296;
  };
}

function build_random_permutation(item_count, seed = 0) {
  const permutation = new Int32Array(item_count);

  for (let item_index = 0; item_index < item_count; item_index++) {
    permutation[item_index] = item_index;
  }

  const next_random_unit = create_seeded_random(seed);

  for (let item_index = item_count - 1; item_index > 0; item_index--) {
    const swap_index = Math.floor(next_random_unit() * (item_index + 1));
    const temporary_value = permutation[item_index];
    permutation[item_index] = permutation[swap_index];
    permutation[swap_index] = temporary_value;
  }

  return permutation;
}
```

This PRNG is a project convention for deterministic browser output. It is not intended to match NumPy PCG64 permutations.

### Run The Ordered Thinning Pass

Category: **scikit parity**

The center bit is forced to `16`. The eight neighbor bits are read from mutable `result`.

```javascript
function compute_ridge_binary(foreground, width, height, order, keep_lut) {
  const result = new Uint8Array(foreground);

  for (let order_index = 0; order_index < order.length; order_index++) {
    const pixel_index = order[order_index];
    const row_index = Math.floor(pixel_index / width);
    const column_index = pixel_index - row_index * width;
    let neighborhood_index = 16;

    if (row_index > 0) {
      const upper_row_offset = (row_index - 1) * width;
      if (column_index > 0 && result[upper_row_offset + column_index - 1]) neighborhood_index += 1;
      if (result[upper_row_offset + column_index]) neighborhood_index += 2;
      if (column_index < width - 1 && result[upper_row_offset + column_index + 1]) neighborhood_index += 4;
    }

    if (column_index > 0 && result[pixel_index - 1]) neighborhood_index += 8;
    if (column_index < width - 1 && result[pixel_index + 1]) neighborhood_index += 32;

    if (row_index < height - 1) {
      const lower_row_offset = (row_index + 1) * width;
      if (column_index > 0 && result[lower_row_offset + column_index - 1]) neighborhood_index += 64;
      if (result[lower_row_offset + column_index]) neighborhood_index += 128;
      if (column_index < width - 1 && result[lower_row_offset + column_index + 1]) neighborhood_index += 256;
    }

    result[pixel_index] = keep_lut[neighborhood_index];
  }

  return result;
}
```

### Promote To Ridge Mask

Category: **project convention**

```javascript
function promote_ridge_mask(ridge_binary) {
  const ridge_mask = new Uint8Array(ridge_binary.length);

  for (let pixel_index = 0; pixel_index < ridge_binary.length; pixel_index++) {
    ridge_mask[pixel_index] = ridge_binary[pixel_index] ? 255 : 0;
  }

  return ridge_mask;
}
```

### Prune Low-Radius Corner Branches

Category: **project convention**

The raw medial ridge can contain branches that run from the true interior ridge toward sharp stencil corners. The project pruning pass removes endpoint branches that climb inward from lower EDT radius to higher EDT radius.

The pruning rule has no tunable threshold:

- work on a mutable copy of the raw medial ridge;
- find ridge endpoints, meaning ridge pixels with `0` or `1` live ridge neighbors in the 8-neighborhood;
- ignore isolated ridge pixels with `0` neighbors;
- remove an endpoint when its squared EDT value is lower than the squared EDT value of its ridge neighbor;
- repeat until no endpoint can be removed.

```javascript
function compute_low_radius_pruning_data(ridge_binary, distance_squared, width, height) {
  const pruned_ridge_binary = new Uint8Array(ridge_binary);
  const removed_ridge_binary = new Uint8Array(ridge_binary.length);
  const pruning_iteration = new Uint16Array(ridge_binary.length);
  let removed_any_pixel = true;
  let pruning_iteration_count = 0;

  while (removed_any_pixel) {
    removed_any_pixel = false;
    const pixels_to_remove = [];

    for (let pixel_index = 0; pixel_index < pruned_ridge_binary.length; pixel_index++) {
      if (!pruned_ridge_binary[pixel_index]) continue;

      const endpoint_info = get_ridge_endpoint_info(
        pruned_ridge_binary,
        distance_squared,
        width,
        height,
        pixel_index
      );

      if (!endpoint_info.is_endpoint) continue;
      if (endpoint_info.neighbor_count === 0) continue;

      if (distance_squared[pixel_index] < endpoint_info.highest_neighbor_distance_squared) {
        pixels_to_remove.push(pixel_index);
      }
    }

    if (pixels_to_remove.length > 0) {
      pruning_iteration_count++;
    }

    for (let removal_index = 0; removal_index < pixels_to_remove.length; removal_index++) {
      const pixel_index = pixels_to_remove[removal_index];
      pruned_ridge_binary[pixel_index] = 0;
      removed_ridge_binary[pixel_index] = 1;
      pruning_iteration[pixel_index] = pruning_iteration_count;
      removed_any_pixel = true;
    }
  }

  return {
    pruned_ridge_binary,
    removed_ridge_binary,
    pruning_iteration,
    pruning_iteration_count
  };
}
```

`removed_ridge_binary`, `pruning_iteration`, and `pruning_iteration_count` are debug outputs for the visualizer. The final mask uses `pruned_ridge_binary`.

### Reference Pipeline

```javascript
function compute_inner_ridge_mask(stencil, width, height, options = {}) {
  const foreground = build_binary_foreground(stencil, width, height);
  const keep_lut = build_keep_lut();
  const distance_squared = compute_project_distance_squared(foreground, width, height);
  const cornerness = compute_cornerness(foreground, width, height);
  const order = build_processing_order(
    foreground,
    distance_squared,
    cornerness,
    options.seed
  );
  const ridge_binary = compute_ridge_binary(foreground, width, height, order, keep_lut);
  const pruning_data = compute_low_radius_pruning_data(
    ridge_binary,
    distance_squared,
    width,
    height
  );

  return promote_ridge_mask(pruning_data.pruned_ridge_binary);
}
```

## Validation Fixtures

Use source-contract tests first, then optional golden outputs from a pinned scikit-image runtime.

Key source-contract checks:

- center-only pattern packs as `16`;
- full 3x3 pattern packs as `511`;
- center-clear keep-LUT entries are `0`;
- isolated center keep-LUT entry is `1`;
- full 3x3 keep-LUT entry is `0`;
- center plus four diagonal corners keep-LUT entry is `1`;
- full 3x3 cornerness is `0`;
- isolated center cornerness is `8`;
- sort priority is distance, then cornerness, then unique tiebreaker;
- thinning starts with center bit `16`;
- thinning reads neighbors from mutable `result`;
- zero-padded EDT gives finite distances to edge-touching and all-foreground project stencils.
- low-radius pruning removes ridge endpoints whose squared EDT is lower than their only ridge neighbor;
- low-radius pruning keeps equal-radius center runs.

Integration fixture candidates:

- isolated foreground pixel;
- two adjacent foreground pixels;
- diagonal foreground connection;
- filled `3x3` square with surrounding background;
- filled `5x3` rectangle with surrounding background;
- filled `5x5` square with surrounding background;
- rectangle touching texture edge;
- two disconnected components;
- shape with a hole;
- tie-heavy ring or symmetric shape;
- all-foreground image under the zero-padded EDT convention.

For the current project output, rectangle fixtures should be checked against `compute_inner_ridge_mask`, not the raw `compute_ridge_mask` baseline.

## Three.js Upload

```javascript
const ridge_texture = new THREE.DataTexture(
  inner_ridge_mask,
  width,
  height,
  THREE.RedFormat,
  THREE.UnsignedByteType
);

ridge_texture.magFilter = THREE.NearestFilter;
ridge_texture.minFilter = THREE.NearestFilter;
ridge_texture.needsUpdate = true;
```

## Open Questions

No open questions remain for the core project API in this spec. Golden fixture generation remains a validation follow-up.
