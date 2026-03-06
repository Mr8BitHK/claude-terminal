import { createContext, useContext } from 'react';
import type { ShellOption } from '@shared/platform';

export const ShellContext = createContext<ShellOption[]>([]);
export const useShellOptions = () => useContext(ShellContext);
