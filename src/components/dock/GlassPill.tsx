import { useRef, type ButtonHTMLAttributes } from 'react';
import { useGlass } from '../../lib/glass';

/**
 * Dock 小球 / 胶囊（NEBULA_UI_SYSTEM §9.2）：G2 透镜。
 * 小球和展开的胶囊是同一个元素，宽度变化后 GlassManager 会按新尺寸重建折射贴图。
 * 只在 Dock 可见时注册折射滤镜（visible），隐藏时不占 backdrop 开销。
 */
export function GlassPill({
  visible,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { visible: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useGlass(ref, 'g2', visible);
  return (
    <button ref={ref} type="button" className={`pill glass-g2${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}
