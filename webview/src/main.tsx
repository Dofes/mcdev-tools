import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DebugApp from './DebugApp';

const RootApp = document.body.dataset.view === 'game-debugger' ? DebugApp : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
