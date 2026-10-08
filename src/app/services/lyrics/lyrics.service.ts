import { Injectable, Optional } from '@angular/core';
import { TrackModel } from '../track/track-model';
import { EmbeddedLyricsGetter } from './embedded-lyrics-getter';
import { LrcLyricsGetter } from './lrc-lyrics-getter';
import { OnlineLyricsGetter } from './online-lyrics-getter';
import { StringUtils } from '../../common/utils/string-utils';
import { LyricsFilterUtils } from '../../common/utils/lyrics-filter.utils';
import { SettingsBase } from '../../common/settings/settings.base';
import { LyricsModel } from './lyrics-model';
import { Logger } from '../../common/logger';
import { LyricsServiceBase } from './lyrics.service.base';
import { SrtLyricsGetter } from './srt-lyrics-getter';
import { ILyricsGetter } from './i-lyrics-getter';
import { LyricsRomanizationService } from './lyrics-romanization.service';

@Injectable()
export class LyricsService implements LyricsServiceBase {
    public constructor(
        private readonly embeddedLyricsGetter: EmbeddedLyricsGetter,
        private readonly lrcLyricsGetter: LrcLyricsGetter,
        private readonly srtLyricsGetter: SrtLyricsGetter,
        private readonly onlineLyricsGetter: OnlineLyricsGetter,
        private readonly settings: SettingsBase,
        private readonly logger: Logger,
        @Optional() private readonly romanizationService?: LyricsRomanizationService,
    ) {}

    private cachedOnlineLyrics: LyricsModel | undefined;
    private currentCandidates: LyricsModel[] = [];
    private currentCandidateIndex: number = -1;

    public async getLyricsAsync(track: TrackModel): Promise<LyricsModel> {
        let result: LyricsModel | undefined = await this.getRichLyricsAsync(track);

        if (result == null) {
            const embeddedLyrics = await this.tryGetLyricsAsync(track, this.embeddedLyricsGetter, 'embedded');
            if (!StringUtils.isNullOrWhiteSpace(embeddedLyrics.plainText)) {
                result = embeddedLyrics;
            }
        }

        if (result != null) {
            LyricsFilterUtils.sanitizeLyricsModel(result, track);
            this.currentCandidates = [result];
            this.currentCandidateIndex = 0;
            if (this.romanizationService != null) {
                await this.romanizationService.romanizeLyricsAsync(result);
            }
            return result;
        }

        if (track !== undefined && this.cachedOnlineLyrics?.track?.path === track.path && this.currentCandidates.length > 0) {
            const current = this.currentCandidates[this.currentCandidateIndex] ?? this.cachedOnlineLyrics;
            return current;
        }

        if (this.settings.downloadLyricsOnline) {
            try {
                if (typeof this.onlineLyricsGetter.getLyricsCandidatesAsync === 'function') {
                    const candidates = await this.onlineLyricsGetter.getLyricsCandidatesAsync(track);
                    if (candidates != null && candidates.length > 0) {
                        for (const c of candidates) {
                            LyricsFilterUtils.sanitizeLyricsModel(c, track);
                        }
                        this.currentCandidates = candidates;
                        this.currentCandidateIndex = 0;
                        const best = candidates[0];
                        if (this.romanizationService != null) {
                            await this.romanizationService.romanizeLyricsAsync(best);
                        }
                        this.cachedOnlineLyrics = best;
                        return best;
                    }
                }
            } catch {
                // Fallback to standard getter
            }

            const onlineLyrics = await this.tryGetLyricsAsync(track, this.onlineLyricsGetter, 'online');
            LyricsFilterUtils.sanitizeLyricsModel(onlineLyrics, track);
            this.cachedOnlineLyrics = onlineLyrics;
            if (!StringUtils.isNullOrWhiteSpace(onlineLyrics.plainText)) {
                this.currentCandidates = [onlineLyrics];
                this.currentCandidateIndex = 0;
                if (this.romanizationService != null) {
                    await this.romanizationService.romanizeLyricsAsync(onlineLyrics);
                }
                return onlineLyrics;
            }
        }

        this.currentCandidates = [];
        this.currentCandidateIndex = -1;
        this.cachedOnlineLyrics = undefined;
        return LyricsModel.empty(track);
    }

    public async searchLyricsByQueryAsync(query: string, track?: TrackModel): Promise<LyricsModel> {
        try {
            if (typeof this.onlineLyricsGetter.getLyricsCandidatesByQueryAsync === 'function') {
                const candidates = await this.onlineLyricsGetter.getLyricsCandidatesByQueryAsync(query, track);
                if (candidates != null && candidates.length > 0) {
                    for (const c of candidates) {
                        LyricsFilterUtils.sanitizeLyricsModel(c, track);
                    }
                    this.currentCandidates = candidates;
                    this.currentCandidateIndex = 0;
                    const best = candidates[0];
                    if (this.romanizationService != null) {
                        await this.romanizationService.romanizeLyricsAsync(best);
                    }
                    this.cachedOnlineLyrics = best;
                    return best;
                }
            }

            const lyrics = await this.onlineLyricsGetter.getLyricsByQueryAsync(query, track);
            LyricsFilterUtils.sanitizeLyricsModel(lyrics, track);
            if (!StringUtils.isNullOrWhiteSpace(lyrics.plainText)) {
                this.currentCandidates = [lyrics];
                this.currentCandidateIndex = 0;
                if (this.romanizationService != null) {
                    await this.romanizationService.romanizeLyricsAsync(lyrics);
                }
                this.cachedOnlineLyrics = lyrics;
                return lyrics;
            }

            this.currentCandidates = [];
            this.currentCandidateIndex = -1;
            return LyricsModel.empty(track);
        } catch (e: unknown) {
            this.logger.error(e, 'Could not get lyrics by query', 'LyricsService', 'searchLyricsByQueryAsync');
            this.currentCandidates = [];
            this.currentCandidateIndex = -1;
            return LyricsModel.empty(track);
        }
    }

    public async getNextAlternativeLyricsAsync(track?: TrackModel): Promise<LyricsModel | undefined> {
        if (this.currentCandidates.length === 0) {
            return undefined;
        }

        const nextIndex = this.currentCandidateIndex + 1;
        if (nextIndex < this.currentCandidates.length) {
            this.currentCandidateIndex = nextIndex;
            const nextLyrics = this.currentCandidates[this.currentCandidateIndex];
            if (this.romanizationService != null && nextLyrics != null) {
                await this.romanizationService.romanizeLyricsAsync(nextLyrics);
            }
            this.cachedOnlineLyrics = nextLyrics;
            return nextLyrics;
        }

        return undefined;
    }

    public async getPreviousAlternativeLyricsAsync(track?: TrackModel): Promise<LyricsModel | undefined> {
        if (this.currentCandidates.length === 0 || this.currentCandidateIndex <= 0) {
            return undefined;
        }

        this.currentCandidateIndex--;
        const prevLyrics = this.currentCandidates[this.currentCandidateIndex];
        if (this.romanizationService != null && prevLyrics != null) {
            await this.romanizationService.romanizeLyricsAsync(prevLyrics);
        }
        this.cachedOnlineLyrics = prevLyrics;
        return prevLyrics;
    }

    public getCandidateIndexInfo(): { current: number; total: number } | undefined {
        if (this.currentCandidates.length <= 1 || this.currentCandidateIndex < 0) {
            return undefined;
        }
        return {
            current: this.currentCandidateIndex + 1,
            total: this.currentCandidates.length,
        };
    }

    public hasNextAlternative(): boolean {
        return this.currentCandidateIndex >= 0 && this.currentCandidateIndex + 1 < this.currentCandidates.length;
    }

    public clearCache(): void {
        this.cachedOnlineLyrics = undefined;
        this.currentCandidates = [];
        this.currentCandidateIndex = -1;
    }

    public setCustomLyrics(lyrics: LyricsModel): void {
        this.cachedOnlineLyrics = lyrics;
        this.currentCandidates = [lyrics];
        this.currentCandidateIndex = 0;
    }

    private async getRichLyricsAsync(track: TrackModel): Promise<LyricsModel | undefined> {
        if (!this.settings.showRichLyrics) {
            return undefined;
        }
        const srtLyrics = await this.tryGetLyricsAsync(track, this.srtLyricsGetter, 'SRT');
        if (!StringUtils.isNullOrWhiteSpace(srtLyrics.plainText)) {
            return srtLyrics;
        }
        const lrcLyrics = await this.tryGetLyricsAsync(track, this.lrcLyricsGetter, 'LRC');
        if (!StringUtils.isNullOrWhiteSpace(lrcLyrics.plainText)) {
            return lrcLyrics;
        }
        return undefined;
    }

    private async tryGetLyricsAsync(track: TrackModel, getter: ILyricsGetter, source: string): Promise<LyricsModel> {
        try {
            return (await getter.getLyricsAsync(track)) ?? LyricsModel.empty(track);
        } catch (e: unknown) {
            this.logger.error(e, `Could not get ${source} lyrics`, 'LyricsService', 'getLyricsAsync');

            return LyricsModel.empty(track);
        }
    }
}
