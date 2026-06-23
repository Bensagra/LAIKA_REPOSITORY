import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppSettingsProvider } from '../contexts/AppSettings';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppSettingsProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="mision" />
          <Stack.Screen name="data" />
        </Stack>
      </AppSettingsProvider>
    </GestureHandlerRootView>
  );
}
