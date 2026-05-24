import { createContext, useContext, useState, useEffect, ReactNode, Dispatch, SetStateAction, FC } from 'react';
import { get, set } from 'idb-keyval';
import { ProjectState } from '../types';

interface AppContextType {
  state: ProjectState;
  setState: Dispatch<SetStateAction<ProjectState>>;
  dirHandle: FileSystemDirectoryHandle | null;
  setDirHandle: Dispatch<SetStateAction<FileSystemDirectoryHandle | null>>;
  saveState: (newState: ProjectState) => Promise<void>;
}

const defaultState: ProjectState = {
  settings: { startNumber: 1, endNumber: 40, absentNumbers: [] },
  questions: [],
  cropSettings: { nameRect: null, questionRects: {}, totalScoreRect: null, aspectScoreRects: {} },
  studentScores: [],
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ProjectState>(defaultState);
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Load state from IndexedDB on mount
    const loadState = async () => {
      try {
        const savedState = await get<ProjectState>('appState');
        if (savedState) {
          setState(savedState);
        }
      } catch (err) {
        console.error('Failed to load state from idb:', err);
      } finally {
        setIsLoaded(true);
      }
    };
    loadState();
  }, []);

  const saveState = async (newState: ProjectState) => {
    setState(newState);
    await set('appState', newState);
  };

  if (!isLoaded) return <div>Loading state...</div>;

  return (
    <AppContext.Provider value={{ state, setState, dirHandle, setDirHandle, saveState }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
