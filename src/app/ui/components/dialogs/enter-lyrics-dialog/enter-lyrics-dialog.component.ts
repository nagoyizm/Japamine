import { Component, Inject, OnInit, Optional, ViewEncapsulation } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TrackModel } from '../../../../services/track/track-model';
import { KaraokeroAlignmentService } from '../../../../services/lyrics/karaokero-alignment.service';
import { LyricsModel } from '../../../../services/lyrics/lyrics-model';
import { LyricsRomanizationService } from '../../../../services/lyrics/lyrics-romanization.service';
import { StringUtils } from '../../../../common/utils/string-utils';

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
    public statusMessage: string = '';
    public errorMessage: string = '';

    public constructor(
        @Inject(MAT_DIALOG_DATA) public data: EnterLyricsDialogData,
        private dialogRef: MatDialogRef<EnterLyricsDialogComponent, LyricsModel | undefined>,
        @Optional() private karaokeroAlignmentService?: KaraokeroAlignmentService,
        @Optional() private romanizationService?: LyricsRomanizationService,
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

    public async syncWithAiAsync(): Promise<void> {
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

    public cancel(): void {
        if (!this.isAligning) {
            this.dialogRef.close(undefined);
        }
    }
}
