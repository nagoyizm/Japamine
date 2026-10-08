import { Injectable } from '@angular/core';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../common/logger';
import { StringUtils } from '../../common/utils/string-utils';
import { TrackModel } from '../track/track-model';
import { LyricsModel } from './lyrics-model';
import { LyricsSourceType } from '../../common/api/lyrics/lyrics-source-type';
import { LyricsFilterUtils } from '../../common/utils/lyrics-filter.utils';

export interface AlignedLineResult {
    line: string;
    start: number;
}

@Injectable({ providedIn: 'root' })
export class KaraokeroAlignmentService {
    private static readonly knownPythonPaths: string[] = [
        'D:\\Program Files\\karaokero\\venv\\Scripts\\python.exe',
        'C:\\Program Files\\karaokero\\venv\\Scripts\\python.exe',
    ];

    private static readonly karaokeroBaseDir: string = 'D:\\Program Files\\karaokero';

    private activePythonPath: string | null | undefined = undefined;

    public constructor(private logger: Logger) {}

    public isAvailable(): boolean {
        return this.getPythonPath() !== null;
    }

    public getPythonPath(): string | null {
        if (this.activePythonPath !== undefined) {
            return this.activePythonPath;
        }

        for (const candidate of KaraokeroAlignmentService.knownPythonPaths) {
            try {
                if (fs.existsSync(candidate)) {
                    this.activePythonPath = candidate;
                    return candidate;
                }
            } catch {
                // Ignore filesystem check errors
            }
        }

        this.activePythonPath = null;
        return null;
    }

    public async alignLyricsAsync(track: TrackModel, lyricsText: string): Promise<LyricsModel | undefined> {
        const pythonPath = this.getPythonPath();
        if (!pythonPath || !track || !track.path || StringUtils.isNullOrWhiteSpace(lyricsText)) {
            return undefined;
        }

        const cleanedLyrics = LyricsFilterUtils.cleanLyricsText(lyricsText, track);
        const lines = cleanedLyrics
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);

        if (lines.length === 0) {
            return undefined;
        }

        const lrcOutputPath = track.path.replace(/\.[a-zA-Z0-9]+$/, '.lrc');

        try {
            const alignedLines = await this.runKaraokeroAlignPythonAsync(pythonPath, track.path, lines, lrcOutputPath);
            if (!alignedLines || alignedLines.length === 0) {
                return undefined;
            }

            const textLines: string[] = alignedLines.map((a) => a.line);
            const timeStamps: number[] = alignedLines.map((a) => a.start);
            const fullText: string = textLines.join('\n');

            return LyricsModel.timed(
                track,
                'Karaokero AI',
                LyricsSourceType.lrc,
                fullText,
                textLines,
                timeStamps,
            );
        } catch (e: unknown) {
            this.logger.error(e, 'Failed to perform Karaokero forced alignment', 'KaraokeroAlignmentService', 'alignLyricsAsync');
            return undefined;
        }
    }

    public async savePlainLyricsAsync(track: TrackModel, lyricsText: string): Promise<LyricsModel | undefined> {
        if (!track || !track.path || StringUtils.isNullOrWhiteSpace(lyricsText)) {
            return undefined;
        }

        const cleanedLyrics = LyricsFilterUtils.cleanLyricsText(lyricsText, track);
        const lines = cleanedLyrics
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);

        if (lines.length === 0) {
            return undefined;
        }

        const lrcOutputPath = track.path.replace(/\.[a-zA-Z0-9]+$/, '.lrc');
        const durationSec = (track.durationInMilliseconds > 0) ? (track.durationInMilliseconds / 1000) : (lines.length * 4);
        const step = durationSec / Math.max(lines.length, 1);

        const lrcLines: string[] = [];
        const timeStamps: number[] = [];

        for (let i = 0; i < lines.length; i++) {
            const st = i * step;
            timeStamps.push(st);
            const m = Math.floor(st / 60);
            const s = st % 60;
            lrcLines.push(`[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]${lines[i]}`);
        }

        try {
            await fs.promises.writeFile(lrcOutputPath, lrcLines.join('\n'), 'utf-8');
            const fullText = lines.join('\n');
            return LyricsModel.timed(
                track,
                'Manual',
                LyricsSourceType.lrc,
                fullText,
                lines,
                timeStamps,
            );
        } catch (e: unknown) {
            this.logger.error(e, 'Failed to save plain lyrics', 'KaraokeroAlignmentService', 'savePlainLyricsAsync');
            return undefined;
        }
    }

    private runKaraokeroAlignPythonAsync(
        pythonPath: string,
        audioPath: string,
        lyricsLines: string[],
        lrcOutputPath?: string,
    ): Promise<AlignedLineResult[]> {
        return new Promise((resolve, reject) => {
            const pythonScript = `
import sys, json, os

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

payload = json.loads(sys.stdin.read())
audio_path = payload['audio_path']
lyrics_lines = payload['lyrics_lines']
lrc_output_path = payload.get('lrc_output_path')
karaokero_dir = payload.get('karaokero_dir', r'D:\\Program Files\\karaokero')

sys.path.append(karaokero_dir)

try:
    from align import align_lyrics
    import torch
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    words = align_lyrics(audio_path, lyrics_lines, device=device)
except Exception as e:
    sys.stderr.write(f"Alignment error: {str(e)}\\n")
    sys.exit(1)

# Group aligned words by line_index
lines_start = {}
for w in words:
    idx = w.get('line_index', 0)
    if idx not in lines_start or w['start'] < lines_start[idx]:
        lines_start[idx] = w['start']

sorted_keys = sorted(lines_start.keys())
results = []
lrc_lines = []

for i, line_text in enumerate(lyrics_lines):
    st = lines_start.get(i)
    if st is None:
        # Interpolate if voice segment for this line was silent or missed
        prev_k = [k for k in sorted_keys if k < i]
        next_k = [k for k in sorted_keys if k > i]
        if prev_k and next_k:
            p = max(prev_k)
            n = min(next_k)
            st = lines_start[p] + ((i - p) / (n - p)) * (lines_start[n] - lines_start[p])
        elif prev_k:
            st = lines_start[max(prev_k)] + 3.0
        elif next_k:
            st = max(0.0, lines_start[min(next_k)] - 3.0)
        else:
            st = float(i * 3.5)
    
    st_rounded = round(float(st), 2)
    results.append({'line': line_text, 'start': st_rounded})
    
    m = int(st_rounded // 60)
    s = st_rounded % 60
    lrc_lines.append(f"[{m:02d}:{s:05.2f}]{line_text}")

# Save .lrc file alongside the track
if lrc_output_path:
    try:
        with open(lrc_output_path, 'w', encoding='utf-8') as f:
            f.write('\\n'.join(lrc_lines))
    except Exception:
        pass

print(json.dumps(results))
`;
            let stdout = '';
            let stderr = '';

            const proc = spawn(pythonPath, ['-c', pythonScript]);
            proc.stdout.setEncoding('utf-8');
            proc.stderr.setEncoding('utf-8');

            proc.stdout.on('data', (d) => (stdout += d));
            proc.stderr.on('data', (d) => (stderr += d));

            proc.on('close', (code) => {
                if (code === 0 && stdout) {
                    try {
                        const parsed = JSON.parse(stdout) as AlignedLineResult[];
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

            const inputData = JSON.stringify({
                audio_path: audioPath,
                lyrics_lines: lyricsLines,
                lrc_output_path: lrcOutputPath,
                karaokero_dir: KaraokeroAlignmentService.karaokeroBaseDir,
            });

            proc.stdin.write(inputData, 'utf-8');
            proc.stdin.end();
        });
    }
}
