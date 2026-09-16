import React, { createContext, useContext, useState } from 'react';

/**
 * Modes de l'interface. Le layout reste identique (AppBar + sidebar + carte),
 * seul le contenu de la sidebar gauche change selon le mode actif.
 */
export type UiMode = 'dashboard' | 'planning' | 'zones';

interface UiModeContextValue {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
}

const UiModeContext = createContext<UiModeContextValue | null>(null);

export const UiModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<UiMode>('dashboard');

  return (
    <UiModeContext.Provider value={{ mode, setMode }}>
      {children}
    </UiModeContext.Provider>
  );
};

export function useUiMode(): UiModeContextValue {
  const ctx = useContext(UiModeContext);
  if (!ctx) {
    throw new Error('useUiMode doit être utilisé à l\'intérieur d\'un UiModeProvider');
  }
  return ctx;
}
