import { Injectable, Optional } from '@angular/core';
import { TrackModel } from '../track/track-model';
import { ILyricsGetter } from './i-lyrics-getter';
import { ChartLyricsApi } from '../../common/api/lyrics/chart-lyrics.api';
import { LyricsModel } from './lyrics-model';
import { Lyrics } from '../../common/api/lyrics/lyrics';
import { LyricsSourceType } from '../../common/api/lyrics/lyrics-source-type';
import { Logger } from '../../common/logger';
import { StringUtils } from '../../common/utils/string-utils';
import { LyricsFilterUtils } from '../../common/utils/lyrics-filter.utils';
import { AZLyricsApi } from '../../common/api/lyrics/a-z-lyrics.api';
import { LrclibApi, LrclibResponse } from '../../common/api/lyrics/lrclib.api';
import { LyricsOvhApi } from '../../common/api/lyrics/lyrics-ovh.api';
import { GeniusApi } from '../../common/api/lyrics/genius.api';
import { JLyricApi } from '../../common/api/lyrics/j-lyric.api';
import { UtaTenApi } from '../../common/api/lyrics/uta-ten.api';
import { LyricsRomanizationService } from './lyrics-romanization.service';

@Injectable()
export class OnlineLyricsGetter implements ILyricsGetter {
    private static readonly timestampRegex: RegExp = /\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]/g;

    public constructor(
        private readonly lrclibApi: LrclibApi,
        private readonly chartLyricsApi: ChartLyricsApi,
        private readonly azLyricsApi: AZLyricsApi,
        private readonly logger: Logger,
        @Optional() private readonly lyricsOvhApi?: LyricsOvhApi,
        @Optional() private readonly geniusApi?: GeniusApi,
        @Optional() private readonly jLyricApi?: JLyricApi,
        @Optional() private readonly utaTenApi?: UtaTenApi,
        @Optional() private readonly romanizationService?: LyricsRomanizationService,
    ) {}

    public async getLyricsAsync(track: TrackModel): Promise<LyricsModel> {
        const candidates = await this.getLyricsCandidatesAsync(track);
        return candidates.length > 0 ? candidates[0] : LyricsModel.empty(track);
    }

    public async getLyricsByQueryAsync(query: string, track?: TrackModel): Promise<LyricsModel> {
        const candidates = await this.getLyricsCandidatesByQueryAsync(query, track);
        return candidates.length > 0 ? candidates[0] : LyricsModel.empty(track);
    }

    public async getLyricsCandidatesAsync(track: TrackModel): Promise<LyricsModel[]> {
        if (
            StringUtils.isNullOrWhiteSpace(track.rawFirstArtist) &&
            StringUtils.isNullOrWhiteSpace(track.rawTitle) &&
            StringUtils.isNullOrWhiteSpace(track.fileName)
        ) {
            return [];
        }

        const artist = (track.rawFirstArtist ?? '').trim();
        const rawTitle = (track.rawTitle ?? '').trim();
        const cleanTitle = this.getCleanTitle(rawTitle);
        const titleCandidates = this.extractTitleCandidates(track);
        const suggestions = this.generateSearchSuggestions(track);

        const candidateMap = new Map<number | string, { response: LrclibResponse; score: number }>();

        // 1. Try exact match on LRCLIB first
        if (artist.length > 0 && cleanTitle.length > 0) {
            try {
                const duration = track.durationInMilliseconds > 0 ? track.durationInMilliseconds / 1000 : undefined;
                const exact = await this.lrclibApi.getLyricsAsync(artist, cleanTitle, track.albumTitle, duration);
                if (exact != null && (!StringUtils.isNullOrWhiteSpace(exact.syncedLyrics) || !StringUtils.isNullOrWhiteSpace(exact.plainLyrics))) {
                    const key = exact.id ?? 'exact_match';
                    candidateMap.set(key, { response: exact, score: 200 });
                }
            } catch (e) {
                this.logger.error(e, 'Could not get exact LRCLIB lyrics', 'OnlineLyricsGetter', 'getLyricsCandidatesAsync');
            }
        }

        // 2. Search LRCLIB with smart queries & suggestions
        const searchQueries: string[] = [];
        if (artist.length > 0 && cleanTitle.length > 0) {
            searchQueries.push(`${artist} ${cleanTitle}`);
        }
        for (const s of suggestions) {
            if (!searchQueries.includes(s)) {
                searchQueries.push(s);
            }
        }
        for (const t of titleCandidates) {
            const q = artist.length > 0 ? `${artist} ${t}` : t;
            if (!searchQueries.includes(q)) {
                searchQueries.push(q);
            }
        }

        // Query top 4 search strings on LRCLIB
        const queriesToRun = searchQueries.slice(0, 4);
        for (const q of queriesToRun) {
            try {
                const rawResults = await this.lrclibApi.searchRawAsync(q);
                for (const res of rawResults) {
                    const score = this.scoreCandidate(res, track, titleCandidates, artist, cleanTitle);
                    if (score >= 30) {
                        const key = res.id ?? `${res.trackName ?? ''}_${res.artistName ?? ''}`;
                        const existing = candidateMap.get(key);
                        if (!existing || score > existing.score) {
                            candidateMap.set(key, { response: res, score });
                        }
                    }
                }
            } catch {
                // Continue to next query
            }
        }

        // If LRCLIB gave candidates, return ranked models
        if (candidateMap.size > 0) {
            const sortedEntries = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);
            const models: LyricsModel[] = [];
            const seenSnippets = new Set<string>();

            for (const item of sortedEntries) {
                const model = this.convertLrclibResponseToModel(track, item.response);
                if (model != null && !StringUtils.isNullOrWhiteSpace(model.plainText)) {
                    const snippet = model.plainText.slice(0, 120).replace(/\s+/g, ' ').trim().toLowerCase();
                    if (!seenSnippets.has(snippet)) {
                        seenSnippets.add(snippet);
                        models.push(model);
                    }
                }
            }

            if (models.length > 0) {
                return models;
            }
        }

        // 3. Fallback Providers with timeout protection
        const fallbackCandidates: LyricsModel[] = [];

        // LyricsOVH
        try {
            const ovh = await this.withTimeout(this.getLyricsFromLyricsOvhAsync(track, artist, titleCandidates), 2500, undefined);
            if (ovh != null && !StringUtils.isNullOrWhiteSpace(ovh.plainText)) {
                fallbackCandidates.push(ovh);
            }
        } catch { /* ignore */ }

        // Japanese databases
        if (fallbackCandidates.length === 0 && LyricsFilterUtils.isJapaneseOrigin(artist, rawTitle)) {
            try {
                const jLyric = await this.withTimeout(this.getLyricsFromJLyricAsync(track, artist, titleCandidates), 2500, undefined);
                if (jLyric != null && !StringUtils.isNullOrWhiteSpace(jLyric.plainText)) {
                    fallbackCandidates.push(jLyric);
                }
            } catch { /* ignore */ }

            if (fallbackCandidates.length === 0) {
                try {
                    const utaTen = await this.withTimeout(this.getLyricsFromUtaTenAsync(track, artist, titleCandidates), 2500, undefined);
                    if (utaTen != null && !StringUtils.isNullOrWhiteSpace(utaTen.plainText)) {
                        fallbackCandidates.push(utaTen);
                    }
                } catch { /* ignore */ }
            }
        }

        // Genius
        if (fallbackCandidates.length === 0) {
            try {
                const genius = await this.withTimeout(this.getLyricsFromGeniusAsync(track, artist, rawTitle, searchQueries, titleCandidates), 3000, undefined);
                if (genius != null && !StringUtils.isNullOrWhiteSpace(genius.plainText)) {
                    fallbackCandidates.push(genius);
                }
            } catch { /* ignore */ }
        }

        // AZLyrics
        if (fallbackCandidates.length === 0) {
            try {
                const az = await this.withTimeout(this.getLyricsFromAZLyricsAsync(track, artist, titleCandidates), 2500, undefined);
                if (az != null && !StringUtils.isNullOrWhiteSpace(az.plainText)) {
                    fallbackCandidates.push(az);
                }
            } catch { /* ignore */ }
        }

        // ChartLyrics
        if (fallbackCandidates.length === 0) {
            try {
                const chart = await this.withTimeout(this.getLyricsFromChartLyricsAsync(track, artist, rawTitle), 2500, undefined);
                if (chart != null && !StringUtils.isNullOrWhiteSpace(chart.plainText)) {
                    fallbackCandidates.push(chart);
                }
            } catch { /* ignore */ }
        }

        return fallbackCandidates;
    }

    public async getLyricsCandidatesByQueryAsync(query: string, track?: TrackModel): Promise<LyricsModel[]> {
        if (StringUtils.isNullOrWhiteSpace(query)) {
            return [];
        }

        const cleanQuery = query.trim();
        const candidateMap = new Map<number | string, { response: LrclibResponse; score: number }>();

        try {
            const rawResults = await this.lrclibApi.searchRawAsync(cleanQuery);
            for (const res of rawResults) {
                const text = res.syncedLyrics || res.plainLyrics;
                if (!text || StringUtils.isNullOrWhiteSpace(text)) {
                    continue;
                }
                let score = 0;
                if (track != null) {
                    const artist = (track.rawFirstArtist ?? '').trim();
                    const titleCandidates = this.extractTitleCandidates(track);
                    score = this.scoreCandidate(res, track, titleCandidates, artist, track.rawTitle ?? cleanQuery);
                } else {
                    const qWords = cleanQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
                    const resName = `${res.trackName ?? ''} ${res.artistName ?? ''}`.toLowerCase();
                    const matches = qWords.filter((w) => resName.includes(w));
                    score = matches.length * 25 + (!StringUtils.isNullOrWhiteSpace(res.syncedLyrics) ? 20 : 0);
                }

                const key = res.id ?? `${res.trackName ?? ''}_${res.artistName ?? ''}`;
                candidateMap.set(key, { response: res, score });
            }
        } catch {
            // Ignore
        }

        if (candidateMap.size > 0) {
            const sortedEntries = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);
            const models: LyricsModel[] = [];
            const seenSnippets = new Set<string>();

            for (const item of sortedEntries) {
                const model = this.convertLrclibResponseToModel(track, item.response);
                if (model != null && !StringUtils.isNullOrWhiteSpace(model.plainText)) {
                    const snippet = model.plainText.slice(0, 120).replace(/\s+/g, ' ').trim().toLowerCase();
                    if (!seenSnippets.has(snippet)) {
                        seenSnippets.add(snippet);
                        models.push(model);
                    }
                }
            }

            if (models.length > 0) {
                return models;
            }
        }

        // Secondary provider fallback for query
        const ovhModel = await this.queryLyricsOvhAsync(cleanQuery, track);
        if (ovhModel != null && !StringUtils.isNullOrWhiteSpace(ovhModel.plainText)) {
            return [ovhModel];
        }

        const jLyricModel = await this.queryJLyricAsync(cleanQuery, track);
        if (jLyricModel != null && !StringUtils.isNullOrWhiteSpace(jLyricModel.plainText)) {
            return [jLyricModel];
        }

        const utaTenModel = await this.queryUtaTenAsync(cleanQuery, track);
        if (utaTenModel != null && !StringUtils.isNullOrWhiteSpace(utaTenModel.plainText)) {
            return [utaTenModel];
        }

        const geniusModel = await this.queryGeniusAsync(cleanQuery, track);
        if (geniusModel != null && !StringUtils.isNullOrWhiteSpace(geniusModel.plainText)) {
            return [geniusModel];
        }

        return [];
    }

    private scoreCandidate(
        candidate: LrclibResponse,
        track: TrackModel,
        titleCandidates: string[],
        expectedArtist: string,
        cleanTitle: string,
    ): number {
        const text = candidate.syncedLyrics || candidate.plainLyrics;
        if (!text || StringUtils.isNullOrWhiteSpace(text)) {
            return -999;
        }

        if (LyricsFilterUtils.isLanguageIncompatible(text, expectedArtist, cleanTitle)) {
            return -999;
        }

        let score = 0;
        const candTitle = (candidate.trackName || candidate.name || '').trim();
        const candArtist = (candidate.artistName || '').trim();

        // 1. Title matching
        if (candTitle.length > 0) {
            const nCandTitle = LyricsFilterUtils.normalizeText(candTitle);
            const nExpTitle = LyricsFilterUtils.normalizeText(cleanTitle);

            if (nCandTitle === nExpTitle && nExpTitle.length > 0) {
                score += 70;
            } else if (titleCandidates.some((t) => LyricsFilterUtils.normalizeText(t) === nCandTitle)) {
                score += 65;
            } else if (titleCandidates.some((t) => LyricsFilterUtils.isTitleMatch(candTitle, t))) {
                score += 45;
            } else {
                const candWords = candTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
                const expWords = cleanTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
                if (candWords.length > 0 && expWords.length > 0) {
                    const matches = expWords.filter((w) => candWords.some((cw) => cw.includes(w) || w.includes(cw)));
                    if (matches.length > 0) {
                        score += Math.round((matches.length / expWords.length) * 35);
                    }
                }
            }
        }

        // 2. Artist matching
        if (expectedArtist.length > 0 && candArtist.length > 0) {
            const nCandArtist = LyricsFilterUtils.normalizeText(candArtist);
            const nExpArtist = LyricsFilterUtils.normalizeText(expectedArtist);

            if (nCandArtist === nExpArtist && nExpArtist.length > 0) {
                score += 50;
            } else if (LyricsFilterUtils.isArtistMatch(candArtist, expectedArtist)) {
                score += 35;
            } else {
                const candWords = candArtist.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
                const expWords = expectedArtist.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
                if (candWords.length > 0 && expWords.length > 0) {
                    const matches = expWords.filter((w) => candWords.some((cw) => cw.includes(w) || w.includes(cw)));
                    if (matches.length > 0) {
                        score += 20;
                    }
                }
            }
        }

        // 3. Duration matching (Extremely reliable audio verification)
        const trackSec = track.durationInMilliseconds > 0 ? track.durationInMilliseconds / 1000 : 0;
        const candSec = candidate.duration ?? 0;
        if (trackSec > 0 && candSec > 0) {
            const diff = Math.abs(trackSec - candSec);
            if (diff <= 2) {
                score += 45;
            } else if (diff <= 5) {
                score += 30;
            } else if (diff <= 10) {
                score += 15;
            } else if (diff > 45) {
                score -= 30;
            }
        }

        // 4. Synced lyrics bonus
        if (!StringUtils.isNullOrWhiteSpace(candidate.syncedLyrics)) {
            score += 20;
        }

        return score;
    }

    private withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
        return Promise.race([
            promise,
            new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
        ]);
    }

    public generateSearchSuggestions(track: TrackModel): string[] {
        if (track == null) {
            return [];
        }

        const suggestions: string[] = [];
        const rawTitle = (track.rawTitle ?? '').trim();
        const artist = (track.rawFirstArtist ?? '').trim();
        let cleanTitle = rawTitle;
        if (this.lrclibApi?.cleanTitle != null) {
            const cleaned = this.lrclibApi.cleanTitle(rawTitle);
            if (cleaned !== undefined && cleaned !== '') {
                cleanTitle = cleaned;
            }
        }
        cleanTitle = cleanTitle.trim();

        if (artist !== '' && rawTitle !== '') {
            suggestions.push(`${artist} ${rawTitle}`);
        }

        if (artist !== '' && cleanTitle !== '' && cleanTitle !== rawTitle) {
            suggestions.push(`${artist} ${cleanTitle}`);
        }

        this.addRomajiSuggestions(suggestions, artist, rawTitle, cleanTitle);
        this.addFileNameSuggestions(suggestions, track, artist, rawTitle);

        if (rawTitle !== '' && rawTitle !== track.fileName) {
            suggestions.push(rawTitle);
        }

        if (cleanTitle !== '' && cleanTitle !== rawTitle) {
            suggestions.push(cleanTitle);
        }

        this.addBracketSuggestions(suggestions, artist, rawTitle);

        return Array.from(new Set(suggestions.map((s) => s.trim()))).filter((s) => s.length > 1);
    }

    private addRomajiSuggestions(suggestions: string[], artist: string, rawTitle: string, cleanTitle: string): void {
        if (this.romanizationService == null) {
            return;
        }
        this.addRomajiTitleSuggestions(suggestions, artist, rawTitle);
        this.addRomajiArtistSuggestions(suggestions, artist, rawTitle, cleanTitle);
    }

    private addRomajiTitleSuggestions(suggestions: string[], artist: string, rawTitle: string): void {
        if (rawTitle !== '' && this.romanizationService?.containsJapanese(rawTitle) === true) {
            const romajiTitle = this.romanizationService.transliterateKanaToRomaji(rawTitle).trim();
            if (romajiTitle.length > 1) {
                if (artist !== '') {
                    suggestions.push(`${artist} ${romajiTitle}`);
                }
                suggestions.push(romajiTitle);
            }
        }
    }

    private addRomajiArtistSuggestions(suggestions: string[], artist: string, rawTitle: string, cleanTitle: string): void {
        if (artist !== '' && this.romanizationService?.containsJapanese(artist) === true) {
            const romajiArtist = this.romanizationService.transliterateKanaToRomaji(artist).trim();
            if (romajiArtist.length > 1) {
                suggestions.push(`${romajiArtist} ${rawTitle}`);
                if (cleanTitle !== '' && cleanTitle !== rawTitle) {
                    suggestions.push(`${romajiArtist} ${cleanTitle}`);
                }
                if (rawTitle !== '' && this.romanizationService.containsJapanese(rawTitle)) {
                    const romajiTitle = this.romanizationService.transliterateKanaToRomaji(rawTitle).trim();
                    suggestions.push(`${romajiArtist} ${romajiTitle}`);
                }
            }
        }
    }

    private addFileNameSuggestions(suggestions: string[], track: TrackModel, artist: string, rawTitle: string): void {
        if (track.fileName === undefined || track.fileName === '') {
            return;
        }

        let clean = track.fileName.replace(/\.[a-z0-9]+$/i, '').trim();
        clean = clean.replace(/^\[[^\]]*\]\s*/, '').replace(/^\([^)]*\)\s*/, '').trim();
        clean = clean.replace(/^\d{1,2}[-._]\d{1,3}[\s._-]+/, '').trim();
        clean = clean.replace(/^\d{1,4}[\s._-]+/, '').trim();
        clean = this.stripBrackets(clean);

        const dashParts = clean.split(' - ');
        if (dashParts.length >= 2) {
            const fnArtist = dashParts[0].trim();
            const fnTitle = dashParts[dashParts.length - 1].trim();

            if (fnArtist !== '' && fnTitle !== '') {
                suggestions.push(`${fnArtist} ${fnTitle}`);
            }
            if (artist !== '' && fnTitle !== '' && fnTitle !== rawTitle) {
                suggestions.push(`${artist} ${fnTitle}`);
            }
            if (fnTitle !== '' && fnTitle !== rawTitle) {
                suggestions.push(fnTitle);
            }
        } else if (clean !== '' && clean !== rawTitle) {
            if (artist !== '') {
                suggestions.push(`${artist} ${clean}`);
            }
            suggestions.push(clean);
        }
    }

    private addBracketSuggestions(suggestions: string[], artist: string, rawTitle: string): void {
        const bracketMatches = rawTitle.match(/[([【「『]([^()[\]【】「」『』]+)[)\]】」』]/g);
        if (bracketMatches == null) {
            return;
        }

        for (const match of bracketMatches) {
            const inner = match.replace(/[([【「『)\]】」』]/g, '').trim();
            if (inner.length > 1) {
                if (artist !== '') {
                    suggestions.push(`${artist} ${inner}`);
                }
                suggestions.push(inner);
            }
        }
    }

    public extractTitleCandidates(track: TrackModel): string[] {
        const titles: string[] = [];
        const rawTitle = (track.rawTitle ?? '').trim();
        const cleanTitle = this.getCleanTitle(rawTitle);

        if (rawTitle.length > 0) {
            titles.push(rawTitle);
        }

        if (cleanTitle.length > 0 && cleanTitle !== rawTitle) {
            titles.push(cleanTitle);
        }

        if (cleanTitle.length > 0) {
            this.addTitleVariants(cleanTitle, titles);
        }

        this.addRomajiTitleCandidate(titles, rawTitle);
        this.addFileNameCandidate(titles, track.fileName);

        return Array.from(new Set(titles)).filter((t) => !StringUtils.isNullOrWhiteSpace(t));
    }

    private getCleanTitle(rawTitle: string): string {
        if (this.lrclibApi?.cleanTitle != null) {
            const cleaned = this.lrclibApi.cleanTitle(rawTitle);
            if (cleaned !== undefined && cleaned !== '') {
                return cleaned.trim();
            }
        }
        return rawTitle;
    }

    private addRomajiTitleCandidate(titles: string[], rawTitle: string): void {
        if (this.romanizationService != null && rawTitle.length > 0 && this.romanizationService.containsJapanese(rawTitle)) {
            const romaji = this.romanizationService.transliterateKanaToRomaji(rawTitle).trim();
            if (romaji.length > 1 && !titles.includes(romaji)) {
                titles.push(romaji);
            }
        }
    }

    private addFileNameCandidate(titles: string[], fileName?: string): void {
        if (fileName != null && fileName.length > 0) {
            const fnTitle = this.extractTitleFromFileName(fileName);
            if (fnTitle != null && fnTitle.length > 0) {
                titles.push(fnTitle);
            }
        }
    }

    public generateQueryCandidates(track: TrackModel, titleCandidates?: string[]): string[] {
        const candidates: string[] = [];
        const artist = (track.rawFirstArtist ?? '').trim();
        const titles = titleCandidates ?? this.extractTitleCandidates(track);

        for (const t of titles) {
            if (artist.length > 0) {
                candidates.push(`${artist} ${t}`);
            } else {
                candidates.push(t);
            }
        }

        if (track.fileName != null && track.fileName.length > 0) {
            const fnWithoutExt = track.fileName.replace(/\.[a-z0-9]+$/i, '').trim();
            if (artist.length > 0) {
                const cleanFnTitle = fnWithoutExt
                    .replace(/^\d{1,2}[-._]\d{1,3}[\s._-]+/, '')
                    .replace(/^\d{1,4}[\s._-]+/, '')
                    .trim();
                if (cleanFnTitle.length > 0) {
                    candidates.push(`${artist} ${cleanFnTitle}`);
                }
            } else {
                candidates.push(fnWithoutExt);
            }
        }

        return Array.from(new Set(candidates)).filter((c) => !StringUtils.isNullOrWhiteSpace(c));
    }

    private resolveMatchedValue(matched: string | undefined, fallback: string | undefined): string | undefined {
        if (matched !== undefined && matched !== '') {
            return matched;
        }
        return fallback !== undefined && fallback !== '' ? fallback : undefined;
    }

    private async getLyricsFromLrclibAsync(
        track: TrackModel,
        artist: string,
        rawTitle: string,
        titleCandidates: string[],
        queryCandidates: string[],
    ): Promise<LyricsModel | undefined> {
        if (artist.length > 0 && rawTitle.length > 0) {
            const exactModel = await this.getExactLrclibLyricsAsync(track, artist, rawTitle);
            if (exactModel != null) {
                return exactModel;
            }
        }

        for (const candidate of queryCandidates) {
            try {
                const candidateResult = await this.lrclibApi.searchByQueryAsync(candidate, artist, titleCandidates);
                if (candidateResult != null) {
                    const model = this.convertLrclibResponseToModel(track, candidateResult);
                    if (model != null) {
                        return model;
                    }
                }
            } catch {
                // Continue to next candidate
            }
        }

        return undefined;
    }

    private async getExactLrclibLyricsAsync(track: TrackModel, artist: string, rawTitle: string): Promise<LyricsModel | undefined> {
        try {
            const lrclibResult: LrclibResponse | undefined = await this.lrclibApi.getLyricsAsync(
                artist,
                rawTitle,
                track.albumTitle,
                track.durationInMilliseconds > 0 ? track.durationInMilliseconds / 1000 : undefined,
            );

            if (lrclibResult != null) {
                return this.convertLrclibResponseToModel(track, lrclibResult);
            }
        } catch (e) {
            this.logger.error(e, 'Could not get lyrics from LRCLIB', 'OnlineLyricsGetter', 'getExactLrclibLyricsAsync');
        }
        return undefined;
    }

    private async getLyricsFromLyricsOvhAsync(
        track: TrackModel,
        artist: string,
        titleCandidates: string[],
    ): Promise<LyricsModel | undefined> {
        if (this.lyricsOvhApi == null || artist.length === 0) {
            return undefined;
        }

        for (const candTitle of titleCandidates) {
            try {
                const ovhLyrics: Lyrics = await this.lyricsOvhApi.getLyricsAsync(artist, candTitle);
                if (!StringUtils.isNullOrWhiteSpace(ovhLyrics.text) && !LyricsFilterUtils.isLanguageIncompatible(ovhLyrics.text, artist, candTitle)) {
                    const cleaned = LyricsFilterUtils.cleanLyricsText(ovhLyrics.text, track);
                    return LyricsModel.plain(
                        track,
                        ovhLyrics.sourceName,
                        LyricsSourceType.online,
                        cleaned,
                        this.resolveMatchedValue(ovhLyrics.matchedTitle, candTitle),
                        this.resolveMatchedValue(ovhLyrics.matchedArtist, artist),
                    );
                }
            } catch (e) {
                this.logger.error(e, 'Could not get lyrics from LyricsOVH', 'OnlineLyricsGetter', 'getLyricsFromLyricsOvhAsync');
            }
        }

        return undefined;
    }

    private async getLyricsFromJLyricAsync(
        track: TrackModel,
        artist: string,
        titleCandidates: string[],
    ): Promise<LyricsModel | undefined> {
        if (this.jLyricApi == null || artist.length === 0) {
            return undefined;
        }

        for (const candTitle of titleCandidates) {
            try {
                const jLyrics: Lyrics = await this.jLyricApi.getLyricsAsync(artist, candTitle);
                if (!StringUtils.isNullOrWhiteSpace(jLyrics.text)) {
                    const cleaned = LyricsFilterUtils.cleanLyricsText(jLyrics.text, track);
                    return LyricsModel.plain(
                        track,
                        jLyrics.sourceName,
                        LyricsSourceType.online,
                        cleaned,
                        this.resolveMatchedValue(jLyrics.matchedTitle, candTitle),
                        this.resolveMatchedValue(jLyrics.matchedArtist, artist),
                    );
                }
            } catch (e) {
                this.logger.error(e, 'Could not get lyrics from J-Lyric', 'OnlineLyricsGetter', 'getLyricsFromJLyricAsync');
            }
        }

        return undefined;
    }

    private async getLyricsFromUtaTenAsync(
        track: TrackModel,
        artist: string,
        titleCandidates: string[],
    ): Promise<LyricsModel | undefined> {
        if (this.utaTenApi == null || artist.length === 0) {
            return undefined;
        }

        for (const candTitle of titleCandidates) {
            try {
                const utLyrics: Lyrics = await this.utaTenApi.getLyricsAsync(artist, candTitle);
                if (!StringUtils.isNullOrWhiteSpace(utLyrics.text)) {
                    const cleaned = LyricsFilterUtils.cleanLyricsText(utLyrics.text, track);
                    return LyricsModel.plain(
                        track,
                        utLyrics.sourceName,
                        LyricsSourceType.online,
                        cleaned,
                        this.resolveMatchedValue(utLyrics.matchedTitle, candTitle),
                        this.resolveMatchedValue(utLyrics.matchedArtist, artist),
                    );
                }
            } catch (e) {
                this.logger.error(e, 'Could not get lyrics from UtaTen', 'OnlineLyricsGetter', 'getLyricsFromUtaTenAsync');
            }
        }

        return undefined;
    }

    private async getLyricsFromGeniusAsync(
        track: TrackModel,
        artist: string,
        rawTitle: string,
        queryCandidates: string[],
        titleCandidates: string[],
    ): Promise<LyricsModel | undefined> {
        if (this.geniusApi == null) {
            return undefined;
        }

        for (const candidate of queryCandidates) {
            try {
                const geniusLyrics: Lyrics = await this.geniusApi.searchAndExtractLyricsAsync(candidate, artist, titleCandidates);
                if (!StringUtils.isNullOrWhiteSpace(geniusLyrics.text) && !LyricsFilterUtils.isLanguageIncompatible(geniusLyrics.text, artist, rawTitle)) {
                    const cleaned = LyricsFilterUtils.cleanLyricsText(geniusLyrics.text, track);
                    return LyricsModel.plain(
                        track,
                        geniusLyrics.sourceName,
                        LyricsSourceType.online,
                        cleaned,
                        this.resolveMatchedValue(geniusLyrics.matchedTitle, rawTitle),
                        this.resolveMatchedValue(geniusLyrics.matchedArtist, artist),
                    );
                }
            } catch (e) {
                this.logger.error(e, 'Could not get lyrics from Genius', 'OnlineLyricsGetter', 'getLyricsFromGeniusAsync');
            }
        }

        return undefined;
    }

    private async getLyricsFromAZLyricsAsync(
        track: TrackModel,
        artist: string,
        titleCandidates: string[],
    ): Promise<LyricsModel | undefined> {
        if (artist.length === 0) {
            return undefined;
        }

        for (const candTitle of titleCandidates) {
            const asciiOnly = candTitle.replace(/\W/g, '');
            if (asciiOnly.length > 1) {
                try {
                    const azLyrics = await this.azLyricsApi.getLyricsAsync(artist, candTitle);
                    if (!StringUtils.isNullOrWhiteSpace(azLyrics.text)) {
                        const cleaned = LyricsFilterUtils.cleanLyricsText(azLyrics.text, track);
                        return LyricsModel.plain(
                            track,
                            azLyrics.sourceName,
                            LyricsSourceType.online,
                            cleaned,
                            this.resolveMatchedValue(azLyrics.matchedTitle, candTitle),
                            this.resolveMatchedValue(azLyrics.matchedArtist, artist),
                        );
                    }
                } catch {
                    // Continue to next candidate
                }
            }
        }

        return undefined;
    }

    private async getLyricsFromChartLyricsAsync(
        track: TrackModel,
        artist: string,
        rawTitle: string,
    ): Promise<LyricsModel | undefined> {
        if (artist.length === 0 || rawTitle.length === 0) {
            return undefined;
        }

        try {
            const chartLyrics = await this.chartLyricsApi.getLyricsAsync(artist, rawTitle);
            if (!StringUtils.isNullOrWhiteSpace(chartLyrics.text)) {
                const cleaned = LyricsFilterUtils.cleanLyricsText(chartLyrics.text, track);
                return LyricsModel.plain(
                    track,
                    chartLyrics.sourceName,
                    LyricsSourceType.online,
                    cleaned,
                    this.resolveMatchedValue(chartLyrics.matchedTitle, rawTitle),
                    this.resolveMatchedValue(chartLyrics.matchedArtist, artist),
                );
            }
        } catch {
            // Ignore ChartLyrics errors
        }

        return undefined;
    }

    private async queryLrclibAsync(query: string, track?: TrackModel): Promise<LyricsModel | undefined> {
        try {
            let result = await this.lrclibApi.searchByQueryAsync(query, track?.rawFirstArtist, track?.rawTitle);
            if (result == null && track?.rawFirstArtist !== undefined && track.rawFirstArtist !== '') {
                // If filtered out by strict artist filter, retry without artist filter restriction
                result = await this.lrclibApi.searchByQueryAsync(query);
            }
            if (result != null) {
                return this.convertLrclibResponseToModel(track, result);
            }
        } catch {
            // Ignore
        }
        return undefined;
    }

    private async queryLyricsOvhAsync(query: string, track?: TrackModel): Promise<LyricsModel | undefined> {
        if (this.lyricsOvhApi == null) {
            return undefined;
        }

        try {
            const { artist, title } = this.parseQueryArtistAndTitle(query, track);
            if (artist.length > 0 && title.length > 0) {
                const ovhLyrics = await this.lyricsOvhApi.getLyricsAsync(artist, title);
                if (!StringUtils.isNullOrWhiteSpace(ovhLyrics.text) && !LyricsFilterUtils.isLanguageIncompatible(ovhLyrics.text, artist, title)) {
                    const cleaned = LyricsFilterUtils.cleanLyricsText(ovhLyrics.text, track);
                    return LyricsModel.plain(
                        track,
                        ovhLyrics.sourceName,
                        LyricsSourceType.online,
                        cleaned,
                        this.resolveMatchedValue(ovhLyrics.matchedTitle, title),
                        this.resolveMatchedValue(ovhLyrics.matchedArtist, artist),
                    );
                }
            }
        } catch {
            // Ignore
        }
        return undefined;
    }

    private parseQueryArtistAndTitle(query: string, track?: TrackModel): { artist: string; title: string } {
        let artist = (track?.rawFirstArtist ?? '').trim();
        let title = query.trim();
        const dashIndex = query.indexOf(' - ');

        if (dashIndex > 0) {
            artist = query.substring(0, dashIndex).trim();
            title = query.substring(dashIndex + 3).trim();
        } else if (artist.length > 0 && title.toLowerCase().startsWith(artist.toLowerCase())) {
            title = title.substring(artist.length).trim();
            if (title.startsWith('-')) {
                title = title.substring(1).trim();
            }
        } else if (artist === '') {
            const spaceIndex = query.indexOf(' ');
            if (spaceIndex > 0) {
                artist = query.substring(0, spaceIndex).trim();
                title = query.substring(spaceIndex + 1).trim();
            }
        }

        return { artist, title: title.length > 0 ? title : query };
    }

    private async queryJLyricAsync(query: string, track?: TrackModel): Promise<LyricsModel | undefined> {
        if (this.jLyricApi == null) {
            return undefined;
        }

        try {
            const { artist, title } = this.parseQueryArtistAndTitle(query, track);

            if (title.length > 0) {
                const jLyrics = await this.jLyricApi.getLyricsAsync(artist, title);
                if (!StringUtils.isNullOrWhiteSpace(jLyrics.text)) {
                    return LyricsModel.plain(
                        track,
                        jLyrics.sourceName,
                        LyricsSourceType.online,
                        jLyrics.text,
                        this.resolveMatchedValue(jLyrics.matchedTitle, title),
                        this.resolveMatchedValue(jLyrics.matchedArtist, artist),
                    );
                }
            }
        } catch {
            // Ignore
        }
        return undefined;
    }

    private async queryUtaTenAsync(query: string, track?: TrackModel): Promise<LyricsModel | undefined> {
        if (this.utaTenApi == null) {
            return undefined;
        }

        try {
            const { artist, title } = this.parseQueryArtistAndTitle(query, track);
            if (title.length > 0) {
                const utLyrics = await this.utaTenApi.getLyricsAsync(artist, title);
                if (!StringUtils.isNullOrWhiteSpace(utLyrics.text)) {
                    return LyricsModel.plain(
                        track,
                        utLyrics.sourceName,
                        LyricsSourceType.online,
                        utLyrics.text,
                        this.resolveMatchedValue(utLyrics.matchedTitle, title),
                        this.resolveMatchedValue(utLyrics.matchedArtist, artist),
                    );
                }
            }
        } catch {
            // Ignore
        }
        return undefined;
    }

    private async queryGeniusAsync(query: string, track?: TrackModel): Promise<LyricsModel | undefined> {
        if (this.geniusApi == null) {
            return undefined;
        }

        try {
            const geniusLyrics = await this.geniusApi.searchAndExtractLyricsAsync(query, track?.rawFirstArtist, track?.rawTitle);
            if (!StringUtils.isNullOrWhiteSpace(geniusLyrics.text) && !LyricsFilterUtils.isLanguageIncompatible(geniusLyrics.text, track?.rawFirstArtist, track?.rawTitle)) {
                return LyricsModel.plain(
                    track,
                    geniusLyrics.sourceName,
                    LyricsSourceType.online,
                    geniusLyrics.text,
                    this.resolveMatchedValue(geniusLyrics.matchedTitle, track?.rawTitle),
                    this.resolveMatchedValue(geniusLyrics.matchedArtist, track?.rawFirstArtist),
                );
            }
        } catch {
            // Ignore
        }
        return undefined;
    }

    private addTitleVariants(cleanTitle: string, titles: string[]): void {
        const slashParts = cleanTitle.split(/[/|]/).map((p) => p.trim()).filter((p) => p.length > 0);
        if (slashParts.length > 1) {
            for (const part of slashParts) {
                titles.push(part);
            }
        }

        const bracketMatches = cleanTitle.match(/[([【「『]([^()[\]【】「」『』]+)[)\]】」』]/g);
        if (bracketMatches != null) {
            for (const match of bracketMatches) {
                const inner = match.replace(/[([【「『)\]】」』]/g, '').trim();
                if (inner.length > 1) {
                    titles.push(inner);
                }
            }
            const withoutBrackets = cleanTitle.replace(/[([【「『][^()[\]【】「」『』]*[)\]】」』]/g, '').trim();
            if (withoutBrackets.length > 1 && withoutBrackets !== cleanTitle) {
                titles.push(withoutBrackets);
            }
        }
    }

    private extractTitleFromFileName(fileName: string): string | undefined {
        let fn = fileName.replace(/\.[a-z0-9]+$/i, '').trim();
        fn = fn.replace(/^\[[^\]]*\]\s*/, '').replace(/^\([^)]*\)\s*/, '').trim();
        fn = fn.replace(/^\d{1,2}[-._]\d{1,3}[\s._-]+/, '').trim();
        fn = fn.replace(/^\d{1,4}[\s._-]+/, '').trim();
        fn = this.stripBrackets(fn);

        if (fn.length <= 1) {
            return undefined;
        }

        const dashParts = fn.split(' - ');
        if (dashParts.length >= 2) {
            const lastPart = dashParts[dashParts.length - 1].trim();
            return lastPart.length > 1 ? lastPart : undefined;
        }

        return fn;
    }

    private stripBrackets(str: string): string {
        let result = '';
        let depth = 0;
        for (const char of str) {
            if (char === '[' || char === '【') {
                depth++;
            } else if ((char === ']' || char === '】') && depth > 0) {
                depth--;
            } else if (depth === 0) {
                result += char;
            }
        }
        return result.trim();
    }

    private convertLrclibResponseToModel(track: TrackModel | undefined, result: LrclibResponse): LyricsModel | undefined {
        const text = result.syncedLyrics ?? result.plainLyrics ?? '';
        if (LyricsFilterUtils.isLanguageIncompatible(text, track?.rawFirstArtist, track?.rawTitle)) {
            return undefined;
        }

        const matchedTitle = this.resolveMatchedValue(this.resolveMatchedValue(result.trackName, result.name), track?.rawTitle);
        const matchedArtist = this.resolveMatchedValue(result.artistName, track?.rawFirstArtist);

        if (!StringUtils.isNullOrWhiteSpace(result.syncedLyrics)) {
            const timedModel = this.parseSyncedLyrics(track, result.syncedLyrics!, matchedTitle, matchedArtist);
            if (timedModel != null) {
                return timedModel;
            }
        }

        if (!StringUtils.isNullOrWhiteSpace(result.plainLyrics)) {
            const cleaned = LyricsFilterUtils.cleanLyricsText(result.plainLyrics!, track);
            return LyricsModel.plain(track, this.lrclibApi.sourceName, LyricsSourceType.online, cleaned, matchedTitle, matchedArtist);
        }

        return undefined;
    }

    private parseSyncedLyrics(
        track: TrackModel | undefined,
        syncedLyrics: string,
        matchedTitle?: string,
        matchedArtist?: string,
    ): LyricsModel | undefined {
        const lines: string[] = syncedLyrics.split(/\r?\n/);
        let lyricsText: string = '';
        const lyricLines: string[] = [];
        const timeStamps: number[] = [];

        for (const line of lines) {
            const timestamps: number[] = this.parseTimestamps(line);

            if (timestamps.length === 0) {
                continue;
            }

            let textContent: string = line.replace(OnlineLyricsGetter.timestampRegex, '').trim();
            if (!StringUtils.isNullOrWhiteSpace(textContent)) {
                textContent = LyricsFilterUtils.cleanLyricsText(textContent, track);
            }

            for (const ts of timestamps) {
                lyricLines.push(textContent);
                timeStamps.push(ts);
            }

            if (!StringUtils.isNullOrWhiteSpace(textContent)) {
                if (lyricsText.length > 0) {
                    lyricsText += '\n';
                }

                lyricsText += textContent;
            }
        }

        if (StringUtils.isNullOrWhiteSpace(lyricsText) || lyricLines.length === 0) {
            return undefined;
        }

        const timedModel = LyricsModel.timed(track, this.lrclibApi.sourceName, LyricsSourceType.online, lyricsText, lyricLines, timeStamps);
        timedModel.matchedTitle = matchedTitle;
        timedModel.matchedArtist = matchedArtist;
        return timedModel;
    }

    private parseTimestamps(line: string): number[] {
        const timestamps: number[] = [];
        let match: RegExpExecArray | null;

        OnlineLyricsGetter.timestampRegex.lastIndex = 0;

        while ((match = OnlineLyricsGetter.timestampRegex.exec(line)) !== null) {
            const minutes: number = Number.parseInt(match[1], 10);
            const seconds: number = Number.parseInt(match[2], 10);
            const fraction: string = match[3];
            const fractionalSeconds: number = Number.parseInt(fraction, 10) / Math.pow(10, fraction.length);

            timestamps.push(minutes * 60 + seconds + fractionalSeconds);
        }

        return timestamps;
    }
}
