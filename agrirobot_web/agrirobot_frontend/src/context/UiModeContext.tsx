import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * Modes de l'interface. Le layout reste identique (AppBar + sidebar + carte),
 * seul le contenu de la sidebar gauche change selon le mode actif.
 */
export type UiMode = 'dashboard' | 'planning' | 'zones';

interface UiModeContextValue {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
  /** Revient au mode précédent (dashboard par défaut). */
  goBack: () => void;
}

const UiModeContext = createContext<UiModeContextValue | null>(null);

export const UiModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<UiMode>('dashboard');
  const previousRef = useRef<UiMode | null>(null);

  const setMode = useCallback((next: UiMode) => {
    setModeState(current => {
      if (next !== current) previousRef.current = current;
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    setModeState(current => {
      const target =
        previousRef.current && previousRef.current !== current
          ? previousRef.current
          : 'dashboard';
      previousRef.current = null;
      return target;
    });
  }, []);

  return (
    <UiModeContext.Provider value={{ mode, setMode, goBack }}>
      {children}
    </UiModeContext.Provider>
  );
};

export function useUiMode(): UiModeContextValue {
  const ctx = useContext(UiModeContext);
  if (!ctx) {
    throw new Error("useUiMode doit être utilisé à l'intérieur d'un UiModeProvider");
  }
  return ctx;
}
