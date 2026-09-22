# Hlídač akcí

Osobní appka, která hlídá slevy na vybrané zboží na Rohlíku a v týdenních
letácích kamenných řetězců. Implementace podle `v-merku-spec.md`.

## Zvolený tech stack a proč

| Vrstva | Volba | Proč |
| --- | --- | --- |
| Web | **Next.js 16 (App Router) + React 19, TypeScript** | UI i backend v jednom projektu a jednom jazyce. Serverové komponenty čtou z DB přímo, takže mezi obrazovkou a daty není žádné API navíc. Responzivní web pokrývá i mobil, jak zadání předpokládá. |
| Data | **SQLite přes Drizzle ORM; na Cloudflare D1** | Jeden uživatel, desítky produktů, tisíce řádků historie – databázový server by tu byl režie navíc. Lokálně je to jeden soubor (better-sqlite3), na Cloudflare D1, což je taky SQLite. Schéma i dotazy jsou stejné, mění se jen driver. |
| Scraping | **fetch + cheerio (HTML), pdfjs-dist (PDF)** | Letáky jsou statické PDF a Rohlík odpovídá JSONem – na nic z toho není potřeba headless prohlížeč. |
| OCR | **externí příkaz (volitelně)** | Letáky bez textové vrstvy vyžadují OCR. Tesseract se do appky nebundluje; volá se přes `OCR_COMMAND`, takže se dá zapnout, až bude potřeba. |
| Plánovač | **node-cron, na Cloudflare Workers Cron Triggers** | Kontroly běží mimo web, takže restart nebo deploy webu nerozhodí rozdělanou kontrolu. Na Cloudflare kontejner usíná, takže ho budí cron ve Workeru. |
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

## Nasazení na Cloudflare

Appka běží v kontejneru (Cloudflare Containers) a před ním sedí Worker
(`worker/index.ts`). Worker dělá dvě věci, které kontejner sám neumí:

- **Databáze.** Disk kontejneru je pomíjivý — po uspání se vrací čistý —
  takže data leží v **D1**. Na bindingy se ale dá sáhnout jen z Workeru,
  proto appka posílá SQL jako HTTP na `http://db.internal/query` a Worker ho
  vykoná (`outboundByHost` ve Workeru, `src/db/connect.ts` v appce).
- **Plánovač.** Kontejner po nečinnosti usne, takže node-cron uvnitř by se
  nikdy nespustil. Budí ho **Workers Cron Triggers**, které zavolají
  `POST /api/check` se sdíleným tajemstvím v hlavičce `x-check-token`.

Časy v `triggers.crons` jsou v UTC: `10 4 * * *` pro e-shopy a
`30 5 * * 3,6` pro letáky, tedy v létě 6:10 a 7:30 pražského času, v zimě
o hodinu dřív.

### Jednorázové nastavení

1. **Databáze.** V dashboardu Cloudflare → Storage & Databases → D1 → Create
   database, jméno `vmerku`. Zkopíruj Database ID do `wrangler.jsonc`.
2. **Schéma.** Ve stejném dashboardu má databáze záložku Console. Vlož do ní
   obsah `drizzle/0000_striped_taskmaster.sql` a spusť. (Kdo má po ruce Node,
   udělá totéž přes `npm run cf:migrate`.)
3. **Tajemství.** Workers & Pages → vmerku → Settings → Variables and Secrets:
   `CHECK_TOKEN` (libovolný náhodný řetězec) a SMTP údaje `SMTP_HOST`,
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Worker je předá do
   kontejneru.
4. **`APP_URL`** ve `vars` ve `wrangler.jsonc` přepiš na svou doménu — používá
   se v odkazech v e-mailech.
5. **Doména.** Workers & Pages → vmerku → Settings → Domains & Routes.

### Nasazování bez Node na vlastním počítači

Nasazuje **Cloudflare Workers Builds** přímo z repozitáře, takže na vlastním
počítači není potřeba nic instalovat. V nastavení workeru (Settings → Build):

- **Production branch** musí být ta větev, ze které chceš nasazovat. Je to
  důležité: na jiných než produkční větvi Workers Builds jen nahraje kód
  workeru (`wrangler versions upload`) a **obraz kontejneru vůbec nepostaví**.
- **Build command:** `npm run typecheck`. Samotný `next build` tady nemá co
  dělat, appku si staví Dockerfile uvnitř obrazu. Testy sem nepatří —
  prostředí Workers Builds nepřekládá nativní moduly, takže by testy nad
  better-sqlite3 spadly; od toho je GitHub Actions.
- **Deploy command:** `npx wrangler deploy` (výchozí).

Pozor, `npx wrangler deploy` se chová podle `wrangler.jsonc`. Když ho ve větvi
nenajde, spustí místo toho průvodce, který projekt překope na OpenNext a
nasadí appku jako čistý Worker — tedy přesně to, co kvůli parsování PDF
nefunguje. Když deploy skončí chybou o `WORKER_SELF_REFERENCE`, staví se
větev bez `wrangler.jsonc`.

Kdo má Node a Docker, nasadí i z příkazové řádky: `npm run cf:migrate` a
`npm run cf:deploy`. GitHub Actions (`.github/workflows/kontrola.yml`) jen
kontroluje typy a pouští testy, nenasazuje.

### Cena

Plán Workers Paid ($5/měsíc) zahrnuje 25 GiB-hodin paměti, 200 GB-hodin disku
a 375 vCPU-minut. Instance `basic` (1 GiB paměti, 4 GB disku) při pár
kontrolách denně spotřebuje kolem dvou hodin běhu měsíčně, takže se do
přídělů vejde. Kdyby kontejner vůbec neusínal, vyjde to i s přeplatky asi na
$12 měsíčně.

## Nasazení jinam

Appka umí i obyčejný Node hosting se SQLite souborem — když není nastavená
`D1_PROXY_URL`, `src/db/connect.ts` sáhne po better-sqlite3.

Na Renderu zvol v prohlížeči **New > Blueprint**, ukaž na tenhle repozitář a
zbytek si přečte z `render.yaml`. Build jede z Dockerfilu, databáze leží na
disku `/data` a plánovač běží uvnitř appky (`SCHEDULER_IN_PROCESS=1`), protože
jeden kontejner umí připojit jen jeden disk.

Na vlastním serveru s Dockerem:

```bash
cp .env.example .env          # vyplň SMTP, APP_URL
docker compose up -d --build
docker compose exec web npm run db:migrate
docker compose exec web npm run db:seed
```

Web běží na portu 3000, plánovač jako druhý kontejner nad stejnou databází.
Historie cen leží ve svazku `data`, takže přežije redeploy.

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
src/db/connect.ts         volba driveru: SQLite soubor, nebo D1 přes Worker
worker/index.ts           Worker před kontejnerem: most k D1 a cron triggery
wrangler.jsonc            konfigurace nasazení na Cloudflare
tests/                    testy párování, parsování letáku, insightů a D1
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
