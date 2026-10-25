import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { createCommon, palettes, type Colors, type ThemeMode } from '@/theme';
import { decodeTheme, THEME_STORAGE_KEY } from '@/lib/palette';

type ThemeContext = {
  mode: ThemeMode; colors: Colors; common: ReturnType<typeof createCommon>;
  toggle: () => void; persistenceError: string | null;
};
const Context = createContext<ThemeContext | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [ready, setReady] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const writer = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(THEME_STORAGE_KEY).then(value => {
      if (!cancelled) { setMode(decodeTheme(value)); setReady(true); }
    }).catch(() => {
      if (!cancelled) { setReady(true); setPersistenceError('Theme preference could not be opened. Changes apply to this session.'); }
    });
    return () => { cancelled = true; };
  }, []);
  const colors = palettes[mode];
  const common = useMemo(() => createCommon(colors), [colors]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = mode;
    document.documentElement.style.backgroundColor = colors.bg;
    document.body.style.backgroundColor = colors.bg;
  }, [colors.bg, mode]);
  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    writer.current = writer.current.catch(() => {}).then(() => AsyncStorage.setItem(THEME_STORAGE_KEY, next)).then(() => setPersistenceError(null)).catch(() => {
      setPersistenceError('Theme changed for this session. Device storage could not save your preference.');
    });
  };
  // A neutral shell keeps restored light mode from flashing a dark workspace.
  // No browser globals are read during server rendering or initial hydration.
  return <Context.Provider value={{ mode, colors, common, toggle, persistenceError }}>
    {ready ? children : <View accessibilityLabel="Opening your workspace" style={{ flex: 1, backgroundColor: palettes.dark.bg }} />}
  </Context.Provider>;
}

export function useTheme() {
  const context = useContext(Context);
  if (!context) throw new Error('useTheme requires ThemeProvider');
  return context;
}
export function useStyles<T>(factory: (colors: Colors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [colors, factory]);
}
