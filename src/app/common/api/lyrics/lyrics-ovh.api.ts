import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ILyricsApi } from './i-lyrics.api';
import { Lyrics } from './lyrics';
import { StringUtils } from '../../utils/string-utils';
import { LyricsFilterUtils } from '../../utils/lyrics-filter.utils';

interface LyricsOvhResponse {
    lyrics?: string;
    error?: string;
}

@Injectable({ providedIn: 'root' })
export class LyricsOvhApi implements ILyricsApi {
    private static readonly baseUrl: string = 'https://api.lyrics.ovh/v1';

    public readonly sourceName: string = 'LyricsOVH';

    public constructor(private readonly httpClient: HttpClient) {}

    public async getLyricsAsync(artist: string, title: string): Promise<Lyrics> {
        if (StringUtils.isNullOrWhiteSpace(artist) || StringUtils.isNullOrWhiteSpace(title)) {
            return Lyrics.empty();
        }

        try {
            const cleanArtist = artist.trim();
            const cleanTitle = title.trim();
            const url = `${LyricsOvhApi.baseUrl}/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`;
            const response = await this.httpClient.get<LyricsOvhResponse>(url).toPromise();

            if (response != null && !StringUtils.isNullOrWhiteSpace(response.lyrics)) {
                const text = response.lyrics!.trim();
                if (!LyricsFilterUtils.isLanguageIncompatible(text, cleanArtist, cleanTitle)) {
                    return new Lyrics(this.sourceName, text, cleanTitle, cleanArtist);
                }
            }
        } catch {
            // Ignore network / 404 errors
        }

        return Lyrics.empty();
    }
}

