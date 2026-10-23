// Web never reaches this (services/go2Talk.ts only calls into
// services/nativeTalkAudio.ts, which only uses this, on Platform.OS !==
// 'web'); this stub exists purely so the real native-module package
// (which builds a NativeEventEmitter at import time — a side effect that
// can throw under react-native-web) never gets bundled for the browser.
const LiveAudioStream = {
  init: () => {},
  start: () => {},
  stop: async () => '',
  on: () => ({ remove: () => {} }),
};

export default LiveAudioStream;
