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

## Byggplaneraren

En andra sida (`byggprojekt.html`) för att planera renoveringar och byggen:

- **Moment** grupperade i faser (rivning, el, VVS, tätskikt, ytskikt …) med vem som gör jobbet, yrke, timmar, personer och arbetskostnad.
- **Mallar** – måla om rum, nytt golv, renovera badrum, byta kök, bygga innervägg. Mängder räknas ut från rummets mått.
- **Material** med mängd, enhet, spill, pris, kategori, butik och vem som köper. Export för Excel (CSV).
- **Rum & ytor** – skriv in eller hämta rum från Planritaren (från samma webbläsare eller från en sparad planfil).
- **Tidsplan** på vardagar utifrån startdatum, **översikt** med total kostnad och ROT-avdrag.
- **Offertförfrågningar** per yrke, **inköpslistor** per butik/kategori och **checklistor** – kopiera, ladda ner eller skriv ut.

Allt sparas i webbläsaren; projekt kan sparas och öppnas som fil (`.bygg.json`).

## Tomtplaneraren (3D)

En tredje sida (`tomt.html`) där du ritar tomten och det som ska byggas i 3D:

- **Tomtgräns** – klicka ut hörnen eller skriv in måtten. Längder och tomtarea visas direkt.
- **Byggnader** – bostadshus, garage, carport, attefallshus, friggebod och förråd med våningar, takform (sadeltak, valmat, pulpet, platt), taklutning, grund och färger. Fönster och dörrar läggs ut automatiskt.
- **Mark och trädgård** – altan, uteplats, pool, uppfart, rabatt, gräsmatta, gång, staket, häck, mur, träd och buskar.
- **Sol och skugga** – välj årstid och klockslag.
- **Regelkoll** – avstånd till tomtgränsen (4,5 m), friggebod (15 m², 3 m) och attefallshus (30 m², 4 m). Bara vägledning – detaljplanen kan säga annat.
- **Planritning** – ett hus blir en plan i Planritaren med ytterväggar, fönster och dörr. Det du ritar där (rum, väggar, möbler) syns sedan i 3D.
- **Inköpsplan** – skapar ett projekt i Byggplaneraren med moment, material, mängder och riktpriser för grund, stomme, fasad, tak, fönster, el, VVS, altan, plattor, staket m.m.
- **Ritningsblad** – situationsplan med mått och avstånd samt fasader från fyra håll, som en A3-bild.

Tomter sparas i webbläsaren och kan sparas/öppnas som fil (`.tomt.json`).

## Kom igång

```bash
npm install
npm run dev      # startar på http://localhost:5173
npm test         # enhetstester
npm run build    # statisk build i dist/ (kan läggas på valfri webbhost)
npm run build:artefakt  # varje verktyg som en enda fristående HTML-fil i artefakt/
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

- `src/projekt/` – Byggplaneraren (beräkningar i `calc.ts`, mallar i `templates.ts`, gränssnitt i `ui.ts`)
- `src/common.ts` – nedladdning och länkar som delas av båda verktygen

- `src/editor.ts` – ritytan: verktyg, snäppning, träfftest, dra och släpp
- `src/render.ts` – ritar planen som SVG (används både på skärmen och vid export)
- `src/furniture.ts` – möbelbiblioteket
- `src/store.ts` – planer, ångra-historik och lagring i webbläsaren
- `src/ui.ts` – paneler: verktyg, bibliotek, egenskaper, planer, sammanställning
- `src/export.ts` – PNG/SVG/JSON-export

Alla mått lagras internt i millimeter.
