import { IMock, Mock } from 'typemoq';
import { Logger } from '../../common/logger';
import { LyricsRomanizationService } from './lyrics-romanization.service';
import { LyricsModel } from './lyrics-model';
import { LyricsSourceType } from '../../common/api/lyrics/lyrics-source-type';

describe('LyricsRomanizationService', () => {
    let loggerMock: IMock<Logger>;
    let service: LyricsRomanizationService;

    beforeEach(() => {
        loggerMock = Mock.ofType<Logger>();
        service = new LyricsRomanizationService(loggerMock.object);
    });

    describe('containsJapanese', () => {
        it('should return true for Hiragana and Katakana', () => {
            expect(service.containsJapanese('スノーフラワー')).toBe(true);
            expect(service.containsJapanese('ありがとう')).toBe(true);
        });

        it('should return true for Kanji', () => {
            expect(service.containsJapanese('雪が降る')).toBe(true);
        });

        it('should return false for English and Romaji', () => {
            expect(service.containsJapanese('Snow flower')).toBe(false);
            expect(service.containsJapanese('sunoo furawaa')).toBe(false);
            expect(service.containsJapanese('')).toBe(false);
            expect(service.containsJapanese(undefined)).toBe(false);
        });
    });

    describe('transliterateKanaToRomaji', () => {
        it('should transliterate Katakana and Hiragana to Romaji', () => {
            expect(service.transliterateKanaToRomaji('スノー')).toBe('sunoo');
            expect(service.transliterateKanaToRomaji('フラワー')).toBe('furawaa');
            expect(service.transliterateKanaToRomaji('さくら')).toBe('sakura');
        });

        it('should handle compound kana and small kana', () => {
            expect(service.transliterateKanaToRomaji('きょう')).toBe('kyou');
            expect(service.transliterateKanaToRomaji('ちょっと')).toBe('chotto');
        });
    });

    describe('tokenizeFallback', () => {
        it('should segment and produce aligned tokens for Japanese text', () => {
            const tokens = service.tokenizeFallback('スノーフラワー');
            expect(tokens.length).toBeGreaterThan(0);
            expect(tokens[0].original).toBeDefined();
            expect(tokens[0].romaji).toBeDefined();
        });

        it('should return empty array for empty string', () => {
            expect(service.tokenizeFallback('')).toEqual([]);
            expect(service.tokenizeFallback('   ')).toEqual([]);
        });
    });

    describe('romanizeLyricsAsync', () => {
        it('should do nothing if lyrics has no Japanese characters', async () => {
            const lyrics = LyricsModel.plain(undefined, 'test', LyricsSourceType.online, 'Hello World');
            await service.romanizeLyricsAsync(lyrics);
            expect(lyrics.romanizedLines).toBeUndefined();
            expect(lyrics.alignedTokens).toBeUndefined();
        });

        it('should populate romanizedLines, romanizedPlainText, and alignedTokens', async () => {
            const lyrics = LyricsModel.timed(
                undefined,
                'test',
                LyricsSourceType.lrc,
                'スノーフラワー\nさくら',
                ['スノーフラワー', 'さくら'],
                [0, 5],
            );

            await service.romanizeLyricsAsync(lyrics);

            expect(lyrics.romanizedLines).toBeDefined();
            expect(lyrics.romanizedLines!.length).toBe(2);
            expect(lyrics.alignedTokens).toBeDefined();
            expect(lyrics.alignedTokens!.length).toBe(2);
            expect(lyrics.alignedTokens![0].length).toBeGreaterThan(0);
            expect(lyrics.alignedTokens![0][0].original).toBeDefined();
            expect(lyrics.alignedTokens![0][0].romaji).toBeDefined();
        });
    });
});
