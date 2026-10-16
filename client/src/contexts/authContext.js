import { createContext, useContext } from 'react';

/**
 * The auth context and its hook, kept apart from the provider component.
 *
 * Not organisational fussiness: a module that exports both a component and a plain
 * value cannot be hot-reloaded reliably, so React Fast Refresh gives up on the whole
 * file. Splitting them means editing the provider reloads in place instead of
 * remounting the tree — and remounting the tree signs you out mid-edit.
 */
export const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}
