/**
 * Nebula Player — Mock Playback State Machine
 * Simulates audio playback with timer-driven progress.
 * All UI bindings read from this state.
 */

const PlayerState = (() => {
  // ── Internal State ──
  let _song = null;
  let _playing = false;
  let _currentTime = 0;
  let _duration = 0;
  let _volume = 0.8;
  let _muted = false;
  let _mode = 'sequential'; // sequential | random | repeat-one
  let _queue = [];
  let _queueIndex = -1;
  let _quality = '';
  let _qualities = [];
  let _timer = null;
  let _listeners = [];

  // ── Public API ──
  return {
    get song() { return _song; },
    get playing() { return _playing; },
    get currentTime() { return _currentTime; },
    get duration() { return _duration; },
    get volume() { return _muted ? 0 : _volume; },
    get muted() { return _muted; },
    get mode() { return _mode; },
    get queue() { return _queue; },
    get queueIndex() { return _queueIndex; },
    get quality() { return _quality; },
    get qualities() { return _qualities; },
    get progress() { return _duration > 0 ? _currentTime / _duration : 0; },

    /** Subscribe to state changes */
    on(fn) {
      _listeners.push(fn);
      return () => { _listeners = _listeners.filter(l => l !== fn); };
    },

    /** Notify all listeners */
    _emit(event) {
      for (const fn of _listeners) fn(event);
    },

    /** Load queue and play first song */
    loadQueue(songIds) {
      _queue = songIds.slice();
      _queueIndex = -1;
      this.playSong(0);
    },

    /** Play song at queue index */
    playSong(index) {
      if (index < 0 || index >= _queue.length) return;
      _queueIndex = index;
      const songId = _queue[index];
      _song = MOCK_SONGS.find(s => s.id === songId) || null;
      if (!_song) return;

      _duration = _song.duration;
      _currentTime = 0;
      _quality = _song.quality;
      _qualities = this._getQualities(_song.source);

      this._startTimer();
      _playing = true;
      this._emit('song-change');
      this._emit('play');
    },

    /** Toggle play/pause */
    toggle() {
      if (!_song) return;
      if (_playing) {
        this.pause();
      } else {
        this.play();
      }
    },

    play() {
      if (!_song) return;
      if (_currentTime >= _duration) {
        _currentTime = 0;
      }
      this._startTimer();
      _playing = true;
      this._emit('play');
    },

    pause() {
      this._stopTimer();
      _playing = false;
      this._emit('pause');
    },

    /** Seek to time (seconds) */
    seek(time) {
      _currentTime = Math.max(0, Math.min(_duration, time));
      this._emit('seek');
    },

    /** Seek by percentage (0-1) */
    seekPercent(pct) {
      this.seek(pct * _duration);
    },

    /** Next track */
    next() {
      if (_queue.length === 0) return;
      let nextIdx;
      if (_mode === 'repeat-one') {
        nextIdx = _queueIndex;
      } else if (_mode === 'random') {
        nextIdx = Math.floor(Math.random() * _queue.length);
      } else {
        nextIdx = (_queueIndex + 1) % _queue.length;
      }
      this.playSong(nextIdx);
    },

    /** Previous track */
    prev() {
      if (_queue.length === 0) return;
      // If >3s into song, restart; otherwise go previous
      if (_currentTime > 3) {
        this.seek(0);
        return;
      }
      let prevIdx;
      if (_mode === 'random') {
        prevIdx = Math.floor(Math.random() * _queue.length);
      } else {
        prevIdx = (_queueIndex - 1 + _queue.length) % _queue.length;
      }
      this.playSong(prevIdx);
    },

    /** Cycle playback mode */
    cycleMode() {
      const modes = ['sequential', 'random', 'repeat-one'];
      const idx = modes.indexOf(_mode);
      _mode = modes[(idx + 1) % modes.length];
      this._emit('mode-change');
    },

    /** Set volume (0-1) */
    setVolume(v) {
      _volume = Math.max(0, Math.min(1, v));
      if (_volume > 0) _muted = false;
      this._emit('volume');
    },

    /** Toggle mute */
    toggleMute() {
      _muted = !_muted;
      this._emit('volume');
    },

    /** Set quality */
    setQuality(level) {
      _quality = level;
      this._emit('quality-change');
    },

    /** Remove song from queue */
    removeFromQueue(index) {
      if (index < 0 || index >= _queue.length) return;
      _queue.splice(index, 1);
      if (index < _queueIndex) {
        _queueIndex--;
      } else if (index === _queueIndex) {
        // Current song removed
        if (_queue.length === 0) {
          this.stop();
        } else {
          const newIdx = Math.min(index, _queue.length - 1);
          this.playSong(newIdx);
          return; // playSong already emits
        }
      }
      this._emit('queue-change');
    },

    /** Stop playback */
    stop() {
      this._stopTimer();
      _playing = false;
      _song = null;
      _currentTime = 0;
      _duration = 0;
      _queueIndex = -1;
      this._emit('stop');
    },

    /** Get current lyric line index */
    getCurrentLyricIndex() {
      if (!_song || !_song.lyrics) return -1;
      const timeMs = _currentTime * 1000;
      let idx = -1;
      for (let i = 0; i < _song.lyrics.length; i++) {
        if (_song.lyrics[i].time <= timeMs) idx = i;
        else break;
      }
      return idx;
    },

    /** Get word progress for current lyric (0-1) */
    getWordProgress(lyricIdx, wordIdx) {
      if (!_song || !_song.lyrics) return 0;
      const line = _song.lyrics[lyricIdx];
      if (!line || !line.words || !line.words[wordIdx]) return 0;
      const word = line.words[wordIdx];
      const timeMs = _currentTime * 1000;
      if (timeMs < word.time) return 0;
      if (timeMs >= word.time + word.duration) return 1;
      return (timeMs - word.time) / word.duration;
    },

    // ── Internal ──

    _startTimer() {
      this._stopTimer();
      const tick = () => {
        if (!_playing) return;
        _currentTime += 0.1;
        if (_currentTime >= _duration) {
          _currentTime = _duration;
          this._stopTimer();
          _playing = false;
          this._emit('end');
          // Auto-advance
          this.next();
          return;
        }
        this._emit('tick');
      };
      _timer = setInterval(tick, 100);
    },

    _stopTimer() {
      if (_timer !== null) {
        clearInterval(_timer);
        _timer = null;
      }
    },

    _getQualities(source) {
      const qMap = {
        netease: [
          { level: 'standard', label: '标准' },
          { level: 'exhigh', label: '极高' },
          { level: 'lossless', label: '无损' },
          { level: 'hires', label: 'Hi-Res' },
        ],
        qq: [
          { level: '128', label: '标准 128k' },
          { level: '320', label: '高品 320k' },
          { level: 'flac', label: '无损 FLAC' },
        ],
        kugou: [
          { level: '128', label: '标准' },
          { level: '320', label: '高品' },
          { level: 'flac', label: '无损' },
        ],
        spotify: [
          { level: 'normal', label: 'Normal' },
          { level: 'high', label: 'High' },
          { level: 'very_high', label: 'Very High' },
        ],
      };
      return qMap[source] || [{ level: 'standard', label: '标准' }];
    },
  };
})();
