import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DesktopSheetOpen } from '../lib/playlist/ipcClient';
import { IconClose } from './icons';
import { LOGIN_HOW, platformMeta } from './platforms';
import './modals.css';

const SHELL_STYLE = { '--mdl-w': '1100px' } as CSSProperties;
/** 进场动画 0.28s；动画事件没触发（减少动态效果 / 窗口被遮住）时的兜底。 */
const READY_FALLBACK_MS = 450;
const LEAVE_MS = 280;

/**
 * 内嵌页面弹窗（登录页 / 二次验证页）。外壳由这里画（与信息弹窗同一套：G3、22px、遮罩是同级独立一层），
 * 第三方页面是主进程的 WebContentsView，盖在正文区上面：这里量出正文区位置报给主进程（nebula:sheet:bounds）。
 * 进场动画走完后才报位置（动画中位置在变），之后窗口缩放 / 滚动都会重新报。
 * 用户关闭（叉 / Esc / 点遮罩）→ 先通知主进程摘掉页面，再播退出动画；登录成功由主进程发 closed 触发退出。
 *
 * 注意：焦点在第三方页面里时按键由那个页面接收，Esc 不会到这里。
 */
export function LoginSheet({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [sheet, setSheet] = useState<DesktopSheetOpen | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [ready, setReady] = useState(false);
  const sheetRef = useRef<DesktopSheetOpen | null>(null);
  const leavingRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef(0);
  const readyTimer = useRef(0);

  const beginLeave = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    setReady(false);
    leaveTimer.current = window.setTimeout(() => {
      sheetRef.current = null;
      leavingRef.current = false;
      setSheet(null);
      setLeaving(false);
    }, LEAVE_MS);
  }, []);

  // 主进程要求显示 / 收起
  useEffect(() => {
    const api = window.nebulaAPI;
    if (!api?.onSheetOpen || !api.onSheetClosed) return;
    const offOpen = api.onSheetOpen((s) => {
      window.clearTimeout(leaveTimer.current);
      window.clearTimeout(readyTimer.current);
      leavingRef.current = false;
      sheetRef.current = s;
      setLeaving(false);
      setReady(false);
      setSheet(s);
      readyTimer.current = window.setTimeout(() => setReady(true), READY_FALLBACK_MS);
    });
    const offClosed = api.onSheetClosed(({ id }) => {
      if (sheetRef.current?.id === id) beginLeave();
    });
    return () => {
      offOpen();
      offClosed();
      window.clearTimeout(leaveTimer.current);
      window.clearTimeout(readyTimer.current);
    };
  }, [beginLeave]);

  useEffect(() => {
    onOpenChange(!!sheet);
  }, [sheet, onOpenChange]);

  /** 用户关闭：先让主进程摘掉页面（否则它会盖在退出动画上面），再播退出动画。 */
  const requestClose = useCallback(() => {
    const cur = sheetRef.current;
    if (!cur || leavingRef.current) return;
    window.nebulaAPI?.sheetClose(cur.id);
    beginLeave();
  }, [beginLeave]);

  // §9.4：Esc 关闭
  const open = !!sheet;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  // 进场动画结束后开始报告正文区位置：尺寸变化、窗口缩放、任意滚动都重新量
  const id = sheet?.id;
  useEffect(() => {
    const el = bodyRef.current;
    const api = window.nebulaAPI;
    if (id === undefined || !ready || leaving || !el || !api?.sheetBounds) return;
    let last = '';
    const report = () => {
      const r = el.getBoundingClientRect();
      const b = {
        id,
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
      const key = `${b.x},${b.y},${b.width},${b.height}`;
      if (key === last) return;
      last = key;
      api.sheetBounds(b);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    window.addEventListener('scroll', report, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      window.removeEventListener('scroll', report, true);
    };
  }, [id, ready, leaving]);

  if (!sheet) return null;
  const meta = platformMeta(sheet.platform);
  const hint = sheet.hint ?? LOGIN_HOW[sheet.platform] ?? '';
  return (
    <div className={`info-overlay${leaving ? ' is-out' : ''}`}>
      {/* 遮罩独立一层：点它关闭；面板不以它为祖先，G3 玻璃才能采到背后画面 */}
      <div className="info-veil" onPointerDown={requestClose} />
      <div
        key={sheet.id}
        className="info-modal glass-g3 lgs-panel"
        style={SHELL_STYLE}
        role="dialog"
        aria-label={sheet.title}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && e.animationName === 'info-modal-in') {
            window.clearTimeout(readyTimer.current);
            setReady(true);
          }
        }}
      >
        <button type="button" className="mdl-x" aria-label="关闭" onClick={requestClose}>
          <IconClose size={18} />
        </button>
        <div className="sht-head">
          {meta.logo ? (
            <img className="lgs-logo" src={meta.logo} alt="" draggable={false} />
          ) : (
            <span className="lgs-logo">{meta.name.slice(0, 1)}</span>
          )}
          <div className="sht-text">
            <h2 className="sht-title">{sheet.title}</h2>
            {hint && <div className="sht-sub">{hint}</div>}
          </div>
        </div>
        <div className="lgs-body" ref={bodyRef}>
          {sheet.placeholder ?? '正在打开官方登录页…'}
        </div>
      </div>
    </div>
  );
}
