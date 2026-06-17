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
}

const AppSettingsContext = createContext<AppSettings>({
  joystickEnabled: true,
  setJoystickEnabled: () => {},
  loggedUser: null,
  setLoggedUser: () => {},
  misionActiva: null,
  setMisionActiva: () => {},
});

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [joystickEnabled, setJoystickEnabled] = useState(true);
  const [loggedUser, setLoggedUser] = useState<string | null>(null);
  const [misionActiva, setMisionActiva] = useState<MisionActiva | null>(null);
  return (
    <AppSettingsContext.Provider value={{ joystickEnabled, setJoystickEnabled, loggedUser, setLoggedUser, misionActiva, setMisionActiva }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export const useAppSettings = () => useContext(AppSettingsContext);
