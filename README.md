# VJing HT

An audio-reactive VJ visuals app built with Three.js. It listens to the room via the microphone and reacts to a manually-set BPM to drive scene switches, glitch effects, and shader parameters.

**Live:** https://lambent-douhua-190c96.netlify.app/

## Getting started

1. Open the [live link](https://lambent-douhua-190c96.netlify.app/) (or run it locally, see below).
2. Allow microphone access when the browser prompts — this is the app's only audio source, used to drive the reactive visuals (there is no track upload/playback).
3. Press any key or click once to make sure the browser's audio context is running (some browsers start it suspended until a user gesture).
4. Set the BPM to match the music (see Commands below) so beat-synced effects land on the beat.
5. Press `F` for fullscreen when projecting/performing.

### Running locally

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build
npm run preview  # preview the production build
```

## Commands

| Action | Control |
| --- | --- |
| Show/hide the in-app help overlay | `H` |
| Toggle fullscreen | `F` |
| Switch to a new main scene | `Space` |
| Open the control panel | add `#dev` to the URL, e.g. `https://lambent-douhua-190c96.netlify.app/#dev` |

Press `H` at any time to bring up an on-screen overlay listing these controls and the scene rules below — handy during a live set when you don't want to leave the tab.

The control panel (top-right, [lil-gui](https://lil-gui.georgealways.com/)) is hidden by default and only appears when the URL hash contains `dev`. It exposes:

- **Music Reactive** — master toggle. When on, every BPM beat has a chance to trigger a glitch effect and/or auto-switch to a new scene.
- **Visibility** — one checkbox per scene, used to jump to a specific scene manually (see Scene rules below).
- **BPM** — a BPM slider (40–220) and a **Tap Tempo** button: tap it in time with the music and the BPM is derived from the average gap between taps.
- **renderer** — post-processing toggles (sobel, ascii, rgb shift, vignette, bloom, exposure).
- **Export scene (.glb)** — exports the currently visible scene to a `.glb` file.

## Scene rules

There are 5 scenes: `squaresFalling`, `sphereLevitating`, `waterDancing`, `lightStormLevitating`, `logoLed`.

- Only one scene is visible at a time — switching scenes hides all others first.
- **Manual switch:** press `Space` to jump to a new (weighted-random) main scene, or (with the control panel open) check a scene's box under **Visibility** to show any scene directly, including `waterDancing`, which is otherwise unreachable.
- **Automatic switch:** with **Music Reactive** on, a "director" alternates between a *main* scene and a short *transition*:
  - **Main phase** picks `squaresFalling` (forward or backward), `sphereLevitating`, or `logoLed`. There's a 2-in-3 chance of a "long" pick — `squaresFalling` (either direction) or `logoLed`, weighted so `logoLed` is twice as likely as each `squaresFalling` direction — lasting 36-108 beats; otherwise `sphereLevitating` for 12-36 beats. The same main scene/direction never repeats back to back.
  - **Transition phase** switches to `lightStormLevitating` for 1-5 beats. There's a 1-in-8 chance it's instead a rare 6-12 beat "beat travel" variant, where the camera steps to a new point on its path 4 times per beat instead of gliding smoothly.
  - `waterDancing` is excluded from this rotation entirely — it's only reachable manually via the control panel.
- **Glitch effects:** with **Music Reactive** on, every beat also has a 50% chance of firing a short, randomized post-processing glitch drawn from that scene's own glitch pool, reverting back to that scene's default look shortly after. `sphereLevitating` and the normal `lightStormLevitating` transition have no glitches defined.
- **`logoLed`** is also toggled by its own on/off state in the panel (turning it off returns to no scene selected rather than switching to another one).
- Each scene defines its own default post-processing look and possible glitch variants; switching scenes resets post-processing to that scene's default.
