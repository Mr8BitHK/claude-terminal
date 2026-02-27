import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';
import fs from 'node:fs';

const config: ForgeConfig = {
  packagerConfig: {
    // Disable asar so native modules (node-pty) can load their binaries directly.
    asar: false,
    afterCopy: [
      // The Vite plugin only packages Vite build output, not node_modules.
      // Native modules like node-pty must be copied manually.
      // Uses callback style because electron-packager promisifies async functions,
      // which double-wraps Promises and causes a silent hang.
      (buildPath: string, _electronVersion: string, _platform: string, _arch: string, callback: (err?: Error) => void) => {
        // 1. Copy node-pty native module (not bundled by Vite).
        const ptySrc = path.join(__dirname, 'node_modules', 'node-pty');
        const ptyDest = path.join(buildPath, 'node_modules', 'node-pty');

        // 2. Copy renderer build output. The Vite plugin builds the renderer
        //    under src/renderer/.vite/ (because vite.renderer.config has root:
        //    './src/renderer'), but electron-packager only copies .vite/ from
        //    the project root which only has main+preload.
        const rendererSrc = path.join(__dirname, 'src', 'renderer', '.vite', 'renderer');
        const rendererDest = path.join(buildPath, '.vite', 'renderer');

        fs.cp(ptySrc, ptyDest, { recursive: true }, (err) => {
          if (err) return callback(err);
          fs.cp(rendererSrc, rendererDest, { recursive: true }, (err2) => {
            if (err2) return callback(err2);
            callback();
          });
        });
      },
    ],
  },
  rebuildConfig: {
    // node-pty ships with N-API prebuilds that work across Node.js and Electron.
    // Skip rebuilding to avoid requiring Spectre-mitigated MSVC libraries.
    ignoreModules: ['node-pty'],
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mjs',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // Disabled: no asar archive when native modules need direct filesystem access
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
