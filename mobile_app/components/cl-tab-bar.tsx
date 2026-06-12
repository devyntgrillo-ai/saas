import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, ClipboardList, Inbox, LayoutGrid, Mic } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useAppColors } from '@/lib/color-scheme-context';

const TAB_CONFIG: Record<string, { label: string; Icon: typeof Home }> = {
  index: { label: 'Home', Icon: Home },
  consults: { label: 'Consults', Icon: ClipboardList },
  record: { label: 'Record', Icon: Mic },
  inbox: { label: 'Inbox', Icon: Inbox },
  more: { label: 'More', Icon: LayoutGrid },
};

function hideTabBarForRoute(routeName: string, nestedState: { routes: { name: string }[]; index: number } | undefined) {
  if (routeName === 'inbox' && nestedState?.routes[nestedState.index]?.name === '[id]') {
    return true;
  }
  return false;
}

export function CLTabBar({ state, navigation }: BottomTabBarProps) {
  const c = useAppColors();
  const insets = useSafeAreaInsets();

  const hideTabBar = state.routes.some((route) =>
    hideTabBarForRoute(route.name, route.state as { routes: { name: string }[]; index: number } | undefined),
  );

  if (hideTabBar) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: c.surface,
        borderTopWidth: 1,
        borderTopColor: c.border,
        paddingBottom: Math.max(insets.bottom, 8),
        paddingTop: 10,
        paddingHorizontal: 8,
      }}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const config = TAB_CONFIG[route.name];
        if (!config) return null;

        const { label, Icon } = config;
        const isRecord = route.name === 'record';

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        if (isRecord) {
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel="Record consult"
              style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2 }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  backgroundColor: c.record,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: -18,
                  shadowColor: c.shadow,
                  shadowOpacity: 1,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 4,
                }}>
                <Icon size={24} color="#FFFFFF" strokeWidth={2.5} />
              </View>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '600',
                  color: focused ? c.record : c.tabInactive,
                  marginTop: 4,
                }}>
                {label}
              </Text>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Icon size={22} color={focused ? c.tabActive : c.tabInactive} strokeWidth={focused ? 2.5 : 2} />
            <Text
              style={{
                fontSize: 11,
                fontWeight: focused ? '600' : '500',
                color: focused ? c.tabActive : c.tabInactive,
              }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
