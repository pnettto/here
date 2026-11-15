# here: notes for whoever continues this

This file is a handover for the next person or agent who works on **here**. It's a full-screen, generative piece meant to leave someone at home in a state of quiet awe. Read the README for what it *is*. This file is about what we *learned* while making it, and the reasons behind what's in the code.

## The intent (don't lose this)
- The goal is **grace and calm, not spectacle.** Every choice serves soothing awe. If something is impressive but restless, it's wrong.
- The owner's taste, learned through feedback:
  - **Loved:** underwater light shafts, sunrise over clouds, space (the nebula, Earth from orbit), and the music.
  - **Rejected:** the lotus/flower (felt "weird"), the auroras ("artificial"), the expanding concentric rings ("hypnotizing, uncomfortable"), the whale, and the high glassy bell (replaced by a woody marimba voice).
  - **Quotes:** real, secular (no religious messages), each with something worth learning, verified attribution, and **slow**. One quote per movement, revealed word by word, with plenty of quiet between quotes.
- Everything breathes at **6 breaths per minute** (10 s cycle, `BREATH` in main.js). Brightness and the music's filter follow it, so keep that thread when you add things.

## Architecture
```
index.html        intro, overlay styles, script order (shaders → audio → quotes → words → main)
js/shaders.js     all GLSL: scenes, bloom (down/up/composite)
js/main.js        WebGL2 setup, 3D noise texture, HDR+bloom pipeline, adaptive resolution,
                  scene timeline/transitions, quote scheduling, input, wake lock
js/audio.js       generative Web Audio: drone, slow chords, woody marimba voice, reverb
js/quotes.js      the 50 quotes, each tagged with its movement (scene 0–5)
js/words.js       the quote presenter: phrase splitting, word-by-word reveal, timing
```
- The scene order is **origin → stardust → home (Earth from orbit) → water → dawn → night**, set in `scene()` in shaders.js and `SCENES` in main.js. Each movement lasts 96 s, including an 18 s dissolve into the next.
- Plain classic scripts, no build step or modules, so it runs straight from `file://`.

## Hard-won lessons (bugs that bit us)
1. **`pow(x, 2.0)` with negative `x` is undefined on real GPUs.** On those GPUs it produces NaN, which shows as black areas, and the bloom spreads it into black blocks. The software renderer we tested on hid this. **Always use `sq(x)`** (defined in shaders.js) for squares. Only call `pow` on values you know are ≥ 0.
2. **`atan(0,0)` is undefined.** Add a tiny epsilon wherever the arguments can both be zero, such as the centre of a radial effect or the exact sun direction.
3. NaN guards: `isnan()` can be optimized away. The guards use `!(x >= 0.0 && x < 1e5)`, which is safe because comparisons with NaN are always false.
4. **Cell-based sprites** (stars, motes, city lights) must use **compact kernels** that reach exactly zero inside their cell. Otherwise a bright glow gets clipped at the cell edge and shows as a faint square.
5. **Aliasing:**
   - The noise texture is mipmapped, so `texture()` filters detail that's too fine for a pixel.
   - Inside ray-march loops, use the `*v` variants (`noise3v`, `fbm3v`…, which call `textureLod(…, 0)`), because screen derivatives are meaningless there.
   - Hard silhouettes (mountains, pines, peaks, the Earth's limb) use smoothstep edges that are about one pixel wide.
6. **Ray-march jitter** uses temporal white noise (`ign()`, which is actually a hash). Interleaved-gradient noise made a visible diagonal hatching pattern.
7. **Scale matters.** On the Earth, cloud and coast frequencies must be realistic relative to the planet's radius (sp × 24 and × 7). Otherwise the surface reads as a featureless smear.
8. **Quotes:**
   - Apostrophes inside single-quoted JS strings broke `quotes.js` once. Use double quotes for any text containing `'`.
   - A "busy" check inside `speak()` once silently dropped quotes. Scheduling decisions belong in the scheduler, not in the presenter.
9. **Web Audio:** call `setValueAtTime` before any `linearRampToValueAtTime`, or browsers behave inconsistently.

## How we tested (headless, no real GPU available)
- Chromium + Mesa llvmpipe: `--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist`. You need `apk add mesa-dri-gallium mesa-egl mesa-gl mesa-gles`, and `TMPDIR=/tmp` for Playwright. SwiftShader didn't work in that VM.
- Debug URL params:
  - `?scene=N&t=T&scale=1` renders a still frame and sets `window.__rendered`.
  - `?bench=1&scale=1` exposes `window.__bench(scene, frames)` for relative timing.
  - `?speed=N` fast-forwards the timeline, including word timing.
  - `?bloom=0` uses the fallback path. `?words=0` hides the quotes. `?bloomamt=` sets the bloom strength.
- Audio was level-checked by swapping in an `OfflineAudioContext` and measuring peak/RMS. Target: peaks around −15 dBFS, RMS around −28 dB.
- **llvmpipe is not a real GPU.** It hides GPU-specific undefined behaviour (see lessons 1–3). Always reason about real-hardware behaviour, and ask the owner for screenshots.
- The owner's screenshots of real-hardware issues are the ground truth.

## Performance model
- Adaptive resolution is tracked **per movement** (`scales[]`, `ceilings[]` in main.js). It sharpens while frames hit the display refresh and softens, remembering a ceiling, when they lag. During dissolves it uses the minimum of the two scenes' scales × 0.85, since both scenes render at once.
- Relative cost on llvmpipe (480×270): stardust ≈ 94 ms (the heaviest), dawn ≈ 30, water ≈ 26, origin ≈ 22, night ≈ 12, home ≈ 8, bloom ≈ +3. Keep new scenes in this range.

## Ideas not yet done
- **Verify on real hardware:** smoothness at 4K, and whether any black areas or aliasing remain.
- The owner may want the Blake ("heaven") and Gibran (*The Prophet*) quotes swapped for strictly secular ones. Ask.
- **Possible future movements**, in the spirit of what was loved: light through a forest canopy, a slow aerial over glaciers, or the view from inside a cloud at sunrise.
- Let the music's chord follow the current movement (it currently wanders on its own).
