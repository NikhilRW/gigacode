import { useRef, useState, type ReactNode } from 'react';
import { Link, usePathname, type Href } from 'expo-router';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { describeError } from '@/lib/client';
import { font, radius } from '@/theme';
import { Brand, Button, Icon, Notice, ThemeToggle, type IconName } from './ui';

const SIDEBAR_WIDTH = 232;
const SIDEBAR_BREAKPOINT = 900;

export function useContentWidth() {
  const { width } = useWindowDimensions();
  return width >= SIDEBAR_BREAKPOINT ? width - SIDEBAR_WIDTH : width;
}

type NavItem = { label: string; href: Href; icon: IconName };

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const auth = useAuth();
  const { colors, common } = useTheme();
  const pathname = usePathname();
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [focusedHref, setFocusedHref] = useState<Href | null>(null);
  const [pressedHref, setPressedHref] = useState<Href | null>(null);
  const [hoveredHref, setHoveredHref] = useState<Href | null>(null);
  const workspace: NavItem[] = [{ label: 'Workspace', href: '/', icon: 'terminal' }];
  const configure: NavItem[] = [{ label: 'Connection', href: '/connection', icon: 'server' }];
  if (auth.signedIn) {
    workspace.push(
      { label: 'Dashboard', href: '/dashboard', icon: 'grid' },
      { label: 'History', href: '/history', icon: 'list' },
    );
    configure.unshift({ label: 'API keys', href: '/keys', icon: 'key' });
  }
  const account: NavItem[] = auth.signedIn
    ? [{ label: 'Account', href: '/account', icon: 'user' }]
    : [
        { label: 'Sign in', href: '/login', icon: 'log-in' },
        { label: 'Create account', href: '/signup', icon: 'user-plus' },
      ];
  const groups = [
    { label: 'Workspace', items: workspace },
    { label: 'Configure', items: configure },
    { label: 'Account', items: account },
  ];
  if (auth.me?.user.role === 'platform_admin') {
    groups.push({ label: 'Admin', items: [{ label: 'Platform admin', href: '/admin', icon: 'shield' }] });
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 16 }}
    >
      <View style={{ gap: 2, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Brand onPress={onNavigate} />
          {onNavigate && (
            <Button label="Close navigation" icon="x" iconOnly variant="ghost" onPress={onNavigate} />
          )}
        </View>
        <Text numberOfLines={1} style={[common.muted, { fontSize: 12, lineHeight: 18 }]}>
          {auth.me?.tenant.name || 'Your code playground'}
        </Text>
      </View>
      {groups.map((group) => (
        <View key={group.label} style={{ gap: 4 }}>
          <Text style={[common.eyebrow, { paddingHorizontal: 10, marginBottom: 2 }]}>
            {group.label.toUpperCase()}
          </Text>
          {group.items.map((item) => {
            const active = pathname === item.href || (item.href === '/history' && pathname === '/execution');
            return (
              <Link key={item.label} href={item.href} asChild>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: active }}
                  onPress={onNavigate}
                  onPressIn={() => setPressedHref(item.href)}
                  onPressOut={() => setPressedHref(null)}
                  onHoverIn={() => setHoveredHref(item.href)}
                  onHoverOut={() => setHoveredHref(null)}
                  onFocus={() => setFocusedHref(item.href)}
                  onBlur={() => setFocusedHref(null)}
                  // Link's asChild slot merges style objects; callbacks lose their layout styles.
                  style={{
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: radius,
                    backgroundColor: active || pressedHref === item.href || hoveredHref === item.href
                      ? colors.sidebarActive : 'transparent',
                    borderWidth: 1,
                    borderColor: focusedHref === item.href ? colors.ring : active ? colors.border : 'transparent',
                    outlineWidth: focusedHref === item.href ? 2 : 0,
                    outlineColor: colors.ring,
                    outlineOffset: 2,
                    boxShadow: active ? `0 1px 2px ${colors.shadow}` : undefined,
                  }}
                >
                  <View style={{ width: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={item.icon} color={active ? colors.text : colors.sidebarText} />
                  </View>
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: active ? colors.text : colors.sidebarText,
                      fontFamily: active ? font.medium : font.regular,
                      fontSize: 14,
                      lineHeight: 20,
                    }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      ))}
      <View
        style={{ marginTop: 'auto', paddingTop: 12, borderTopWidth: 1, borderColor: colors.border, gap: 8 }}
      >
        {auth.me && (
          <View style={{ gap: 4, paddingHorizontal: 10 }}>
            <Text numberOfLines={1} style={[common.text, { fontFamily: font.medium }]}>
              {auth.me.user.name || auth.me.user.email.split('@')[0]}
            </Text>
            <Text numberOfLines={2} style={common.muted}>
              {auth.me.user.email}
            </Text>
          </View>
        )}
        {auth.signedIn && (
          <Button
            label={signingOut ? 'Signing out…' : 'Sign out'}
            icon="log-out"
            variant="ghost"
            disabled={signingOut}
            onPress={() => {
              setSigningOut(true);
              setError('');
              void auth.logout()
                .then(onNavigate)
                .catch((err) => setError(describeError(err)))
                .finally(() => setSigningOut(false));
            }}
          />
        )}
        {!!error && <Notice>{error}</Notice>}
        <Text style={[common.muted, { paddingHorizontal: 10, fontSize: 11 }]}>
          Drafts stay on this device.
        </Text>
      </View>
    </ScrollView>
  );
}

/** Fixed shell only. Each screen owns exactly one main page ScrollView. */
export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const { colors, common } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= SIDEBAR_BREAKPOINT;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<View>(null);
  const closeMenu = () => {
    setMenuOpen(false);
    menuButton.current?.focus();
  };
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {wide && (
          <View
            style={{ width: SIDEBAR_WIDTH, backgroundColor: colors.sidebar, borderRightWidth: 1, borderColor: colors.border }}
          >
            <Navigation />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={{
              minHeight: 60,
              paddingHorizontal: wide ? 28 : 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              borderBottomWidth: 1,
              borderColor: colors.border,
            }}
          >
            {!wide && (
              <Pressable
                ref={menuButton}
                accessibilityRole="button"
                accessibilityLabel="Open navigation"
                accessibilityState={{ expanded: menuOpen }}
                onPress={() => setMenuOpen(true)}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="menu" size={20} color={colors.text} />
              </Pressable>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              {wide ? (
                <Text numberOfLines={1} style={[common.text, { fontFamily: font.medium }]}>{title}</Text>
              ) : <Brand />}
            </View>
            <ThemeToggle />
          </View>
          {children}
        </View>
      </View>
      <Modal visible={menuOpen && !wide} transparent animationType="fade" onRequestClose={closeMenu}>
        <View style={{ flex: 1, backgroundColor: colors.backdrop }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            onPress={closeMenu}
            style={{ position: 'absolute', inset: 0 }}
          />
          <SafeAreaView
            accessibilityViewIsModal
            onAccessibilityEscape={closeMenu}
            style={{
              flex: 1,
              width: Math.min(320, width - 28),
              backgroundColor: colors.sidebar,
              borderRightWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Navigation onNavigate={closeMenu} />
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
