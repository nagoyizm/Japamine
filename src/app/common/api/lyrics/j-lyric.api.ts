import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ILyricsApi } from './i-lyrics.api';
import { Lyrics } from './lyrics';
import { StringUtils } from '../../utils/string-utils';
import { LyricsFilterUtils } from '../../utils/lyrics-filter.utils';
import * as cheerio from 'cheerio';

@Injectable({ providedIn: 'root' })
export class JLyricApi implements ILyricsApi {
    private static readonly baseUrl: string = 'https://j-lyric.net';
    private static readonly browserHeaders = new HttpHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
    });

    public readonly sourceName: string = 'J-Lyric.net';

    public constructor(private readonly httpClient: HttpClient) {}

    public async getLyricsAsync(artist: string, title: string): Promise<Lyrics> {
        if (StringUtils.isNullOrWhiteSpace(title)) {
            return Lyrics.empty();
        }

        const cleanTitle = title.trim();
        const cleanArtist = (artist !== '' ? artist : '').trim();

        try {
            // 1. First attempt: search with both title and artist
            if (cleanArtist !== '') {
                const combinedUrl = `${JLyricApi.baseUrl}/search.php?kt=${encodeURIComponent(cleanTitle)}&ct=2&ka=${encodeURIComponent(cleanArtist)}&ca=2`;
                const lyrics = await this.searchAndExtractFromUrlAsync(combinedUrl, cleanArtist, cleanTitle);
                if (!StringUtils.isNullOrWhiteSpace(lyrics.text)) {
                    return lyrics;
                }
            }

            // 2. Second attempt: search by title only and filter results strictly by artist
            const titleOnlyUrl = `${JLyricApi.baseUrl}/search.php?kt=${encodeURIComponent(cleanTitle)}&ct=2`;
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
                headers: JLyricApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (html === undefined || html === '') {
                return Lyrics.empty();
            }

            const $ = cheerio.load(html);
            const hits = $('#mnb .bdy');

            if (hits.length === 0) {
                return Lyrics.empty();
            }

            let targetHref: string | undefined;
            let matchedTitle: string | undefined;
            let matchedArtist: string | undefined;

            hits.each((_, el) => {
                if (targetHref !== undefined) {
                    return;
                }

                const hitTitle = $(el).find('p.mid a').text().trim();
                const hitArtist = $(el).find('p.sml a').text().trim();
                const href = $(el).find('p.mid a').attr('href');

                if (href === undefined || href === '' || hitTitle === '') {
                    return;
                }

                // Verify artist match if artist was provided
                if (expectedArtist !== '' && !LyricsFilterUtils.isArtistMatch(hitArtist, expectedArtist)) {
                    return;
                }

                // Verify title match
                if (!LyricsFilterUtils.isTitleMatch(hitTitle, expectedTitle)) {
                    return;
                }

                targetHref = href;
                matchedTitle = hitTitle;
                matchedArtist = hitArtist;
            });

            if (targetHref === undefined || targetHref === '') {
                return Lyrics.empty();
            }

            const songUrl = targetHref.startsWith('http') ? targetHref : `${JLyricApi.baseUrl}${targetHref}`;
            const songHtml = await this.httpClient.get(songUrl, {
                headers: JLyricApi.browserHeaders,
                responseType: 'text',
            }).toPromise();

            if (songHtml === undefined || songHtml === '') {
                return Lyrics.empty();
            }

            const song$ = cheerio.load(songHtml);
            const lyricContainer = song$('#Lyric');

            if (lyricContainer.length === 0) {
                return Lyrics.empty();
            }

            lyricContainer.find('br').replaceWith('\n');
            const lyricsText = lyricContainer.text().trim();

            if (!StringUtils.isNullOrWhiteSpace(lyricsText)) {
                const finalTitle = matchedTitle !== undefined && matchedTitle !== '' ? matchedTitle : expectedTitle;
                const finalArtist = matchedArtist !== undefined && matchedArtist !== '' ? matchedArtist : expectedArtist;
                return new Lyrics(this.sourceName, lyricsText, finalTitle, finalArtist);
            }
        } catch {
            // Ignore network or extraction errors
        }

        return Lyrics.empty();
    }
}
