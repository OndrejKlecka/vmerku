/**
 * Řetězce mění adresu PDF každý týden (Tesco ji má dokonce s náhodným
 * identifikátorem). V Nastavení proto stačí zadat stránku obchodu s letákem
 * a appka si v ní odkaz na aktuální PDF najde sama.
 */
const PDF_URL = /https?:\/\/[^\s"'<>()]+?\.pdf(?:\?[^\s"'<>()]*)?/gi;

export function findPdfLink(html: string): string | null {
  // Odkazy bývají i v JSON uvnitř stránky, kde jsou lomítka escapovaná.
  const text = html
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  const found = [...new Set(text.match(PDF_URL) ?? [])];
  if (found.length === 0) return null;
  // Tesco: letáky leží na digitalcontent.api.tesco.com, jinde bývají
  // i PDF s obchodními podmínkami a ta přednost mít nemají.
  return (
    found.find((url) => /leta|leaflet|digitalcontent/i.test(url)) ?? found[0]
  );
}
