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
import { DOCK_PLATFORM_ORDER, platformMeta } from './platforms';
import './dock/right-panel.css';

export type DockSettingsPage = 'lyrics' | 'bg' | 'look';

interface AccountDockProps {
  visible: boolean;
  platforms: DesktopLoginPlatform[];
  accounts: Record<string, AccountState>;
  selectedPlatform: string;
  /** 外部「去登录」请求计数：变化时打开账号面板并推入对应平台的详情。 */
  loginNonce: number;
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
  onHighlightStyle: (s: LyricVisualSettings['highlightStyle']) => void;
  onLayerMode: (m: LyricVisualSettings['layerMode']) => void;
  onCurrentScale: (n: number) => void;
  onWordRise: (n: number) => void;
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
function RowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div className="row btn-row" role="button" tabIndex={0} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

function vipText(a: AccountState | undefined): string {
  return a?.isSvip ? 'SVIP' : a?.isVip ? 'VIP' : '普通用户';
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
function QqLogin({ onSuccess }: { onSuccess: () => void }) {
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
      <div className="rp-flow-status">{status || '未登录 QQ 音乐'}</div>
    </div>
  );
}

function SpotifyLogin({ onSuccess }: { onSuccess: () => void }) {
  const [status, setStatus] = useState('');
  const start = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setStatus('正在打开 Spotify 授权窗口…');
    const r = await window.nebulaAPI.spotifyLoginStart();
    if (!r.ok || !r.data) {
      setStatus('授权未完成（需配置 SPOTIFY_CLIENT_ID）');
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

/** 酷狗音乐：官方登录页（BrowserWindow）。 */
function KugouLogin({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [cookieMode, setCookieMode] = useState(false);
  const [cookieText, setCookieText] = useState('');

  const openWindow = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setBusy(true);
    setStatus('已打开官方登录页，请在窗口内登录酷狗账号…');
    try {
      const r = await window.nebulaAPI.kugouLoginWindow();
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
      console.log('[KugouLogin] importCookie raw.length=' + cookieText.trim().length + ' includes=:' + cookieText.includes('='));
      let raw = cookieText.trim();
      // 支持多行 name=value 格式（每行一个 cookie）
      if (raw.includes('\n') && !raw.includes(';')) {
        raw = raw.split('\n').filter(l => l.includes('=')).join('; ');
      }
      // 如果不包含任何 = ，无法解析
      if (!raw.includes('=')) {
        setStatus('格式不对。请在 F12 → Network → 任意 kugou 请求 → Headers → Cookie 复制完整值（如 kg_mid=xxx; token=yyy）');
        setBusy(false);
        return;
      }
      const r = await window.nebulaAPI.setCookie('kugou', raw);
      if (!r.ok) {
        setStatus(`Cookie 无效：${r.error}`);
        return;
      }
      setCookieText('');
      onSuccess();
    } catch (err) {
      setStatus(`导入失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [onSuccess, cookieText]);

  return (
    <div className="rp-flow">
      {!cookieMode ? (
        <>
          <button type="button" className="btn primary full" disabled={busy} onClick={openWindow}>
            {busy ? '等待确认…' : '打开酷狗登录页'}
          </button>
          <button type="button" className="btn text" onClick={() => setCookieMode(true)}>
            粘贴 Cookie 登录
          </button>
        </>
      ) : (
        <>
          <textarea
            className="rp-cookie-input"
            placeholder="粘贴酷狗 Cookie（F12 → Network → 任意请求 → Cookie 头）"
            rows={3}
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            spellCheck={false}
          />
          <div className="rp-flow-actions">
            <button type="button" className="btn sec" disabled={busy || !cookieText.trim()} onClick={importCookie}>
              确认导入
            </button>
            <button type="button" className="btn text" onClick={() => setCookieMode(false)}>
              返回
            </button>
          </div>
        </>
      )}
      {status && <div className="rp-flow-status">{status}</div>}
    </div>
  );
}

/** 汽水音乐：签名引擎 + 扫码登录。 */
function QishuiLogin({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const openWindow = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setBusy(true);
    setStatus('正在初始化签名引擎，请稍候…');
    try {
      const r = await window.nebulaAPI.qishuiLoginWindow();
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
        {busy ? '正在初始化…' : '打开汽水登录页'}
      </button>
      <div className="rp-flow-status">{status || '未登录汽水音乐'}</div>
    </div>
  );
}

function PlatformLogin({ platform, info, onRefresh }: { platform: string; info: DesktopLoginPlatform; onRefresh: (platform: string) => void }) {
  if (info.kind === 'unavailable') {
    return (
      <div className="rp-flow">
        <div className="rp-flow-status">{info.unavailableReason ?? '暂不支持'}</div>
      </div>
    );
  }
  if (platform === 'netease') return <NeteaseLogin onSuccess={() => onRefresh('netease')} />;
  if (platform === 'qq') return <QqLogin onSuccess={() => onRefresh('qq')} />;
  if (platform === 'kugou') return <KugouLogin onSuccess={() => onRefresh('kugou')} />;
  if (platform === 'qishui') return <QishuiLogin onSuccess={() => onRefresh('qishui')} />;
  if (platform === 'spotify') return <SpotifyLogin onSuccess={() => onRefresh('spotify')} />;
  return (
    <div className="rp-flow">
      <div className="rp-flow-status">暂不支持该平台登录</div>
    </div>
  );
}

/** 各平台详情页顶部的一句话说明。 */
const LOGIN_HOW: Record<string, string> = {
  netease: '用网易云音乐 App 扫码登录',
  qq: '在官方登录页用手机 QQ 扫码，登录后自动回到这里',
  kugou: '在官方登录页扫码或输入账号，登录后自动回到这里',
  qishui: '在官方登录页扫码，登录后自动回到这里',
  spotify: '在浏览器里授权，授权完成后自动回到这里',
};

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
          <RowButton onClick={() => onRefresh(platform)}>
            <span className="lbl">
              刷新账号信息<small>会员状态、歌单数量</small>
            </span>
            <span className="chev">›</span>
          </RowButton>
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
        <img src={meta.logo} alt="" draggable={false} />
      </span>
      <h3>{meta.name}</h3>
      <p className="rp-how">{LOGIN_HOW[platform] ?? '登录后可以导入这个平台的歌单'}</p>
      {info ? <PlatformLogin platform={platform} info={info} onRefresh={onRefresh} /> : null}
    </div>
  );
}

/* ---------- 设置：歌词实时预览 ---------- */

const PREVIEW_LINE = '风经过的地方，都亮了';
const PREVIEW_NEXT = '路灯一盏一盏替我数着心跳';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 逐字切分用：CJK / 假名 / 谚文按单字，其余按空格分词（和空域歌词层一致）。 */
const PV_CJK = /[⺀-鿿豈-﫿　-〿぀-ヿ가-힯]/;

interface PvToken {
  text: string;
  startMs: number;
  duration: number;
}

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

/** 一句歌词切成扫字单位：有逐字时间就用逐字时间，否则把整句时长平均分给每个字 / 词。 */
function previewTokens(lines: LyricLineUI[], idx: number): PvToken[] {
  const line = lines[idx];
  if (!line) return [];
  if (line.words?.length) {
    // 逐字时间里的词不带空格：前后两个词都是字母 / 数字时补一个空格（和空域歌词层同一规则）
    const ws = line.words;
    return ws.map((w, i) => {
      const prev = ws[i - 1];
      const gap = !!prev && /[A-Za-z0-9]/.test(prev.text) && /[A-Za-z0-9]/.test(w.text) && !/\s$/.test(prev.text);
      return { text: gap ? ` ${w.text}` : w.text, startMs: w.startMs, duration: Math.max(1, w.duration) };
    });
  }
  const parts: string[] = [];
  let buf = '';
  for (const ch of line.text) {
    if (PV_CJK.test(ch)) {
      if (buf) parts.push(buf);
      buf = '';
      parts.push(ch);
    } else if (ch === ' ') {
      if (buf) parts.push(`${buf} `);
      else if (parts.length) parts[parts.length - 1] += ' ';
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push(buf);
  const next = nextUsable(lines, idx);
  const gap = next ? clamp(next.timeMs - line.timeMs, 1200, 12000) : 6000;
  const per = (line.duration ?? gap) / Math.max(1, parts.length);
  return parts.map((text, j) => ({ text, startMs: line.timeMs + j * per, duration: per }));
}

const SAMPLE_TOKENS: PvToken[] = [...PREVIEW_LINE].map((text) => ({ text, startMs: 0, duration: 1 }));

/**
 * 歌词实时预览：当前封面的环境光 + 当前歌曲正在唱的那一句，按歌词设置实时渲染。
 *   - 播放中：跟着真实播放进度扫字（和画面里的空域歌词同步）；
 *   - 暂停 / 前奏：在这一句上循环示范扫字，方便调高亮样式；
 *   - 没有歌词：用一句示例歌词。
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
  const curRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState(() => pickPreviewLine(lines, audioPlayer.getState().currentTime * 1000));
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const tokens = useMemo(() => (pick.idx >= 0 ? previewTokens(lines, pick.idx) : SAMPLE_TOKENS), [lines, pick.idx]);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const nextText = pick.idx >= 0 ? (nextUsable(lines, pick.idx)?.text ?? '') : PREVIEW_NEXT;

  // 预览窗只有 104px 高：把软件里的字号（14…maxFont）按比例缩到 13–30px，再乘当前句放大
  const ratio = clamp((settings.fontSize - 14) / Math.max(1, maxFont - 14), 0, 1);
  const fs = 13 + ratio * 17;
  const k = settings.currentScale / 1.22;
  const kRef = useRef(k);
  kRef.current = k;

  // 换歌：立刻按当前进度重新挑一句
  useEffect(() => {
    setPick(pickPreviewLine(lines, audioPlayer.getState().currentTime * 1000));
  }, [lines]);

  useEffect(() => {
    if (!active) return;
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let raf = 0;
    let baseMs = -1;
    let stamp = 0;
    let sx = 0;
    let lastLine: HTMLDivElement | null = null;

    const tick = (now: number) => {
      const st = audioPlayer.getState();
      const propMs = st.currentTime * 1000;
      if (propMs !== baseMs) {
        baseMs = propMs;
        stamp = now;
      }
      // 播放器的进度隔一段才更新一次，中间用帧时间补平
      const t = st.playing ? baseMs + Math.min(now - stamp, 1500) : baseMs;

      const want = lines.length ? pickPreviewLine(lines, t) : { idx: -1, live: false };
      if (want.idx !== pickRef.current.idx || want.live !== pickRef.current.live) {
        pickRef.current = want;
        setPick(want);
      }

      const lineEl = lineRef.current;
      const cur = curRef.current;
      if (lineEl && cur) {
        const toks = tokensRef.current;
        const n = toks.length;
        const live = st.playing && pickRef.current.live && pickRef.current.idx >= 0;
        const demo = reduce ? 0.5 : ((now - t0) % 4200) / 4200 / 0.82;
        const wp = toks.map((tk, j) =>
          live ? clamp((t - tk.startMs) / tk.duration, 0, 1) : clamp(demo * n - j, 0, 1),
        );
        const chars = lineEl.children;

        // 先读布局，再写样式
        const W = cur.clientWidth;
        const visW = lineEl.offsetWidth * kRef.current;
        const over = visW > W - 24;
        let target = 0;
        if (over) {
          let j = -1;
          for (let q = 0; q < n; q++) if ((wp[q] ?? 0) > 0) j = q;
          const el = j >= 0 ? (chars[j] as HTMLElement | undefined) : undefined;
          const xs = el ? (el.offsetLeft + el.offsetWidth * (wp[j] ?? 0)) * kRef.current : 0;
          const lim = visW / 2 - W / 2 + 14;
          target = clamp(visW / 2 - xs, -lim, lim);
        }
        // 换句：直接到位；同一句里平滑跟随
        sx = lineEl !== lastLine ? target : sx + (target - sx) * 0.2;
        lastLine = lineEl;

        for (let q = 0; q < chars.length; q++) {
          (chars[q] as HTMLElement).style.setProperty('--wp', (wp[q] ?? 0).toFixed(3));
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
      className={`rp-preview${settings.highlightStyle === 'float' ? ' float' : ''}`}
      style={
        { '--ly-now': settings.lyricColorSource === 'custom' ? settings.customColor : 'var(--acc)' } as React.CSSProperties
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
            fontWeight: settings.bold ? 700 : 600,
            '--k': k.toFixed(3),
            '--rise': `${((settings.wordRise * fs) / 44).toFixed(2)}px`,
          } as React.CSSProperties
        }
      >
        <div key={`c${pick.idx}`} ref={lineRef} className="rp-line">
          {tokens.map((tk, i) => (
            <span key={i} className="rp-ch">
              {tk.text}
            </span>
          ))}
        </div>
      </div>
      <span className="rp-tag">{pick.idx >= 0 ? '实时预览 · 当前歌曲' : '实时预览'}</span>
    </div>
  );
}

/* ---------- 设置：背景 / 材质 预览块 ---------- */

type BgChoice = 'env' | 'fog' | 'custom' | 'wallpaper';

const BG_DESC: Record<BgChoice, string> = {
  env: '颜色取自正在播放的封面：深色底上三团缓慢漂移的光，换歌时整个空间一起换色。',
  fog: '环境光里隐约浮着一层雾化的封面原图，缓慢地若隐若现；浅色封面会自动更淡。',
  custom: '用你自己的图片或视频铺满背景，强调色从画面里取。',
  wallpaper: '从本机 Wallpaper Engine 的壁纸库里选一张（支持动态壁纸）。',
};

function Tile({
  name,
  selected,
  onClick,
  data,
  children,
}: {
  name: string;
  selected: boolean;
  onClick: () => void;
  data: { 'data-bg': string } | { 'data-theme': string };
  children: ReactNode;
}) {
  return (
    <button type="button" className="rp-tile" aria-pressed={selected} onClick={onClick} {...data}>
      <span className="rp-art">
        {children}
        <span className="rp-check">✓</span>
      </span>
      <span className="rp-name">{name}</span>
    </button>
  );
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
  onHighlightStyle,
  onLayerMode,
  onCurrentScale,
  onWordRise,
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
                  <img src={meta.logo} alt="" draggable={false} />
                </span>
                <span className="lbl">
                  {meta.name}
                  <small className="rp-status">
                    <i className={`rp-dot${on ? ' on' : ''}`} />
                    {on ? `${nick} · ${vipText(acc)}` : (reason ?? '未登录')}
                  </small>
                </span>
                {on && (
                  <span className="rp-av">
                    {acc?.avatarUrl ? <img src={acc.avatarUrl} alt="" draggable={false} /> : nick.slice(0, 1)}
                  </span>
                )}
                <span className="chev">›</span>
              </RowButton>
            );
          })}
        </div>
        <p className="hint-line">
          登录后，这个平台的歌单会出现在左侧「歌单」里；取歌链接时会按会员情况自动挑选平台。
        </p>
      </div>
      {detailPf !== null && (
        <div className={`view${detailIn ? '' : ' hidden-right'}`} aria-hidden={!detailIn}>
          <button type="button" className="back" onClick={closeDetail}>
            ‹ 账号
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
  const customPhoto = bgScheme === 'custom' && bgSetting.type === 'image' ? bgSetting.url : null;

  const lyricsPage = (
    <>
      <div className="g-title">预览</div>
      <LyricPreview settings={lyricSettings} maxFont={maxFont} active={openRow === 'settings'} lines={lyricLines} />
      <div className="g-title">文字</div>
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
        <div className="row">
          <span className="lbl">加粗</span>
          <Tg checked={!!lyricSettings.bold} onChange={onLyricBold} label="歌词加粗" />
        </div>
      </div>
      <div className="g-title">高亮与动效</div>
      <div className="group">
        <div className="row">
          <span className="lbl">高亮风格</span>
          <Seg
            label="高亮风格"
            value={lyricSettings.highlightStyle}
            options={[
              { value: 'sweep', label: '扫光填充' },
              { value: 'float', label: '上浮发光' },
            ]}
            onChange={onHighlightStyle}
          />
        </div>
        <Slider
          label="当前句放大"
          value={lyricSettings.currentScale}
          min={1}
          max={1.6}
          step={0.02}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={onCurrentScale}
        />
        <Slider
          label="逐字上浮"
          value={lyricSettings.wordRise}
          min={0}
          max={12}
          step={1}
          format={(v) => `${v}px`}
          onChange={onWordRise}
        />
      </div>
      <div className="g-title">布局与颜色</div>
      <div className="group">
        <div className="row">
          <span className="lbl">三句布局</span>
          <Seg
            label="三句布局"
            value={lyricSettings.lyricLayout}
            options={[
              { value: 'stacked', label: '上下堆叠' },
              { value: 'offset', label: '上下错落' },
            ]}
            onChange={onLyricLayout}
          />
        </div>
        <div className="row">
          <span className="lbl">
            歌词层次<small>相对星云卡片</small>
          </span>
          <Seg
            label="歌词层次"
            value={lyricSettings.layerMode}
            options={[
              { value: 'under', label: '卡片之下' },
              { value: 'over', label: '卡片之上' },
            ]}
            onChange={onLayerMode}
          />
        </div>
        <div className="row">
          <span className="lbl">歌词颜色</span>
          <Seg
            label="歌词颜色"
            value={lyricSettings.lyricColorSource}
            options={[
              { value: 'cover', label: '跟随封面' },
              { value: 'custom', label: '自定义' },
            ]}
            onChange={onLyricColorSource}
          />
        </div>
        {lyricSettings.lyricColorSource === 'custom' && (
          <div className="row">
            <span className="lbl">正在唱的字</span>
            <input
              className="rp-swatch"
              type="color"
              value={lyricSettings.customColor}
              aria-label="正在唱的字的颜色"
              onChange={(e) => onCustomColor(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="g-title">静止时</div>
      <div className="group">
        <div className="row">
          <span className="lbl">
            让歌词成为主角<small>音乐在播放、鼠标静止一会儿，星云让开</small>
          </span>
          <Tg
            checked={lyricSettings.listenHandoff}
            onChange={(b) => onListenSettings({ listenHandoff: b })}
            label="静止时让歌词成为主角"
          />
        </div>
        {lyricSettings.listenHandoff && (
          <>
            <div className="row">
              <span className="lbl">让开方式</span>
              <Seg
                label="让开方式"
                value={lyricSettings.listenStyle}
                options={[
                  { value: 'sink', label: '沉降' },
                  { value: 'part', label: '散开' },
                  { value: 'ebb', label: '退潮' },
                ]}
                onChange={(v) => onListenSettings({ listenStyle: v })}
              />
            </div>
            <div className="row">
              <span className="lbl">静止多久</span>
              <Seg
                label="静止多久"
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
              <span className="lbl">播放条一起变淡</span>
              <Tg
                checked={lyricSettings.listenDimBar}
                onChange={(b) => onListenSettings({ listenDimBar: b })}
                label="聆听时播放条一起变淡"
              />
            </div>
          </>
        )}
      </div>
    </>
  );

  const bgPage = (
    <>
      <div className="g-title">跟随正在播放的封面</div>
      <div className="rp-tiles">
        <Tile name="环境光" selected={bgChoice === 'env'} data={{ 'data-bg': 'env' }} onClick={() => selectCover('nebula')}>
          <span className="rp-envbg" />
        </Tile>
        <Tile name="雾中封面" selected={bgChoice === 'fog'} data={{ 'data-bg': 'fog' }} onClick={() => selectCover('blend')}>
          <span className="rp-envbg" />
          {coverUrl && <span className="rp-ghost" style={{ backgroundImage: `url(${JSON.stringify(coverUrl)})` }} />}
        </Tile>
      </div>
      <div className="g-title">自己的画面</div>
      <div className="rp-tiles">
        <Tile
          name="自定义图片 / 视频"
          selected={bgChoice === 'custom'}
          data={{ 'data-bg': 'custom' }}
          onClick={() => bgInputRef.current?.click()}
        >
          {customPhoto ? (
            <>
              <span className="rp-photo" style={{ backgroundImage: `url(${JSON.stringify(customPhoto)})` }} />
              <span className="rp-badge">我的图片</span>
            </>
          ) : (
            <span className="rp-plain">
              <b>+</b>选择图片或视频
            </span>
          )}
        </Tile>
        <Tile
          name="Wallpaper"
          selected={bgChoice === 'wallpaper'}
          data={{ 'data-bg': 'wallpaper' }}
          onClick={onOpenWallpapers}
        >
          <span className="rp-plain">Wallpaper Engine</span>
        </Tile>
      </div>
      <p className="hint-line">{BG_DESC[bgChoice]}</p>
      {bgChoice === 'custom' && (
        <div className="group rp-group-gap">
          <RowButton onClick={() => bgInputRef.current?.click()}>
            <span className="lbl">
              选择图片或视频…<small>2.5MB 以内的图片会被记住，大文件只在本次使用</small>
            </span>
            <span className="chev">›</span>
          </RowButton>
        </div>
      )}
      {bgChoice === 'wallpaper' && (
        <div className="group rp-group-gap">
          <RowButton onClick={onOpenWallpapers}>
            <span className="lbl">打开壁纸库…</span>
            <span className="chev">›</span>
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
        {materialTile('liquid', '液态', '液态 · 边缘折射、轻微色散')}
        {materialTile('frost', '磨砂', '磨砂 · 更柔、更安静')}
      </div>
      <p className="hint-line">播放条、两侧小球、面板、弹窗和菜单一起切换。</p>
      <div className="g-title">画面</div>
      <div className="group">
        <div className="row">
          <span className="lbl">
            隐藏歌曲卡片<small>只留背景和歌词</small>
          </span>
          <Tg checked={uiHideCards} onChange={onToggleHideCards} label="隐藏歌曲卡片" />
        </div>
        <div className="row">
          <span className="lbl">
            隐藏歌词层<small>只留背景和星云</small>
          </span>
          <Tg checked={uiHideLyrics} onChange={onToggleHideLyrics} label="隐藏歌词层" />
        </div>
      </div>
      <div className="g-title">性能</div>
      <div className="group">
        <div className="row">
          <span className="lbl">
            性能优先
            <small>
              {perfPriority
                ? '已关闭折射、色散和背景漂移'
                : perfAutoLevel > 0
                  ? `检测到卡顿，已自动降低 ${perfAutoLevel} 级效果`
                  : '关闭折射、色散和背景漂移；卡顿时也会自动逐级降低'}
            </small>
          </span>
          <Tg checked={perfPriority} onChange={onPerfPriority} label="性能优先" />
        </div>
      </div>
      <p className="rp-foot">
        会话记忆已开启 · 下次打开自动恢复歌单和正在播放的歌
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
          { value: 'bg', label: '背景' },
          { value: 'look', label: '外观' },
        ]}
        onChange={setSettingsPage}
      />
      {settingsPage === 'lyrics' ? lyricsPage : settingsPage === 'bg' ? bgPage : lookPage}
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
