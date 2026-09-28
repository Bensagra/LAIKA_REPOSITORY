import React, { createContext, useContext, useState } from 'react';

interface MisionActiva {
  id: number;
  nombre: string;
}

interface AppSettings {
  joystickEnabled: boolean;
  setJoystickEnabled: (v: boolean) => void;
  loggedUser: string | null;
  setLoggedUser: (v: string | null) => void;
  misionActiva: MisionActiva | null;
  setMisionActiva: (v: MisionActiva | null) => void;
  robotSpeed: number;
  setRobotSpeed: (v: number) => void;
  videoResolution: number;
  setVideoResolution: (v: number) => void;
  lidarMaxPoints: number;
  setLidarMaxPoints: (v: number) => void;
}

const AppSettingsContext = createContext<AppSettings>({
  joystickEnabled: true,
  setJoystickEnabled: () => {},
  loggedUser: null,
  setLoggedUser: () => {},
  misionActiva: null,
  setMisionActiva: () => {},
  robotSpeed: 50,
  setRobotSpeed: () => {},
  videoResolution: 640,
  setVideoResolution: () => {},
  lidarMaxPoints: 30000,
  setLidarMaxPoints: () => {},
});

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [joystickEnabled, setJoystickEnabled] = useState(true);
  const [loggedUser, setLoggedUser] = useState<string | null>(null);
  const [misionActiva, setMisionActiva] = useState<MisionActiva | null>(null);
  const [robotSpeed, setRobotSpeed] = useState(50);
  const [videoResolution, setVideoResolution] = useState(640);
  const [lidarMaxPoints, setLidarMaxPoints] = useState(30000);
  return (
    <AppSettingsContext.Provider value={{
      joystickEnabled, setJoystickEnabled,
      loggedUser, setLoggedUser,
      misionActiva, setMisionActiva,
      robotSpeed, setRobotSpeed,
      videoResolution, setVideoResolution,
      lidarMaxPoints, setLidarMaxPoints,
    }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export const useAppSettings = () => useContext(AppSettingsContext);
