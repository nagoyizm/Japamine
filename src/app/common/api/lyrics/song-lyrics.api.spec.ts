import { HttpClient } from '@angular/common/http';
import { IMock, Mock, It } from 'typemoq';
import { of } from 'rxjs';
import { SongLyricsApi } from './song-lyrics.api';

describe('SongLyricsApi', () => {
    let httpClientMock: IMock<HttpClient>;
    let api: SongLyricsApi;

    beforeEach(() => {
        httpClientMock = Mock.ofType<HttpClient>();
        api = new SongLyricsApi(httpClientMock.object);
    });

    it('should create', () => {
        expect(api).toBeDefined();
        expect(api.sourceName).toBe('SongLyrics');
    });

    it('should return empty if title is empty', async () => {
        const result = await api.getLyricsAsync('Coldplay', '');
        expect(result.text).toBe('');
    });

    it('should search and extract lyrics from songlyrics html', async () => {
        const searchHtml = `
            <div class="serpresult">
                <h3><a href="https://www.songlyrics.com/coldplay/yellow-lyrics/">Yellow</a></h3>
                <div class="serpdesc-2">
                    <a href="https://www.songlyrics.com/coldplay-lyrics/">Coldplay</a>
                </div>
            </div>
        `;

        const songHtml = `
            <div id="songLyricsDiv" class="songLyricsV14">
                Look at the stars<br />
                Look how they shine for you<br />
                And everything you do
            </div>
        `;

        httpClientMock
            .setup((x) => x.get(It.is((url: string) => url.includes('section=search')), It.isAny()))
            .returns(() => of(searchHtml) as any);

        httpClientMock
            .setup((x) => x.get(It.is((url: string) => url.includes('coldplay/yellow-lyrics')), It.isAny()))
            .returns(() => of(songHtml) as any);

        const result = await api.getLyricsAsync('Coldplay', 'Yellow');
        expect(result.sourceName).toBe('SongLyrics');
        expect(result.text).toContain('Look at the stars');
        expect(result.text).toContain('Look how they shine for you');
    });

    it('should filter out placeholder "We do not have the lyrics for" message', async () => {
        const searchHtml = `
            <div class="serpresult">
                <h3><a href="https://www.songlyrics.com/test/nolyrics/">Test</a></h3>
            </div>
        `;

        const songHtml = `
            <div id="songLyricsDiv">
                We do not have the lyrics for this song yet.
            </div>
        `;

        httpClientMock
            .setup((x) => x.get(It.is((url: string) => url.includes('section=search')), It.isAny()))
            .returns(() => of(searchHtml) as any);

        httpClientMock
            .setup((x) => x.get(It.is((url: string) => url.includes('test/nolyrics')), It.isAny()))
            .returns(() => of(songHtml) as any);

        const result = await api.searchAndExtractAsync('Test', '', 'Test');
        expect(result.text).toBe('');
    });
});
