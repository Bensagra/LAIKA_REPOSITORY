import React, { useEffect, useState } from 'react';
import { AppRegistry } from 'react-native';
// Explicitly select the screen file: `../app` resolves to app.json in Vite.
import HomeScreen from '../app/index';
import MisionScreen from '../app/mision';
import DataScreen from '../app/data';
import PrepararScreen from '../app/preparar';
import MisionDetalleScreen from '../app/mision-detalle';
import { AppSettingsProvider } from '../contexts/AppSettings';

import './styles.css';

const ROUTES = ['/mision', '/data', '/preparar', '/mision-detalle'];

function getRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  const pathname = hash.split('?')[0];
  return ROUTES.includes(pathname) ? pathname : '/';
}

function WebApp() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const updateRoute = () => setRoute(getRoute());
    window.addEventListener('hashchange', updateRoute);
    window.addEventListener('laikai:navigate', updateRoute);
    return () => {
      window.removeEventListener('hashchange', updateRoute);
      window.removeEventListener('laikai:navigate', updateRoute);
    };
  }, []);

  if (route === '/mision') return <MisionScreen />;
  if (route === '/data') return <DataScreen />;
  if (route === '/preparar') return <PrepararScreen />;
  if (route === '/mision-detalle') return <MisionDetalleScreen />;
  return <HomeScreen />;
}

function WebRoot() {
  return (
    <AppSettingsProvider>
      <WebApp />
    </AppSettingsProvider>
  );
}

AppRegistry.registerComponent('laikAI', () => WebRoot);

const rootTag = document.getElementById('root');

if (rootTag) {
  AppRegistry.runApplication('laikAI', {
    rootTag,
  });
}
