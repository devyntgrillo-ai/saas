import { Redirect } from 'expo-router';

export default function GuestIndex() {
  return <Redirect href="/(guest)/login" />;
}
