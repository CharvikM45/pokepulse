export type SetArtwork = {
  src: string;
  name: string;
  number: string;
  set: string;
  source: string;
};

export const setArtwork: Readonly<Record<string, SetArtwork>> = {
  "Prismatic Evolutions": {
    src: "/tcg/sv08.5-161.webp",
    name: "Umbreon ex",
    number: "161",
    set: "Prismatic Evolutions",
    source: "https://api.tcgdex.net/v2/en/cards/sv08.5-161",
  },
  "Surging Sparks": {
    src: "/tcg/sv08-238.webp",
    name: "Pikachu ex",
    number: "238",
    set: "Surging Sparks",
    source: "https://api.tcgdex.net/v2/en/cards/sv08-238",
  },
  "Twilight Masquerade": {
    src: "/tcg/sv06-214.webp",
    name: "Greninja ex",
    number: "214",
    set: "Twilight Masquerade",
    source: "https://api.tcgdex.net/v2/en/cards/sv06-214",
  },
  "Paldean Fates": {
    src: "/tcg/sv04.5-234.webp",
    name: "Charizard ex",
    number: "234",
    set: "Paldean Fates",
    source: "https://api.tcgdex.net/v2/en/cards/sv04.5-234",
  },
  "Scarlet & Violet—151": {
    src: "/tcg/sv03.5-199.webp",
    name: "Charizard ex",
    number: "199",
    set: "151",
    source: "https://api.tcgdex.net/v2/en/cards/sv03.5-199",
  },
  "Crown Zenith": {
    src: "/tcg/swsh12.5gg-GG70.png",
    name: "Arceus VSTAR",
    number: "GG70",
    set: "Crown Zenith Galarian Gallery",
    source: "https://api.tcgdex.net/v2/en/cards/swsh12.5gg-GG70",
  },
  "Obsidian Flames": {
    src: "/tcg/sv03-223.webp",
    name: "Charizard ex",
    number: "223",
    set: "Obsidian Flames",
    source: "https://api.tcgdex.net/v2/en/cards/sv03-223",
  },
  "Temporal Forces": {
    src: "/tcg/sv05-203.webp",
    name: "Iron Leaves ex",
    number: "203",
    set: "Temporal Forces",
    source: "https://api.tcgdex.net/v2/en/cards/sv05-203",
  },
  "Paradox Rift": {
    src: "/tcg/sv04-251.webp",
    name: "Roaring Moon ex",
    number: "251",
    set: "Paradox Rift",
    source: "https://api.tcgdex.net/v2/en/cards/sv04-251",
  },
  "Stellar Crown": {
    src: "/tcg/sv07-170.webp",
    name: "Terapagos ex",
    number: "170",
    set: "Stellar Crown",
    source: "https://api.tcgdex.net/v2/en/cards/sv07-170",
  },
};
