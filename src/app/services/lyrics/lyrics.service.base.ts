import { TrackModel } from '../track/track-model';
import { ILyricsGetter } from './i-lyrics-getter';
import { LyricsModel } from './lyrics-model';

export abstract class LyricsServiceBase implements ILyricsGetter {
    public abstract getLyricsAsync(track: TrackModel): Promise<LyricsModel>;
    public abstract searchLyricsByQueryAsync(query: string, track?: TrackModel): Promise<LyricsModel>;
    public abstract clearCache(): void;
    public abstract getNextAlternativeLyricsAsync(track?: TrackModel): Promise<LyricsModel | undefined>;
    public abstract getPreviousAlternativeLyricsAsync(track?: TrackModel): Promise<LyricsModel | undefined>;
    public abstract getCandidateIndexInfo(): { current: number; total: number } | undefined;
    public abstract hasNextAlternative(): boolean;
}

