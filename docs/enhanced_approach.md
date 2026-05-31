# Enhanced Detector — How It Works (High Level)

A high-level overview of the `enhanced/` detector. For the faithful baseline it re-interprets, see [`../skimage_port/`](../skimage_port/).

The goal is the same as the port: find the **inner ridge** (medial structure) of a 2D shape. The enhanced version adds two ideas that make it stable on the spiky, sharp-cornered shapes the port can't handle.

## The Pipeline

A single call — `medial_ridge.compute_ridge_data(stencil, width, height, options)` — runs these stages:

1. **Binarize** — turn the input stencil into a foreground/background mask.
2. **Corner smoothing** *(the first key idea)* — round off sharp corners before thinning, so they don't spawn spurious ridge branches. A global smoothing radius is **auto-picked from the shape's curvature**, then applied via morphological open-of-corners + closing. (Tunable, or set a fixed radius.)
3. **Distance transform** — for every foreground pixel, compute its squared distance to the nearest background pixel. The ridge lives along the ridgeline of this distance field.
4. **Thinning to 1px** *(the second key idea)* — erode the shape down to a single-pixel-wide skeleton using **parallel checkerboard thinning**, which is deterministic and avoids the ordering artifacts of the sequential approach.
5. **Low-radius pruning** — remove short branch "fans" that sit at low local radius (typically corner noise), leaving the clean central spine.

## Output

The result object carries every intermediate (foreground, distance field, raw ridge, removed branches, chosen radius, …) so the visualizer can show each step — plus the two that matter:

- `ridge_binary` — the raw medial ridge.
- `pruned_ridge_binary` — the final, cleaned inner ridge.

## Configuration

Behavior is controlled by a plain options object (`medial_ridge.DEFAULT_CONFIG`):

| Option | Default | Meaning |
| --- | --- | --- |
| `thinning_mode` | `"parallel_checkerboard"` | Thinning strategy. |
| `smooth_open` / `smooth_close` | `true` | Enable the corner-smoothing morphology. |
| `auto_radius` | `true` | Auto-pick the smoothing radius from curvature. |
| `smoothing_radius` | `4` | Fixed radius used when `auto_radius` is off. |
| `seed` / `deterministic` | `42` / `true` | Reproducible processing order. |

## Why It Beats the Port

The faithful port follows the source algorithms exactly, so it inherits their weakness: sharp corners produce dense branch fans and the sequential thinning order introduces artifacts. **Corner smoothing** removes the cause of the fans, and **deterministic checkerboard thinning** removes the ordering artifacts — together they make the enhanced detector reliable across arbitrary shapes.
