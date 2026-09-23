/**
 * Řetězce mění adresu PDF každý týden (Tesco ji má dokonce s náhodným
 * identifikátorem). V Nastavení proto stačí zadat stránku obchodu s letákem
 * a appka si v ní odkaz na aktuální PDF najde sama.
 */
const PDF_URL = /https?:\/\/[^\s"'<>()]+?\.pdf(?:\?[^\s"'<>()]*)?/gi;

/**
 * `hint` je kus názvu souboru, podle kterého vybrat ten správný leták, když
 * je jich na stránce víc (Tesco jich tam má 36: hypermarket, supermarket,
 * katalogy…). Zadává se za # na konci adresy v Nastavení, třeba `…#HM-CHM`.
 */
export function findPdfLink(
  html: string,
  hint?: string,
  now = new Date(),
): string | null {
  // Odkazy bývají i v JSON uvnitř stránky, kde jsou lomítka escapovaná.
  const text = html
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  // Tesco: stránka obchodu nese data letáků i s platností, někdy i ten
  // příští týden. Vezmeme ten, který platí teď.
  const current = currentFromValidity(text, now);
  if (current && (!hint || current.toLowerCase().includes(hint.toLowerCase())))
    return current;

  const found = [...new Set(text.match(PDF_URL) ?? [])];
  if (found.length === 0) return null;
  if (hint) {
    const wanted = hint.toLowerCase();
    return found.find((url) => url.toLowerCase().includes(wanted)) ?? null;
  }
  // Tesco: letáky leží na digitalcontent.api.tesco.com, jinde bývají
  // i PDF s obchodními podmínkami a ta přednost mít nemají.
  return (
    found.find((url) => /leta|leaflet|digitalcontent/i.test(url)) ?? found[0]
  );
}

const WITH_VALIDITY =
  /"leafletUrl":"(https?:[^"]+?\.pdf)"[^{}]*?"validFrom":"([^"]+)","validTo":"([^"]+)"/g;

function currentFromValidity(text: string, now: Date): string | null {
  const leaflets = [...text.matchAll(WITH_VALIDITY)].map((m) => ({
    url: m[1],
    from: new Date(m[2]),
    to: new Date(m[3]),
  }));
  const valid = leaflets.filter((l) => l.from <= now && now <= l.to);
  return (valid[0] ?? null)?.url ?? null;
}
