import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import LandingPage from './LandingPage.js';
import './styles.css';

function getRoute(): 'chat' | 'landing' {
  const hash = window.location.hash.slice(1) || '/';
  if (hash.startsWith('/chat')) return 'chat';
  return 'landing';
}

function Root() {
  const [route, setRoute] = useState<'chat' | 'landing'>(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route === 'chat') return <App />;
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
