import { useEffect, useState } from 'react';
import { audioPlayer } from './AudioPlayer';
import type { AudioPlayerState } from './AudioPlayer';

/** React 订阅钩子：任何播放器状态变化都会触发使用方重渲染。 */
export function useAudioPlayer(): AudioPlayerState {
  const [state, setState] = useState<AudioPlayerState>(() => audioPlayer.getState());
  useEffect(() => {
    const off = audioPlayer.subscribe(() => setState(audioPlayer.getState()));
    // 订阅前（首次渲染到副作用之间）发出的通知会丢失，订阅后补同步一次
    setState(audioPlayer.getState());
    return off;
  }, []);
  return state;
}
