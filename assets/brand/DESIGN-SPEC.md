# Caliper by Havrin

A warm lamp picks out one patch of the desk, much as Caliper draws attention to one finding in a long session. The rain, cooling mug, and sleeping cat make the CLI feel at home on someone’s own machine. The open jaws of the small C mark carry the idea of measurement into places where the whole room would be too small to read.

## Color

The night and day banners use the same 13-color sRGB palette. Amber belongs to the lamp and the surfaces it illuminates.

| Role | Hex | Use |
| --- | --- | --- |
| Night background | `#0C1520` | Empty field and deepest shadows |
| Ink | `#162736` | Day wordmark, primary mark, night furniture shadows |
| Base | `#253E4B` | Monitor glass, dark wood, day tagline |
| Slate | `#385965` | Day byline, window frame and furniture |
| Mid teal | `#517984` | Rain, floorboards and shaded leaves |
| Weathered teal | `#759A9C` | Day furniture, night byline mark |
| Sea glass | `#9DBBBA` | Night byline and terminal glyphs |
| Mist | `#C7D8D3` | Night tagline, reverse mark, window highlights |
| Paper | `#F2F5EE` | Day background and night wordmark |
| Amber shadow | `#6F4838` | Lamp hardware and dim reflected light |
| Burnished amber | `#B26D40` | Lamp shade and arm |
| Amber accent | `#ECA553` | Pool of light |
| Lamp highlight | `#FFDB91` | Underside of shade and brightest reflections |

## Pixel construction

Both PNGs are 1280 × 640. The workstation uses a 224 × 158 art grid, enlarged fourfold with nearest-neighbor sampling and placed at (460, −4) within the banner. The copy starts about 84 px from the left edge. The two lighting studies share the same framing. The terminal, keyboard highlights and sleeping cat’s face received a final pixel pass at banner scale.

Use this 4 × 4 Bayer threshold map for shading. The rows run from top to bottom, starting at the upper-left of the art grid.

```
 0   8   2  10
12   4  14   6
 3  11   1   9
15   7  13   5
```

For each art pixel, find the two adjacent shades of its cool or amber ramp. Let `f` be the fractional luminance between them. Use the lighter shade when `(f − 0.12) / 0.76 > (Bayer[y % 4][x % 4] + 0.5) / 16`. This gives flat areas near either endpoint and a checkerboard at the midpoint. The light pool also uses the ordered threshold to break its edge into the cool tabletop. Keep the matrix phase fixed throughout animation.

## Typography and mark

Use **JetBrains Mono Bold** for “Caliper”. The banner rasterizes it at 25 px, thresholds the glyph mask at 48%, and enlarges it fourfold. Set “by Havrin” in Regular at 18 px and the tagline in Regular at 20 px with a 30 px line step. Keep the line break after “optimization” so “AI development” stays together. JetBrains Mono is available under the SIL Open Font License 1.1. [Typeface and license](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt)

The mark is drawn on a 16 × 16 grid. Its upper jaw is fixed, its lower jaw slides along the left stem, and the space between them opens the C. Both 64 × 64 PNGs have transparent backgrounds. Use **mark.png** on light surfaces and **mark-reverse.png** on dark ones. At 32 px, each source cell occupies exactly 2 × 2 pixels.

## Motion

**hero-dark.gif** loops eight 220 ms frames, for a period of 1.76 seconds. Five short rain streaks move down the panes in staggered phases. The terminal cursor is visible for four frames and rests for four. The still banner is the reduced-motion counterpart.

## Illustration direction

The built-in image generator supplied the lighting studies. The final night prompt called for a higher isometric view of the desk, a wide rainy window, a single amber task light, a steaming teal mug, a succulent and a curled white-and-slate cat, using the reference bus stops for pixel clustering and checkerboard shadows. The daylight edit kept the scene in place and requested a near-white field, cloudy cyan sky, slate rooftops and a small amber reflection on the desk.
