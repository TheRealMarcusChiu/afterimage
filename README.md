# Afterimage

A static audiovisual artwork. A string and a fold of silk hold one pose until a recording plays, then move with its sound.

No frameworks, dependencies or build step. The only outside request is for the Google Fonts stylesheet and font files. There is no analytics.

**Current state: no recording is published.** The site opens in an honest pending state, showing the rest pose with `--:--` for time. Visitors can play their own video through **Choose video**. To publish a recording, follow "Set the recording" below.

## Preview

```sh
python3 -m http.server 8000
```

Open http://localhost:8000/. The site uses ES modules, so opening `index.html` directly from disk won't work.

## Test

```sh
npm test
```

This runs `node --test` with no dependencies. It covers signal extraction, smoothing and clamping, time and URL handling, the audio graph, sculpture geometry and rest pose, and the wiring of `app.js` through a small DOM stand-in. It doesn't run a browser or produce real audio. There is no browser test script in this repository.

## Set the recording

Set `MEDIA_SOURCE` in `config.js`, the one place the source is configured:

```js
export const MEDIA_SOURCE = "./media/recording.mp4";
```

- **Format:** MP4 with H.264 video and AAC audio is the recommended codec pair, because it's the most widely compatible, including with Safari.
- **Same origin is best.** Relative paths resolve correctly under a GitHub Pages subdirectory.
- **Another host** must use HTTPS and send CORS headers that allow this site's origin. Without them the video won't load, and the page says so. The analysis isn't bypassed or faked. Plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`.
- **Range requests** are recommended, because seeking depends on them.

### Privacy

- **A file chosen with Choose video stays in the browser.** It's never uploaded or saved, and it's forgotten when the page closes.
- **A recording added to this public repository is public.** Anyone can download it, and it stays in git history after you delete it.

### Size limits

GitHub blocks files over 100 MiB and warns above 50 MiB. Published Pages sites are limited to about 1 GB, with a soft limit of 100 GB of bandwidth a month. Git LFS doesn't help, because Pages doesn't serve LFS media as a normal file.

A black picture compresses extremely well, so compress the video first. For anything still too large, use a host with CORS and range support. Check the actual file before uploading it.

## Deployment

To publish the site with GitHub Pages from https://github.com/TheRealMarcusChiu/afterimage, follow these steps. There are no build steps or dependencies, and `.nojekyll` is already included.

1. Commit your changes and push them to `main`.
2. In the repository, go to **Settings > Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Choose branch `main` and folder `/ (root)`, then select **Save**.

Later pushes to `main` deploy automatically.

## Controls

| Action | Control |
| --- | --- |
| Load a video | Choose video |
| Play or pause | Play button, or Space or K |
| Seek | Slider, or Left and Right for five seconds |
| Mute | Mute button, or M |
| Volume | Slider |

Shortcuts apply only when no control has focus and no modifier is held, so a focused button or slider keeps its own native keys.

## How it's built

| File | Role |
| --- | --- |
| `config.js` | `MEDIA_SOURCE` |
| `index.html`, `styles.css` | Page and layout |
| `app.js` | Controls, media state, render loop |
| `audio.js` | The single audio route |
| `signal.js` | Band energy, RMS, envelopes, time and URL helpers |
| `sculpture.js` | Canvas geometry and drawing |
| `design-notes.md` | Reference provenance, tokens, how sound maps to form |

Audio runs through one `AudioContext` and one `createMediaElementSource`, created in the first play press and kept across file changes. The route is source to analyser to gain to destination. `video.volume` stays at 1 because it's read-only on iOS, so volume and mute act on the gain. If Web Audio or the analyser isn't available, sound still plays and the page says the form can't follow it.

## Known limits

- `npm test` uses Node stand-ins only, with no browser or real audio.
- Separately, a browser suite that isn't part of this repository passed on Chromium and on Linux Playwright WebKit with iPhone 13 emulation. It chose temporary black H.264/AAC diagnostic tones through the file picker, which were never published. It covered band isolation, silence and rest, playback, seeking, volume, keyboard, source replacement, reduced motion, invalid media and small-screen layouts.
- Not yet tested with the intended recording, which hasn't been supplied. Its expected length isn't assumed anywhere; duration comes only from the file's metadata.
- Not verified on a physical iPhone or in Safari itself. Emulation in Linux WebKit doesn't prove either one.
- Nobody has checked the audio output by ear.
- A video's picture is never shown, whatever it contains.
