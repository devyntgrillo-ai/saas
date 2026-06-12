import { Tabs } from 'expo-router';
import { CLTabBar } from '@/components/cl-tab-bar';

export default function TabLayout() {
  return (
    <Tabs tabBar={(props) => <CLTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="consults" options={{ title: 'Consults' }} />
      <Tabs.Screen name="record" options={{ title: 'Record' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
