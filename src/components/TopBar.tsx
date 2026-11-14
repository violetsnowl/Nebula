import { memo, useRef, type ReactNode } from 'react';
import { IconMusic } from './icons';
import { useGlass } from '../lib/glass';

interface TopBarProps {
  visible: boolean;
  localBusy: boolean;
  searchSlot: ReactNode;
  onEnter: () => void;
  onLeave: () => void;
  onOpenLocal: () => void;
}

/** 顶部边缘感应搜索栏：默认隐藏在视口上方，鼠标触顶滑入。只保留搜索和本地导入两颗玻璃球（歌曲数量在左侧面板里已有，审查第 19 条）。 */
export const TopBar = memo(function TopBar({
  visible,
  localBusy,
  searchSlot,
  onEnter,
  onLeave,
  onOpenLocal,
}: TopBarProps) {
  // 本地导入 = G2 透镜圆按钮（NEBULA_UI_SYSTEM §3.3）；顶栏收起时不注册折射
  const localRef = useRef<HTMLButtonElement>(null);
  useGlass(localRef, 'g2', visible);
  return (
    <header
      className={`edge-panel edge-top topbar${visible ? ' is-open' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="top-bar">
        {searchSlot}
        <button
          ref={localRef}
          className="local-btn glass-g2"
          data-tip="导入本地音乐（选择文件夹，自动解析 ID3 标签）"
          aria-label="导入本地音乐"
          disabled={localBusy}
          onClick={onOpenLocal}
        >
          <span>{localBusy ? '…' : <IconMusic size={18} />}</span>
        </button>
      </div>
    </header>
  );
});
