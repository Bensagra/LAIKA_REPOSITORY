import React, { useEffect, useState } from 'react';
import { AppRegistry } from 'react-native';
// Explicitly select the screen file: `../app` resolves to app.json in Vite.
import HomeScreen from '../app/index';
import MisionScreen from '../app/mision';
import DataScreen from '../app/data';
import PrepararScreen from '../app/preparar';
import { AppSettingsProvider } from '../contexts/AppSettings';

import './styles.css';

function getRoute() {
  const route = window.location.hash.replace(/^#/, '');
  return route === '/mision' || route === '/data' || route === '/preparar' ? route : '/';
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
