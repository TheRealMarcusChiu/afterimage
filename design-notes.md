# Design notes

## Provenance

The visual language follows the rendered site at https://git.marcuschiu.com/thoughts/, inspected through computed CSS and a screenshot by the commissioning agent. This repository's author worked from those recorded values and did not fetch the site.

| Token | Value | Use here |
| --- | --- | --- |
| Background | `#0f0c09` | Page and canvas |
| Panel | `#14110b` | Playback strip |
| Text | `#ece1cf` | Title, copy, string, thumbs |
| Secondary | `#cdc1ab` | Essential small text |
| Dim | `#8c8170` | Disabled controls only, raised to secondary for essential text |
| Accent | `#d8a942` | Silk, primary action, slider fill, focus ring |
| Border | `#2a2218` | Hairlines |
| Track (added) | `#75674e` | Slider track, which needs 3:1 on the panel |
| Ember (added) | `#8a6a2c` | Back sheet of silk, canvas only |

Type: Newsreader italic 500 for the title, Newsreader 400 for copy, JetBrains Mono 400/500 for UI. Reference metadata style (mono 12px, tracking .14em) is kept for the details summary.

Adapted on purpose:

- Reference hero h1 is 102.4px/0.98, -.015em. Here the title is small by request, 30 to 38px with the same line height and tracking.
- Reference header spacing is 96px above and 52px below, with about 90px gutters at 1265px wide and a 1100px measure. Here the gutters and measure are kept, and header spacing is cut so the artwork can hold most of the first screen.

## Composition

A taut string runs on a diagonal between two anchors. A sheet of silk hangs from it, sagging lowest left of centre, with 2.6 half-turns of twist so that it pinches into a small fold and then a larger one. The empty upper left carries the note, and the lower right stays empty.

Threads are additive, so light comes from where they converge and not from any effect. Seven motes are placed by hand around the second fold. One soft glow sits behind each fold.

## What sound does

| Signal | Source | Effect |
| --- | --- | --- |
| Bass, 30 to 180 Hz | FFT | Widens the silk and sways it broadly |
| Mids, 180 to 2200 Hz, in 8 log bands | FFT | Each band swells and twists one stretch of silk: low notes at the belly, higher notes towards the ends |
| Highs, 2200 to 12000 Hz | FFT | Ripple along the threads, motes brighten and drift |
| Loudness | Time-domain RMS | Brightness, thread weight, and how fast the timebase runs |
| Transient | Rise of loudness above its recent average, clamped | Small swell and flare |
| Waveform | Time domain, 128 points | Displaces the string directly |

Every moving term is multiplied by one of these values, and the timebase stops at zero loudness, so silence draws the exact rest pose. Tests assert this point for point. Nothing in the piece uses random numbers.

The analyser is ahead of the gain, so volume and mute change what you hear and leave the shape alone.

Reduced motion keeps 35% amplitude and 24 frames per second, and removes the flare and the string's waveform.
