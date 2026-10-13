/**
 * Nebula Player — App Controller
 * Binds DOM elements to PlayerState. Handles all interactions, animations, context menu.
 */

(function () {
  'use strict';

  // ── DOM References ──
  const $ = (sel) => document.querySelector(sel);
  const el = {
    bp:           $('#bottomPlayer'),
    stage:        $('#demoStage'),
    progress:     $('#bpProgress'),
    progressFill: $('#progressFill'),
    progressThumb:$('#progressThumb'),
    timeTooltip:  $('#timeTooltip'),
    cover:        $('#bpCover'),
    coverImg:     $('#coverImg'),
    song:         $('#bpSong'),
    artist:       $('#bpArtist'),
    quality:      $('#bpQuality'),
    btnPrev:      $('#btnPrev'),
    btnPlay:      $('#btnPlay'),
    btnNext:      $('#btnNext'),
    iconPlay:     $('#iconPlay'),
    iconPause:    $('#iconPause'),
    btnMode:      $('#btnMode'),
    iconMode:     $('#iconMode'),
    btnVolume:    $('#bpVolume'),
    volumeSlider: $('#volumeSlider'),
    iconVolume:   $('#iconVolume'),
    btnQueue:     $('#btnQueue'),
    queuePanel:   $('#queuePanel'),
    queueList:    $('#queueList'),
    btnHide:      $('#btnHide'),
    qualityPanel: $('#qualityPanel'),
    ctxMenu:      $('#contextMenu'),
    ctxHideLabel: $('#ctxHideLabel'),
  };

  // ── State ──
  let autoHide = false;
  let queueOpen = false;
  let qualityOpen = false;
  let ctxOpen = false;
  let ctxTarget = null;
  let isDraggingProgress = false;

  // ── Helpers ──
  function formatTime(sec) {
    if (!sec || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function updateCSSPalette(song) {
    const root = document.documentElement;
    if (song) {
      root.style.setProperty('--song-hue1', song.hue1);
      root.style.setProperty('--song-hue2', song.hue2);
      root.style.setProperty('--song-accent', `hsl(${song.hue1} 65% 60%)`);
      root.style.setProperty('--song-accent-dim', `hsl(${song.hue1} 50% 40%)`);
      root.style.setProperty('--song-accent-glow', `hsla(${song.hue1} 65% 60% / 0.25)`);
      root.style.setProperty('--glow-rgb', `${song.hue1}, ${Math.min(255, song.hue1 + 40)}, 220`);
    }
  }

  function closeAllPanels() {
    queueOpen = false;
    qualityOpen = false;
    ctxOpen = false;
    el.queuePanel.classList.remove('is-open');
    el.qualityPanel.classList.remove('is-open');
    el.ctxMenu.classList.remove('visible');
    el.ctxMenu.style.left = '';
    el.ctxMenu.style.top = '';
  }

  // ── Render: Song Change ──
  function renderSongChange() {
    const song = PlayerState.song;
    if (!song) {
      el.bp.classList.add('is-empty');
      el.coverImg.style.backgroundImage = '';
      el.song.textContent = '未在播放';
      el.artist.textContent = '点击星云卡片开始播放';
      el.quality.textContent = '—';
      updateCSSPalette(null);
      return;
    }

    el.bp.classList.remove('is-empty');
    el.coverImg.style.backgroundImage = `url(${song.cover})`;
    el.song.textContent = song.title;
    el.artist.textContent = `${song.artist} · ${song.source === 'netease' ? '网易云' : song.source === 'qq' ? 'QQ音乐' : song.source === 'kugou' ? '酷狗' : 'Spotify'}`;
    el.quality.textContent = song.quality === 'lossless' ? '无损' : song.quality === 'high' ? '高品' : song.quality === 'standard' ? '标准' : song.quality;
    updateCSSPalette(song);
    renderQueue();
    renderQuality();
  }

  // ── Render: Progress ──
  function renderTick() {
    if (isDraggingProgress) return;
    const pct = PlayerState.progress * 100;
    el.progressFill.style.width = `${pct}%`;
    el.progressThumb.style.left = `${pct}%`;
  }

  // ── Render: Play/Pause icon ──
  function renderPlayState() {
    if (PlayerState.playing) {
      el.iconPlay.style.display = 'none';
      el.iconPause.style.display = '';
      el.btnPlay.setAttribute('aria-label', '暂停');
      el.btnPlay.setAttribute('title', '暂停');
    } else {
      el.iconPlay.style.display = '';
      el.iconPause.style.display = 'none';
      el.btnPlay.setAttribute('aria-label', '播放');
      el.btnPlay.setAttribute('title', '播放');
    }
  }

  // ── Render: Mode icon ──
  function renderMode() {
    const mode = PlayerState.mode;
    el.btnMode.classList.toggle('is-active', mode !== 'sequential');
    const titles = { sequential: '顺序播放', random: '随机播放', 'repeat-one': '单曲循环' };
    el.btnMode.setAttribute('title', titles[mode]);

    const icons = {
      sequential: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>',
      random: '<path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>',
      'repeat-one': '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>',
    };
    el.iconMode.innerHTML = icons[mode] || icons.sequential;
  }

  // ── Render: Volume icon ──
  function renderVolume() {
    const vol = PlayerState.volume;
    const muted = PlayerState.muted;
    el.volumeSlider.value = muted ? 0 : vol;

    let path;
    if (muted || vol === 0) {
      path = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
    } else if (vol < 0.5) {
      path = '<path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>';
    } else {
      path = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    }
    el.iconVolume.innerHTML = path;
  }

  // ── Render: Queue ──
  function renderQueue() {
    const queue = PlayerState.queue;
    const currentIdx = PlayerState.queueIndex;
    el.queueList.innerHTML = '';

    queue.forEach((songId, i) => {
      const song = MOCK_SONGS.find(s => s.id === songId);
      if (!song) return;

      const item = document.createElement('div');
      item.className = `bp-queue-item${i === currentIdx ? ' is-current' : ''}`;
      item.innerHTML = `
        <div class="bp-queue-item-cover" style="background-image:url(${song.cover})"></div>
        <div class="bp-queue-item-info">
          <div class="bp-queue-item-title">${song.title}</div>
          <div class="bp-queue-item-artist">${song.artist}</div>
        </div>
        <button class="bp-queue-item-remove" title="移除" data-idx="${i}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      `;

      // Click to play
      item.addEventListener('click', (e) => {
        if (e.target.closest('.bp-queue-item-remove')) return;
        PlayerState.playSong(i);
      });

      // Remove button
      const removeBtn = item.querySelector('.bp-queue-item-remove');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        PlayerState.removeFromQueue(i);
      });

      el.queueList.appendChild(item);
    });
  }

  // ── Render: Quality ──
  function renderQuality() {
    const qualities = PlayerState.qualities;
    const current = PlayerState.quality;
    el.qualityPanel.innerHTML = '';

    qualities.forEach(q => {
      const btn = document.createElement('button');
      btn.className = `bp-quality-option${q.level === current ? ' is-current' : ''}`;
      btn.textContent = q.label;
      btn.addEventListener('click', () => {
        PlayerState.setQuality(q.level);
        qualityOpen = false;
        el.qualityPanel.classList.remove('is-open');
      });
      el.qualityPanel.appendChild(btn);
    });
  }

  // ═══════════════════════════════════════
  //  EVENT BINDINGS
  // ═══════════════════════════════════════

  // ── Play / Pause ──
  el.btnPlay.addEventListener('click', () => PlayerState.toggle());

  // ── Prev / Next ──
  el.btnPrev.addEventListener('click', () => PlayerState.prev());
  el.btnNext.addEventListener('click', () => PlayerState.next());

  // ── Mode ──
  el.btnMode.addEventListener('click', () => PlayerState.cycleMode());

  // ── Volume slider ──
  el.volumeSlider.addEventListener('input', (e) => {
    PlayerState.setVolume(parseFloat(e.target.value));
  });

  // ── Volume wheel ──
  el.btnVolume.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    PlayerState.setVolume(PlayerState.volume + delta);
  }, { passive: false });

  // ── Progress bar interaction ──
  function seekFromEvent(e) {
    const rect = el.progress.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    PlayerState.seekPercent(pct);
    el.progressFill.style.width = `${pct * 100}%`;
    el.progressThumb.style.left = `${pct * 100}%`;
  }

  el.progress.addEventListener('mousedown', (e) => {
    isDraggingProgress = true;
    seekFromEvent(e);

    const onMove = (ev) => {
      seekFromEvent(ev);
      // Update tooltip
      const rect = el.progress.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      el.timeTooltip.textContent = formatTime(pct * PlayerState.duration);
      el.timeTooltip.style.left = `${ev.clientX - rect.left}px`;
    };

    const onUp = () => {
      isDraggingProgress = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Progress hover → show time
  el.progress.addEventListener('mousemove', (e) => {
    if (isDraggingProgress) return;
    const rect = el.progress.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.timeTooltip.textContent = formatTime(pct * PlayerState.duration);
    el.timeTooltip.style.left = `${e.clientX - rect.left}px`;
  });

  // ── Queue toggle ──
  el.btnQueue.addEventListener('click', (e) => {
    e.stopPropagation();
    queueOpen = !queueOpen;
    el.queuePanel.classList.toggle('is-open', queueOpen);
    if (queueOpen) {
      qualityOpen = false;
      el.qualityPanel.classList.remove('is-open');
    }
  });

  // ── Quality toggle ──
  el.quality.addEventListener('click', (e) => {
    e.stopPropagation();
    qualityOpen = !qualityOpen;
    el.qualityPanel.classList.toggle('is-open', qualityOpen);
    if (qualityOpen) {
      queueOpen = false;
      el.queuePanel.classList.remove('is-open');
    }
  });

  // ── Auto-hide toggle ──
  function toggleAutoHide() {
    autoHide = !autoHide;
    el.bp.classList.toggle('is-hidden', autoHide);
    el.ctxHideLabel.textContent = autoHide ? '显示播放条' : '自动隐藏播放条';
    el.btnHide.classList.toggle('is-active', autoHide);

    // Update hide button icon
    if (autoHide) {
      el.btnHide.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" transform="rotate(180 12 12)"/></svg>';
    } else {
      el.btnHide.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>';
    }
  }

  el.btnHide.addEventListener('click', toggleAutoHide);

  // ── Context Menu ──
  el.bp.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeAllPanels();
    ctxOpen = true;
    el.ctxMenu.style.left = `${e.clientX}px`;
    el.ctxMenu.style.top = `${e.clientY}px`;
    el.ctxMenu.classList.add('visible');
    ctxTarget = { x: e.clientX, y: e.clientY };
  });

  document.addEventListener('click', (e) => {
    if (!el.ctxMenu.contains(e.target)) {
      ctxOpen = false;
      el.ctxMenu.classList.remove('visible');
    }
    // Close panels on outside click
    if (!el.queuePanel.contains(e.target) && !el.btnQueue.contains(e.target)) {
      queueOpen = false;
      el.queuePanel.classList.remove('is-open');
    }
    if (!el.qualityPanel.contains(e.target) && !el.quality.contains(e.target)) {
      qualityOpen = false;
      el.qualityPanel.classList.remove('is-open');
    }
  });

  // Context menu actions
  el.ctxMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      ctxOpen = false;
      el.ctxMenu.classList.remove('visible');

      switch (action) {
        case 'now-playing':
          // Placeholder: would open Listening Space
          console.log('[Phase 1] now-playing click — Listening Space not yet implemented');
          break;
        case 'toggle-hide':
          toggleAutoHide();
          break;
        case 'song-detail':
          console.log('[Phase 1] song-detail click');
          break;
        case 'artist':
          console.log('[Phase 1] artist click');
          break;
      }
    });
  });

  // ── Cover click → placeholder for Listening Space ──
  el.cover.addEventListener('click', () => {
    console.log('[Phase 1] cover click — Listening Space not yet implemented');
  });

  // ── Song / Artist click ──
  el.song.addEventListener('click', () => {
    console.log('[Phase 1] song detail click');
  });
  el.artist.addEventListener('click', () => {
    console.log('[Phase 1] artist click');
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        PlayerState.toggle();
        break;
      case 'ArrowLeft':
        PlayerState.seek(Math.max(0, PlayerState.currentTime - 5));
        break;
      case 'ArrowRight':
        PlayerState.seek(Math.min(PlayerState.duration, PlayerState.currentTime + 5));
        break;
      case 'ArrowUp':
        e.preventDefault();
        PlayerState.setVolume(PlayerState.volume + 0.05);
        break;
      case 'ArrowDown':
        e.preventDefault();
        PlayerState.setVolume(PlayerState.volume - 0.05);
        break;
      case 'KeyN':
        PlayerState.next();
        break;
      case 'KeyP':
        PlayerState.prev();
        break;
      case 'KeyM':
        PlayerState.toggleMute();
        break;
      case 'Escape':
        closeAllPanels();
        break;
    }
  });

  // ═══════════════════════════════════════
  //  SUBSCRIBE TO STATE
  // ═══════════════════════════════════════

  PlayerState.on((event) => {
    switch (event) {
      case 'song-change':
        renderSongChange();
        renderPlayState();
        renderTick();
        break;
      case 'play':
      case 'pause':
        renderPlayState();
        break;
      case 'tick':
        renderTick();
        break;
      case 'seek':
        renderTick();
        break;
      case 'mode-change':
        renderMode();
        break;
      case 'volume':
        renderVolume();
        break;
      case 'quality-change':
        renderQuality();
        el.quality.textContent = PlayerState.qualities.find(q => q.level === PlayerState.quality)?.label || PlayerState.quality;
        break;
      case 'queue-change':
        renderQueue();
        break;
      case 'stop':
        renderSongChange();
        renderPlayState();
        el.progressFill.style.width = '0%';
        el.progressThumb.style.left = '0%';
        break;
      case 'end':
        renderPlayState();
        break;
    }
  });

  // ═══════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════

  // Load mock queue and auto-play first song
  PlayerState.loadQueue(MOCK_QUEUE);

  // Keyboard shortcut hint
  console.log('%c🎹 Nebula Player Phase 1', 'font-size:14px;font-weight:bold;color:#8888cc;');
  console.log('%cShortcuts: Space=play/pause, ←→=seek, ↑↓=volume, N=next, P=prev, M=mute', 'color:#666;');

})();
