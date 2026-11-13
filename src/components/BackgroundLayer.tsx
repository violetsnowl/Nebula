import { BACKGROUND_PRESETS } from '../lib/backgrounds';
import type { BackgroundSetting } from '../lib/backgrounds';
import { Starfield } from './Starfield';

import type { CoverBgMode } from '../lib/backgrounds';

export function BackgroundLayer({
  setting,
  coverMode,
}: {
  setting: BackgroundSetting;
  coverMode?: CoverBgMode;
}) {
  // 跟随封面（NEBULA_UI_SYSTEM §4）：底子都是环境光，颜色来自根节点 --e1/--e2/--e3/--ebase，无封面时为中性环境光。
  // 「雾中封面」在环境光里多两层封面原图：远层大而雾、只留明暗结构并染上环境色；近层略清楚、保留一丝原色，
  // 缓慢地若隐若现。层的边缘用径向遮罩溶进雾里，看不到方形边框。换歌时按封面 URL 重新挂载并淡入。
  if (coverMode === 'nebula' || coverMode === 'blend') {
    const ghost = coverMode === 'blend' && setting.type === 'image' ? setting.url : '';
    return (
      <div className={`bg-layer bg-env${ghost ? ' has-ghost' : ''}`} aria-hidden="true">
        <span className="env-blob b1" />
        <span className="env-blob b2" />
        <span className="env-blob b3" />
        {ghost && (
          <span className="env-ghost" key={ghost}>
            <img className="ghost-far" src={ghost} alt="" draggable={false} />
            <img className="ghost-near" src={ghost} alt="" draggable={false} />
          </span>
        )}
        <span className="env-grain" />
        <span className="env-vignette" />
      </div>
    );
  }
  if (setting.type === 'cover') return null; // 封面背景由 App 换算为 image/preset 后传入
  if (setting.type === 'image') {
    return (
      <div className="bg-layer">
        <img className="bg-media" src={setting.url} alt="自定义背景" draggable={false} />
        <div className="bg-overlay-dark" />
        <div className="bg-vignette" />
      </div>
    );
  }

  if (setting.type === 'video') {
    return (
      <div className="bg-layer">
        <video className="bg-media" src={setting.url} autoPlay muted loop playsInline />
        <div className="bg-overlay-dark" />
        <div className="bg-vignette" />
      </div>
    );
  }

  const preset = BACKGROUND_PRESETS.find((p) => p.id === setting.id) ?? BACKGROUND_PRESETS[0]!;
  return (
    <div className={`bg-layer ${preset.layerClass}`} aria-hidden="true">
      {preset.id === 'midnight' && <Starfield />}
      {preset.id === 'aurora' && (
        <>
          <span className="aurora aurora-1" />
          <span className="aurora aurora-2" />
          <span className="aurora aurora-3" />
        </>
      )}
      {preset.id === 'synthwave' && (
        <>
          <span className="synth-sun" />
          <span className="synth-grid" />
        </>
      )}
      <div className="bg-vignette" />
    </div>
  );
}
