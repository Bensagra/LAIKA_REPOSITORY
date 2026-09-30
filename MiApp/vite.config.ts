import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// EXPO_PUBLIC_* names match Expo's own env convention (so the same MiApp/.env
// also configures native builds); Vite has no built-in support for that
// prefix, so each one used in app code (see services/api.ts) must be listed
// here to be replaced with a literal at build time. Values come from
// MiApp/.env(.local) locally, or from Vercel's Environment Variables in prod.
const EXPO_PUBLIC_KEYS = ['EXPO_PUBLIC_DOG_API_URL', 'EXPO_PUBLIC_DOG_TOKEN', 'EXPO_PUBLIC_DOG_ROBOT_ID', 'EXPO_PUBLIC_BACKEND_HOST'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const expoPublicDefines = Object.fromEntries(
    EXPO_PUBLIC_KEYS.map((key) => [`process.env.${key}`, JSON.stringify(env[key] ?? '')])
  );
  return {
    plugins: [react()],
    // React Native Web's Animated cleanup calls global.cancelAnimationFrame.
    define: {
      global: 'globalThis',
      ...expoPublicDefines,
    },
    resolve: {
      alias: [
        {
          find: 'react-native',
          replacement: 'react-native-web',
        },
        {
          find: 'react-native-gesture-handler',
          replacement: path.resolve(__dirname, 'web/shims/react-native-gesture-handler.tsx'),
        },
        {
          find: 'expo-router',
          replacement: path.resolve(__dirname, 'web/shims/expo-router.ts'),
        },
        {
          find: 'expo-screen-orientation',
          replacement: path.resolve(__dirname, 'web/shims/expo-screen-orientation.ts'),
        },
        {
          find: 'expo-image-picker',
          replacement: path.resolve(__dirname, 'web/shims/expo-image-picker.ts'),
        },
        {
          find: '@expo/vector-icons/MaterialIcons',
          replacement: path.resolve(__dirname, 'web/shims/material-icons.tsx'),
        },
        {
          find: 'react-native-svg',
          replacement: path.resolve(__dirname, 'web/shims/react-native-svg.tsx'),
        },
      ],
    },
  };
});
