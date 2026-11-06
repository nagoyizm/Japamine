import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ILyricsApi } from './i-lyrics.api';
import { Lyrics } from './lyrics';
import { StringUtils } from '../../utils/string-utils';
import { LyricsFilterUtils } from '../../utils/lyrics-filter.utils';
import * as cheerio from 'cheerio';

@Injectable({ providedIn: 'root' })
export class LyricsTranslateApi implements ILyricsApi {
    private static readonly baseUrl: string = 'https://lyricstranslate.com';
    private static readonly browserHeaders = new HttpHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
    });

    public readonly sourceName: string = 'LyricsTranslate';

    public constructor(private readonly httpClient: HttpClient) {}

    public async getLyricsAsync(artist: string, title: string): Promise<Lyrics> {
        if (StringUtils.isNullOrWhiteSpace(title)) {
            return Lyrics.empty();
        }

        const cleanTitle = title.trim();
        const cleanArtist = (artist ?? '').trim();

        try {
            // 1. Search with clean title + artist if artist is present
            if (cleanArtist.length > 0) {
                const combined = `${cleanTitle} ${cleanArtist}`;
                const lyrics = await this.searchAndExtractAsync(combined, cleanArtist, cleanTitle);
                if (!StringUtils.isNullOrWhiteSpace(lyrics.text)) {
                    return lyrics;
                }

                // Try artist + title
                const combinedAlt = `${cleanArtist} ${cleanTitle}`;
                const lyricsAlt = await this.searchAndExtractAsync(combinedAlt, cleanArtist, cleanTitle);
                if (!StringUtils.isNullOrWhiteSpace(lyricsAlt.text)) {
                    return lyricsAlt;
                }
            }

            // 2. Search with title only
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
            const searchUrl = `${LyricsTranslateApi.baseUrl}/en/site-search?query=${encodeURIComponent(query)}`;
            const html = await this.httpClient.get(searchUrl, {
                headers: LyricsTranslateApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (html == null || html.length === 0) {
                return Lyrics.empty();
            }

            const $ = cheerio.load(html);
            let targetHref: string | undefined;
            let matchedTitle: string | undefined;
            let matchedArtist: string | undefined;

            // Song results are located in .song-list._songs or general .song-list
            $('.song-list._songs .block-search-res__item, .song-list .block-search-res__item').each((_, el) => {
                if (targetHref != null) {
                    return;
                }

                const titleLink = $(el).find('a.block-1-table__title, a[href$="-lyrics.html"]').first();
                const href = titleLink.attr('href');
                const hitTitle = titleLink.find('h2').text().trim() || titleLink.text().trim();

                if (!href || hitTitle.length === 0) {
                    return;
                }

                const authorLink = $(el).find('a.block-1-table__author').first();
                const hitArtist = authorLink.find('span.text').text().trim() || authorLink.text().trim();

                // If expectedArtist is provided, verify match
                if (expectedArtist.length > 0 && hitArtist.length > 0) {
                    if (!LyricsFilterUtils.isArtistMatch(hitArtist, expectedArtist)) {
                        return;
                    }
                }

                // Verify title match if expectedTitle is provided
                if (expectedTitle.length > 0 && !LyricsFilterUtils.isTitleMatch(hitTitle, expectedTitle)) {
                    return;
                }

                targetHref = href;
                matchedTitle = hitTitle;
                matchedArtist = hitArtist;
            });

            // Fallback: if strict match not found, try first song item
            if (targetHref == null) {
                const firstSong = $('.song-list._songs .block-search-res__item').first();
                if (firstSong.length > 0) {
                    const titleLink = firstSong.find('a.block-1-table__title, a[href*="-lyrics"]').first();
                    const href = titleLink.attr('href');
                    const hitTitle = titleLink.find('h2').text().trim() || titleLink.text().trim();
                    const hitArtist = firstSong.find('a.block-1-table__author').text().trim();

                    if (href && hitTitle.length > 0) {
                        targetHref = href;
                        matchedTitle = hitTitle;
                        matchedArtist = hitArtist;
                    }
                }
            }

            if (targetHref == null) {
                return Lyrics.empty();
            }

            // Fetch the song page
            const songPageUrl = targetHref.startsWith('http')
                ? targetHref
                : `${LyricsTranslateApi.baseUrl}${targetHref.startsWith('/') ? '' : '/'}${targetHref}`;

            const songHtml = await this.httpClient.get(songPageUrl, {
                headers: LyricsTranslateApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (songHtml == null || songHtml.length === 0) {
                return Lyrics.empty();
            }

            const song$ = cheerio.load(songHtml);
            let lyricsText = '';

            // Extract from #song-body .ltf
            const paragraphs = song$('#song-body .ltf .par');
            if (paragraphs.length > 0) {
                const verses: string[] = [];
                paragraphs.each((_, par) => {
                    const lines: string[] = [];
                    song$(par).find('div[class^="ll-"]').each((_, lineEl) => {
                        const lineText = song$(lineEl).text().trim();
                        if (lineText.length > 0) {
                            lines.push(lineText);
                        }
                    });
                    if (lines.length > 0) {
                        verses.push(lines.join('\n'));
                    } else {
                        const directText = song$(par).text().trim();
                        if (directText.length > 0) {
                            verses.push(directText);
                        }
                    }
                });
                lyricsText = verses.join('\n\n');
            }

            // Fallback if paragraphs weren't structured with .par
            if (StringUtils.isNullOrWhiteSpace(lyricsText)) {
                const bodyContainer = song$('#song-body, .translate__text').first();
                if (bodyContainer.length > 0) {
                    bodyContainer.find('br').replaceWith('\n');
                    lyricsText = bodyContainer.text().trim();
                }
            }

            if (StringUtils.isNullOrWhiteSpace(lyricsText)) {
                return Lyrics.empty();
            }

            return new Lyrics(this.sourceName, lyricsText, matchedTitle, matchedArtist);
        } catch {
            return Lyrics.empty();
        }
    }
}
