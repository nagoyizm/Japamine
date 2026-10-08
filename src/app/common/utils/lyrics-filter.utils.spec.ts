import { LyricsFilterUtils } from './lyrics-filter.utils';

describe('LyricsFilterUtils', () => {
    describe('cleanLyricsText', () => {
        it('should return empty string for empty input', () => {
            expect(LyricsFilterUtils.cleanLyricsText('')).toEqual('');
            expect(LyricsFilterUtils.cleanLyricsText(undefined)).toEqual('');
        });

        it('should remove section headers and turn them into line breaks', () => {
            const input = `[Verse 1]
Hello darkness my old friend
[Verse 2]
I've come to talk with you again
[Chorus]
Hear my words that I might teach you`;

            const expected = `Hello darkness my old friend

I've come to talk with you again

Hear my words that I might teach you`;

            const actual = LyricsFilterUtils.cleanLyricsText(input);
            expect(actual).toEqual(expected);
        });

        it('should remove metadata lines at the beginning', () => {
            const input = `Artist: Queen
Title: Bohemian Rhapsody
Album: A Night at the Opera

[Verse 1]
Is this the real life?
Is this just fantasy?`;

            const expected = `Is this the real life?
Is this just fantasy?`;

            const actual = LyricsFilterUtils.cleanLyricsText(input);
            expect(actual).toEqual(expected);
        });

        it('should remove composite artist - title lines at the beginning', () => {
            const input = `Queen - Bohemian Rhapsody

Is this the real life?
Is this just fantasy?`;

            const track = {
                title: 'Bohemian Rhapsody',
                artists: 'Queen',
            };

            const expected = `Is this the real life?
Is this just fantasy?`;

            const actual = LyricsFilterUtils.cleanLyricsText(input, track);
            expect(actual).toEqual(expected);
        });

        it('should strip inline section tags at the start of a line', () => {
            const input = `[Chorus] Mama, just killed a man
Put a gun against his head`;

            const expected = `Mama, just killed a man
Put a gun against his head`;

            const actual = LyricsFilterUtils.cleanLyricsText(input);
            expect(actual).toEqual(expected);
        });

        it('should handle Japanese lyrics with title as first line', () => {
            const input = `Pretender

君とのラブストーリー
それは予想通り`;

            const track = {
                title: 'Pretender',
                artists: 'Official HIGE DANDism',
            };

            const expected = `君とのラブストーリー
それは予想通り`;

            const actual = LyricsFilterUtils.cleanLyricsText(input, track);
            expect(actual).toEqual(expected);
        });
    });
});
