import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { StringUtils } from '../../utils/string-utils';
import { LyricsFilterUtils } from '../../utils/lyrics-filter.utils';

export interface LrclibResponse {
    id?: number;
    name?: string;
    trackName?: string;
    artistName?: string;
    albumName?: string;
    duration?: number;
    instrumental?: boolean;
    plainLyrics?: string;
    syncedLyrics?: string;
}

@Injectable({ providedIn: 'root' })
export class LrclibApi {
    private static readonly baseUrl: string = 'https://lrclib.net/api';

    public constructor(private httpClient: HttpClient) {}

    public get sourceName(): string {
        return 'LRCLIB';
    }

    public async getLyricsAsync(
        artist: string,
        title: string,
        album?: string,
        duration?: number,
    ): Promise<LrclibResponse | undefined> {
        if (StringUtils.isNullOrWhiteSpace(artist) || StringUtils.isNullOrWhiteSpace(title)) {
            return undefined;
        }

        const cleanArtist = this.cleanString(artist);
        const cleanTitle = this.cleanTitle(title);

        // 1. Try exact match with /api/get
        try {
            const params: string[] = [
                `artist_name=${encodeURIComponent(cleanArtist)}`,
                `track_name=${encodeURIComponent(cleanTitle)}`,
            ];

            if (!StringUtils.isNullOrWhiteSpace(album)) {
                params.push(`album_name=${encodeURIComponent(this.cleanString(album!))}`);
            }

            if (duration != undefined && duration > 0) {
                params.push(`duration=${Math.round(duration)}`);
            }

            const url = `${LrclibApi.baseUrl}/get?${params.join('&')}`;
            const result = await this.httpClient.get<LrclibResponse>(url).toPromise();

            if (result && (!StringUtils.isNullOrWhiteSpace(result.syncedLyrics) || !StringUtils.isNullOrWhiteSpace(result.plainLyrics))) {
                if (!LyricsFilterUtils.isLanguageIncompatible(result.syncedLyrics || result.plainLyrics, artist, title)) {
                    return result;
                }
            }
        } catch {
            // If exact match fails (e.g. 404), fall through to search
        }

        // 2. Try search endpoint with /api/search
        try {
            const searchUrl = `${LrclibApi.baseUrl}/search?artist_name=${encodeURIComponent(cleanArtist)}&track_name=${encodeURIComponent(cleanTitle)}`;
            const searchResults = await this.httpClient.get<LrclibResponse[]>(searchUrl).toPromise();

            const match = this.selectBestResult(searchResults, cleanArtist, cleanTitle);
            if (match) {
                return match;
            }
        } catch {
            // Search failed
        }

        // 3. Fallback to general full-text search with /api/search?q=
        try {
            return await this.searchByQueryAsync(`${cleanArtist} ${cleanTitle}`, cleanArtist, cleanTitle);
        } catch {
            // Full-text search failed
        }

        return undefined;
    }

    public async searchRawAsync(query: string): Promise<LrclibResponse[]> {
        if (StringUtils.isNullOrWhiteSpace(query)) {
            return [];
        }

        const cleanQuery = query.trim();
        try {
            const searchUrl = `${LrclibApi.baseUrl}/search?q=${encodeURIComponent(cleanQuery)}`;
            const searchResults = await this.httpClient.get<LrclibResponse[]>(searchUrl).toPromise();
            return searchResults ?? [];
        } catch {
            return [];
        }
    }

    public async searchByQueryAsync(
        query: string,
        expectedArtist?: string,
        expectedTitles?: string[] | string,
    ): Promise<LrclibResponse | undefined> {
        if (StringUtils.isNullOrWhiteSpace(query)) {
            return undefined;
        }

        const cleanQuery = query.trim();
        try {
            const searchResults = await this.searchRawAsync(cleanQuery);
            return this.selectBestResult(searchResults, expectedArtist, expectedTitles);
        } catch {
            return undefined;
        }
    }

    private selectBestResult(
        results?: LrclibResponse[],
        expectedArtist?: string,
        expectedTitles?: string[] | string,
    ): LrclibResponse | undefined {
        if (!results || results.length === 0) {
            return undefined;
        }

        let candidates = results;

        // Prefer matching expected artist if available
        if (expectedArtist) {
            const artistMatches = candidates.filter((x) => LyricsFilterUtils.isArtistMatch(x.artistName, expectedArtist));
            if (artistMatches.length > 0) {
                candidates = artistMatches;
            }
        }

        // Strict Language Filter: Reject foreign language mismatches
        candidates = candidates.filter((x) => {
            const text = x.syncedLyrics || x.plainLyrics;
            return !LyricsFilterUtils.isLanguageIncompatible(text, expectedArtist);
        });

        if (candidates.length === 0) {
            return undefined;
        }

        // Title Filter: Prefer candidates that match the expected title
        if (expectedTitles) {
            const matchingTitleCandidates = candidates.filter((x) =>
                LyricsFilterUtils.isTitleMatch(x.trackName, expectedTitles) ||
                LyricsFilterUtils.isTitleMatch(x.name, expectedTitles),
            );
            if (matchingTitleCandidates.length > 0) {
                candidates = matchingTitleCandidates;
            }
        }

        // Prioritize result with synced lyrics
        const withSynced = candidates.find(
            (x) => !StringUtils.isNullOrWhiteSpace(x.syncedLyrics),
        );
        if (withSynced) {
            return withSynced;
        }

        const withPlain = candidates.find(
            (x) => !StringUtils.isNullOrWhiteSpace(x.plainLyrics),
        );
        if (withPlain) {
            return withPlain;
        }

        return undefined;
    }

    public cleanTitle(title: string): string {
        return title
            .replace(/\s*\(feat\..*?\)/gi, '')
            .replace(/\s*\[feat\..*?\]/gi, '')
            .replace(/\s*\(ft\..*?\)/gi, '')
            .replace(/\s*\[ft\..*?\]/gi, '')
            .replace(/\s*\(official.*?\)/gi, '')
            .replace(/\s*\[official.*?\]/gi, '')
            .replace(/\s*\(remastered.*?\)/gi, '')
            .replace(/\s*\[remastered.*?\]/gi, '')
            .replace(/\s*\(tv\s*size.*?\)/gi, '')
            .replace(/\s*\[tv\s*size.*?\]/gi, '')
            .replace(/\s*\(movie\s*ver.*?\)/gi, '')
            .replace(/\s*\[movie\s*ver.*?\]/gi, '')
            .replace(/\s*\(full\s*ver.*?\)/gi, '')
            .replace(/\s*\[full\s*ver.*?\]/gi, '')
            .replace(/\s*\(instrumental.*?\)/gi, '')
            .replace(/\s*\[instrumental.*?\]/gi, '')
            .replace(/\s*\(off\s*vocal.*?\)/gi, '')
            .replace(/\s*\[off\s*vocal.*?\]/gi, '')
            .replace(/\s*\[(op|ed|ost)\s*\d*\]/gi, '')
            .replace(/\s*\((op|ed|ost)\s*\d*\)/gi, '')
            .replace(/^[0-9]{1,3}\s*[-.]\s*/, '')
            .trim();
    }

    private cleanString(str: string): string {
        return str.trim();
    }

    public async publishLyricsAsync(
        request: {
            trackName: string;
            artistName: string;
            albumName?: string;
            duration?: number;
            plainLyrics?: string;
            syncedLyrics?: string;
        },
        onProgress?: (status: string) => void,
    ): Promise<{ success: boolean; error?: string }> {
        if (StringUtils.isNullOrWhiteSpace(request.trackName) || StringUtils.isNullOrWhiteSpace(request.artistName)) {
            return { success: false, error: 'Título y artista son obligatorios' };
        }

        try {
            onProgress?.('Obteniendo verificación de LRCLIB...');
            const challenge = await this.httpClient
                .post<{ prefix: string; target: string }>(
                    `${LrclibApi.baseUrl}/request-challenge`,
                    {},
                    {
                        headers: {
                            'User-Agent': 'Japamine/3.0.13 (https://github.com/nagoyizm/japamine)',
                        },
                    },
                )
                .toPromise();

            if (!challenge || !challenge.prefix || !challenge.target) {
                return { success: false, error: 'No se pudo obtener el desafío de verificación' };
            }

            onProgress?.('Resolviendo verificación anti-spam (PoW)...');
            const token = await this.solvePoWChallengeAsync(challenge.prefix, challenge.target);

            onProgress?.('Publicando letra en LRCLIB...');
            await this.httpClient
                .post(
                    `${LrclibApi.baseUrl}/publish`,
                    request,
                    {
                        headers: {
                            'X-Publish-Token': token,
                            'User-Agent': 'Japamine/3.0.13 (https://github.com/nagoyizm/japamine)',
                        },
                    },
                )
                .toPromise();

            return { success: true };
        } catch (e: any) {
            const msg = e?.error?.message || e?.message || 'Error al publicar en LRCLIB';
            return { success: false, error: msg };
        }
    }

    private async solvePoWChallengeAsync(prefix: string, targetHex: string): Promise<string> {
        const target = targetHex.toLowerCase();
        let nonce = 0;
        let crypto: any;
        try {
            crypto = require('crypto');
        } catch {
            // fallback
        }

        while (true) {
            if (!crypto) {
                throw new Error('Módulo crypto no disponible');
            }

            const hashHex = crypto.createHash('sha256').update(prefix + nonce).digest('hex');
            if (hashHex <= target) {
                return `${prefix}:${nonce}`;
            }

            nonce++;

            if (nonce % 50000 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
    }
}
