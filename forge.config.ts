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

/** Recursively delete files matching a test from a directory. */
function pruneFiles(dir: string, test: (name: string) => boolean): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneFiles(full, test);
    } else if (test(entry.name)) {
      fs.unlinkSync(full);
    }
  }
}

const junkPattern = /\.(map|md|ts)$|^(LICENSE|LICENCE|CHANGELOG|CHANGES|HISTORY|AUTHORS|CONTRIBUTORS|README)(\..*)?$/i;

const config: ForgeConfig = {
  packagerConfig: {
    icon: './assets/icon',
    asar: {
      unpack: '{**/node-pty/**/*.node,**/node-pty/**/spawn-helper*,**/node-pty/**/winpty*,**/node-pty/**/conpty*}',
    },
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

        // 3. Copy hook scripts so the packaged app can find them at
        //    process.resourcesPath/hooks/.
        const hooksSrc = path.join(__dirname, 'src', 'hooks');
        const hooksDest = path.join(buildPath, '..', 'hooks');

        // 4. Strip unused Chromium locales (keep only en-US) — saves ~44 MB.
        //    buildPath is resources/app, locales are at the top level next to resources.
        const localesDir = path.join(buildPath, '..', '..', 'locales');

        fs.cp(ptySrc, ptyDest, { recursive: true }, (err) => {
          if (err) return callback(err);
          // Strip junk files from copied node-pty
          pruneFiles(ptyDest, (name) => junkPattern.test(name));
          // Strip prebuilds for other platforms (keeps only current platform+arch)
          const prebuildsDir = path.join(ptyDest, 'prebuilds');
          const keepDir = `${_platform}-${_arch}`;
          if (fs.existsSync(prebuildsDir)) {
            for (const dir of fs.readdirSync(prebuildsDir)) {
              if (dir !== keepDir) {
                fs.rmSync(path.join(prebuildsDir, dir), { recursive: true });
              }
            }
          }
          fs.cp(rendererSrc, rendererDest, { recursive: true }, (err2) => {
            if (err2) return callback(err2);
            fs.cp(hooksSrc, hooksDest, { recursive: true }, (err3) => {
              if (err3) return callback(err3);
              // 5. Copy web client build output for remote access.
              const webClientSrc = path.join(__dirname, 'dist', 'web-client');
              const webClientDest = path.join(buildPath, '..', 'web-client');
              const copyWebClient = (next: () => void) => {
                if (fs.existsSync(webClientSrc)) {
                  fs.cp(webClientSrc, webClientDest, { recursive: true }, (err4) => {
                    if (err4) return callback(err4);
                    next();
                  });
                } else {
                  next(); // web client not built — skip (remote access won't work)
                }
              };
              copyWebClient(() => {
              // Strip locales
              try {
                if (fs.existsSync(localesDir)) {
                  for (const file of fs.readdirSync(localesDir)) {
                    if (file !== 'en-US.pak') {
                      fs.unlinkSync(path.join(localesDir, file));
                    }
                  }
                }
              } catch (e) {
                // Non-fatal: locale stripping is an optimization, not a requirement
              }
              callback();
              }); // copyWebClient
            });
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
    new MakerSquirrel({
      name: 'ClaudeTerminal',
      exe: 'ClaudeTerminal.exe',
      setupExe: 'ClaudeTerminalSetup.exe',
      setupIcon: './assets/icon.ico',
      loadingGif: './assets/installer.gif',
      description: 'A Windows Terminal-like app for managing multiple Claude Code instances in tabs',
      authors: 'Yaron Guan Golan',
      noMsi: true,
    }),
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
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
