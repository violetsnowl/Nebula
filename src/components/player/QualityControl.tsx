import { memo, useEffect, useRef, useState } from 'react';
import { platformName, qualityCode, qualityName } from '../../lib/quality';
import type { DesktopPlaybackSourceOption } from '../../lib/playlist/ipcClient';
import type { PlaybackSourceSwitchResult, QualitySwitchResult } from '../../lib/audio/desktopPlayback';

interface QualityControlProps {
  qualities: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[];
  quality: string;
  /** 当前曲目身份键：切歌时清空该曲临时标记的不可播平台状态 */
  songKey?: string;
  /** 跨平台兜底供流时的平台名：弹层标题下注明档位来自哪个平台 */
  source?: string;
  /** 当前实际出声的平台标识（用于高亮「播放来源」列表里的当前项） */
  activePlatform?: string;
  onSelectQuality: (level: string) => Promise<QualitySwitchResult> | void;
  /** 弹层打开时按需读取可切换的播放平台列表（#323） */
  onLoadSources?: () => Promise<DesktopPlaybackSourceOption[]>;
  onSelectSource?: (platform: string) => Promise<PlaybackSourceSwitchResult> | void;
}

function tierTag(opt: DesktopPlaybackSourceOption): string {
  if (opt.tier === 'svip') return opt.isOriginal ? '原平台 · SVIP' : 'SVIP';
  if (opt.tier === 'vip') return opt.isOriginal ? '原平台 · VIP' : 'VIP';
  return opt.isOriginal ? '原平台' : '';
}

function failTag(status: PlaybackSourceSwitchResult['status']): string {
  if (status === 'trial') return '仅试听';
  if (status === 'timeout') return '超时';
  if (status === 'auth_expired') return '需重登';
  return '无整曲';
}

/**
 * 音质与播放来源：低权重文字徽章按钮；点击开关，弹层水平居中于按钮，选择后关闭，
 * 点击外部 / Escape 关闭。取代旧的 hover 弹窗（悬停间隙导致抽搐、常显关不掉）。
 */
export const QualityControl = memo(function QualityControl({
  qualities,
  quality,
  songKey,
  source,
  activePlatform,
  onSelectQuality,
  onLoadSources,
  onSelectSource,
}: QualityControlProps) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<DesktopPlaybackSourceOption[]>([]);
  const [pendingPlatform, setPendingPlatform] = useState<string | null>(null);
  const [failedTags, setFailedTags] = useState<Record<string, string>>({});
  const [pendingQuality, setPendingQuality] = useState<string | null>(null);
  const [failedQualities, setFailedQualities] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  // 列表里没有当前档位（没有歌曲、或平台给了列表外的一档）时用通用中文名兜底，绝不把原始英文标识露给用户
  const qualityLabel = qualities.find((o) => o.level === quality)?.label ?? (qualityName(quality) || '音质');

  // 切歌时重置当前曲的切换中 / 不可播标记
  useEffect(() => {
    setPendingPlatform(null);
    setFailedTags({});
    setPendingQuality(null);
    setFailedQualities({});
  }, [songKey]);

  // 切换播放来源后清空旧平台的音质不可用标记
  useEffect(() => {
    setPendingQuality(null);
    setFailedQualities({});
  }, [activePlatform]);

  useEffect(() => {
    if (!open || !onLoadSources) {
      setSources([]);
      return;
    }
    let cancelled = false;
    void onLoadSources().then((list) => {
      if (!cancelled) setSources(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, songKey, activePlatform, onLoadSources]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleQualityClick = (level: string) => {
    setPendingQuality(level);
    setFailedQualities((prev) => {
      if (!prev[level]) return prev;
      const next = { ...prev };
      delete next[level];
      return next;
    });
    const ret = onSelectQuality(level);
    if (!ret || typeof (ret as Promise<QualitySwitchResult>).then !== 'function') {
      setPendingQuality(null);
      setOpen(false);
      return;
    }
    void (ret as Promise<QualitySwitchResult>).then((res) => {
      setPendingQuality((cur) => (cur === level ? null : cur));
      if (!res || res.status === 'cancelled') return;
      if (res.ok) {
        setOpen(false);
        return;
      }
      if (res.status !== 'noop') {
        setFailedQualities((prev) => ({
          ...prev,
          [level]: res.status === 'auth_expired' ? '需重登' : '不可用',
        }));
      }
    });
  };

  const handleSourceClick = (platform: string) => {
    if (!onSelectSource) return;
    if (platform === activePlatform) {
      setOpen(false);
      return;
    }
    setPendingPlatform(platform);
    setFailedTags((prev) => {
      if (!prev[platform]) return prev;
      const next = { ...prev };
      delete next[platform];
      return next;
    });
    const ret = onSelectSource(platform);
    if (!ret || typeof (ret as Promise<PlaybackSourceSwitchResult>).then !== 'function') {
      setPendingPlatform(null);
      setOpen(false);
      return;
    }
    void (ret as Promise<PlaybackSourceSwitchResult>).then((res) => {
      setPendingPlatform((cur) => (cur === platform ? null : cur));
      if (!res || res.status === 'cancelled') return;
      if (res.ok) {
        setOpen(false);
        return;
      }
      if (res.status !== 'noop') {
        setFailedTags((prev) => ({ ...prev, [platform]: failTag(res.status) }));
      }
    });
  };

  return (
    <div className="quality-ctl" ref={rootRef}>
      <button
        className={`bp-ctrl bp-quality${open ? ' is-active' : ''}`}
        aria-label={`音质：${qualityLabel}`}
        data-tip={open ? undefined : `音质：${qualityLabel}`}
        onClick={() => setOpen((o) => !o)}
      >
        {/* 按钮上写代号，悬停提示与弹层给全称（NEBULA_UI_SYSTEM §9.1） */}
        <span className="quality-badge">{qualityCode(qualityLabel)}</span>
      </button>
      {open && (
        <div className="quality-pop glass-g3">
          <div className="queue-pop-title">
            音质
            {source && <span className="quality-src">{source}音源</span>}
          </div>
          {qualities.map((o) => {
            const isCur = o.level === quality;
            const isBusy = pendingQuality === o.level;
            const fail = failedQualities[o.level];
            const tag = isBusy ? '切换中…' : fail || '';
            return (
              <button
                key={o.level}
                className={`quality-item${isCur ? ' is-current' : ''}${isBusy ? ' is-busy' : ''}${fail ? ' is-unavailable' : ''}`}
                onClick={() => handleQualityClick(o.level)}
              >
                <span>{o.label}</span>
                {tag && <span className="quality-src-tag">{tag}</span>}
              </button>
            );
          })}
          {onSelectSource && sources.length > 1 && (
            <>
              <div className="quality-sep" />
              <div className="queue-pop-title">播放来源</div>
              {sources.map((opt) => {
                const isCur = opt.platform === activePlatform;
                const isBusy = pendingPlatform === opt.platform;
                const fail = failedTags[opt.platform];
                const tag = isBusy ? '切换中…' : fail || tierTag(opt);
                return (
                  <button
                    key={opt.platform}
                    className={`quality-src-item${isCur ? ' is-current' : ''}${isBusy ? ' is-busy' : ''}${fail ? ' is-unavailable' : ''}`}
                    onClick={() => handleSourceClick(opt.platform)}
                  >
                    <span>{platformName(opt.platform)}</span>
                    {tag && <span className="quality-src-tag">{tag}</span>}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
});
