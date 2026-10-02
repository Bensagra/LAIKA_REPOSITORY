import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, Viga_400Regular } from '@expo-google-fonts/viga';
import { AppSettingsProvider } from '../contexts/AppSettings';

export default function RootLayout() {
  // Viga for titles/main buttons (styles/theme.ts). Screens render right away
  // with the fallback font and switch once it has loaded.
  useFonts({ Viga_400Regular });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppSettingsProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="preparar" />
          <Stack.Screen name="mision" />
          <Stack.Screen name="data" />
          <Stack.Screen name="mision-detalle" />
        </Stack>
      </AppSettingsProvider>
    </GestureHandlerRootView>
  );
}
