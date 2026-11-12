/** 歌词视觉设置（docs/project/ARCHITECTURE.md：共享类型，LyricsLayer 与 useLyrics 均从 lib 取）。 */
export interface LyricVisualSettings {
  fontSize: number;
  highlightStyle: 'sweep' | 'float';
  /** 悬浮层次：under = 卡片云之下（Z1）；over = 覆盖在卡片云之上。 */
  layerMode: 'under' | 'over';
  /** 当前句放大系数（可 DIY）。 */
  currentScale: number;
  /** 逐字已唱字上浮幅度 px（可 DIY）。 */
  wordRise: number;
  /** 三句布局：stacked = 依次在上；offset = 上下错落。 */
  lyricLayout: 'stacked' | 'offset';
  /** 歌词取色源：cover = 封面自动取色；custom = 自定义基色。 */
  lyricColorSource: 'cover' | 'custom';
  /** 自定义基色（hex）。 */
  customColor: string;
  /** 歌词加粗开关（Z1 穿梭歌词）。 */
  bold?: boolean;
  /** 静止时让歌词成为主角（漫游 / 聆听交接，NEBULA_UI_SYSTEM §7.1）。 */
  listenHandoff: boolean;
  /** 静止多久进入聆听（秒）：3 / 6 / 10。 */
  listenDelay: number;
  /** 星云让开的方式：sink = 沉降（默认）；part = 散开；ebb = 退潮。 */
  listenStyle: 'sink' | 'part' | 'ebb';
  /** 聆听时播放条一起变淡。 */
  listenDimBar: boolean;
}

/** 交接相关的设置项（设置页一次改一项）。 */
export type ListenSettingsPatch = Partial<
  Pick<LyricVisualSettings, 'listenHandoff' | 'listenDelay' | 'listenStyle' | 'listenDimBar'>
>;
