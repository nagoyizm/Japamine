import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    OnDestroy,
    OnInit,
    Optional,
    ViewChild,
    ViewEncapsulation,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { shell } from 'electron';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { LyricsServiceBase } from '../../../../services/lyrics/lyrics.service.base';
import { KaraokeroAlignmentService } from '../../../../services/lyrics/karaokero-alignment.service';
import { LyricsRomanizationService } from '../../../../services/lyrics/lyrics-romanization.service';
import { LyricsModel } from '../../../../services/lyrics/lyrics-model';
import { TrackModel } from '../../../../services/track/track-model';
import { LyricsSourceType } from '../../../../common/api/lyrics/lyrics-source-type';
import { StringUtils } from '../../../../common/utils/string-utils';
import { LyricsFilterUtils } from '../../../../common/utils/lyrics-filter.utils';
import { Logger } from '../../../../common/logger';
import { EnterLyricsDialogComponent } from '../../dialogs/enter-lyrics-dialog/enter-lyrics-dialog.component';
import { PlaybackStarted } from '../../../../services/playback/playback-started';
import { PlaybackProgress } from '../../../../services/playback/playback-progress';
import { LrclibApi } from '../../../../common/api/lyrics/lrclib.api';

@Component({
    selector: 'app-collection-lyrics-panel',
    templateUrl: './collection-lyrics-panel.component.html',
    styleUrls: ['./collection-lyrics-panel.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class CollectionLyricsPanelComponent implements OnInit, OnDestroy {
    @ViewChild('lyricsScrollContainer')
    public lyricsScrollContainer?: ElementRef<HTMLDivElement>;

    private subscriptions: Subscription = new Subscription();

    public nowPlayingLyrics: LyricsModel | undefined = undefined;
    public isLyricsLoading: boolean = false;
    public isManualLyricsLoading: boolean = false;
    public isRomanizingLyrics: boolean = false;
    public isAligningLyrics: boolean = false;

    public showRichLyrics: boolean = true;
    public lyricsTextMode: 'both' | 'romaji' | 'original' = 'both';
    public activeLyricIndex: number = -1;
    public isUserScrollingLyrics: boolean = false;
    private userScrollTimeout: any = null;

    public isManualLyricsSearchOpen: boolean = false;
    public manualLyricsQuery: string = '';
    public manualLyricsNotFound: boolean = false;
    public lyricsSearchSuggestions: string[] = [];
    public lyricsRejectedNotice: boolean = false;
    public candidateSwitchNotice: string = '';
    public isConfirmingLyrics: boolean = false;
    public isLyricsConfirmed: boolean = false;

    private rejectedLyricsTracks: Set<string> = new Set<string>();
    private confirmedTracks: Set<string> = new Set<string>();

    public constructor(
        public readonly playbackService: PlaybackService,
        private readonly lyricsService: LyricsServiceBase,
        private readonly dialog: MatDialog,
        private readonly logger: Logger,
        private readonly cd: ChangeDetectorRef,
        @Optional() public readonly karaokeroAlignmentService?: KaraokeroAlignmentService,
        @Optional() private readonly romanizationService?: LyricsRomanizationService,
        @Optional() private readonly lrclibApi?: LrclibApi,
    ) {}

    private lyricsTrackingIntervalId: number | undefined;

    public ngOnInit(): void {
        if (this.playbackService.playbackStarted$) {
            this.subscriptions.add(
                this.playbackService.playbackStarted$.subscribe((playbackStarted: PlaybackStarted) => {
                    void this.loadLyricsAsync(playbackStarted.currentTrack);
                    this.startLyricsTracking();
                }),
            );
        }

        if (this.playbackService.playbackStopped$) {
            this.subscriptions.add(
                this.playbackService.playbackStopped$.subscribe(() => {
                    this.clearLyricsState();
                    this.stopLyricsTracking();
                }),
            );
        }

        if (this.playbackService.playbackPaused$) {
            this.subscriptions.add(
                this.playbackService.playbackPaused$.subscribe(() => {
                    this.stopLyricsTracking();
                }),
            );
        }

        if (this.playbackService.playbackResumed$) {
            this.subscriptions.add(
                this.playbackService.playbackResumed$.subscribe(() => {
                    this.startLyricsTracking();
                }),
            );
        }

        if (this.playbackService.progressChanged$) {
            this.subscriptions.add(
                this.playbackService.progressChanged$.subscribe((progress: PlaybackProgress) => {
                    this.updateActiveLyricsIndex(progress.progressSeconds);
                }),
            );
        }

        if (this.playbackService.playbackSkipped$) {
            this.subscriptions.add(
                this.playbackService.playbackSkipped$.subscribe(() => {
                    this.activeLyricIndex = -1;
                    const prog = this.playbackService.getCurrentProgress?.();
                    if (prog != null) {
                        this.updateActiveLyricsIndex(prog.progressSeconds);
                    }
                }),
            );
        }

        if (this.playbackService.currentTrack) {
            void this.loadLyricsAsync(this.playbackService.currentTrack);
            if (this.playbackService.isPlaying) {
                this.startLyricsTracking();
            }
        }
    }

    public ngOnDestroy(): void {
        this.subscriptions.unsubscribe();
        this.stopLyricsTracking();
        if (this.userScrollTimeout) {
            clearTimeout(this.userScrollTimeout);
        }
    }

    public startLyricsTracking(): void {
        this.stopLyricsTracking();
        this.lyricsTrackingIntervalId = window.setInterval(() => {
            if (this.nowPlayingLyrics == null || !this.playbackService.isPlaying) {
                return;
            }
            if (typeof this.playbackService.getCurrentProgress === 'function') {
                const progress = this.playbackService.getCurrentProgress();
                if (progress != null) {
                    this.updateActiveLyricsIndex(progress.progressSeconds);
                }
            }
        }, 200);
    }

    public stopLyricsTracking(): void {
        if (this.lyricsTrackingIntervalId !== undefined) {
            window.clearInterval(this.lyricsTrackingIntervalId);
            this.lyricsTrackingIntervalId = undefined;
        }
    }

    public clearLyricsState(): void {
        this.nowPlayingLyrics = undefined;
        this.activeLyricIndex = -1;
        this.isLyricsLoading = false;
        this.isManualLyricsLoading = false;
        this.isRomanizingLyrics = false;
        this.isAligningLyrics = false;
        this.lyricsRejectedNotice = false;
        this.candidateSwitchNotice = '';
        this.lyricsSearchSuggestions = [];
        this.isLyricsConfirmed = false;
        this.isConfirmingLyrics = false;
        this.cd.markForCheck();
    }

    public get hasLyrics(): boolean {
        return this.nowPlayingLyrics != null && !StringUtils.isNullOrWhiteSpace(this.nowPlayingLyrics.plainText);
    }

    public get hasRichLyrics(): boolean {
        return (
            (this.nowPlayingLyrics?.textLines?.length ?? 0) > 0 &&
            (this.nowPlayingLyrics?.startTimeStamps?.length ?? 0) > 0
        );
    }

    public get canAlignWithKaraokero(): boolean {
        return this.karaokeroAlignmentService?.isAvailable() ?? false;
    }

    public get containsJapaneseLyrics(): boolean {
        return this.romanizationService?.containsJapanese(this.nowPlayingLyrics?.plainText) ?? false;
    }

    public get lyricsTextModeLabel(): string {
        switch (this.lyricsTextMode) {
            case 'both':
                return 'Ambos';
            case 'romaji':
                return 'Romaji';
            case 'original':
                return 'Original';
        }
    }

    public get lyricsSourceLabel(): string {
        if (this.nowPlayingLyrics == null) {
            return '';
        }
        switch (this.nowPlayingLyrics.sourceType) {
            case LyricsSourceType.embedded:
                return 'Archivo';
            case LyricsSourceType.lrc:
                return 'LRC';
            case LyricsSourceType.srt:
                return 'SRT';
            case LyricsSourceType.online:
                return this.nowPlayingLyrics.sourceName !== '' ? this.nowPlayingLyrics.sourceName : 'Online';
            default:
                return '';
        }
    }

    public get displayedFoundTitle(): string {
        return (
            this.nowPlayingLyrics?.matchedTitle ||
            this.nowPlayingLyrics?.track?.rawTitle ||
            this.nowPlayingLyrics?.track?.fileName ||
            ''
        );
    }

    public get displayedFoundArtist(): string {
        return (
            this.nowPlayingLyrics?.matchedArtist ||
            this.nowPlayingLyrics?.track?.rawFirstArtist ||
            ''
        );
    }

    public get candidateIndexInfo(): { current: number; total: number } | undefined {
        return this.lyricsService?.getCandidateIndexInfo();
    }

    public get hasPreviousAlternative(): boolean {
        const info = this.candidateIndexInfo;
        return info !== undefined && info.current > 1;
    }

    public get hasNextAlternative(): boolean {
        return this.lyricsService?.hasNextAlternative() ?? false;
    }

    public get isLyricsFromLrclib(): boolean {
        return (this.nowPlayingLyrics?.sourceName ?? '').trim().toUpperCase() === 'LRCLIB';
    }

    public toggleLyricsMode(): void {
        this.showRichLyrics = !this.showRichLyrics;
    }

    public cycleLyricsTextMode(): void {
        if (this.lyricsTextMode === 'both') {
            this.lyricsTextMode = 'romaji';
        } else if (this.lyricsTextMode === 'romaji') {
            this.lyricsTextMode = 'original';
        } else {
            this.lyricsTextMode = 'both';
        }
    }

    public async loadLyricsAsync(track: TrackModel | undefined): Promise<void> {
        if (track == null) {
            this.nowPlayingLyrics = undefined;
            this.activeLyricIndex = -1;
            this.isLyricsLoading = false;
            return;
        }

        if (track.path && this.rejectedLyricsTracks.has(track.path)) {
            this.nowPlayingLyrics = undefined;
            this.activeLyricIndex = -1;
            this.isLyricsLoading = false;
            this.lyricsRejectedNotice = true;
            this.generateLyricsSearchSuggestions(track);
            return;
        }
        this.lyricsRejectedNotice = false;
        this.isLyricsConfirmed = track.path ? this.confirmedTracks.has(track.path) : false;

        try {
            this.isLyricsLoading = true;
            this.activeLyricIndex = -1;
            this.nowPlayingLyrics = await this.lyricsService.getLyricsAsync(track);

            if (this.nowPlayingLyrics != null) {
                LyricsFilterUtils.sanitizeLyricsModel(this.nowPlayingLyrics, track);
                this.ensureLyricsTimings(this.nowPlayingLyrics);
            }

            // Auto-align with Karaokero AI if plain lyrics have no timestamps
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
                } catch (e: unknown) {
                    this.logger.error(e, 'Could not romanize lyrics', 'CollectionLyricsPanelComponent', 'loadLyricsAsync');
                } finally {
                    this.isRomanizingLyrics = false;
                }
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load lyrics', 'CollectionLyricsPanelComponent', 'loadLyricsAsync');
            this.nowPlayingLyrics = undefined;
        } finally {
            this.isLyricsLoading = false;
            this.generateLyricsSearchSuggestions(track);
            this.cd.detectChanges();
        }
    }

    public async alignCurrentLyricsWithKaraokeroAsync(): Promise<void> {
        const track = this.playbackService.currentTrack;
        if (track == null || this.nowPlayingLyrics == null || this.karaokeroAlignmentService == null) {
            return;
        }

        this.isAligningLyrics = true;
        this.cd.detectChanges();

        try {
            const aligned = await this.karaokeroAlignmentService.alignLyricsAsync(
                track,
                this.nowPlayingLyrics.plainText,
            );

            if (aligned != null && aligned.startTimeStamps && aligned.startTimeStamps.length > 0) {
                this.nowPlayingLyrics = aligned;
                this.showRichLyrics = true;
                if (this.romanizationService && this.romanizationService.containsJapanese(this.nowPlayingLyrics.plainText)) {
                    await this.romanizationService.romanizeLyricsAsync(this.nowPlayingLyrics);
                }
                this.activeLyricIndex = -1;
                this.updateActiveLyricsIndex();
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Karaokero alignment failed', 'CollectionLyricsPanelComponent', 'alignCurrentLyricsWithKaraokeroAsync');
        } finally {
            this.isAligningLyrics = false;
            this.cd.detectChanges();
        }
    }

    public openEnterLyricsDialog(): void {
        const track = this.playbackService.currentTrack;
        if (!track) {
            return;
        }

        const dialogRef = this.dialog.open(EnterLyricsDialogComponent, {
            width: '640px',
            data: {
                track,
                initialLyrics: this.nowPlayingLyrics?.plainText ?? '',
            },
        });

        dialogRef.afterClosed().subscribe(async (result: LyricsModel | undefined) => {
            if (result) {
                this.nowPlayingLyrics = result;
                this.lyricsRejectedNotice = false;
                this.activeLyricIndex = -1;
                this.showRichLyrics = (result.startTimeStamps?.length ?? 0) > 0;

                if (this.romanizationService && this.romanizationService.containsJapanese(result.plainText)) {
                    this.isRomanizingLyrics = true;
                    try {
                        await this.romanizationService.romanizeLyricsAsync(result);
                    } catch {}
                    this.isRomanizingLyrics = false;
                }

                this.updateActiveLyricsIndex();
                this.cd.detectChanges();
            }
        });
    }

    public async confirmCurrentLyricsAsync(): Promise<void> {
        const track = this.playbackService.currentTrack;
        if (!track || !this.nowPlayingLyrics) {
            return;
        }

        if (track.path) {
            this.confirmedTracks.add(track.path);
            this.rejectedLyricsTracks.delete(track.path);
        }
        this.isLyricsConfirmed = true;

        const artist = track.rawFirstArtist || track.artists || '';
        const title = track.rawTitle || track.title || '';

        // If lyrics already came directly from LRCLIB, do not re-upload since they already exist there
        if (this.isLyricsFromLrclib) {
            this.candidateSwitchNotice = '✓ Letra confirmada (obtenida de LRCLIB)';
            setTimeout(() => {
                this.candidateSwitchNotice = '';
                this.cd.detectChanges();
            }, 4000);
            return;
        }

        if (!this.lrclibApi || !artist || !title) {
            this.candidateSwitchNotice = '✓ Letra confirmada como correcta';
            setTimeout(() => {
                this.candidateSwitchNotice = '';
                this.cd.detectChanges();
            }, 4000);
            return;
        }

        this.isConfirmingLyrics = true;
        this.candidateSwitchNotice = 'Enviando validación a LRCLIB...';
        this.cd.detectChanges();

        try {
            const linesToSend = (this.nowPlayingLyrics.romanizedLines && this.nowPlayingLyrics.romanizedLines.length === this.nowPlayingLyrics.textLines?.length)
                ? this.nowPlayingLyrics.romanizedLines.map((rom, idx) => (rom && rom.trim().length > 0 ? rom : this.nowPlayingLyrics!.textLines![idx]))
                : this.nowPlayingLyrics.textLines ?? [];

            let syncedLyrics: string | undefined = undefined;
            if (
                this.nowPlayingLyrics.startTimeStamps &&
                linesToSend.length > 0 &&
                this.nowPlayingLyrics.startTimeStamps.length > 0 &&
                this.nowPlayingLyrics.startTimeStamps.length === linesToSend.length
            ) {
                syncedLyrics = linesToSend
                    .map((line, idx) => {
                        const sec = this.nowPlayingLyrics!.startTimeStamps![idx] ?? 0;
                        const m = Math.floor(sec / 60);
                        const s = Math.floor(sec % 60);
                        const cs = Math.floor((sec % 1) * 100);
                        const ts = `[${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}.${cs < 10 ? '0' : ''}${cs}]`;
                        return `${ts} ${line}`;
                    })
                    .join('\n');
            }

            const plain = this.nowPlayingLyrics.romanizedPlainText ||
                (this.nowPlayingLyrics.romanizedLines && this.nowPlayingLyrics.romanizedLines.length > 0 ? this.nowPlayingLyrics.romanizedLines.join('\n') : '') ||
                this.nowPlayingLyrics.plainText ||
                this.nowPlayingLyrics.textLines?.join('\n') || '';
            const durationSec = track.durationInMilliseconds > 0 ? Math.round(track.durationInMilliseconds / 1000) : undefined;

            const res = await this.lrclibApi.publishLyricsAsync(
                {
                    trackName: title,
                    artistName: artist,
                    albumName: track.albumTitle || undefined,
                    duration: durationSec,
                    plainLyrics: plain,
                    syncedLyrics: syncedLyrics,
                },
                (status) => {
                    this.candidateSwitchNotice = status;
                    this.cd.detectChanges();
                },
            );

            if (res.success) {
                this.candidateSwitchNotice = '✓ ¡Letra confirmada y compartida en LRCLIB!';
            } else {
                const isAlready = res.error?.toLowerCase().includes('already') || res.error?.toLowerCase().includes('exist');
                this.candidateSwitchNotice = isAlready
                    ? '✓ Letra confirmada (ya validada en LRCLIB)'
                    : '✓ Letra confirmada como correcta';
            }
        } catch (e: unknown) {
            this.candidateSwitchNotice = '✓ Letra confirmada localmente';
        } finally {
            this.isConfirmingLyrics = false;
            this.cd.detectChanges();
            setTimeout(() => {
                this.candidateSwitchNotice = '';
                this.cd.detectChanges();
            }, 4500);
        }
    }

    public async rejectCurrentLyrics(): Promise<void> {
        const track = this.playbackService.currentTrack;
        if (track == null || this.lyricsService == null) {
            return;
        }

        // Automatic advance to the 2nd (or next) candidate if one exists
        if (this.lyricsService.hasNextAlternative()) {
            this.isLyricsLoading = true;
            this.cd.detectChanges();
            try {
                const nextLyrics = await this.lyricsService.getNextAlternativeLyricsAsync(track);
                if (nextLyrics != null && !StringUtils.isNullOrWhiteSpace(nextLyrics.plainText)) {
                    await this.applyManualLyricsResultAsync(nextLyrics, track);
                    const info = this.lyricsService.getCandidateIndexInfo();
                    this.candidateSwitchNotice = info != null
                        ? `Mostrando coincidencia ${info.current} de ${info.total}`
                        : 'Mostrando siguiente coincidencia';
                    setTimeout(() => {
                        this.candidateSwitchNotice = '';
                        this.cd.detectChanges();
                    }, 4000);
                    return;
                }
            } catch (e: unknown) {
                this.logger.error(e, 'Could not get next alternative lyrics', 'CollectionLyricsPanelComponent', 'rejectCurrentLyrics');
            } finally {
                this.isLyricsLoading = false;
                this.cd.detectChanges();
            }
        }

        // No more candidates available: open manual search
        if (track.path !== undefined && track.path !== '') {
            this.rejectedLyricsTracks.add(track.path);
        }
        if (this.lyricsService != null) {
            this.lyricsService.clearCache();
        }
        this.nowPlayingLyrics = undefined;
        this.activeLyricIndex = -1;
        this.isManualLyricsSearchOpen = true;
        this.manualLyricsNotFound = false;
        this.lyricsRejectedNotice = true;
        this.candidateSwitchNotice = '';
        this.generateLyricsSearchSuggestions(track);
        this.cd.detectChanges();
    }

    public async previousCandidateLyrics(): Promise<void> {
        const track = this.playbackService.currentTrack;
        if (track == null || this.lyricsService == null) {
            return;
        }

        this.isLyricsLoading = true;
        this.cd.detectChanges();
        try {
            const prevLyrics = await this.lyricsService.getPreviousAlternativeLyricsAsync(track);
            if (prevLyrics != null && !StringUtils.isNullOrWhiteSpace(prevLyrics.plainText)) {
                await this.applyManualLyricsResultAsync(prevLyrics, track);
                const info = this.lyricsService.getCandidateIndexInfo();
                this.candidateSwitchNotice = info != null
                    ? `Mostrando coincidencia ${info.current} de ${info.total}`
                    : 'Mostrando coincidencia anterior';
                setTimeout(() => {
                    this.candidateSwitchNotice = '';
                    this.cd.detectChanges();
                }, 4000);
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Could not get previous alternative lyrics', 'CollectionLyricsPanelComponent', 'previousCandidateLyrics');
        } finally {
            this.isLyricsLoading = false;
            this.cd.detectChanges();
        }
    }

    public toggleManualLyricsSearch(): void {
        this.isManualLyricsSearchOpen = !this.isManualLyricsSearchOpen;
        this.manualLyricsNotFound = false;
        if (!this.isManualLyricsSearchOpen) {
            this.lyricsRejectedNotice = false;
        }
        if (this.isManualLyricsSearchOpen && StringUtils.isNullOrWhiteSpace(this.manualLyricsQuery)) {
            const track = this.playbackService.currentTrack;
            if (track != null) {
                if (!StringUtils.isNullOrWhiteSpace(track.rawFirstArtist) && !StringUtils.isNullOrWhiteSpace(track.rawTitle)) {
                    this.manualLyricsQuery = `${track.rawFirstArtist} ${track.rawTitle}`;
                } else if (!StringUtils.isNullOrWhiteSpace(track.rawTitle)) {
                    this.manualLyricsQuery = track.rawTitle;
                }
            }
        }
    }

    public async performManualLyricsSearchAsync(searchTermOverride?: string): Promise<void> {
        const query = searchTermOverride ?? this.manualLyricsQuery;
        if (StringUtils.isNullOrWhiteSpace(query) || this.lyricsService == null) {
            return;
        }

        this.manualLyricsQuery = query;

        try {
            this.isManualLyricsLoading = true;
            this.manualLyricsNotFound = false;
            const currentTrack = this.playbackService.currentTrack;
            const result = await this.lyricsService.searchLyricsByQueryAsync(query, currentTrack);

            if (result != null && !StringUtils.isNullOrWhiteSpace(result.plainText)) {
                await this.applyManualLyricsResultAsync(result, currentTrack);
            } else {
                this.manualLyricsNotFound = true;
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Manual lyrics search failed', 'CollectionLyricsPanelComponent', 'performManualLyricsSearchAsync');
            this.manualLyricsNotFound = true;
        } finally {
            this.isManualLyricsLoading = false;
            this.cd.detectChanges();
        }
    }

    private async applyManualLyricsResultAsync(result: LyricsModel, currentTrack: TrackModel | undefined): Promise<void> {
        if (currentTrack?.path !== undefined && currentTrack.path !== '') {
            this.rejectedLyricsTracks.delete(currentTrack.path);
        }
        this.lyricsRejectedNotice = false;
        LyricsFilterUtils.sanitizeLyricsModel(result, currentTrack);
        this.ensureLyricsTimings(result);
        this.nowPlayingLyrics = result;
        this.activeLyricIndex = -1;
        this.isManualLyricsSearchOpen = false;

        if (
            this.nowPlayingLyrics != null &&
            this.romanizationService?.containsJapanese(this.nowPlayingLyrics.plainText) === true
        ) {
            this.isRomanizingLyrics = true;
            try {
                await this.romanizationService.romanizeLyricsAsync(this.nowPlayingLyrics);
            } catch (e: unknown) {
                this.logger.error(e, 'Could not romanize lyrics', 'CollectionLyricsPanelComponent', 'applyManualLyricsResultAsync');
            } finally {
                this.isRomanizingLyrics = false;
            }
        }

        this.updateActiveLyricsIndex();
        this.cd.detectChanges();
    }

    public openGoogleSearch(queryOverride?: string): void {
        const track = this.playbackService.currentTrack;
        let query = queryOverride;
        if (!query && track) {
            query = `${track.artists || ''} ${track.title || track.fileName || ''} lyrics`.trim();
        }
        if (query) {
            const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            void shell.openExternal(url);
        }
    }

    public isDisplayableLyricLine(index: number): boolean {
        if (this.nowPlayingLyrics?.textLines == null || index < 0 || index >= this.nowPlayingLyrics.textLines.length) {
            return false;
        }
        return this.nowPlayingLyrics.textLines[index].trim().length > 0;
    }

    public getLineMainText(index: number): string {
        if (this.nowPlayingLyrics == null) return '';
        const orig = this.nowPlayingLyrics.textLines?.[index] ?? '';
        const romaji = this.nowPlayingLyrics.romanizedLines?.[index];

        if (this.lyricsTextMode === 'original') {
            return orig;
        }

        // Default ('both') or 'romaji' mode: always show romanized text as the prominent singing line
        if (romaji && romaji.trim().length > 0) {
            return romaji;
        }
        return orig;
    }

    public getLineSubText(index: number): string | null {
        if (this.nowPlayingLyrics == null || this.lyricsTextMode !== 'both') return null;
        const orig = this.nowPlayingLyrics.textLines?.[index] ?? '';
        const romaji = this.nowPlayingLyrics.romanizedLines?.[index];

        // In 'both' mode, the original kanji/kana line is displayed as secondary text underneath the romaji
        if (romaji && romaji.trim().length > 0 && romaji.trim().toLowerCase() !== orig.trim().toLowerCase()) {
            return orig;
        }
        return null;
    }

    public async onLyricLineClickAsync(index: number): Promise<void> {
        if (!this.nowPlayingLyrics?.startTimeStamps || index < 0 || index >= this.nowPlayingLyrics.startTimeStamps.length) {
            return;
        }
        const targetSeconds = this.nowPlayingLyrics.startTimeStamps[index];
        if (targetSeconds !== undefined && targetSeconds >= 0) {
            await this.playbackService.skipToSecondsAsync(targetSeconds);
        }
    }

    public onLyricsScroll(): void {
        this.isUserScrollingLyrics = true;
        if (this.userScrollTimeout) {
            clearTimeout(this.userScrollTimeout);
        }
        this.userScrollTimeout = setTimeout(() => {
            this.isUserScrollingLyrics = false;
        }, 4000);
    }

    public formatTimestamp(seconds: number | undefined): string {
        if (seconds == null || isNaN(seconds)) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }

    public updateActiveLyricsIndex(progressSeconds?: number): void {
        if (!this.nowPlayingLyrics?.startTimeStamps?.length) {
            if (this.activeLyricIndex !== -1) {
                this.activeLyricIndex = -1;
                this.cd?.detectChanges();
            }
            return;
        }

        const currentTime = progressSeconds !== undefined ? progressSeconds : this.playbackService.getCurrentProgress?.()?.progressSeconds ?? 0;
        const stamps = this.nowPlayingLyrics.startTimeStamps;

        let index = -1;
        for (let i = 0; i < stamps.length; i++) {
            if (currentTime >= stamps[i]) {
                index = i;
            } else {
                break;
            }
        }

        if (this.activeLyricIndex !== index) {
            this.activeLyricIndex = index;
            this.cd?.detectChanges();
            if (!this.isUserScrollingLyrics && index >= 0) {
                this.scrollToLyricLine(index);
            }
        }
    }

    private scrollToLyricLine(index: number): void {
        const container = this.lyricsScrollContainer?.nativeElement;
        if (!container) return;

        let el = container.querySelector(`#lyric-line-${index}`) as HTMLElement;
        if (!el) {
            for (let offset = 1; offset <= 3; offset++) {
                el = (container.querySelector(`#lyric-line-${index - offset}`) || container.querySelector(`#lyric-line-${index + offset}`)) as HTMLElement;
                if (el) break;
            }
        }
        if (el) {
            const containerRect = container.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const currentScroll = container.scrollTop;
            const targetY = currentScroll + (elRect.top - containerRect.top) - (container.clientHeight / 2) + (elRect.height / 2);
            const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
            const clampedY = Math.max(0, Math.min(targetY, maxScroll));
            container.scrollTo({ top: clampedY, behavior: 'smooth' });
        }
    }

    private ensureLyricsTimings(lyrics: LyricsModel): void {
        if (!lyrics.textLines || lyrics.textLines.length === 0) return;
        if (lyrics.startTimeStamps && lyrics.startTimeStamps.length === lyrics.textLines.length) return;

        if (lyrics.startTimeStamps && lyrics.startTimeStamps.length > 0) {
            while (lyrics.startTimeStamps.length < lyrics.textLines.length) {
                const last = lyrics.startTimeStamps[lyrics.startTimeStamps.length - 1] ?? 0;
                lyrics.startTimeStamps.push(last + 3);
            }
        }
    }

    private generateLyricsSearchSuggestions(track: TrackModel): void {
        const suggestions: string[] = [];
        if (track.rawTitle && track.rawTitle !== track.title) {
            suggestions.push(track.rawTitle);
        }
        if (track.fileName) {
            const cleanFn = track.fileName.replace(/\.[a-zA-Z0-9]+$/, '').replace(/^[0-9]+[\s\-_.]*/, '');
            if (cleanFn.length > 2 && cleanFn !== track.title) {
                suggestions.push(cleanFn);
            }
        }
        this.lyricsSearchSuggestions = suggestions;
    }
}
