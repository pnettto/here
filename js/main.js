// HERE — orchestration

(function(){
  const SCENES = [
    { name: 'origin' }, { name: 'stardust' }, { name: 'home' },
    { name: 'water' }, { name: 'dawn' }, { name: 'night' },
  ];
  // one quote at a time, spaced across each movement
  const QUOTES_BY_SCENE = SCENES.map((_, i) =>
    (window.HERE_QUOTES || []).filter(q => (q.scene % SCENES.length) === i));
  const SCENE_DUR = 96;   // seconds each movement lives (including its dissolve in)
  const TRANS_DUR = 18;   // seconds of dissolve between movements
  const BREATH = 10;      // seconds per breath (six per minute)

  const params = new URLSearchParams(location.search);
  const DEBUG_SCENE = params.has('scene') ? parseInt(params.get('scene'), 10) : null;
  const DEBUG_T = params.has('t') ? parseFloat(params.get('t')) : null;
  const SPEED = params.has('speed') ? parseFloat(params.get('speed')) : 1;   // preview: fast-forward the journey

  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: DEBUG_T !== null });
  if(!gl){
    document.getElementById('intro').innerHTML = '<p class="title">this browser cannot show it</p><p class="hint">WebGL2 is required</p>';
    return;
  }

  // ------------------------------------------------------------ GL setup
  function compile(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(fragSrc){
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, window.HERE_VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for(let i = 0; i < n; i++){ const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  const SCENE = program(window.HERE_FRAG);
  const prog = SCENE.p;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // HDR + bloom, when the device can render to half-float buffers
  let HDR = params.get('bloom') !== '0' && !!gl.getExtension('EXT_color_buffer_float');
  let DOWN, UP, COMP;
  if(HDR){
    try { DOWN = program(window.HERE_DOWN); UP = program(window.HERE_UP); COMP = program(window.HERE_COMP); }
    catch(e){ console.warn('bloom disabled:', e); HDR = false; }
  }
  const BLOOM_LEVELS = 6;
  let sceneRT = null, mips = [];
  function makeRT(w, h){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? { tex, fb, w, h } : null;
  }
  function freeRT(rt){ if(rt){ gl.deleteTexture(rt.tex); gl.deleteFramebuffer(rt.fb); } }
  function buildTargets(w, h){
    if(!HDR) return;
    freeRT(sceneRT); mips.forEach(freeRT); mips = [];
    sceneRT = makeRT(w, h);
    let mw = w, mh = h;
    for(let i = 0; i < BLOOM_LEVELS; i++){
      mw = Math.max(1, Math.ceil(mw / 2)); mh = Math.max(1, Math.ceil(mh / 2));
      mips.push(makeRT(mw, mh));
    }
    if(!sceneRT || mips.some(x => !x)){ console.warn('bloom disabled: framebuffer incomplete'); HDR = false; }
  }

  const U = SCENE.u;
  gl.useProgram(prog);

  // smooth, tileable value noise baked into a 3D texture
  (function bakeNoise(){
    const SIZE = 64, PERIOD = 16, step = PERIOD / SIZE;
    let seed = 1234567;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sm = t => t * t * t * (t * (t * 6 - 15) + 10);
    const l = (a, b, t) => a + (b - a) * t;
    const data = new Uint8Array(SIZE ** 3 * 4);
    for(let ch = 0; ch < 4; ch++){
      const lat = new Float32Array(PERIOD ** 3);
      for(let i = 0; i < lat.length; i++) lat[i] = rnd();
      const L = (x, y, z) => lat[((z & 15) * PERIOD + (y & 15)) * PERIOD + (x & 15)];
      let k = ch;
      for(let z = 0; z < SIZE; z++) for(let y = 0; y < SIZE; y++) for(let x = 0; x < SIZE; x++){
        const fx = x * step, fy = y * step, fz = z * step;
        const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
        const ux = sm(fx - ix), uy = sm(fy - iy), uz = sm(fz - iz);
        const v = l(
          l(l(L(ix, iy, iz), L(ix + 1, iy, iz), ux), l(L(ix, iy + 1, iz), L(ix + 1, iy + 1, iz), ux), uy),
          l(l(L(ix, iy, iz + 1), L(ix + 1, iy, iz + 1), ux), l(L(ix, iy + 1, iz + 1), L(ix + 1, iy + 1, iz + 1), ux), uy), uz);
        data[k] = Math.round(v * 255);
        k += 4;
      }
    }
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, SIZE, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R].forEach(w => gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT));
    gl.generateMipmap(gl.TEXTURE_3D);   // distant / compressed detail is filtered instead of shimmering
    gl.uniform1i(U.uNoise, 0);
  })();

  // ------------------------------------------------------------ adaptive resolution
  // Each movement remembers its own sharpness. We sharpen while frames arrive
  // on time and soften (and remember a ceiling) whenever they start to lag.
  const fixedScale = params.has('scale');
  const scales = new Array(6).fill(fixedScale ? parseFloat(params.get('scale')) : 0.55);
  const ceilings = new Array(6).fill(1.0);
  let scale = scales[0];
  function resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(window.innerWidth * dpr * scale));
    const h = Math.max(64, Math.round(window.innerHeight * dpr * scale));
    if(canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; buildTargets(w, h); }
    else if(HDR && !sceneRT) buildTargets(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  let frameTimes = [], lastAdjust = 0, refresh = 16.7;
  function adapt(dt, now, sceneIdx, transitioning){
    if(fixedScale) return;
    frameTimes.push(dt);
    if(frameTimes.length > 45) frameTimes.shift();
    if(transitioning || now - lastAdjust < 1200 || frameTimes.length < 30) return;
    const sorted = frameTimes.slice().sort((a, b) => a - b);
    refresh = Math.min(refresh, sorted[2]);                 // fastest frames ≈ display refresh
    const med = sorted[Math.floor(sorted.length / 2)];
    let s = scales[sceneIdx];
    if(med > refresh * 1.3 && med > 18){                    // lagging: soften, remember the limit
      ceilings[sceneIdx] = Math.max(0.3, s * 0.97);
      s *= 0.85;
    } else if(med < refresh * 1.12 && s < ceilings[sceneIdx]){
      s = Math.min(ceilings[sceneIdx], s * 1.07);           // smooth: sharpen gently
    }
    scales[sceneIdx] = Math.min(1, Math.max(0.3, s));
    lastAdjust = now;
  }
  function applyScale(target){
    if(Math.abs(target - scale) > 0.005){ scale = target; resize(); frameTimes = []; }
  }

  // ------------------------------------------------------------ the journey
  const music = new window.HereMusic();
  let pulse = 0;
  music.onBell = () => { pulse = 1; };

  let cur = DEBUG_SCENE !== null ? DEBUG_SCENE % SCENES.length : 0;
  let curStart = 0;
  let trans = null;         // { to, start, dur }
  let clock = 0;            // seconds of experience
  let fade = 0;
  let started = false;
  let showWords = params.get('words') !== '0';
  const shown = new Set();

  const wordsEl = document.getElementById('words');
  const words = new window.HereWords(wordsEl, document.getElementById('quote'), document.getElementById('attr'));
  words.speed = SPEED;

  // one quote per movement; each movement keeps a shuffled rotation (remembered between
  // sessions) so every quote is seen before any repeats
  function nextQuote(scene){
    const pool = QUOTES_BY_SCENE[scene];
    if(!pool.length) return null;
    const key = 'here.quotes.' + scene;
    let bag = [];
    try { bag = JSON.parse(localStorage.getItem(key) || '[]').filter(i => i < pool.length); } catch(e) {}
    if(!bag.length){
      bag = pool.map((_, i) => i);
      for(let i = bag.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    const idx = bag.shift();
    try { localStorage.setItem(key, JSON.stringify(bag)); } catch(e) {}
    return pool[idx];
  }

  function goTo(idx, dur){
    words.stop();
    if(trans) { cur = trans.to; curStart = trans.start; }
    trans = { to: (idx + SCENES.length) % SCENES.length, start: clock, dur };
  }

  function smooth(x){ x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

  let last = performance.now();
  function frame(now){
    const dt = Math.min(100, now - last); last = now;
    if(started) clock += dt / 1000 * SPEED;

    if(DEBUG_T !== null){ clock = DEBUG_T; curStart = 0; fade = 1; }

    if(!trans && clock - curStart > SCENE_DUR - TRANS_DUR && DEBUG_T === null){
      trans = { to: (cur + 1) % SCENES.length, start: clock, dur: TRANS_DUR };
    }
    let mix = 0;
    if(trans){
      mix = smooth((clock - trans.start) / trans.dur);
      if(clock - trans.start >= trans.dur){ cur = trans.to; curStart = trans.start; trans = null; mix = 0; }
    }

    adapt(dt, now, cur, !!trans);
    applyScale(trans ? Math.min(scales[cur], scales[trans.to]) * 0.85 : scales[cur]);

    // words: one quote per movement, after it has settled in, and only if it can finish
    // before the next dissolve begins
    const tl = clock - curStart;
    const qKey = cur + ':' + Math.floor(curStart);
    if(started && showWords && !trans && tl >= 20 && !words.busy && !shown.has(qKey)){
      shown.add(qKey);
      const q = nextQuote(cur);
      if(q && tl + words.duration(q) <= SCENE_DUR - TRANS_DUR + 6) words.present(q);
    }

    const breath = 0.5 - 0.5 * Math.cos(clock / BREATH * Math.PI * 2);
    music.breathe(breath);

    pulse *= Math.pow(0.5, dt / 700);
    if(started && DEBUG_T === null) fade = Math.min(1, fade + dt / 9000);

    draw(tl, mix, breath);
    if(DEBUG_T === null) requestAnimationFrame(frame);
    else window.__rendered = true;
  }

  function frameOnce(){ draw(30, 0, 0.5); }

  function pass(P, target, w, h){
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(P.p);
  }

  function draw(tl, mix, breath){
    const W = canvas.width, H = canvas.height;
    pass(SCENE, HDR ? sceneRT : null, W, H);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uTime, clock % 1000);
    gl.uniform1i(U.uA, cur);
    gl.uniform1i(U.uB, trans ? trans.to : cur);
    gl.uniform1f(U.uTA, tl);
    gl.uniform1f(U.uTB, trans ? clock - trans.start : 0);
    gl.uniform1f(U.uMix, mix);
    gl.uniform1f(U.uBreath, breath);
    gl.uniform1f(U.uPulse, pulse);
    gl.uniform1f(U.uFade, fade * fade);
    gl.uniform1i(U.uDirect, HDR ? 0 : 1);
    gl.uniform1i(U.uNoise, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if(!HDR) return;

    // bloom: down the chain...
    gl.activeTexture(gl.TEXTURE1);
    let src = sceneRT;
    for(let i = 0; i < mips.length; i++){
      const dst = mips[i];
      pass(DOWN, dst, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(DOWN.u.uTex, 1);
      gl.uniform2f(DOWN.u.uSrcTexel, 1 / src.w, 1 / src.h);
      gl.uniform2f(DOWN.u.uDstTexel, 1 / dst.w, 1 / dst.h);
      gl.uniform1i(DOWN.u.uFirst, i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = dst;
    }
    // ...and back up, accumulating every scale of glow
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for(let i = mips.length - 1; i > 0; i--){
      const s = mips[i], dst = mips[i - 1];
      pass(UP, dst, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.uniform1i(UP.u.uTex, 1);
      gl.uniform2f(UP.u.uSrcTexel, 0.5 / s.w, 0.5 / s.h);
      gl.uniform2f(UP.u.uDstTexel, 1 / dst.w, 1 / dst.h);
      gl.uniform1f(UP.u.uWeight, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // compose, tone-map, grain
    pass(COMP, null, W, H);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mips[0].tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(COMP.u.uScene, 1);
    gl.uniform1i(COMP.u.uBloom, 2);
    gl.uniform2f(COMP.u.uRes, W, H);
    gl.uniform1f(COMP.u.uTime, clock % 1000);
    gl.uniform1f(COMP.u.uFade, fade * fade);
    gl.uniform1f(COMP.u.uBloomAmt, BLOOM_AMT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  const BLOOM_AMT = params.has('bloomamt') ? parseFloat(params.get('bloomamt')) : 0.06;

  // ------------------------------------------------------------ beginning
  const intro = document.getElementById('intro');
  const hint = document.getElementById('hint');

  async function wake(){
    try { if('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch(e) {}
  }
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && started) { wake(); music.resume(); } });

  function fullscreen(){
    const el = document.documentElement;
    if(!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if(document.fullscreenElement) document.exitFullscreen();
  }

  function begin(withSound){
    if(started) return;
    started = true;
    intro.classList.add('gone');
    if(!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if(withSound) music.start(); else music.muted = true;
    wake();
  }

  if(params.has('bench')){
    intro.style.display = 'none';
    window.__bench = (sceneId, frames) => {
      const px = new Uint8Array(4);
      const out = [];
      cur = sceneId; trans = null; curStart = 0; started = true; fade = 1;
      for(let i = 0; i < frames + 1; i++){
        const t0 = performance.now();
        clock = 30 + i; frameOnce();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if(i > 0) out.push(performance.now() - t0);
      }
      return out.reduce((a, b) => a + b, 0) / out.length;
    };
  } else if(DEBUG_T !== null){
    intro.style.display = 'none';
    started = true;
    requestAnimationFrame(frame);
  } else {
    intro.addEventListener('click', e => begin(!e.target.closest('[data-silent]')));
    requestAnimationFrame(frame);
  }

  let idleTimer = null;
  function showHint(){
    if(!started) return;
    document.body.classList.remove('idle');
    hint.classList.add('show');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { hint.classList.remove('show'); document.body.classList.add('idle'); }, 2500);
  }
  window.addEventListener('mousemove', showHint);

  window.addEventListener('keydown', e => {
    if(!started){ if(e.key === 'Enter' || e.key === ' ') begin(true); return; }
    const k = e.key.toLowerCase();
    if(k === 'f') fullscreen();
    else if(k === 'm'){
      if(!music.ctx && music.muted){ music.muted = false; music.start(); }
      else music.setMuted(!music.muted);
    }
    else if(k === 't'){ showWords = !showWords; if(!showWords) words.stop(); }
    else if(e.key === 'ArrowRight') goTo((trans ? trans.to : cur) + 1, 6);
    else if(e.key === 'ArrowLeft') goTo((trans ? trans.to : cur) - 1, 6);
    else return;
    showHint();
  });
  window.addEventListener('dblclick', () => { if(started) fullscreen(); });
})();
