"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

type TwinPersonSelection = Readonly<{
  subjectId?: string;
  demoPersonRef?: string;
  onSubjectChange: (id: string) => void;
  onDemoPersonChange: (ref: string) => void;
}>;

const TwinPersonContext = createContext<TwinPersonSelection | null>(null);

export const TwinPersonProvider = ({ children }: Readonly<{ children: ReactNode }>) => {
  // The shared layout keeps the selection across tabs without putting IDs in URLs or storage.
  const [subjectId, onSubjectChange] = useState<string>();
  const [demoPersonRef, onDemoPersonChange] = useState<string>();
  return (
    <TwinPersonContext.Provider
      value={{ subjectId, demoPersonRef, onSubjectChange, onDemoPersonChange }}
    >
      {children}
    </TwinPersonContext.Provider>
  );
};

export const useTwinPerson = () => useContext(TwinPersonContext);
