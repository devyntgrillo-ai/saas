// Native (Capacitor) microphone recording. On iOS/Android this routes through
// the platform's native AVAudioRecorder / MediaRecorder via the
// `capacitor-voice-recorder` plugin instead of the browser MediaRecorder API
// (which is unreliable inside WKWebView). On web, isNative() is false and the
// caller keeps using the existing getUserMedia + MediaRecorder path.
import { Capacitor } from '@capacitor/core'

export const isNative = () => Capacitor.isNativePlatform()

// Lazily import the plugin so the web bundle never loads native code and the
// dynamic chunk is only fetched on a real device.
let _plugin
async function recorder() {
  if (!_plugin) {
    const mod = await import('capacitor-voice-recorder')
    _plugin = mod.VoiceRecorder
  }
  return _plugin
}

// True if the device can record at all (mic present, not already in use).
export async function nativeCanRecord() {
  try {
    const VoiceRecorder = await recorder()
    const { value } = await VoiceRecorder.canDeviceVoiceRecord()
    return Boolean(value)
  } catch {
    return false
  }
}

// Prompt for / confirm microphone permission. Returns true when granted.
export async function nativeRequestPermission() {
  const VoiceRecorder = await recorder()
  try {
    const cur = await VoiceRecorder.hasAudioRecordingPermission()
    if (cur?.value) return true
  } catch {
    /* hasAudioRecordingPermission can throw before first request - fall through */
  }
  const { value } = await VoiceRecorder.requestAudioRecordingPermission()
  return Boolean(value)
}

export async function nativeStart() {
  const VoiceRecorder = await recorder()
  await VoiceRecorder.startRecording()
}

export async function nativePause() {
  try { await (await recorder()).pauseRecording() } catch { /* not all OS versions support pause */ }
}

export async function nativeResume() {
  try { await (await recorder()).resumeRecording() } catch { /* no-op */ }
}

// Stops recording and returns the audio as a Blob ready for the upload pipeline.
// The plugin yields base64 (typically audio/aac in an m4a container on iOS).
export async function nativeStopToBlob() {
  const VoiceRecorder = await recorder()
  const { value } = await VoiceRecorder.stopRecording()
  const mimeType = value?.mimeType || 'audio/aac'
  return base64ToBlob(value?.recordDataBase64 || '', mimeType)
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}
