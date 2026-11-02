const { withAndroidManifest } = require('@expo/config-plugins');

// react-native-record-screen (Android/HBRecorder) needs these two permissions
// declared manually — see its README. RECORD_AUDIO is already requested via
// app.json's android.permissions.
function addPermission(androidManifest, name) {
  const perms = androidManifest.manifest['uses-permission'] ?? [];
  if (!perms.some((p) => p.$['android:name'] === name)) {
    perms.push({ $: { 'android:name': name } });
  }
  androidManifest.manifest['uses-permission'] = perms;
}

module.exports = function withScreenRecordPermissions(config) {
  return withAndroidManifest(config, (config) => {
    addPermission(config.modResults, 'android.permission.FOREGROUND_SERVICE');
    addPermission(config.modResults, 'android.permission.WRITE_EXTERNAL_STORAGE');
    return config;
  });
};
