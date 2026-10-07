import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ILyricsApi } from './i-lyrics.api';
import { Lyrics } from './lyrics';
import { StringUtils } from '../../utils/string-utils';
import { LyricsFilterUtils } from '../../utils/lyrics-filter.utils';
import * as cheerio from 'cheerio';

interface GeniusSearchHit {
    type: string;
    result: {
        id: number;
        title: string;
        full_title: string;
        url: string;
        primary_artist?: {
            name: string;
        };
    };
}

interface GeniusSearchResponse {
    response?: {
        sections?: Array<{
            type: string;
            hits: GeniusSearchHit[];
        }>;
    };
}

@Injectable({ providedIn: 'root' })
export class GeniusApi implements ILyricsApi {
    private static readonly searchBaseUrl: string = 'https://genius.com/api/search/song';
    private static readonly browserHeaders = new HttpHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html',
    });

    public readonly sourceName: string = 'Genius';

    public constructor(private readonly httpClient: HttpClient) {}

    public async getLyricsAsync(artist: string, title: string): Promise<Lyrics> {
        if (StringUtils.isNullOrWhiteSpace(title)) {
            return Lyrics.empty();
        }

        const query = `${artist !== '' ? artist : ''} ${title}`.trim();
        return this.searchAndExtractLyricsAsync(query, artist, title);
    }

    public async searchAndExtractLyricsAsync(
        query: string,
        expectedArtist?: string,
        expectedTitles?: string[] | string,
    ): Promise<Lyrics> {
        if (StringUtils.isNullOrWhiteSpace(query)) {
            return Lyrics.empty();
        }

        try {
            const searchUrl = `${GeniusApi.searchBaseUrl}?q=${encodeURIComponent(query)}`;
            const searchRes = await this.httpClient.get<GeniusSearchResponse>(searchUrl, {
                headers: GeniusApi.browserHeaders,
            }).toPromise();

            const songSection = searchRes?.response?.sections?.find((s) => s.type === 'song');
            const hits = songSection?.hits ?? [];

            if (hits.length === 0) {
                return Lyrics.empty();
            }

            let eligibleHits = hits;

            // Strict Artist Filter: Reject results from unrelated artists (e.g. Radiohead for Plastic Tree)
            if (expectedArtist !== undefined && expectedArtist !== '') {
                eligibleHits = eligibleHits.filter((h) =>
                    LyricsFilterUtils.isArtistMatch(h.result?.primary_artist?.name, expectedArtist) ||
                    LyricsFilterUtils.isArtistMatch(h.result?.full_title, expectedArtist),
                );
            }

            if (eligibleHits.length === 0) {
                return Lyrics.empty();
            }

            // Title Filter: Prefer hits that match the requested title
            if (expectedTitles !== undefined && (Array.isArray(expectedTitles) ? expectedTitles.length > 0 : expectedTitles !== '')) {
                const matchingTitleHits = eligibleHits.filter((h) =>
                    LyricsFilterUtils.isTitleMatch(h.result?.title, expectedTitles) ||
                    LyricsFilterUtils.isTitleMatch(h.result?.full_title, expectedTitles),
                );
                if (matchingTitleHits.length > 0) {
                    eligibleHits = matchingTitleHits;
                }
            }

            const matchedHit = eligibleHits[0]?.result;
            const songUrl = matchedHit?.url;
            if (songUrl === undefined || songUrl === '') {
                return Lyrics.empty();
            }

            const html = await this.httpClient.get(songUrl, {
                headers: GeniusApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (html === undefined || html === '') {
                return Lyrics.empty();
            }

            const $ = cheerio.load(html);
            const containers = $('div[data-lyrics-container="true"]');
            if (containers.length === 0) {
                return Lyrics.empty();
            }

            let fullText = '';
            containers.each((_, el) => {
                $(el).find('br').replaceWith('\n');
                fullText += $(el).text() + '\n';
            });

            const cleaned = this.cleanGeniusLyrics(fullText);
            if (!StringUtils.isNullOrWhiteSpace(cleaned)) {
                // Strict Language Filter: Discard foreign language mismatches
                if (LyricsFilterUtils.isLanguageIncompatible(cleaned, expectedArtist)) {
                    return Lyrics.empty();
                }

                return new Lyrics(this.sourceName, cleaned, matchedHit?.title, matchedHit?.primary_artist?.name);
            }
        } catch {
            // Ignore fetch errors
        }

        return Lyrics.empty();
    }

    private cleanGeniusLyrics(text: string): string {
        return text
            .replace(/^\d+\s*Contributors[^\n]*?Lyrics/i, '')
            .replace(/\d*Embed$/i, '')
            .split('You might also like')
            .join('')
            .trim();
    }
}
