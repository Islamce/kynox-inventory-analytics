import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { applyMode, getStoredMode } from './design/theme';
import './styles.css';

// Apply the stored theme as early as possible from this module script. The
// app's strict CSP (script-src 'self') blocks inline <script>, so the theme is
// enforced here rather than via an inline bootstrap in index.html. #root is
// empty until React mounts, so there is no content flash.
applyMode(getStoredMode());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
