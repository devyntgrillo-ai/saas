import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system';

let activeRecording: Audio.Recording | null = null;

export async function requestMicPermission(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync();
  return status === 'granted';
}

export async function startRecording(): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });

  const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  activeRecording = recording;
}

export async function pauseRecording(): Promise<void> {
  if (!activeRecording) return;
  try {
    await activeRecording.pauseAsync();
  } catch {
    /* pause may not be supported on all platforms */
  }
}

export async function resumeRecording(): Promise<void> {
  if (!activeRecording) return;
  try {
    await activeRecording.startAsync();
  } catch {
    /* no-op */
  }
}

async function uriToArrayBuffer(uri: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const info = Paths.info(uri);
  if (!info.exists) throw new Error('Recording file missing');

  const buffer = await new File(uri).arrayBuffer();
  if (!buffer.byteLength) throw new Error('Recording file is empty');

  return { buffer, contentType: 'audio/mp4' };
}

export async function stopRecording(): Promise<{ uri: string; buffer: ArrayBuffer; contentType: string }> {
  if (!activeRecording) throw new Error('No active recording');

  await activeRecording.stopAndUnloadAsync();
  const uri = activeRecording.getURI();
  activeRecording = null;

  if (!uri) throw new Error('Recording file missing');

  const { buffer, contentType } = await uriToArrayBuffer(uri);
  return { uri, buffer, contentType };
}

export async function cancelRecording(): Promise<void> {
  if (!activeRecording) return;
  try {
    await activeRecording.stopAndUnloadAsync();
  } catch {
    /* ignore */
  }
  activeRecording = null;
}
