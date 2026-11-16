import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PlaybackProvider } from './hooks/playback/PlaybackContext';
import './styles.css';
import { loadBundledFonts } from './lib/fonts';

// 打包的拉丁 / 韩文字体（public/fonts）：在渲染之前挂上，歌词引擎在字体到位后会重新量字宽
loadBundledFonts();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlaybackProvider>
      <App />
    </PlaybackProvider>
  </React.StrictMode>,
);
