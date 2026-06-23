export async function requestMediaLibraryPermissionsAsync() {
  return { status: 'granted' };
}

export async function launchImageLibraryAsync() {
  return { canceled: true, assets: [] };
}
