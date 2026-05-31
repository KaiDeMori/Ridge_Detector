# Source Fact Table

## Scope

This artifact extracts source-level facts needed to port `skimage.morphology.medial_axis` from scikit-image v0.24.0 into JavaScript/browser code.

The table focuses on behavior that affects a transferable implementation spec. It separates exact scikit/SciPy behavior from later browser replacement and project convention decisions.

## Inputs Used

- scikit-image v0.24.0 `skimage/morphology/_skeletonize.py`
- scikit-image v0.24.0 `skimage/morphology/_skeletonize_cy.pyx`
- SciPy v1.14.0 `scipy/ndimage/_morphology.py`
- SciPy v1.14.0 `scipy/ndimage/src/ni_morphology.c`
- scikit-image v0.24.0 API documentation for `medial_axis`
- SciPy v1.14.0 API documentation for `distance_transform_edt`

## Result

| Fact | Source | Category | JavaScript Port Consequence |
| --- | --- | --- | --- |
| The target function is `medial_axis(image, mask=None, return_distance=False, *, rng=None)`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | The browser-facing API can be narrower, but the source behavior includes optional masking, optional distance return, and RNG-controlled tie breaking. |
| Input image values are converted with `image.astype(bool)`. Nonzero values become foreground and zero values become background. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Normalize stencil bytes to binary foreground before any 3x3 packing or thinning. |
| If `mask` is supplied, `masked_image` is a boolean copy of `image`, and pixels outside the mask are set to `False`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | If project code supports masks, apply the mask before EDT, cornerness, ordering, and thinning. |
| After thinning with a mask, `result[~mask] = image[~mask]`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Mask support preserves original outside-mask values in the boolean result. A project that has no mask can leave this branch out as a declared project convention. |
| The connectivity structure for table construction is `_eight_connect = ndi.generate_binary_structure(2, 2)`. | scikit-image `_skeletonize.py` | scikit parity | The 3x3 component counter uses full 8-connectivity. Diagonal foreground cells connect. |
| The 3x3 pattern has 512 possible states and uses bit order `0 1 2 / 3 4 5 / 6 7 8`. | scikit-image `_skeletonize.py`, `_pattern_of`; `_skeletonize_cy.pyx`, `_table_lookup_index` | scikit parity | Build a 512-entry table and use the same bit layout in table construction, cornerness lookup, and thinning. |
| Bit 4, value `16`, is the center pixel in the 3x3 pattern. | scikit-image `_skeletonize.py`, `_pattern_of`; `_skeletonize_cy.pyx`, `_skeletonize_loop` | scikit parity | The center bit must stay aligned with table semantics. |
| The keep table first requires the center bit to be foreground: `(np.arange(512) & 2**4).astype(bool)`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Entries with a background center evaluate to `0` in the keep table. |
| A table entry keeps the center when removing the center changes the number of 8-connected foreground components. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Implement component counting on the 3x3 pattern with center present and with center cleared. |
| A table entry also keeps the center when the total foreground count in the 3x3 pattern is less than `3`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Preserve tiny components and endpoints according to the same table condition. |
| The table stores keep values, converted to contiguous `uint8` before the Cython loop. | scikit-image `_skeletonize.py`, `medial_axis`; `_skeletonize_cy.pyx`, `_skeletonize_loop` | scikit parity | In JavaScript, make the LUT values `0` or `1`, where `1` means the current pixel survives. |
| `distance = ndi.distance_transform_edt(masked_image)` is computed before thinning. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | The source algorithm uses SciPy EDT on the masked foreground image as a sort key. |
| When `return_distance` is true, scikit-image stores `distance.copy()` before filtering `distance` down to foreground pixels. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | If exposing the distance by-product, return the full image-shaped EDT, not the compressed foreground-only array. |
| `cornerness_table` is built as `9 - np.sum(_pattern_of(index))` for every 512-entry pattern. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Cornerness is the number of background cells in the 3x3 neighborhood under the same bit layout. |
| `corner_score = _table_lookup(masked_image, cornerness_table)`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Cornerness is computed by table lookup over the original masked foreground image, before thinning mutates `result`. |
| `_table_lookup` treats out-of-bounds positions as missing foreground contributions. | scikit-image `_skeletonize.py`, `_table_lookup`; `_skeletonize_cy.pyx`, `_table_lookup_index` | scikit parity | For cornerness and table lookup, out-of-bounds neighbors contribute `0`. |
| The full image coordinate arrays are built with `np.mgrid`, then compressed with `i[result]` and `j[result]`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | A JavaScript port can use flattened pixel indices, but the order and tiebreaker assignment must match the foreground scan order it chooses. |
| `result = masked_image.copy()` is made before foreground compression, then converted to contiguous `uint8`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | The thinning loop mutates a binary `0` or `1` image, not raw `255` stencil bytes. |
| `distance = distance[result]` filters distance values to original foreground pixels. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Sort only original foreground pixels. Background pixels never enter the ordered thinning pass. |
| The RNG is created with `np.random.default_rng(rng)`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | If deterministic JavaScript output is required, specify a seedable project PRNG separately. Exact NumPy PCG64 parity is a separate decision. |
| The tiebreaker is `generator.permutation(np.arange(masked_image.sum()))`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | Use a permutation of unique integers for tied pixels, assigned to foreground pixels in foreground extraction order. |
| The processing order is `np.lexsort((tiebreaker, corner_score[masked_image], distance))`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | NumPy `lexsort` makes `distance` the primary ascending key, `corner_score` the secondary ascending key, and `tiebreaker` the tertiary ascending key. |
| The `order` array indexes the compressed foreground coordinate arrays, not full-image flattened coordinates. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | If JavaScript sorts flattened foreground indices directly, the sort entries must carry equivalent distance, cornerness, and tie values. |
| `_skeletonize_loop` iterates once over `range(order.shape[0])`. | scikit-image `_skeletonize_cy.pyx`, `_skeletonize_loop` | scikit parity | The thinning stage is a single ordered pass over the original foreground list. |
| `_skeletonize_loop` starts each neighborhood with `accumulator = 16`. | scikit-image `_skeletonize_cy.pyx`, `_skeletonize_loop` | scikit parity | The center bit is forced on while evaluating the current ordered pixel. The loop does not read `result[ii, jj]` for the center bit. |
| The eight neighbor bits in `_skeletonize_loop` are read from the current mutable `result`. | scikit-image `_skeletonize_cy.pyx`, `_skeletonize_loop` | scikit parity | Erasures made earlier in the ordered pass affect later neighborhood indices. |
| `_skeletonize_loop` guards every neighbor read with row and column boundary checks. | scikit-image `_skeletonize_cy.pyx`, `_skeletonize_loop` | scikit parity | During thinning, out-of-bounds neighbors contribute `0`. |
| `_skeletonize_loop` writes `result[ii, jj] = table[accumulator]`. | scikit-image `_skeletonize_cy.pyx`, `_skeletonize_loop` | scikit parity | The port should assign the keep-table value directly for the current pixel. |
| The Cython loop has no per-pixel early-out based on the current center value. | scikit-image `_skeletonize_cy.pyx`, `_skeletonize_loop` | scikit parity | The source behavior relies on the original foreground order and forced center bit. A JS early-out would be an optimization only if proven equivalent for the selected data model. |
| After `_skeletonize_loop`, `result` is converted back to `bool`. | scikit-image `_skeletonize.py`, `medial_axis` | scikit parity | The project byte mask promotion to `0` and `255` is a project output-format step after the binary result exists. |
| SciPy `distance_transform_edt` converts input to binary with `np.where(input, 1, 0).astype(np.int8)`. | SciPy `_morphology.py`, `distance_transform_edt` | scikit parity | For strict parity, all truthy input values are foreground and zero-valued input is background. |
| SciPy `distance_transform_edt` computes a feature transform first, then derives Euclidean distances from feature coordinates. | SciPy `_morphology.py`, `distance_transform_edt` | scikit parity | The source EDT is a feature-transform implementation, not a direct port of Felzenszwalb-Huttenlocher. |
| SciPy distance output is `float64` and applies `sqrt` after summing squared coordinate deltas. | SciPy `_morphology.py`, `distance_transform_edt` | scikit parity | Squared distances can preserve sort order as a browser replacement, but the source return-distance value is true Euclidean distance. |
| SciPy C implementation identifies `NI_EuclideanFeatureTransform` as an exact Euclidean feature transform described by Maurer, Qi, and Raghavan 2003. | SciPy `ni_morphology.c`, `NI_EuclideanFeatureTransform` | scikit parity | Cite Maurer-style feature transform for strict source behavior. Label any F&H lower-envelope EDT as a browser replacement. |
| SciPy documentation defines EDT as replacing each foreground element with its shortest distance to background, where background is any zero-valued element in the input. | SciPy `distance_transform_edt` API documentation | scikit parity | Treating texture edges as outside requires an explicit project decision such as zero-padding before EDT. |
| The scikit-image docs example for a 5x3 rectangle inside a 7x7 image keeps a central run plus diagonal/end pixels. | scikit-image `medial_axis` API documentation | scikit parity | The final document should describe discrete ridge behavior rather than promising a pure geometric centerline. |
| Uploading a `Uint8Array` ridge mask as a Three.js `DataTexture` is outside scikit-image behavior. | Project requirement | project convention | The final spec can define `255` for ridge and `0` for non-ridge as the browser texture format. |
| Using Felzenszwalb-Huttenlocher as the browser EDT is a replacement decision, not the exact SciPy implementation. | SciPy source plus project goal | browser replacement | Step 04 should decide and document this explicitly. |

## Open Questions

## Exact EDT behavior for all-foreground inputs
The source facts show that SciPy computes a feature transform from zero-valued background sites. The observable behavior for inputs with no zero-valued cells should be captured by the behavior-oracle step, because it is an important project edge case.

**Answer**: 

## Exact RNG parity requirement
The source uses NumPy `default_rng`, currently PCG64, for the permutation tiebreaker. A browser implementation may only need deterministic project output rather than NumPy-identical permutations.

**Answer**: 

## Project mask support
The source function supports an optional mask. The stencil-ridge project may not need mask support.

**Answer**: 

## Texture-edge distance convention
The source EDT sees only the input array. If the project wants texture edges to count as exterior, the EDT step should explicitly zero-pad and crop.

**Answer**: 
