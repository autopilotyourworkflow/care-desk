# Font licences

Both families are self-hosted in this folder and loaded with `next/font/local` in `app/layout.tsx`.

| File | Family | Source | Licence |
|---|---|---|---|
| poppins-400.woff2, poppins-500.woff2, poppins-600.woff2, poppins-700.woff2 | Poppins 4.004 (latin and latin-ext subsets) | google/fonts repository (ofl/poppins, full TTFs) | SIL Open Font License 1.1 (https://openfontlicense.org) |
| clash-display-500.woff2, clash-display-600.woff2 | Clash Display | Fontshare by Indian Type Foundry (api.fontshare.com) | ITF Free Font License (https://www.fontshare.com/licenses/itf-ffl): free for personal and commercial use |

Poppins is designed by Indian Type Foundry (Jonny Pinhorn, Ninad Kale). Clash Display is designed by Indian Type Foundry.
Fonts were downloaded on 23 September 2026. Clash Display is unmodified. Poppins was subset with fontTools (pyftsubset, all layout features kept, woff2) to the union of Google Fonts' latin and latin-ext unicode ranges, so Māori macrons (ā ē ī ō ū), Polish letters (ą ć ę ł ń ś ź ż) and other Central European accents render in Poppins rather than a fallback font. Subsetting is permitted by the SIL Open Font License; the font name is unchanged, as Google Fonts' own subsets are.
