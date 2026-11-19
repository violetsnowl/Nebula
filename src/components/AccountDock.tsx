import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import QRCode from 'qrcode';
import type { DesktopLoginPlatform } from '../lib/playlist/ipcClient';
import type { AccountState } from '../lib/accounts';
import type { BackgroundSetting } from '../lib/backgrounds';
import type { CoverBgMode } from '../lib/backgrounds';
import type { GlassTheme } from '../lib/glass';
import type { ListenSettingsPatch, LyricVisualSettings } from '../lib/lyricSettings';
import { audioPlayer } from '../lib/audio/AudioPlayer';
import { currentLyricIndex, type LyricLineUI } from '../lib/lyrics';
import { SideDock } from './dock/SideDock';
import { hslToRgb, rgbToHsl, sampleCover } from '../lib/coverColors';
import weLogo from '../../docs/logo/wallpaper-engine.webp';
import { DOCK_PLATFORM_ORDER, LOGIN_HOW, platformMeta } from './platforms';
import { IconCheck, IconChevronLeft, IconChevronRight, IconExternal, IconImage, IconRefresh } from './icons';
import { setListenSettings as setListenSpaceSettings, useListenSettings as useListenSpaceSettings } from '../lib/listen/settings';
import { ListenPreview } from './listen/ListenPreview';
import { setSpaceLab, useSpaceLab, type StageLayout } from '../lib/space/lab';
import { detectScript, toEngineLine, type EngineLine } from '../lib/listen/model';
import { TYPO, measureUnits, renderUnits, unitFrame, waveOf, wholeLift, type UnitRt } from '../lib/listen/words';
import './listen/lyric-words.css';
import './dock/right-panel.css';

export type DockSettingsPage = 'lyrics' | 'listen' | 'bg' | 'look';

interface AccountDockProps {
  visible: boolean;
  platforms: DesktopLoginPlatform[];
  accounts: Record<string, AccountState>;
  selectedPlatform: string;
  /** 外部「去登录」请求计数：变化时打开账号面板并推入对应平台的详情。 */
  loginNonce: number;
  /** 外部「打开账号列表」请求计数（首次启动空状态的「登录音乐平台」）：只打开账号页、停在平台列表，不替用户选平台。 */
  accountListNonce?: number;
  bgSetting: BackgroundSetting;
  coverMode: CoverBgMode;
  lyricSettings: LyricVisualSettings;
  uiHideCards: boolean;
  uiHideLyrics: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onSelectPlatform: (platform: string) => void;
  onRefreshAccount: (platform: string) => void;
  onSelectBg: (s: BackgroundSetting) => void;
  onFile: (f: File) => void;
  onCoverMode: (m: CoverBgMode) => void;
  onOpenWallpapers: () => void;
  onFontSize: (n: number) => void;
  onLayerMode: (m: LyricVisualSettings['layerMode']) => void;
  onCurrentScale: (n: number) => void;
  onLyricLayout: (m: LyricVisualSettings['lyricLayout']) => void;
  onLyricColorSource: (s: LyricVisualSettings['lyricColorSource']) => void;
  onCustomColor: (c: string) => void;
  onLyricBold: (b: boolean) => void;
  /** 漫游 / 聆听交接设置（NEBULA_UI_SYSTEM §7.1）。 */
  onListenSettings: (patch: ListenSettingsPatch) => void;
  onToggleHideCards: () => void;
  onToggleHideLyrics: () => void;
  /** 材质主题（液态 / 磨砂，NEBULA_UI_SYSTEM §3.2）。 */
  glassTheme: GlassTheme;
  onGlassTheme: (theme: GlassTheme) => void;
  /** 性能优先（NEBULA_UI_SYSTEM §3.7）：关掉折射、色散与环境光漂移。 */
  perfPriority: boolean;
  onPerfPriority: (on: boolean) => void;
  /** 帧监测自动降到的档位（0 = 未降级）。 */
  perfAutoLevel: number;
  /** 鼠标靠近右边缘（提示光痕变亮）。 */
  near: boolean;
  /** 当前播放歌曲的封面（背景页「雾中封面」、外观页材质预览用；没有歌曲时为空）。 */
  coverUrl: string;
  /** 当前歌曲的歌词（歌词设置页的实时预览用）。 */
  lyricLines: LyricLineUI[];
  /** 面板开 / 关：通知边缘感应钉住或解除。 */
  onPinChange: (open: boolean) => void;
}

/* ---------- 面板内的小控件（样式在 dock/panel-kit.css） ---------- */

/**
 * 分段控件（§9.5）：选中段是一块滑块，换选项时带一点果冻弹性滑过去（P4 那版的动效，适配新面板）。
 * 每段按文字自然宽度排开，滑块的位置和宽度量自选中按钮，所以长短不一的选项也能对齐。
 */
function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
  wide,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 第一次量到位置前不显示滑块，也不做过渡（避免从左边滑进来）
  const [placed, setPlaced] = useState(false);
  const idx = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const btn = el.querySelectorAll<HTMLButtonElement>(':scope > button')[idx];
      if (!btn || btn.offsetWidth === 0) return;
      el.style.setProperty('--gx', `${btn.offsetLeft}px`);
      el.style.setProperty('--gw', `${btn.offsetWidth}px`);
      setPlaced(true);
    };
    place();
    // 字体晚到、面板宽度变化时重新量
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [idx, options.length]);

  return (
    <div
      ref={ref}
      className={`seg${wide ? ' wide rp-tabs' : ''}${placed ? ' is-placed' : ''}`}
      role="group"
      aria-label={label}
    >
      <span className="seg-glider" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 开关（§9.5：开启态 --acc）。 */
function Tg({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className="tg"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

/** 整行滑杆：名称 + 数值在上，滑杆铺满下面一行。 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / Math.max(1e-6, max - min)) * 100));
  return (
    <div className="row-col">
      <div className="head">
        <span className="lbl">{label}</span>
        <span className="val">{format(value)}</span>
      </div>
      <input
        className="rng"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--p': `${pct}%` } as React.CSSProperties}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** 可点的行（role=button，回车 / 空格也能触发）。 */
function RowButton({
  onClick,
  children,
  className,
  busy,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
  busy?: boolean;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      className={`row btn-row${className ? ` ${className}` : ''}`}
      role="button"
      tabIndex={0}
      aria-busy={busy || undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/** 刷新中的图标至少转这么久，太快完成时不会一闪而过。 */
const REFRESH_MIN_SPIN = 600;
/** 「已更新」停留时长（与 Toast 一致）。 */
const REFRESH_DONE_HOLD = 2400;

/**
 * 「刷新账号信息」（2026-11-14，用户反馈）：原地执行的动作，不是进入下一页，所以行尾不放箭头，
 * 放刷新图标；点了图标旋转、说明换成「正在刷新…」，完成后换成勾和「已更新」，2.4 秒后复原。刷新中再点无效。
 */
function RefreshRow({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const askedAt = useRef(0);
  useEffect(() => {
    if (loading || !askedAt.current) return;
    // 这次刷新是用户点的，并且已经结束：补足最短旋转时间后报告「已更新」
    const wait = Math.max(0, REFRESH_MIN_SPIN - (performance.now() - askedAt.current));
    askedAt.current = 0;
    let hold = 0;
    const t = window.setTimeout(() => {
      setPhase('done');
      hold = window.setTimeout(() => setPhase('idle'), REFRESH_DONE_HOLD);
    }, wait);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(hold);
    };
  }, [loading]);
  const click = () => {
    if (phase === 'busy' || loading) return;
    askedAt.current = performance.now();
    setPhase('busy');
    onRefresh();
  };
  const busy = phase === 'busy';
  return (
    <RowButton onClick={click} className={busy ? 'is-busy' : undefined} busy={busy}>
      <span className="lbl">
        刷新账号信息
        <small role="status">{busy ? '正在刷新…' : phase === 'done' ? '已更新' : '会员状态、歌单数量'}</small>
      </span>
      <span className={`act${busy ? ' is-spin' : ''}${phase === 'done' ? ' is-done' : ''}`}>
        {phase === 'done' ? <IconCheck size={15} /> : <IconRefresh size={15} />}
      </span>
    </RowButton>
  );
}

function vipText(a: AccountState | undefined): string {
  return a?.isSvip ? 'SVIP' : a?.isVip ? 'VIP' : '普通用户';
}

/** 登录失效时列表里的一句话（#157）：过期 / 票据缺失都要重新登录，用户只需要知道这一点。 */
function lapseText(a: AccountState | undefined): string | null {
  if (!a || a.loggedIn || !a.auth) return null;
  return a.auth === 'expired' ? '登录已过期' : '需要重新登录';
}

/* ---------- 登录流程（逻辑 / IPC 与原来一致，外观换成新语言） ---------- */

/** 网易云：官方库二维码登录（主项目既有实现）。 */
function NeteaseLogin({ onSuccess }: { onSuccess: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const unikeyRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const failRef = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!window.nebulaAPI) return;
    stopPoll();
    setQr(null);
    setStatus('正在生成二维码…');
    const res = await window.nebulaAPI.loginQrFor('netease');
    if (!res.ok) {
      setStatus(`获取二维码失败：${res.error}`);
      return;
    }
    unikeyRef.current = res.data.unikey;
    if (res.data.imageDataUrl) {
      setQr(res.data.imageDataUrl);
    } else {
      try {
        setQr(await QRCode.toDataURL(res.data.payload, { width: 296, margin: 1 }));
      } catch {
        setStatus('二维码生成失败，请刷新重试');
        return;
      }
    }
    setStatus('请使用网易云 App 扫码登录');
    failRef.current = 0;
    pollRef.current = window.setInterval(async () => {
      if (!unikeyRef.current) return;
      try {
        const r = await window.nebulaAPI!.loginPollFor('netease', unikeyRef.current);
        if (!r.ok) {
          failRef.current++;
          if (failRef.current >= 3) {
            setStatus(`轮询失败：${r.error}，请刷新二维码`);
            stopPoll();
          } else {
            setStatus(`连接波动，自动重试（${failRef.current}/3）`);
          }
          return;
        }
        failRef.current = 0;
        if (r.data.ok) {
          stopPoll();
          setStatus(r.data.message);
          onSuccess();
        } else {
          setStatus(r.data.message);
        }
      } catch {
        /* ignore */
      }
    }, 3000);
  }, [onSuccess, stopPoll]);

  useEffect(() => stopPoll, [stopPoll]);

  return (
    <div className="rp-flow">
      {qr ? <img className="rp-qr" src={qr} alt="网易云登录二维码" /> : <div className="rp-qr is-empty" />}
      <div className="rp-flow-status">{status || '未登录网易云'}</div>
      <button type="button" className="btn primary full" onClick={start}>
        {qr ? '刷新二维码' : '开始扫码登录'}
      </button>
    </div>
  );
}

/** QQ 音乐：官方登录页 + 粘贴 Cookie（主项目既有实现）。 */
function QqLogin({ onSuccess, lapsed = false }: { onSuccess: () => void; lapsed?: boolean }) {
  const [cookieMode, setCookieMode] = useState(false);
  const [cookieText, setCookieText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const openWindow = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setBusy(true);
    setStatus('已打开官方登录页，请在窗口内用手机 QQ 扫码并确认…');
    try {
      const r = await window.nebulaAPI.qqLoginWindow();
      const data = r.ok ? r.data : null;
      if (data?.ok) {
        setStatus(data.message ?? '登录成功');
        onSuccess();
      } else {
        setStatus(data?.error ?? '登录窗口已关闭');
      }
    } finally {
      setBusy(false);
    }
  }, [onSuccess]);

  const importCookie = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setBusy(true);
    try {
      const r = await window.nebulaAPI.setCookie('qq', cookieText.trim());
      if (!r.ok) {
        setStatus(`Cookie 无效：${r.error}`);
        return;
      }
      setCookieText('');
      setCookieMode(false);
      setStatus('Cookie 导入成功');
      onSuccess();
    } finally {
      setBusy(false);
    }
  }, [cookieText, onSuccess]);

  return (
    <div className="rp-flow">
      <button type="button" className="btn primary full" disabled={busy} onClick={openWindow}>
        {busy ? '等待官方页登录…' : '打开官方登录页（扫码）'}
      </button>
      <button
        type="button"
        className="btn text"
        onClick={() => {
          setCookieMode((v) => !v);
          setStatus('粘贴 QQ 音乐 Cookie（需含 uin 与 music_key / p_skey / skey）');
        }}
      >
        {cookieMode ? '收起 Cookie 粘贴' : '粘贴 Cookie 登录'}
      </button>
      {cookieMode && (
        <>
          <textarea
            className="rp-cookie-input"
            rows={4}
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            placeholder="粘贴 Cookie…"
            spellCheck={false}
          />
          <button type="button" className="btn sec full" disabled={busy || !cookieText.trim()} onClick={importCookie}>
            导入并验证
          </button>
        </>
      )}
      {(status || !lapsed) && <div className="rp-flow-status">{status || '未登录 QQ 音乐'}</div>}
    </div>
  );
}

function SpotifyLogin({ onSuccess }: { onSuccess: () => void }) {
  const [status, setStatus] = useState('');
  const start = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setStatus('已在浏览器打开 Spotify 授权页，完成后会自动回到这里');
    const r = await window.nebulaAPI.spotifyLoginStart();
    if (!r.ok) {
      setStatus(r.error || '授权未完成，请重试');
      return;
    }
    if (!r.data) {
      setStatus('授权未完成，请重试');
      return;
    }
    setStatus('授权成功');
    onSuccess();
  }, [onSuccess]);
  return (
    <div className="rp-flow">
      <button type="button" className="btn primary full" onClick={start}>
        使用 Spotify 授权登录
      </button>
      <div className="rp-flow-status">{status || '未登录 Spotify'}</div>
    </div>
  );
}

/** 酷狗音乐：手机端扫码登录（用酷狗音乐 App 扫码）。 */
function KugouLogin({ onSuccess }: { onSuccess: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const unikeyRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const failRef = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!window.nebulaAPI) return;
    stopPoll();
    setQr(null);
    setStatus('正在生成二维码…');
    const res = await window.nebulaAPI.loginQrFor('kugou');
    if (!res.ok) {
      setStatus(`获取二维码失败：${res.error}`);
      return;
    }
    unikeyRef.current = res.data.unikey;
    if (res.data.imageDataUrl) {
      setQr(res.data.imageDataUrl);
    } else {
      try {
        setQr(await QRCode.toDataURL(res.data.payload, { width: 296, margin: 1 }));
      } catch {
        setStatus('二维码生成失败，请刷新重试');
        return;
      }
    }
    setStatus('用酷狗音乐 App 扫码登录');
    failRef.current = 0;
    pollRef.current = window.setInterval(async () => {
      if (!unikeyRef.current) return;
      try {
        const r = await window.nebulaAPI!.loginPollFor('kugou', unikeyRef.current);
        if (!r.ok) {
          failRef.current++;
          if (failRef.current >= 3) {
            setStatus(`轮询失败：${r.error}，请刷新二维码`);
            stopPoll();
          } else {
            setStatus(`连接波动，自动重试（${failRef.current}/3）`);
          }
          return;
        }
        failRef.current = 0;
        if (r.data.ok) {
          stopPoll();
          setStatus(r.data.message);
          onSuccess();
        } else {
          setStatus(r.data.message);
        }
      } catch {
        /* ignore */
      }
    }, 3000);
  }, [onSuccess, stopPoll]);

  useEffect(() => stopPoll, [stopPoll]);

  return (
    <div className="rp-flow">
      {qr ? <img className="rp-qr" src={qr} alt="酷狗登录二维码" /> : <div className="rp-qr is-empty" />}
      <div className="rp-flow-status">{status || '未登录酷狗音乐'}</div>
      <button type="button" className="btn primary full" onClick={start}>
        {qr ? '刷新二维码' : '开始扫码登录'}
      </button>
    </div>
  );
}

/** 波点音乐：手机端扫码登录（用波点音乐 App 扫码）。 */
function BodianLogin({ onSuccess }: { onSuccess: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const unikeyRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const failRef = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!window.nebulaAPI) return;
    stopPoll();
    setQr(null);
    setStatus('正在生成二维码…');
    const res = await window.nebulaAPI.loginQrFor('bodian');
    if (!res.ok) {
      setStatus(`获取二维码失败：${res.error}`);
      return;
    }
    unikeyRef.current = res.data.unikey;
    if (res.data.imageDataUrl) {
      setQr(res.data.imageDataUrl);
    } else {
      try {
        setQr(await QRCode.toDataURL(res.data.payload, { width: 296, margin: 1 }));
      } catch {
        setStatus('二维码生成失败，请刷新重试');
        return;
      }
    }
    setStatus('用波点音乐 App 扫码登录');
    failRef.current = 0;
    pollRef.current = window.setInterval(async () => {
      if (!unikeyRef.current) return;
      try {
        const r = await window.nebulaAPI!.loginPollFor('bodian', unikeyRef.current);
        if (!r.ok) {
          failRef.current++;
          if (failRef.current >= 3) {
            setStatus(`轮询失败：${r.error}，请刷新二维码`);
            stopPoll();
          } else {
            setStatus(`连接波动，自动重试（${failRef.current}/3）`);
          }
          return;
        }
        failRef.current = 0;
        if (r.data.ok) {
          stopPoll();
          setStatus(r.data.message);
          onSuccess();
        } else {
          setStatus(r.data.message);
        }
      } catch {
        /* ignore */
      }
    }, 3000);
  }, [onSuccess, stopPoll]);

  useEffect(() => stopPoll, [stopPoll]);

  return (
    <div className="rp-flow">
      {qr ? <img className="rp-qr" src={qr} alt="波点登录二维码" /> : <div className="rp-qr is-empty" />}
      <div className="rp-flow-status">{status || '未登录波点音乐'}</div>
      <button type="button" className="btn primary full" onClick={start}>
        {qr ? '刷新二维码' : '开始扫码登录'}
      </button>
    </div>
  );
}

/** YouTube Music：设备码登录。在默认浏览器打开 google.com/device 输入代码（Google 不允许在内嵌窗口里登录）。 */
function YtmusicLogin({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState<{ userCode: string; verificationUrl: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const unikeyRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const failRef = useRef(0);
  const polling = useRef(false);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!window.nebulaAPI || busy) return;
    stopPoll();
    unikeyRef.current = null;
    setCode(null);
    setBusy(true);
    setStatus('正在获取登录代码…');
    const res = await window.nebulaAPI.loginQrFor('ytmusic');
    setBusy(false);
    if (!res.ok) {
      setStatus(`获取登录代码失败：${res.error}`);
      return;
    }
    const { unikey, userCode, verificationUrl } = res.data;
    if (!userCode) {
      setStatus('获取登录代码失败，请重试');
      return;
    }
    unikeyRef.current = unikey;
    setCode({ userCode, verificationUrl: verificationUrl || res.data.payload });
    setStatus('等待你在浏览器里完成授权…');
    failRef.current = 0;
    const seconds = Math.max(5, res.data.interval ?? 5);
    pollRef.current = window.setInterval(async () => {
      if (!unikeyRef.current || polling.current) return;
      polling.current = true;
      try {
        const r = await window.nebulaAPI!.loginPollFor('ytmusic', unikeyRef.current);
        if (!r.ok) {
          failRef.current++;
          if (failRef.current >= 3) {
            setStatus(`轮询失败：${r.error}，请重新获取代码`);
            stopPoll();
          } else {
            setStatus(`连接波动，自动重试（${failRef.current}/3）`);
          }
          return;
        }
        failRef.current = 0;
        setStatus(r.data.message);
        if (r.data.ok) {
          stopPoll();
          onSuccess();
        } else if (r.data.final) {
          stopPoll();
          unikeyRef.current = null;
        }
      } catch {
        /* ignore */
      } finally {
        polling.current = false;
      }
    }, seconds * 1000);
  }, [busy, onSuccess, stopPoll]);

  const openBrowser = useCallback(async () => {
    if (!code || !window.nebulaAPI) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(code.userCode);
      copied = true;
    } catch {
      /* 剪贴板不可用时用户照着屏幕上的代码输入 */
    }
    await window.nebulaAPI.openExternal(code.verificationUrl);
    setStatus(copied ? '代码已复制，在浏览器里粘贴后完成授权' : '已在浏览器打开，请输入上面的代码');
  }, [code]);

  useEffect(() => stopPoll, [stopPoll]);

  return (
    <div className="rp-flow">
      {code ? (
        <>
          <div className="rp-code" aria-label="登录代码">
            {code.userCode}
          </div>
          <p className="rp-flow-status">在浏览器打开 google.com/device，输入上面的代码</p>
          <button type="button" className="btn primary full" onClick={openBrowser}>
            在浏览器中打开
          </button>
          <button type="button" className="btn sec full" disabled={busy} onClick={start}>
            重新获取
          </button>
        </>
      ) : (
        <button type="button" className="btn primary full" disabled={busy} onClick={start}>
          获取登录代码
        </button>
      )}
      <div className="rp-flow-status">{status || '未登录 YouTube Music'}</div>
    </div>
  );
}

/** 汽水音乐：手机端扫码登录（用汽水音乐 App 扫码）。二次验证的验证页会在主窗口里弹出。 */
function QishuiLogin({ onSuccess }: { onSuccess: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const unikeyRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const failRef = useRef(0);
  const inflightRef = useRef(false);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!window.nebulaAPI) return;
    stopPoll();
    setQr(null);
    setStatus('正在生成二维码…');
    const res = await window.nebulaAPI.loginQrFor('qishui');
    if (!res.ok) {
      setStatus(`获取二维码失败：${res.error}`);
      return;
    }
    unikeyRef.current = res.data.unikey;
    if (res.data.imageDataUrl) {
      setQr(res.data.imageDataUrl);
    } else {
      try {
        setQr(await QRCode.toDataURL(res.data.payload, { width: 296, margin: 1 }));
      } catch {
        setStatus('二维码生成失败，请刷新重试');
        return;
      }
    }
    setStatus('用汽水音乐 App 扫码登录');
    failRef.current = 0;
    inflightRef.current = false;
    pollRef.current = window.setInterval(async () => {
      // 二次验证要等用户在验证页里操作，上一次查询还没回来就不再发下一次
      if (!unikeyRef.current || inflightRef.current) return;
      inflightRef.current = true;
      try {
        const r = await window.nebulaAPI!.loginPollFor('qishui', unikeyRef.current);
        if (!r.ok) {
          failRef.current++;
          if (failRef.current >= 3) {
            setStatus(`轮询失败：${r.error}，请刷新二维码`);
            stopPoll();
          } else {
            setStatus(`连接波动，自动重试（${failRef.current}/3）`);
          }
          return;
        }
        failRef.current = 0;
        if (r.data.ok) {
          stopPoll();
          setStatus(r.data.message);
          onSuccess();
        } else {
          setStatus(r.data.message);
        }
      } catch {
        /* ignore */
      } finally {
        inflightRef.current = false;
      }
    }, 2000);
  }, [onSuccess, stopPoll]);

  useEffect(() => stopPoll, [stopPoll]);

  return (
    <div className="rp-flow">
      {qr ? <img className="rp-qr" src={qr} alt="汽水登录二维码" /> : <div className="rp-qr is-empty" />}
      <div className="rp-flow-status">{status || '未登录汽水音乐'}</div>
      <button type="button" className="btn primary full" onClick={start}>
        {qr ? '刷新二维码' : '开始扫码登录'}
      </button>
    </div>
  );
}

/** 酷我音乐：打开官网登录窗口（账号密码 / 短信 / QQ / 微信）。 */
function KuwoLogin({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const openWindow = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setBusy(true);
    setStatus('正在打开酷我登录页…');
    try {
      const r = await window.nebulaAPI.kuwoLoginWindow();
      const data = r.ok ? r.data : null;
      if (data?.ok) {
        setStatus(data.message ?? '登录成功');
        onSuccess();
      } else {
        setStatus(data?.error ?? '登录窗口已关闭');
      }
    } finally {
      setBusy(false);
    }
  }, [onSuccess]);

  return (
    <div className="rp-flow">
      <button type="button" className="btn primary full" disabled={busy} onClick={openWindow}>
        {busy ? '等待登录…' : '打开酷我登录页'}
      </button>
      <div className="rp-flow-status">{status || '未登录酷我音乐'}</div>
    </div>
  );
}

function PlatformLogin({
  platform,
  info,
  onRefresh,
  lapsed = false,
}: {
  platform: string;
  info: DesktopLoginPlatform;
  onRefresh: (platform: string) => void;
  /** 登录已过期（#157）：上面已有说明，空闲时不再写「未登录」 */
  lapsed?: boolean;
}) {
  if (info.kind === 'unavailable') {
    return (
      <div className="rp-flow">
        <div className="rp-flow-status">{info.unavailableReason ?? '暂不支持'}</div>
      </div>
    );
  }
  if (platform === 'netease') return <NeteaseLogin onSuccess={() => onRefresh('netease')} />;
  if (platform === 'qq') return <QqLogin lapsed={lapsed} onSuccess={() => onRefresh('qq')} />;
  if (platform === 'kugou') return <KugouLogin onSuccess={() => onRefresh('kugou')} />;
  if (platform === 'qishui') return <QishuiLogin onSuccess={() => onRefresh('qishui')} />;
  if (platform === 'kuwo') return <KuwoLogin onSuccess={() => onRefresh('kuwo')} />;
  if (platform === 'bodian') return <BodianLogin onSuccess={() => onRefresh('bodian')} />;
  if (platform === 'spotify') return <SpotifyLogin onSuccess={() => onRefresh('spotify')} />;
  if (platform === 'ytmusic') return <YtmusicLogin onSuccess={() => onRefresh('ytmusic')} />;
  return (
    <div className="rp-flow">
      <div className="rp-flow-status">暂不支持该平台登录</div>
    </div>
  );
}

/** 账号详情：已登录 = 账号信息 + 刷新 / 退出；未登录 = 该平台既有的登录流程。 */
function AccountDetail({
  platform,
  info,
  account,
  onRefresh,
}: {
  platform: string;
  info: DesktopLoginPlatform | undefined;
  account: AccountState | undefined;
  onRefresh: (platform: string) => void;
}) {
  const meta = platformMeta(platform);
  if (account?.loggedIn) {
    const nick = account.nickname ?? '已登录';
    return (
      <div className="rp-detail">
        <span className="rp-acct-av">
          {account.avatarUrl ? <img src={account.avatarUrl} alt="" draggable={false} /> : nick.slice(0, 1)}
        </span>
        <h3>{nick}</h3>
        <div className="rp-acct-meta">
          {meta.name} · {vipText(account)} · 歌单 {account.playlists.length} 个
        </div>
        <div className="group">
          <RefreshRow loading={account.loading} onRefresh={() => onRefresh(platform)} />
        </div>
        <button
          type="button"
          className="btn danger"
          onClick={() => window.nebulaAPI?.clearCookie(platform).then(() => onRefresh(platform))}
        >
          退出登录
        </button>
      </div>
    );
  }
  return (
    <div className="rp-detail">
      <span className="rp-big-logo">
        {meta.logo ? <img src={meta.logo} alt="" draggable={false} /> : meta.name.slice(0, 1)}
      </span>
      <h3>{meta.name}</h3>
      {account?.auth && (
        <p className="rp-lapsed" role="status">
          {account.auth === 'expired' ? '登录已过期' : '登录信息不完整'}，重新登录后歌单和会员歌就会回来
        </p>
      )}
      <p className="rp-how">{LOGIN_HOW[platform] ?? '登录后可以导入这个平台的歌单'}</p>
      {info ? <PlatformLogin platform={platform} info={info} onRefresh={onRefresh} lapsed={!!account?.auth} /> : null}
    </div>
  );
}

/* ---------- 设置：歌词实时预览 ---------- */

const PREVIEW_LINE = '风经过的地方，都亮了';
const PREVIEW_NEXT = '路灯一盏一盏替我数着心跳';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const usableLine = (l?: LyricLineUI) => !!l && (!!l.text?.trim() || !!l.words?.length);

/**
 * 预览该唱哪一句：正在唱的那句（live）；前奏 / 还没开始时先拿第一句做示范（不跟时间）。
 * 没有歌词（没在放歌 / 纯音乐 / 没拿到歌词）返回 -1，用示例句。
 */
function pickPreviewLine(lines: LyricLineUI[], tMs: number): { idx: number; live: boolean } {
  const i = currentLyricIndex(lines, tMs);
  for (let k = i; k >= 0; k--) if (usableLine(lines[k])) return { idx: k, live: true };
  for (let k = 0; k < lines.length; k++) if (usableLine(lines[k])) return { idx: k, live: false };
  return { idx: -1, live: false };
}

function nextUsable(lines: LyricLineUI[], from: number): LyricLineUI | undefined {
  for (let k = from + 1; k < lines.length; k++) if (usableLine(lines[k])) return lines[k];
  return undefined;
}

/** 示例句（原创）：逐字时间按慢歌合成，「亮」是 1.4 秒的长音，演示放大和白光。 */
const SAMPLE_LINE: EngineLine = (() => {
  const chars = [...PREVIEW_LINE];
  let t = 0;
  const units: EngineLine['units'] = [];
  chars.forEach((ch, i) => {
    if (/[，。]/.test(ch) && units.length) {
      units[units.length - 1]!.t += ch;
      return;
    }
    const d = ch === '亮' ? 1.4 : 0.3 + ((i * 37) % 90) / 1000;
    units.push({ t: ch, s: t, e: t + d, cjk: true, sp: false, emph: d >= 1 });
    t += d;
  });
  return { kind: 'line', s: 0, e: t, text: PREVIEW_LINE, units, dens: 0 };
})();

/**
 * 星云上的歌词的实时预览（#124）：当前封面的环境光 + 正在唱的那一句，用和画面里同一套逐字效果
 * （lib/listen/words.ts：扫光、波浪、长音放大与白光、尾韵），着色与字体跟随「听音空间」的设置，
 * 字号 / 加粗 / 当前句放大 / 自定义颜色跟随这里的设置。
 *   - 播放中：跟着真实播放进度；暂停 / 前奏：在这一句上循环示范；没有歌词：用一句示例歌词。
 * 句子比预览窗宽时，跟着唱到的位置横向平移、两端淡出（保持真实字号，不缩小）。
 * active=false（面板收起 / 不在歌词页）时停掉 rAF；减少动效时只画一帧静止的半唱状态。
 */
function LyricPreview({
  settings,
  maxFont,
  active,
  lines,
}: {
  settings: LyricVisualSettings;
  maxFont: number;
  active: boolean;
  lines: LyricLineUI[];
}) {
  const listen = useListenSpaceSettings();
  const curRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const [pick, setPick] = useState(() => pickPreviewLine(lines, audioPlayer.getState().currentTime * 1000));
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const line: EngineLine = useMemo(() => {
    // 切歌先清空/替换歌词，pick 要到 effect 才更新；旧下标不保证仍存在。
    const current = lines[pick.idx];
    if (!current) return SAMPLE_LINE;
    const nx = nextUsable(lines, pick.idx);
    return toEngineLine(current, nx ? nx.timeMs / 1000 : undefined);
  }, [lines, pick.idx]);
  const lineDataRef = useRef(line);
  lineDataRef.current = line;
  const nextText = pick.idx >= 0 ? (nextUsable(lines, pick.idx)?.text ?? '') : PREVIEW_NEXT;
  const script = useMemo(() => (lines.length ? detectScript(lines) : 'zh'), [lines]);
  const typo = TYPO[listen.font][script];
  const schemeRef = useRef(listen.scheme);
  schemeRef.current = listen.scheme;

  // 预览窗只有 104px 高：把软件里的字号（14…maxFont）按比例缩到 13–30px，再乘当前句放大
  const ratio = clamp((settings.fontSize - 14) / Math.max(1, maxFont - 14), 0, 1);
  const fs = 13 + ratio * 17;
  const k = settings.currentScale / 1.22;
  const kRef = useRef(k);
  kRef.current = k;

  // 这一句的字（逐字 `.u` 或整句）；换句 / 换字体时重建
  const domRef = useRef<{ rts: UnitRt[] | null; whole: HTMLElement | null; measured: boolean }>({
    rts: null,
    whole: null,
    measured: false,
  });
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.textContent = '';
    if (line.units) {
      domRef.current = { rts: renderUnits(host, line.units), whole: null, measured: false };
    } else {
      const w = document.createElement('span');
      w.className = 'fl-whole';
      w.textContent = line.text;
      host.appendChild(w);
      domRef.current = { rts: null, whole: w, measured: true };
    }
  }, [line, listen.font, fs, settings.bold]);

  // 换歌：立刻按当前进度重新挑一句
  useEffect(() => {
    setPick(pickPreviewLine(lines, audioPlayer.getState().currentTime * 1000));
  }, [lines]);

  useEffect(() => {
    if (!active) return;
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let raf = 0;
    let sx = 0;
    let lastLine: HTMLDivElement | null = null;

    const tick = (now: number) => {
      const st = audioPlayer.getState();
      const posMs = audioPlayer.position() * 1000;
      const want = lines.length ? pickPreviewLine(lines, posMs) : { idx: -1, live: false };
      if (want.idx !== pickRef.current.idx || want.live !== pickRef.current.live) {
        pickRef.current = want;
        setPick(want);
      }

      const lineEl = lineRef.current;
      const cur = curRef.current;
      const d = domRef.current;
      const e = lineDataRef.current;
      if (lineEl && cur) {
        const live = st.playing && pickRef.current.live && pickRef.current.idx >= 0;
        // 示范：在这一句上循环（唱完停 1.2 秒再来）
        const span = Math.max(0.5, e.e - e.s);
        const t = live ? posMs / 1000 : reduce ? e.s + span * 0.5 : e.s + (((now - t0) / 1000) % (span + 1.2));
        if (d.rts && !d.measured) {
          measureUnits(d.rts);
          d.measured = !!d.rts[0] && d.rts[0].w > 0;
        }
        // 先读布局，再写样式
        const W = cur.clientWidth;
        const visW = lineEl.offsetWidth * kRef.current;
        const over = visW > W - 24;
        let target = 0;
        if (over && d.rts && d.rts.length) {
          let x = 0;
          for (const rt of d.rts) if (t >= rt.u.s) x = rt.left + rt.w * clamp((t - rt.u.s) / Math.max(0.001, rt.u.e - rt.u.s), 0, 1);
          const lim = visW / 2 - W / 2 + 14;
          target = clamp(visW / 2 - x * kRef.current, -lim, lim);
        }
        sx = lineEl !== lastLine ? target : sx + (target - sx) * 0.2;
        lastLine = lineEl;

        if (d.rts && d.rts.length) {
          const wave = waveOf(d.rts, e.dens, t);
          for (const rt of d.rts) unitFrame(rt, t, schemeRef.current, true, wave, e.dens);
        } else if (d.whole) {
          d.whole.classList.toggle('is-on', t >= e.s);
          d.whole.style.setProperty('--lift', wholeLift(e.s, e.e, e.dens, t).toFixed(4));
        }
        lineEl.style.setProperty('--sx', `${sx.toFixed(1)}px`);
        cur.classList.toggle('is-over', over);
      }
      if (!reduce) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, lines]);

  return (
    <div
      className="rp-preview lw"
      data-scheme={listen.scheme}
      style={
        {
          // 与画面里的歌词层同一个主色：自定义时用所选颜色，跟随封面时用环境写入的 --ly-a
          '--lc-a': settings.lyricColorSource === 'custom' ? settings.customColor : 'var(--ly-a, rgb(238 240 244))',
          '--lc-font': typo.f,
        } as unknown as React.CSSProperties
      }
    >
      <div className="rp-pb" />
      <div className="rp-pv" />
      <div key={`n${pick.idx}`} className="rp-next">
        {nextText}
      </div>
      <div
        ref={curRef}
        className="rp-cur"
        style={
          {
            fontSize: `${fs.toFixed(1)}px`,
            fontWeight: settings.bold ? 700 : typo.w,
            '--k': k.toFixed(3),
          } as React.CSSProperties
        }
      >
        <div key={`c${pick.idx}`} ref={lineRef} className="rp-line">
          <span ref={hostRef} className="is-grad" />
        </div>
      </div>
      <span className="rp-tag">{pick.idx >= 0 ? '实时预览 · 当前歌曲' : '实时预览'}</span>
    </div>
  );
}

/* ---------- 设置：背景 / 材质 预览块 ---------- */

type BgChoice = 'env' | 'fog' | 'custom' | 'wallpaper';

/** 星云怎么排（#134）：三种排法同一套视觉，只是聚类方式不同。默认按颜色（#137）。 */
const LAYOUT_HINT: Record<StageLayout, string> = {
  chroma: '按封面颜色铺开：往左右拖，颜色沿彩虹走；往上下拖，由暗到鲜艳。新歌单第一次要给封面取色，取完会重排一次。',
  cluster: '同一位歌手的歌聚成一团，星团散在各处，旁边淡淡写着歌手名；只有一首歌的歌手按封面颜色排在空隙里。',
  random: '不按歌手也不按颜色。每次打开都重新撒一遍，这次用完之前位置不变。',
};

const BG_DESC: Record<BgChoice, string> = {
  env: '颜色取自封面，换歌时整个空间一起换色',
  fog: '在封面色调里隐约浮着一层放大、模糊的封面',
  custom: '用自己的图片或视频铺满背景',
  wallpaper: '从 Wallpaper Engine 的壁纸库里选一张',
};

function Tile({
  name,
  selected,
  onClick,
  data,
  children,
}: {
  name: ReactNode;
  selected: boolean;
  onClick: () => void;
  data: Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  return (
    <button type="button" className="rp-tile" aria-pressed={selected} onClick={onClick} {...data}>
      <span className="rp-art">
        {children}
        <span className="rp-check">
          <IconCheck size={12} />
        </span>
      </span>
      <span className="rp-name">{name}</span>
    </button>
  );
}

/* ---------- 设置：预览（样张 L 方案 A，#128） ---------- */

type PvMode = 'stage' | 'listen';
const PV_NAME: Record<PvMode, string> = { stage: '星云上', listen: '听音空间' };

/**
 * 歌词页顶部的一张预览：上方一行「星云上 · 听音空间」手动切换（用户定：不随改动的设置自动切），
 * 选中的下面一条 2px 细线滑过去（果冻缓动）。两种预览同高，切换时不顶动下面的设置。
 */
function SettingsPreview({
  settings,
  maxFont,
  active,
  lines,
  lsSettings,
}: {
  settings: LyricVisualSettings;
  maxFont: number;
  active: boolean;
  lines: LyricLineUI[];
  lsSettings: ReturnType<typeof useListenSpaceSettings>;
}) {
  const [mode, setMode] = useState<PvMode>('stage');
  const headRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = headRef.current;
    if (!h) return;
    const place = () => {
      const on = h.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!on || !on.offsetWidth) return;
      h.style.setProperty('--ux', `${on.offsetLeft}px`);
      h.style.setProperty('--uw', `${on.offsetWidth}px`);
      h.classList.add('is-placed');
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(h);
    return () => ro.disconnect();
  }, [mode]);
  return (
    <>
      <div ref={headRef} className="pv-head" role="group" aria-label="预览哪里">
        {(['stage', 'listen'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {PV_NAME[m]}
          </button>
        ))}
        <span className="pv-ul" aria-hidden="true" />
        <span className="pv-live">实时预览</span>
      </div>
      <div key={mode} className="pv-box" data-mode={mode}>
        {mode === 'stage' ? (
          <LyricPreview settings={settings} maxFont={maxFont} active={active} lines={lines} />
        ) : (
          <ListenPreview lines={lines} settings={lsSettings} />
        )}
      </div>
    </>
  );
}

/* ---------- 设置：自定义颜色的取色区（样张 L 第 2 版，#128） ---------- */

/** 常用色：都够亮，压在深色星云上当歌词主色读得清。 */
const COMMON_COLORS = ['#3aa0ff', '#4cc9e8', '#5ad1a4', '#a6e06b', '#f5d36b', '#ff9a5c', '#ff6b7f', '#f2f4f8'];

const toHex = (c: [number, number, number]) =>
  `#${c.map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** 「浓淡」0 → 1：淡（饱和 40%、亮 80%）到浓（饱和 92%、亮 58%）。两根滑杆只用色相和浓淡，不出现数值。 */
const toneColor = (hue: number, tone: number) => toHex(hslToRgb(hue / 360, 0.4 + 0.52 * tone, 0.8 - 0.22 * tone));
const hueToneOf = (hex: string) => {
  const [h, s] = rgbToHsl(...fromHex(hex));
  return { hue: Math.round(h * 360), tone: clamp((s - 0.4) / 0.52, 0, 1) };
};
/** 封面里取出的颜色：调到能当歌词主色的亮度，去掉太接近的。 */
function coverPicks(sample: Awaited<ReturnType<typeof sampleCover>>): string[] {
  if (!sample) return [];
  const raw = [sample.accent, sample.best, sample.warm, sample.cool, sample.light, sample.area, sample.avg, sample.dark];
  const out: Array<[number, number, number]> = [];
  for (const c of raw) {
    const [h, s0, l0] = rgbToHsl(...c);
    const s = sample.mono ? Math.min(s0, 0.18) : Math.max(s0, 0.38);
    const l = clamp(l0, 0.6, 0.84);
    if (out.some(([h2, s2, l2]) => Math.min(Math.abs(h - h2), 1 - Math.abs(h - h2)) < 0.04 && Math.abs(l - l2) < 0.08 && Math.abs(s - s2) < 0.2)) continue;
    out.push([h, s, l]);
  }
  return out.slice(0, 8).map(([h, s, l]) => toHex(hslToRgb(h, s, l)));
}

function ColorPick({ value, coverUrl, open, onChange }: { value: string; coverUrl: string; open: boolean; onChange: (hex: string) => void }) {
  const [cover, setCover] = useState<string[]>([]);
  useEffect(() => {
    if (!open || !coverUrl) return;
    let dead = false;
    sampleCover(coverUrl)
      .then((smp) => {
        if (!dead) setCover(coverPicks(smp));
      })
      .catch(() => {
        if (!dead) setCover([]);
      });
    return () => {
      dead = true;
    };
  }, [open, coverUrl]);
  // 滑杆位置跟着当前颜色走；拖滑杆时记住色相（灰色没有色相，不能每次从颜色反推）
  const [ht, setHt] = useState(() => hueToneOf(value));
  const lastOut = useRef(value);
  useEffect(() => {
    if (value.toLowerCase() !== lastOut.current.toLowerCase()) setHt(hueToneOf(value));
  }, [value]);
  const emit = (hex: string) => {
    lastOut.current = hex;
    onChange(hex);
  };
  const cur = value.toLowerCase();
  const dot = (c: string) => (
    <button
      key={c}
      type="button"
      className="pk-dot"
      style={{ '--c': c } as React.CSSProperties}
      aria-label={`颜色 ${c}`}
      aria-pressed={cur === c.toLowerCase()}
      onClick={() => {
        setHt(hueToneOf(c));
        emit(c);
      }}
    >
      <IconCheck size={12} />
    </button>
  );
  return (
    <div className={`pick-body${open ? ' open' : ''}`} aria-hidden={!open}>
      <div>
        <div className="pick" style={{ '--hue': ht.hue, '--sw': value } as React.CSSProperties}>
          {cover.length > 0 && (
            <>
              <span className="pk-lbl">封面里的颜色</span>
              <div className="pk-row">{cover.map(dot)}</div>
            </>
          )}
          <span className="pk-lbl">常用</span>
          <div className="pk-row">{COMMON_COLORS.map(dot)}</div>
          <div className="pk-fine">
            <span className="pk-lbl">色相</span>
            <input
              className="rng hue"
              type="range"
              min={0}
              max={360}
              step={1}
              value={ht.hue}
              aria-label="色相"
              tabIndex={open ? 0 : -1}
              onChange={(e) => {
                const hue = Number(e.target.value);
                setHt((o) => ({ ...o, hue }));
                emit(toneColor(hue, ht.tone));
              }}
            />
            <span className="pk-lbl">浓淡</span>
            <input
              className="rng tone"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={ht.tone}
              aria-label="浓淡"
              tabIndex={open ? 0 : -1}
              onChange={(e) => {
                const tone = Number(e.target.value);
                setHt((o) => ({ ...o, tone }));
                emit(toneColor(ht.hue, tone));
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 设置：让开方式的小场景（样张 L，#128） ---------- */

function MiniScene() {
  return (
    <span className="mini" aria-hidden="true">
      <span className="cards">
        <i className="c" />
        <i className="c" />
        <i className="c" />
        <i className="c" />
        <i className="c" />
        <i className="c" />
      </span>
      <span className="ly" />
    </span>
  );
}

/** Wallpaper Engine 方案卡：选了壁纸显示那张的预览图（壁纸库的 preview，取不到退回媒体本身），没选显示官方标志图。 */
function WallpaperArt({ url, isImage }: { url: string | null; isImage: boolean }) {
  const preview = url ? url.replace('wallpaper://media/', 'wallpaper://preview/') : '';
  const [src, setSrc] = useState(preview);
  useEffect(() => setSrc(preview), [preview]);
  if (!url || !src) return <span className="we-og" style={{ backgroundImage: `url(${JSON.stringify(weLogo)})` }} />;
  return (
    <>
      <img
        className="rp-thumb"
        src={src}
        alt=""
        draggable={false}
        onError={() => setSrc(isImage && src !== url ? url : '')}
      />
      <span className="rp-badge">当前壁纸</span>
    </>
  );
}

/**
 * 同一页里、段数相同的分段控件取同一段宽（按最宽的那段），左右边缘对齐（样张 L 第 3 版，用户反馈）。
 * 原来只靠每段至少 56px，新叫法变长后对不齐。每次渲染后量一次（只量当前这一页）。
 */
function useSegAlign(ref: React.RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const byN = new Map<number, HTMLElement[]>();
    root.querySelectorAll<HTMLElement>('.group .seg').forEach((sg) => {
      const n = sg.querySelectorAll(':scope > button').length;
      byN.set(n, [...(byN.get(n) ?? []), sg]);
    });
    byN.forEach((list) => {
      list.forEach((sg) => (sg.style.gridAutoColumns = ''));
      let w = 56;
      list.forEach((sg) => sg.querySelectorAll<HTMLElement>(':scope > button').forEach((b) => (w = Math.max(w, Math.ceil(b.scrollWidth)))));
      list.forEach((sg) => (sg.style.gridAutoColumns = `${w}px`));
    });
  });
}

/**
 * 右侧 Dock（账号 / 设置）内容（样张 E，2026-11-12 定稿）。
 * 外壳与开合机制在 dock/SideDock.tsx；通用件样式在 dock/panel-kit.css，右侧专用样式在 dock/right-panel.css。
 */
export const AccountDock = memo(function AccountDock({
  visible,
  platforms,
  accounts,
  selectedPlatform,
  loginNonce,
  accountListNonce = 0,
  bgSetting,
  coverMode,
  lyricSettings,
  uiHideCards,
  uiHideLyrics,
  onEnter,
  onLeave,
  onSelectPlatform,
  onRefreshAccount,
  onSelectBg,
  onFile,
  onCoverMode,
  onOpenWallpapers,
  onFontSize,
  onLayerMode,
  onCurrentScale,
  onLyricLayout,
  onLyricColorSource,
  onCustomColor,
  onLyricBold,
  onListenSettings,
  onToggleHideCards,
  onToggleHideLyrics,
  glassTheme,
  onGlassTheme,
  perfPriority,
  onPerfPriority,
  perfAutoLevel,
  near,
  coverUrl,
  lyricLines,
  onPinChange,
}: AccountDockProps) {
  const [openRow, setOpenRow] = useState<'login' | 'settings' | null>(null);
  const [settingsPage, setSettingsPage] = useState<DockSettingsPage>('lyrics');
  const [pickOpen, setPickOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  useSegAlign(pageRef);
  // 背景方案完全由实际生效的 bgSetting 推出（不再单独存状态）：
  // 点「自定义」后取消选图、壁纸库里取消、刷新后恢复，高亮都不会和真实背景脱节。
  // 壁纸库的媒体走 wallpaper:// 协议；自己选的图片 / 视频是 data: 或 blob: URL。
  const bgScheme: 'custom' | 'wallpaper' | 'cover' =
    bgSetting.type === 'cover'
      ? 'cover'
      : bgSetting.type !== 'preset' && bgSetting.url.startsWith('wallpaper:')
        ? 'wallpaper'
        : 'custom';
  const bgInputRef = useRef<HTMLInputElement>(null);

  // 账号面板的「列表 ↔ 详情」推入：detailPf = 详情里的平台（退出动画结束后才清掉），detailIn = 详情已滑入
  const [detailPf, setDetailPf] = useState<string | null>(null);
  const [detailIn, setDetailIn] = useState(false);
  const navTimers = useRef<{ raf: number[]; hide: number | null }>({ raf: [], hide: null });

  const clearNavTimers = useCallback(() => {
    navTimers.current.raf.forEach((id) => cancelAnimationFrame(id));
    navTimers.current.raf = [];
    if (navTimers.current.hide !== null) {
      window.clearTimeout(navTimers.current.hide);
      navTimers.current.hide = null;
    }
  }, []);

  const openDetail = useCallback(
    (p: string) => {
      clearNavTimers();
      setDetailPf(p);
      if (detailIn) return; // 已在详情里：只换内容
      const r1 = requestAnimationFrame(() => {
        const r2 = requestAnimationFrame(() => setDetailIn(true));
        navTimers.current.raf.push(r2);
      });
      navTimers.current.raf = [r1];
    },
    [clearNavTimers, detailIn],
  );

  const closeDetail = useCallback(() => {
    clearNavTimers();
    setDetailIn(false);
    navTimers.current.hide = window.setTimeout(() => {
      navTimers.current.hide = null;
      setDetailPf(null);
    }, 300);
  }, [clearNavTimers]);

  useEffect(() => clearNavTimers, [clearNavTimers]);

  // 听音空间的歌词设置（§9.9）：与星云歌词的设置分开存
  const lsSettings = useListenSpaceSettings();
  const stageLab = useSpaceLab();
  const loggedCount = DOCK_PLATFORM_ORDER.filter((p) => accounts[p]?.loggedIn).length;
  const avatarUrl =
    DOCK_PLATFORM_ORDER.map((p) => accounts[p]).find((a) => a?.loggedIn && a.avatarUrl)?.avatarUrl ?? null;

  // 外部「去登录」：打开账号面板并推入对应平台的详情
  const handledNonce = useRef(0);
  useEffect(() => {
    if (!loginNonce || loginNonce === handledNonce.current) return;
    handledNonce.current = loginNonce;
    setOpenRow('login');
    openDetail(selectedPlatform);
  }, [loginNonce, selectedPlatform, openDetail]);

  // 外部「打开账号列表」：打开账号面板，若停在某个平台详情里就退回列表
  const handledListNonce = useRef(0);
  useEffect(() => {
    if (!accountListNonce || accountListNonce === handledListNonce.current) return;
    handledListNonce.current = accountListNonce;
    setOpenRow('login');
    if (detailIn) closeDetail();
  }, [accountListNonce, detailIn, closeDetail]);

  // 面板关闭动画期间保留上一次的内容，避免淡出时窗口先变空
  const lastRowRef = useRef<'login' | 'settings'>('settings');
  if (openRow) lastRowRef.current = openRow;
  const shownRow = openRow ?? lastRowRef.current;

  const maxFont = Math.max(28, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 4));

  /* ---------- 账号 ---------- */
  const loginWindow = (
    <div className="nav">
      <div className={`view${detailIn ? ' hidden-left' : ''}`} aria-hidden={detailIn}>
        <div className="win-head">
          <h2>账号</h2>
          <span className="sub">
            已连接 {loggedCount} / {DOCK_PLATFORM_ORDER.length}
          </span>
        </div>
        <div className="group">
          {DOCK_PLATFORM_ORDER.map((p) => {
            const meta = platformMeta(p);
            const acc = accounts[p];
            const on = !!acc?.loggedIn;
            const lapsed = lapseText(acc);
            const reason = platforms.find((x) => x.platform === p)?.unavailableReason ?? null;
            const nick = acc?.nickname ?? '已登录';
            return (
              <RowButton
                key={p}
                onClick={() => {
                  onSelectPlatform(p);
                  openDetail(p);
                }}
              >
                <span className="rp-logo">
                  {meta.logo ? <img src={meta.logo} alt="" draggable={false} /> : meta.name.slice(0, 1)}
                </span>
                <span className="lbl">
                  {meta.name}
                  <small className="rp-status">
                    <i className={`rp-dot${on ? ' on' : lapsed ? ' is-warn' : ''}`} />
                    {on ? `${nick} · ${vipText(acc)}` : (lapsed ?? reason ?? '未登录')}
                  </small>
                </span>
                {on && (
                  <span className="rp-av">
                    {acc?.avatarUrl ? <img src={acc.avatarUrl} alt="" draggable={false} /> : nick.slice(0, 1)}
                  </span>
                )}
                <span className="chev">
              <IconChevronRight size={14} />
            </span>
              </RowButton>
            );
          })}
        </div>
        <p className="hint-line">登录后，歌单会出现在左侧「歌单」里</p>
      </div>
      {detailPf !== null && (
        <div className={`view${detailIn ? '' : ' hidden-right'}`} aria-hidden={!detailIn}>
          <button type="button" className="back" onClick={closeDetail}>
            <IconChevronLeft size={16} />
            账号
          </button>
          <AccountDetail
            platform={detailPf}
            info={platforms.find((x) => x.platform === detailPf)}
            account={accounts[detailPf]}
            onRefresh={onRefreshAccount}
          />
        </div>
      )}
    </div>
  );

  /* ---------- 设置 ---------- */
  const bgChoice: BgChoice =
    bgScheme === 'cover' ? (coverMode === 'blend' ? 'fog' : 'env') : bgScheme === 'custom' ? 'custom' : 'wallpaper';
  const selectCover = (mode: CoverBgMode) => {
    onSelectBg({ type: 'cover' });
    onCoverMode(mode);
  };

  const customMedia = bgScheme === 'custom' && bgSetting.type !== 'preset' && bgSetting.type !== 'cover' ? bgSetting : null;
  const wallUrl = bgScheme === 'wallpaper' && bgSetting.type !== 'preset' && bgSetting.type !== 'cover' ? bgSetting.url : null;
  const chevDown = (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );

  /* 样张 L（#126–#128）：按「改了影响哪里」分组——两处通用 / 星云上 / 听音空间；
     「静止时」整组搬到「聆听」页；不常改的收进「更多排版」 */
  const lyricsPage = (
    <>
      <SettingsPreview
        settings={lyricSettings}
        maxFont={maxFont}
        active={openRow === 'settings' && settingsPage === 'lyrics'}
        lines={lyricLines}
        lsSettings={lsSettings}
      />
      <div className="g-title">两处通用</div>
      <div className="group">
        <div className="row">
          <span className="lbl">字体</span>
          <Seg
            label="歌词字体"
            value={lsSettings.font}
            options={[
              { value: 'serif', label: 'Aa 衬线' },
              { value: 'sans', label: 'Aa 无衬线' },
            ]}
            onChange={(v) => setListenSpaceSettings({ font: v })}
          />
        </div>
        <div className="row">
          <span className="lbl">唱过的字</span>
          <Seg
            label="唱过的字"
            value={lsSettings.scheme}
            options={[
              { value: 'accent', label: '染上颜色' },
              { value: 'mono', label: '变成白色' },
            ]}
            onChange={(v) => setListenSpaceSettings({ scheme: v })}
          />
        </div>
        <span className="row-hint">
          {lsSettings.scheme === 'accent' ? '唱过的字染上颜色，没唱的是白色。' : '没唱的字带一点颜色，唱过的变成白色。'}
        </span>
      </div>
      <div className="g-title">星云上</div>
      <div className="group">
        <Slider
          label="字号"
          value={lyricSettings.fontSize}
          min={14}
          max={maxFont}
          step={1}
          format={(v) => `${v}px`}
          onChange={onFontSize}
        />
        <Slider
          label="正在唱的一句放大"
          value={lyricSettings.currentScale}
          min={1}
          max={1.6}
          step={0.02}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={onCurrentScale}
        />
        <div className="row">
          <span className="lbl">加粗</span>
          <Tg checked={!!lyricSettings.bold} onChange={onLyricBold} label="歌词加粗" />
        </div>
        <div className="row">
          <span className="lbl">颜色</span>
          <div className={`color-ctl${lyricSettings.lyricColorSource === 'custom' ? '' : ' is-cover'}`}>
            <button
              type="button"
              className="rp-swatch"
              style={{ '--sw': lyricSettings.customColor } as React.CSSProperties}
              aria-label="自定义颜色"
              aria-expanded={pickOpen}
              tabIndex={lyricSettings.lyricColorSource === 'custom' ? 0 : -1}
              onClick={() => setPickOpen((o) => !o)}
            />
            <Seg
              label="歌词颜色"
              value={lyricSettings.lyricColorSource}
              options={[
                { value: 'cover', label: '跟随封面' },
                { value: 'custom', label: '自定义' },
              ]}
              onChange={(v) => {
                onLyricColorSource(v);
                // 选「自定义」顺手展开取色区，切回「跟随封面」收起
                setPickOpen(v === 'custom');
              }}
            />
          </div>
        </div>
        <ColorPick
          value={lyricSettings.customColor}
          coverUrl={coverUrl}
          open={pickOpen && lyricSettings.lyricColorSource === 'custom'}
          onChange={onCustomColor}
        />
        <RowButton className="more-btn" onClick={() => setMoreOpen((o) => !o)}>
          <span className="lbl">
            更多排版<small>三句怎么排、歌词和卡片谁在上面</small>
          </span>
          <span className={`more-chev${moreOpen ? ' is-open' : ''}`}>{chevDown}</span>
        </RowButton>
        <div className={`more-body${moreOpen ? ' open' : ''}`} aria-hidden={!moreOpen}>
          <div>
            <div className="row">
              <span className="lbl">三句怎么排</span>
              <Seg
                label="三句怎么排"
                value={lyricSettings.lyricLayout}
                options={[
                  { value: 'stacked', label: '依次叠放' },
                  { value: 'offset', label: '上下交错' },
                ]}
                onChange={onLyricLayout}
              />
            </div>
            <div className="row">
              <span className="lbl">
                歌词浮在卡片上面<small>关掉时歌词从卡片后面穿过</small>
              </span>
              <Tg
                checked={lyricSettings.layerMode === 'over'}
                onChange={(b) => onLayerMode(b ? 'over' : 'under')}
                label="歌词浮在卡片上面"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="g-title">听音空间</div>
      <div className="group">
        <div className="row">
          <span className="lbl">
            翻译<small>外文歌词下面显示中文；在听音空间里也能随时开关</small>
          </span>
          <Tg checked={lsSettings.translation} onChange={(b) => setListenSpaceSettings({ translation: b })} label="听音空间显示翻译" />
        </div>
        <div className="row">
          <span className="lbl">
            读音<small>日语、韩语歌标出读音；在听音空间里也能随时开关</small>
          </span>
          <Tg checked={lsSettings.roman} onChange={(b) => setListenSpaceSettings({ roman: b })} label="听音空间显示读音" />
        </div>
        <div className="row">
          <span className="lbl">
            日语罗马音<small>原文下面一行</small>
          </span>
          <Tg
            checked={lsSettings.jaRoman}
            onChange={(b) => setListenSpaceSettings({ jaRoman: b })}
            label="日语歌显示罗马音"
          />
        </div>
        <div className="row">
          <span className="lbl">
            日语汉字注音<small>汉字上方标平假名</small>
          </span>
          <Tg checked={lsSettings.jaKana} onChange={(b) => setListenSpaceSettings({ jaKana: b })} label="日语歌显示汉字注音" />
        </div>
        <span className="row-hint">两种可以一起开，至少留一种；韩语歌始终显示罗马音。听音空间里悬停或右键读音按钮也能改。</span>
      </div>
    </>
  );

  /* 聆听页（样张 L）：原「静止时」整组。总开关关掉时下面变暗、不能点，不再整块消失 */
  const listenPage = (
    <>
      <div className="group intro">
        <div className="row">
          <span className="lbl big">聆听模式</span>
          <Tg checked={lyricSettings.listenHandoff} onChange={(b) => onListenSettings({ listenHandoff: b })} label="聆听模式" />
        </div>
        <p>
          音乐播放时，<em>鼠标停住几秒</em>，星云就退到后面，让歌词成为主角；一动鼠标立刻回来。侧栏和设置开着也一样。
        </p>
      </div>
      <div className={`dimmable${lyricSettings.listenHandoff ? '' : ' is-off'}`} aria-disabled={!lyricSettings.listenHandoff}>
        <div className="g-title">星云怎么让开</div>
        <div className="rp-tiles tiles-3">
          {(
            [
              ['sink', '沉降', '暗下去'],
              ['part', '散开', '让出中间'],
              ['ebb', '退潮', '淡成薄雾'],
            ] as const
          ).map(([v, n, d]) => (
            <Tile
              key={v}
              name={
                <>
                  {n}
                  <small>{d}</small>
                </>
              }
              selected={lyricSettings.listenStyle === v}
              data={{ 'data-v': v, 'data-listen-tile': v }}
              onClick={() => onListenSettings({ listenStyle: v })}
            >
              <span className="rp-envbg" />
              <MiniScene />
            </Tile>
          ))}
        </div>
        <div className="g-title">细节</div>
        <div className="group">
          <div className="row">
            <span className="lbl">鼠标停多久</span>
            <Seg
              label="鼠标停多久"
              value={String(lyricSettings.listenDelay)}
              options={[
                { value: '3', label: '3 秒' },
                { value: '6', label: '6 秒' },
                { value: '10', label: '10 秒' },
              ]}
              onChange={(v) => onListenSettings({ listenDelay: Number(v) })}
            />
          </div>
          <div className="row">
            <span className="lbl">平时的歌词</span>
            <Seg
              label="平时的歌词"
              value={lyricSettings.roamLyrics}
              options={[
                { value: 'ambient', label: '淡淡一句' },
                { value: 'caption', label: '底部字幕' },
                { value: 'both', label: '都要' },
              ]}
              onChange={(v) => onListenSettings({ roamLyrics: v })}
            />
          </div>
          <span className="row-hint">
            {lyricSettings.roamLyrics === 'ambient'
              ? '还没进入聆听时，星云上只淡淡留着正在唱的一句。'
              : lyricSettings.roamLyrics === 'caption'
                ? '还没进入聆听时，星云上不飞歌词，播放条上方显示一行字幕。'
                : '淡淡的一句和底部字幕同时出现。'}
          </span>
          <div className="row">
            <span className="lbl">播放条也变淡</span>
            <Tg checked={lyricSettings.listenDimBar} onChange={(b) => onListenSettings({ listenDimBar: b })} label="聆听时播放条也变淡" />
          </div>
        </div>
      </div>
    </>
  );

  const bgPage = (
    <>
      <div className="g-title">跟着正在播放的歌</div>
      <div className="rp-tiles">
        <Tile name="封面色调" selected={bgChoice === 'env'} data={{ 'data-bg': 'env' }} onClick={() => selectCover('nebula')}>
          <span className="rp-envbg" />
        </Tile>
        <Tile name="封面虚影" selected={bgChoice === 'fog'} data={{ 'data-bg': 'fog' }} onClick={() => selectCover('blend')}>
          <span className="rp-envbg" />
          {coverUrl && <span className="rp-ghost" style={{ backgroundImage: `url(${JSON.stringify(coverUrl)})` }} />}
        </Tile>
      </div>
      <div className="g-title">自己的画面</div>
      <div className="rp-tiles">
        <Tile
          name="图片 / 视频"
          selected={bgChoice === 'custom'}
          data={{ 'data-bg': 'custom' }}
          onClick={() => bgInputRef.current?.click()}
        >
          {customMedia ? (
            <>
              {customMedia.type === 'video' ? (
                <video className="rp-thumb" src={customMedia.url} muted playsInline preload="metadata" />
              ) : (
                <span className="rp-photo" style={{ backgroundImage: `url(${JSON.stringify(customMedia.url)})` }} />
              )}
              <span className="rp-badge">我的{customMedia.type === 'video' ? '视频' : '图片'}</span>
            </>
          ) : (
            <span className="rp-plain">
              <b>+</b>选择图片或视频
            </span>
          )}
        </Tile>
        <Tile
          name="Wallpaper Engine"
          selected={bgChoice === 'wallpaper'}
          data={{ 'data-bg': 'wallpaper' }}
          onClick={onOpenWallpapers}
        >
          <WallpaperArt url={wallUrl} isImage={bgSetting.type === 'image'} />
        </Tile>
      </div>
      <p className="hint-line">{BG_DESC[bgChoice]}</p>
      {bgChoice === 'custom' && (
        <div className="group rp-group-gap">
          <RowButton onClick={() => bgInputRef.current?.click()}>
            <span className="lbl">
              选择图片或视频…<small>2.5MB 以内的图片下次打开还在；更大的图片和视频只在这次有效</small>
            </span>
            <span className="act">
              <IconImage size={15} />
            </span>
          </RowButton>
        </div>
      )}
      {bgChoice === 'wallpaper' && (
        <div className="group rp-group-gap">
          <RowButton onClick={onOpenWallpapers}>
            <span className="lbl">打开壁纸库…</span>
            <span className="act">
              <IconExternal size={15} />
            </span>
          </RowButton>
        </div>
      )}
    </>
  );

  const materialTile = (v: GlassTheme, name: string, desc: string) => (
    <Tile name={desc} selected={glassTheme === v} data={{ 'data-theme': v }} onClick={() => onGlassTheme(v)}>
      <span className="rp-envbg" />
      {coverUrl && <span className="rp-mosaic" style={{ backgroundImage: `url(${JSON.stringify(coverUrl)})` }} />}
      <span className={`rp-mat ${v}`}>{name}</span>
    </Tile>
  );

  const lookPage = (
    <>
      <div className="g-title">材质</div>
      <div className="rp-tiles">
        {materialTile('liquid', '液态', '液态 · 边缘像玻璃一样折射')}
        {materialTile('frost', '磨砂', '磨砂 · 更柔、更安静')}
      </div>
      <p className="hint-line">播放条、两侧小球、面板、弹窗和菜单一起切换。</p>
      <div className="g-title">星云</div>
      <div className="group">
        <div className="row">
          <span className="lbl">星云怎么排</span>
          <Seg
            label="星云怎么排"
            value={stageLab.layout}
            options={[
              { value: 'chroma', label: '按颜色' },
              { value: 'cluster', label: '按歌手' },
              { value: 'random', label: '随机' },
            ]}
            onChange={(v) => setSpaceLab({ mode: v })}
          />
        </div>
        <span className="row-hint">{LAYOUT_HINT[stageLab.layout]}</span>
      </div>
      <div className="g-title">画面</div>
      <div className="group">
        <div className="row">
          <span className="lbl">
            隐藏星云卡片<small>只留背景和歌词</small>
          </span>
          <Tg checked={uiHideCards} onChange={onToggleHideCards} label="隐藏星云卡片" />
        </div>
        <div className="row">
          <span className="lbl">
            隐藏星云上的歌词<small>只留背景和卡片</small>
          </span>
          <Tg checked={uiHideLyrics} onChange={onToggleHideLyrics} label="隐藏星云上的歌词" />
        </div>
      </div>
      <div className="g-title">性能</div>
      <div className="group">
        <div className="row">
          <span className="lbl">
            性能优先
            <small>
              {perfPriority
                ? '已关掉玻璃折射和背景漂移'
                : perfAutoLevel > 0
                  ? '检测到卡顿，已自动关掉一部分效果'
                  : '打开后关掉玻璃折射和背景漂移，更流畅'}
            </small>
          </span>
          <Tg checked={perfPriority} onChange={onPerfPriority} label="性能优先" />
        </div>
      </div>
      <p className="rp-foot">
        下次打开会回到这次的歌单和正在播放的歌
        <br />
        Music Nebula v0.1.0
      </p>
    </>
  );

  const settingsWindow = (
    <>
      <div className="win-head">
        <h2>设置</h2>
      </div>
      <Seg<DockSettingsPage>
        wide
        label="设置分类"
        value={settingsPage}
        options={[
          { value: 'lyrics', label: '歌词' },
          { value: 'listen', label: '聆听' },
          { value: 'bg', label: '背景' },
          { value: 'look', label: '外观' },
        ]}
        onChange={setSettingsPage}
      />
      <div ref={pageRef} className="set-page">
        {settingsPage === 'lyrics'
          ? lyricsPage
          : settingsPage === 'listen'
            ? listenPage
            : settingsPage === 'bg'
              ? bgPage
              : lookPage}
      </div>
      {/* 始终在 DOM 里（qa 脚本直接对它 setInputFiles），由「自定义」块和「选择图片或视频…」打开 */}
      <input
        ref={bgInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );

  return (
    <SideDock
      side="right"
      visible={visible}
      near={near}
      active={openRow}
      onActiveChange={(id) => setOpenRow(id === 'login' || id === 'settings' ? id : null)}
      onPinChange={onPinChange}
      onEnter={onEnter}
      onLeave={onLeave}
      items={[
        {
          id: 'login',
          label: loggedCount ? `账号 · 已连接 ${loggedCount} 个平台` : '账号',
          icon: avatarUrl ? (
            <img src={avatarUrl} alt="" draggable={false} />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M5 20c.9-3.6 3.7-5.5 7-5.5s6.1 1.9 7 5.5" />
            </svg>
          ),
        },
        {
          id: 'settings',
          label: '设置',
          icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          ),
        },
      ]}
    >
      {shownRow === 'login' ? loginWindow : settingsWindow}
    </SideDock>
  );
});
