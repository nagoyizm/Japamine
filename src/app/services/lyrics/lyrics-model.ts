import { LyricsSourceType } from '../../common/api/lyrics/lyrics-source-type';
import { TrackModel } from '../track/track-model';

export interface AlignedLyricToken {
    original: string;
    romaji: string;
}

export class LyricsModel {
    public romanizedLines: string[] | undefined;
    public romanizedPlainText: string | undefined;
    public alignedTokens: AlignedLyricToken[][] | undefined;
    public matchedTitle?: string;
    public matchedArtist?: string;

    public constructor(
        public track: TrackModel | undefined,
        public sourceName: string,
        public sourceType: LyricsSourceType,
        public plainText: string,
        public textLines: string[] | undefined,
        public startTimeStamps: number[] | undefined,
        public endTimeStamps: number[] | undefined,
    ) {}

    public static plain(
        track: TrackModel | undefined,
        sourceName: string,
        sourceType: LyricsSourceType,
        text: string,
        matchedTitle?: string,
        matchedArtist?: string,
    ): LyricsModel {
        const model = new LyricsModel(track, sourceName, sourceType, text, [], [], []);
        model.matchedTitle = matchedTitle;
        model.matchedArtist = matchedArtist;
        return model;
    }

    public static timed(
        track: TrackModel | undefined,
        sourceName: string,
        sourceType: LyricsSourceType,
        text: string,
        lyricList: string[],
        startTimeStamps: number[],
    ): LyricsModel {
        return new LyricsModel(track, sourceName, sourceType, text, lyricList, startTimeStamps, []);
    }

    public static doubleTimed(
        track: TrackModel | undefined,
        sourceName: string,
        sourceType: LyricsSourceType,
        text: string,
        lyricList: string[],
        startTimeStamps: number[],
        endTimeStamps: number[],
    ): LyricsModel {
        return new LyricsModel(track, sourceName, sourceType, text, lyricList, startTimeStamps, endTimeStamps);
    }

    public static empty(track: TrackModel | undefined): LyricsModel {
        return new LyricsModel(track, '', LyricsSourceType.none, '', [], [], []);
    }
}
