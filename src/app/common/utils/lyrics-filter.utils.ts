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

        // Section header patterns: e.g. [Verse 1], [Chorus], (Bridge), [Intro], [Outro], [Pre-Chorus], [Hook], [Solo], [Coro], [Estrofa]
        const sectionHeaderRegex = /^\s*(\[|\()\s*(verse|chorus|bridge|intro|outro|pre-chorus|post-chorus|hook|refrain|interlude|solo|guitar solo|instrumental|estrofa|coro|puente|letra de|letra|lyrics|part\s+\d+|part\s+[ivx]+|drop|break|skit)\b[^\r\n\]\)]*(\]|\))\s*$/i;
        // Generic bracketed header line: e.g. [Verse], [Chorus: Artist], [Bridge 2]
        const genericBracketHeaderRegex = /^\s*\[[A-Za-z0-9\s\-_.:/]+\]\s*$/;

        // Inline section tag to remove from a line: e.g. "[Chorus] Some singing" -> "Some singing"
        const inlineSectionTagRegex = /^\s*(\[|\()\s*(verse|chorus|bridge|intro|outro|pre-chorus|post-chorus|hook|refrain|interlude|solo|guitar solo|instrumental|estrofa|coro|puente)\b[^\r\n\]\)]*(\]|\))\s*/i;

        // Metadata line prefix: e.g. "Artist: ...", "Title: ...", "Song: ...", "Lyrics by: ..."
        const metadataPrefixRegex = /^\s*(\[?(artist|title|album|song|track|composer|written by|lyrics by|produced by|arranged by|letra de|artista|canción|cancion|álbum|album)\]?\s*[:\-–—])/i;

        const rawLines = rawText.split(/\r?\n/);
        const processedLines: string[] = [];

        // Track matching strings for header elimination
        const candidateTitles: string[] = [];
        const candidateArtists: string[] = [];

        if (track) {
            if (typeof track.title === 'string') { candidateTitles.push(track.title.trim().toLowerCase()); }
            if (typeof track.rawTitle === 'string') { candidateTitles.push(track.rawTitle.trim().toLowerCase()); }
            if (typeof track.artists === 'string') { candidateArtists.push(track.artists.trim().toLowerCase()); }
            if (typeof track.rawFirstArtist === 'string') { candidateArtists.push(track.rawFirstArtist.trim().toLowerCase()); }
        }

        let isBeginning = true;

        for (const line of rawLines) {
            let trimmed = line.trim();

            if (trimmed.length === 0) {
                // If we are at the very beginning, skip empty lines
                if (!isBeginning) {
                    processedLines.push('');
                }
                continue;
            }

            // Check if line is at the beginning and contains title/artist metadata
            if (isBeginning) {
                // Check metadata prefix (e.g. "Artist: Foo", "Title: Bar")
                if (metadataPrefixRegex.test(trimmed)) {
                    continue;
                }

                const lowerLine = trimmed.toLowerCase();

                // Check exact match with artist or title
                const matchesTitle = candidateTitles.some((t) => t.length > 2 && (lowerLine === t || lowerLine.replace(/['"«»]/g, '') === t));
                const matchesArtist = candidateArtists.some((a) => a.length > 2 && (lowerLine === a || lowerLine.replace(/['"«»]/g, '') === a));

                // Check composite "Artist - Title" or "Title - Artist" or "Title by Artist"
                const matchesComposite = candidateTitles.some((t) =>
                    candidateArtists.some((a) => {
                        if (t.length < 2 || a.length < 2) { return false; }
                        return lowerLine.includes(t) && lowerLine.includes(a);
                    }),
                );

                if (matchesTitle || matchesArtist || matchesComposite) {
                    continue;
                }
            }

            // Check if line is a section header like [Verse 1], [Chorus], etc.
            if (sectionHeaderRegex.test(trimmed) || genericBracketHeaderRegex.test(trimmed)) {
                // Convert section header to a line break separator (empty line) if not at start
                if (!isBeginning) {
                    processedLines.push('');
                }
                continue;
            }

            // If line contains inline tag at beginning, e.g. "[Chorus] Hello"
            if (inlineSectionTagRegex.test(trimmed)) {
                trimmed = trimmed.replace(inlineSectionTagRegex, '').trim();
                if (trimmed.length === 0) {
                    if (!isBeginning) {
                        processedLines.push('');
                    }
                    continue;
                }
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
}
