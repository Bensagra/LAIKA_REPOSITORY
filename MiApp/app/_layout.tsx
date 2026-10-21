import { View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, Viga_400Regular } from '@expo-google-fonts/viga';
import { AppSettingsProvider } from '../contexts/AppSettings';
import { C } from '../styles/theme';

export default function RootLayout() {
  // Viga for titles/main buttons (styles/theme.ts). Rendering before the font
  // is ready measures text with the system fallback font, which is wider —
  // on tight boxes like the home logo that causes a mid-word wrap that then
  // gets overlapped by the subtitle below it once Viga swaps in (letters
  // appear to flash/clip). Hold the first paint until it's loaded instead.
  const [fontsLoaded] = useFonts({ Viga_400Regular });
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }
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
