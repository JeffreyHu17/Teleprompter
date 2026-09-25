import React from 'react';
import ReactDOM from 'react-dom/client';
import { MobileView } from './MobileView';
import '../styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileView />
  </React.StrictMode>,
);
