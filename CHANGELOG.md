# Changelog

## [1.3.0](https://github.com/Mr8BitHK/claude-terminal/compare/v1.2.4...v1.3.0) (2026-03-01)

### Features

* check for updates on startup and show notification icon ([a5d0a2b](https://github.com/Mr8BitHK/claude-terminal/commit/a5d0a2b504d43c4f6315895c8e2ec17197ff44a4))

### Bug Fixes

* show alert dialog when creating worktree in non-git or empty repo ([d15c3b4](https://github.com/Mr8BitHK/claude-terminal/commit/d15c3b41b299b638d0a2a6bd3c4e806967f819af))

## [1.2.4](https://github.com/Mr8BitHK/claude-terminal/compare/v1.2.3...v1.2.4) (2026-03-01)

### Features

* show version number in window title bar ([a3229fa](https://github.com/Mr8BitHK/claude-terminal/commit/a3229fa))
* wire remote + button to create tabs and worktree tabs ([539ddc3](https://github.com/Mr8BitHK/claude-terminal/commit/539ddc3))
* forward worktree progress events to remote WS clients ([2d175f5](https://github.com/Mr8BitHK/claude-terminal/commit/2d175f5))

### Bug Fixes

* prevent garbled display and wrong dimensions on remote mobile client ([cb3b8e8](https://github.com/Mr8BitHK/claude-terminal/commit/cb3b8e8))
* spawn cloudflared binary directly instead of using npm package wrapper ([e55d431](https://github.com/Mr8BitHK/claude-terminal/commit/e55d431))
* position new-tab dropdown with fixed positioning in remote web client ([71f33b4](https://github.com/Mr8BitHK/claude-terminal/commit/71f33b4))
* set dark background color to prevent white flash on startup ([159927d](https://github.com/Mr8BitHK/claude-terminal/commit/159927d))

## [1.2.3](https://github.com/Mr8BitHK/claude-terminal/compare/v1.2.2...v1.2.3) (2026-03-01)

### Features

* add two-finger swipe scrollback for mobile remote access ([34c1d6c](https://github.com/Mr8BitHK/claude-terminal/commit/34c1d6c))

### Bug Fixes

* auto-retry cloudflared quick tunnel on transient UUID failures ([7b27408](https://github.com/Mr8BitHK/claude-terminal/commit/7b27408))
* disable tunnel Activate button with spinner while activating ([d51e4fd](https://github.com/Mr8BitHK/claude-terminal/commit/d51e4fd))
* use random port for remote tunnel to allow multiple instances ([92fa6a3](https://github.com/Mr8BitHK/claude-terminal/commit/92fa6a3))

## [1.2.2](https://github.com/Mr8BitHK/claude-terminal/compare/v1.2.1...v1.2.2) (2026-03-01)

### Bug Fixes

* add missing API stubs to ws-bridge for remote mobile client ([cd8968e](https://github.com/Mr8BitHK/claude-terminal/commit/cd8968e60a7d65984288a4dc2a79cc08828861e7))
* install cloudflared to writable userData path with download progress ([af329ed](https://github.com/Mr8BitHK/claude-terminal/commit/af329ed42cdeaf9a53ef8ffdd4b119490e1e44d3))
* surface tunnel errors in UI with retry instead of stuck connecting ([6f5c4b8](https://github.com/Mr8BitHK/claude-terminal/commit/6f5c4b84a6ca1896522827bbf1bfc250606b10e5))

## [1.2.1](https://github.com/Mr8BitHK/claude-terminal/compare/v1.2.0...v1.2.1) (2026-03-01)

### Bug Fixes

* set executableName only on Linux to avoid breaking Squirrel ([e70d4b9](https://github.com/Mr8BitHK/claude-terminal/commit/e70d4b964b47bb4262dfe42eefde9691260e5cd4))

## [1.2.0](https://github.com/Mr8BitHK/claude-terminal/compare/v1.1.0...v1.2.0) (2026-03-01)

### Features

* display hook execution status in StatusBar with auto-dismiss ([445c3a1](https://github.com/Mr8BitHK/claude-terminal/commit/445c3a1463643c042883e901498e6a2c65bcc9ac))

### Bug Fixes

* add executableName for Linux deb/rpm packaging ([4a4cfc9](https://github.com/Mr8BitHK/claude-terminal/commit/4a4cfc988befc636ba86d4a6ca57ac9375e5675f))
* emit worktree:created and tab:created hooks from tab:createWithWorktree ([0084df1](https://github.com/Mr8BitHK/claude-terminal/commit/0084df1d3df3164954c72fe5015448ae5623c973))
* emit worktree:removed hook when closing tab with removeWorktree ([63f3c49](https://github.com/Mr8BitHK/claude-terminal/commit/63f3c4917419b7c5fbfa59cc3d0d0f57ee419113))
* open terminal links in default browser via shell.openExternal ([3ed1bee](https://github.com/Mr8BitHK/claude-terminal/commit/3ed1bee7b2362bd45403d86dda56039af2968b5f))
* shell tabs spawn next to active tab and receive focus ([a61f5ec](https://github.com/Mr8BitHK/claude-terminal/commit/a61f5ecb5088882106f8b1b93fb80e26301b019f))

### Documentation

* document repository hooks system and StatusBar hook feedback ([5711814](https://github.com/Mr8BitHK/claude-terminal/commit/57118146a3dbf4eb344b1f4393707dc19b883ef2))
* overhaul README for discoverability and add LICENSE ([dcff073](https://github.com/Mr8BitHK/claude-terminal/commit/dcff073229f15760819e49e322902f609ee94244))

## 1.1.0 (2026-03-01)

### Features

* add action buttons and open status to worktree manager ([7622d52](https://github.com/Mr8BitHK/claude-terminal/commit/7622d52cf77a5eaf7d22f7b08c86b524e3701de1))
* add animated installer splash with progress bar ([0a9a96e](https://github.com/Mr8BitHK/claude-terminal/commit/0a9a96e2412d685532a053c7bd60f71fb2d2ba12))
* add App shell with keyboard shortcuts and styles ([93ccde9](https://github.com/Mr8BitHK/claude-terminal/commit/93ccde973b55054a1e6e4b8691f420a5f96fe3c7))
* add buildWindowTitle utility for dynamic window title ([8b73179](https://github.com/Mr8BitHK/claude-terminal/commit/8b731792aad99c8b47e7d7a44a0cc49585d977f3))
* add custom app icon for window, taskbar, and installer ([02cefee](https://github.com/Mr8BitHK/claude-terminal/commit/02cefee344add1cc2150f1e5ede11326b4faf686))
* add delete button to remove directories from startup history ([9f1825e](https://github.com/Mr8BitHK/claude-terminal/commit/9f1825ee8976c717871b9fcb00ee12bcb3d38c74))
* add HamburgerMenu component with dropdown ([703b929](https://github.com/Mr8BitHK/claude-terminal/commit/703b9297bd4dee9f945e05e9bb94ca29fe6554a8))
* add hook installer that writes .claude/settings.local.json ([c586556](https://github.com/Mr8BitHK/claude-terminal/commit/c5865569f42b73c3e8d0802d6123776cd3cfaeba))
* add hook scripts for Claude Code status communication ([c77c491](https://github.com/Mr8BitHK/claude-terminal/commit/c77c491cacd663260a683ec066080ae84bb43e04))
* add installer config, hooks copy, and CLI auto-start ([5716369](https://github.com/Mr8BitHK/claude-terminal/commit/57163693efb24a34b00d15c0227edf765437d1db))
* add IPC bridge and tab restoration on session start ([931c4c1](https://github.com/Mr8BitHK/claude-terminal/commit/931c4c194ccffb62a8db6a9b5b655585bd229de9))
* add logging and error handling to session persistence ([513c3b0](https://github.com/Mr8BitHK/claude-terminal/commit/513c3b004bef585002f018f8a344d782dab3be60))
* add named pipe IPC server for hook communication ([2cd3786](https://github.com/Mr8BitHK/claude-terminal/commit/2cd378670e947879dd9515022e968ace0f0883ac))
* add preload API and all renderer components ([cdccf0e](https://github.com/Mr8BitHK/claude-terminal/commit/cdccf0e8351739f48216e7773fd8a975e5038c01))
* add PTY manager for spawning Claude processes ([6078d72](https://github.com/Mr8BitHK/claude-terminal/commit/6078d725c9cd87fbf6ead85ee9633878704242cc))
* add right-click paste when no text is selected ([b06f15a](https://github.com/Mr8BitHK/claude-terminal/commit/b06f15a01d1d00c0b42c7e16592298595d1a570f))
* add session persistence data layer for tab restore ([6053410](https://github.com/Mr8BitHK/claude-terminal/commit/6053410dd1b3f0b309b16987d3b6afa76a62d69f))
* add session persistence to main process ([ad0170f](https://github.com/Mr8BitHK/claude-terminal/commit/ad0170fa756542917c6ac7bd22382a8a8958c9f6))
* add settings store for recent dirs and permission mode ([64ecc48](https://github.com/Mr8BitHK/claude-terminal/commit/64ecc4871788436ea07a5f5852e177bb0e8490b2))
* add shared types for tabs, IPC messages, and permissions ([58f1477](https://github.com/Mr8BitHK/claude-terminal/commit/58f1477e86281a051ebb8dc1de0b090bc23e5eed))
* add shell tab backend support (PowerShell/WSL) ([4cf2457](https://github.com/Mr8BitHK/claude-terminal/commit/4cf2457b884c54093b9036d1f7a8a7c6c1715a40))
* add shell tab frontend - chevron dropdown, new-tab menu, shortcuts ([776da6e](https://github.com/Mr8BitHK/claude-terminal/commit/776da6ed6321365c9b8e49339b808bc03e71a878))
* add Squirrel event handling with CLI shim and PATH management ([f50592f](https://github.com/Mr8BitHK/claude-terminal/commit/f50592fbaaf17cb6a71a5371e8fc0857b5e5d522))
* add tab manager for tab lifecycle and state ([731d95b](https://github.com/Mr8BitHK/claude-terminal/commit/731d95bc1522bae2f3a3f35395b32efb919fd5d0))
* add TabIndicator component with Lucide icons ([f904050](https://github.com/Mr8BitHK/claude-terminal/commit/f9040501751aa1991e318510d726b38bf730d513))
* add window:setTitle IPC channel and preload API ([5145d6c](https://github.com/Mr8BitHK/claude-terminal/commit/5145d6ce87ec190fa862002cbf0582baa2ef67c9))
* add worktree loading animation with progress streaming ([a376222](https://github.com/Mr8BitHK/claude-terminal/commit/a376222d0e2bc8f4db15044007a5c186c9605bb8))
* add worktree manager for creating/removing git worktrees ([00c2313](https://github.com/Mr8BitHK/claude-terminal/commit/00c231358efba8a801bc5ce68b2a66ab002f637e))
* add worktree:listDetails and worktree:remove IPC channels ([937b7f9](https://github.com/Mr8BitHK/claude-terminal/commit/937b7f9cba5d73d99e9039210152e21265005bd5))
* add WorktreeManager.listDetails() for worktree status ([ce01767](https://github.com/Mr8BitHK/claude-terminal/commit/ce0176794be0b23e4217ff590abed46cc9481120))
* add WorktreeManagerDialog component ([3789d7e](https://github.com/Mr8BitHK/claude-terminal/commit/3789d7e635824231304a4c35a13a2cdfbbad81a9))
* auto-show new tab dialog on first startup ([b2b0e91](https://github.com/Mr8BitHK/claude-terminal/commit/b2b0e910749363e60421716c54ebd769ae39987a))
* bundle ws native deps and parallelize session tab restoration ([73b4ce5](https://github.com/Mr8BitHK/claude-terminal/commit/73b4ce59705958a11d931f4c0979d9dc0e8fb60f))
* capture session_id from stdin in on-session-start hook ([f144d91](https://github.com/Mr8BitHK/claude-terminal/commit/f144d918804b9a0f57ec4e6136be5855be767784))
* clean up naming flag files on tab close ([4f7f136](https://github.com/Mr8BitHK/claude-terminal/commit/4f7f1366f05c566a319c5464d87278d6aa376f1a))
* Ctrl+T instant new tab, Ctrl+W worktree tab with name prompt ([2d32f9f](https://github.com/Mr8BitHK/claude-terminal/commit/2d32f9f18ffe2fb1c60dd09c0dde81f6bdb8b59a))
* double-click directory to start session + startup dialog docs ([a18e518](https://github.com/Mr8BitHK/claude-terminal/commit/a18e518cb6206afd61220e11b63762b623c2dcab))
* dynamically update window title with tab status counts ([2e03b17](https://github.com/Mr8BitHK/claude-terminal/commit/2e03b178614bba19bc85c283e887f58e6455bd32))
* extract hook-router module from index.ts ([e741b8a](https://github.com/Mr8BitHK/claude-terminal/commit/e741b8ad8a38522b05bb0ec275ea14593e87ab0f))
* extract ipc-handlers module from index.ts ([da6887c](https://github.com/Mr8BitHK/claude-terminal/commit/da6887cb943d025f372a7c6577ffb0aaa644df43))
* extract shared claude-cli helper (closes [#7](https://github.com/Mr8BitHK/claude-terminal/issues/7)) ([7865006](https://github.com/Mr8BitHK/claude-terminal/commit/78650061f5e4e115906cbb10a3aa182cddcb4a62))
* extract tab-namer module from index.ts ([881ae8f](https://github.com/Mr8BitHK/claude-terminal/commit/881ae8fa037c68e230f891511919b67e33754bb6))
* generate tab names with Claude Haiku in background ([9606516](https://github.com/Mr8BitHK/claude-terminal/commit/96065162ec0e6243917d7d24da6bd9349fe0c244))
* **hooks:** add cross-spawn and tree-kill dependencies ([4caa96e](https://github.com/Mr8BitHK/claude-terminal/commit/4caa96e3f3db21efa4e5d3bc5c045d33ab00344d))
* **hooks:** add HookManagerDialog UI component with styles ([a055cf3](https://github.com/Mr8BitHK/claude-terminal/commit/a055cf3b745c8814d7343c70f45439be6c54dd98))
* **hooks:** add IPC handlers for hook config CRUD and status events ([77858c8](https://github.com/Mr8BitHK/claude-terminal/commit/77858c85ee71286a3bd727f9c265b06a21c03c66))
* **hooks:** add shared types for hook config ([f1a9ac9](https://github.com/Mr8BitHK/claude-terminal/commit/f1a9ac9093d00a98fe35811d9d7cd0f5946f28cc))
* **hooks:** implement HookConfigStore for loading/saving hooks.json ([5fd5a6e](https://github.com/Mr8BitHK/claude-terminal/commit/5fd5a6ef5e18cdba378402a235f47d0114141272))
* **hooks:** implement HookEngine for command execution ([d3e7902](https://github.com/Mr8BitHK/claude-terminal/commit/d3e7902a4a28fc2cd662de66edd7549afee3078a))
* **hooks:** integrate HookEngine with worktree, tab, and session lifecycle ([aa644c9](https://github.com/Mr8BitHK/claude-terminal/commit/aa644c964c45ff941e83db3ce9df019d71637c9b))
* **hooks:** wire HookManagerDialog into hamburger menu and App ([899c7b3](https://github.com/Mr8BitHK/claude-terminal/commit/899c7b35faa902cdef80c207cfefe3f12f13d077))
* move cloud icon to left of hamburger menu ([490f8c1](https://github.com/Mr8BitHK/claude-terminal/commit/490f8c14cc35774cdcc9e9c0f67d3a6888fcd72a))
* persist sessions on every state change, not just quit ([627a98a](https://github.com/Mr8BitHK/claude-terminal/commit/627a98a60c3098496124845b288cb4566076157c))
* right-click copies selected text to clipboard in terminal ([8247891](https://github.com/Mr8BitHK/claude-terminal/commit/824789132125e1f83c16375ecea99ec667cf8efc))
* scaffold Electron Forge project with React, xterm.js, node-pty ([150cc1e](https://github.com/Mr8BitHK/claude-terminal/commit/150cc1eb11773777e698b7456abda88fcac97f53))
* send tab:generate-name on first prompt only ([f81858d](https://github.com/Mr8BitHK/claude-terminal/commit/f81858dde20afa7a55a97d4d879f4b42ca0442f4))
* show current git branch in window title ([c044907](https://github.com/Mr8BitHK/claude-terminal/commit/c044907cbd81cbf2a1acdf2a51c16bbeacbfad1e))
* simplify title status and add status counts to footer ([c955a03](https://github.com/Mr8BitHK/claude-terminal/commit/c955a03a7a06a8f42b8b65fa44de1018aabf10d3))
* support Ctrl+Enter for multi-line input ([180ca08](https://github.com/Mr8BitHK/claude-terminal/commit/180ca088083558acbbb7c6cb51624c4669ec06a1))
* use 6-char alphanumeric code and auto-reconnect for remote access ([7bf8eb5](https://github.com/Mr8BitHK/claude-terminal/commit/7bf8eb57f74817634c1262a4d556e98ce3aae22a))
* use TabIndicator in Tab and StatusBar components ([97c27d2](https://github.com/Mr8BitHK/claude-terminal/commit/97c27d2175925179de94a4368918e7f6b641cc39))
* WebGL renderer with PTY data loss fix ([#2](https://github.com/Mr8BitHK/claude-terminal/issues/2)) ([b63fef2](https://github.com/Mr8BitHK/claude-terminal/commit/b63fef233fdfa9726887079ee3c0719389240cbf))
* wire hamburger menu and worktree manager into app ([853deca](https://github.com/Mr8BitHK/claude-terminal/commit/853decad11240cb2e7c99005092c3e4799584290))
* wire up main process with IPC handlers, PTY, and hooks ([a4950f8](https://github.com/Mr8BitHK/claude-terminal/commit/a4950f85a5cbfebc5a6eb48b99184337a9830536))

### Bug Fixes

* add cancelled guards in saved-tabs restoration loop ([f5a8f34](https://github.com/Mr8BitHK/claude-terminal/commit/f5a8f3444ea96211a77c4c776b2e4172b8edacd5)), closes [#18](https://github.com/Mr8BitHK/claude-terminal/issues/18)
* add error handler to IPC server sockets to prevent crashes ([55df7c1](https://github.com/Mr8BitHK/claude-terminal/commit/55df7c1dbf176abc4eb1eb86dbe9b9f9145a0e0e)), closes [#16](https://github.com/Mr8BitHK/claude-terminal/issues/16)
* add error handling to WorktreeManagerDialog ([#54](https://github.com/Mr8BitHK/claude-terminal/issues/54)) ([481a21a](https://github.com/Mr8BitHK/claude-terminal/commit/481a21a9ac439da9785184880214637a374a207f))
* add icon for new tab status and fix status bar icon visibility ([3650e97](https://github.com/Mr8BitHK/claude-terminal/commit/3650e973e9103248fff3472bc3427691f49f9ea3))
* add missing tree-kill dependency and cross-spawn types ([ab2836b](https://github.com/Mr8BitHK/claude-terminal/commit/ab2836b386fd1a3fb61046ff0cb5a1da6c3fc981))
* add workspaceDir guard in tab:create handler ([c67c249](https://github.com/Mr8BitHK/claude-terminal/commit/c67c24991f8961ab86f7aaceb51c2fe6cc0377d7)), closes [#2](https://github.com/Mr8BitHK/claude-terminal/issues/2)
* add worktree name validation to NewTabDialog ([7c8f297](https://github.com/Mr8BitHK/claude-terminal/commit/7c8f29746401d5df8c6f0c44abf590543025fd59)), closes [#20](https://github.com/Mr8BitHK/claude-terminal/issues/20)
* address code review - remove unused import, add tests, add comment ([7ae2cc8](https://github.com/Mr8BitHK/claude-terminal/commit/7ae2cc8e2ffcd6d1fec7957bd014963985b12f6d))
* allow Alt-F4 to close app and confirm when tabs are working ([782a342](https://github.com/Mr8BitHK/claude-terminal/commit/782a3423259172b35cfe5946c25e801c5f3db6a9))
* bundle electron-store instead of externalizing it ([5fb5714](https://github.com/Mr8BitHK/claude-terminal/commit/5fb5714298dd00aea4d3538f9e1152f839a217ec))
* bundle ws/qrcode and copy cloudflared for packaged app ([d584564](https://github.com/Mr8BitHK/claude-terminal/commit/d584564cdeb6080e5087deade63b74e81ad05e48))
* change close-tab shortcut from Ctrl+W to Ctrl+F4 ([3595472](https://github.com/Mr8BitHK/claude-terminal/commit/3595472dc9be4898a16122e2194af8e62c86d393))
* clean up orphaned PTY processes on unmount during restore ([#57](https://github.com/Mr8BitHK/claude-terminal/issues/57)) ([0cc4185](https://github.com/Mr8BitHK/claude-terminal/commit/0cc41857576127f77991ecbab4bd410dbfe19bb0))
* close active connections in HookIpcServer.stop() ([#52](https://github.com/Mr8BitHK/claude-terminal/issues/52)) ([0214bae](https://github.com/Mr8BitHK/claude-terminal/commit/0214baebeec0505fff5ca660c17bed6281070f9a))
* close gitHeadWatcher on app shutdown ([#51](https://github.com/Mr8BitHK/claude-terminal/issues/51)) ([dd8532e](https://github.com/Mr8BitHK/claude-terminal/commit/dd8532e312fb04a9720600f55ddfdd3fcca660f4))
* debounce tab close to prevent /clear from removing tabs ([b4d4bc0](https://github.com/Mr8BitHK/claude-terminal/commit/b4d4bc0676157b223c8245b630e57a28131406b3))
* differentiate ENOENT from unexpected errors in getSessions logging ([94581e7](https://github.com/Mr8BitHK/claude-terminal/commit/94581e7eeb8dea66c5b4e8fe385d0c4d97106a9b))
* disable asar and manually copy native modules for production builds ([16c44ac](https://github.com/Mr8BitHK/claude-terminal/commit/16c44ac1e2dec8d4608e6b4141b84c15abfc4dec))
* dismiss worktree dialog only after async ops complete ([#55](https://github.com/Mr8BitHK/claude-terminal/issues/55)) ([37a98ec](https://github.com/Mr8BitHK/claude-terminal/commit/37a98ec238b92c041e1086d8fe2040518e01191f))
* don't persist new sessions with no user interaction ([b6c70f9](https://github.com/Mr8BitHK/claude-terminal/commit/b6c70f944adea234dca428ab0eabcbe4658153be))
* eliminate 1-2s delay when closing tabs on Windows ([de35fa4](https://github.com/Mr8BitHK/claude-terminal/commit/de35fa440c2b71589de3ae23813ce2a6832efa5f))
* eliminate stale tabsRef race in onTabRemoved callback ([67c70f5](https://github.com/Mr8BitHK/claude-terminal/commit/67c70f589955393958a36e21b7de7becb0693fe0)), closes [#4](https://github.com/Mr8BitHK/claude-terminal/issues/4)
* filter undefined values from env before passing to node-pty ([8c4890f](https://github.com/Mr8BitHK/claude-terminal/commit/8c4890f78fabcbfc724d40deb7edbe9b7cb25dc9)), closes [#19](https://github.com/Mr8BitHK/claude-terminal/issues/19)
* focus terminal immediately after tab switch ([634483a](https://github.com/Mr8BitHK/claude-terminal/commit/634483a41a37b816d2e30a0765bc48b4c7b45c8b))
* guard hook execFileSync calls to prevent Claude Code crashes ([c0c5d79](https://github.com/Mr8BitHK/claude-terminal/commit/c0c5d799e090d84427315e7048432a5214e16ec5)), closes [#1](https://github.com/Mr8BitHK/claude-terminal/issues/1)
* guard tab:close to prevent double tab:removed emission ([3f34da8](https://github.com/Mr8BitHK/claude-terminal/commit/3f34da831fb9e5b561677e2b8bb2ff53024856be)), closes [#17](https://github.com/Mr8BitHK/claude-terminal/issues/17)
* **hooks:** address review feedback - branch tracking, shell tab hooks, close guard, remove cast ([6b67b9d](https://github.com/Mr8BitHK/claude-terminal/commit/6b67b9d572bfc34652787ed42628a71d9c642517))
* improve tab and status bar color scheme for better contrast ([5aff36e](https://github.com/Mr8BitHK/claude-terminal/commit/5aff36ed8aa4b25f0ca97629cf250feeb324d3b5)), closes [#37373d](https://github.com/Mr8BitHK/claude-terminal/issues/37373d)
* improve terminal rendering and keyboard shortcut passthrough ([f60b767](https://github.com/Mr8BitHK/claude-terminal/commit/f60b7673dbabb060d8c7343d5501a08987b0da26))
* kill process tree on generateTabName timeout on Windows ([f7a9be7](https://github.com/Mr8BitHK/claude-terminal/commit/f7a9be7a86025e27edf7cad58833b3793f71f4aa)), closes [#3](https://github.com/Mr8BitHK/claude-terminal/issues/3)
* make StartupDialog recent-dirs list keyboard-accessible ([863cd07](https://github.com/Mr8BitHK/claude-terminal/commit/863cd078e8801a33bc12f4c3e7ad8013c0e4eb5f)), closes [#21](https://github.com/Mr8BitHK/claude-terminal/issues/21)
* make WorktreeManager.list() private ([d4d0c33](https://github.com/Mr8BitHK/claude-terminal/commit/d4d0c33f66a7b59cab7bbb1b44a634b61f9478a3)), closes [#10](https://github.com/Mr8BitHK/claude-terminal/issues/10)
* merge duplicate did-finish-load handlers, defer IPC server construction ([2609a7f](https://github.com/Mr8BitHK/claude-terminal/commit/2609a7f6eff5dbe291f4184349e626c0107a0b03)), closes [#25](https://github.com/Mr8BitHK/claude-terminal/issues/25) [#26](https://github.com/Mr8BitHK/claude-terminal/issues/26)
* move session storage to per-directory and add debug logging ([74c1699](https://github.com/Mr8BitHK/claude-terminal/commit/74c1699fdf19c7c71b0080343b8eae74d2732e99))
* only register onMessage when IPC server starts successfully ([#56](https://github.com/Mr8BitHK/claude-terminal/issues/56)) ([0dc890b](https://github.com/Mr8BitHK/claude-terminal/commit/0dc890b2d9f97173e6224986aaf54f03b955f929))
* open URLs in default browser instead of Electron ([0f47467](https://github.com/Mr8BitHK/claude-terminal/commit/0f47467494c4b38e855d0586072dfb1b614c15ae))
* pass -w flag to Claude when spawning worktree tabs ([51e8069](https://github.com/Mr8BitHK/claude-terminal/commit/51e8069461c50837669574eb2f9b761e762ace46))
* pass correct branch name in worktree:created hook ([43b13c4](https://github.com/Mr8BitHK/claude-terminal/commit/43b13c4cf8eb6956cb6710598a63c4a96452fccb))
* pass Ctrl+P and Ctrl+L through xterm key filter ([4fc8aea](https://github.com/Mr8BitHK/claude-terminal/commit/4fc8aeacba256172b49ca534f833115ae024d78a))
* pass worktree path (not name) to createTab and validate input ([a0d40f8](https://github.com/Mr8BitHK/claude-terminal/commit/a0d40f85431fc6ec4715889c41e59cf1d00489bd))
* persist all claude tabs regardless of status ([78a5bd2](https://github.com/Mr8BitHK/claude-terminal/commit/78a5bd2871427e29157669af441445f9ee2a90c1))
* persist sessions on user-initiated tab rename ([caec392](https://github.com/Mr8BitHK/claude-terminal/commit/caec39281b04c5141a6218f6aeb7852fe231d920))
* preserve tab names across app reload ([440ac18](https://github.com/Mr8BitHK/claude-terminal/commit/440ac1891059bab537a529d5c28de9f20197043a))
* prevent PATH corruption from setx 1024-char truncation ([#50](https://github.com/Mr8BitHK/claude-terminal/issues/50)) ([c5a7ffc](https://github.com/Mr8BitHK/claude-terminal/commit/c5a7ffc4078f39c71bedcad30865264ba234b653))
* prevent resumed idle sessions from being dropped on next persist ([6ccf306](https://github.com/Mr8BitHK/claude-terminal/commit/6ccf306097925e25fcfbb119c62d9936dc4caa0f))
* prevent second app instance spawning on tab close ([2c4eba5](https://github.com/Mr8BitHK/claude-terminal/commit/2c4eba59dbcd8a468b26b09ce5d8a8a75a3256c9))
* prevent session persistence from wiping saved tabs on reload/quit ([d3a4a96](https://github.com/Mr8BitHK/claude-terminal/commit/d3a4a9667ccc0ae9b06f16ba1183d16165d46a05))
* prevent shell injection in worktree-manager ([#49](https://github.com/Mr8BitHK/claude-terminal/issues/49)) ([ae1839c](https://github.com/Mr8BitHK/claude-terminal/commit/ae1839c260364355a787f64c502a5ef951f69360))
* prevent Squirrel version numbers from polluting recent dirs history ([b870460](https://github.com/Mr8BitHK/claude-terminal/commit/b870460bd64e245a2b7961a0db4648dd9a62d9a4))
* prevent tab-naming Claude calls from polluting /resume history ([3b77b5d](https://github.com/Mr8BitHK/claude-terminal/commit/3b77b5d858863a82c9581f797588f84b760423d8))
* proper JSON escaping in pipe-send and cross-platform temp dir ([df3987a](https://github.com/Mr8BitHK/claude-terminal/commit/df3987a5655d1eb7e0d495bcf0d67487b38b96d0))
* remove 5s worktree polling timer that caused periodic slowdowns ([e660d9a](https://github.com/Mr8BitHK/claude-terminal/commit/e660d9ad3e5599d7125ab1868326a5fafd825279))
* remove dead .selected-dir CSS class ([2ebba77](https://github.com/Mr8BitHK/claude-terminal/commit/2ebba77d8d6fbe51de05f885f2231154b1b36a1b)), closes [#14](https://github.com/Mr8BitHK/claude-terminal/issues/14)
* remove dead PtyManager.getPty() method ([ededeeb](https://github.com/Mr8BitHK/claude-terminal/commit/ededeeb07973ee569fac232d49572b857e34beb9)), closes [#11](https://github.com/Mr8BitHK/claude-terminal/issues/11)
* remove debug log file leak from on-session-start hook ([1a5a697](https://github.com/Mr8BitHK/claude-terminal/commit/1a5a697084143a299f51ae7a0f20291ee82b5d5a)), closes [#15](https://github.com/Mr8BitHK/claude-terminal/issues/15)
* remove default application menu ([89e54fc](https://github.com/Mr8BitHK/claude-terminal/commit/89e54fcc7dbdc7f223ee8956bd38a7dd094fdfa2))
* remove redundant getCliStartDir call from StartupDialog ([60b8e70](https://github.com/Mr8BitHK/claude-terminal/commit/60b8e70cbc079f9337135c690662c86579227d9b)), closes [#13](https://github.com/Mr8BitHK/claude-terminal/issues/13)
* remove single-instance lock to allow multiple app windows ([09e960b](https://github.com/Mr8BitHK/claude-terminal/commit/09e960ba0479162043003577c973d355b92bc0b8))
* remove unused @electron-forge/plugin-auto-unpack-natives dependency ([caa03a0](https://github.com/Mr8BitHK/claude-terminal/commit/caa03a0263c33f6f5ce8a1d7c983489e6275ae75)), closes [#22](https://github.com/Mr8BitHK/claude-terminal/issues/22)
* remove WebGL addon and debug logging from terminal ([1f5f414](https://github.com/Mr8BitHK/claude-terminal/commit/1f5f4147d27e9e0a1661277515cbff9e5e629db8))
* replace electron-store with plain JSON store and switch to pnpm ([a065478](https://github.com/Mr8BitHK/claude-terminal/commit/a065478432f1eac1c24e0adbde2fb1ea86c7008d))
* replace global CustomEvent with props for tab rename ([#24](https://github.com/Mr8BitHK/claude-terminal/issues/24)) ([6f83316](https://github.com/Mr8BitHK/claude-terminal/commit/6f833166806cfc25581630912eb8f65d745d87cd))
* reset tab name to default on /clear ([bc415fb](https://github.com/Mr8BitHK/claude-terminal/commit/bc415fb31a89c1121cdb7301056a254d12baae22))
* resolve TypeScript errors and build configuration ([f1ff13f](https://github.com/Mr8BitHK/claude-terminal/commit/f1ff13f0d82b144defdab2e02aa349a58dcd111c))
* restore dropped comments documenting bug-fix rationale ([2adb7fb](https://github.com/Mr8BitHK/claude-terminal/commit/2adb7fbe17ff9759b075e52ea6bf8265ca3be649))
* rewrite hooks for Windows compatibility ([4ee609f](https://github.com/Mr8BitHK/claude-terminal/commit/4ee609f0c5b28dd77a79c08cfb1cb14415c23593))
* right-align cloud icon together with hamburger menu ([1837390](https://github.com/Mr8BitHK/claude-terminal/commit/183739087e0dff3301d8c0deb37b5a15a67262e8))
* set window icon and improve icon visibility on dark backgrounds ([b675f11](https://github.com/Mr8BitHK/claude-terminal/commit/b675f11c2b68182914799869119ad62356e5521f))
* spawn claude through cmd.exe on Windows for node-pty compatibility ([799de91](https://github.com/Mr8BitHK/claude-terminal/commit/799de919ad682849e67e22d443d8fc6ec5bf77f6))
* standardize on node: prefix for built-in imports ([#6](https://github.com/Mr8BitHK/claude-terminal/issues/6)) ([9b834b0](https://github.com/Mr8BitHK/claude-terminal/commit/9b834b007592c88b7f645bc97f9d6500a5f8407a))
* startup dialog browse adds dir to history and Enter submits ([78ef62b](https://github.com/Mr8BitHK/claude-terminal/commit/78ef62bbea6f9854eae8b0e7cb58729c51e98fae))
* startup dialog not showing and clean up layout ([6fc5ab9](https://github.com/Mr8BitHK/claude-terminal/commit/6fc5ab993bd94ffa2060b6b17a736329851cedfa))
* stop DevTools from auto-opening on startup ([60cf3c4](https://github.com/Mr8BitHK/claude-terminal/commit/60cf3c453b8427f7c2678835e3be63c9ee08c735))
* sync tests with current window-title and pty-manager implementations ([be5ff45](https://github.com/Mr8BitHK/claude-terminal/commit/be5ff456cd1b5b876cdb19bdec57c37edc721bce))
* update TabIndicator test for new/shell statuses ([540f204](https://github.com/Mr8BitHK/claude-terminal/commit/540f20466960bc791a30c14f593a481501abb703))
* upgrade [@typescript-eslint](https://github.com/typescript-eslint) from v5 to v8 ([#23](https://github.com/Mr8BitHK/claude-terminal/issues/23)) ([b47fa94](https://github.com/Mr8BitHK/claude-terminal/commit/b47fa941f30c61d925ae601a61ef1e7acd3a0cd7))
* upgrade TypeScript to 5.x, enable strict mode, fix moduleResolution ([5d153a9](https://github.com/Mr8BitHK/claude-terminal/commit/5d153a911d5448d88780d3cf55f6f25647e7950d))
* use distinct icons for PS vs WSL tabs, update status bar shortcuts ([f4adddd](https://github.com/Mr8BitHK/claude-terminal/commit/f4addddc035d4e37fc588f5b1a99de7473404497))
* use JSON.stringify for executeJavaScript tab ID escaping ([#58](https://github.com/Mr8BitHK/claude-terminal/issues/58)) ([7f7186c](https://github.com/Mr8BitHK/claude-terminal/commit/7f7186cb5b53016d74144053128ebf1a7e6baceb))
* use lucide-lab penguin icon for WSL tabs ([85c619c](https://github.com/Mr8BitHK/claude-terminal/commit/85c619c55cce912542f3f9ca4094c31af83a680f))
* use per-process disk cache dir to avoid lock conflicts ([bc7f34d](https://github.com/Mr8BitHK/claude-terminal/commit/bc7f34d324eaa30f71f4923f0670f5d4bbc7f90c))
* use per-process IPC pipe name to support multiple instances ([f7adb2a](https://github.com/Mr8BitHK/claude-terminal/commit/f7adb2ada5a8ced6e627fcc770a217825a194a36))
* use pnpm in make script for CI consistency ([307dd0c](https://github.com/Mr8BitHK/claude-terminal/commit/307dd0ccacfff610140d25ec841123a8c34ae500))
* use SessionStart source field to detect /clear instead of sessionId check ([6dc8337](https://github.com/Mr8BitHK/claude-terminal/commit/6dc83373c22d94e1d4a3e284bd4ed4e09f0eefa3))
* wrap remaining handlers in useCallback for consistency ([#9](https://github.com/Mr8BitHK/claude-terminal/issues/9)) ([92f0e6d](https://github.com/Mr8BitHK/claude-terminal/commit/92f0e6df354a462c2834fcd765890a61dc346b8b))
* write naming flag only after successful pipe send ([080f2a4](https://github.com/Mr8BitHK/claude-terminal/commit/080f2a465cb7ff3d3d3deada769bb6aff3c04730)), closes [#5](https://github.com/Mr8BitHK/claude-terminal/issues/5)

### Performance

* add will-change hints to tab indicator animations ([59f62ec](https://github.com/Mr8BitHK/claude-terminal/commit/59f62ec2ed285f808c2b759d1bb36d4edb8d9310))
* cap PTY flow control buffer at 5MB per tab ([9e7767d](https://github.com/Mr8BitHK/claude-terminal/commit/9e7767d85799db7c952d5863a3e45dcdeae386ae))
* convert sync I/O to async across main process ([5dfd597](https://github.com/Mr8BitHK/claude-terminal/commit/5dfd59776c296fdfdbedad105594900739ca98f6))
* debounce persistSessions() with 200ms delay ([c6bc1b2](https://github.com/Mr8BitHK/claude-terminal/commit/c6bc1b2b368058c58a0c5e4a6f559d0163daf565))
* extract useClickOutside hook, deduplicate 4 event listeners ([f907ac7](https://github.com/Mr8BitHK/claude-terminal/commit/f907ac707aca60065bf5d23ca6d3a68364dcd531))
* memoize Tab component and stabilize TabBar handlers ([ae6ccf4](https://github.com/Mr8BitHK/claude-terminal/commit/ae6ccf40ab7ea971be0bc3296c735b1b382c7334))
* memoize Terminal and StatusBar components ([ee81fed](https://github.com/Mr8BitHK/claude-terminal/commit/ee81fede70d8236a8c5991e4616aacf54057c403))
* optimize packaged app size (143 MB → 126 MB installer) ([a6bcb2d](https://github.com/Mr8BitHK/claude-terminal/commit/a6bcb2dd88013c29250c14b81aee9214960ab228))
* stabilize keyboard handler with useRef for tabs/activeTabId ([1a33519](https://github.com/Mr8BitHK/claude-terminal/commit/1a33519748fa7e03b07114c2f3cd33fff4839d41))

### Refactoring

* rewrite index.ts as lifecycle glue wiring extracted modules ([b508ffa](https://github.com/Mr8BitHK/claude-terminal/commit/b508ffa688a850f15f61fd286d3add887bf5a9ab))
* use @lucide/lab penguin icon instead of inline SVG ([9bafe13](https://github.com/Mr8BitHK/claude-terminal/commit/9bafe130acca518681bd2d1c0af232805a77f51f))
* use shared getClaudeCommand in pty-manager ([0563616](https://github.com/Mr8BitHK/claude-terminal/commit/05636163a4ae180329fe9e7216418faf4ffab3ad))

### Documentation

* add AGENTS.md and project documentation ([3219455](https://github.com/Mr8BitHK/claude-terminal/commit/3219455583e7553d65a86e19e582a3b4a3cf9607))
* add design for index.ts refactoring ([#7](https://github.com/Mr8BitHK/claude-terminal/issues/7), [#42](https://github.com/Mr8BitHK/claude-terminal/issues/42), [#43](https://github.com/Mr8BitHK/claude-terminal/issues/43)) ([6518402](https://github.com/Mr8BitHK/claude-terminal/commit/651840275c8f0028a779e31c5967c90af1e4664d))
* add feature architecture docs and documentation index in AGENTS.md ([272eca3](https://github.com/Mr8BitHK/claude-terminal/commit/272eca39fed7952861918ab8b25cfa961c35cbd5))
* add hamburger menu + worktree manager design ([5bd2b43](https://github.com/Mr8BitHK/claude-terminal/commit/5bd2b43dd056112195edaece7328845891872954))
* add hamburger menu + worktree manager implementation plan ([f0b08c2](https://github.com/Mr8BitHK/claude-terminal/commit/f0b08c266421e48c68ccf2d4f64403ba7d74804b))
* add implementation plan for index.ts refactoring ([710fbef](https://github.com/Mr8BitHK/claude-terminal/commit/710fbef53d2434943d49ad4a2f15e994ec09e960))
* add project README ([833b6a2](https://github.com/Mr8BitHK/claude-terminal/commit/833b6a27336ffefd024312289c85963c1a6b78b0))
* add repository hooks implementation plan ([091b681](https://github.com/Mr8BitHK/claude-terminal/commit/091b681e77efbdb60a9ee730cfdbfc8e29481ca4))
* add repository hooks system design ([c4b6ffa](https://github.com/Mr8BitHK/claude-terminal/commit/c4b6ffa14b9ed7e71e5f4a061295f5fc1c9908fb))
* add screenshot to README ([1a5ff19](https://github.com/Mr8BitHK/claude-terminal/commit/1a5ff19309cab5a8aa156b3cb4eba1514a00fb4f))
* add tab indicator icons design ([674971f](https://github.com/Mr8BitHK/claude-terminal/commit/674971f551ca5e94ced0f92c7be313f95899d111))
* add tab indicator icons implementation plan ([39ba45b](https://github.com/Mr8BitHK/claude-terminal/commit/39ba45b9ccb073fc9236a057cfff94e096502d53))
* add versioning and releases design document ([01319b5](https://github.com/Mr8BitHK/claude-terminal/commit/01319b55af79e4396a76096e57dfb91657ce1c4a))
* add versioning and releases implementation plan ([7641c5c](https://github.com/Mr8BitHK/claude-terminal/commit/7641c5c104a543bb0df2ea58383a335585344cfb))
* add Windows shell tabs design ([415a82a](https://github.com/Mr8BitHK/claude-terminal/commit/415a82a58ad6288a29efb0a0e8ac2560541fe314))
* add Windows shell tabs implementation plan ([83d44ab](https://github.com/Mr8BitHK/claude-terminal/commit/83d44ab5dcf5340f3810a79c4a893cac57029f25))
* update documentation to match current codebase ([42ea28c](https://github.com/Mr8BitHK/claude-terminal/commit/42ea28cb17598d911b4c45bdb153ee7b9a5c84e8))
* update README with current features and reorganize sections ([8d0c5b3](https://github.com/Mr8BitHK/claude-terminal/commit/8d0c5b35efd95567a2cbac29ba1f3748051adfbf))

### Miscellaneous

* add .worktrees/ to .gitignore ([b4bf74d](https://github.com/Mr8BitHK/claude-terminal/commit/b4bf74dfa8e676caf0ef9156bddd1dc7913dfdb2))
* add dotenv-cli for loading .env in release scripts ([5564694](https://github.com/Mr8BitHK/claude-terminal/commit/5564694bacb52d8d921bdc856f529dd635565b9b))
* add release-it dependencies ([603a3f5](https://github.com/Mr8BitHK/claude-terminal/commit/603a3f5bb9e9c2bdd4d674123ba57edd0aa335cd))
* add rule preventing unauthorized worktree merges to AGENTS.md ([e0163ea](https://github.com/Mr8BitHK/claude-terminal/commit/e0163eab04c9ed74598ca6d508c167ca95f512cf))
* configure release-it with conventional changelog ([965c6b8](https://github.com/Mr8BitHK/claude-terminal/commit/965c6b87a73e282285736615a3e4cdc7c5af7978))
