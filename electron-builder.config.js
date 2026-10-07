const { getFullVersion } = require('./get-package-information.js');

const config = {
    appId: 'com.nagoyizm.japamine',
    productName: 'Japamine',
    snap: {
        base: 'core22', // Must match build server (currently Ubuntu 22.04)
        grade: 'stable',
        confinement: 'strict',
        summary: 'Japamine audio player',
        description:
            'Japamine is an elegant audio player based on Dopamine, modified by nagoyizm.',
        plugs: [
            // REQUIRED for Electron desktop apps
            'desktop',
            'desktop-legacy',
            'wayland',
            'x11',
            'unity7',
            'opengl',
            'audio-playback',
            'browser-support',
            'network',
            'network-bind',
            'gsettings',
            'screen-inhibit-control',

            // File access
            'home',
            'removable-media',
        ],
    },
    fileAssociations: [
        {
            name: 'MP3 Files',
            description: 'MP3 Files',
            ext: 'mp3',
            icon: 'build/mp3',
        },
        {
            name: 'FLAC Files',
            description: 'FLAC Files',
            ext: 'flac',
            icon: 'build/flac',
        },
        {
            name: 'OGG Files',
            description: 'OGG Files',
            ext: 'ogg',
            icon: 'build/ogg',
        },
        {
            name: 'M4A Files',
            description: 'M4A Files',
            ext: 'm4a',
            icon: 'build/m4a',
        },
        {
            name: 'OPUS Files',
            description: 'OPUS Files',
            ext: 'opus',
            icon: 'build/opus',
        },
        {
            name: 'WAV Files',
            description: 'WAV Files',
            ext: 'wav',
            icon: 'build/wav',
        },
    ],
    nsis: {
        shortcutName: 'Japamine',
        perMachine: false,
        oneClick: false,
        deleteAppDataOnUninstall: false,
        allowToChangeInstallationDirectory: true,
        allowElevation: true,
        include: 'build/uninstaller.nsh',
        installerSidebar: 'build/Sidebar.bmp',
        uninstallerSidebar: 'build/Sidebar.bmp',
        artifactName: `\${productName}-Setup-${getFullVersion()}.\${ext}`,
    },
    portable: {
        artifactName: `\${productName}-Portable-${getFullVersion()}.\${ext}`,
    },
    directories: {
        output: 'release',
    },
    publish: {
        provider: 'github',
        owner: 'nagoyizm',
        repo: 'japamine',
    },
    files: ['**/*'],
    extraResources: ['LICENSE'],
    win: {
        target: ['nsis', 'portable'],
        artifactName: `\${productName}-${getFullVersion()}.\${ext}`,
    },
    mac: {
        target: ['dmg'],
        artifactName: `\${productName}-${getFullVersion()}.\${ext}`,
        identity: '-',
    },
    linux: {
        target: ['AppImage', 'deb', 'rpm', 'pacman', 'snap'],
        // AudioVideo is required as main category for Audio/Player to be valid (freedesktop menu spec)
        category: 'AudioVideo;Audio;Player;',
        artifactName: `\${productName}-${getFullVersion()}.\${ext}`,
        synopsis: 'Japamine audio player',
        description:
            'Japamine is an elegant audio player based on Dopamine, modified by nagoyizm.',
    },
    pacman: {
        // Use Arch package names explicitly so Ubuntu-built artifacts
        // do not leak distro-specific auto-detected dependencies.
        depends: ['gtk3', 'libnotify', 'nss', 'libxss', 'libxtst', 'xdg-utils', 'at-spi2-core'],
    },
};

module.exports = config;
