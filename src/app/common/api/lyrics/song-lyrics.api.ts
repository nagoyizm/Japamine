import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ILyricsApi } from './i-lyrics.api';
import { Lyrics } from './lyrics';
import { StringUtils } from '../../utils/string-utils';
import { LyricsFilterUtils } from '../../utils/lyrics-filter.utils';
import * as cheerio from 'cheerio';

@Injectable({ providedIn: 'root' })
export class SongLyricsApi implements ILyricsApi {
    private static readonly baseUrl: string = 'https://www.songlyrics.com';
    private static readonly browserHeaders = new HttpHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
    });

    public readonly sourceName: string = 'SongLyrics';

    public constructor(private readonly httpClient: HttpClient) {}

    public async getLyricsAsync(artist: string, title: string): Promise<Lyrics> {
        if (StringUtils.isNullOrWhiteSpace(title)) {
            return Lyrics.empty();
        }

        const cleanTitle = title.trim();
        const cleanArtist = (artist ?? '').trim();

        try {
            // 1. Search artist + title
            if (cleanArtist.length > 0) {
                const combined = `${cleanArtist} ${cleanTitle}`;
                const lyrics = await this.searchAndExtractAsync(combined, cleanArtist, cleanTitle);
                if (!StringUtils.isNullOrWhiteSpace(lyrics.text)) {
                    return lyrics;
                }

                // Try title + artist
                const combinedAlt = `${cleanTitle} ${cleanArtist}`;
                const lyricsAlt = await this.searchAndExtractAsync(combinedAlt, cleanArtist, cleanTitle);
                if (!StringUtils.isNullOrWhiteSpace(lyricsAlt.text)) {
                    return lyricsAlt;
                }
            }

            // 2. Search title only
            return await this.searchAndExtractAsync(cleanTitle, cleanArtist, cleanTitle);
        } catch {
            return Lyrics.empty();
        }
    }

    public async searchAndExtractAsync(
        query: string,
        expectedArtist: string,
        expectedTitle: string,
    ): Promise<Lyrics> {
        if (StringUtils.isNullOrWhiteSpace(query)) {
            return Lyrics.empty();
        }

        try {
            const searchUrl = `${SongLyricsApi.baseUrl}/index.php?section=search&searchW=${encodeURIComponent(query)}`;
            const html = await this.httpClient.get(searchUrl, {
                headers: SongLyricsApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (html == null || html.length === 0) {
                return Lyrics.empty();
            }

            const $ = cheerio.load(html);
            let targetHref: string | undefined;
            let matchedTitle: string | undefined;
            let matchedArtist: string | undefined;

            $('.serpresult, .serp-compact, div.search-results .card-compact').each((_, el) => {
                if (targetHref != null) {
                    return;
                }

                const titleLink = $(el).find('h3 a, a[href$="-lyrics/"]').first();
                const href = titleLink.attr('href');
                const hitTitle = titleLink.text().trim();

                if (!href || hitTitle.length === 0) {
                    return;
                }

                const artistLink = $(el).find('.serpdesc-2 a, .search-featured-artist a, .serp-compact-artist a, a[href$="-lyrics/"]').not(titleLink).first();
                const hitArtist = artistLink.text().trim();

                if (expectedArtist.length > 0 && hitArtist.length > 0) {
                    if (!LyricsFilterUtils.isArtistMatch(hitArtist, expectedArtist)) {
                        return;
                    }
                }

                if (expectedTitle.length > 0 && !LyricsFilterUtils.isTitleMatch(hitTitle, expectedTitle)) {
                    return;
                }

                targetHref = href;
                matchedTitle = hitTitle;
                matchedArtist = hitArtist;
            });

            // Fallback: check first result link that points to lyrics
            if (targetHref == null) {
                const firstResult = $('.serpresult h3 a, .serp-compact a').first();
                const href = firstResult.attr('href');
                if (href && href.includes('-lyrics')) {
                    targetHref = href;
                    matchedTitle = firstResult.text().trim();
                }
            }

            if (targetHref == null) {
                return Lyrics.empty();
            }

            const songUrl = targetHref.startsWith('http') ? targetHref : `${SongLyricsApi.baseUrl}${targetHref}`;
            const songHtml = await this.httpClient.get(songUrl, {
                headers: SongLyricsApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (songHtml == null || songHtml.length === 0) {
                return Lyrics.empty();
            }

            const song$ = cheerio.load(songHtml);
            const lyricsDiv = song$('#songLyricsDiv, .lyrics-body').first();
            if (lyricsDiv.length === 0) {
                return Lyrics.empty();
            }

            lyricsDiv.find('br').replaceWith('\n');
            const lyricsText = lyricsDiv.text().trim();

            // Filter out placeholder messages
            if (
                StringUtils.isNullOrWhiteSpace(lyricsText) ||
                lyricsText.includes('We do not have the lyrics for') ||
                lyricsText.includes('This song has no lyrics') ||
                lyricsText.includes('Submit Lyrics')
            ) {
                return Lyrics.empty();
            }

            return new Lyrics(this.sourceName, lyricsText, matchedTitle, matchedArtist);
        } catch {
            return Lyrics.empty();
        }
    }
}
