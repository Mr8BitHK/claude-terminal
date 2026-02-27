import '@testing-library/jest-dom';

vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), quit: vi.fn() },
  BrowserWindow: vi.fn(),
  Notification: vi.fn(),
}));
