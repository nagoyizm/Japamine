import { MatDialogRef } from '@angular/material/dialog';
import { IMock, Mock, Times } from 'typemoq';
import { EnterLyricsDialogComponent, EnterLyricsDialogData } from './enter-lyrics-dialog.component';
import { KaraokeroAlignmentService } from '../../../../services/lyrics/karaokero-alignment.service';
import { LyricsRomanizationService } from '../../../../services/lyrics/lyrics-romanization.service';
import { TrackModel } from '../../../../services/track/track-model';

describe('EnterLyricsDialogComponent', () => {
    let component: EnterLyricsDialogComponent;
    let dataMock: EnterLyricsDialogData;
    let dialogRefMock: IMock<MatDialogRef<EnterLyricsDialogComponent>>;
    let karaokeroServiceMock: IMock<KaraokeroAlignmentService>;
    let romanizationServiceMock: IMock<LyricsRomanizationService>;
    let trackMock: IMock<TrackModel>;

    beforeEach(() => {
        trackMock = Mock.ofType<TrackModel>();
        trackMock.setup(x => x.title).returns(() => 'Sample Title');
        trackMock.setup(x => x.artists).returns(() => 'Sample Artist');
        trackMock.setup(x => x.path).returns(() => 'C:\\Music\\sample.mp3');

        dataMock = {
            track: trackMock.object,
            initialLyrics: 'Line 1\nLine 2',
        };

        dialogRefMock = Mock.ofType<MatDialogRef<EnterLyricsDialogComponent>>();
        karaokeroServiceMock = Mock.ofType<KaraokeroAlignmentService>();
        romanizationServiceMock = Mock.ofType<LyricsRomanizationService>();

        component = new EnterLyricsDialogComponent(
            dataMock,
            dialogRefMock.object,
            karaokeroServiceMock.object,
            romanizationServiceMock.object,
        );
    });

    describe('constructor & ngOnInit', () => {
        it('should initialize lyricsText with initialLyrics', () => {
            component.ngOnInit();
            expect(component.lyricsText).toEqual('Line 1\nLine 2');
            expect(component.trackTitle).toEqual('Sample Title');
            expect(component.trackArtist).toEqual('Sample Artist');
        });
    });

    describe('hasLyricsText', () => {
        it('should return true when lyrics text is present', () => {
            component.lyricsText = 'Some text';
            expect(component.hasLyricsText).toBe(true);
        });

        it('should return false when lyrics text is empty or whitespaces', () => {
            component.lyricsText = '   ';
            expect(component.hasLyricsText).toBe(false);
        });
    });

    describe('cleanLyrics', () => {
        it('should strip section headers from lyricsText', () => {
            component.lyricsText = '[Verse 1]\nLine 1\n[Chorus]\nLine 2';
            component.cleanLyrics();
            expect(component.lyricsText).toEqual('Line 1\n\nLine 2');
        });
    });

    describe('canUseAi', () => {
        it('should return service availability', () => {
            karaokeroServiceMock.setup(x => x.isAvailable()).returns(() => true);
            expect(component.canUseAi).toBe(true);
        });
    });

    describe('savePlainLyrics', () => {
        it('should call savePlainLyricsAsync and close dialog with result', async () => {
            component.lyricsText = 'Hello world';
            const mockLyrics: any = { rawLyrics: 'Hello world' };
            karaokeroServiceMock
                .setup(x => x.savePlainLyricsAsync(trackMock.object, 'Hello world'))
                .returns(async () => mockLyrics);

            await component.savePlainLyricsAsync();

            dialogRefMock.verify(x => x.close(mockLyrics), Times.once());
        });
    });

    describe('syncWithAiAsync', () => {
        it('should call alignLyricsAsync and close dialog with aligned lyrics', async () => {
            component.lyricsText = 'Hello world';
            const mockAlignedLyrics: any = { rawLyrics: '[00:01.00]Hello world' };
            karaokeroServiceMock
                .setup(x => x.alignLyricsAsync(trackMock.object, 'Hello world'))
                .returns(async () => mockAlignedLyrics);

            await component.syncWithAiAsync();

            expect(component.isAligning).toBe(false);
            dialogRefMock.verify(x => x.close(mockAlignedLyrics), Times.once());
        });
    });

    describe('cancel', () => {
        it('should close dialog with undefined when not aligning', () => {
            component.cancel();
            dialogRefMock.verify(x => x.close(undefined), Times.once());
        });
    });
});
