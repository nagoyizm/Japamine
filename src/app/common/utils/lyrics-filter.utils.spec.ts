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

        it('should strip complex bracketed metadata headers like Japanese kashi tags', () => {
            const input = `[Nakama Yukie (Yukie Nakama) "makenai ai ga kitto aru" Makenai Ai ga Kitto Aru kashi ]
[Verse 1]
Why? suki na kimochi wa surudoi toge
Why? mayoi sugiruto jibun ni sasaru
[Pre-Chorus]
Dakishimete kureru yori
[Chorus]
Makenai ai da tte`;

            const track = {
                title: 'Makenai Ai ga Kitto aru',
                artists: 'Nakama Yukie',
            };

            const expected = `Why? suki na kimochi wa surudoi toge
Why? mayoi sugiruto jibun ni sasaru

Dakishimete kureru yori

Makenai ai da tte`;

            const actual = LyricsFilterUtils.cleanLyricsText(input, track);
            expect(actual).toEqual(expected);
        });
    });

    describe('sanitizeLyricsModel', () => {
        it('should sanitize timed lyrics model removing section headers from textLines and timestamps', () => {
            const model = {
                plainText: '',
                textLines: [
                    '[Nakama Yukie (Yukie Nakama) "makenai ai ga kitto aru" Makenai Ai ga Kitto Aru kashi ]',
                    '[Verse 1]',
                    'Why? suki na kimochi wa surudoi toge',
                    '[Pre-Chorus]',
                    'Dakishimete kureru yori',
                    '[Chorus]',
                    'Makenai ai da tte',
                ],
                startTimeStamps: [0, 5, 10, 45, 48, 70, 75],
                romanizedLines: undefined,
            };

            const track = {
                title: 'Makenai Ai ga Kitto aru',
                artists: 'Nakama Yukie',
            };

            LyricsFilterUtils.sanitizeLyricsModel(model as any, track);

            expect(model.textLines).toEqual([
                'Why? suki na kimochi wa surudoi toge',
                'Dakishimete kureru yori',
                'Makenai ai da tte',
            ]);
            expect(model.startTimeStamps).toEqual([10, 48, 75]);
        });
    });
});
