import { Component, Inject, OnInit, Optional, ViewEncapsulation } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TrackModel } from '../../../../services/track/track-model';
import { KaraokeroAlignmentService } from '../../../../services/lyrics/karaokero-alignment.service';
import { LyricsModel } from '../../../../services/lyrics/lyrics-model';
import { LyricsRomanizationService } from '../../../../services/lyrics/lyrics-romanization.service';
import { StringUtils } from '../../../../common/utils/string-utils';
import { LyricsFilterUtils } from '../../../../common/utils/lyrics-filter.utils';
import { LrclibApi } from '../../../../common/api/lyrics/lrclib.api';

export interface EnterLyricsDialogData {
    track: TrackModel;
    initialLyrics?: string;
}

@Component({
    selector: 'app-enter-lyrics-dialog',
    templateUrl: './enter-lyrics-dialog.component.html',
    styleUrls: ['./enter-lyrics-dialog.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class EnterLyricsDialogComponent implements OnInit {
    public lyricsText: string = '';
    public isAligning: boolean = false;
    public isPublishing: boolean = false;
    public shareWithCommunity: boolean = true;
    public statusMessage: string = '';
    public errorMessage: string = '';
    public publishSuccessMessage: string = '';

    public constructor(
        @Inject(MAT_DIALOG_DATA) public data: EnterLyricsDialogData,
        private dialogRef: MatDialogRef<EnterLyricsDialogComponent, LyricsModel | undefined>,
        @Optional() private karaokeroAlignmentService?: KaraokeroAlignmentService,
        @Optional() private romanizationService?: LyricsRomanizationService,
        @Optional() private lrclibApi?: LrclibApi,
    ) {
        dialogRef.disableClose = true;
    }

    public ngOnInit(): void {
        if (this.data?.initialLyrics) {
            this.lyricsText = this.data.initialLyrics;
        }
    }

    public get hasLyricsText(): boolean {
        return !StringUtils.isNullOrWhiteSpace(this.lyricsText);
    }

    public get canUseAi(): boolean {
        return this.karaokeroAlignmentService?.isAvailable() ?? false;
    }

    public get trackTitle(): string {
        return this.data?.track?.title || this.data?.track?.fileName || 'Canción';
    }

    public get trackArtist(): string {
        return this.data?.track?.artists || '';
    }

    public cleanLyrics(): void {
        if (this.lyricsText) {
            this.lyricsText = LyricsFilterUtils.cleanLyricsText(this.lyricsText, this.data?.track);
        }
    }

    public async syncWithAiAsync(): Promise<void> {
        this.cleanLyrics();
        if (!this.hasLyricsText || !this.karaokeroAlignmentService) {
            return;
        }

        this.isAligning = true;
        this.errorMessage = '';
        this.statusMessage = 'Escuchando audio y sincronizando letra con IA (Karaokero)... Esto puede tomar unos segundos.';

        try {
            const alignedLyrics = await this.karaokeroAlignmentService.alignLyricsAsync(
                this.data.track,
                this.lyricsText,
            );

            if (alignedLyrics) {
                if (this.romanizationService) {
                    await this.romanizationService.romanizeLyricsAsync(alignedLyrics);
                }
                if (this.shareWithCommunity) {
                    this.publishToLrclibInBackgroundAsync(alignedLyrics);
                }
                this.dialogRef.close(alignedLyrics);
                return;
            } else {
                this.errorMessage = 'No se pudo sincronizar con IA. Puedes guardar la letra en modo normal.';
            }
        } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e);
            this.errorMessage = `Error al sincronizar con IA: ${err}`;
        } finally {
            this.isAligning = false;
            this.statusMessage = '';
        }
    }

    public async savePlainLyricsAsync(): Promise<void> {
        this.cleanLyrics();
        if (!this.hasLyricsText || !this.karaokeroAlignmentService) {
            return;
        }

        this.isAligning = true;
        this.errorMessage = '';
        this.statusMessage = 'Guardando letra...';

        try {
            const lyrics = await this.karaokeroAlignmentService.savePlainLyricsAsync(
                this.data.track,
                this.lyricsText,
            );

            if (lyrics) {
                if (this.romanizationService) {
                    await this.romanizationService.romanizeLyricsAsync(lyrics);
                }
                if (this.shareWithCommunity) {
                    this.publishToLrclibInBackgroundAsync(lyrics);
                }
                this.dialogRef.close(lyrics);
            } else {
                this.errorMessage = 'Error al guardar el archivo de letra.';
            }
        } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e);
            this.errorMessage = `Error al guardar: ${err}`;
        } finally {
            this.isAligning = false;
            this.statusMessage = '';
        }
    }

    public async publishCurrentLyricsToLrclibAsync(): Promise<void> {
        this.cleanLyrics();
        if (!this.hasLyricsText || !this.lrclibApi) {
            return;
        }

        const track = this.data?.track;
        const artist = track?.rawFirstArtist || track?.artists || '';
        const title = track?.rawTitle || track?.title || '';

        if (!artist || !title) {
            this.errorMessage = 'La canción debe tener artista y título para compartirse en LRCLIB.';
            return;
        }

        this.isPublishing = true;
        this.errorMessage = '';
        this.publishSuccessMessage = '';
        this.statusMessage = 'Preparando publicación en la comunidad LRCLIB...';

        try {
            const durationSec = track.durationInMilliseconds > 0 ? Math.round(track.durationInMilliseconds / 1000) : undefined;
            const res = await this.lrclibApi.publishLyricsAsync(
                {
                    trackName: title,
                    artistName: artist,
                    albumName: track.albumTitle || undefined,
                    duration: durationSec,
                    plainLyrics: this.lyricsText,
                },
                (status) => {
                    this.statusMessage = status;
                },
            );

            if (res.success) {
                this.publishSuccessMessage = '¡Letra compartida exitosamente con la comunidad LRCLIB!';
                this.statusMessage = '';
            } else {
                this.errorMessage = res.error || 'No se pudo publicar la letra en LRCLIB';
                this.statusMessage = '';
            }
        } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e);
            this.errorMessage = `Error al publicar: ${err}`;
            this.statusMessage = '';
        } finally {
            this.isPublishing = false;
        }
    }

    private publishToLrclibInBackgroundAsync(lyrics: LyricsModel): void {
        if (!this.lrclibApi || !this.data?.track) {
            return;
        }
        const track = this.data.track;
        const artist = track.rawFirstArtist || track.artists || '';
        const title = track.rawTitle || track.title || '';
        if (!artist || !title) {
            return;
        }

        const durationSec = track.durationInMilliseconds > 0 ? Math.round(track.durationInMilliseconds / 1000) : undefined;
        let syncedLyrics: string | undefined;

        if (lyrics.textLines && lyrics.startTimeStamps && lyrics.textLines.length === lyrics.startTimeStamps.length) {
            const lines: string[] = [];
            for (let i = 0; i < lyrics.textLines.length; i++) {
                const st = lyrics.startTimeStamps[i];
                const m = Math.floor(st / 60);
                const s = st % 60;
                lines.push(`[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]${lyrics.textLines[i]}`);
            }
            syncedLyrics = lines.join('\n');
        }

        this.lrclibApi.publishLyricsAsync({
            trackName: title,
            artistName: artist,
            albumName: track.albumTitle || undefined,
            duration: durationSec,
            plainLyrics: lyrics.plainText || this.lyricsText,
            syncedLyrics,
        }).catch(() => {
            // Background attempt ignored if failed
        });
    }

    public cancel(): void {
        if (!this.isAligning && !this.isPublishing) {
            this.dialogRef.close(undefined);
        }
    }
}
