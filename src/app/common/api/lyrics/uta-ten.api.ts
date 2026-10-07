import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ILyricsApi } from './i-lyrics.api';
import { Lyrics } from './lyrics';
import { StringUtils } from '../../utils/string-utils';
import { LyricsFilterUtils } from '../../utils/lyrics-filter.utils';
import * as cheerio from 'cheerio';

@Injectable({ providedIn: 'root' })
export class UtaTenApi implements ILyricsApi {
    private static readonly baseUrl: string = 'https://utaten.com';
    private static readonly browserHeaders = new HttpHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
    });

    public constructor(private readonly httpClient: HttpClient) {}

    public readonly sourceName: string = 'UtaTen';

    public async getLyricsAsync(artist: string, title: string): Promise<Lyrics> {
        if (StringUtils.isNullOrWhiteSpace(title)) {
            return Lyrics.empty();
        }

        const cleanTitle = title.trim();
        const cleanArtist = (artist ?? '').trim();

        try {
            // 1. First attempt: search with both artist and title
            if (cleanArtist.length > 0) {
                const combinedUrl = `${UtaTenApi.baseUrl}/search?sort=popular_sort_asc&artist_name=${encodeURIComponent(cleanArtist)}&title=${encodeURIComponent(cleanTitle)}`;
                const lyrics = await this.searchAndExtractFromUrlAsync(combinedUrl, cleanArtist, cleanTitle);
                if (!StringUtils.isNullOrWhiteSpace(lyrics.text)) {
                    return lyrics;
                }
            }

            // 2. Second attempt: search by title only and verify artist strictly
            const titleOnlyUrl = `${UtaTenApi.baseUrl}/search?sort=popular_sort_asc&title=${encodeURIComponent(cleanTitle)}`;
            return await this.searchAndExtractFromUrlAsync(titleOnlyUrl, cleanArtist, cleanTitle);
        } catch {
            return Lyrics.empty();
        }
    }

    private async searchAndExtractFromUrlAsync(
        searchUrl: string,
        expectedArtist: string,
        expectedTitle: string,
    ): Promise<Lyrics> {
        try {
            const html = await this.httpClient.get(searchUrl, {
                headers: UtaTenApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (html == null || html.length === 0) {
                return Lyrics.empty();
            }

            const $ = cheerio.load(html);
            let targetHref: string | undefined;
            let matchedTitle: string | undefined;
            let matchedArtist: string | undefined;

            $('tr, div.searchResult__item, div.box').each((_, el) => {
                if (targetHref != null) {
                    return;
                }

                const lyricLink = $(el).find('a[href^="/lyric/"]').first();
                const href = lyricLink.attr('href');
                const hitTitle = lyricLink.text().trim();

                if (href === undefined || href === '' || hitTitle.length === 0) {
                    return;
                }

                const hitArtist = $(el).find('a[href^="/artist/"]').text().trim();

                // Check artist if expected
                if (expectedArtist.length > 0 && hitArtist.length > 0) {
                    if (!LyricsFilterUtils.isArtistMatch(hitArtist, expectedArtist)) {
                        return;
                    }
                }

                // Check title
                if (!LyricsFilterUtils.isTitleMatch(hitTitle, expectedTitle)) {
                    return;
                }

                targetHref = href;
                matchedTitle = hitTitle;
                matchedArtist = hitArtist;
            });

            // Fallback: if no container matched, check first direct lyric link
            if (targetHref == null) {
                $('a[href^="/lyric/"]').each((_, linkEl) => {
                    if (targetHref != null) {
                        return;
                    }
                    const href = $(linkEl).attr('href');
                    const text = $(linkEl).text().trim();
                    if (href != null && text.length > 0 && LyricsFilterUtils.isTitleMatch(text, expectedTitle)) {
                        targetHref = href;
                        matchedTitle = text;
                    }
                });
            }

            if (targetHref == null) {
                return Lyrics.empty();
            }

            const songUrl = targetHref.startsWith('http') ? targetHref : `${UtaTenApi.baseUrl}${targetHref}`;
            const songHtml = await this.httpClient.get(songUrl, {
                headers: UtaTenApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (songHtml == null || songHtml.length === 0) {
                return Lyrics.empty();
            }

            const song$ = cheerio.load(songHtml);
            const lyricContainer = song$('.hiragana');

            if (lyricContainer.length === 0) {
                return Lyrics.empty();
            }

            // Remove furigana ruby annotations
            lyricContainer.find('.rt, rt').remove();
            lyricContainer.find('br').replaceWith('\n');

            const lyricsText = lyricContainer.text().trim();

            if (!StringUtils.isNullOrWhiteSpace(lyricsText)) {
                const finalTitle = matchedTitle !== undefined && matchedTitle !== '' ? matchedTitle : expectedTitle;
                const finalArtist = matchedArtist !== undefined && matchedArtist !== '' ? matchedArtist : expectedArtist;
                return new Lyrics(this.sourceName, lyricsText, finalTitle, finalArtist);
            }
        } catch {
            // Ignore extraction errors
        }

        return Lyrics.empty();
    }
}
