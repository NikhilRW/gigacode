export type ThemeMode = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'gigacode.theme.v1';
export function decodeTheme(value: string | null): ThemeMode {
  return value === 'light' ? 'light' : 'dark';
}

// Every surface, including the DOM editor, uses the same semantic palette.
export const palettes = {
  dark: {
    bg: '#040C18', panel: '#0A1729', raised: '#10223A', border: '#203750',
    strongBorder: '#345B80', text: '#ECF6FF', muted: '#A4B9CF', faint: '#7E98B3',
    accent: '#62ADFF', cyan: '#5EDCFF', primary: '#2588FF', onPrimary: '#03152C',
    accentSoft: '#102F50', selection: '#174674', editor: '#091727', console: '#06111F',
    warning: '#EAC38B', error: '#FFAF9E', success: '#82D9C5', backdrop: '#010813CC',
    glow: '#2588FF24', shadow: '#00081180',
    syntaxKeyword: '#78BBFF', syntaxString: '#82D9C5', syntaxFunction: '#6FE1FF',
    syntaxNumber: '#EAC38B', syntaxComment: '#829CB7', syntaxOperator: '#BCD9F5',
    lensDeep: '#063579', lensMid: '#148BEA', lensLight: '#A6F3FF',
  },
  light: {
    bg: '#F2F8FF', panel: '#FFFFFF', raised: '#EAF3FD', border: '#CEDFEF',
    strongBorder: '#9ABBDD', text: '#0A2545', muted: '#46617D', faint: '#526D89',
    accent: '#075CC2', cyan: '#087697', primary: '#0968DA', onPrimary: '#FFFFFF',
    accentSoft: '#E2F0FF', selection: '#C7E2FF', editor: '#FBFDFF', console: '#EDF5FD',
    warning: '#855418', error: '#AC321E', success: '#096E5C', backdrop: '#16385760',
    glow: '#2588FF18', shadow: '#315D8C20',
    syntaxKeyword: '#075CC2', syntaxString: '#096E5C', syntaxFunction: '#006984',
    syntaxNumber: '#93560B', syntaxComment: '#526D89', syntaxOperator: '#315B80',
    lensDeep: '#0754B3', lensMid: '#209DFA', lensLight: '#D8FAFF',
  },
};
export type Colors = typeof palettes.dark;
