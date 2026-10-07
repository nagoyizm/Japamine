import { Injectable } from '@angular/core';
import { TrackRepositoryBase } from '../../data/repositories/track-repository.base';
import { AlbumArtworkRepositoryBase } from '../../data/repositories/album-artwork-repository.base';
import { ApplicationPaths } from '../../common/application/application-paths';
import { FileAccessBase } from '../../common/io/file-access.base';
import { TrackServiceBase } from '../track/track.service.base';
import { TrackModels } from '../track/track-models';
import { Track } from '../../data/entities/track';

export interface TopPlayedFolderModel {
    path: string;
    name: string;
    playCount: number;
    trackCount: number;
    artist?: string;
    albumTitle?: string;
    artworkUrl?: string;
}

export interface FolderMetadata {
    path: string;
    name: string;
    artist?: string;
    albumTitle?: string;
    artworkUrl?: string;
    trackCount: number;
}

@Injectable({ providedIn: 'root' })
export class FolderMetadataService {
    private artworkCacheByAlbumKey: Map<string, string> = new Map();
    private folderMetadataCache: Map<string, FolderMetadata> = new Map();
    private artworkCacheInitialized: boolean = false;

    public constructor(
        private trackRepository: TrackRepositoryBase,
        private albumArtworkRepository: AlbumArtworkRepositoryBase,
        private applicationPaths: ApplicationPaths,
        private fileAccess: FileAccessBase,
        private trackService: TrackServiceBase,
    ) {}

    public async getTopPlayedFoldersAsync(limit: number = 5): Promise<TopPlayedFolderModel[]> {
        const tracksWithPlays: Track[] = this.trackRepository.getTracksWithPlays() ?? [];

        if (tracksWithPlays.length === 0) {
            return [];
        }

        await this.ensureArtworkCacheInitializedAsync();

        // Group by folder path
        const folderStats = new Map<
            string,
            {
                playCount: number;
                trackCount: number;
                artist?: string;
                albumTitle?: string;
                albumKey?: string;
                samplePath: string;
            }
        >();

        for (const track of tracksWithPlays) {
            if (!track.path) {
                continue;
            }

            const folderPath = this.fileAccess.getDirectoryPath(track.path);
            const existing = folderStats.get(folderPath);

            if (existing) {
                existing.playCount += track.playCount ?? 0;
                existing.trackCount++;
                if (!existing.artist && track.artists) {
                    existing.artist = track.artists;
                }
                if (!existing.albumTitle && track.albumTitle) {
                    existing.albumTitle = track.albumTitle;
                }
            } else {
                folderStats.set(folderPath, {
                    playCount: track.playCount ?? 0,
                    trackCount: 1,
                    artist: track.artists,
                    albumTitle: track.albumTitle,
                    albumKey: track.albumKey,
                    samplePath: track.path,
                });
            }
        }

        // Sort descending by play count
        const sorted = Array.from(folderStats.entries()).sort(
            (a, b) => b[1].playCount - a[1].playCount,
        );

        const topFolders: TopPlayedFolderModel[] = [];

        for (let i = 0; i < Math.min(limit, sorted.length); i++) {
            const [folderPath, data] = sorted[i];
            const name = this.getFolderName(folderPath);
            const artworkUrl = await this.resolveFolderArtworkUrlAsync(folderPath, data.albumKey);

            topFolders.push({
                path: folderPath,
                name: name,
                playCount: data.playCount,
                trackCount: data.trackCount,
                artist: data.artist,
                albumTitle: data.albumTitle,
                artworkUrl: artworkUrl,
            });
        }

        return topFolders;
    }

    public async getFolderMetadataAsync(folderPath: string): Promise<FolderMetadata> {
        const cached = this.folderMetadataCache.get(folderPath);
        if (cached) {
            return cached;
        }

        await this.ensureArtworkCacheInitializedAsync();

        const tracks: Track[] = this.trackRepository.getTracksInDirectoryPrefix(folderPath) ?? [];
        const name = this.getFolderName(folderPath);

        let artist: string | undefined;
        let albumTitle: string | undefined;
        let albumKey: string | undefined;

        if (tracks.length > 0) {
            const first = tracks[0];
            artist = first.artists;
            albumTitle = first.albumTitle;
            albumKey = first.albumKey;
        }

        const artworkUrl = await this.resolveFolderArtworkUrlAsync(folderPath, albumKey);

        const metadata: FolderMetadata = {
            path: folderPath,
            name: name,
            artist: artist,
            albumTitle: albumTitle,
            artworkUrl: artworkUrl,
            trackCount: tracks.length,
        };

        this.folderMetadataCache.set(folderPath, metadata);
        return metadata;
    }

    public getAllVisibleTracks(): TrackModels {
        return this.trackService.getVisibleTracks();
    }

    public clearCache(): void {
        this.folderMetadataCache.clear();
        this.artworkCacheByAlbumKey.clear();
        this.artworkCacheInitialized = false;
    }

    private async resolveFolderArtworkUrlAsync(folderPath: string, albumKey?: string): Promise<string | undefined> {
        // 1. Try from database AlbumArtwork
        if (albumKey && this.artworkCacheByAlbumKey.has(albumKey)) {
            const artworkId = this.artworkCacheByAlbumKey.get(albumKey)!;
            const fullPath = this.applicationPaths.coverArtFullPath(artworkId);
            if (this.fileAccess.pathExists(fullPath)) {
                return 'file:///' + fullPath.replace(/\\/g, '/');
            }
        }

        // 2. Try physical cover art in folder directory
        const commonCoverNames = [
            'cover.jpg',
            'cover.jpeg',
            'cover.png',
            'folder.jpg',
            'folder.jpeg',
            'folder.png',
            'front.jpg',
            'front.jpeg',
            'front.png',
            'album.jpg',
            'album.png',
        ];

        for (const name of commonCoverNames) {
            const imagePath = this.fileAccess.combinePath([folderPath, name]);
            if (this.fileAccess.pathExists(imagePath)) {
                return 'file:///' + imagePath.replace(/\\/g, '/');
            }
        }

        return undefined;
    }

    private async ensureArtworkCacheInitializedAsync(): Promise<void> {
        if (this.artworkCacheInitialized) {
            return;
        }

        try {
            const artworks = this.albumArtworkRepository.getAllAlbumArtwork() ?? [];
            for (const art of artworks) {
                if (art.albumKey && art.artworkId) {
                    this.artworkCacheByAlbumKey.set(art.albumKey, art.artworkId);
                }
            }
            this.artworkCacheInitialized = true;
        } catch {
            // Ignore error if database is not ready
        }
    }

    private getFolderName(folderPath: string): string {
        if (!folderPath) {
            return '';
        }
        const clean = folderPath.replace(/[/\\]+$/, '');
        const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
        if (lastSlash >= 0) {
            return clean.substring(lastSlash + 1);
        }
        return clean;
    }
}
