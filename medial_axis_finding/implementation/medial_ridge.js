(function expose_medial_ridge(global_scope) {
  'use strict';

  const DEFAULT_RIDGE_SEED = 0;

  function compute_ridge_mask(stencil, width, height, options = {}) {
    const ridge_data = compute_ridge_data(stencil, width, height, options);
    return ridge_data.ridge_mask;
  }

  function compute_inner_ridge_mask(stencil, width, height, options = {}) {
    const ridge_data = compute_ridge_data(stencil, width, height, options);
    return ridge_data.pruned_ridge_mask;
  }

  function compute_inner_ridge_mask_advanced(stencil, width, height, options = {}) {
    const advanced_options = {
      seed: options.seed === undefined ? DEFAULT_RIDGE_SEED : options.seed,
      thinningMode: options.thinningMode || 'synchronous',
      deterministic: options.deterministic === undefined ? true : !!options.deterministic,
      connectivity: options.connectivity === 4 ? 4 : 8,
      branchAwarePruning: !!options.branchAwarePruning,
      deterministicBranchScoring: !!options.deterministicBranchScoring
    };
    const ridge_data = compute_ridge_data(stencil, width, height, advanced_options);
    return ridge_data.pruned_ridge_mask;
  }

  function compute_ridge_data(stencil, width, height, options = {}) {
    validate_stencil_input(stencil, width, height);

    const foreground = build_binary_foreground(stencil, width, height);
    const connectivity = (options && options.connectivity === 4) ? 4 : 8;
    const keep_lut = build_keep_lut_with_connectivity(connectivity);
    const distance_squared = compute_project_distance_squared(foreground, width, height);
    const cornerness = compute_cornerness(foreground, width, height);
    const seed = options.seed === undefined ? DEFAULT_RIDGE_SEED : options.seed;
    const deterministic = options.deterministic === undefined ? true : !!options.deterministic;
    const thinningMode = options.thinningMode || 'synchronous'; // default now 'synchronous'
    const order = build_processing_order(foreground, distance_squared, cornerness, seed, deterministic);
    const ridge_binary = (
      thinningMode === 'synchronous'
        ? compute_ridge_binary_synchronous(foreground, width, height, distance_squared, keep_lut)
        : compute_ridge_binary(foreground, width, height, order, keep_lut)
    );
    const ridge_mask = promote_ridge_mask(ridge_binary);
    const pruning_data = compute_low_radius_pruning_data(ridge_binary, distance_squared, width, height, {
      branchAware: !!(options.branchAwarePruning || options.deterministicBranchScoring),
      branchScoring: !!options.deterministicBranchScoring
    });
    const pruned_ridge_binary = pruning_data.pruned_ridge_binary;
    const pruned_ridge_mask = promote_ridge_mask(pruned_ridge_binary);

    return {
      foreground,
      keep_lut,
      distance_squared,
      cornerness,
      order,
      ridge_binary,
      ridge_mask,
      pruned_ridge_binary,
      pruned_ridge_mask,
      removed_ridge_binary: pruning_data.removed_ridge_binary,
      pruning_iteration: pruning_data.pruning_iteration,
      pruning_iteration_count: pruning_data.pruning_iteration_count
    };
  }

  function validate_stencil_input(stencil, width, height) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new RangeError('width must be a positive integer');
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new RangeError('height must be a positive integer');
    }
    if (!stencil || stencil.length !== width * height) {
      throw new RangeError('stencil length must equal width * height');
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

  function build_keep_lut() { return build_keep_lut_with_connectivity(8); }

  function build_keep_lut_with_connectivity(connectivity) {
    const keep_lut = new Uint8Array(512);

    for (let neighborhood_index = 0; neighborhood_index < 512; neighborhood_index++) {
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

  function count_pattern_components(neighborhood_index) {
    const visited = new Uint8Array(9);
    let component_count = 0;

    for (let start_cell = 0; start_cell < 9; start_cell++) {
      if (visited[start_cell]) continue;
      if (((neighborhood_index >> start_cell) & 1) === 0) continue;

      component_count++;
      flood_pattern_component(neighborhood_index, start_cell, visited, 8);
    }

    return component_count;
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

  function compute_ridge_binary_synchronous(foreground, width, height, distance_squared, keep_lut) {
    const result = new Uint8Array(foreground);

    const levels = build_distance_levels(distance_squared, foreground);

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

  function build_distance_levels(distance_squared, foreground) {
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
      random_state = (random_state + 0x6D2B79F5) >>> 0;
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

  function promote_ridge_mask(ridge_binary) {
    const ridge_mask = new Uint8Array(ridge_binary.length);

    for (let pixel_index = 0; pixel_index < ridge_binary.length; pixel_index++) {
      ridge_mask[pixel_index] = ridge_binary[pixel_index] ? 255 : 0;
    }

    return ridge_mask;
  }

  function compute_low_radius_pruning_data(ridge_binary, distance_squared, width, height, options) {
    const pruned_ridge_binary = new Uint8Array(ridge_binary);
    const removed_ridge_binary = new Uint8Array(ridge_binary.length);
    const pruning_iteration = new Uint16Array(ridge_binary.length);
    let removed_any_pixel = true;
    let pruning_iteration_count = 0;
    const branchAware = !!(options && options.branchAware);
    const branchScoring = !!(options && options.branchScoring);

    while (removed_any_pixel) {
      removed_any_pixel = false;
      let pixels_to_remove = [];

      if (!branchAware) {
        for (let pixel_index = 0; pixel_index < pruned_ridge_binary.length; pixel_index++) {
          if (!pruned_ridge_binary[pixel_index]) continue;

          const endpoint_info = get_ridge_endpoint_info(pruned_ridge_binary, distance_squared, width, height, pixel_index);
          if (!endpoint_info.is_endpoint) continue;
          if (endpoint_info.neighbor_count === 0) continue;

          if (distance_squared[pixel_index] < endpoint_info.highest_neighbor_distance_squared) {
            pixels_to_remove.push(pixel_index);
          }
        }
      } else {
        // Branch-aware: group endpoints by traced junction and remove strictly dominated branches.
        const endpoint_list = [];
        for (let pixel_index = 0; pixel_index < pruned_ridge_binary.length; pixel_index++) {
          if (!pruned_ridge_binary[pixel_index]) continue;
          const info = get_ridge_endpoint_info(pruned_ridge_binary, distance_squared, width, height, pixel_index);
          if (!info.is_endpoint || info.neighbor_count === 0) continue;
          endpoint_list.push(pixel_index);
        }

        const groups = new Map(); // junctionIndex -> array of branch objects

        for (let i = 0; i < endpoint_list.length; i++) {
          const ep = endpoint_list[i];
          const branch = trace_branch_from_endpoint(pruned_ridge_binary, distance_squared, width, height, ep);
          const key = branch.junctionIndex;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(branch);
        }

        groups.forEach((branches, key) => {
          if (!branches || branches.length < 2) return; // nothing to compete with
          if (!branchScoring) {
            // Max-radius only (previous branch-aware behavior)
            let bestMax = -Infinity;
            for (let b = 0; b < branches.length; b++) {
              if (branches[b].maxDistanceSquared > bestMax) bestMax = branches[b].maxDistanceSquared;
            }
            for (let b = 0; b < branches.length; b++) {
              const br = branches[b];
              if (br.maxDistanceSquared < bestMax) {
                pixels_to_remove.push(br.endpointIndex);
              }
            }
          } else {
            // Deterministic branch scoring: tuple (maxRadius, length), lexicographic.
            let bestMax = -Infinity;
            let bestLen = -Infinity;
            for (let b = 0; b < branches.length; b++) {
              const br = branches[b];
              if (br.maxDistanceSquared > bestMax) {
                bestMax = br.maxDistanceSquared; bestLen = br.length;
              } else if (br.maxDistanceSquared === bestMax && br.length > bestLen) {
                bestLen = br.length;
              }
            }
            for (let b = 0; b < branches.length; b++) {
              const br = branches[b];
              const worseByRadius = br.maxDistanceSquared < bestMax;
              const sameRadiusButShorter = (br.maxDistanceSquared === bestMax) && (br.length < bestLen);
              if (worseByRadius || sameRadiusButShorter) {
                pixels_to_remove.push(br.endpointIndex);
              }
            }
          }
        });
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

  function get_ridge_degree(ridge_binary, width, height, pixel_index) {
    const row_index = Math.floor(pixel_index / width);
    const column_index = pixel_index - row_index * width;
    let neighbor_count = 0;

    for (let offset_row = -1; offset_row <= 1; offset_row++) {
      for (let offset_column = -1; offset_column <= 1; offset_column++) {
        if (offset_row === 0 && offset_column === 0) continue;
        const neighbor_row = row_index + offset_row;
        const neighbor_column = column_index + offset_column;
        if (neighbor_row < 0 || neighbor_row >= height) continue;
        if (neighbor_column < 0 || neighbor_column >= width) continue;
        const neighbor_index = neighbor_row * width + neighbor_column;
        if (ridge_binary[neighbor_index]) neighbor_count++;
      }
    }

    return neighbor_count;
  }

  function get_single_neighbor(ridge_binary, width, height, pixel_index) {
    const row_index = Math.floor(pixel_index / width);
    const column_index = pixel_index - row_index * width;
    for (let offset_row = -1; offset_row <= 1; offset_row++) {
      for (let offset_column = -1; offset_column <= 1; offset_column++) {
        if (offset_row === 0 && offset_column === 0) continue;
        const neighbor_row = row_index + offset_row;
        const neighbor_column = column_index + offset_column;
        if (neighbor_row < 0 || neighbor_row >= height) continue;
        if (neighbor_column < 0 || neighbor_column >= width) continue;
        const neighbor_index = neighbor_row * width + neighbor_column;
        if (ridge_binary[neighbor_index]) return neighbor_index;
      }
    }
    return -1;
  }

  function trace_branch_from_endpoint(ridge_binary, distance_squared, width, height, endpointIndex) {
    const path = [endpointIndex];
    let current = endpointIndex;
    let prev = -1;
    let maxDistanceSquared = distance_squared[endpointIndex];

    while (true) {
      const deg = get_ridge_degree(ridge_binary, width, height, current);
      if (deg !== 2) {
        // Junction or dead end
        return {
          endpointIndex: endpointIndex,
          junctionIndex: current,
          path,
          maxDistanceSquared,
          length: path.length
        };
      }

      // Move to the only neighbor that isn't prev
      let next = -1;
      const row_index = Math.floor(current / width);
      const column_index = current - row_index * width;
      for (let offset_row = -1; offset_row <= 1; offset_row++) {
        for (let offset_column = -1; offset_column <= 1; offset_column++) {
          if (offset_row === 0 && offset_column === 0) continue;
          const neighbor_row = row_index + offset_row;
          const neighbor_column = column_index + offset_column;
          if (neighbor_row < 0 || neighbor_row >= height) continue;
          if (neighbor_column < 0 || neighbor_column >= width) continue;
          const ni = neighbor_row * width + neighbor_column;
          if (!ridge_binary[ni] || ni === prev) continue;
          // found a candidate
          if (next === -1) next = ni; else if (ni !== next) {
            // more than one non-prev neighbor -> treat as junction here
            return {
              endpointIndex: endpointIndex,
              junctionIndex: current,
              path,
              maxDistanceSquared,
              length: path.length
            };
          }
        }
      }

      if (next === -1) {
        // Shouldn't happen with deg==2, but guard anyway
        return {
          endpointIndex: endpointIndex,
          junctionIndex: current,
          path,
          maxDistanceSquared,
          length: path.length
        };
      }

      prev = current;
      current = next;
      path.push(current);
      const d2 = distance_squared[current];
      if (d2 > maxDistanceSquared) maxDistanceSquared = d2;
    }
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
      highest_neighbor_distance_squared
    };
  }

  global_scope.medial_ridge = {
    compute_ridge_mask,
    compute_inner_ridge_mask,
    compute_inner_ridge_mask_advanced,
    compute_ridge_data,
    build_binary_foreground,
    build_keep_lut,
    build_keep_lut_with_connectivity,
    count_pattern_foreground,
    count_pattern_components,
    count_pattern_components_by_connectivity,
    compute_project_distance_squared,
    compute_exact_distance_squared,
    edt_1d,
    compute_cornerness,
    build_processing_order,
    create_seeded_random,
    build_random_permutation,
    compute_ridge_binary,
    compute_ridge_binary_synchronous,
    build_distance_levels,
    compute_low_radius_pruning_data,
    promote_ridge_mask
  };
})(typeof window !== 'undefined' ? window : globalThis);