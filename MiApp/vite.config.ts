import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
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
});
