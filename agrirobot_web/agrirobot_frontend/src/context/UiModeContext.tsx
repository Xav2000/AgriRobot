import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * Modes de l'interface. Le layout reste identique (AppBar + sidebar + carte),
 * seul le contenu de la sidebar gauche change selon le mode actif.
 * 'worklines' : paramètres de génération des lignes de guidage (étape 6.2).
 * 'corridors' : dessin/édition des chemins de liaison (étape 6.6).
 * 'settings' : réglages du robot (étape 6.10b).
 */
export type UiMode = 'dashboard' | 'planning' | 'zones' | 'corridors' | 'worklines' | 'settings';

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
