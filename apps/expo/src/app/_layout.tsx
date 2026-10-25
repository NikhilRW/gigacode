import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DraftProvider } from '@/state/DraftProvider';
import { ThemeProvider, useTheme } from '@/state/ThemeProvider';

export default function RootLayout() {
  useFonts({ SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });
  return (
    <SafeAreaProvider>
      <ThemeProvider><ThemedRoutes /></ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedRoutes() {
  const { colors, mode } = useTheme();
  return <DraftProvider>
    <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }} />
  </DraftProvider>;
}
