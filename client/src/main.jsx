import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import './styles.css';

const isStaticPreview = import.meta.env.VITE_STATIC_PREVIEW === 'true';

function Root() {
  const checkAdmin = () => {
    if (isStaticPreview) return false;

    const p = window.location.pathname;
    const h = window.location.hash;
    const s = window.location.search;
    return (
      p.endsWith('/admin') ||
      p.endsWith('/admin/') ||
      h === '#admin' ||
      h.startsWith('#/admin') ||
      s.includes('admin=true')
    );
  };

  const [isAdmin, setIsAdmin] = useState(checkAdmin);

  useEffect(() => {
    const onLocationChange = () => setIsAdmin(checkAdmin());
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, []);

  return isAdmin ? <Admin /> : <App />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
