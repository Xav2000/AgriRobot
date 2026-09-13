import React, { createContext, useContext, useMemo, useState, PropsWithChildren } from 'react';
import { PaletteMode } from '@mui/material';

interface ColorModeContextValue {
  mode: PaletteMode;
  toggleColorMode: () => void;
}

export const ColorModeContext = createContext<ColorModeContextValue>({
  mode: 'light',
  toggleColorMode: () => {},
});

export const ColorModeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [mode, setMode] = useState<PaletteMode>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem('agrirobot-color-mode');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const value = useMemo<ColorModeContextValue>(
    () => ({
      mode,
      toggleColorMode: () =>
        setMode((prev) => {
          const next = prev === 'light' ? 'dark' : 'light';
          window.localStorage.setItem('agrirobot-color-mode', next);
          return next;
        }),
    }),
    [mode],
  );

  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
};

export const useColorMode = () => useContext(ColorModeContext);
