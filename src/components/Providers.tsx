'use client';

import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';

const sans = "'Noto Sans Thai', 'Sarabun', system-ui, -apple-system, 'Segoe UI', sans-serif";
const display = "'Prompt', 'Noto Sans Thai', sans-serif";

const theme = createTheme({
  palette: {
    primary: { main: '#5b44cf', dark: '#4a35b8' },
    success: { main: '#16a34a' },
    warning: { main: '#c2570c' },
    text: { primary: '#1d1a4b', secondary: '#6d6a9a' },
    background: { default: '#150d52', paper: '#e9e7f7' },
    divider: '#cfcbea',
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: sans,
    h1: { fontFamily: display, fontWeight: 700 },
    h2: { fontFamily: display, fontWeight: 700 },
    h3: { fontFamily: display, fontWeight: 700 },
    h6: { fontFamily: display, fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: '0 12px 34px rgba(6,3,38,.5)' } } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: '#f4f3fc' } } },
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
