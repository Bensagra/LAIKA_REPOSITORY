import React, { createContext, useContext, useState } from 'react';

export interface MisionActiva {
  id: number;
  nombre: string;
  operador: string;
  ubicacion: string;
  /** Date.now() when the mission started; drives the mission timer. */
  startedAt: number;
  /** Recording on the robot server (camera/thermal/LiDAR), if it could start. */
  serverMissionId?: string | null;
}

interface AppSettings {
  joystickEnabled: boolean;
  setJoystickEnabled: (v: boolean) => void;
  /** 0–100. Stored only; nothing uses it yet. */
  volume: number;
  setVolume: (v: number) => void;
  loggedUser: string | null;
  setLoggedUser: (v: string | null) => void;
  misionActiva: MisionActiva | null;
  setMisionActiva: (v: MisionActiva | null) => void;
  robotSpeed: number;
  setRobotSpeed: (v: number) => void;
  videoResolution: number;
  lidarMaxPoints: number;
}

const AppSettingsContext = createContext<AppSettings>({
  joystickEnabled: true,
  setJoystickEnabled: () => {},
  volume: 35,
  setVolume: () => {},
  loggedUser: null,
  setLoggedUser: () => {},
  misionActiva: null,
  setMisionActiva: () => {},
  robotSpeed: 50,
  setRobotSpeed: () => {},
  videoResolution: 640,
  lidarMaxPoints: 30000,
});

// Video/LiDAR resolution have no UI in the new design: fixed values.
const VIDEO_RESOLUTION = 640;
const LIDAR_MAX_POINTS = 30000;

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [joystickEnabled, setJoystickEnabled] = useState(true);
  const [volume, setVolume] = useState(35);
  const [loggedUser, setLoggedUser] = useState<string | null>(null);
  const [misionActiva, setMisionActiva] = useState<MisionActiva | null>(null);
  const [robotSpeed, setRobotSpeed] = useState(50);
  return (
    <AppSettingsContext.Provider value={{
      joystickEnabled, setJoystickEnabled,
      volume, setVolume,
      loggedUser, setLoggedUser,
      misionActiva, setMisionActiva,
      robotSpeed, setRobotSpeed,
      videoResolution: VIDEO_RESOLUTION,
      lidarMaxPoints: LIDAR_MAX_POINTS,
    }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export const useAppSettings = () => useContext(AppSettingsContext);
