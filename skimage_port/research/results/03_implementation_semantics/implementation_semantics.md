# Implementation Semantics

## Scope

This artifact translates the source facts for `skimage.morphology.medial_axis` into language-neutral implementation semantics for a JavaScript/browser port.

The EDT implementation itself is treated as an interface here. Step 04 decides the strict SciPy parity path versus a browser-compatible exact EDT replacement.

## Inputs Used

- `../01_source_facts/source_fact_table.md`
- `../02_behavior_oracles/test_oracle_design.md`
- `../../shared/medial_axis_orientation.md`
- Local resources:
  - `../../resources/_skeletonize.py`
  - `../../resources/_skeletonize_cy.pyx`
  - `../../resources/_morphology.py`
  - `../../resources/ni_morphology.c`

## Result

## Data Model

### Inputs

- `stencil`: byte-like array of length `width * height`.
- `stencil[p] != 0`: foreground / inside.
- `stencil[p] == 0`: background / outside.
- `width`, `height`: image dimensions.

### Internal Arrays

- `foreground`: binary array, values `0` or `1`, length `width * height`.
- `distance`: exact Euclidean distance or exact squared Euclidean distance, length `width * height`.
- `cornerness`: integer array, length `width * height`.
- `keep_lut`: 512-entry binary lookup table, values `0` or `1`.
- `order`: foreground pixel indices in processing order.
- `result`: mutable binary array copied from `foreground`.
- `ridge_mask`: byte output array, values `0` or `255`.

### Normalization

Source category: **scikit parity**

```text
for pixel_index in 0 .. width * height - 1:
  foreground[pixel_index] = stencil[pixel_index] != 0 ? 1 : 0
```

The thinning loop operates on binary `0` or `1` values. Raw byte values such as `255` are an output format detail and should not be packed into 3x3 bit indices.

### Optional Mask

Source category: **scikit parity** if implemented, **project convention** if omitted

If mask support is included:

```text
for pixel_index in all pixels:
  foreground[pixel_index] = stencil[pixel_index] != 0 ? 1 : 0
  if mask[pixel_index] == 0:
    foreground[pixel_index] = 0
```

After thinning, scikit-image restores `image[~mask]` into the boolean result. If the project has no mask input, mark mask behavior outside project scope in the final spec.

## Keep Table

Source category: **scikit parity**

The 3x3 neighborhood bit layout is:

```text
bit 0  bit 1  bit 2
bit 3  bit 4  bit 5
bit 6  bit 7  bit 8
```

Bit 4 is the center pixel and has value `16`.

For each `neighborhood_index` in `0 .. 511`, set `keep_lut[neighborhood_index]` to `1` exactly when:

- the center bit is foreground; and
- removing the center changes the number of 8-connected foreground components inside the 3x3 pattern, or the foreground count in the 3x3 pattern is less than `3`.

Pseudocode:

```text
function build_keep_lut():
  keep_lut = array[512] filled with 0

  for neighborhood_index in 0 .. 511:
    center_is_foreground = (neighborhood_index & 16) != 0
    if center_is_foreground == false:
      keep_lut[neighborhood_index] = 0
      continue

    foreground_count = count_set_bits(neighborhood_index)
    components_with_center = count_3x3_components(neighborhood_index)
    components_without_center = count_3x3_components(neighborhood_index & ~16)

    if components_with_center != components_without_center:
      keep_lut[neighborhood_index] = 1
    else if foreground_count < 3:
      keep_lut[neighborhood_index] = 1
    else:
      keep_lut[neighborhood_index] = 0

  return keep_lut
```

Component counting uses 8-connectivity within the 3x3 patch.

```text
function count_3x3_components(neighborhood_index):
  visited = array[9] filled with false
  component_count = 0

  for start_cell in 0 .. 8:
    if visited[start_cell]:
      continue
    if bit start_cell of neighborhood_index is 0:
      continue

    component_count += 1
    flood all 8-connected foreground cells from start_cell

  return component_count
```

## Cornerness

Source category: **scikit parity**

The source builds a 512-entry `cornerness_table` as:

```text
cornerness_table[neighborhood_index] = 9 - foreground_count(neighborhood_index)
```

Then it performs `_table_lookup(masked_image, cornerness_table)` on the original masked foreground image.

A browser port may compute the same value directly per foreground pixel:

```text
function compute_cornerness(foreground, width, height):
  cornerness = array[width * height] filled with 0

  for row in 0 .. height - 1:
    for column in 0 .. width - 1:
      pixel_index = row * width + column
      if foreground[pixel_index] == 0:
        continue

      foreground_count = 0

      for offset_row in -1 .. 1:
        for offset_column in -1 .. 1:
          neighbor_row = row + offset_row
          neighbor_column = column + offset_column

          if neighbor_row is outside image:
            continue
          if neighbor_column is outside image:
            continue

          neighbor_index = neighbor_row * width + neighbor_column
          if foreground[neighbor_index] != 0:
            foreground_count += 1

      cornerness[pixel_index] = 9 - foreground_count

  return cornerness
```

Out-of-bounds cells contribute background. For foreground pixels, the center is foreground, so practical values are `0` through `8`.

## Distance Interface

Source category: **scikit parity** for using exact EDT as the sort key, **browser replacement** for the concrete browser EDT implementation

The medial-axis thinning semantics need a distance value for every pixel. The source uses `scipy.ndimage.distance_transform_edt(masked_image)` and then sorts only foreground distances.

For step 03, the required interface is:

```text
function compute_distance_for_ordering(foreground, width, height):
  return exact Euclidean distance or exact squared Euclidean distance per pixel
```

Squared distance is acceptable for ordering because square root is monotonic, as long as step 04 declares this as the browser strategy. If the project exposes the distance by-product as a user-facing value, the by-product should be true Euclidean distance unless step 04 declares otherwise.

## Processing Order

Source category: **scikit parity**

The source extracts foreground pixels in image scan order, assigns each foreground pixel a unique random tiebreaker value, and sorts with NumPy `lexsort`.

Equivalent browser semantics:

```text
function build_processing_order(foreground, distance, cornerness, random_permutation):
  entries = empty list
  foreground_order_index = 0

  for pixel_index in 0 .. foreground.length - 1:
    if foreground[pixel_index] == 0:
      continue

    entries.push({
      pixel_index: pixel_index,
      distance_value: distance[pixel_index],
      cornerness_value: cornerness[pixel_index],
      tie_value: random_permutation[foreground_order_index]
    })

    foreground_order_index += 1

  sort entries by:
    1. distance_value ascending
    2. cornerness_value ascending
    3. tie_value ascending

  order = array of entries.pixel_index in sorted order
  return order
```

The tiebreaker must be a permutation of the unique integers `0 .. foreground_count - 1`. A seedable project PRNG can generate this permutation if deterministic output is required. Exact NumPy PCG64 parity is an open project decision.

## Ordered Thinning Pass

Source category: **scikit parity**

The thinning pass mutates a binary copy of the original foreground. Each original foreground pixel is processed once, in `order`.

Important semantics:

- The current pixel's center bit is forced on by starting the neighborhood index at `16`.
- The eight neighbor bits are read from the mutable `result` array.
- Out-of-bounds neighbors contribute `0`.
- The current pixel is assigned directly from `keep_lut[neighborhood_index]`.

Pseudocode:

```text
function compute_ridge_binary(foreground, width, height, order, keep_lut):
  result = copy of foreground

  for order_position in 0 .. order.length - 1:
    pixel_index = order[order_position]
    row = floor(pixel_index / width)
    column = pixel_index - row * width

    neighborhood_index = 16

    if row > 0:
      upper_row = row - 1
      upper_offset = upper_row * width

      if column > 0 and result[upper_offset + column - 1] != 0:
        neighborhood_index += 1
      if result[upper_offset + column] != 0:
        neighborhood_index += 2
      if column < width - 1 and result[upper_offset + column + 1] != 0:
        neighborhood_index += 4

    if column > 0 and result[pixel_index - 1] != 0:
      neighborhood_index += 8

    if column < width - 1 and result[pixel_index + 1] != 0:
      neighborhood_index += 32

    if row < height - 1:
      lower_row = row + 1
      lower_offset = lower_row * width

      if column > 0 and result[lower_offset + column - 1] != 0:
        neighborhood_index += 64
      if result[lower_offset + column] != 0:
        neighborhood_index += 128
      if column < width - 1 and result[lower_offset + column + 1] != 0:
        neighborhood_index += 256

    result[pixel_index] = keep_lut[neighborhood_index]

  return result
```

This is a single ordered pass. There is no convergence loop in the medial-axis thinning stage.

## Output Conversion

Source category: **project convention** for byte mask format

The source returns a boolean skeleton. The project wants a byte ridge mask.

```text
function promote_ridge_mask(ridge_binary):
  ridge_mask = array[ridge_binary.length] filled with 0

  for pixel_index in 0 .. ridge_binary.length - 1:
    ridge_mask[pixel_index] = ridge_binary[pixel_index] != 0 ? 255 : 0

  return ridge_mask
```

If distance output is exposed, return the full image-shaped distance array created before foreground filtering.

## Reference Pipeline

```text
function compute_ridge_mask(stencil, width, height, options):
  foreground = build_binary_foreground(stencil, width, height)

  if options.mask exists:
    apply_mask_to_foreground(foreground, options.mask)

  keep_lut = build_keep_lut()
  distance = compute_distance_for_ordering(foreground, width, height)
  cornerness = compute_cornerness(foreground, width, height)
  tie_permutation = build_unique_random_permutation(count_foreground(foreground), options.seed)
  order = build_processing_order(foreground, distance, cornerness, tie_permutation)
  ridge_binary = compute_ridge_binary(foreground, width, height, order, keep_lut)

  if options.mask exists and scikit mask parity is required:
    restore_outside_mask_values(ridge_binary, stencil, options.mask)

  ridge_mask = promote_ridge_mask(ridge_binary)
  return ridge_mask
```

## Invariants

- Internal binary masks use `0` and `1`.
- `keep_lut` has exactly 512 entries.
- Bit 4 is the center bit in table construction and cornerness lookup.
- The thinning loop forces bit 4 by starting with `neighborhood_index = 16`.
- Cornerness is computed from the original foreground image, not from the thinning-mutated result.
- Processing order includes only original foreground pixels.
- Distance is the primary ascending sort key.
- Cornerness is the secondary ascending sort key.
- Tiebreaker is the tertiary ascending sort key.
- Tiebreaker values are unique integers.
- Neighbor reads in the thinning pass use the mutable `result` array.
- Each ordered foreground pixel is assigned exactly once in the thinning pass.
- Out-of-bounds 3x3 cells contribute background for lookup, cornerness, and thinning.
- Byte promotion to `255` happens after the binary ridge result exists.

## Open Questions

## EDT Browser Strategy
Which exact EDT implementation and boundary convention should the browser port use?

**Answer**: Step 04 selects an exact squared EDT browser replacement and a project convention that zero-pads before EDT, then crops the distance result back to the original texture size.

## Mask Support
Should mask behavior be included in the project implementation?

**Answer**: 

## RNG Parity
Should the browser tiebreaker match NumPy PCG64 exactly, or is a deterministic project permutation sufficient?

**Answer**: 

## Distance By-Product
Should the browser API expose the distance output, or only the ridge mask?

**Answer**: 
