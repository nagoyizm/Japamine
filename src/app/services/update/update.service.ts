import { Injectable, NgZone, Optional } from '@angular/core';
import { ipcRenderer } from 'electron';
import { GitHubApi } from '../../common/api/git-hub/git-hub.api';
import { ProductInformation } from '../../common/application/product-information';
import { Logger } from '../../common/logger';
import { VersionComparer } from './version-comparer';
import { UpdateServiceBase } from './update.service.base';
import { DesktopBase } from '../../common/io/desktop.base';
import { SettingsBase } from '../../common/settings/settings.base';

@Injectable()
export class UpdateService implements UpdateServiceBase {
    public _isUpdateAvailable: boolean = false;
    public _isUpdateDownloaded: boolean = false;
    private _latestRelease: string = '';

    public constructor(
        private settings: SettingsBase,
        private logger: Logger,
        private gitHub: GitHubApi,
        private desktop: DesktopBase,
        @Optional() private zone?: NgZone,
    ) {
        if (typeof ipcRenderer !== 'undefined' && ipcRenderer?.on) {
            ipcRenderer.on('updater-update-available', (_event: unknown, version: string) => {
                this.runInZone(() => {
                    this._isUpdateAvailable = true;
                    if (version) {
                        this._latestRelease = version;
                    }
                });
            });

            ipcRenderer.on('updater-update-downloaded', (_event: unknown, version: string) => {
                this.runInZone(() => {
                    this._isUpdateAvailable = true;
                    this._isUpdateDownloaded = true;
                    if (version) {
                        this._latestRelease = version;
                    }
                });
            });

            void ipcRenderer
                .invoke('updater-get-status')
                .then((status: { isDownloaded: boolean; version: string }) => {
                    if (status?.isDownloaded) {
                        this.runInZone(() => {
                            this._isUpdateAvailable = true;
                            this._isUpdateDownloaded = true;
                            if (status.version) {
                                this._latestRelease = status.version;
                            }
                        });
                    }
                })
                .catch(() => {});
        }
    }

    private runInZone(fn: () => void): void {
        if (this.zone) {
            this.zone.run(fn);
        } else {
            fn();
        }
    }

    public get isUpdateAvailable(): boolean {
        return this._isUpdateAvailable;
    }

    public get isUpdateDownloaded(): boolean {
        return this._isUpdateDownloaded;
    }

    public get latestRelease(): string {
        return this._latestRelease;
    }

    public async checkForUpdatesAsync(): Promise<void> {
        if (typeof ipcRenderer !== 'undefined' && ipcRenderer?.invoke) {
            void ipcRenderer.invoke('updater-check-now').catch(() => {});
        }

        if (this.settings.checkForUpdates) {
            this.logger.info('Checking for updates', 'UpdateService', 'checkForUpdatesAsync');

            try {
                const currentRelease: string = ProductInformation.applicationVersion;
                const latestRelease: string = await this.gitHub.getLatestReleaseAsync(
                    'nagoyizm',
                    ProductInformation.applicationName.toLowerCase(),
                    this.settings.checkForUpdatesIncludesPreReleases,
                );

                this.logger.info(`Current=${currentRelease}, Latest=${latestRelease}`, 'UpdateService', 'checkForUpdatesAsync');

                if (VersionComparer.isNewerVersion(currentRelease, latestRelease)) {
                    this.logger.info(
                        `Latest (${latestRelease}) > Current (${currentRelease}). Notifying user.`,
                        'UpdateService',
                        'checkForUpdatesAsync',
                    );

                    this._isUpdateAvailable = true;
                    this._latestRelease = latestRelease;
                } else {
                    this.logger.info(
                        `Latest (${latestRelease}) <= Current (${currentRelease}). Nothing to do.`,
                        'UpdateService',
                        'checkForUpdatesAsync',
                    );
                }
            } catch (e: unknown) {
                this.logger.error(e, 'Could not check for updates', 'UpdateService', 'checkForUpdatesAsync');
            }
        } else {
            this.logger.info('Not checking for updates', 'UpdateService', 'checkForUpdatesAsync');
        }
    }

    public async downloadLatestReleaseAsync(): Promise<void> {
        await this.desktop.openLinkAsync(
            `https://github.com/nagoyizm/${ProductInformation.applicationName.toLowerCase()}/releases/tag/v${this.latestRelease}`,
        );
    }

    public async restartAndInstallAsync(): Promise<void> {
        if (typeof ipcRenderer !== 'undefined' && ipcRenderer?.invoke) {
            await ipcRenderer.invoke('updater-quit-and-install');
        }
    }
}
