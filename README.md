# Hlídač akcí

Osobní appka, která hlídá slevy na vybrané zboží na Rohlíku a v týdenních
letácích kamenných řetězců. Implementace podle `v-merku-spec.md`.

## Zvolený tech stack a proč

| Vrstva | Volba | Proč |
| --- | --- | --- |
| Web | **Next.js 16 (App Router) + React 19, TypeScript** | UI i backend v jednom projektu a jednom jazyce. Serverové komponenty čtou z DB přímo, takže mezi obrazovkou a daty není žádné API navíc. Responzivní web pokrývá i mobil, jak zadání předpokládá. |
| Data | **SQLite přes better-sqlite3 + Drizzle ORM** | Jeden uživatel, desítky produktů, tisíce řádků historie – databázový server by tu byl režie navíc. SQLite je jeden soubor, jde zazálohovat kopií. Drizzle dává typové schéma a verzované migrace bez generování klienta. |
| Scraping | **fetch + cheerio (HTML), pdfjs-dist (PDF)** | Letáky jsou statické PDF a Rohlík odpovídá JSONem – na nic z toho není potřeba headless prohlížeč. |
| OCR | **externí příkaz (volitelně)** | Letáky bez textové vrstvy vyžadují OCR. Tesseract se do appky nebundluje; volá se přes `OCR_COMMAND`, takže se dá zapnout, až bude potřeba. |
| Plánovač | **node-cron v samostatném procesu** | Kontroly běží mimo web, takže restart nebo deploy webu nerozhodí rozdělanou kontrolu. |
| E-mail | **nodemailer (SMTP)** | Bez vendor locku; bez konfigurace SMTP se zprávy jen vypíšou do konzole, takže appka jde zkoušet hned. |
| Graf | **Recharts** | Čárový graf s přepínačem rozsahu, bez vlastního kreslení SVG. |

Co se záměrně nepoužilo: multi-user auth (zadání, sekce 1), Postgres a
fronta úloh (na jednoho uživatele zbytečné), headless prohlížeč (zdroje ho
nepotřebují) a nativní mobilní appka (sekce 8).

## Rozběhnutí

```bash
npm install
cp .env.example .env      # vyplň SMTP a APP_URL, zbytek má rozumné výchozí hodnoty
npm run db:migrate        # vytvoří schéma
npm run db:seed           # založí Rohlík, Lidl, Kaufland, Billu a Albert
npm run db:demo           # volitelně: ukázková data, ať jde UI porovnat s návrhem
npm run dev               # http://localhost:3000
```

Plánovač se spouští zvlášť:

```bash
npm run worker            # e-shopy 6:10 denně, letáky 7:30 ve středu a v sobotu
npm run check             # jednorázová kontrola teď (nebo: npm run check leaflet)
```

## Nasazení

Nejjednodušší cesta je Render: v prohlížeči zvol **New > Blueprint**, ukaž na
tenhle repozitář a zbytek si přečte z `render.yaml`. Build jede z Dockerfilu,
databáze leží na disku `/data` a plánovač běží uvnitř appky
(`SCHEDULER_IN_PROCESS=1`), protože jeden kontejner umí připojit jen jeden disk.
Doménu pak stačí nasměrovat přes Cloudflare na adresu, kterou Render přidělí.

Na vlastním serveru s Dockerem:

```bash
cp .env.example .env          # vyplň SMTP, APP_URL
docker compose up -d --build
docker compose exec web npm run db:migrate
docker compose exec web npm run db:seed
```

Web běží na portu 3000, plánovač jako druhý kontejner nad stejnou databází.
Historie cen leží ve svazku `data`, takže přežije redeploy.

Pozn. k hostingu: appka potřebuje běžný Node runtime s diskem a trvale běžícím
procesem. Cloudflare Workers a podobné edge runtimy nestačí — `better-sqlite3`
je nativní modul, plánovač je dlouhoběžící proces a parsování velkého letáku se
nevejde do limitu paměti. Doménu přes Cloudflare směrovat lze, jen na něm nemá
běžet samotná appka.

## Struktura

```
src/db/schema.ts          datový model (sekce 3 zadání)
src/lib/match.ts          normalizace názvů a fuzzy skóre (sekce 2.2)
src/lib/check.ts          jedna kontrola: scrape → párování → historie → notifikace
src/lib/scrapers/         rohlik.ts (dotazový), leaflet.ts (PDF), index.ts (registr)
src/lib/queries.ts        data pro obrazovky
src/lib/notify.ts         skládání a odesílání e-mailů
src/app/                  Přehled, detail produktu, Přidat produkt, Nastavení
scripts/                  worker, jednorázová kontrola, seed, ukázková data,
                          dump-leaflet.ts (diagnostika parsování letáku)
tests/                    testy párování, parsování letáku a insightů
Dockerfile, compose.yaml  nasazení (web + plánovač nad sdílenou databází)
```

### Jedna odchylka od datového modelu v zadání

Přibyla tabulka **`store_items`** – poslední stažená nabídka za každý obchod.
Sekce 2.2 požaduje hledání „napříč aktuálně nascrapovanými daty“ a tohle je to,
v čem se hledá. Při každém scrapu se obsah pro daný obchod nahradí; historie
zůstává v `price_observations`.

## Jak se čte leták

Leták není text po řádcích, ale mřížka dlaždic – tři produkty vedle sebe leží
ve stejné výšce. Kdyby se text seskupoval po řádcích přes celou stránku, spojily
by se sousední sloupce do jedné položky. Proto se fragmenty spojují do buněk jen
tehdy, když na sebe vodorovně navazují, a cena se k názvu páruje podle polohy na
stránce: nejbližší název ve stejném sloupci, s přednostní volbou toho nad cenou.
Když k jednomu názvu patří dvě ceny, nižší je akční a vyšší běžná.

## Jak funguje párování

1. Uživatel zadá název. Ten se znormalizuje: pryč diakritika, `0,5 l` i `500 ml`
   na stejný tvar, `jedenáctka` na `11°`.
2. Skóre shody je kombinace shody slov, shody trigramů a shody gramáže.
   Nesedící gramáž skóre výrazně srazí – `0,5 l` a `1,5 l` nejsou totéž.
3. Kandidáti se nabídnou k potvrzení. Potvrzená dvojice se uloží jako alias
   (`product_store_aliases`) a příště se použije přednostně.
4. Bez aliasu se automaticky přijme jen shoda nad 82 %; uloží se jako
   nepotvrzený alias, takže je vidět, co si appka domyslela.

Chování je pokryté testy – `npm test`.

## Ověření scraperů proti živým datům

**Tohle je jediná část, která zatím neběžela na reálných datech.** Vývojové
prostředí nemá přístup na rohlik.cz ani na weby řetězců, takže scrapery jsou
napsané podle struktury zdrojů, ale neověřené. Postup:

1. **Letáky.** Nejrychlejší je pustit diagnostiku rovnou na stažené PDF, bez
   databáze a bez nastavování obchodu:

   ```bash
   npm run leaflet:dump ~/Downloads/letak.pdf
   npm run leaflet:dump ~/Downloads/letak.pdf --raw    # syrové buňky i s pozicí
   npm run leaflet:dump ~/Downloads/letak.pdf --limit=80
   ```

   Vypíše počet stran, jestli má PDF textovou vrstvu, nalezenou platnost akce
   a vyparsované položky. Stejná data pak projdou i ostrou cestou: v Nastavení
   nastav u obchodu `source_url` na přímou adresu PDF letáku (ne na stránku
   s přehledem letáků) a spusť `npm run check leaflet`.
   - Když leták textovou vrstvu nemá, nastav `OCR_COMMAND`, např.
     `OCR_COMMAND="ocrmypdf --force-ocr -l ces {in} {out}"`.
   - Když se položky vytáhnou rozsekané, doladí se heuristika v
     `itemsFromCells()` v `src/lib/scrapers/leaflet.ts`; testy k ní jsou
     v `tests/leaflet.test.ts`.
2. **Rohlík.** `npm run check daily`. Scraper zkouší nejdřív interní JSON
   endpoint a pak parsování HTML. Obě adresy jdou přepsat proměnnými
   `ROHLIK_SEARCH_URL` a `ROHLIK_SEARCH_HTML_URL`, takže na změnu na jejich
   straně stačí reagovat konfigurací, ne zásahem do kódu.

Obchody a jejich URL se spravují v Nastavení, ne v kódu (sekce 2.6). Vlastní
scraper potřebuje jen e-shop; obchod typu „týdenní leták“ funguje rovnou.

## Notifikace

E-mail chodí, když sledovaná položka **poprvé** spadne do akce. Zápis do
`notification_log` proběhne až po odeslání, takže se při chybě SMTP zpráva
neztratí a pošle se při další kontrole. V Nastavení jde přepnout na denní
souhrn.

## Design

Design tokeny z Varianty B jsou v `src/app/globals.css` jako CSS proměnné.
Barva má jeden význam: modrá = interaktivní prvek, zelená = „je to sleva“,
šedá = neutrální informace. Písmo IBM Plex Sans se načítá přes `next/font`.
