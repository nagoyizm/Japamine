import { Component, HostListener, OnDestroy, OnInit, Optional, ViewEncapsulation } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { EnterLyricsDialogComponent } from '../../dialogs/enter-lyrics-dialog/enter-lyrics-dialog.component';
import { WindowSize } from '../../../../common/io/window-size';
import { ApplicationBase } from '../../../../common/io/application.base';
import { Subscription } from 'rxjs';
import { PromiseUtils } from '../../../../common/utils/promise-utils';
import { TrackModel } from '../../../../services/track/track-model';
import { LyricsModel } from '../../../../services/lyrics/lyrics-model';
import { LyricsSourceType } from '../../../../common/api/lyrics/lyrics-source-type';
import { PlaybackInformation } from '../../../../services/playback-information/playback-information';
import { AppearanceServiceBase } from '../../../../services/appearance/appearance.service.base';
import { LyricsServiceBase } from '../../../../services/lyrics/lyrics.service.base';
import { StringUtils } from '../../../../common/utils/string-utils';
import { PlaybackInformationService } from '../../../../services/playback-information/playback-information.service';
import { SettingsBase } from '../../../../common/settings/settings.base';

@Component({
    selector: 'app-now-playing-lyrics',
    host: { style: 'display: block; width: 100%; height: 100%;' },
    templateUrl: './now-playing-lyrics.component.html',
    styleUrls: ['./now-playing-lyrics.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class NowPlayingLyricsComponent implements OnInit, OnDestroy {
    private subscription: Subscription = new Subscription();
    private _lyrics: LyricsModel | undefined;
    private previousTrackPath: string = '';
    private _isBusy: boolean = false;

    public constructor(
        private appearanceService: AppearanceServiceBase,
        private playbackInformationService: PlaybackInformationService,
        private lyricsService: LyricsServiceBase,
        private application: ApplicationBase,
        public settings: SettingsBase,
        @Optional() private dialog?: MatDialog,
    ) {}

    public lyricsSourceTypeEnum: typeof LyricsSourceType = LyricsSourceType;

    public coverArtSize: number = 0;
    public largeFontSize: number = this.appearanceService.selectedFontSize * 1.7;
    public smallFontSize: number = this.appearanceService.selectedFontSize;

    @HostListener('window:resize')
    public onResize(): void {
        this.setSizes();
    }

    public get isBusy(): boolean {
        return this._isBusy;
    }

    public get hasLyrics(): boolean {
        return this._lyrics != undefined && !StringUtils.isNullOrWhiteSpace(this._lyrics.plainText);
    }

    public get hasRichLyrics(): boolean {
        return (
            this._lyrics != null &&
            this._lyrics.textLines != undefined &&
            this._lyrics.textLines.length > 0 &&
            this._lyrics.startTimeStamps != undefined &&
            this._lyrics.startTimeStamps.length === this._lyrics.textLines.length
        );
    }

    public get showRichLyrics(): boolean {
        return this.settings.showRichLyrics;
    }

    public get lyrics(): LyricsModel | undefined {
        return this._lyrics;
    }

    public ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    public async ngOnInit(): Promise<void> {
        this.setSizes();
        this.initializeSubscriptions();
        const currentPlaybackInformation: PlaybackInformation = await this.playbackInformationService.getCurrentPlaybackInformationAsync();
        await this.showLyricsAsync(currentPlaybackInformation.track);
    }

    private initializeSubscriptions(): void {
        this.subscription.add(
            this.playbackInformationService.playingNextTrack$.subscribe((playbackInformation: PlaybackInformation) => {
                PromiseUtils.noAwait(this.showLyricsAsync(playbackInformation.track));
            }),
        );

        this.subscription.add(
            this.playbackInformationService.playingPreviousTrack$.subscribe((playbackInformation: PlaybackInformation) => {
                PromiseUtils.noAwait(this.showLyricsAsync(playbackInformation.track));
            }),
        );

        this.subscription.add(
            this.playbackInformationService.playingNoTrack$.subscribe((playbackInformation: PlaybackInformation) => {
                PromiseUtils.noAwait(this.showLyricsAsync(playbackInformation.track));
            }),
        );
    }

    private setSizes(): void {
        const applicationWindowSize: WindowSize = this.application.getWindowSize();
        const playbackControlsHeight: number = 70;
        const windowControlsHeight: number = 46;
        const horizontalMargin: number = 100;

        const availableWidth: number = applicationWindowSize.width - horizontalMargin;
        const availableHeight: number = applicationWindowSize.height - (playbackControlsHeight + windowControlsHeight);

        const meanSize = Math.sqrt(availableWidth * availableHeight);
        this.coverArtSize = meanSize / 3;
    }

    private async showLyricsAsync(track: TrackModel | undefined): Promise<void> {
        if (track == undefined) {
            this._lyrics = undefined;
            return;
        }

        if (this.previousTrackPath === track.path && this._lyrics != undefined) {
            return;
        }

        this._isBusy = true;
        this._lyrics = await this.lyricsService.getLyricsAsync(track);
        this._isBusy = false;

        this.previousTrackPath = track.path;
    }

    public async openEnterLyricsDialogAsync(): Promise<void> {
        if (!this.dialog) {
            return;
        }

        const currentPlaybackInfo = await this.playbackInformationService.getCurrentPlaybackInformationAsync();
        if (!currentPlaybackInfo?.track) {
            return;
        }

        const dialogRef = this.dialog.open(EnterLyricsDialogComponent, {
            width: '600px',
            data: {
                track: currentPlaybackInfo.track,
                initialLyrics: this._lyrics?.plainText || '',
            },
        });

        const result: LyricsModel | undefined = await dialogRef.afterClosed().toPromise();
        if (result) {
            this._lyrics = result;
            this.previousTrackPath = currentPlaybackInfo.track.path;
            this.lyricsService.setCustomLyrics(result);
        }
    }
}
