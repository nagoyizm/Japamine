import { Injectable } from '@angular/core';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { Logger } from '../../common/logger';
import { StringUtils } from '../../common/utils/string-utils';
import { LyricsModel } from './lyrics-model';

@Injectable({ providedIn: 'root' })
export class LyricsRomanizationService {
    private static readonly japaneseRegex: RegExp = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
    private static readonly knownPythonPaths: string[] = [
        'D:\\Program Files\\karaokero\\venv\\Scripts\\python.exe',
        'C:\\Program Files\\karaokero\\venv\\Scripts\\python.exe',
        'C:\\Python314\\python.exe',
    ];

    private activePythonPath: string | null | undefined = undefined;
    private cache: Map<string, string[]> = new Map();

    public constructor(private logger: Logger) {}

    public containsJapanese(text: string | undefined): boolean {
        if (StringUtils.isNullOrWhiteSpace(text)) {
            return false;
        }
        return LyricsRomanizationService.japaneseRegex.test(text!);
    }

    public async romanizeLyricsAsync(lyrics: LyricsModel): Promise<void> {
        if (!lyrics || !this.containsJapanese(lyrics.plainText)) {
            return;
        }

        const lines = lyrics.textLines && lyrics.textLines.length > 0
            ? lyrics.textLines
            : lyrics.plainText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

        const cacheKey = lines.join('\n');
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey)!;
            lyrics.romanizedLines = [...cached];
            lyrics.romanizedPlainText = cached.join('\n');
            return;
        }

        try {
            const romanized = await this.romanizeLinesAsync(lines);
            if (romanized && romanized.length === lines.length) {
                this.cache.set(cacheKey, romanized);
                lyrics.romanizedLines = [...romanized];
                lyrics.romanizedPlainText = romanized.join('\n');
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Could not romanize lyrics', 'LyricsRomanizationService', 'romanizeLyricsAsync');
        }
    }

    public async romanizeLinesAsync(lines: string[]): Promise<string[]> {
        if (!lines || lines.length === 0) {
            return [];
        }

        let romanized: string[] | undefined;

        // 1. Try Cutlet via Karaokero Python venv (MeCab accurate morphological romanizer)
        const pythonPath = this.getPythonPath();
        if (pythonPath) {
            try {
                const cutletResults = await this.runCutletPythonAsync(pythonPath, lines);
                if (cutletResults && cutletResults.length === lines.length) {
                    romanized = cutletResults;
                }
            } catch (e: unknown) {
                this.logger.error(e, 'Cutlet execution failed, falling back to built-in Kana transliterator', 'LyricsRomanizationService', 'romanizeLinesAsync');
            }
        }

        if (!romanized) {
            romanized = [...lines];
        }

        // 2. Transliterate any remaining Katakana or Hiragana characters in every line
        return romanized.map((line) => {
            if (this.containsJapanese(line)) {
                return this.transliterateKanaToRomaji(line);
            }
            return line;
        });
    }

    private getPythonPath(): string | null {
        if (this.activePythonPath !== undefined) {
            return this.activePythonPath;
        }

        for (const candidate of LyricsRomanizationService.knownPythonPaths) {
            try {
                if (fs.existsSync(candidate)) {
                    this.activePythonPath = candidate;
                    return candidate;
                }
            } catch {
                // Ignore filesystem access check errors
            }
        }

        this.activePythonPath = null;
        return null;
    }

    private runCutletPythonAsync(pythonPath: string, lines: string[]): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const script = `
import sys, json, cutlet
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
try:
    k = cutlet.Cutlet()
    k.use_foreign_spelling = False
except Exception:
    sys.exit(2)

lines = json.loads(sys.stdin.read())
result = []
for l in lines:
    if not l:
        result.append('')
        continue
    try:
        if any('\\u3040' <= c <= '\\u9fff' or '\\uff66' <= c <= '\\uff9f' for c in l):
            r = k.romaji(l)
            result.append(r if r is not None else l)
        else:
            result.append(l)
    except Exception:
        result.append(l)

print(json.dumps(result))
`;
            let stdout = '';
            let stderr = '';

            const proc = spawn(pythonPath, ['-c', script]);
            proc.stdout.setEncoding('utf-8');
            proc.stderr.setEncoding('utf-8');

            proc.stdout.on('data', (d) => (stdout += d));
            proc.stderr.on('data', (d) => (stderr += d));

            proc.on('close', (code) => {
                if (code === 0 && stdout) {
                    try {
                        const parsed = JSON.parse(stdout) as string[];
                        resolve(parsed);
                        return;
                    } catch (err) {
                        reject(err);
                        return;
                    }
                }
                reject(new Error(stderr || `Python process exited with code ${code}`));
            });

            proc.on('error', (err) => reject(err));

            proc.stdin.write(JSON.stringify(lines), 'utf-8');
            proc.stdin.end();
        });
    }

    /**
     * Built-in comprehensive fallback transliterator for Hiragana & Katakana to Hepburn Romaji.
     * Handles full-width and half-width Katakana, loan words, compound sounds, small kana, and prolonged vowels.
     */
    public transliterateKanaToRomaji(rawText: string): string {
        if (!rawText) {
            return '';
        }

        // NFKC normalization automatically converts half-width Katakana (ｱ, ｶﾞ, etc.) to full-width
        const text = rawText.normalize('NFKC');

        const kanaMap: { [key: string]: string } = {
            // Extended Katakana Digraphs (crucial for loan words & modern songs)
            'シェ': 'she', 'ジェ': 'je',  'チェ': 'che',
            'ティ': 'ti',  'ディ': 'di',  'トゥ': 'tu',  'ドゥ': 'du',
            'テュ': 'tyu', 'デュ': 'dyu',
            'ファ': 'fa',  'フィ': 'fi',  'フェ': 'fe',  'フォ': 'fo',  'フュ': 'fyu',
            'ウィ': 'wi',  'ウェ': 'we',  'ウォ': 'wo',
            'ヴァ': 'va',  'ヴィ': 'vi',  'ヴェ': 've',  'ヴォ': 'vo',  'ヴュ': 'vyu',
            'ツァ': 'tsa', 'ツィ': 'tsi', 'ツェ': 'tse', 'ツォ': 'tso',
            'クァ': 'kwa', 'クィ': 'kwi', 'クェ': 'kwe', 'クォ': 'kwo',
            'グァ': 'gwa', 'グィ': 'gwi', 'グェ': 'gwe', 'グォ': 'gwo',
            'スィ': 'si',  'ズィ': 'zi',  'イェ': 'ye',

            // Standard Digraphs (Yōon)
            'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
            'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
            'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
            'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
            'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
            'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
            'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
            'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
            'じゃ': 'ja',  'じゅ': 'ju',  'じょ': 'jo',
            'ぢゃ': 'ja',  'ぢゅ': 'ju',  'ぢょ': 'jo',
            'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
            'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
            'キャ': 'kya', 'キュ': 'kyu', 'キョ': 'kyo',
            'シャ': 'sha', 'シュ': 'shu', 'ショ': 'sho',
            'チャ': 'cha', 'チュ': 'chu', 'チョ': 'cho',
            'ニャ': 'nya', 'ニュ': 'nyu', 'ニョ': 'nyo',
            'ヒャ': 'hya', 'ヒュ': 'hyu', 'ヒョ': 'hyo',
            'ミャ': 'mya', 'ミュ': 'myu', 'ミョ': 'myo',
            'リャ': 'rya', 'リュ': 'ryu', 'リョ': 'ryo',
            'ギャ': 'gya', 'ギュ': 'gyu', 'ギョ': 'gyo',
            'ジャ': 'ja',  'ジュ': 'ju',  'ジョ': 'jo',
            'ヂャ': 'ja',  'ヂュ': 'ju',  'ヂョ': 'jo',
            'ビャ': 'bya', 'ビュ': 'byu', 'ビョ': 'byo',
            'ピャ': 'pya', 'ピュ': 'pyu', 'ピョ': 'pyo',

            // Basic Hiragana
            'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
            'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
            'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
            'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
            'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
            'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
            'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
            'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
            'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
            'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'wo', 'ん': 'n',
            'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
            'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
            'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
            'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
            'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',

            // Basic Katakana
            'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o',
            'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko',
            'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so',
            'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to',
            'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no',
            'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho',
            'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo',
            'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
            'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro',
            'ワ': 'wa', 'ヰ': 'wi', 'ヱ': 'we', 'ヲ': 'wo', 'ン': 'n',
            'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go',
            'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
            'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
            'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
            'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po',
            'ヴ': 'vu',

            // Standalone small kana (never leave Katakana behind!)
            'ァ': 'a', 'ぁ': 'a',
            'ィ': 'i', 'ぃ': 'i',
            'ゥ': 'u', 'ぅ': 'u',
            'ェ': 'e', 'ぇ': 'e',
            'ォ': 'o', 'ぉ': 'o',
            'ャ': 'ya', 'ゃ': 'ya',
            'ュ': 'yu', 'ゅ': 'yu',
            'ョ': 'yo', 'ょ': 'yo',
            'ヮ': 'wa', 'ゎ': 'wa',
            'ヵ': 'ka', 'ヶ': 'ke',

            // Japanese punctuation & spacing
            '、': ', ', '。': '. ', '「': '"', '」': '"', '『': '"', '』': '"', '・': ' ', '　': ' ', '～': '~',
        };

        // Fallback readings for common lyrics Kanji when Cutlet is unavailable
        const kanjiMap: { [key: string]: string } = {
            '私': 'watashi', '僕': 'boku', '君': 'kimi', '貴方': 'anata', 'あなた': 'anata',
            '愛': 'ai', '恋': 'koi', '心': 'kokoro', '夢': 'yume', '涙': 'namida',
            '夜': 'yoru', '歌': 'uta', '今': 'ima', '空': 'sora', '風': 'kaze',
            '星': 'hoshi', '光': 'hikari', '声': 'koe', '世界': 'sekai', '未来': 'mirai',
            '時間': 'jikan', '明日': 'ashita', '今日': 'kyou', '昨日': 'kinou',
            '誰': 'dare', '何': 'nani', 'どこ': 'doko', 'いつも': 'itsumo', 'ずっと': 'zutto',
        };

        let result = '';
        let i = 0;

        while (i < text.length) {
            const char = text[i];

            // 1. Chōonpu (prolonged sound mark 'ー' or 'ｰ') -> extend previous vowel
            if (char === 'ー' || char === 'ｰ') {
                const prev = result[result.length - 1]?.toLowerCase();
                if (prev === 'a' || prev === 'i' || prev === 'u' || prev === 'e' || prev === 'o') {
                    result += prev;
                }
                i++;
                continue;
            }

            // 2. Sokuon (small tsu っ or ッ) -> double next consonant (or 't' if 'ch')
            if ((char === 'っ' || char === 'ッ') && i + 1 < text.length) {
                const nextCharTwo = text.slice(i + 1, i + 3);
                const nextCharOne = text.slice(i + 1, i + 2);
                const nextRomaji = kanaMap[nextCharTwo] || kanaMap[nextCharOne] || '';
                if (nextRomaji && nextRomaji.length > 0) {
                    const firstConsonant = nextRomaji[0].toLowerCase();
                    if (firstConsonant === 'c') {
                        result += 't';
                    } else if (/[a-z]/.test(firstConsonant)) {
                        result += firstConsonant;
                    }
                    i++;
                    continue;
                }
            }

            // 3. Multi-character Kanji check (fallback)
            if (i + 1 < text.length) {
                const twoKanji = text.slice(i, i + 2);
                if (kanjiMap[twoKanji]) {
                    result += (result.length > 0 && !result.endsWith(' ') ? ' ' : '') + kanjiMap[twoKanji] + ' ';
                    i += 2;
                    continue;
                }
            }
            if (kanjiMap[char]) {
                result += (result.length > 0 && !result.endsWith(' ') ? ' ' : '') + kanjiMap[char] + ' ';
                i++;
                continue;
            }

            // 4. Check 2-char Kana combinations (extended and standard digraphs)
            if (i + 1 < text.length) {
                const twoChars = text.slice(i, i + 2);
                if (kanaMap[twoChars]) {
                    result += kanaMap[twoChars];
                    i += 2;
                    continue;
                }
            }

            // 5. Check 1-char Kana or punctuation
            if (kanaMap[char]) {
                result += kanaMap[char];
            } else {
                result += char;
            }
            i++;
        }

        // Clean up accidental double spaces from kanji insertions
        return result.replace(/\s{2,}/g, ' ');
    }
}

