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

    /**
     * Checks if a line is a section header, structural tag, or non-sung metadata header.
     * Examples that return true:
     * - [Verse 1], [Verse], [Chorus], [Bridge], [Intro], [Outro], [Pre-Chorus], [Post-Chorus], [Hook], [Solo]
     * - (Chorus), (Verse 1), (Bridge)
     * - [Verse 1: Nakama Yukie], [Chorus - Artist]
     * - [Nakama Yukie (Yukie Nakama) "makenai ai ga kitto aru" Makenai Ai ga Kitto Aru kashi ]
     * - [ti: Makenai Ai ga Kitto aru], [ar: Nakama Yukie], [al: ...], [by: ...]
     * - Artist: Nakama Yukie, Title: Makenai Ai ga Kitto aru, Song: ...
     * - Empty or whitespace-only lines
     */
    public static isSectionHeaderOrMetadata(
        line: string | undefined,
        track?: { title?: string; artists?: string; rawTitle?: string; rawFirstArtist?: string },
    ): boolean {
        if (!line || line.trim().length === 0) {
            return true;
        }

        const trimmed = line.trim();

        // 1. Standard section headers: [Verse 1], [Chorus], (Bridge), [Pre-Chorus], [Coro], etc.
        const sectionHeaderRegex = /^\s*(\[|\()\s*(verse|chorus|bridge|intro|outro|pre-chorus|post-chorus|hook|refrain|interlude|solo|guitar solo|instrumental|estrofa|coro|puente|letra de|letra|lyrics|part\s+\d+|part\s+[ivx]+|drop|break|skit)\b[^\r\n\]\)]*(\]|\))\s*$/i;
        if (sectionHeaderRegex.test(trimmed)) {
            return true;
        }

        // 2. Standard LRC metadata tags: [ti:...], [ar:...], [al:...], [by:...], [offset:...], [length:...]
        const lrcTagRegex = /^\s*\[(ti|ar|al|by|offset|length|re|ve)\s*:[^\]]*\]\s*$/i;
        if (lrcTagRegex.test(trimmed)) {
            return true;
        }

        // 3. Metadata prefix lines: Artist: ..., Title: ..., Album: ..., etc.
        const metadataPrefixRegex = /^\s*(\[?(artist|title|album|song|track|composer|written by|lyrics by|produced by|arranged by|letra de|artista|canción|cancion|álbum|album)\]?\s*[:\-–—])/i;
        if (metadataPrefixRegex.test(trimmed)) {
            return true;
        }

        // 4. Bracketed lines: any line starting with [ and ending with ]
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            const inner = trimmed.substring(1, trimmed.length - 1).trim();
            const lowerInner = inner.toLowerCase();

            // Check if inner content contains metadata keywords: kashi (歌詞), lyrics, letra, etc.
            if (/\b(kashi|lyrics|letra|paroles|written by|produced by|arranged by|composed by|album|artist|track)\b/i.test(lowerInner)) {
                return true;
            }

            // Check if inner content contains section keywords anywhere
            if (/\b(verse|chorus|bridge|intro|outro|hook|interlude|solo|estrofa|coro|puente)\b/i.test(lowerInner)) {
                return true;
            }

            // If track is provided, check if inner content mentions the artist or title
            if (track) {
                const candidates: string[] = [];
                if (typeof track.title === 'string' && track.title.trim().length > 2) {
                    candidates.push(track.title.trim().toLowerCase());
                }
                if (typeof track.rawTitle === 'string' && track.rawTitle.trim().length > 2) {
                    candidates.push(track.rawTitle.trim().toLowerCase());
                }
                if (typeof track.artists === 'string' && track.artists.trim().length > 2) {
                    candidates.push(track.artists.trim().toLowerCase());
                }
                if (typeof track.rawFirstArtist === 'string' && track.rawFirstArtist.trim().length > 2) {
                    candidates.push(track.rawFirstArtist.trim().toLowerCase());
                }

                if (candidates.some((c) => lowerInner.includes(c))) {
                    return true;
                }
            }

            // Generic bracketed tag without Japanese text (e.g. [Instrumental], [Music], [Fade out], [Theme])
            if (!LyricsFilterUtils.containsJapanese(inner) && (inner.length < 40 || !inner.includes(' '))) {
                return true;
            }
        }

        // 5. Exact match with candidate titles or artists
        if (track) {
            const lower = trimmed.toLowerCase();
            const candTitles: string[] = [];
            const candArtists: string[] = [];

            if (typeof track.title === 'string' && track.title.trim().length > 2) { candTitles.push(track.title.trim().toLowerCase()); }
            if (typeof track.rawTitle === 'string' && track.rawTitle.trim().length > 2) { candTitles.push(track.rawTitle.trim().toLowerCase()); }
            if (typeof track.artists === 'string' && track.artists.trim().length > 2) { candArtists.push(track.artists.trim().toLowerCase()); }
            if (typeof track.rawFirstArtist === 'string' && track.rawFirstArtist.trim().length > 2) { candArtists.push(track.rawFirstArtist.trim().toLowerCase()); }

            if (candTitles.includes(lower) || candArtists.includes(lower)) {
                return true;
            }

            // Composite "Artist - Title" or "Title - Artist"
            if (candTitles.some((t) => candArtists.some((a) => lower.includes(t) && lower.includes(a)))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Strips leading inline section tags, e.g. "[Chorus] Sing..." -> "Sing...".
     */
    public static cleanInlineSectionTags(line: string): string {
        const inlineSectionTagRegex = /^\s*(\[|\()\s*(verse|chorus|bridge|intro|outro|pre-chorus|post-chorus|hook|refrain|interlude|solo|guitar solo|instrumental|estrofa|coro|puente)\b[^\r\n\]\)]*(\]|\))\s*/i;
        return line.replace(inlineSectionTagRegex, '').trim();
    }

    /**
     * Cleans raw lyrics text:
     * 1. Strips leading metadata headers (e.g. "Artist - Title", "Title: ...", "Artist: ...").
     * 2. Replaces section headers (e.g. "[Verse 1]", "[Chorus]", "[Bridge]") with a blank line separator.
     * 3. Removes embedded section tags (e.g. "[Chorus] line of text" -> "line of text").
     * 4. Normalizes extra whitespace and empty line clusters.
     */
    public static cleanLyricsText(
        rawText: string | undefined,
        track?: { title?: string; artists?: string; rawTitle?: string; rawFirstArtist?: string },
    ): string {
        if (!rawText || rawText.trim().length === 0) {
            return '';
        }

        const rawLines = rawText.split(/\r?\n/);
        const processedLines: string[] = [];
        let isBeginning = true;

        for (const line of rawLines) {
            let trimmed = line.trim();

            if (trimmed.length === 0) {
                if (!isBeginning) {
                    processedLines.push('');
                }
                continue;
            }

            // Check if this line is a section header or metadata line
            if (LyricsFilterUtils.isSectionHeaderOrMetadata(trimmed, track)) {
                // If not at the beginning, turn section headers into a stanza break
                if (!isBeginning) {
                    processedLines.push('');
                }
                continue;
            }

            // Clean inline tag if present, e.g. "[Chorus] Suki na..." -> "Suki na..."
            trimmed = LyricsFilterUtils.cleanInlineSectionTags(trimmed);
            if (trimmed.length === 0) {
                if (!isBeginning) {
                    processedLines.push('');
                }
                continue;
            }

            // This line is actual lyrics!
            isBeginning = false;
            processedLines.push(trimmed);
        }

        // Collapse consecutive blank lines so there's at most one empty line between stanzas
        const resultLines: string[] = [];
        let previousWasEmpty = false;

        for (const line of processedLines) {
            const isEmpty = line.trim().length === 0;
            if (isEmpty) {
                if (!previousWasEmpty && resultLines.length > 0) {
                    resultLines.push('');
                }
                previousWasEmpty = true;
            } else {
                resultLines.push(line);
                previousWasEmpty = false;
            }
        }

        return resultLines.join('\n').trim();
    }

    /**
     * Sanitizes a LyricsModel in place:
     * - Cleans plainText (strips metadata headers, converts section headers to blank line separators).
     * - Filters out section headers, metadata lines, and empty lines from textLines, startTimeStamps,
     *   endTimeStamps, and romanizedLines so only real singing lines remain.
     */
    public static sanitizeLyricsModel<T extends {
        plainText?: string;
        textLines?: string[];
        startTimeStamps?: number[];
        endTimeStamps?: number[];
        romanizedLines?: string[];
        track?: { title?: string; artists?: string; rawTitle?: string; rawFirstArtist?: string };
    }>(lyrics: T | undefined, trackOverride?: { title?: string; artists?: string; rawTitle?: string; rawFirstArtist?: string }): T | undefined {
        if (!lyrics) {
            return lyrics;
        }

        const track = trackOverride ?? lyrics.track;

        // 1. Sanitize plain text
        if (lyrics.plainText) {
            lyrics.plainText = LyricsFilterUtils.cleanLyricsText(lyrics.plainText, track);
        }

        // 2. Sanitize timed lines if present
        if (Array.isArray(lyrics.textLines) && lyrics.textLines.length > 0) {
            const hasStartTimes = Array.isArray(lyrics.startTimeStamps) && lyrics.startTimeStamps.length === lyrics.textLines.length;
            const hasEndTimes = Array.isArray(lyrics.endTimeStamps) && lyrics.endTimeStamps.length === lyrics.textLines.length;
            const hasRomaji = Array.isArray(lyrics.romanizedLines) && lyrics.romanizedLines.length === lyrics.textLines.length;

            const cleanTextLines: string[] = [];
            const cleanStartTimes: number[] = [];
            const cleanEndTimes: number[] = [];
            const cleanRomaji: string[] = [];

            for (let i = 0; i < lyrics.textLines.length; i++) {
                const rawLine = lyrics.textLines[i];
                const trimmed = LyricsFilterUtils.cleanInlineSectionTags(rawLine);

                // Skip lines that are purely section headers or non-sung metadata
                if (LyricsFilterUtils.isSectionHeaderOrMetadata(trimmed, track)) {
                    continue;
                }

                cleanTextLines.push(trimmed);
                if (hasStartTimes) { cleanStartTimes.push(lyrics.startTimeStamps![i]); }
                if (hasEndTimes) { cleanEndTimes.push(lyrics.endTimeStamps![i]); }
                if (hasRomaji) { cleanRomaji.push(lyrics.romanizedLines![i]); }
            }

            lyrics.textLines = cleanTextLines;
            if (hasStartTimes) { lyrics.startTimeStamps = cleanStartTimes; }
            if (hasEndTimes) { lyrics.endTimeStamps = cleanEndTimes; }
            if (hasRomaji) { lyrics.romanizedLines = cleanRomaji; }

            if (!lyrics.plainText && cleanTextLines.length > 0) {
                lyrics.plainText = cleanTextLines.join('\n');
            }
        }

        return lyrics;
    }
}
