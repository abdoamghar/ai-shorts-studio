# Arabic fonts for libass burn-in

Bundled fonts used by the Arabic subtitle path (`fontsdir=` in ffmpeg / libass).
libass selects the weight that matches each ASS style's Bold flag.

- `NotoSansArabic-Regular.ttf` — regular weight
- `NotoSansArabic-SemiBold.ttf` — semibold weight
- `NotoSansArabic-Bold.ttf` — bold weight (primary for the viral pill theme)

Source: Google Noto, [SIL Open Font License 1.1](https://scripts.sil.org/OFL).
Downloaded from https://github.com/googlefonts/noto-fonts/tree/main/hinted/ttf/NotoSansArabic.

If any of these are missing, `resolveArabicFontsDir()` falls back to the
Windows Fonts folder (Segoe UI / Tahoma / Arial) so burns still render.
