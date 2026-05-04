# EDT Strategy

## Scope

This artifact decides how the Euclidean distance transform should be represented in the JavaScript/browser port of the ridge algorithm.

The goal is to keep strict source behavior and browser replacement behavior separate. The final implementation can use the browser strategy while the final document remains clear about what scikit-image/SciPy actually does.

## Inputs Used

- `../01_source_facts/source_fact_table.md`
- `../02_behavior_oracles/test_oracle_design.md`
- `../03_implementation_semantics/implementation_semantics.md`
- `../../resources/_morphology.py`
- `../../resources/ni_morphology.c`

## Result

## Source Behavior

Source category: **scikit parity**

scikit-image v0.24.0 calls:

```text
distance = ndi.distance_transform_edt(masked_image)
```

SciPy v1.14.0 `distance_transform_edt`:

- converts input to binary with foreground where input is truthy and background where input is zero;
- computes an exact Euclidean feature transform;
- derives Euclidean distances from nearest background feature coordinates;
- returns true Euclidean distance as `float64` values;
- defines background as zero-valued cells in the input array.

The SciPy C implementation identifies its exact feature-transform algorithm as the Maurer, Qi, and Raghavan 2003 method.

## Browser Strategy

Category: **browser replacement**

Use an exact squared Euclidean distance transform for ordering.

Recommended browser strategy:

- Use foreground `1` and background `0` as input.
- Initialize background sites with squared distance `0`.
- Initialize foreground sites with `+Infinity`.
- Run an exact separable squared EDT over rows and columns.
- Use squared distance directly for processing-order sort keys.
- Compute `sqrt(distance_squared)` only if the browser API exposes an `interior_distance` by-product.

This is a browser-compatible replacement for SciPy's feature transform. It is acceptable for the thinning order because square root is monotonic: sorting by exact squared Euclidean distance produces the same order as sorting by true Euclidean distance.

Recommended algorithm family:

- Felzenszwalb-Huttenlocher lower-envelope squared EDT, implemented with finite-site guards; or
- another exact separable squared EDT with the same background-site semantics.

## Boundary Convention

There are two boundary conventions in the overall ridge pipeline.

### 3x3 Operations

Category: **scikit parity**

For keep-table lookup, cornerness, and thinning, out-of-bounds neighbors contribute background `0`.

### EDT Input Domain

Category: **scikit parity**

SciPy computes distance to zero-valued cells in the input array. The source behavior does not automatically add a zero-valued border outside the array.

### Project Texture Edge Convention

Category: **project convention**

The project convention is to treat the texture edge as exterior. Create a zero-padded scratch image before EDT and crop the distance result back to the original size.

Recommended wording for the final spec:

```text
The source SciPy behavior computes EDT on the unpadded input image.
The project browser port intentionally computes EDT on a one-pixel zero-padded scratch image and crops back, so texture edges count as exterior.
```

## Numeric Representation

Category: **browser replacement**

Recommended internal representation:

- Use JavaScript `Number` arithmetic or `Float64Array` for EDT lower-envelope calculations.
- Store `distance_squared` in `Float64Array` for sorting.
- Convert to `Float32Array` only for optional GPU upload or visualization by-product.
- Keep ridge mask output as `Uint8Array` with `0` and `255`.

Rationale:

- The EDT is a precompute step.
- Sorting correctness is more important than minimizing memory for this stage.
- `Float64Array` reduces accidental ordering differences for large images or long distances.

## All-Foreground Inputs

Category: **project convention**

A stencil with no in-array background cells is special for strict in-array EDT behavior because there are no zero-valued sites to measure from.

The selected zero-padded EDT convention gives all-foreground project stencils finite distances to the padded exterior border. Strict unpadded SciPy behavior remains useful as source context, but it is not the project browser convention.

## Validation Fixtures

Use these tests after implementing the selected EDT strategy:

- A single foreground pixel surrounded by background has squared distance `1` at the foreground pixel.
- A horizontal run of foreground pixels sorts lower-distance edge pixels before interior pixels.
- A filled rectangle with surrounding background produces larger distances near its center than near its border.
- Squared distance and true distance produce identical ordering for all foreground pixels.
- A foreground pixel at the texture edge has finite distance to the padded background.
- An all-foreground input has finite distances because the padded border supplies background sites.

## Decision Matrix

| Decision | Choice | Category | Reason |
| --- | --- | --- | --- |
| Source EDT identity | SciPy exact Euclidean feature transform, Maurer-style implementation | scikit parity | This is what `distance_transform_edt` calls in SciPy v1.14.0. |
| Browser EDT used for sorting | Exact squared Euclidean distance transform | browser replacement | Preserves the same sort order as true Euclidean distance while avoiding a required `sqrt` pass. |
| Browser EDT algorithm family | Exact separable lower-envelope EDT with finite-site handling | browser replacement | Fits plain JavaScript, is fast enough for precompute, and avoids GPU read/write complexity. |
| Distance storage | `Float64Array` distance squared | browser replacement | Keeps ordering stable for the CPU precompute stage. |
| Distance by-product | Optional true Euclidean distance via `sqrt(distance_squared)` | browser replacement | Matches source output semantics only when exposed. |
| 3x3 boundary behavior | Out-of-bounds contributes `0` | scikit parity | Matches table lookup, cornerness, and Cython thinning guards. |
| EDT texture-edge behavior | Zero-pad before EDT and crop back | project convention | Texture edges count as exterior for project stencils. |
| All-foreground input behavior | Supported by the zero-padded EDT scratch image | project convention | The padded border supplies background sites around an all-foreground stencil. |
| RNG interaction | Independent of EDT except through distance ties | scikit parity | Distance ties are resolved later by cornerness and tiebreaker order. |

## Open Questions

## EDT Texture Edge Convention
Should the project treat texture edges as exterior by using a zero-padded EDT scratch image?

**Answer**: Yes. Use a zero-padded scratch image before EDT and crop the distance result back to the original texture size.

## All-Foreground Stencils
Are all-foreground stencil textures expected in real project input?

**Answer**: The selected zero-padded EDT convention gives all-foreground stencils finite distances to the padded exterior border.

## Distance By-Product
Does the browser API need to expose an `interior_distance` texture or array, or only the ridge mask?

**Answer**: 
