/**
 * US Bird DrillForge — look & sound ID drills by region
 */
(function () {
  'use strict';

  const APP_VERSION = '2';
  const STORAGE = {
    progress: 'ubdf_progress',
    stats: 'ubdf_stats',
    settings: 'ubdf_settings',
    onboarded: 'ubdf_onboarded',
  };
  const MASTERY_THRESHOLD = 4;

  const REGION_LABELS = {
    all: 'All Birds',
    northeast: 'Northeast',
    southeast: 'Southeast',
    midwest: 'Midwest',
    southwest: 'Southwest',
    west: 'West / Rockies',
    pacific: 'Pacific Coast',
  };

  let birdData = { birds: [], _meta: {} };
  let progress = {};
  let stats = {};
  let settings = { region: 'all' };
  let session = null;
  let selectedBird = null;
  let activeAudio = null;

  // ─── Storage ───────────────────────────────────────────────

  function loadStorage() {
    try { progress = JSON.parse(localStorage.getItem(STORAGE.progress) || '{}'); }
    catch { progress = {}; }
    try { stats = JSON.parse(localStorage.getItem(STORAGE.stats) || '{}'); }
    catch { stats = {}; }
    try {
      settings = { region: 'all', ...JSON.parse(localStorage.getItem(STORAGE.settings) || '{}') };
    } catch { /* defaults */ }

    if (!stats.today) stats.today = todayKey();
    if (!stats.daily) stats.daily = {};
    if (!stats.streak) stats.streak = 0;
    if (!stats.lastStudyDate) stats.lastStudyDate = null;
    if (stats.today !== todayKey()) {
      stats.today = todayKey();
      if (!stats.daily[stats.today]) stats.daily[stats.today] = { drilled: 0, correct: 0, total: 0 };
    }
    if (!stats.daily[stats.today]) stats.daily[stats.today] = { drilled: 0, correct: 0, total: 0 };
  }

  function saveProgress() {
    localStorage.setItem(STORAGE.progress, JSON.stringify(progress));
    localStorage.setItem(STORAGE.stats, JSON.stringify(stats));
    localStorage.setItem(STORAGE.settings, JSON.stringify(settings));
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getBirdProgress(id) {
    if (!progress[id]) {
      progress[id] = {
        look: { mastery: 0, correct: 0, wrong: 0, streak: 0 },
        sound: { mastery: 0, correct: 0, wrong: 0, streak: 0 },
        lastSeen: 0,
      };
    }
    // migrate old shape if needed
    if (!progress[id].look) {
      progress[id] = {
        look: { mastery: 0, correct: 0, wrong: 0, streak: 0 },
        sound: { mastery: 0, correct: 0, wrong: 0, streak: 0 },
        lastSeen: progress[id].lastSeen || 0,
      };
    }
    return progress[id];
  }

  function recordAnswer(id, skill, correct) {
    const p = getBirdProgress(id);
    const r = p[skill] || (p[skill] = { mastery: 0, correct: 0, wrong: 0, streak: 0 });
    if (correct) {
      r.correct++;
      r.streak = Math.min(5, r.streak + 1);
      r.mastery = Math.min(5, r.mastery + (r.streak >= 3 ? 1 : 0.5));
      if (r.streak >= 2 && r.mastery < 1) r.mastery = 1;
    } else {
      r.wrong++;
      r.streak = 0;
      r.mastery = Math.max(0, r.mastery - 1);
    }
    p.lastSeen = Date.now();

    const day = stats.daily[stats.today] || (stats.daily[stats.today] = { drilled: 0, correct: 0, total: 0 });
    day.drilled++;
    day.total++;
    if (correct) day.correct++;
    stats.lastStudyDate = stats.today;
    if (day.drilled === 1) stats.streak = Math.max(1, (stats.streak || 0) + (stats._prevStudy ? 0 : 0));
    if (!stats._prevStudy) stats.streak = Math.max(1, stats.streak || 1);
    else {
      const y = new Date(); y.setDate(y.getDate() - 1);
      if (stats._prevStudy === y.toISOString().slice(0, 10) && day.drilled === 1) stats.streak = (stats.streak || 0) + 1;
    }
    stats._prevStudy = stats.today;
    saveProgress();
    updateStats();
  }

  // ─── Data ──────────────────────────────────────────────────

  async function loadData() {
    const r = await fetch(`data/birds.json?v=${APP_VERSION}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`birds.json ${r.status}`);
    birdData = await r.json();
  }

  function getBirds() {
    const list = birdData.birds || [];
    if (settings.region === 'all') return list.slice();
    return list.filter(b => (b.regions || []).includes(settings.region));
  }

  function allTags() {
    const tags = new Set();
    getBirds().forEach(b => (b.tags || []).forEach(t => tags.add(t)));
    return [...tags].sort();
  }

  function isKnown(id, skill) {
    return getBirdProgress(id)[skill].mastery >= MASTERY_THRESHOLD;
  }

  function needsWork(id, skill) {
    const r = getBirdProgress(id)[skill];
    return r.wrong > 0 || r.mastery < 2;
  }

  function combinedMastery(id) {
    const p = getBirdProgress(id);
    return (p.look.mastery + p.sound.mastery) / 2;
  }

  function priorityScore(bird) {
    const p = getBirdProgress(bird.id);
    let score = 100 - combinedMastery(bird.id) * 15;
    score += (p.look.wrong + p.sound.wrong) * 4;
    score -= (p.look.streak + p.sound.streak);
    score += (Date.now() - (p.lastSeen || 0)) / 86400000;
    return score;
  }

  function getFilteredBirds() {
    const q = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    const filter = document.getElementById('filter-select')?.value || 'all';
    const tag = document.getElementById('tag-select')?.value || '';

    return getBirds().filter(bird => {
      if (tag && !(bird.tags || []).includes(tag)) return false;
      if (filter === 'known' && !isKnown(bird.id, 'look') && !isKnown(bird.id, 'sound')) return false;
      if (filter === 'needs-work' && !needsWork(bird.id, 'look') && !needsWork(bird.id, 'sound')) return false;
      if (q) {
        const hay = [
          bird.common_name, bird.scientific_name, bird.habitat, bird.field_marks,
          bird.call_description, bird.size, ...(bird.tags || []), ...(bird.regions || []),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ─── Helpers ───────────────────────────────────────────────

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function masteryStars(m) {
    const n = Math.round(Math.min(5, Math.max(0, m)));
    return [0, 1, 2, 3, 4].map(i => `<span class="star ${i < n ? 'filled' : ''}">★</span>`).join('');
  }

  function stopAudio() {
    if (activeAudio) {
      try { activeAudio.pause(); activeAudio.currentTime = 0; } catch { /* */ }
      activeAudio = null;
    }
  }

  function playAudio(url) {
    stopAudio();
    if (!url) {
      showToast('No audio on file for this bird.');
      return null;
    }
    // Prefer simple playback (no crossOrigin) — works with Commons + xeno-canto downloads
    const a = new Audio(url);
    a.preload = 'auto';
    activeAudio = a;
    a.onerror = () => showToast('Audio failed to load. Try the on-page player controls.');
    a.play().catch(() => showToast('Tap Play call again (browser may block autoplay).'));
    return a;
  }

  function showToast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md px-4 py-3 bg-nest-800 border border-nest-accent text-sm rounded-lg shadow-lg';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function imgTag(src, className, alt) {
    const safe = esc(src || '');
    return `<img src="${safe}" alt="${esc(alt)}" class="${className}" loading="lazy" referrerpolicy="no-referrer"
      onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'img-fallback',textContent:'Image unavailable'}));">`;
  }

  // ─── Browse ────────────────────────────────────────────────

  function renderBrowse() {
    const birds = getFilteredBirds();
    const list = document.getElementById('item-list');
    const empty = document.getElementById('empty-state');
    const summary = document.getElementById('region-summary');
    list.innerHTML = '';

    summary.textContent = `${REGION_LABELS[settings.region] || settings.region}: ${birds.length} bird${birds.length === 1 ? '' : 's'} shown (${getBirds().length} in region)`;

    if (birds.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    birds
      .slice()
      .sort((a, b) => a.common_name.localeCompare(b.common_name))
      .forEach(bird => {
        const m = combinedMastery(bird.id);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'item-card w-full p-3 bg-nest-900 border border-nest-700 rounded-lg';
        card.innerHTML = `
          ${imgTag(bird.image, 'bird-thumb mb-2', bird.common_name)}
          <div class="flex justify-between items-start gap-2 mb-1">
            <span class="font-medium text-sm">${esc(bird.common_name)}</span>
            <span class="stars shrink-0">${masteryStars(m)}</span>
          </div>
          <div class="sci-name mb-1">${esc(bird.scientific_name)}</div>
          <div class="text-xs text-nest-500 mb-2">${esc(bird.size || '')} · ${(bird.regions || []).map(r => REGION_LABELS[r] || r).slice(0, 2).join(', ')}</div>
          <div class="flex flex-wrap gap-1">
            ${(bird.tags || []).slice(0, 3).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}
          </div>
        `;
        card.addEventListener('click', () => openDetail(bird));
        list.appendChild(card);
      });
  }

  function populateTags() {
    const sel = document.getElementById('tag-select');
    const current = sel.value;
    sel.innerHTML = '<option value="">All tags</option>' +
      allTags().map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    sel.value = current;
  }

  // ─── Detail ────────────────────────────────────────────────

  function openDetail(bird) {
    selectedBird = bird;
    stopAudio();
    document.getElementById('modal-title').textContent = bird.common_name;
    document.getElementById('modal-body').innerHTML = `
      ${imgTag(bird.image, 'bird-thumb-lg mb-3', bird.common_name)}
      <p class="sci-name mb-2">${esc(bird.scientific_name)}</p>
      <p class="text-sm text-nest-400 mb-2"><strong class="text-nest-300">Size:</strong> ${esc(bird.size || '—')}</p>
      <p class="text-sm text-nest-400 mb-2"><strong class="text-nest-300">Habitat:</strong> ${esc(bird.habitat || '—')}</p>
      <p class="text-sm mb-3"><strong class="text-nest-300">Field marks:</strong> ${esc(bird.field_marks || '—')}</p>
      <p class="text-sm mb-3"><strong class="text-nest-300">Call / song:</strong> ${esc(bird.call_description || '—')}</p>
      <p class="text-xs text-nest-500 mb-2">Regions: ${(bird.regions || []).map(r => REGION_LABELS[r] || r).join(', ')}</p>
      <div class="flex flex-wrap gap-1 mb-2">${(bird.tags || []).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>
      <p class="text-xs text-nest-500 mt-2">
        Photo: ${esc(bird.image_credit || 'open source')} ·
        Audio: ${esc(bird.audio_credit || 'open source')}
      </p>
      <p class="text-xs text-nest-500">Use headphones for sound drills. Media rights belong to original authors.</p>
    `;
    const modal = document.getElementById('detail-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeDetail() {
    stopAudio();
    const modal = document.getElementById('detail-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    selectedBird = null;
  }

  // ─── Drill ─────────────────────────────────────────────────

  function buildQueue(count) {
    const pool = getFilteredBirds();
    const sorted = pool.slice().sort((a, b) => priorityScore(b) - priorityScore(a));
    return sorted.slice(0, Math.min(count, sorted.length));
  }

  function startDrill() {
    document.getElementById('drill-setup').classList.remove('hidden');
  }

  function beginDrill() {
    const focus = document.getElementById('drill-focus').value;
    const mode = document.getElementById('drill-mode').value;
    const count = parseInt(document.getElementById('drill-count').value, 10);
    const direction = document.getElementById('drill-direction').value;
    const queue = buildQueue(count);

    if (queue.length === 0) {
      alert('No birds to drill. Adjust filters or region.');
      return;
    }

    session = {
      focus,
      mode,
      direction,
      queue,
      index: 0,
      results: [],
      answered: false,
      mcOptions: null,
      itemSkill: null,
      itemKind: null,
      flipped: false,
      startTime: Date.now(),
    };

    document.getElementById('drill-setup').classList.add('hidden');
    document.getElementById('browse-view').classList.add('hidden');
    document.getElementById('browse-toolbar').classList.add('hidden');
    document.getElementById('session-summary').classList.add('hidden');
    document.getElementById('drill-view').classList.remove('hidden');
    document.getElementById('drill-mode-label').textContent =
      `${mode === 'flashcard' ? 'Flashcard' : 'Multiple Choice'} · ${focus}`;

    renderDrillItem();
  }

  function exitDrill() {
    stopAudio();
    session = null;
    document.getElementById('drill-view').classList.add('hidden');
    document.getElementById('browse-view').classList.remove('hidden');
    document.getElementById('browse-toolbar').classList.remove('hidden');
    renderBrowse();
    updateStats();
  }

  function pickItemSkill() {
    if (session.focus === 'look') return 'look';
    if (session.focus === 'sound') return 'sound';
    return Math.random() < 0.5 ? 'look' : 'sound';
  }

  function renderDrillItem() {
    if (!session) return;
    const bird = session.queue[session.index];
    if (!bird) return endSession();

    stopAudio();
    session.answered = false;
    session.mcOptions = null;
    session.flipped = false;
    session.itemSkill = pickItemSkill();
    session.itemKind = session.itemSkill; // look | sound

    document.getElementById('drill-progress-text').textContent =
      `${session.index + 1} / ${session.queue.length}`;
    document.getElementById('drill-feedback').classList.add('hidden');
    document.getElementById('drill-feedback').innerHTML = '';

    const area = document.getElementById('drill-card-area');
    const actions = document.getElementById('drill-actions');
    actions.innerHTML = '';

    if (session.mode === 'flashcard') renderFlashcard(area, actions, bird);
    else renderMC(area, actions, bird);
  }

  function mediaPromptHtml(bird, skill) {
    if (skill === 'look') {
      return `
        <div class="text-xs text-nest-400 mb-2 uppercase tracking-wider">Who is this?</div>
        ${imgTag(bird.image, 'bird-thumb-drill mx-auto', 'Mystery bird')}
      `;
    }
    return `
      <div class="sound-prompt">
        <div class="text-xs text-nest-400 uppercase tracking-wider">What bird is calling?</div>
        <button type="button" id="drill-replay" class="px-5 py-3 bg-nest-accent text-nest-950 font-semibold rounded text-lg">🔊 Play call</button>
        <audio id="drill-audio" controls preload="auto" class="w-full max-w-md mt-2" src="${esc(bird.audio || '')}"></audio>
        <p class="text-xs text-nest-500 max-w-md">${esc(bird.call_description || 'Listen carefully — no peeking at the name.')}</p>
      </div>
    `;
  }

  function wireReplay(bird) {
    const btn = document.getElementById('drill-replay');
    const el = document.getElementById('drill-audio');
    const play = () => {
      if (el && bird.audio) {
        stopAudio();
        el.src = bird.audio;
        el.play().catch(() => playAudio(bird.audio));
      } else {
        playAudio(bird.audio);
      }
    };
    if (btn) btn.onclick = (e) => { e.stopPropagation(); play(); };
    // Auto-play once when prompt appears (browser may block; controls still work)
    setTimeout(play, 100);
  }

  function renderFlashcard(area, actions, bird) {
    const nameFirst = session.direction === 'name-media';
    const skill = session.itemSkill;

    if (nameFirst) {
      area.innerHTML = `
        <div class="flashcard" id="flashcard">
          <div class="flashcard-inner" id="flashcard-inner">
            <div class="text-xs text-nest-400 mb-3">Name — click / Space to reveal ${skill}</div>
            <div class="text-2xl font-semibold mb-1">${esc(bird.common_name)}</div>
            <div class="sci-name" id="fc-back" class="hidden"></div>
            <div id="fc-media" class="hidden w-full mt-4"></div>
          </div>
        </div>
      `;
    } else {
      area.innerHTML = `
        <div class="flashcard" id="flashcard">
          <div class="flashcard-inner" id="flashcard-inner">
            <div id="fc-prompt">${mediaPromptHtml(bird, skill)}</div>
            <div id="fc-answer" class="hidden mt-4">
              <div class="text-2xl font-semibold">${esc(bird.common_name)}</div>
              <div class="sci-name">${esc(bird.scientific_name)}</div>
              <p class="text-sm text-nest-400 mt-2">${esc(skill === 'look' ? bird.field_marks : bird.call_description)}</p>
            </div>
            <p class="text-xs text-nest-500 mt-3" id="fc-hint">Click card or Space to flip</p>
          </div>
        </div>
      `;
      if (skill === 'sound') wireReplay(bird);
    }

    const flip = () => {
      session.flipped = true;
      if (nameFirst) {
        const media = document.getElementById('fc-media');
        media.classList.remove('hidden');
        if (skill === 'look') {
          media.innerHTML = imgTag(bird.image, 'bird-thumb-drill mx-auto', bird.common_name);
        } else {
          media.innerHTML = `<button type="button" id="drill-replay" class="px-4 py-2 bg-nest-accent text-nest-950 font-semibold rounded">🔊 Play call</button>`;
          wireReplay(bird);
        }
      } else {
        document.getElementById('fc-answer')?.classList.remove('hidden');
        document.getElementById('fc-hint')?.classList.add('hidden');
      }
    };

    document.getElementById('flashcard')?.addEventListener('click', (e) => {
      if (e.target.closest('#drill-replay')) return;
      if (!session.flipped) flip();
    });
    session._flip = flip;

    actions.innerHTML = `
      <button id="btn-knew" type="button" class="px-6 py-2 bg-nest-success text-nest-950 font-semibold rounded">Knew it</button>
      <button id="btn-missed" type="button" class="px-6 py-2 bg-nest-danger/80 text-white font-semibold rounded">Missed</button>
    `;
    document.getElementById('btn-knew').onclick = () => submitFlashcard(true);
    document.getElementById('btn-missed').onclick = () => submitFlashcard(false);
  }

  function submitFlashcard(correct) {
    if (!session || session.answered) return;
    session.answered = true;
    const bird = session.queue[session.index];
    if (!session.flipped && session._flip) session._flip();
    recordAnswer(bird.id, session.itemSkill, correct);
    session.results.push({ id: bird.id, name: bird.common_name, skill: session.itemSkill, correct });
    showFeedback(bird, correct);
    document.getElementById('drill-actions').innerHTML =
      `<button id="btn-next" type="button" class="px-6 py-2 bg-nest-accent text-nest-950 font-semibold rounded">Continue (Space)</button>`;
    document.getElementById('btn-next').onclick = nextDrill;
  }

  function renderMC(area, actions, bird) {
    const skill = session.itemSkill;
    const nameFirst = session.direction === 'name-media';
    const pool = getBirds().filter(b => b.id !== bird.id);
    const distractors = shuffle(pool).slice(0, 3);

    if (nameFirst) {
      // Name shown; options are short field-mark / call snippets
      const correctText = skill === 'look'
        ? (bird.field_marks || bird.common_name).slice(0, 90) + '…'
        : (bird.call_description || bird.common_name).slice(0, 90) + '…';
      const options = shuffle([
        { text: correctText, correct: true, bird },
        ...distractors.map(d => ({
          text: ((skill === 'look' ? d.field_marks : d.call_description) || d.common_name).slice(0, 90) + '…',
          correct: false,
          bird: d,
        })),
      ]);
      // Better UX for name-first: still do name MC from media when mixed - actually simpler:
      // always do photo/sound → name for MC; name-media only for flashcard
      // Override: for MC always media → name
    }

    // Multiple choice always: media → pick name (clearest learning path)
    const options = shuffle([
      { text: bird.common_name, correct: true },
      ...distractors.map(d => ({ text: d.common_name, correct: false })),
    ]);
    session.mcOptions = options;

    area.innerHTML = `
      <div class="p-4 bg-nest-900 border border-nest-600 rounded-lg text-center mb-4">
        ${mediaPromptHtml(bird, skill)}
      </div>
      <div class="grid sm:grid-cols-2 gap-2" id="mc-options">
        ${options.map((o, i) => `
          <button type="button" class="mc-option p-3 text-left bg-nest-800 border border-nest-600 rounded" data-idx="${i}">
            <span class="text-nest-500 text-xs mr-2">${i + 1}</span>
            ${esc(o.text)}
          </button>
        `).join('')}
      </div>
    `;
    if (skill === 'sound') wireReplay(bird);

    document.querySelectorAll('.mc-option').forEach(btn => {
      btn.addEventListener('click', () => pickMC(parseInt(btn.dataset.idx, 10)));
    });
  }

  function pickMC(idx) {
    if (!session || session.answered) return;
    session.answered = true;
    const bird = session.queue[session.index];
    const correct = session.mcOptions[idx].correct;

    document.querySelectorAll('.mc-option').forEach((btn, i) => {
      btn.disabled = true;
      if (session.mcOptions[i].correct) btn.classList.add('correct');
      else if (i === idx) btn.classList.add('wrong');
    });

    recordAnswer(bird.id, session.itemSkill, correct);
    session.results.push({ id: bird.id, name: bird.common_name, skill: session.itemSkill, correct });
    showFeedback(bird, correct);
    document.getElementById('drill-actions').innerHTML =
      `<button id="btn-next" type="button" class="px-6 py-2 bg-nest-accent text-nest-950 font-semibold rounded">Continue (Space)</button>`;
    document.getElementById('btn-next').onclick = nextDrill;
  }

  function showFeedback(bird, correct) {
    const el = document.getElementById('drill-feedback');
    el.classList.remove('hidden', 'feedback-correct', 'feedback-wrong');
    el.classList.add(correct ? 'feedback-correct' : 'feedback-wrong');
    el.innerHTML = `
      <div class="font-semibold mb-1">${correct ? '✓ Correct' : '✗ Not quite'} — ${esc(bird.common_name)}</div>
      <div class="sci-name mb-2">${esc(bird.scientific_name)}</div>
      <p class="text-sm text-nest-300">${esc(session.itemSkill === 'look' ? bird.field_marks : bird.call_description)}</p>
      ${session.itemSkill === 'look' ? '' : `<button type="button" id="fb-replay" class="mt-2 px-3 py-1 text-xs bg-nest-800 border border-nest-600 rounded">🔊 Replay</button>`}
    `;
    document.getElementById('fb-replay')?.addEventListener('click', () => playAudio(bird.audio));
  }

  function nextDrill() {
    if (!session) return;
    session.index++;
    if (session.index >= session.queue.length) endSession();
    else renderDrillItem();
  }

  function endSession() {
    stopAudio();
    const results = session?.results || [];
    const correct = results.filter(r => r.correct).length;
    const total = results.length;
    const weak = results.filter(r => !r.correct);

    document.getElementById('drill-view').classList.add('hidden');
    document.getElementById('session-summary').classList.remove('hidden');
    document.getElementById('summary-stats').innerHTML = `
      <div class="bg-nest-800 rounded p-3"><div class="text-xs text-nest-400">Score</div><div class="text-xl font-bold">${correct} / ${total}</div></div>
      <div class="bg-nest-800 rounded p-3"><div class="text-xs text-nest-400">Accuracy</div><div class="text-xl font-bold">${total ? Math.round(100 * correct / total) : 0}%</div></div>
      <div class="bg-nest-800 rounded p-3"><div class="text-xs text-nest-400">Time</div><div class="text-xl font-bold">${Math.round((Date.now() - (session?.startTime || Date.now())) / 1000)}s</div></div>
    `;
    document.getElementById('summary-weak').innerHTML = weak.length
      ? `<p class="text-sm text-nest-400 mb-1">Review:</p><ul class="text-sm list-disc pl-5">${weak.map(w => `<li>${esc(w.name)} (${w.skill})</li>`).join('')}</ul>`
      : `<p class="text-sm text-nest-success">Perfect session — nice work.</p>`;
    session = null;
  }

  // ─── Stats ─────────────────────────────────────────────────

  function updateStats() {
    const day = stats.daily[stats.today] || { drilled: 0, correct: 0, total: 0 };
    document.getElementById('stat-today').textContent = day.drilled || 0;
    document.getElementById('stat-accuracy').textContent =
      day.total ? `${Math.round(100 * day.correct / day.total)}%` : '—';
    document.getElementById('stat-streak').textContent = stats.streak || 0;

    const birds = birdData.birds || [];
    let lookKnown = 0, soundKnown = 0;
    birds.forEach(b => {
      if (isKnown(b.id, 'look')) lookKnown++;
      if (isKnown(b.id, 'sound')) soundKnown++;
    });
    document.getElementById('stat-mastered').textContent = Math.min(lookKnown, soundKnown);
    const n = birds.length || 1;
    document.getElementById('bar-look').style.width = `${(100 * lookKnown / n).toFixed(1)}%`;
    document.getElementById('bar-look-label').textContent = `${lookKnown} / ${birds.length}`;
    document.getElementById('bar-sound').style.width = `${(100 * soundKnown / n).toFixed(1)}%`;
    document.getElementById('bar-sound-label').textContent = `${soundKnown} / ${birds.length}`;
  }

  // ─── Settings ──────────────────────────────────────────────

  function openSettings() {
    const m = document.getElementById('settings-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
  }

  function closeSettings() {
    const m = document.getElementById('settings-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify({ progress, stats, settings, exported: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `us-bird-drillforge-progress-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importProgress(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.progress) progress = data.progress;
        if (data.stats) stats = data.stats;
        if (data.settings) settings = { ...settings, ...data.settings };
        saveProgress();
        setRegion(settings.region || 'all');
        updateStats();
        alert('Progress imported.');
      } catch {
        alert('Invalid progress file.');
      }
    };
    reader.readAsText(file);
  }

  function hardReset() {
    if (!confirm('Wipe all progress for US Bird DrillForge?')) return;
    progress = {};
    stats = { today: todayKey(), daily: {}, streak: 0, lastStudyDate: null };
    stats.daily[stats.today] = { drilled: 0, correct: 0, total: 0 };
    saveProgress();
    updateStats();
    renderBrowse();
    closeSettings();
  }

  // ─── Region tabs ───────────────────────────────────────────

  function setRegion(region) {
    settings.region = region;
    saveProgress();
    document.querySelectorAll('.region-tab').forEach(btn => {
      const active = btn.dataset.region === region;
      btn.classList.toggle('bg-nest-700', active);
      btn.classList.toggle('text-white', active);
      btn.classList.toggle('bg-nest-800', !active);
      btn.classList.toggle('text-gray-400', !active);
    });
    populateTags();
    renderBrowse();
  }

  // ─── Keyboard ──────────────────────────────────────────────

  function onKey(e) {
    if (e.target.matches('input, textarea, select')) return;
    if (!session) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (session.answered) nextDrill();
      else if (session.mode === 'flashcard' && session._flip && !session.flipped) session._flip();
    }
    if (session.mode === 'mc' && !session.answered && e.key >= '1' && e.key <= '4') {
      pickMC(parseInt(e.key, 10) - 1);
    }
  }

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    loadStorage();
    try {
      await loadData();
    } catch (err) {
      document.getElementById('item-list').innerHTML =
        `<p class="text-nest-danger col-span-full">Failed to load birds.json: ${esc(err.message)}. Serve over HTTP (not file://).</p>`;
      return;
    }

    setRegion(settings.region || 'all');
    updateStats();

    if (!localStorage.getItem(STORAGE.onboarded)) {
      const ob = document.getElementById('onboarding');
      ob.classList.remove('hidden');
      ob.classList.add('flex');
    }

    document.getElementById('onboarding-dismiss')?.addEventListener('click', () => {
      localStorage.setItem(STORAGE.onboarded, '1');
      const ob = document.getElementById('onboarding');
      ob.classList.add('hidden');
      ob.classList.remove('flex');
    });

    document.querySelectorAll('.region-tab').forEach(btn => {
      btn.addEventListener('click', () => setRegion(btn.dataset.region));
    });

    document.getElementById('search-input')?.addEventListener('input', () => renderBrowse());
    document.getElementById('filter-select')?.addEventListener('change', () => renderBrowse());
    document.getElementById('tag-select')?.addEventListener('change', () => renderBrowse());

    document.getElementById('btn-start-drill')?.addEventListener('click', startDrill);
    document.getElementById('drill-begin')?.addEventListener('click', beginDrill);
    document.getElementById('drill-cancel')?.addEventListener('click', () => {
      document.getElementById('drill-setup').classList.add('hidden');
    });
    document.getElementById('drill-exit')?.addEventListener('click', exitDrill);
    document.getElementById('summary-close')?.addEventListener('click', () => {
      document.getElementById('session-summary').classList.add('hidden');
      document.getElementById('browse-view').classList.remove('hidden');
      document.getElementById('browse-toolbar').classList.remove('hidden');
      renderBrowse();
    });

    document.getElementById('btn-settings')?.addEventListener('click', openSettings);
    document.getElementById('settings-close')?.addEventListener('click', closeSettings);
    document.getElementById('btn-export')?.addEventListener('click', exportProgress);
    document.getElementById('btn-reset')?.addEventListener('click', hardReset);
    document.getElementById('import-file')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) importProgress(f);
      e.target.value = '';
    });

    document.getElementById('modal-close')?.addEventListener('click', closeDetail);
    document.getElementById('detail-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'detail-modal') closeDetail();
    });
    document.getElementById('modal-play')?.addEventListener('click', () => {
      if (selectedBird) playAudio(selectedBird.audio);
    });
    document.getElementById('modal-drill-look')?.addEventListener('click', () => {
      if (!selectedBird) return;
      closeDetail();
      document.getElementById('drill-focus').value = 'look';
      document.getElementById('drill-mode').value = 'mc';
      session = {
        focus: 'look', mode: 'mc', direction: 'media-name',
        queue: [selectedBird], index: 0, results: [], answered: false,
        mcOptions: null, itemSkill: 'look', flipped: false, startTime: Date.now(),
      };
      document.getElementById('browse-view').classList.add('hidden');
      document.getElementById('browse-toolbar').classList.add('hidden');
      document.getElementById('drill-view').classList.remove('hidden');
      document.getElementById('drill-mode-label').textContent = 'Multiple Choice · look';
      renderDrillItem();
    });
    document.getElementById('modal-drill-sound')?.addEventListener('click', () => {
      if (!selectedBird) return;
      closeDetail();
      session = {
        focus: 'sound', mode: 'mc', direction: 'media-name',
        queue: [selectedBird], index: 0, results: [], answered: false,
        mcOptions: null, itemSkill: 'sound', flipped: false, startTime: Date.now(),
      };
      document.getElementById('browse-view').classList.add('hidden');
      document.getElementById('browse-toolbar').classList.add('hidden');
      document.getElementById('drill-view').classList.remove('hidden');
      document.getElementById('drill-mode-label').textContent = 'Multiple Choice · sound';
      renderDrillItem();
    });

    document.getElementById('stats-toggle')?.addEventListener('click', () => {
      document.getElementById('stats-panel').classList.toggle('mobile-open');
      document.getElementById('stats-panel').classList.toggle('hidden');
    });

    document.addEventListener('keydown', onKey);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
