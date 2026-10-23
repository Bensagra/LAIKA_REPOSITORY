import 'react-native-url-polyfill/auto'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Faltan EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_KEY en MiApp/.env')
}

// AsyncStorage (not the bare `localStorage` global expo-sqlite used to
// polyfill): on native, that global is installed asynchronously, and
// supabase-js awaits its first storage read before any auth call — if that
// read never resolves, every login/signup call queues behind it forever
// with no error, which matches "I tap the button and nothing happens".
// AsyncStorage is Supabase's own documented RN adapter and is already used
// elsewhere in this app on both web and native.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
})