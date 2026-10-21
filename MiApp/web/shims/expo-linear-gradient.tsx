import React from 'react';
import { View, ViewProps } from 'react-native';

// Minimal web stand-in for expo-linear-gradient (its real package pulls in a
// native module that Vite can't bundle for the browser). app/index.tsx only
// ever renders this on native — on web it draws the same gradient with a
// plain CSS background instead — so this just needs to not crash if it's
// ever mounted; it still renders a real CSS gradient to be safe.
type Point = { x: number; y: number };

interface LinearGradientProps extends ViewProps {
  colors: string[];
  locations?: number[] | null;
  start?: Point | null;
  end?: Point | null;
}

export function LinearGradient({ colors, locations, start, end, style, ...rest }: LinearGradientProps) {
  const angle = start && end
    ? Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI) + 90
    : 180;
  const stops = colors
    .map((color, i) => {
      const pct = locations?.[i] != null ? locations[i] * 100 : (i / Math.max(colors.length - 1, 1)) * 100;
      return `${color} ${pct}%`;
    })
    .join(', ');
  const background = `linear-gradient(${angle}deg, ${stops})`;
  return (
    <View
      {...rest}
      style={[style, { backgroundImage: background } as any]}
    />
  );
}

export default LinearGradient;
