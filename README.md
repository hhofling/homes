# Planritaren

Ett webbaserat ritprogram för att rita planritningar (blueprints) och prova olika inrednings- och designlösningar för hem. Allt körs i webbläsaren – inga konton, ingen server.

## Funktioner

- **Väggar** – rita väggkedjor med valfri tjocklek. Väggar som möts hålls ihop när du flyttar dem.
- **Rum** – rektangulära eller fria rum med namn, golvfärg och automatisk area (m²).
- **Dörrar och fönster** – dörr, pardörr, skjutdörr, fönster och öppning. Placeras i väggar och kan dras längs väggen, vändas och breddas.
- **Möbler och inredning** – 30 symboler för sovrum, vardagsrum, kök, badrum m.m. Flytta, rotera (handtag eller Q/E), ändra storlek, färg och etikett.
- **Mått** – väggmått visas automatiskt, och du kan lägga till egna måttlinjer. Allt i meter med decimalkomma.
- **Designlösningar** – flera planer sparas lokalt. "Skapa variant" kopierar planen så att du kan prova en annan möblering eller planlösning utan att ändra originalet.
- **Spara, öppna, exportera** – sparas automatiskt i webbläsaren. Exportera som PNG, SVG (skala 1:100 i mm) eller planfil (.json), och skriv ut.
- Rutnät med fäst-funktion, zoom/panorering, ångra/gör om och en sammanställning av alla rumsareor.

## Kom igång

```bash
npm install
npm run dev      # startar på http://localhost:5173
npm test         # enhetstester
npm run build    # statisk build i dist/ (kan läggas på valfri webbhost)
```

## Kortkommandon

| Tangent | Funktion |
| --- | --- |
| V / H | Markera / panorera |
| W / R / P | Vägg / rum / fritt rum |
| D / F | Dörr / fönster |
| M / T | Måttlinje / text |
| Q / E | Rotera markerad möbel 15° (med Shift 90°) |
| Piltangenter | Flytta markerat 1 cm (med Shift 10 cm) |
| Ctrl+D | Duplicera |
| Delete | Ta bort |
| Ctrl+Z / Ctrl+Shift+Z | Ångra / gör om |
| Mellanslag + dra | Panorera |
| Enter / Esc / dubbelklick | Avsluta vägg eller rum |

## Struktur

- `src/editor.ts` – ritytan: verktyg, snäppning, träfftest, dra och släpp
- `src/render.ts` – ritar planen som SVG (används både på skärmen och vid export)
- `src/furniture.ts` – möbelbiblioteket
- `src/store.ts` – planer, ångra-historik och lagring i webbläsaren
- `src/ui.ts` – paneler: verktyg, bibliotek, egenskaper, planer, sammanställning
- `src/export.ts` – PNG/SVG/JSON-export

Alla mått lagras internt i millimeter.
