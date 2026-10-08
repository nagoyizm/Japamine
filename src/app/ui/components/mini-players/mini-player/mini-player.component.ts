/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    ChangeDetectorRef,
    Component,
    OnDestroy,
    OnInit,
    Optional,
    ViewEncapsulation,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Logger } from '../../../../common/logger';
import { StringUtils } from '../../../../common/utils/string-utils';
import { LyricsModel } from '../../../../services/lyrics/lyrics-model';
import { LyricsServiceBase } from '../../../../services/lyrics/lyrics.service.base';
import { PlaybackProgress } from '../../../../services/playback/playback-progress';
import { PlaybackStarted } from '../../../../services/playback/playback-started';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { TrackModel } from '../../../../services/track/track-model';
import { TrackServiceBase } from '../../../../services/track/track.service.base';
import { LyricsRomanizationService } from '../../../../services/lyrics/lyrics-romanization.service';
import { KaraokeroAlignmentService } from '../../../../services/lyrics/karaokero-alignment.service';
import { PromiseUtils } from '../../../../common/utils/promise-utils';
import { SwitchPlayerService } from '../../../../services/player-switcher/switch-player.service';
import { ApplicationBase } from '../../../../common/io/application.base';
import { DesktopBase } from '../../../../common/io/desktop.base';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { MatDialog } from '@angular/material/dialog';
import { EnterLyricsDialogComponent } from '../../dialogs/enter-lyrics-dialog/enter-lyrics-dialog.component';

@Component({
    selector: 'app-mini-player',
    host: { style: 'display: block; width: 100%; height: 100%;' },
    templateUrl: './mini-player.component.html',
    styleUrls: ['./mini-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class MiniPlayerComponent implements OnInit, OnDestroy {
    private readonly subscription: Subscription = new Subscription();
    private lyricsTrackingIntervalId: number | undefined = undefined;
    private userScrollTimeoutId: number | undefined = undefined;

    // Playback state
    public nowPlayingTracks: TrackModel[] = [];
    public nowPlayingFolderName: string = '';

    // Lyrics state
    public nowPlayingLyrics: LyricsModel | undefined = undefined;
    public isLyricsLoading: boolean = false;
    public activeLyricIndex: number = -1;
    public isUserScrollingLyrics: boolean = false;
    public lyricsTextMode: 'romaji' | 'both' | 'original' = 'romaji';
    public isRomanizingLyrics: boolean = false;
    public isLyricsEstimated: boolean = false;
    public isAligningLyrics: boolean = false;
    public rejectedLyricsTracks: Set<string> = new Set<string>();

    public get displayedFoundTitle(): string {
        const matched = this.nowPlayingLyrics?.matchedTitle;
        if (matched !== undefined && matched !== '') {
            return matched;
        }
        const raw = this.nowPlayingLyrics?.track?.rawTitle;
        if (raw !== undefined && raw !== '') {
            return raw;
        }
        const fn = this.nowPlayingLyrics?.track?.fileName;
        return fn !== undefined && fn !== '' ? fn : '';
    }

    public get displayedFoundArtist(): string {
        const matched = this.nowPlayingLyrics?.matchedArtist;
        if (matched !== undefined && matched !== '') {
            return matched;
        }
        const raw = this.nowPlayingLyrics?.track?.rawFirstArtist;
        return raw !== undefined && raw !== '' ? raw : '';
    }

    public get candidateIndexInfo(): { current: number; total: number } | undefined {
        return this.lyricsService?.getCandidateIndexInfo();
    }

    public get hasNextAlternative(): boolean {
        return this.lyricsService?.hasNextAlternative() ?? false;
    }

    public async rejectCurrentLyrics(): Promise<void> {
        const track = this.playbackService.currentTrack;
        if (track == null || this.lyricsService == null) {
            return;
        }

        if (this.lyricsService.hasNextAlternative()) {
            try {
                const nextLyrics = await this.lyricsService.getNextAlternativeLyricsAsync(track);
                if (nextLyrics != null && !StringUtils.isNullOrWhiteSpace(nextLyrics.plainText)) {
                    this.nowPlayingLyrics = nextLyrics;
                    this.activeLyricIndex = -1;
                    if (
                        this.romanizationService != null &&
                        this.romanizationService.containsJapanese(nextLyrics.plainText)
                    ) {
                        try {
                            await this.romanizationService.romanizeLyricsAsync(nextLyrics);
                        } catch {
                            // ignore
                        }
                    }
                    this.cd.detectChanges();
                    return;
                }
            } catch {
                // ignore
            }
        }

        if (track?.path !== undefined && track.path !== '') {
            this.rejectedLyricsTracks.add(track.path);
        }
        if (this.lyricsService != null) {
            this.lyricsService.clearCache();
        }
        this.nowPlayingLyrics = undefined;
        this.activeLyricIndex = -1;
        this.cd.detectChanges();
    }

    public constructor(
        public readonly playbackService: PlaybackService,
        private readonly trackService: TrackServiceBase,
        private readonly logger: Logger,
        private readonly cd: ChangeDetectorRef,
        private readonly switchPlayerService: SwitchPlayerService,
        private readonly application: ApplicationBase,
        private readonly desktop: DesktopBase,
        private readonly settings: SettingsBase,
        @Optional() private readonly lyricsService?: LyricsServiceBase,
        @Optional() private readonly romanizationService?: LyricsRomanizationService,
        @Optional() public readonly karaokeroAlignmentService?: KaraokeroAlignmentService,
        @Optional() private readonly dialog?: MatDialog,
    ) {}

    // ─── Getters ──────────────────────────────────────────────────────────────

    public get hasLyrics(): boolean {
        return this.nowPlayingLyrics != null && !StringUtils.isNullOrWhiteSpace(this.nowPlayingLyrics.plainText);
    }

    public get canAlignWithKaraokero(): boolean {
        return this.karaokeroAlignmentService?.isAvailable() ?? false;
    }

    public async alignCurrentLyricsWithKaraokeroAsync(): Promise<void> {
        const currentTrack = this.playbackService.currentTrack;
        if (!currentTrack || !this.nowPlayingLyrics || !this.karaokeroAlignmentService) { return; }

        this.isAligningLyrics = true;
        this.cd.detectChanges();

        try {
            const aligned = await this.karaokeroAlignmentService.alignLyricsAsync(
                currentTrack,
                this.nowPlayingLyrics.plainText,
            );
            if (aligned) {
                if (this.romanizationService) {
                    await this.romanizationService.romanizeLyricsAsync(aligned);
                }
                this.nowPlayingLyrics = aligned;
                if (this.lyricsService) {
                    this.lyricsService.setCustomLyrics(aligned);
                }
                this.startLyricsTracking();
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Error al alinear con Karaokero', 'MiniPlayerComponent', 'alignCurrentLyricsWithKaraokeroAsync');
        } finally {
            this.isAligningLyrics = false;
            this.cd.detectChanges();
        }
    }

    public async openEnterLyricsDialogAsync(): Promise<void> {
        if (!this.dialog) { return; }
        const currentTrack = this.playbackService.currentTrack;
        if (!currentTrack) { return; }

        const dialogRef = this.dialog.open(EnterLyricsDialogComponent, {
            width: '520px',
            data: {
                track: currentTrack,
                initialLyrics: this.nowPlayingLyrics?.plainText || '',
            },
        });

        const result: LyricsModel | undefined = await dialogRef.afterClosed().toPromise();
        if (result) {
            this.nowPlayingLyrics = result;
            if (this.lyricsService) {
                this.lyricsService.setCustomLyrics(result);
            }
            this.startLyricsTracking();
            this.cd.detectChanges();
        }
    }

    public get hasRichLyrics(): boolean {
        return (
            (this.nowPlayingLyrics?.textLines?.length ?? 0) > 0 &&
            (this.nowPlayingLyrics?.startTimeStamps?.length ?? 0) > 0
        );
    }

    public get containsJapaneseLyrics(): boolean {
        return this.romanizationService?.containsJapanese(this.nowPlayingLyrics?.plainText) ?? false;
    }

    public get lyricsTextModeLabel(): string {
        switch (this.lyricsTextMode) {
            case 'romaji':   return 'Romaji';
            case 'both':     return 'Ambos';
            case 'original': return 'Original';
            default:         return 'Romaji';
        }
    }

    public get isAlwaysOnTop(): boolean {
        return this.settings.miniPlayerAlwaysOnTop;
    }

    public toggleAlwaysOnTop(): void {
        this.settings.miniPlayerAlwaysOnTop = !this.settings.miniPlayerAlwaysOnTop;
        this.desktop.setWindowAlwaysOnTop(this.settings.miniPlayerAlwaysOnTop);
        this.cd.detectChanges();
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    public ngOnInit(): void {
        if (this.settings.miniPlayerAlwaysOnTop) {
            this.desktop.setWindowAlwaysOnTop(true);
        }

        this.subscription.add(
            this.playbackService.playbackStarted$.subscribe((started: PlaybackStarted) => {
                PromiseUtils.noAwait(this.loadNowPlayingDataAsync(started.currentTrack));
                PromiseUtils.noAwait(this.loadLyricsAsync(started.currentTrack));
                this.startLyricsTracking();
            }),
        );

        this.subscription.add(
            this.playbackService.playbackStopped$.subscribe(() => {
                this.clearState();
                this.stopLyricsTracking();
            }),
        );

        if (this.playbackService.progressChanged$ != null) {
            this.subscription.add(
                this.playbackService.progressChanged$.subscribe((progress: PlaybackProgress) => {
                    this.updateActiveLyricsIndex(progress.progressSeconds);
                }),
            );
        }

        if (this.playbackService.playbackPaused$ != null) {
            this.subscription.add(this.playbackService.playbackPaused$.subscribe(() => this.stopLyricsTracking()));
        }

        if (this.playbackService.playbackResumed$ != null) {
            this.subscription.add(this.playbackService.playbackResumed$.subscribe(() => this.startLyricsTracking()));
        }

        // Load current track immediately if already playing
        if (this.playbackService.currentTrack != null) {
            PromiseUtils.noAwait(this.loadNowPlayingDataAsync(this.playbackService.currentTrack));
            PromiseUtils.noAwait(this.loadLyricsAsync(this.playbackService.currentTrack));
            this.startLyricsTracking();
        }
    }

    public ngOnDestroy(): void {
        this.stopLyricsTracking();
        this.subscription.unsubscribe();
    }

    // ─── Actions ──────────────────────────────────────────────────────────────

    /** Handle dragging the mini player window by its titlebar */
    public onTitleBarMouseDown(event: MouseEvent): void {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest('button') || target.closest('.no-drag')) return;

        try {
            const win = this.application.getCurrentWindow();
            if (!win) return;

            const startX = event.screenX;
            const startY = event.screenY;
            const [winX, winY] = win.getPosition();

            const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = moveEvent.screenX - startX;
                const deltaY = moveEvent.screenY - startY;
                win.setPosition(winX + deltaX, winY + deltaY);
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        } catch (e: unknown) {
            this.logger.warn('Could not move mini-player window via mouse events', 'MiniPlayerComponent', 'onTitleBarMouseDown');
        }
    }

    /** Restore full player window */
    public async restoreFullPlayer(): Promise<void> {
        await this.switchPlayerService.togglePlayerAsync();
    }

    public async closeMiniPlayer(): Promise<void> {
        await this.restoreFullPlayer();
    }

    public minimizeWindow(): void {
        try {
            const win = this.application.getCurrentWindow();
            win.minimize();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not minimize window', 'MiniPlayerComponent', 'minimizeWindow');
        }
    }

    public closeWindow(): void {
        try {
            const win = this.application.getCurrentWindow();
            if (this.application.getGlobal('isMacOS') === true) {
                win.hide();
            } else {
                win.close();
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Could not close window', 'MiniPlayerComponent', 'closeWindow');
        }
    }

    public async onPlayTrackAsync(track: TrackModel): Promise<void> {
        try {
            await this.playbackService.enqueueAndPlayTracksStartingFromGivenTrackAsync(
                this.nowPlayingTracks,
                track,
            );
        } catch (e: unknown) {
            this.logger.error(e, 'Could not play track in mini player', 'MiniPlayerComponent', 'onPlayTrackAsync');
        }
    }

    public async onLyricLineClickAsync(index: number): Promise<void> {
        const targetSeconds = this.nowPlayingLyrics?.startTimeStamps?.[index];
        if (targetSeconds !== undefined) {
            await this.playbackService.skipToSecondsAsync(targetSeconds);
        }
    }

    public cycleLyricsTextMode(): void {
        if (this.lyricsTextMode === 'romaji') {
            this.lyricsTextMode = 'both';
        } else if (this.lyricsTextMode === 'both') {
            this.lyricsTextMode = 'original';
        } else {
            this.lyricsTextMode = 'romaji';
        }
        this.cd.detectChanges();
    }

    public onLyricsScroll(): void {
        this.isUserScrollingLyrics = true;
        if (this.userScrollTimeoutId !== undefined) {
            window.clearTimeout(this.userScrollTimeoutId);
        }
        this.userScrollTimeoutId = window.setTimeout(() => {
            this.isUserScrollingLyrics = false;
        }, 3500);
    }

    public getLineMainText(index: number): string {
        if (this.nowPlayingLyrics == null) { return ''; }
        const orig = this.nowPlayingLyrics.textLines?.[index] ?? '';
        const romaji = this.nowPlayingLyrics.romanizedLines?.[index];
        if (this.lyricsTextMode === 'romaji' || this.lyricsTextMode === 'both') {
            return (romaji !== undefined && romaji.trim().length > 0) ? romaji : orig;
        }
        return orig;
    }

    public getLineSubText(index: number): string | null {
        if (this.nowPlayingLyrics == null || this.lyricsTextMode !== 'both') { return null; }
        const orig = this.nowPlayingLyrics.textLines?.[index] ?? '';
        const romaji = this.nowPlayingLyrics.romanizedLines?.[index];
        if (romaji !== undefined && romaji !== '' && orig !== '' && romaji.trim().toLowerCase() !== orig.trim().toLowerCase()) { return orig; }
        return null;
    }

    public formatTimestamp(seconds?: number): string {
        if (seconds === undefined || Number.isNaN(seconds)) { return ''; }
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private async loadNowPlayingDataAsync(track: TrackModel | undefined): Promise<void> {
        if (track?.path === undefined || track.path === '') { return; }
        try {
            const folderPath = this.getDirectoryFromPath(track.path);
            this.nowPlayingFolderName = this.extractFolderName(folderPath);
            const result = await this.trackService.getTracksInSubfolderAsync(folderPath);
            this.nowPlayingTracks = result != null ? result.tracks : [];
            this.updateTracksPlayingState(track);
            this.cd.detectChanges();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load tracks for mini player', 'MiniPlayerComponent', 'loadNowPlayingDataAsync');
        }
    }

    private updateTracksPlayingState(track: TrackModel | undefined): void {
        for (const t of this.nowPlayingTracks) {
            t.isPlaying = track != undefined && t.path?.toLowerCase() === track.path?.toLowerCase();
        }
    }

    private async loadLyricsAsync(track: TrackModel | undefined): Promise<void> {
        if (track == null || this.lyricsService == null) {
            this.nowPlayingLyrics = undefined;
            this.activeLyricIndex = -1;
            this.isLyricsLoading = false;
            return;
        }

        if (track.path !== undefined && track.path !== '' && this.rejectedLyricsTracks.has(track.path)) {
            this.nowPlayingLyrics = undefined;
            this.activeLyricIndex = -1;
            this.isLyricsLoading = false;
            return;
        }

        try {
            this.isLyricsLoading = true;
            this.activeLyricIndex = -1;
            this.nowPlayingLyrics = await this.lyricsService.getLyricsAsync(track);

            if (this.nowPlayingLyrics != null) {
                this.ensureLyricsTimings(this.nowPlayingLyrics);
            }

            // Auto-align with audio using Karaokero AI if available and plain lyrics have no timestamps
            if (
                this.nowPlayingLyrics != null &&
                (this.nowPlayingLyrics.startTimeStamps?.length ?? 0) === 0 &&
                this.canAlignWithKaraokero
            ) {
                void this.alignCurrentLyricsWithKaraokeroAsync();
            }

            if (
                this.nowPlayingLyrics != null &&
                this.romanizationService?.containsJapanese(this.nowPlayingLyrics.plainText) === true
            ) {
                this.isRomanizingLyrics = true;
                try {
                    await this.romanizationService.romanizeLyricsAsync(this.nowPlayingLyrics);
                } finally {
                    this.isRomanizingLyrics = false;
                    this.cd.detectChanges();
                }
            }

            this.cd.detectChanges();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load lyrics for mini player', 'MiniPlayerComponent', 'loadLyricsAsync');
            this.nowPlayingLyrics = undefined;
        } finally {
            this.isLyricsLoading = false;
            this.cd.detectChanges();
        }
    }

    private ensureLyricsTimings(lyrics: LyricsModel): void {
        this.isLyricsEstimated = false;
        if (lyrics == null || StringUtils.isNullOrWhiteSpace(lyrics.plainText)) { return; }

        this.parseLrcTimestampsIfPresent(lyrics);

        if ((lyrics.startTimeStamps != null && lyrics.startTimeStamps.length > 0) &&
            (lyrics.textLines != null && lyrics.textLines.length > 0)) { return; }

        if (lyrics.textLines == null || lyrics.textLines.length === 0) {
            lyrics.textLines = lyrics.plainText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
        }
    }

    private parseLrcTimestampsIfPresent(lyrics: LyricsModel): void {
        if (StringUtils.isNullOrWhiteSpace(lyrics.plainText)) { return; }
        const lrcRegex = /\[\d{1,3}:\d{2}[.:]\d{2,3}\]/;
        if (!lrcRegex.test(lyrics.plainText)) { return; }

        const lines = lyrics.plainText.split(/\r?\n/);
        const { textLines, startTimeStamps, cleanedPlainText } = this.processLrcLines(lines);

        if (textLines.length > 0 && startTimeStamps.length > 0) {
            lyrics.textLines = textLines;
            lyrics.startTimeStamps = startTimeStamps;
            if (cleanedPlainText !== '') { lyrics.plainText = cleanedPlainText; }
        }
    }

    private processLrcLines(lines: string[]): { textLines: string[]; startTimeStamps: number[]; cleanedPlainText: string } {
        const textLines: string[] = [];
        const startTimeStamps: number[] = [];
        let cleanedPlainText = '';

        for (const line of lines) {
            const parsed = this.parseLrcLine(line);
            if (parsed != null) {
                for (const ts of parsed.timestamps) {
                    textLines.push(parsed.cleanText);
                    startTimeStamps.push(ts);
                }
                if (parsed.cleanText !== '') {
                    if (cleanedPlainText.length > 0) { cleanedPlainText += '\n'; }
                    cleanedPlainText += parsed.cleanText;
                }
            }
        }

        return { textLines, startTimeStamps, cleanedPlainText };
    }

    private parseLrcLine(line: string): { cleanText: string; timestamps: number[] } | undefined {
        const lineRegex = /\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]/g;
        const matches: number[] = [];
        let match: RegExpExecArray | null;
        while ((match = lineRegex.exec(line)) !== null) {
            const minutes = Number.parseInt(match[1], 10);
            const seconds = Number.parseInt(match[2], 10);
            const fraction = match[3];
            const fractionalSeconds = Number.parseInt(fraction, 10) / Math.pow(10, fraction.length);
            matches.push(minutes * 60 + seconds + fractionalSeconds);
        }
        if (matches.length === 0) {
            return undefined;
        }
        const cleanText = line.replace(/\[\d{1,3}:\d{2}[.:]\d{2,3}\]/g, '').trim();
        return { cleanText, timestamps: matches };
    }

    public startLyricsTracking(): void {
        this.stopLyricsTracking();
        this.lyricsTrackingIntervalId = window.setInterval(() => {
            if (this.nowPlayingLyrics == null || !this.playbackService.isPlaying) { return; }
            const progress = this.playbackService.getCurrentProgress();
            if (progress != null) {
                this.updateActiveLyricsIndex(progress.progressSeconds);
            }
        }, 200);
    }

    public stopLyricsTracking(): void {
        if (this.lyricsTrackingIntervalId !== undefined) {
            window.clearInterval(this.lyricsTrackingIntervalId);
            this.lyricsTrackingIntervalId = undefined;
        }
    }

    public updateActiveLyricsIndex(progressSeconds: number): void {
        if ((this.nowPlayingLyrics?.startTimeStamps?.length ?? 0) === 0) {
            if (this.activeLyricIndex !== -1) {
                this.activeLyricIndex = -1;
                this.cd.detectChanges();
            }
            return;
        }

        const stamps = this.nowPlayingLyrics!.startTimeStamps!;
        let activeIdx = -1;
        for (let i = 0; i < stamps.length; i++) {
            if (stamps[i] <= progressSeconds) { activeIdx = i; } else { break; }
        }

        if (this.activeLyricIndex !== activeIdx) {
            this.activeLyricIndex = activeIdx;
            if (!this.isUserScrollingLyrics && activeIdx >= 0) {
                this.scrollToActiveLyricLine(activeIdx);
            }
            this.cd.detectChanges();
        }
    }

    private scrollToActiveLyricLine(index: number): void {
        const elem = document.getElementById(`mini-lyric-line-${index}`);
        if (elem) { elem.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }

    private clearState(): void {
        this.nowPlayingLyrics = undefined;
        this.activeLyricIndex = -1;
        this.isLyricsLoading = false;
        this.isRomanizingLyrics = false;
        this.isLyricsEstimated = false;
        this.nowPlayingTracks.forEach((t) => (t.isPlaying = false));
        this.cd.detectChanges();
    }

    private trimTrailingSlashes(str: string): string {
        let end = str.length;
        while (end > 0 && (str[end - 1] === '/' || str[end - 1] === '\\')) {
            end--;
        }
        return str.substring(0, end);
    }

    private getDirectoryFromPath(filePath: string): string {
        if (filePath === '') { return ''; }
        const clean = this.trimTrailingSlashes(filePath);
        const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
        return lastSlash > 0 ? clean.substring(0, lastSlash) : clean;
    }

    private extractFolderName(folderPath: string): string {
        if (folderPath === '') { return ''; }
        const clean = this.trimTrailingSlashes(folderPath);
        const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
        return lastSlash >= 0 ? clean.substring(lastSlash + 1) : clean;
    }
}
