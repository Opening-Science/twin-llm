"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * Lets anything in the shell open the search box: the sidebar's Search row,
 * and later other entry points. Without a provider it does nothing, so a
 * component rendered outside the shell (a test, a story) does not crash.
 */
const SearchContext = createContext<() => void>(() => {});

export const SearchOpener = ({
  open,
  children,
}: Readonly<{ open: () => void; children: ReactNode }>) => (
  <SearchContext.Provider value={open}>{children}</SearchContext.Provider>
);

export const useOpenSearch = (): (() => void) => useContext(SearchContext);
