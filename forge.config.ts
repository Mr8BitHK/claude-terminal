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

/** Copy a native module into the build, strip junk files and cross-platform prebuilds. */
function copyNativeModule(
  moduleName: string,
  buildPath: string,
  platform: string,
  arch: string,
  cb: (err?: Error) => void,
): void {
  const src = path.join(__dirname, 'node_modules', moduleName);
  const dest = path.join(buildPath, 'node_modules', moduleName);
  fs.cp(src, dest, { recursive: true }, (err) => {
    if (err) return cb(err);
    pruneFiles(dest, (name) => junkPattern.test(name));
    const prebuildsDir = path.join(dest, 'prebuilds');
    const keepDir = `${platform}-${arch}`;
    if (fs.existsSync(prebuildsDir)) {
      for (const dir of fs.readdirSync(prebuildsDir)) {
        if (dir !== keepDir) {
          fs.rmSync(path.join(prebuildsDir, dir), { recursive: true });
        }
      }
    }
    cb();
  });
}

const junkPattern = /\.(map|md|ts)$|^(LICENSE|LICENCE|CHANGELOG|CHANGES|HISTORY|AUTHORS|CONTRIBUTORS|README)(\..*)?$/i;

const config: ForgeConfig = {
  packagerConfig: {
    // Linux deb/rpm makers require lowercase executable name matching the package name.
    // Windows Squirrel requires it to match productName, so only set on Linux.
    ...(process.platform === 'linux' ? { executableName: 'claude-terminal' } : {}),
    icon: './assets/icon',
    asar: {
      unpack: '{**/node-pty/**/*.node,**/node-pty/**/spawn-helper*,**/node-pty/**/winpty*,**/node-pty/**/conpty*,**/bufferutil/**/*.node,**/utf-8-validate/**/*.node,**/cloudflared/bin/**}',
    },
    afterCopy: [
      // The Vite plugin only packages Vite build output, not node_modules.
      // Native modules like node-pty must be copied manually.
      // Uses callback style because electron-packager promisifies async functions,
      // which double-wraps Promises and causes a silent hang.
      (buildPath: string, _electronVersion: string, _platform: string, _arch: string, callback: (err?: Error) => void) => {
        // Helper to run a series of (cb) => void steps sequentially.
        const sequential = (steps: Array<(cb: (err?: Error) => void) => void>, done: (err?: Error) => void) => {
          const next = (i: number) => {
            if (i >= steps.length) return done();
            steps[i]((err) => { if (err) return done(err); next(i + 1); });
          };
          next(0);
        };

        const rendererSrc = path.join(__dirname, 'src', 'renderer', '.vite', 'renderer');
        const rendererDest = path.join(buildPath, '.vite', 'renderer');
        const hooksSrc = path.join(__dirname, 'src', 'hooks');
        const hooksDest = path.join(buildPath, '..', 'hooks');
        const localesDir = path.join(buildPath, '..', '..', 'locales');
        const cfSrc = path.join(__dirname, 'node_modules', 'cloudflared');
        const cfDest = path.join(buildPath, 'node_modules', 'cloudflared');
        const webClientSrc = path.join(__dirname, 'dist', 'web-client');
        const webClientDest = path.join(buildPath, '..', 'web-client');

        sequential([
          // 1. Copy native modules (node-pty, bufferutil, utf-8-validate).
          (cb) => copyNativeModule('node-pty', buildPath, _platform, _arch, cb),
          (cb) => copyNativeModule('bufferutil', buildPath, _platform, _arch, cb),
          (cb) => copyNativeModule('utf-8-validate', buildPath, _platform, _arch, cb),
          // 2. Copy cloudflared package.
          (cb) => fs.cp(cfSrc, cfDest, { recursive: true }, (err) => {
            if (err) return cb(err);
            pruneFiles(cfDest, (name) => junkPattern.test(name));
            cb();
          }),
          // 3. Copy renderer build output.
          (cb) => fs.cp(rendererSrc, rendererDest, { recursive: true }, cb),
          // 4. Copy hook scripts.
          (cb) => fs.cp(hooksSrc, hooksDest, { recursive: true }, cb),
          // 5. Copy web client build output for remote access.
          (cb) => {
            if (fs.existsSync(webClientSrc)) {
              fs.cp(webClientSrc, webClientDest, { recursive: true }, cb);
            } else {
              cb(); // web client not built — skip
            }
          },
          // 6. Strip unused Chromium locales (keep only en-US) — saves ~44 MB.
          (cb) => {
            try {
              if (fs.existsSync(localesDir)) {
                for (const file of fs.readdirSync(localesDir)) {
                  if (file !== 'en-US.pak') {
                    fs.unlinkSync(path.join(localesDir, file));
                  }
                }
              }
            } catch (e) {
              // Non-fatal: locale stripping is an optimization
            }
            cb();
          },
        ], callback);
      },
    ],
  },
  rebuildConfig: {
    // node-pty ships with N-API prebuilds that work across Node.js and Electron.
    // Skip rebuilding to avoid requiring Spectre-mitigated MSVC libraries.
    ignoreModules: ['node-pty', 'bufferutil', 'utf-8-validate'],
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
