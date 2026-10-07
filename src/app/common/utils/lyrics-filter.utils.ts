export class LyricsFilterUtils {
    private static readonly frenchStopWords = /\b(dans|cette|pour|avec|nous|vous|elle|elles|ils|sont|chanson|paroles|monde|toujours|jamais|faire|comme|mais|tout|tous|toute|plus|aussi|bien|rien|notre|votre|sous|rue|qui|les|des|une|des|est|sur)\b/gi;
    private static readonly japaneseRomajiWords = /\b(wa|ga|wo|ni|de|te|da|boku|kimi|koto|anata|kara|mou|hitorikiri|kokoro|namida|yoru|sekai|ima|zutto|sora|yume|ashita|nai|heya|mizu|tsuki|hikari|koe|uta|shiteru|daiteru|dakedo|naze|doko)\b/gi;

    public static normalizeText(str: string | undefined): string {
        if (!str) {
            return '';
        }

        return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '');
    }

    public static isArtistMatch(candidate?: string, expected?: string): boolean {
        if (!candidate || !expected) {
            return false;
        }

        const nCand = LyricsFilterUtils.normalizeText(candidate);
        const nExp = LyricsFilterUtils.normalizeText(expected);

        if (!nCand || !nExp) {
            return false;
        }

        if (nCand === nExp) {
            return true;
        }

        // Substring check with minimum length to prevent short false positives
        if (nCand.length >= 4 && nExp.length >= 4) {
            if (nCand.includes(nExp) || nExp.includes(nCand)) {
                return true;
            }
        }

        // Word token overlap check
        const candWords = candidate.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const expWords = expected.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

        if (candWords.length > 0 && expWords.length > 0) {
            const matches = expWords.filter((w) => candWords.some((cw) => cw.includes(w) || w.includes(cw)));
            if (matches.length / expWords.length >= 0.7) {
                return true;
            }
        }

        return false;
    }

    public static isTitleMatch(candidateTitle?: string, expectedTitles?: string[] | string): boolean {
        if (!candidateTitle || !expectedTitles) {
            return false;
        }

        const nCand = LyricsFilterUtils.normalizeText(candidateTitle);
        if (!nCand) {
            return false;
        }

        const titles = Array.isArray(expectedTitles) ? expectedTitles : [expectedTitles];

        for (const t of titles) {
            const nExp = LyricsFilterUtils.normalizeText(t);
            if (!nExp) {
                continue;
            }

            if (nCand === nExp) {
                return true;
            }

            if (nCand.length >= 3 && nExp.length >= 3) {
                if (nCand.includes(nExp) || nExp.includes(nCand)) {
                    return true;
                }
            }
        }

        return false;
    }

    public static containsJapanese(text: string | undefined): boolean {
        if (!text) {
            return false;
        }
        return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
    }

    public static isJapaneseOrigin(artist?: string, title?: string): boolean {
        if (LyricsFilterUtils.containsJapanese(artist) || LyricsFilterUtils.containsJapanese(title)) {
            return true;
        }

        if (artist) {
            const lowerArtist = artist.toLowerCase();
            const knownJRock = [
                'plastic tree', 'the gazette', 'dir en grey', 'malice mizer',
                'larc~en~ciel', 'l\'arc~en~ciel', 'x japan', 'buck-tick',
                'mucc', 'sid', 'd\'espairsray', 'nightmare', 'alice nine',
                'luna sea', 'miyavi', 'gackt', 'dead end', 'kagrra',
            ];
            if (knownJRock.some((b) => lowerArtist.includes(b))) {
                return true;
            }
        }

        return false;
    }

    public static isLanguageIncompatible(lyricsText: string | undefined, artist?: string, title?: string): boolean {
        if (!lyricsText) {
            return false;
        }

        // We permit all languages and character sets (English, Japanese, Romaji, loan phrases, etc.)
        // Songs by Japanese artists often include English lines, Latin characters, or mixed languages.
        // We only reject obvious error messages or placeholders returned by APIs.
        const lower = lyricsText.trim().toLowerCase();
        if (
            lower === 'no lyrics found' ||
            lower === 'lyrics not available' ||
            lower === 'paroles introuvables' ||
            lower === 'instrumental'
        ) {
            return true;
        }

        return false;
    }
}
