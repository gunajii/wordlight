// Loads the bundled Noto Sans Devanagari (OFL) with Vega's expo-font. If the package could not be
// installed, setup.sh replaces this file with fonts.fallback.ts and the system font is used.
import { useFonts } from '@amazon-devices/expo-font';

export function useDevanagariFont(): boolean {
  const [loaded] = useFonts({
    'NotoSansDevanagari-Regular': require('../assets/fonts/NotoSansDevanagari-Regular.ttf'),
  });
  return !!loaded;
}
