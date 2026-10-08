import { ChangeDetectorRef } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { IMock, Mock } from 'typemoq';
import { CollectionLyricsPanelComponent } from './collection-lyrics-panel.component';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { LyricsServiceBase } from '../../../../services/lyrics/lyrics.service.base';
import { Logger } from '../../../../common/logger';
import { PlaybackStarted } from '../../../../services/playback/playback-started';
import { PlaybackProgress } from '../../../../services/playback/playback-progress';

describe('CollectionLyricsPanelComponent', () => {
    let playbackServiceMock: IMock<PlaybackService>;
    let lyricsServiceMock: IMock<LyricsServiceBase>;
    let dialogMock: IMock<MatDialog>;
    let loggerMock: IMock<Logger>;
    let cdMock: IMock<ChangeDetectorRef>;

    let playbackStartedSubject: Subject<PlaybackStarted>;
    let progressChangedSubject: Subject<PlaybackProgress>;
    let playbackStoppedSubject: Subject<void>;
    let playbackPausedSubject: Subject<void>;
    let playbackResumedSubject: Subject<void>;
    let playbackSkippedSubject: Subject<void>;

    let component: CollectionLyricsPanelComponent;

    beforeEach(() => {
        playbackServiceMock = Mock.ofType<PlaybackService>();
        lyricsServiceMock = Mock.ofType<LyricsServiceBase>();
        dialogMock = Mock.ofType<MatDialog>();
        loggerMock = Mock.ofType<Logger>();
        cdMock = Mock.ofType<ChangeDetectorRef>();

        playbackStartedSubject = new Subject<PlaybackStarted>();
        progressChangedSubject = new Subject<PlaybackProgress>();
        playbackStoppedSubject = new Subject<void>();
        playbackPausedSubject = new Subject<void>();
        playbackResumedSubject = new Subject<void>();
        playbackSkippedSubject = new Subject<void>();

        playbackServiceMock.setup((x) => x.playbackStarted$).returns(() => playbackStartedSubject.asObservable());
        playbackServiceMock.setup((x) => x.progressChanged$).returns(() => progressChangedSubject.asObservable());
        playbackServiceMock.setup((x) => x.playbackStopped$).returns(() => playbackStoppedSubject.asObservable());
        playbackServiceMock.setup((x) => x.playbackPaused$).returns(() => playbackPausedSubject.asObservable());
        playbackServiceMock.setup((x) => x.playbackResumed$).returns(() => playbackResumedSubject.asObservable());
        playbackServiceMock.setup((x) => x.playbackSkipped$).returns(() => playbackSkippedSubject.asObservable());

        component = new CollectionLyricsPanelComponent(
            playbackServiceMock.object,
            lyricsServiceMock.object,
            dialogMock.object,
            loggerMock.object,
            cdMock.object,
        );
    });

    afterEach(() => {
        component.ngOnDestroy();
    });

    describe('constructor', () => {
        it('should create component', () => {
            expect(component).toBeDefined();
        });

        it('should have default state', () => {
            expect(component.showRichLyrics).toBe(true);
            expect(component.lyricsTextMode).toBe('both');
            expect(component.isLyricsLoading).toBe(false);
            expect(component.activeLyricIndex).toBe(-1);
        });
    });

    describe('ngOnInit and subscription', () => {
        it('should subscribe and handle lifecycle', () => {
            component.ngOnInit();
            expect(component).toBeDefined();
        });
    });

    describe('confirmCurrentLyricsAsync', () => {
        it('should do nothing if there is no current track or lyrics', async () => {
            playbackServiceMock.setup((x) => x.currentTrack).returns(() => undefined);
            component.nowPlayingLyrics = undefined;

            await component.confirmCurrentLyricsAsync();

            expect(component.isLyricsConfirmed).toBe(false);
            expect(component.candidateSwitchNotice).toBe('');
        });

        it('should mark lyrics as confirmed locally when lrclibApi is not injected', async () => {
            const track = {
                path: 'C:/Music/test.mp3',
                title: 'Test Song',
                artists: 'Test Artist',
                durationInMilliseconds: 180000,
            } as any;
            playbackServiceMock.setup((x) => x.currentTrack).returns(() => track);
            component.nowPlayingLyrics = {
                plainText: 'Line 1\nLine 2',
                textLines: ['Line 1', 'Line 2'],
                startTimeStamps: [0, 5],
            } as any;

            await component.confirmCurrentLyricsAsync();

            expect(component.isLyricsConfirmed).toBe(true);
            expect((component as any).confirmedTracks.has('C:/Music/test.mp3')).toBe(true);
            expect(component.candidateSwitchNotice).toContain('confirmada');
        });
    });
});

