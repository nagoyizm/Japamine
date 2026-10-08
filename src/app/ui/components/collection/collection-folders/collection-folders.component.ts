import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy, OnInit, Optional, ViewChild, ViewEncapsulation } from '@angular/core';
import { ipcRenderer } from 'electron';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { IOutputData } from 'angular-split';
import { Subscription } from 'rxjs';
import { Constants } from '../../../../common/application/constants';
import { Hacks } from '../../../../common/hacks';
import { Logger } from '../../../../common/logger';
import { PromiseUtils } from '../../../../common/utils/promise-utils';
import { StringUtils } from '../../../../common/utils/string-utils';
import { FolderModel } from '../../../../services/folder/folder-model';
import { SubfolderModel } from '../../../../services/folder/subfolder-model';
import { PlaybackStarted } from '../../../../services/playback/playback-started';
import { TrackModel } from '../../../../services/track/track-model';
import { TrackModels } from '../../../../services/track/track-models';
import { AddToPlaylistMenu } from '../../add-to-playlist-menu';
import { FolderTracksPersister } from './folder-tracks-persister';
import { FoldersPersister } from './folders-persister';
import { SearchServiceBase } from '../../../../services/search/search.service.base';
import { AppearanceServiceBase } from '../../../../services/appearance/appearance.service.base';
import { FolderServiceBase } from '../../../../services/folder/folder.service.base';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { IndexingService } from '../../../../services/indexing/indexing.service';
import { CollectionServiceBase } from '../../../../services/collection/collection.service.base';
import { NavigationServiceBase } from '../../../../services/navigation/navigation.service.base';
import { TrackServiceBase } from '../../../../services/track/track.service.base';
import { PlaybackIndicationServiceBase } from '../../../../services/playback-indication/playback-indication.service.base';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { MouseSelectionWatcher } from '../../mouse-selection-watcher';
import { ContextMenuOpener } from '../../context-menu-opener';
import { SchedulerBase } from '../../../../common/scheduling/scheduler.base';
import { MatMenuTrigger } from '@angular/material/menu';
import { DesktopBase } from '../../../../common/io/desktop.base';
import { FileAccessBase } from '../../../../common/io/file-access.base';
import { ScrollPositionService } from '../../../../services/scroll-position/scroll-position.service';
import { BaseVirtualScrollBrowser } from '../base-virtual-scroll-browser';
import { TrackOrder } from '../track-order';
import { FolderMetadata, FolderMetadataService, TopPlayedFolderModel } from '../../../../services/folder/folder-metadata.service';
import { LyricsServiceBase } from '../../../../services/lyrics/lyrics.service.base';
import { LyricsModel } from '../../../../services/lyrics/lyrics-model';
import { LyricsSourceType } from '../../../../common/api/lyrics/lyrics-source-type';
import { LyricsRomanizationService } from '../../../../services/lyrics/lyrics-romanization.service';
import { KaraokeroAlignmentService } from '../../../../services/lyrics/karaokero-alignment.service';
import { OnlineLyricsGetter } from '../../../../services/lyrics/online-lyrics-getter';
import { PlaybackProgress } from '../../../../services/playback/playback-progress';
import { SwitchPlayerService } from '../../../../services/player-switcher/switch-player.service';

export interface FolderTreeNode {
    path: string;
    name: string;
    level: number;
    isRoot: boolean;
    isExpanded: boolean;
    isSelected: boolean;
    isPlaying: boolean;
    hasChildren: boolean;
    isLoaded: boolean;
    children: FolderTreeNode[];
}

export type SubfolderCard = SubfolderModel & Partial<FolderMetadata>;

@Component({
    selector: 'app-collection-folders',
    host: { style: 'display: block; width: 100%;' },
    templateUrl: './collection-folders.component.html',
    styleUrls: ['./collection-folders.component.scss'],
    providers: [MouseSelectionWatcher],
    encapsulation: ViewEncapsulation.None,
})
export class CollectionFoldersComponent extends BaseVirtualScrollBrowser implements OnInit, AfterViewInit, OnDestroy {
    private static readonly subfolderScrollPositionKey: string = 'folders-subfolders';
    private readonly subscription: Subscription = new Subscription();

    public constructor(
        public readonly searchService: SearchServiceBase,
        public readonly appearanceService: AppearanceServiceBase,
        public readonly folderService: FolderServiceBase,
        public readonly playbackService: PlaybackService,
        public readonly tracksPersister: FolderTracksPersister,
        public readonly contextMenuOpener: ContextMenuOpener,
        public readonly mouseSelectionWatcher: MouseSelectionWatcher,
        public readonly addToPlaylistMenu: AddToPlaylistMenu,
        private readonly indexingService: IndexingService,
        private readonly collectionService: CollectionServiceBase,
        private readonly settings: SettingsBase,
        private readonly navigationService: NavigationServiceBase,
        private readonly trackService: TrackServiceBase,
        private readonly playbackIndicationService: PlaybackIndicationServiceBase,
        private readonly foldersPersister: FoldersPersister,
        private readonly scheduler: SchedulerBase,
        private readonly logger: Logger,
        private readonly hacks: Hacks,
        private readonly desktop: DesktopBase,
        scrollPositionService: ScrollPositionService,
        @Optional() public readonly folderMetadataService?: FolderMetadataService,
        @Optional() public readonly fileAccess?: FileAccessBase,
        @Optional() public readonly lyricsService?: LyricsServiceBase,
        @Optional() public readonly romanizationService?: LyricsRomanizationService,
        @Optional() private readonly cd?: ChangeDetectorRef,
        @Optional() public readonly switchPlayerService?: SwitchPlayerService,
        @Optional() public readonly karaokeroAlignmentService?: KaraokeroAlignmentService,
        @Optional() public readonly onlineLyricsGetter?: OnlineLyricsGetter,
    ) {
        super(scrollPositionService, searchService);
    }

    public readonly trackOrders: TrackOrder[] = [
        TrackOrder.none,
        TrackOrder.byTrackTitleAscending,
        TrackOrder.byTrackTitleDescending,
        TrackOrder.byFileNameAscending,
        TrackOrder.byFileNameDescending,
        TrackOrder.byDateCreatedAscending,
        TrackOrder.byDateCreatedDescending,
    ];

    @ViewChild('subfolderContextMenuAnchor', { read: MatMenuTrigger, static: false })
    public subfolderContextMenu: MatMenuTrigger;

    @ViewChild(CdkVirtualScrollViewport) public viewPort: CdkVirtualScrollViewport;

    public leftPaneSize: number = this.settings.foldersLeftPaneWidthPercent;
    public rightPaneSize: number = 100 - this.settings.foldersLeftPaneWidthPercent;
    public middlePaneSize: number = 48;
    public nowPlayingPaneSize: number = 27;
    public middleFoldersPaneSize: number = 50;
    public middleTracksPaneSize: number = 50;

    public folders: FolderModel[] = [];
    public openedFolder: FolderModel;
    public subfolders: SubfolderModel[] = [];
    public selectedSubfolder: SubfolderModel | undefined;
    public subfolderBreadcrumbs: SubfolderModel[] = [];
    public tracks: TrackModels = new TrackModels();

    // Explorer tree & enriched features
    public treeNodes: FolderTreeNode[] = [];
    public topPlayedFolders: TopPlayedFolderModel[] = [];
    public isTopPlayedFoldersCollapsed: boolean = localStorage.getItem('dopamine_top_played_collapsed') === 'true';

    public toggleTopPlayedFolders(): void {
        this.isTopPlayedFoldersCollapsed = !this.isTopPlayedFoldersCollapsed;
        try {
            localStorage.setItem('dopamine_top_played_collapsed', this.isTopPlayedFoldersCollapsed.toString());
        } catch {
            // Ignore local storage error
        }
    }
    public subfolderCards: SubfolderCard[] = [];
    public globalTracks: TrackModels = new TrackModels();

    // Now playing folder pane (Column 3)
    public nowPlayingFolderPath: string | undefined = undefined;
    public nowPlayingFolderName: string = '';
    public nowPlayingArtist: string = '';
    public nowPlayingArtworkUrl: string | undefined = undefined;
    public nowPlayingTracks: TrackModel[] = [];
    public nowPlayingTrackCount: number = 0;

    // Lyrics pane (Column 3 bottom half)
    public nowPlayingLyrics: LyricsModel | undefined = undefined;
    public isLyricsLoading: boolean = false;
    public showRichLyrics: boolean = true;
    public isManualLyricsSearchOpen: boolean = false;
    public manualLyricsQuery: string = '';
    public isManualLyricsLoading: boolean = false;
    public manualLyricsNotFound: boolean = false;
    public activeLyricIndex: number = -1;
    public lyricsTextMode: 'romaji' | 'both' | 'original' = 'romaji';
    public isRomanizingLyrics: boolean = false;
    public isUserScrollingLyrics: boolean = false;
    public isLyricsEstimated: boolean = false;
    public rejectedLyricsTracks: Set<string> = new Set<string>();
    public lyricsRejectedNotice: boolean = false;
    public candidateSwitchNotice?: string;
    private userScrollTimeoutId: number | undefined = undefined;
    private lyricsTrackingIntervalId: number | undefined = undefined;

    public get displayedFoundTitle(): string {
        const matched = this.nowPlayingLyrics?.matchedTitle;
        if (matched !== undefined && matched !== '') {
            return matched;
        }
        const raw = this.nowPlayingLyrics?.track?.rawTitle;
        if (raw !== undefined && raw !== '') {
            return raw;
        }
        const fn = this.nowPlayingLyrics?.track?.fileName;
        return fn !== undefined && fn !== '' ? fn : '';
    }

    public get displayedFoundArtist(): string {
        const matched = this.nowPlayingLyrics?.matchedArtist;
        if (matched !== undefined && matched !== '') {
            return matched;
        }
        const raw = this.nowPlayingLyrics?.track?.rawFirstArtist;
        return raw !== undefined && raw !== '' ? raw : '';
    }

    public get hasLyrics(): boolean {
        return this.nowPlayingLyrics != null && !StringUtils.isNullOrWhiteSpace(this.nowPlayingLyrics.plainText);
    }

    public get hasRichLyrics(): boolean {
        return (
            (this.nowPlayingLyrics?.textLines?.length ?? 0) > 0 &&
            (this.nowPlayingLyrics?.startTimeStamps?.length ?? 0) > 0
        );
    }

    public get lyricsSourceLabel(): string {
        if (this.nowPlayingLyrics == null) {
            return '';
        }
        let base = '';
        switch (this.nowPlayingLyrics.sourceType) {
            case LyricsSourceType.embedded:
                base = 'Incrustada';
                break;
            case LyricsSourceType.lrc:
                base = 'LRC';
                break;
            case LyricsSourceType.srt:
                base = 'SRT';
                break;
            case LyricsSourceType.online:
                base = this.nowPlayingLyrics.sourceName !== '' ? this.nowPlayingLyrics.sourceName : 'Online';
                break;
            default:
                base = 'Letra';
                break;
        }

        if (this.hasRichLyrics) {
            return this.isLyricsEstimated ? `${base} (Estimada)` : `${base} (Sincronizada)`;
        }
        return `${base} (Texto)`;
    }

    public get isSearchActive(): boolean {
        return !StringUtils.isNullOrWhiteSpace(this.searchService.delayedSearchText);
    }

    public get displayedTracks(): TrackModels {
        return this.isSearchActive ? this.globalTracks : this.tracks;
    }

    public get visibleTreeNodes(): FolderTreeNode[] {
        const result: FolderTreeNode[] = [];
        const traverse = (node: FolderTreeNode) => {
            result.push(node);
            if (node.isExpanded && node.children.length > 0) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        };
        for (const root of this.treeNodes) {
            traverse(root);
        }
        return result;
    }

    public ngOnDestroy(): void {
        this.stopLyricsTracking();
        this.disposeScrollPosition(CollectionFoldersComponent.subfolderScrollPositionKey);
        this.subscription.unsubscribe();
        this.clearLists();
    }

    public ngAfterViewInit(): void {
        this.initializeScrollPosition(this.viewPort, CollectionFoldersComponent.subfolderScrollPositionKey);
        this.restoreScrollPosition(this.viewPort, CollectionFoldersComponent.subfolderScrollPositionKey, this.subfolders.length > 0);
    }

    public async ngOnInit(): Promise<void> {
        await this.initializeAsync();
    }

    private async initializeAsync(): Promise<void> {
        if (this.playbackService.playbackStarted$) {
            this.subscription.add(
                this.playbackService.playbackStarted$.subscribe((playbackStarted: PlaybackStarted) => {
                    this.playbackIndicationService.setPlayingSubfolder(this.subfolders, playbackStarted.currentTrack);
                    this.updateTreePlayingIndication(playbackStarted.currentTrack?.path);
                    PromiseUtils.noAwait(this.loadNowPlayingFolderAsync(playbackStarted.currentTrack));
                    PromiseUtils.noAwait(this.loadLyricsAsync(playbackStarted.currentTrack));
                    this.startLyricsTracking();
                }),
            );
        }

        if (this.playbackService.playbackStopped$) {
            this.subscription.add(
                this.playbackService.playbackStopped$.subscribe(() => {
                    this.playbackIndicationService.clearPlayingSubfolder(this.subfolders);
                    this.clearTreePlayingIndication();
                    this.clearNowPlayingTracksState();
                    this.clearLyricsState();
                    this.stopLyricsTracking();
                    PromiseUtils.noAwait(this.loadTopPlayedFoldersAsync());
                }),
            );
        }

        if (this.playbackService.playbackPaused$) {
            this.subscription.add(
                this.playbackService.playbackPaused$.subscribe(() => {
                    this.stopLyricsTracking();
                }),
            );
        }

        if (this.playbackService.playbackResumed$) {
            this.subscription.add(
                this.playbackService.playbackResumed$.subscribe(() => {
                    this.startLyricsTracking();
                }),
            );
        }

        if (this.playbackService.progressChanged$) {
            this.subscription.add(
                this.playbackService.progressChanged$.subscribe((progress: PlaybackProgress) => {
                    this.updateActiveLyricsIndex(progress.progressSeconds);
                }),
            );
        }

        if (this.playbackService.playbackSkipped$) {
            this.subscription.add(
                this.playbackService.playbackSkipped$.subscribe(() => {
                    this.activeLyricIndex = -1;
                    const prog = this.playbackService.getCurrentProgress?.();
                    if (prog != null) {
                        this.updateActiveLyricsIndex(prog.progressSeconds);
                    }
                }),
            );
        }

        this.subscription.add(
            this.indexingService.indexingFinished$.subscribe(() => {
                PromiseUtils.noAwait(this.fillListsAsync());
            }),
        );

        this.subscription.add(
            this.collectionService.collectionChanged$.subscribe(() => {
                PromiseUtils.noAwait(this.fillListsAsync());
            }),
        );

        this.subscription.add(
            this.searchService.delayedSearchTextChanged$.subscribe((text: string) => {
                if (!StringUtils.isNullOrWhiteSpace(text)) {
                    if (this.globalTracks.tracks.length === 0) {
                        this.globalTracks = this.trackService.getVisibleTracks();
                    }
                }
            }),
        );

        if (this.playbackService.currentTrack != null) {
            PromiseUtils.noAwait(this.loadNowPlayingFolderAsync(this.playbackService.currentTrack));
            PromiseUtils.noAwait(this.loadLyricsAsync(this.playbackService.currentTrack));
        }

        const savedFoldersSize = localStorage.getItem('dopamine_middle_folders_pane_size');
        if (savedFoldersSize != null && savedFoldersSize !== '') {
            const parsed = Number.parseFloat(savedFoldersSize);
            if (!Number.isNaN(parsed) && parsed >= 15 && parsed <= 85) {
                this.middleFoldersPaneSize = parsed;
                this.middleTracksPaneSize = 100 - parsed;
            }
        }

        await this.fillListsAsync();
    }

    public middleVerticalSplitDragEnd(event: IOutputData): void {
        if (event.sizes.length >= 2) {
            this.middleFoldersPaneSize = <number>event.sizes[0];
            this.middleTracksPaneSize = <number>event.sizes[1];
            try {
                localStorage.setItem('dopamine_middle_folders_pane_size', this.middleFoldersPaneSize.toString());
            } catch {
                // Ignore storage error
            }
        }
    }

    public splitDragEnd(event: IOutputData): void {
        if (event.sizes.length >= 3) {
            this.leftPaneSize = <number>event.sizes[0];
            this.middlePaneSize = <number>event.sizes[1];
            this.nowPlayingPaneSize = <number>event.sizes[2];
            this.rightPaneSize = 100 - this.leftPaneSize;
            this.settings.foldersLeftPaneWidthPercent = this.leftPaneSize;
        } else if (event.sizes.length >= 2) {
            this.leftPaneSize = <number>event.sizes[0];
            this.rightPaneSize = <number>event.sizes[1];
            this.settings.foldersLeftPaneWidthPercent = this.leftPaneSize;
        }
    }

    public getIndentGuides(level: number): number[] {
        const guides: number[] = [];
        for (let i = 0; i < level; i++) {
            guides.push(i);
        }
        return guides;
    }

    public getFolders(): void {
        try {
            this.folders = this.folderService.getFolders();
            this.buildRootTreeNodes();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not get folders', 'CollectionFoldersComponent', 'getFolders');
        }
    }

    public get canGoBack(): boolean {
        const currentPath = this.getOpenedSubfolderPath();
        if (currentPath === '') {
            return false;
        }
        if (this.openedFolder?.path !== undefined && this.openedFolder.path !== '' && currentPath.toLowerCase() !== this.openedFolder.path.toLowerCase()) {
            return true;
        }
        if (this.folders.length > 0) {
            return this.folders.some(
                (f) =>
                    f?.path !== undefined &&
                    f.path !== '' &&
                    currentPath.toLowerCase().startsWith(f.path.toLowerCase()) &&
                    currentPath.toLowerCase() !== f.path.toLowerCase(),
            );
        }
        return false;
    }

    public get parentFolderName(): string {
        const currentPath = this.getOpenedSubfolderPath();
        const parentPath = this.getDirectoryFromPath(currentPath);
        const extracted = this.extractFolderName(parentPath);
        return extracted !== '' ? extracted : 'Carpeta anterior';
    }

    public async goToParentFolderAsync(): Promise<void> {
        if (!this.canGoBack) {
            return;
        }
        const currentPath = this.getOpenedSubfolderPath();
        const parentPath = this.getDirectoryFromPath(currentPath);
        if (parentPath === '') {
            return;
        }

        const matchingRoot = this.folders.find((f) => parentPath.toLowerCase().startsWith(f.path.toLowerCase()));
        if (matchingRoot != null && matchingRoot.path !== this.openedFolder?.path) {
            this.openedFolder = matchingRoot;
            this.foldersPersister.setOpenedFolder(matchingRoot);
        }

        await this.setOpenedSubfolderAsync(new SubfolderModel(parentPath, false));
    }

    public async setOpenedSubfolderAsync(subfolderToActivate: SubfolderModel | undefined): Promise<void> {
        if (this.openedFolder == undefined) {
            return;
        }

        try {
            this.subfolders = await this.folderService.getSubfoldersAsync(this.openedFolder, subfolderToActivate);
            const openedSubfolderPath = this.getOpenedSubfolderPath();

            this.foldersPersister.setOpenedSubfolder(new SubfolderModel(openedSubfolderPath, false));

            this.subfolderBreadcrumbs = this.folderService.getSubfolderBreadcrumbs(this.openedFolder, openedSubfolderPath);
            this.tracks = await this.trackService.getTracksInSubfolderAsync(openedSubfolderPath);
            this.mouseSelectionWatcher.initialize(this.tracks.tracks, false);

            this.hacks.removeTooltips();

            this.playbackIndicationService.setPlayingSubfolder(this.subfolders, this.playbackService.currentTrack);
            this.playbackIndicationService.setPlayingTrack(this.tracks.tracks, this.playbackService.currentTrack);
            this.restoreScrollPosition(this.viewPort, CollectionFoldersComponent.subfolderScrollPositionKey, this.subfolders.length > 0);

            // Update explorer tree selection and keep ancestors visible & expanded
            await this.syncTreeWithOpenedPathAsync(openedSubfolderPath);

            // Load enriched subfolder cards (Opción B)
            await this.loadSubfolderCardsAsync();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not set the opened subfolder', 'CollectionFoldersComponent', 'setOpenedSubfolderAsync');
        }
    }

    public async setOpenedFolderAsync(folderToActivate: FolderModel): Promise<void> {
        this.openedFolder = folderToActivate;
        this.foldersPersister.setOpenedFolder(folderToActivate);

        const persistedOpenedSubfolder: SubfolderModel | undefined = this.foldersPersister.getOpenedSubfolder();
        await this.setOpenedSubfolderAsync(persistedOpenedSubfolder);
    }

    public setSelectedSubfolder(subfolder: SubfolderModel): void {
        this.selectedSubfolder = subfolder;
    }

    public async goToManageCollectionAsync(): Promise<void> {
        await this.navigationService.navigateToManageCollectionAsync();
    }

    public onSubfolderContextMenu(event: MouseEvent, subfolder: SubfolderModel | FolderTreeNode): void {
        const subfolderModel = subfolder instanceof SubfolderModel ? subfolder : new SubfolderModel(subfolder.path, false);
        this.contextMenuOpener.open(this.subfolderContextMenu, event, subfolderModel);
    }

    public async onOpenSubfolderAsync(subfolder: SubfolderModel): Promise<void> {
        await this.desktop.openPathAsync(subfolder.path);
    }

    public async toggleNodeExpandAsync(node: FolderTreeNode, event?: MouseEvent): Promise<void> {
        if (event) {
            event.stopPropagation();
        }

        if (!node.isExpanded) {
            if (!node.isLoaded) {
                await this.loadChildNodesAsync(node);
            }
            node.isExpanded = true;
        } else {
            node.isExpanded = false;
        }
    }

    public async selectTreeNodeAsync(node: FolderTreeNode): Promise<void> {
        // Ensure root folder matches this node
        const matchingRoot = this.folders.find((f) => node.path.toLowerCase().startsWith(f.path.toLowerCase()));
        if (matchingRoot && matchingRoot.path !== this.openedFolder?.path) {
            this.openedFolder = matchingRoot;
            this.foldersPersister.setOpenedFolder(matchingRoot);
        }

        if (!node.isExpanded) {
            if (!node.isLoaded) {
                await this.loadChildNodesAsync(node);
            }
            node.isExpanded = true;
        }

        await this.setOpenedSubfolderAsync(new SubfolderModel(node.path, false));
    }

    public async onOpenSubfolderCardAsync(card: SubfolderCard): Promise<void> {
        await this.setOpenedSubfolderAsync(card);
    }

    /**
     * Handles clicking a tree node:
     * - If the node is already expanded AND selected, collapse it.
     * - Otherwise, expand/select it as usual.
     */
    public async onTreeNodeClickAsync(node: FolderTreeNode): Promise<void> {
        if (node.isExpanded && node.isSelected) {
            // Toggle collapse: shrink the node
            node.isExpanded = false;
            return;
        }
        await this.selectTreeNodeAsync(node);
    }

    public async onPlayFolderAsync(folderPath: string, event?: MouseEvent): Promise<void> {
        if (event != null) {
            event.stopPropagation();
        }

        try {
            const folderTracks = await this.trackService.getTracksInSubfolderAsync(folderPath);
            if (folderTracks != null && folderTracks.tracks.length > 0) {
                await this.playbackService.enqueueAndPlayTracksStartingFromGivenTrackAsync(
                    folderTracks.tracks,
                    folderTracks.tracks[0],
                );
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Could not play folder tracks', 'CollectionFoldersComponent', 'onPlayFolderAsync');
        }
    }

    public async navigateToPathAsync(folderPath: string): Promise<void> {
        const matchingRoot = this.folders.find((f) => folderPath.toLowerCase().startsWith(f.path.toLowerCase()));
        if (matchingRoot != null) {
            if (this.openedFolder?.path !== matchingRoot.path) {
                this.openedFolder = matchingRoot;
                this.foldersPersister.setOpenedFolder(matchingRoot);
            }
            await this.setOpenedSubfolderAsync(new SubfolderModel(folderPath, false));
        }
    }

    private buildRootTreeNodes(): void {
        this.treeNodes = this.folders.map((f) => ({
            path: f.path,
            name: this.extractFolderName(f.path),
            level: 0,
            isRoot: true,
            isExpanded: true,
            isSelected: this.openedFolder?.path?.toLowerCase() === f.path?.toLowerCase(),
            isPlaying: this.isPathPlaying(f.path),
            hasChildren: true,
            isLoaded: false,
            children: [],
        }));
    }

    private async loadChildNodesAsync(parentNode: FolderTreeNode): Promise<void> {
        try {
            let childPaths: string[] = [];

            if (this.fileAccess != null) {
                try {
                    if (this.fileAccess.pathExists(parentNode.path)) {
                        childPaths = await this.fileAccess.getDirectoriesInDirectoryAsync(parentNode.path);
                    }
                } catch (e: unknown) {
                    this.logger.error(e, 'Could not get child directories via fileAccess', 'CollectionFoldersComponent', 'loadChildNodesAsync');
                }
            }

            if (childPaths.length === 0) {
                const subfolderModels = await this.folderService.getSubfoldersAsync(
                    this.openedFolder,
                    new SubfolderModel(parentNode.path, false),
                );
                childPaths = subfolderModels
                    .filter((s) => !s.isGoToParent)
                    .map((s) => s.path);
            }

            childPaths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

            parentNode.children = childPaths.map((dirPath) => ({
                path: dirPath,
                name: this.extractFolderName(dirPath),
                level: parentNode.level + 1,
                isRoot: false,
                isExpanded: false,
                isSelected: this.getOpenedSubfolderPath().toLowerCase() === dirPath.toLowerCase(),
                isPlaying: this.isPathPlaying(dirPath),
                hasChildren: true,
                isLoaded: false,
                children: [],
            }));

            parentNode.isLoaded = true;
            parentNode.hasChildren = parentNode.children.length > 0;
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load child tree nodes', 'CollectionFoldersComponent', 'loadChildNodesAsync');
        }
    }

    private isPathPlaying(folderPath: string): boolean {
        const playingPath = this.playbackService.currentTrack?.path;
        if (playingPath === undefined || playingPath === '' || folderPath === '') {
            return false;
        }
        return playingPath.toLowerCase().startsWith(folderPath.toLowerCase());
    }

    private async syncTreeWithOpenedPathAsync(openedPath: string): Promise<void> {
        // Clear previous selections
        const clearSelection = (node: FolderTreeNode) => {
            node.isSelected = false;
            for (const child of node.children) {
                clearSelection(child);
            }
        };
        for (const root of this.treeNodes) {
            clearSelection(root);
        }

        // Expand root containing openedPath
        const matchingRoot = this.treeNodes.find((root) =>
            openedPath.toLowerCase().startsWith(root.path.toLowerCase())
        );
        if (matchingRoot != null) {
            matchingRoot.isExpanded = true;
            if (!matchingRoot.isLoaded) {
                await this.loadChildNodesAsync(matchingRoot);
            }

            if (matchingRoot.path.toLowerCase() === openedPath.toLowerCase()) {
                matchingRoot.isSelected = true;
                return;
            }

            // Recursively find and expand down to openedPath
            await this.expandAncestorsDownToPathAsync(matchingRoot, openedPath);
        }
    }

    private async expandAncestorsDownToPathAsync(currentNode: FolderTreeNode, targetPath: string): Promise<void> {
        if (currentNode.children.length === 0 && !currentNode.isLoaded) {
            await this.loadChildNodesAsync(currentNode);
        }

        const exactMatch = currentNode.children.find(
            (child) => targetPath.toLowerCase() === child.path.toLowerCase()
        );
        if (exactMatch != null) {
            exactMatch.isSelected = true;
            currentNode.isExpanded = true;
            return;
        }

        const prefixMatch = currentNode.children.find(
            (child) => targetPath.toLowerCase().startsWith(child.path.toLowerCase())
        );
        if (prefixMatch != null) {
            prefixMatch.isExpanded = true;
            currentNode.isExpanded = true;
            if (!prefixMatch.isLoaded) {
                await this.loadChildNodesAsync(prefixMatch);
            }
            await this.expandAncestorsDownToPathAsync(prefixMatch, targetPath);
        }
    }

    private updateTreePlayingIndication(playingTrackPath: string | undefined): void {
        if (playingTrackPath === undefined || playingTrackPath === '') {
            return;
        }
        const checkPlaying = (node: FolderTreeNode) => {
            node.isPlaying = playingTrackPath.toLowerCase().startsWith(node.path.toLowerCase());
            for (const child of node.children) {
                checkPlaying(child);
            }
        };
        for (const root of this.treeNodes) {
            checkPlaying(root);
        }
    }

    private clearTreePlayingIndication(): void {
        const clearPlaying = (node: FolderTreeNode) => {
            node.isPlaying = false;
            for (const child of node.children) {
                clearPlaying(child);
            }
        };
        for (const root of this.treeNodes) {
            clearPlaying(root);
        }
    }

    private async loadSubfolderCardsAsync(): Promise<void> {
        const nonParentSubfolders = this.subfolders.filter((s) => !s.isGoToParent);
        this.subfolderCards = nonParentSubfolders.map((s) => ({
            path: s.path,
            isGoToParent: s.isGoToParent,
            name: this.extractFolderName(s.path),
            isSelected: s.isSelected,
            isPlaying: s.isPlaying,
        }));

        if (this.folderMetadataService != null && this.subfolderCards.length > 0) {
            await Promise.all(
                this.subfolderCards.map(async (card) => {
                    const meta = await this.folderMetadataService!.getFolderMetadataAsync(card.path);
                    card.artworkUrl = meta.artworkUrl;
                    card.artist = meta.artist;
                    card.albumTitle = meta.albumTitle;
                    card.trackCount = meta.trackCount;
                }),
            );
        }
    }

    private async loadTopPlayedFoldersAsync(): Promise<void> {
        if (this.folderMetadataService != null) {
            try {
                this.topPlayedFolders = await this.folderMetadataService.getTopPlayedFoldersAsync(5);
            } catch (e: unknown) {
                this.logger.error(e, 'Could not load top played folders', 'CollectionFoldersComponent', 'loadTopPlayedFoldersAsync');
            }
        }
    }

    private async fillListsAsync(): Promise<void> {
        await this.scheduler.sleepAsync(Constants.longListLoadDelayMilliseconds);
        this.getFolders();

        await this.scheduler.sleepAsync(Constants.shortListLoadDelayMilliseconds);
        const persistedOpenedFolder: FolderModel | undefined = this.foldersPersister.getOpenedFolder(this.folders);

        if (persistedOpenedFolder != undefined) {
            await this.setOpenedFolderAsync(persistedOpenedFolder);
        }

        await this.loadTopPlayedFoldersAsync();
    }

    public async onPlayNowPlayingTrackAsync(track: TrackModel): Promise<void> {
        try {
            await this.playbackService.enqueueAndPlayTracksStartingFromGivenTrackAsync(
                this.nowPlayingTracks,
                track,
            );
        } catch (e: unknown) {
            this.logger.error(e, 'Could not play track in now playing folder', 'CollectionFoldersComponent', 'onPlayNowPlayingTrackAsync');
        }
    }

    public async goToNowPlayingFolderAsync(): Promise<void> {
        if (this.nowPlayingFolderPath !== undefined && this.nowPlayingFolderPath !== '') {
            await this.navigateToPathAsync(this.nowPlayingFolderPath);
        }
    }

    public async playNowPlayingFolderAsync(): Promise<void> {
        if (this.nowPlayingFolderPath !== undefined && this.nowPlayingFolderPath !== '') {
            await this.onPlayFolderAsync(this.nowPlayingFolderPath);
        }
    }

    /**
     * Opens the mini player window via Electron IPC.
     * The main process will hide this window and open a compact BrowserWindow.
     */
    public async openMiniPlayer(): Promise<void> {
        if (this.switchPlayerService != null) {
            await this.switchPlayerService.togglePlayerAsync();
        } else {
            try {
                ipcRenderer.send('set-mini-player');
            } catch (e: unknown) {
                this.logger.error(e, 'Could not toggle mini player', 'CollectionFoldersComponent', 'openMiniPlayer');
            }
        }
    }

    public async loadNowPlayingFolderAsync(track: TrackModel | undefined): Promise<void> {
        if (track?.path === undefined || track.path === '') {
            return;
        }

        const folderPath = this.getDirectoryFromPath(track.path);
        if (folderPath === '') {
            return;
        }

        const isSameFolder = this.nowPlayingFolderPath?.toLowerCase() === folderPath.toLowerCase();

        this.nowPlayingFolderPath = folderPath;
        this.nowPlayingFolderName = this.extractFolderName(folderPath);

        if (!isSameFolder || this.nowPlayingTracks.length === 0) {
            await this.loadFolderTracksAndMetadataAsync(folderPath, track);
        }

        this.updateNowPlayingTracksPlayingState(track);
    }

    private async loadFolderTracksAndMetadataAsync(folderPath: string, track: TrackModel): Promise<void> {
        try {
            const result = await this.trackService.getTracksInSubfolderAsync(folderPath);
            this.nowPlayingTracks = result != null ? result.tracks : [];
            this.nowPlayingTrackCount = this.nowPlayingTracks.length;

            const trackArtist = track.artists !== undefined && track.artists !== '' ? track.artists : '';
            if (this.folderMetadataService != null) {
                const meta = await this.folderMetadataService.getFolderMetadataAsync(folderPath);
                this.nowPlayingArtworkUrl = meta.artworkUrl;
                this.nowPlayingArtist = meta.artist !== undefined && meta.artist !== '' ? meta.artist : trackArtist;
            } else {
                this.nowPlayingArtist = trackArtist;
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load tracks for now playing folder', 'CollectionFoldersComponent', 'loadNowPlayingFolderAsync');
        }
    }

    private updateNowPlayingTracksPlayingState(track: TrackModel | undefined): void {
        if (this.nowPlayingTracks.length === 0) {
            return;
        }
        for (const t of this.nowPlayingTracks) {
            t.isPlaying = track != undefined && t.path?.toLowerCase() === track.path?.toLowerCase();
        }
    }

    private clearNowPlayingTracksState(): void {
        for (const t of this.nowPlayingTracks) {
            t.isPlaying = false;
        }
    }

    public toggleLyricsMode(): void {
        this.showRichLyrics = !this.showRichLyrics;
    }

    public async loadLyricsAsync(track: TrackModel | undefined): Promise<void> {
        if (track == null || this.lyricsService == null) {
            this.nowPlayingLyrics = undefined;
            this.activeLyricIndex = -1;
            this.isLyricsLoading = false;
            return;
        }

        if (track.path !== undefined && track.path !== '' && this.rejectedLyricsTracks.has(track.path)) {
            this.nowPlayingLyrics = undefined;
            this.activeLyricIndex = -1;
            this.isLyricsLoading = false;
            this.lyricsRejectedNotice = true;
            return;
        }
        this.lyricsRejectedNotice = false;

        try {
            this.isLyricsLoading = true;
            this.activeLyricIndex = -1;
            this.nowPlayingLyrics = await this.lyricsService.getLyricsAsync(track);

            if (this.nowPlayingLyrics != null) {
                this.ensureLyricsTimings(this.nowPlayingLyrics);
            }

            // Auto-align with audio using Karaokero AI if available and plain lyrics have no timestamps
            if (
                this.nowPlayingLyrics != null &&
                (this.nowPlayingLyrics.startTimeStamps?.length ?? 0) === 0 &&
                this.canAlignWithKaraokero
            ) {
                void this.alignCurrentLyricsWithKaraokeroAsync();
            }

            if (
                this.nowPlayingLyrics != null &&
                this.romanizationService?.containsJapanese(this.nowPlayingLyrics.plainText) === true
            ) {
                this.isRomanizingLyrics = true;
                try {
                    await this.romanizationService.romanizeLyricsAsync(this.nowPlayingLyrics);
                } catch (e: unknown) {
                    this.logger.error(e, 'Could not romanize lyrics', 'CollectionFoldersComponent', 'loadLyricsAsync');
                } finally {
                    this.isRomanizingLyrics = false;
                    this.cd?.detectChanges();
                }
            }
            this.cd?.detectChanges();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load lyrics for track', 'CollectionFoldersComponent', 'loadLyricsAsync');
            this.nowPlayingLyrics = undefined;
        } finally {
            this.isLyricsLoading = false;
            this.cd?.detectChanges();
        }
    }

    public async openGoogleSearch(customTerm?: string): Promise<void> {
        let query: string = '';
        if (!StringUtils.isNullOrWhiteSpace(customTerm)) {
            query = customTerm!;
        } else if (this.playbackService.currentTrack != null) {
            const track = this.playbackService.currentTrack;
            const artist = (track.rawFirstArtist ?? '').trim();
            const title = (track.rawTitle ?? '').trim();
            if (artist !== '' && title !== '') {
                query = `${artist} ${title} letra lyrics`;
            } else if (title !== '') {
                query = `${title} letra lyrics`;
            } else if (track.fileName !== undefined && track.fileName !== '') {
                const cleanFile = track.fileName.replace(/\.[a-z0-9]+$/i, '').trim();
                query = `${cleanFile} letra lyrics`;
            }
        }

        if (!StringUtils.isNullOrWhiteSpace(query)) {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
            try {
                await this.desktop.openLinkAsync(searchUrl);
            } catch (e: unknown) {
                this.logger.error(e, 'Could not open Google search link', 'CollectionFoldersComponent', 'openGoogleSearch');
            }
        }
    }

    public get candidateIndexInfo(): { current: number; total: number } | undefined {
        return this.lyricsService?.getCandidateIndexInfo();
    }

    public get hasNextAlternative(): boolean {
        return this.lyricsService?.hasNextAlternative() ?? false;
    }

    public get hasPreviousAlternative(): boolean {
        const info = this.candidateIndexInfo;
        return info !== undefined && info.current > 1;
    }

    public async rejectCurrentLyrics(): Promise<void> {
        const track = this.playbackService.currentTrack;
        if (track == null || this.lyricsService == null) {
            return;
        }

        // Automatic advance to the 2nd (or next) candidate if one exists
        if (this.lyricsService.hasNextAlternative()) {
            this.isLyricsLoading = true;
            this.cd?.detectChanges();
            try {
                const nextLyrics = await this.lyricsService.getNextAlternativeLyricsAsync(track);
                if (nextLyrics != null && !StringUtils.isNullOrWhiteSpace(nextLyrics.plainText)) {
                    await this.applyManualLyricsResultAsync(nextLyrics, track);
                    const info = this.lyricsService.getCandidateIndexInfo();
                    this.candidateSwitchNotice = info != null
                        ? `Mostrando coincidencia ${info.current} de ${info.total}`
                        : 'Mostrando siguiente coincidencia';
                    setTimeout(() => {
                        this.candidateSwitchNotice = undefined;
                        this.cd?.detectChanges();
                    }, 4000);
                    return;
                }
            } catch (e: unknown) {
                this.logger.error(e, 'Could not get next alternative lyrics', 'CollectionFoldersComponent', 'rejectCurrentLyrics');
            } finally {
                this.isLyricsLoading = false;
                this.cd?.detectChanges();
            }
        }

        // No more candidates available: open manual search
        if (track.path !== undefined && track.path !== '') {
            this.rejectedLyricsTracks.add(track.path);
        }
        if (this.lyricsService != null) {
            this.lyricsService.clearCache();
        }
        this.nowPlayingLyrics = undefined;
        this.activeLyricIndex = -1;
        this.isManualLyricsSearchOpen = true;
        this.manualLyricsNotFound = false;
        this.lyricsRejectedNotice = true;
        this.candidateSwitchNotice = undefined;
        this.cd?.detectChanges();
    }

    public async previousCandidateLyrics(): Promise<void> {
        const track = this.playbackService.currentTrack;
        if (track == null || this.lyricsService == null) {
            return;
        }

        this.isLyricsLoading = true;
        this.cd?.detectChanges();
        try {
            const prevLyrics = await this.lyricsService.getPreviousAlternativeLyricsAsync(track);
            if (prevLyrics != null && !StringUtils.isNullOrWhiteSpace(prevLyrics.plainText)) {
                await this.applyManualLyricsResultAsync(prevLyrics, track);
                const info = this.lyricsService.getCandidateIndexInfo();
                this.candidateSwitchNotice = info != null
                    ? `Mostrando coincidencia ${info.current} de ${info.total}`
                    : 'Mostrando coincidencia anterior';
                setTimeout(() => {
                    this.candidateSwitchNotice = undefined;
                    this.cd?.detectChanges();
                }, 4000);
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Could not get previous alternative lyrics', 'CollectionFoldersComponent', 'previousCandidateLyrics');
        } finally {
            this.isLyricsLoading = false;
            this.cd?.detectChanges();
        }
    }

    public toggleManualLyricsSearch(): void {
        this.isManualLyricsSearchOpen = !this.isManualLyricsSearchOpen;
        this.manualLyricsNotFound = false;
        if (!this.isManualLyricsSearchOpen) {
            this.lyricsRejectedNotice = false;
        }
        if (this.isManualLyricsSearchOpen && StringUtils.isNullOrWhiteSpace(this.manualLyricsQuery)) {
            const track = this.playbackService.currentTrack;
            if (track != null) {
                if (!StringUtils.isNullOrWhiteSpace(track.rawFirstArtist) && !StringUtils.isNullOrWhiteSpace(track.rawTitle)) {
                    this.manualLyricsQuery = `${track.rawFirstArtist} ${track.rawTitle}`;
                } else if (!StringUtils.isNullOrWhiteSpace(track.rawTitle)) {
                    this.manualLyricsQuery = track.rawTitle;
                } else if (!StringUtils.isNullOrWhiteSpace(track.fileName)) {
                    this.manualLyricsQuery = track.fileName
                        .replace(/\.[a-z0-9]+$/i, '')
                        .replace(/^\d{1,3}\s*[-.]\s*/, '')
                        .trim();
                }
            }
        }
    }

    public async performManualLyricsSearchAsync(termToSearch?: string): Promise<void> {
        const query = (termToSearch !== undefined ? termToSearch : this.manualLyricsQuery).trim();
        if (StringUtils.isNullOrWhiteSpace(query) || this.lyricsService == null) {
            return;
        }

        this.manualLyricsQuery = query;

        try {
            this.isManualLyricsLoading = true;
            this.manualLyricsNotFound = false;
            const currentTrack = this.playbackService.currentTrack;
            const result = await this.lyricsService.searchLyricsByQueryAsync(query, currentTrack);

            if (result != null && !StringUtils.isNullOrWhiteSpace(result.plainText)) {
                await this.applyManualLyricsResultAsync(result, currentTrack);
            } else {
                this.manualLyricsNotFound = true;
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Manual lyrics search failed', 'CollectionFoldersComponent', 'performManualLyricsSearchAsync');
            this.manualLyricsNotFound = true;
        } finally {
            this.isManualLyricsLoading = false;
            this.cd?.detectChanges();
        }
    }

    private async applyManualLyricsResultAsync(result: LyricsModel, currentTrack: TrackModel | undefined): Promise<void> {
        if (currentTrack?.path !== undefined && currentTrack.path !== '') {
            this.rejectedLyricsTracks.delete(currentTrack.path);
        }
        this.lyricsRejectedNotice = false;
        this.ensureLyricsTimings(result);
        this.nowPlayingLyrics = result;
        this.activeLyricIndex = -1;
        this.isManualLyricsSearchOpen = false;

        if (
            this.nowPlayingLyrics != null &&
            this.romanizationService?.containsJapanese(this.nowPlayingLyrics.plainText) === true
        ) {
            this.isRomanizingLyrics = true;
            try {
                await this.romanizationService.romanizeLyricsAsync(this.nowPlayingLyrics);
            } catch (e: unknown) {
                this.logger.error(e, 'Could not romanize lyrics', 'CollectionFoldersComponent', 'performManualLyricsSearchAsync');
            } finally {
                this.isRomanizingLyrics = false;
                this.cd?.detectChanges();
            }
        }
        this.cd?.detectChanges();
    }

    public get lyricsSearchSuggestions(): string[] {
        const track = this.playbackService.currentTrack;
        if (track == null) {
            return [];
        }
        if (this.onlineLyricsGetter != null) {
            return this.onlineLyricsGetter.generateSearchSuggestions(track).slice(0, 5);
        }
        const suggestions: string[] = [];
        const rawTitle = (track.rawTitle ?? '').trim();
        const artist = (track.rawFirstArtist ?? '').trim();

        if (artist !== '' && rawTitle !== '') {
            suggestions.push(`${artist} ${rawTitle}`);
        }

        if (this.romanizationService != null && rawTitle !== '' && this.romanizationService.containsJapanese(rawTitle)) {
            const romaji = this.romanizationService.transliterateKanaToRomaji(rawTitle).trim();
            if (romaji.length > 1) {
                if (artist !== '') {
                    suggestions.push(`${artist} ${romaji}`);
                }
                suggestions.push(romaji);
            }
        }

        return Array.from(new Set(suggestions)).slice(0, 5);
    }

    public get containsJapaneseLyrics(): boolean {
        return this.romanizationService?.containsJapanese(this.nowPlayingLyrics?.plainText) ?? false;
    }

    public get lyricsTextModeLabel(): string {
        switch (this.lyricsTextMode) {
            case 'romaji':
                return 'Romaji';
            case 'both':
                return 'Ambos';
            case 'original':
                return 'Original';
            default:
                return 'Romaji';
        }
    }

    public cycleLyricsTextMode(): void {
        if (this.lyricsTextMode === 'romaji') {
            this.lyricsTextMode = 'both';
        } else if (this.lyricsTextMode === 'both') {
            this.lyricsTextMode = 'original';
        } else {
            this.lyricsTextMode = 'romaji';
        }
        this.cd?.detectChanges();
    }

    public getLineMainText(index: number): string {
        if (this.nowPlayingLyrics == null) {
            return '';
        }
        const orig = this.nowPlayingLyrics.textLines?.[index] ?? '';
        const romaji = this.nowPlayingLyrics.romanizedLines?.[index];

        if (this.lyricsTextMode === 'romaji' || this.lyricsTextMode === 'both') {
            return (romaji !== undefined && romaji.trim().length > 0) ? romaji : orig;
        }
        return orig;
    }

    public getLineSubText(index: number): string | null {
        if (this.nowPlayingLyrics == null || this.lyricsTextMode !== 'both') {
            return null;
        }
        const orig = this.nowPlayingLyrics.textLines?.[index] ?? '';
        const romaji = this.nowPlayingLyrics.romanizedLines?.[index];
        if (romaji !== undefined && romaji !== '' && orig !== '' && romaji.trim().toLowerCase() !== orig.trim().toLowerCase()) {
            return orig;
        }
        return null;
    }

    public formatTimestamp(seconds?: number): string {
        if (seconds === undefined || Number.isNaN(seconds)) {
            return '';
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    public startLyricsTracking(): void {
        this.stopLyricsTracking();
        this.lyricsTrackingIntervalId = window.setInterval(() => {
            if (this.nowPlayingLyrics == null || !this.playbackService.isPlaying) {
                return;
            }
            if (typeof this.playbackService.getCurrentProgress === 'function') {
                const progress = this.playbackService.getCurrentProgress();
                if (progress != null) {
                    this.updateActiveLyricsIndex(progress.progressSeconds);
                }
            }
        }, 200);
    }

    public stopLyricsTracking(): void {
        if (this.lyricsTrackingIntervalId !== undefined) {
            window.clearInterval(this.lyricsTrackingIntervalId);
            this.lyricsTrackingIntervalId = undefined;
        }
    }

    public updateActiveLyricsIndex(progressSeconds: number): void {
        if ((this.nowPlayingLyrics?.startTimeStamps?.length ?? 0) === 0) {
            if (this.activeLyricIndex !== -1) {
                this.activeLyricIndex = -1;
                this.cd?.detectChanges();
            }
            return;
        }

        const stamps = this.nowPlayingLyrics!.startTimeStamps!;
        let activeIdx = -1;
        for (let i = 0; i < stamps.length; i++) {
            if (stamps[i] <= progressSeconds) {
                activeIdx = i;
            } else {
                break;
            }
        }

        if (this.activeLyricIndex !== activeIdx) {
            this.activeLyricIndex = activeIdx;
            if (!this.isUserScrollingLyrics && activeIdx >= 0) {
                this.scrollToActiveLyricLine(activeIdx);
            }
            this.cd?.detectChanges();
        }
    }

    public scrollToActiveLyricLine(index: number): void {
        const elem = document.getElementById(`lyric-line-${index}`);
        if (elem) {
            elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    public onLyricsScroll(): void {
        this.isUserScrollingLyrics = true;
        if (this.userScrollTimeoutId !== undefined) {
            window.clearTimeout(this.userScrollTimeoutId);
        }
        this.userScrollTimeoutId = window.setTimeout(() => {
            this.isUserScrollingLyrics = false;
        }, 3500);
    }

    public async onLyricLineClickAsync(index: number): Promise<void> {
        const targetSeconds = this.nowPlayingLyrics?.startTimeStamps?.[index];
        if (targetSeconds !== undefined) {
            await this.playbackService.skipToSecondsAsync(targetSeconds);
        }
    }

    private ensureLyricsTimings(lyrics: LyricsModel): void {
        this.isLyricsEstimated = false;

        if (lyrics == null || StringUtils.isNullOrWhiteSpace(lyrics.plainText)) {
            return;
        }

        // 1. If text has embedded LRC timestamps [mm:ss.xx], parse them accurately
        this.parseLrcTimestampsIfPresent(lyrics);

        // 2. If it already has timestamps and lines, we're done
        if (
            lyrics.startTimeStamps != null &&
            lyrics.startTimeStamps.length > 0 &&
            lyrics.textLines != null &&
            lyrics.textLines.length > 0
        ) {
            return;
        }

        // 3. If lines are not set, split plainText into lines for display, but do not fabricate fake timestamps
        if (lyrics.textLines == null || lyrics.textLines.length === 0) {
            lyrics.textLines = lyrics.plainText
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
        }
    }

    public isAligningLyrics: boolean = false;

    public get canAlignWithKaraokero(): boolean {
        return this.karaokeroAlignmentService?.isAvailable() ?? false;
    }

    public async alignCurrentLyricsWithKaraokeroAsync(): Promise<void> {
        const track = this.playbackService.currentTrack;
        if (track == null || this.nowPlayingLyrics == null || this.karaokeroAlignmentService == null) {
            return;
        }

        try {
            this.isAligningLyrics = true;
            this.cd?.detectChanges();

            const aligned = await this.karaokeroAlignmentService.alignLyricsAsync(
                track,
                this.nowPlayingLyrics.plainText,
            );

            if (aligned?.startTimeStamps != null && aligned.startTimeStamps.length > 0) {
                if (this.playbackService.currentTrack?.path === track.path) {
                    this.nowPlayingLyrics = aligned;
                    this.showRichLyrics = true;
                    if (this.romanizationService != null) {
                        await this.romanizationService.romanizeLyricsAsync(this.nowPlayingLyrics);
                    }
                    this.cd?.detectChanges();
                }
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Karaokero alignment failed', 'CollectionFoldersComponent', 'alignCurrentLyricsWithKaraokeroAsync');
        } finally {
            this.isAligningLyrics = false;
            this.cd?.detectChanges();
        }
    }

    private parseLrcTimestampsIfPresent(lyrics: LyricsModel): void {
        if (StringUtils.isNullOrWhiteSpace(lyrics.plainText)) {
            return;
        }

        const lrcRegex = /\[\d{1,3}:\d{2}[.:]\d{2,3}\]/;
        if (!lrcRegex.test(lyrics.plainText)) {
            return;
        }

        const lines = lyrics.plainText.split(/\r?\n/);
        const { textLines, startTimeStamps, cleanedPlainText } = this.processLrcLines(lines);

        if (textLines.length > 0 && startTimeStamps.length > 0) {
            lyrics.textLines = textLines;
            lyrics.startTimeStamps = startTimeStamps;
            if (cleanedPlainText !== '') {
                lyrics.plainText = cleanedPlainText;
            }
        }
    }

    private processLrcLines(lines: string[]): { textLines: string[]; startTimeStamps: number[]; cleanedPlainText: string } {
        const textLines: string[] = [];
        const startTimeStamps: number[] = [];
        let cleanedPlainText = '';

        for (const line of lines) {
            const parsed = this.parseLrcLine(line);
            if (parsed != null) {
                for (const ts of parsed.timestamps) {
                    textLines.push(parsed.cleanText);
                    startTimeStamps.push(ts);
                }
                if (parsed.cleanText !== '') {
                    if (cleanedPlainText.length > 0) {
                        cleanedPlainText += '\n';
                    }
                    cleanedPlainText += parsed.cleanText;
                }
            }
        }

        return { textLines, startTimeStamps, cleanedPlainText };
    }

    private parseLrcLine(line: string): { cleanText: string; timestamps: number[] } | undefined {
        const lineRegex = /\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]/g;
        const matches: number[] = [];
        let match: RegExpExecArray | null;
        while ((match = lineRegex.exec(line)) !== null) {
            const minutes = Number.parseInt(match[1], 10);
            const seconds = Number.parseInt(match[2], 10);
            const fraction = match[3];
            const fractionalSeconds = Number.parseInt(fraction, 10) / Math.pow(10, fraction.length);
            matches.push(minutes * 60 + seconds + fractionalSeconds);
        }

        if (matches.length === 0) {
            return undefined;
        }

        const cleanText = line.replace(/\[\d{1,3}:\d{2}[.:]\d{2,3}\]/g, '').trim();
        return { cleanText, timestamps: matches };
    }

    private clearLyricsState(): void {
        this.nowPlayingLyrics = undefined;
        this.activeLyricIndex = -1;
        this.isLyricsLoading = false;
        this.isRomanizingLyrics = false;
        this.isLyricsEstimated = false;
        this.isManualLyricsSearchOpen = false;
        this.manualLyricsQuery = '';
        this.isManualLyricsLoading = false;
        this.manualLyricsNotFound = false;
        this.cd?.detectChanges();
    }

    private trimTrailingSlashes(str: string): string {
        let end = str.length;
        while (end > 0 && (str[end - 1] === '/' || str[end - 1] === '\\')) {
            end--;
        }
        return str.substring(0, end);
    }

    private getDirectoryFromPath(filePath: string): string {
        if (filePath === '') {
            return '';
        }
        const clean = this.trimTrailingSlashes(filePath);
        const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
        if (lastSlash > 0) {
            return clean.substring(0, lastSlash);
        }
        return clean;
    }

    private clearLists(): void {
        this.folders = [];
        this.subfolders = [];
        this.subfolderBreadcrumbs = [];
        this.tracks = new TrackModels();
        this.treeNodes = [];
        this.subfolderCards = [];
        this.topPlayedFolders = [];
        this.globalTracks = new TrackModels();
        this.nowPlayingTracks = [];
        this.nowPlayingFolderPath = undefined;
        this.nowPlayingFolderName = '';
        this.nowPlayingArtist = '';
        this.nowPlayingArtworkUrl = undefined;
        this.nowPlayingTrackCount = 0;
        this.clearLyricsState();
    }

    private getOpenedSubfolderPath(): string {
        if (this.subfolders.length > 0) {
            const parent = this.subfolders.find((x) => x.isGoToParent);
            if (parent?.path !== undefined && parent.path !== '') {
                return parent.path;
            }
        }
        return this.openedFolder?.path !== undefined && this.openedFolder.path !== '' ? this.openedFolder.path : '';
    }

    private extractFolderName(folderPath: string): string {
        if (folderPath === '') {
            return '';
        }
        const clean = this.trimTrailingSlashes(folderPath);
        const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
        if (lastSlash >= 0) {
            return clean.substring(lastSlash + 1);
        }
        return clean;
    }
}
