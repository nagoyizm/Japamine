import { MockCreator } from '../../testing/mock-creator';
import { LyricsModel } from './lyrics-model';
import { LyricsSourceType } from '../../common/api/lyrics/lyrics-source-type';
import { TrackModel } from '../track/track-model';
import { OnlineLyricsGetter } from './online-lyrics-getter';
import { IMock, It, Mock, Times } from 'typemoq';
import { Lyrics } from '../../common/api/lyrics/lyrics';
import { Logger } from '../../common/logger';
import { ChartLyricsApi } from '../../common/api/lyrics/chart-lyrics.api';
import { AZLyricsApi } from '../../common/api/lyrics/a-z-lyrics.api';
import { LrclibApi } from '../../common/api/lyrics/lrclib.api';

describe('OnlineLyricsGetter', () => {
    let lrclibApiMock: IMock<LrclibApi>;
    let chartLyricsApiMock: IMock<ChartLyricsApi>;
    let azLyricsApiMock: IMock<AZLyricsApi>;
    let loggerMock: IMock<Logger>;

    beforeEach(() => {
        lrclibApiMock = Mock.ofType<LrclibApi>();
        lrclibApiMock.setup((x) => x.sourceName).returns(() => 'LRCLIB');
        chartLyricsApiMock = Mock.ofType<ChartLyricsApi>();
        azLyricsApiMock = Mock.ofType<AZLyricsApi>();
        loggerMock = Mock.ofType<Logger>();
    });

    function createInstance(): OnlineLyricsGetter {
        return new OnlineLyricsGetter(lrclibApiMock.object, chartLyricsApiMock.object, azLyricsApiMock.object, loggerMock.object);
    }

    describe('constructor', () => {
        it('should create', () => {
            // Arrange, Act
            const instance: OnlineLyricsGetter = createInstance();

            // Assert
            expect(instance).toBeDefined();
        });
    });

    describe('getLyricsAsync', () => {
        it('should return empty lyrics if track has no artist and title', async () => {
            // Arrange
            const track: TrackModel = MockCreator.createTrackModel('path', '', '');
            const lyrics: Lyrics = new Lyrics('ChartLyrics source', 'ChartLyrics text');
            const instance: OnlineLyricsGetter = createInstance();

            // Act
            const lyricsModel: LyricsModel = await instance.getLyricsAsync(track);

            // Assert
            chartLyricsApiMock.verify((x) => x.getLyricsAsync(It.isAny(), It.isAny()), Times.never());
            azLyricsApiMock.verify((x) => x.getLyricsAsync(It.isAny(), It.isAny()), Times.never());
            expect(lyricsModel.track).toEqual(track);
            expect(lyricsModel.sourceName).toEqual('');
            expect(lyricsModel.sourceType).toEqual(LyricsSourceType.none);
            expect(lyricsModel.plainText).toEqual('');
        });

        it('should return lyrics from AZLyrics if available', async () => {
            // Arrange
            const track: TrackModel = MockCreator.createTrackModel('path', 'title', 'artists');
            const lyrics: Lyrics = new Lyrics('AZLyrics source', 'AZLyrics text');
            azLyricsApiMock.setup((x) => x.getLyricsAsync(track.rawFirstArtist, track.rawTitle)).returns(() => Promise.resolve(lyrics));
            const instance: OnlineLyricsGetter = createInstance();

            // Act
            const lyricsModel: LyricsModel = await instance.getLyricsAsync(track);

            // Assert
            expect(lyricsModel.track).toEqual(track);
            expect(lyricsModel.sourceName).toEqual('AZLyrics source');
            expect(lyricsModel.sourceType).toEqual(LyricsSourceType.online);
            expect(lyricsModel.plainText).toEqual('AZLyrics text');
        });

        it('should return lyrics from ChartLyrics if no lyrics from AZLyrics are available', async () => {
            // Arrange
            const track: TrackModel = MockCreator.createTrackModel('path', 'title', 'artists');
            const lyrics: Lyrics = new Lyrics('ChartLyrics source', 'ChartLyrics text');
            azLyricsApiMock
                .setup((x) => x.getLyricsAsync(track.rawFirstArtist, track.rawTitle))
                .returns(() => Promise.resolve(Lyrics.empty()));
            chartLyricsApiMock.setup((x) => x.getLyricsAsync(track.rawFirstArtist, track.rawTitle)).returns(() => Promise.resolve(lyrics));
            const instance: OnlineLyricsGetter = createInstance();

            // Act
            const lyricsModel: LyricsModel = await instance.getLyricsAsync(track);

            // Assert
            expect(lyricsModel.track).toEqual(track);
            expect(lyricsModel.sourceName).toEqual('ChartLyrics source');
            expect(lyricsModel.sourceType).toEqual(LyricsSourceType.online);
            expect(lyricsModel.plainText).toEqual('ChartLyrics text');
        });

        it('should return synchronized timed lyrics from LRCLIB if available', async () => {
            // Arrange
            const track: TrackModel = MockCreator.createTrackModel('path', 'title', 'artists');
            lrclibApiMock
                .setup((x) => x.getLyricsAsync(track.rawFirstArtist, track.rawTitle, track.albumTitle, It.isAny()))
                .returns(() =>
                    Promise.resolve({
                        trackName: 'title',
                        artistName: 'artists',
                        syncedLyrics: '[00:01.50] Hello world\n[00:04.20] Second line',
                    }),
                );
            const instance: OnlineLyricsGetter = createInstance();

            // Act
            const lyricsModel: LyricsModel = await instance.getLyricsAsync(track);

            // Assert
            expect(lyricsModel.track).toEqual(track);
            expect(lyricsModel.sourceName).toEqual('LRCLIB');
            expect(lyricsModel.sourceType).toEqual(LyricsSourceType.online);
            expect(lyricsModel.plainText).toContain('Hello world');
            expect(lyricsModel.textLines).toEqual(['Hello world', 'Second line']);
            expect(lyricsModel.startTimeStamps).toEqual([1.5, 4.2]);
        });

        it('should return empty lyrics if no online lyrics are availalble', async () => {
            // Arrange
            const track: TrackModel = MockCreator.createTrackModel('path', 'title', 'artists');
            chartLyricsApiMock
                .setup((x) => x.getLyricsAsync(track.rawFirstArtist, track.rawTitle))
                .returns(() => Promise.resolve(Lyrics.empty()));
            azLyricsApiMock
                .setup((x) => x.getLyricsAsync(track.rawFirstArtist, track.rawTitle))
                .returns(() => Promise.resolve(Lyrics.empty()));
            const instance: OnlineLyricsGetter = createInstance();

            // Act
            const lyricsModel: LyricsModel = await instance.getLyricsAsync(track);

            // Assert
            expect(lyricsModel.track).toEqual(track);
            expect(lyricsModel.sourceName).toEqual('');
            expect(lyricsModel.sourceType).toEqual(LyricsSourceType.none);
            expect(lyricsModel.plainText).toEqual('');
        });
    });
});
