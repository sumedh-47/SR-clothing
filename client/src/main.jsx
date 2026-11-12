import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import './styles.css';

const isStaticPreview = import.meta.env.VITE_STATIC_PREVIEW === 'true';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {!isStaticPreview && window.location.pathname === '/admin' ? <Admin /> : <App />}
  </React.StrictMode>,
);