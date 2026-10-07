/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ILyricsApi } from './i-lyrics.api';
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { XMLParser } from 'fast-xml-parser';
import { Lyrics } from './lyrics';

@Injectable()
export class ChartLyricsApi implements ILyricsApi {
    public readonly sourceName: string = 'ChartLyrics';

    public constructor(private readonly httpClient: HttpClient) {}

    public async getLyricsAsync(artist: string, title: string): Promise<Lyrics> {
        const url: string = `http://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${artist}&song=${title}`;
        const response: string = await this.httpClient.get(url, { responseType: 'text' }).toPromise();
        const parser: XMLParser = new XMLParser();
        const jsonResponse: any = parser.parse(response);

        const lyricSong = jsonResponse.GetLyricResult.LyricSong as string | undefined;
        const lyricArtist = jsonResponse.GetLyricResult.LyricArtist as string | undefined;
        const matchedSong = lyricSong !== undefined && lyricSong !== '' ? lyricSong : title;
        const matchedArtist = lyricArtist !== undefined && lyricArtist !== '' ? lyricArtist : artist;

        return new Lyrics(this.sourceName, jsonResponse.GetLyricResult.Lyric as string, matchedSong, matchedArtist);
    }
}
