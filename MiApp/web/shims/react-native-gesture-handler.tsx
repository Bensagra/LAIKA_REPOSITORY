import React from 'react';
import { View } from 'react-native';

export enum State {
  UNDETERMINED = 0,
  FAILED = 1,
  BEGAN = 2,
  CANCELLED = 3,
  ACTIVE = 4,
  END = 5,
}

type HandlerProps = {
  children?: React.ReactNode;
  onHandlerStateChange?: (event: unknown) => void;
  onGestureEvent?: (event: unknown) => void;
};

export type PanGestureHandlerStateChangeEvent = {
  nativeEvent: {
    state: State;
    translationX: number;
    translationY: number;
    absoluteX: number;
  };
};

export function GestureHandlerRootView({ children, ...props }: HandlerProps) {
  return <View {...props}>{children}</View>;
}

export function PanGestureHandler({ children }: HandlerProps) {
  return <>{children}</>;
}
