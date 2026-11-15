// HERE — the words
// A quote arrives slowly: word by word, one short phrase at a time, with time to read and
// time to let it settle. Then the author, then silence.

(function(){
  const WORD_STAGGER = 0.32;   // seconds between words appearing
  const WORD_FADE    = 1.8;    // each word's own fade-in
  const READ_PER_WORD = 0.42;  // reading time after a phrase is complete (slow, calm reading)
  const MIN_HOLD     = 4.5;
  const PHRASE_OUT   = 2.2;    // fade between phrases
  const PHRASE_GAP   = 0.9;
  const ATTR_DELAY   = 1.6;
  const FINAL_HOLD   = 5.5;    // with the author shown
  const FINAL_OUT    = 3.5;
  const MAX_CHARS    = 95;     // longest phrase shown at once

  // break a quote into gentle phrases: sentences first, then clauses, then words
  function phrases(text){
    const out = [];
    const sentences = text.match(/[^.!?;:—]+(?:[.!?;:—]+|$)/g) || [text];
    let buf = '';
    const push = s => { s = s.trim(); if(s) out.push(s); };
    const pieces = [];
    sentences.forEach(s => {
      s = s.trim();
      if(s.length <= MAX_CHARS) { pieces.push(s); return; }
      // too long: split on commas
      const parts = s.match(/[^,]+(?:,|$)/g) || [s];
      let b = '';
      parts.forEach(p => {
        p = p.trim();
        if((b + ' ' + p).trim().length > MAX_CHARS && b){ pieces.push(b); b = p; }
        else b = (b + ' ' + p).trim();
      });
      if(b) pieces.push(b);
    });
    // still too long: split on words; and merge tiny pieces with their neighbour
    pieces.forEach(p => {
      if(p.length <= MAX_CHARS){
        if(buf && (buf + ' ' + p).length <= MAX_CHARS && (buf.length < 30 || p.length < 30)) buf += ' ' + p;
        else { push(buf); buf = p; }
        return;
      }
      push(buf); buf = '';
      const words = p.split(/\s+/);
      let line = '';
      words.forEach(w => {
        if((line + ' ' + w).trim().length > MAX_CHARS * 0.8 && line){ push(line); line = w; }
        else line = (line + ' ' + w).trim();
      });
      buf = line;
    });
    push(buf);
    return out;
  }

  class Words {
    constructor(root, quoteEl, attrEl){
      this.root = root; this.quoteEl = quoteEl; this.attrEl = attrEl;
      this.timers = [];
      this.busy = false;
      this.speed = 1;
    }
    after(sec, fn){ this.timers.push(setTimeout(fn, sec * 1000 / this.speed)); }

    // total duration of a quote, in seconds (for scheduling)
    duration(q){
      let t = 0;
      phrases(q.text).forEach((p, i, arr) => {
        const n = p.split(/\s+/).length;
        t += n * WORD_STAGGER + WORD_FADE + Math.max(MIN_HOLD, n * READ_PER_WORD);
        if(i < arr.length - 1) t += PHRASE_OUT + PHRASE_GAP;
      });
      return t + FINAL_HOLD + FINAL_OUT;
    }

    present(q){
      this.stop(true);
      this.busy = true;
      this.root.classList.add('on');
      this.attrEl.textContent = q.attr;
      this.attrEl.classList.remove('on');
      const list = phrases(q.text);
      let t = 0;
      list.forEach((p, i) => {
        const words = p.split(/\s+/);
        const last = i === list.length - 1;
        this.after(t, () => this.showPhrase(words));
        const built = words.length * WORD_STAGGER + WORD_FADE;
        const hold = Math.max(MIN_HOLD, words.length * READ_PER_WORD);
        if(last){
          this.after(t + built - WORD_FADE + ATTR_DELAY, () => this.attrEl.classList.add('on'));
          t += built + hold + FINAL_HOLD;
          this.after(t, () => this.root.classList.remove('on'));
          this.after(t + FINAL_OUT, () => { this.quoteEl.textContent = ''; this.attrEl.classList.remove('on'); this.busy = false; });
        } else {
          t += built + hold;
          this.after(t, () => this.quoteEl.classList.add('out'));
          t += PHRASE_OUT + PHRASE_GAP;
        }
      });
    }

    showPhrase(words){
      const el = this.quoteEl;
      el.classList.remove('out');
      el.textContent = '';
      const spans = words.map((w, i) => {
        const s = document.createElement('span');
        s.className = 'w';
        s.textContent = w;
        s.style.transitionDuration = (WORD_FADE / this.speed) + 's';
        el.appendChild(s);
        if(i < words.length - 1) el.appendChild(document.createTextNode(' '));
        return s;
      });
      void el.offsetWidth;
      spans.forEach((s, i) => this.after(i * WORD_STAGGER, () => s.classList.add('on')));
    }

    // fade away gently (or instantly, when replaced)
    stop(instant){
      this.timers.forEach(clearTimeout); this.timers = [];
      if(instant){ this.quoteEl.textContent = ''; this.attrEl.classList.remove('on'); this.busy = false; return; }
      if(!this.busy) return;
      this.root.classList.remove('on');
      this.after(FINAL_OUT, () => { this.quoteEl.textContent = ''; this.attrEl.classList.remove('on'); this.busy = false; });
    }
  }

  window.HereWords = Words;
  window.HereWords.phrases = phrases;
})();
