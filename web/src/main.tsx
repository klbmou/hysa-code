import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import LandingPage from './LandingPage.js';
import FilesPage from './FilesPage.js';
import './styles.css';

function getRoute(): 'chat' | 'landing' | 'files' {
  const hash = window.location.hash.slice(1) || '/';
  if (hash.startsWith('/chat')) return 'chat';
  if (hash.startsWith('/files')) return 'files';
  return 'landing';
}

function Root() {
  const [route, setRoute] = useState<'chat' | 'landing' | 'files'>(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route === 'chat') return <App />;
  if (route === 'files') return <FilesPage />;
  return <LandingPage />;
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
}
