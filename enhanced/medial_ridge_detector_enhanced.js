// Enhanced inner-ridge detector. A re-interpretation of scikit-image's medial_axis
// that adds corner smoothing and parallel checkerboard thinning so it stays stable
// on spiky / sharp-cornered shapes. High-level overview: docs/enhanced_approach.md.
(function expose_medial_ridge(global_scope) {
  "use strict";

  const DEFAULT_RIDGE_SEED = 42;

  // Every possible 3x3 binary neighborhood: 9 cells, each 0 or 1, packed into a 9-bit
  // index. 2^9 = 512 patterns, one keep_lut slot each. Tied to the 3x3 window the
  // thinning is built on — not a tunable value.
  const NEIGHBORHOOD_PATTERN_COUNT = 1 << 9;

  const MEDIAL_RIDGE_DEFAULT_CONFIG = {
    // Seed for the tie-break shuffle; only consulted when deterministic === false.
    seed: DEFAULT_RIDGE_SEED,
    // Thinning strategy. "parallel_checkerboard" is the stable default; any other
    // value falls back to the sequential, order-dependent thinning.
    thinning_mode: "parallel_checkerboard",
    // When true, pixels are processed in a fixed order (no randomness). This trades
    // away symmetry-breaking for fully reproducible output.
    deterministic: true,
    // Corner smoothing, applied to the mask *before* thinning to stop sharp corners
    // from spawning spurious ridge branches. These two are independent passes:
    //   smooth_open  -> morphological opening: shaves convex (outer) spikes/corners.
    //   smooth_close -> morphological closing: fills concave (inner) notches.
    smooth_open: true,
    smooth_close: true,
    // How the smoothing radius is chosen:
    //   auto_radius true  -> derive it from the shape's own corner curvature.
    //   auto_radius false -> use the fixed smoothing_radius below.
    auto_radius: true,
    smoothing_radius: 4,
  };

  // The single entry point. Runs the whole pipeline and returns every intermediate
  // (so the visualizer can show each step) alongside the two results that matter:
  // ridge_binary (raw medial ridge) and pruned_ridge_binary (final inner ridge).
  // Stages: binarize -> (corner smoothing) -> distance transform -> thinning -> pruning.
  function compute_ridge_data(stencil, width, height, options) {
    validate_stencil_input(stencil, width, height);

    let foreground = build_binary_foreground(stencil, width, height);
    const original_foreground = new Uint8Array(foreground);
    let curvature_hat = null;
    let chosen_global_radius = 0;
    let exposed_auto_global_radius = 0;
    let exposed_auto_sigma = 0;
    let exposed_auto_q = 0;
    if (options.smooth_open || options.smooth_close) {
      const picked_auto = pick_global_corner_radius(foreground, width, height);
      const auto_global_radius = picked_auto.radius | 0;
      const auto_sigma = picked_auto.sigma || 0;
      const auto_q = picked_auto.q || 0;
      if (options.auto_radius) {
        curvature_hat = picked_auto.curvature_hat;
        chosen_global_radius = auto_global_radius;
      } else {
        chosen_global_radius = Math.max(0, Math.floor(options.smoothing_radius));
      }

      if (chosen_global_radius >= 1) {
        if (options.smooth_open) {
          foreground = morphological_close_inner_and_outer_corners(foreground, width, height, chosen_global_radius);
        }
        if (options.smooth_close) {
          foreground = morphological_closing(foreground, width, height, chosen_global_radius);
        }
      }

      exposed_auto_global_radius = auto_global_radius;
      exposed_auto_sigma = auto_sigma;
      exposed_auto_q = auto_q;
    }
    // keep_lut: 512-entry lookup keyed by the 3x3 neighborhood; decides whether a
    // pixel may be deleted during thinning without breaking the line's topology.
    const keep_lut = build_keep_lut_with_connectivity(8);
    // distance_squared drives both the thinning order (boundary inward) and pruning.
    const distance_squared = compute_distance_to_background_squared(foreground, width, height);
    const cornerness = compute_cornerness(foreground, width, height);
    const order = build_processing_order(foreground, distance_squared, cornerness, options.seed, options.deterministic);
    // Default path is checkerboard thinning; the `order` array only feeds the
    // sequential fallback. Both erode the mask down to a 1px ridge using keep_lut.
    const ridge_binary = options.thinning_mode === "parallel_checkerboard" ? compute_ridge_binary_parallel_checkerboard(foreground, width, height, distance_squared, keep_lut) : compute_ridge_binary(foreground, width, height, order, keep_lut);

    const pruning_data = compute_low_radius_pruning_data(ridge_binary, distance_squared, width, height);
    const pruned_ridge_binary = pruning_data.pruned_ridge_binary;

    return {
      foreground,
      original_foreground,
      keep_lut,
      distance_squared,
      cornerness,
      order,
      ridge_binary,

      pruned_ridge_binary,

      removed_ridge_binary: pruning_data.removed_ridge_binary,
      pruning_iteration: pruning_data.pruning_iteration,
      pruning_iteration_count: pruning_data.pruning_iteration_count,
      curvature_hat,
      global_radius: chosen_global_radius,
      auto_global_radius: exposed_auto_global_radius,
      auto_radius_sigma: exposed_auto_sigma,
      auto_radius_q: exposed_auto_q,
    };
  }

  function create_default_options() {
    return { ...MEDIAL_RIDGE_DEFAULT_CONFIG };
  }

  function validate_stencil_input(stencil, width, height) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new RangeError("width must be a positive integer");
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new RangeError("height must be a positive integer");
    }
    if (!stencil || stencil.length !== width * height) {
      throw new RangeError("stencil length must equal width * height");
    }
  }

  function build_binary_foreground(stencil, width, height) {
    const total_pixels = width * height;
    const foreground = new Uint8Array(total_pixels);

    for (let pixel_index = 0; pixel_index < total_pixels; pixel_index++) {
      foreground[pixel_index] = stencil[pixel_index] ? 1 : 0;
    }

    return foreground;
  }

  // Precompute, for every possible 3x3 neighborhood (9 bits, center = bit 4), whether
  // the center pixel must be kept during thinning. A pixel is kept when deleting it
  // would change the topology and so cannot be safely thinned away:
  //   - it is a connection point: removing it splits the local component
  //     (component count changes when the center is cleared), or
  //   - it is an endpoint / thin enough already (fewer than 3 foreground pixels),
  //     so removing it would erode the line rather than thin it.
  // Doing this as a table means thinning is just an O(1) lookup per pixel.
  function build_keep_lut_with_connectivity(connectivity) {
    const keep_lut = new Uint8Array(NEIGHBORHOOD_PATTERN_COUNT);

    for (let neighborhood_index = 0; neighborhood_index < NEIGHBORHOOD_PATTERN_COUNT; neighborhood_index++) {
      const center_is_foreground = (neighborhood_index & 16) !== 0;
      if (!center_is_foreground) continue;

      const foreground_count = count_pattern_foreground(neighborhood_index);
      const components_with_center = count_pattern_components_by_connectivity(neighborhood_index, connectivity);
      const components_without_center = count_pattern_components_by_connectivity(neighborhood_index & ~16, connectivity);

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

  function count_pattern_components_by_connectivity(neighborhood_index, connectivity) {
    const visited = new Uint8Array(9);
    let component_count = 0;

    for (let start_cell = 0; start_cell < 9; start_cell++) {
      if (visited[start_cell]) continue;
      if (((neighborhood_index >> start_cell) & 1) === 0) continue;

      component_count++;
      flood_pattern_component(neighborhood_index, start_cell, visited, connectivity);
    }

    return component_count;
  }

  function flood_pattern_component(neighborhood_index, start_cell, visited, connectivity) {
    const stack = [start_cell];
    visited[start_cell] = 1;

    while (stack.length > 0) {
      const cell = stack.pop();
      const cell_column = cell % 3;
      const cell_row = Math.floor(cell / 3);

      for (let offset_row = -1; offset_row <= 1; offset_row++) {
        for (let offset_column = -1; offset_column <= 1; offset_column++) {
          if (offset_row === 0 && offset_column === 0) continue;
          if (connectivity === 4 && Math.abs(offset_row) + Math.abs(offset_column) !== 1) continue; // skip diagonals

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

  function compute_distance_to_background_squared(foreground, width, height) {
    return compute_distance_to_background_squared_with_border(foreground, width, height, 0);
  }

  function compute_distance_to_background_squared_with_border(foreground, width, height, borderForegroundValue) {
    const padded_width = width + 2;
    const padded_height = height + 2;
    const padded_foreground = new Uint8Array(padded_width * padded_height);

    if (borderForegroundValue) {
      // Fill the border with 1s (foreground) to avoid creating background sites at the image edge
      for (let x = 0; x < padded_width; x++) {
        padded_foreground[x] = 1; // top row
        padded_foreground[(padded_height - 1) * padded_width + x] = 1; // bottom row
      }
      for (let y = 0; y < padded_height; y++) {
        padded_foreground[y * padded_width] = 1; // left col
        padded_foreground[y * padded_width + (padded_width - 1)] = 1; // right col
      }
    }

    for (let row_index = 0; row_index < height; row_index++) {
      const source_row_offset = row_index * width;
      const padded_row_offset = (row_index + 1) * padded_width + 1;

      for (let column_index = 0; column_index < width; column_index++) {
        padded_foreground[padded_row_offset + column_index] = foreground[source_row_offset + column_index];
      }
    }

    const padded_distance_squared = compute_exact_distance_squared(padded_foreground, padded_width, padded_height);
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

  function invert_binary_mask(mask) {
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
    return out;
  }

  // Morphology via distance transform: a pixel is "within radius" of the mask iff its
  // distance to the mask is <= radius. This gives a true circular (Euclidean) structuring
  // element for free, instead of the boxy result of repeated 3x3 passes.
  function dilate_mask(mask, width, height, radius) {
    if (radius <= 0) return new Uint8Array(mask);
    const inv = invert_binary_mask(mask);
    // Important: pad the border as foreground (1) to avoid spurious zero-sites at image edges in 'inv'.
    const d2 = compute_distance_to_background_squared_with_border(inv, width, height, 1); // distance to inv==0 (i.e., original mask)
    const r2 = radius * radius;
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) out[i] = d2[i] <= r2 ? 1 : 0;
    return out;
  }

  function erode_mask(mask, width, height, radius) {
    if (radius <= 0) return new Uint8Array(mask);
    const d2_to_bg = compute_distance_to_background_squared(mask, width, height); // distance to background
    const r2 = radius * radius;
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) out[i] = mask[i] && d2_to_bg[i] > r2 ? 1 : 0;
    return out;
  }

  // Opening (erode then dilate): removes foreground detail thinner than `radius`,
  // i.e. shaves off sharp convex spikes/corners while leaving the bulk shape intact.
  function morphological_close_inner_and_outer_corners(mask, width, height, radius) {
    const eroded = erode_mask(mask, width, height, radius);
    const opened = dilate_mask(eroded, width, height, radius);
    return opened;
  }

  // Closing (dilate then erode): fills background detail thinner than `radius`,
  // i.e. rounds out concave notches and bridges hairline gaps.
  function morphological_closing(mask, width, height, radius) {
    const dilated = dilate_mask(mask, width, height, radius);
    const closed = erode_mask(dilated, width, height, radius);
    return closed;
  }

  function compute_signed_distance(original_mask, width, height) {
    const d2_to_bg = compute_distance_to_background_squared(original_mask, width, height);
    const inv = invert_binary_mask(original_mask);
    const d2_to_fg = compute_distance_to_background_squared_with_border(inv, width, height, 0); // no border pad for signed outside
    const phi = new Float64Array(width * height);
    for (let i = 0; i < phi.length; i++) {
      if (original_mask[i]) phi[i] = Math.sqrt(d2_to_bg[i]);
      else phi[i] = -Math.sqrt(d2_to_fg[i]);
    }
    return phi;
  }

  function gaussian_kernel_1d(sigma) {
    const radius = Math.max(1, Math.ceil(3 * sigma));
    const size = radius * 2 + 1;
    const k = new Float64Array(size);
    const s2 = sigma * sigma * 2;
    let sum = 0;
    for (let i = -radius, j = 0; i <= radius; i++, j++) {
      const v = Math.exp(-(i * i) / s2);
      k[j] = v;
      sum += v;
    }
    for (let j = 0; j < size; j++) k[j] /= sum;
    return { kernel: k, radius };
  }

  // Auto-pick a single smoothing radius from the shape's own geometry, so smoothing
  // scales with the shape instead of using a hard-coded pixel count. Strategy:
  //   1. Estimate the shape's scale R_med (median local thickness, from the EDT).
  //   2. Build a smoothed signed distance field and measure boundary curvature
  //      (divergence of the normal) at a scale tied to R_med.
  //   3. Take a high quantile of the sharpest outward curvature -> the radius of the
  //      tightest corners we want to round, clamped to a sane range.
  // The math is dense; the contract is simply: mask in, a good integer radius out.
  // `curvature_hat`, `sigma`, `q` are returned only for visualization/debugging.
  function pick_global_corner_radius(mask, width, height) {
    // Estimate scale R_med
    const d2_bg = compute_distance_to_background_squared(mask, width, height);
    const radii = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        const v = d2_bg[i];
        if (!(v > 0)) continue;
        let isMax = true;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const yy = y + oy,
              xx = x + ox;
            if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
            if (d2_bg[yy * width + xx] > v) {
              isMax = false;
              break;
            }
          }
          if (!isMax) break;
        }
        if (isMax) radii.push(Math.sqrt(v));
      }
    }
    const R_med = radii.length ? radii.sort((a, b) => a - b)[Math.floor(radii.length / 2)] : 2;

    // Signed distance and smoothing at σ = 0.25·R_med
    const phi = compute_signed_distance(mask, width, height);
    const sigma = Math.max(0.5, 0.25 * R_med);
    const phi_s = convolve_gaussian_separable(phi, width, height, sigma);

    // Outward-only normalized curvature
    const div_n = compute_divergence_of_normal(phi_s, width, height);
    const kappa_hat_pos = new Float64Array(div_n.length);
    for (let i = 0; i < div_n.length; i++) {
      const k_out = -div_n[i];
      kappa_hat_pos[i] = Math.max(0, sigma * k_out);
    }

    // Collect boundary band positives
    const vals = [];
    for (let i = 0; i < phi_s.length; i++) {
      if (Math.abs(phi_s[i]) <= 2) {
        const v = kappa_hat_pos[i];
        if (v > 0) vals.push(v);
      }
    }

    const q = 0.95;
    const ref = vals.length ? quantile(vals, q) : 0;
    let r = 1;
    if (ref > 1e-6) {
      const rho = sigma / ref; // osculating radius at reference corner
      const rmax = Math.min(12, Math.max(1, 0.5 * R_med));
      const gamma = 1.0;
      r = Math.max(1, Math.min(rmax, Math.round(gamma * rho)));
    }

    // Pack curvature for debug
    const curvature_hat = new Float32Array(kappa_hat_pos.length);
    for (let i = 0; i < kappa_hat_pos.length; i++) curvature_hat[i] = kappa_hat_pos[i];
    return { radius: r | 0, curvature_hat, sigma, q };
  }

  function convolve_gaussian_separable(src, width, height, sigma) {
    if (!(sigma > 0)) return new Float64Array(src);
    const { kernel, radius } = gaussian_kernel_1d(sigma);
    const tmp = new Float64Array(width * height);
    const dst = new Float64Array(width * height);
    // horizontal
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = Math.max(0, Math.min(width - 1, x + k));
          acc += src[row + xx] * kernel[k + radius];
        }
        tmp[row + x] = acc;
      }
    }
    // vertical
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.max(0, Math.min(height - 1, y + k));
          acc += tmp[yy * width + x] * kernel[k + radius];
        }
        dst[y * width + x] = acc;
      }
    }
    return dst;
  }

  function compute_divergence_of_normal(phi_s, width, height) {
    const eps = 1e-6;
    const nx = new Float64Array(width * height);
    const ny = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const xm = Math.max(0, x - 1),
          xp = Math.min(width - 1, x + 1);
        const ym = Math.max(0, y - 1),
          yp = Math.min(height - 1, y + 1);
        const dphidx = (phi_s[y * width + xp] - phi_s[y * width + xm]) * 0.5;
        const dphidy = (phi_s[yp * width + x] - phi_s[ym * width + x]) * 0.5;
        const g = Math.sqrt(dphidx * dphidx + dphidy * dphidy) + eps;
        // inward unit normal n_in = grad(phi_s)/|grad|
        nx[i] = dphidx / g;
        ny[i] = dphidy / g;
      }
    }
    const div_n = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const xm = Math.max(0, x - 1),
          xp = Math.min(width - 1, x + 1);
        const ym = Math.max(0, y - 1),
          yp = Math.min(height - 1, y + 1);
        const dnx = (nx[y * width + xp] - nx[y * width + xm]) * 0.5;
        const dny = (ny[yp * width + x] - ny[ym * width + x]) * 0.5;
        div_n[i] = dnx + dny; // divergence of inward normal
      }
    }
    return div_n;
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    const arr = values.slice().sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * q)));
    return arr[idx];
  }

  // 1D exact squared distance transform (Felzenszwalb & Huttenlocher): computes the
  // lower envelope of parabolas seeded at each sample. Running it over rows then
  // columns yields an exact 2D Euclidean distance transform. The envelope/intersection
  // bookkeeping below is the standard form of that algorithm; left uncommented because
  // it only makes sense against the paper.
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
        intersection = (sample_value + sample_index * sample_index - (samples[location] + location * location)) / (2 * sample_index - 2 * location);

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
      while (envelope_index + 1 < site_count && boundaries[envelope_index + 1] < sample_index) {
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
        row_samples[column_index] = foreground[row_offset + column_index] ? Number.POSITIVE_INFINITY : 0;
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

  // Per-pixel count of background cells in the 3x3 neighborhood (0 = interior,
  // higher = closer to a corner/edge). Used only as a tie-breaker in the thinning order.
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

  // Order foreground pixels for the sequential thinning fallback: smallest distance
  // first (peel from the boundary inward), then cornerness, then a stable/seeded
  // tie-break. The checkerboard thinner doesn't use this; it sorts by distance itself.
  function build_processing_order(foreground, distance_squared, cornerness, seed = DEFAULT_RIDGE_SEED, deterministic = false) {
    const foreground_indices = [];

    for (let pixel_index = 0; pixel_index < foreground.length; pixel_index++) {
      if (foreground[pixel_index]) foreground_indices.push(pixel_index);
    }

    let tiebreaker;
    if (!deterministic) {
      tiebreaker = build_random_permutation(foreground_indices.length, seed);
    }
    const entries = foreground_indices.map((pixel_index, foreground_order_index) => {
      const tie_value = deterministic
        ? pixel_index // stable, symmetry-friendly order
        : tiebreaker[foreground_order_index];
      return { pixel_index, tie_value };
    });

    entries.sort((left_entry, right_entry) => {
      const left_pixel = left_entry.pixel_index;
      const right_pixel = right_entry.pixel_index;
      const left_distance = distance_squared[left_pixel];
      const right_distance = distance_squared[right_pixel];

      if (left_distance < right_distance) return -1;
      if (left_distance > right_distance) return 1;

      const left_cornerness = cornerness[left_pixel];
      const right_cornerness = cornerness[right_pixel];

      if (left_cornerness < right_cornerness) return -1;
      if (left_cornerness > right_cornerness) return 1;

      return left_entry.tie_value - right_entry.tie_value;
    });

    const order = new Int32Array(entries.length);

    for (let order_index = 0; order_index < entries.length; order_index++) {
      order[order_index] = entries[order_index].pixel_index;
    }

    return order;
  }

  // Default thinning. The key idea that makes it stable: process pixels in two passes
  // by checkerboard parity. Two pixels of the same parity are never 4-adjacent, so no
  // two neighbors are tested against the same (stale) state and deleted together —
  // which is exactly what would break a one-pixel line under naive parallel deletion.
  // Working outward by distance level keeps the result centered on the medial axis.
  function compute_ridge_binary_parallel_checkerboard(foreground, width, height, distance_squared, keep_lut) {
    const result = new Uint8Array(foreground);

    const levels = group_by_distance_squared_level(distance_squared, foreground);

    for (let level = 1; level < levels.length; level++) {
      const indices = levels[level];
      if (!indices || indices.length === 0) continue;

      // Deterministic iteration order
      indices.sort((a, b) => a - b);

      let changed = true;
      while (changed) {
        changed = false;

        // Two checkerboard sub-iterations: parity 0 then 1
        for (let parity = 0; parity <= 1; parity++) {
          const to_remove = [];

          for (let i = 0; i < indices.length; i++) {
            const pixel_index = indices[i];
            if (!result[pixel_index]) continue; // already removed

            const row_index = Math.floor(pixel_index / width);
            const column_index = pixel_index - row_index * width;
            if (((row_index + column_index) & 1) !== parity) continue;

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

            if (!keep_lut[neighborhood_index]) {
              to_remove.push(pixel_index);
            }
          }

          if (to_remove.length > 0) {
            changed = true;
            for (let j = 0; j < to_remove.length; j++) {
              result[to_remove[j]] = 0;
            }
          }
        }
      }
    }

    return result;
  }

  function group_by_distance_squared_level(distance_squared, foreground) {
    let max_level = 0;

    for (let i = 0; i < distance_squared.length; i++) {
      if (!foreground[i]) continue;
      const v = distance_squared[i];
      if (!Number.isFinite(v)) continue;
      const d = Math.max(0, Math.round(v));
      if (d > max_level) max_level = d;
    }

    const levels = new Array(max_level + 1);

    for (let i = 0; i < distance_squared.length; i++) {
      if (!foreground[i]) continue;
      const v = distance_squared[i];
      if (!Number.isFinite(v)) continue;
      const d = Math.max(0, Math.round(v));
      if (!levels[d]) levels[d] = [];
      levels[d].push(i);
    }

    return levels;
  }

  function create_seeded_random(seed = DEFAULT_RIDGE_SEED) {
    let random_state = seed >>> 0;

    return function next_random_unit() {
      random_state = (random_state + 0x6d2b79f5) >>> 0;
      let mixed_value = random_state;
      mixed_value = Math.imul(mixed_value ^ (mixed_value >>> 15), mixed_value | 1);
      mixed_value ^= mixed_value + Math.imul(mixed_value ^ (mixed_value >>> 7), mixed_value | 61);
      return ((mixed_value ^ (mixed_value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build_random_permutation(item_count, seed = DEFAULT_RIDGE_SEED) {
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

  // Sequential thinning fallback (used when thinning_mode !== "parallel_checkerboard").
  // Visits pixels in `order` and deletes each one in place via the keep_lut. Simpler,
  // but the outcome depends on visit order, which is why checkerboard is the default.
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

  // Final cleanup. Thinning can leave short "whisker" branches reaching out toward
  // corners; they show up as endpoints whose distance-to-background (radius) is smaller
  // than the neighbor they hang off of. We iteratively peel back any such endpoint until
  // none remain, leaving only the central spine. `removed_*` / `pruning_iteration` are
  // recorded purely so the visualizer can show what got pruned and when.
  function compute_low_radius_pruning_data(ridge_binary, distance_squared, width, height) {
    const pruned_ridge_binary = new Uint8Array(ridge_binary);
    const removed_ridge_binary = new Uint8Array(ridge_binary.length);
    const pruning_iteration = new Uint16Array(ridge_binary.length);
    let removed_any_pixel = true;
    let pruning_iteration_count = 0;

    while (removed_any_pixel) {
      removed_any_pixel = false;
      let pixels_to_remove = [];
      const marked_to_remove = new Uint8Array(pruned_ridge_binary.length);

      function scheduleRemoval(idx) {
        if (idx < 0) return;
        if (!marked_to_remove[idx]) {
          marked_to_remove[idx] = 1;
          pixels_to_remove.push(idx);
        }
      }

      // Single-mode pruning
      for (let pixel_index = 0; pixel_index < pruned_ridge_binary.length; pixel_index++) {
        if (!pruned_ridge_binary[pixel_index]) continue;

        const endpoint_info = get_ridge_endpoint_info(pruned_ridge_binary, distance_squared, width, height, pixel_index);
        if (!endpoint_info.is_endpoint) continue;
        if (endpoint_info.neighbor_count === 0) continue;

        const d2 = distance_squared[pixel_index];
        const neighbor_best = endpoint_info.highest_neighbor_distance_squared;
        if (d2 < neighbor_best) {
          scheduleRemoval(pixel_index);
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
      pruning_iteration_count,
    };
  }

  

  function get_ridge_endpoint_info(ridge_binary, distance_squared, width, height, pixel_index) {
    const row_index = Math.floor(pixel_index / width);
    const column_index = pixel_index - row_index * width;
    let neighbor_count = 0;
    let highest_neighbor_distance_squared = -Infinity;

    for (let offset_row = -1; offset_row <= 1; offset_row++) {
      for (let offset_column = -1; offset_column <= 1; offset_column++) {
        if (offset_row === 0 && offset_column === 0) continue;

        const neighbor_row = row_index + offset_row;
        const neighbor_column = column_index + offset_column;
        if (neighbor_row < 0 || neighbor_row >= height) continue;
        if (neighbor_column < 0 || neighbor_column >= width) continue;

        const neighbor_index = neighbor_row * width + neighbor_column;
        if (!ridge_binary[neighbor_index]) continue;

        neighbor_count++;
        if (distance_squared[neighbor_index] > highest_neighbor_distance_squared) {
          highest_neighbor_distance_squared = distance_squared[neighbor_index];
        }
      }
    }

    return {
      is_endpoint: neighbor_count <= 1,
      neighbor_count,
      highest_neighbor_distance_squared,
    };
  }

  global_scope.medial_ridge_config = MEDIAL_RIDGE_DEFAULT_CONFIG;
  global_scope.medial_ridge = {
    compute_ridge_data,
    DEFAULT_CONFIG: MEDIAL_RIDGE_DEFAULT_CONFIG,
    create_default_options,
  };
})(typeof window !== "undefined" ? window : globalThis);
