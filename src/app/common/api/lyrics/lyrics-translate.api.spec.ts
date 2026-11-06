import { HttpClient } from '@angular/common/http';
import { IMock, Mock, It } from 'typemoq';
import { of } from 'rxjs';
import { LyricsTranslateApi } from './lyrics-translate.api';

describe('LyricsTranslateApi', () => {
    let httpClientMock: IMock<HttpClient>;
    let api: LyricsTranslateApi;

    beforeEach(() => {
        httpClientMock = Mock.ofType<HttpClient>();
        api = new LyricsTranslateApi(httpClientMock.object);
    });

    it('should create', () => {
        expect(api).toBeDefined();
        expect(api.sourceName).toBe('LyricsTranslate');
    });

    it('should return empty if title is empty', async () => {
        const result = await api.getLyricsAsync('Coldplay', '');
        expect(result.text).toBe('');
    });

    it('should search and extract lyrics from lyricstranslate html', async () => {
        const searchHtml = `
            <div class="song-list search-res__block block-search-res _songs">
                <div class="block-search-res__items">
                    <div class="block-search-res__item">
                        <div class="block-1-table">
                            <a href="/en/coldplay-yellow-lyrics.html" class="block-1-table__title"><h2>Yellow</h2></a>
                            <div class="block-1-table__author-wrap">
                                <a href="/en/coldplay-lyrics.html" class="block-1-table__author"><span class="text">Coldplay</span></a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const songHtml = `
            <div id="song-body">
                <div class="ltf">
                    <div class="par">
                        <div class="ll-0-1">Look at the stars</div>
                        <div class="ll-0-2">Look how they shine for you</div>
                    </div>
                    <div class="par">
                        <div class="ll-1-1">And it was called Yellow</div>
                    </div>
                </div>
            </div>
        `;

        httpClientMock
            .setup((x) => x.get(It.is((url: string) => url.includes('site-search')), It.isAny()))
            .returns(() => of(searchHtml) as any);

        httpClientMock
            .setup((x) => x.get(It.is((url: string) => url.includes('coldplay-yellow-lyrics')), It.isAny()))
            .returns(() => of(songHtml) as any);

        const result = await api.getLyricsAsync('Coldplay', 'Yellow');
        expect(result.sourceName).toBe('LyricsTranslate');
        expect(result.text).toContain('Look at the stars');
        expect(result.text).toContain('And it was called Yellow');
    });
});
