import { Theme } from '../theme/theme';
import { ThemeAuthor } from '../theme/theme-author';
import { ThemeCoreColors } from '../theme/theme-core-colors';
import { ThemeNeutralColors } from '../theme/theme-neutral-colors';
import { ThemeOptions } from '../theme/theme-options';
import { defaultDarkColors, defaultLightColors } from './default-neutral-colors';

export class DopamineTheme {
    public static create(author: ThemeAuthor): Theme {
        const darkColors: ThemeNeutralColors = defaultDarkColors();
        const lightColors: ThemeNeutralColors = defaultLightColors();

        darkColors.scrollBars = '#00A884';
        lightColors.scrollBars = '#00A884';

        const options: ThemeOptions = new ThemeOptions(false);

        return new Theme('Japamine', author, new ThemeCoreColors('#00B894', '#55EFC4', '#00A884'), darkColors, lightColors, options);
    }
}
