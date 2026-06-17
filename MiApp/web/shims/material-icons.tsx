import React from 'react';
import { Text } from 'react-native';

const symbols: Record<string, string> = {
  'arrow-drop-down': 'v',
  close: 'x',
  lock: 'LOCK',
  'lock-open': 'OPEN',
  person: 'USER',
};

type Props = {
  name: string;
  size?: number;
  color?: string;
};

export default function MaterialIcons({ name, size = 18, color = '#fff' }: Props) {
  return (
    <Text style={{ color, fontSize: Math.max(10, size * 0.65), fontFamily: 'monospace' }}>
      {symbols[name] ?? name}
    </Text>
  );
}
