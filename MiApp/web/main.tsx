import React, { useEffect, useState } from 'react';
import { AppRegistry } from 'react-native';
import HomeScreen from '../app';
import MisionScreen from '../app/mision';
import { AppSettingsProvider } from '../contexts/AppSettings';

import './styles.css';

function getRoute() {
  const route = window.location.hash.replace(/^#/, '');
  return route === '/mision' ? '/mision' : '/';
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

  return route === '/mision' ? <MisionScreen /> : <HomeScreen />;
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
