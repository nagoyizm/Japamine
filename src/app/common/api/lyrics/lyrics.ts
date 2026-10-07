export class Lyrics {
    public constructor(
        public sourceName: string,
        public text: string,
        public matchedTitle?: string,
        public matchedArtist?: string,
    ) {}

    public static empty(): Lyrics {
        return new Lyrics('', '');
    }
}
