import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer } from '../../lib/audio/useAudioPlayer';
import type { Track } from '../../lib/catalog';
import {
  describeAutoSource,
  describeVersion,
  formatLyricOffset,
  lyricSourceName,
  requestLyricReload,
  stepLyricOffset,
  LYRIC_OFFSET_MAX_MS,
  type LyricSourceSummary,
} from '../../lib/lyricVersions';
import { hasDesktopAPI, streamTrack, toBackendTrack, type DesktopLyricPick, type DesktopLyricVersion } from '../../lib/playlist/ipcClient';
import { useOverlayScrollbar } from '../../lib/overlayScrollbar';
import { IconCheck, IconChevronLeft, IconMinus, IconPlus } from '../icons';

/** 点 − / + 之后等多久再提交（连点只提交最后一次）。 */
const COMMIT_DELAY_MS = 300;

/** 歌曲身份（含兜底供流那首）：换了歌 / 换了供流平台就重新找版本。 */
const songKey = (s: Track | null | undefined) => (s ? `${s.source}:${s.sourceId}:${s.via?.platform ?? ''}:${s.via?.sourceId ?? ''}` : '');

/**
 * 右栏「歌词版本」页（方案 A）：选一份歌词当这首歌的正文（「自动」= 各家合并），再加整份歌词的时间微调。
 * 走右栏同一套呈现：无玻璃外壳，左上角「‹ 歌词」返回，Esc 由听音空间处理（§9.9）。
 * 用的是正在播放的那首（切歌后按新歌重新加载列表）；选择 / 微调写给后端后让 useLyrics 立即重载（旧歌词留着直到新的到）。
 */
export function LyricVersionsPanel({ lyricInfo, onClose }: { lyricInfo: LyricSourceSummary | null; onClose: () => void }) {
  const song = useAudioPlayer().song;
  const key = songKey(song);
  const songRef = useRef<Track | null>(song ?? null);
  songRef.current = song ?? null;

  const [versions, setVersions] = useState<DesktopLyricVersion[]>([]);
  const [pick, setPick] = useState<DesktopLyricPick | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // 微调的防抖提交：待提交的值（连同它属于哪首歌）放 ref，离开页面 / 换歌时立即提交，不丢
  const pendingOffset = useRef<{ value: number; song: Track } | null>(null);
  const commitTimer = useRef(0);
  const pickRef = useRef<DesktopLyricPick | null>(null);
  pickRef.current = pick;

  const commit = useCallback(async (nextPick: DesktopLyricPick | null, nextOffset: number, forSong: Track) => {
    if (!hasDesktopAPI() || !window.nebulaAPI!.chooseLyric) return;
    try {
      const res = await window.nebulaAPI!.chooseLyric(streamTrack(forSong), { pick: nextPick, offsetMs: nextOffset });
      if (res.ok && songKey(songRef.current) === songKey(forSong)) requestLyricReload();
    } catch {
      /* 写不进去就保持界面上的选择，下次点击再试 */
    }
  }, []);
  const flushOffset = useCallback(() => {
    window.clearTimeout(commitTimer.current);
    const pending = pendingOffset.current;
    pendingOffset.current = null;
    if (pending) void commit(pickRef.current, pending.value, pending.song);
  }, [commit]);

  // 载入列表：换歌 = 先把上一首待提交的微调提交掉，再清空重载；取消上一次未完成的请求
  useEffect(() => {
    const s = songRef.current;
    setVersions([]);
    setPick(null);
    setOffset(0);
    setFailed(false);
    if (!s || !hasDesktopAPI() || !window.nebulaAPI!.lyricVersions) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const requestId = `lyric-versions-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let cancelled = false;
    window.nebulaAPI!
      .lyricVersions(streamTrack(s), s.via ? { requestId, origin: toBackendTrack(s) } : { requestId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setVersions(res.data.versions);
          setPick(res.data.pick);
          setOffset(res.data.offsetMs);
        } else setFailed(true);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      flushOffset();
      void window.nebulaAPI?.cancelResolve?.(requestId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const choose = (next: DesktopLyricPick | null) => {
    const s = songRef.current;
    if (!s) return;
    const same = next?.platform === pick?.platform && next?.sourceId === pick?.sourceId;
    if (same) return;
    // 待提交的微调跟着这次选择一起写，不另外再提交
    window.clearTimeout(commitTimer.current);
    pendingOffset.current = null;
    setPick(next);
    void commit(next, offset, s);
  };

  const nudge = (dir: 1 | -1) => {
    if (!songRef.current) return;
    const next = stepLyricOffset(offset, dir);
    if (next === offset) return;
    setOffset(next);
    pendingOffset.current = { value: next, song: songRef.current! };
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(flushOffset, COMMIT_DELAY_MS);
  };

  const bodyRef = useRef<HTMLDivElement>(null);
  useOverlayScrollbar(bodyRef);

  const isPicked = (v: DesktopLyricPick) => pick?.platform === v.platform && pick.sourceId === v.sourceId;
  // 选过的来源这次没列出来（没取到）：仍然显示成一行，勾在它上面，不然哪一行都没勾
  const orphan = pick && !versions.some(isPicked) ? pick : null;
  const autoDesc = !pick && lyricInfo?.provenance?.length ? describeAutoSource(lyricInfo.provenance) : '各家歌词合并，缺的互相补';
  const others = versions.length + (orphan ? 1 : 0);

  return (
    <div className="lp-pane lv-pane">
      <button type="button" className="lp-back" onClick={onClose}>
        <IconChevronLeft size={16} />
        歌词
      </button>
      <div className="lv-head">
        <h3 className="lv-title">歌词版本</h3>
        <p className="lv-sub">选一份，这首歌以后都用它；改回「自动」就恢复合并。</p>
      </div>
      <div className="lp-pane-body lv-body" ref={bodyRef}>
        <div className="lv-list" role="radiogroup" aria-label="歌词版本">
          <VersionRow name="自动（推荐）" desc={autoDesc} checked={!pick} onPick={() => choose(null)} />
          {versions.map((v) => (
            <VersionRow
              key={`${v.platform}:${v.sourceId}`}
              name={lyricSourceName(v.platform)}
              desc={describeVersion(v)}
              checked={isPicked(v)}
              onPick={() => choose({ platform: v.platform, sourceId: v.sourceId })}
            />
          ))}
          {orphan && <VersionRow name={lyricSourceName(orphan.platform)} desc="当前选择，这次没有取到" checked onPick={() => {}} />}
        </div>
        {loading && <div className="lv-hint">正在找其他版本…</div>}
        {!loading && !others && <div className="lv-hint">{failed ? '版本列表加载失败' : '没有找到其他版本'}</div>}
      </div>
      <div className="lv-offset">
        <span className="lv-txt">
          <span className="lv-name">时间微调</span>
          <span className="lv-desc">整份歌词提前或推后</span>
        </span>
        <div className="lv-step">
          <button type="button" className="lv-stepbtn" aria-label="歌词提前 0.1 秒" disabled={offset <= -LYRIC_OFFSET_MAX_MS} onClick={() => nudge(-1)}>
            <IconMinus size={16} />
          </button>
          <span className="lv-val" aria-live="polite">
            {formatLyricOffset(offset)}
          </span>
          <button type="button" className="lv-stepbtn" aria-label="歌词推后 0.1 秒" disabled={offset >= LYRIC_OFFSET_MAX_MS} onClick={() => nudge(1)}>
            <IconPlus size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionRow({ name, desc, checked, onPick }: { name: string; desc: string; checked: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className={`lv-row${checked ? ' is-on' : ''}`} onClick={onPick}>
      <span className="lv-txt">
        <span className="lv-name">{name}</span>
        <span className="lv-desc">{desc}</span>
      </span>
      <IconCheck size={16} className="lv-ck" />
    </button>
  );
}
