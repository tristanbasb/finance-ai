import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeCsvBytes, guessMapping, mapRows, parseCsv, type CsvMapping } from "@/lib/csv";

describe("parseCsv", () => {
  it("retire le BOM et détecte le délimiteur ;", () => {
    const r = parseCsv("﻿Date;Libellé;Montant\n24/10/2026;Courses;-12,50\n");
    expect(r.delimiter).toBe(";");
    expect(r.headers).toEqual(["Date", "Libellé", "Montant"]);
    expect(r.rows).toEqual([["24/10/2026", "Courses", "-12,50"]]);
  });
  it("garde un champ entre guillemets contenant le délimiteur", () => {
    const r = parseCsv('Date;Libellé;Montant\n24/10/2026;"Achat; cadeau";-10\n');
    expect(r.rows[0]).toEqual(["24/10/2026", "Achat; cadeau", "-10"]);
  });
  it("gère les guillemets doublés", () => {
    const r = parseCsv('a;b\n"il a dit ""oui""";x\n');
    expect(r.rows[0]).toEqual(['il a dit "oui"', "x"]);
  });
  it("gère un saut de ligne dans un champ entre guillemets", () => {
    const r = parseCsv('a;b\n"ligne1\nligne2";x\n');
    expect(r.rows).toEqual([["ligne1\nligne2", "x"]]);
  });
  it("ignore les lignes vides et gère CRLF", () => {
    const r = parseCsv("a;b\r\n\r\n1;2\r\n\r\n3;4\r\n");
    expect(r.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });
  it("détecte la virgule et la tabulation", () => {
    expect(parseCsv("a,b,c\n1,2,3").delimiter).toBe(",");
    expect(parseCsv("a\tb\tc\n1\t2\t3").delimiter).toBe("\t");
  });
  it("ignore les délimiteurs entre guillemets pour la détection", () => {
    const r = parseCsv('"a,b,c,d";x;y\n1;2;3');
    expect(r.delimiter).toBe(";");
  });
  it("traite un guillemet au milieu d'un champ non entouré de guillemets comme un caractère littéral", () => {
    const r = parseCsv('Libellé;Montant\n5" pizza;1\n2;3');
    expect(r.headers).toEqual(["Libellé", "Montant"]);
    expect(r.rows).toEqual([
      ['5" pizza', "1"],
      ["2", "3"],
    ]);
  });
  it("détecte le délimiteur malgré un guillemet littéral au milieu d'un champ", () => {
    const r = parseCsv('Libellé,Montant\n5" pizza,1\n2,3');
    expect(r.delimiter).toBe(",");
    expect(r.rows).toEqual([
      ['5" pizza', "1"],
      ["2", "3"],
    ]);
  });
  it("retourne un résultat vide pour un texte vide", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], lines: [], delimiter: ";" });
  });
});

describe("guessMapping", () => {
  it("reconnaît date, libellé et montant", () => {
    expect(guessMapping(["Date opération", "Libellé", "Montant"])).toEqual({
      date: 0,
      label: 1,
      amount: 2,
    });
  });
  it("reconnaît débit / crédit et description (insensible aux accents et à la casse)", () => {
    expect(guessMapping(["DATE", "Description", "Débit", "Crédit"])).toEqual({
      date: 0,
      label: 1,
      debit: 2,
      credit: 3,
    });
    expect(guessMapping(["date", "label", "amount"])).toEqual({ date: 0, label: 1, amount: 2 });
  });
  it("mappe « Montant débit » / « Montant crédit » sur debit / credit, sans colonne amount", () => {
    expect(guessMapping(["Date", "Libellé", "Montant débit", "Montant crédit"])).toEqual({
      date: 0,
      label: 1,
      debit: 2,
      credit: 3,
    });
  });
  it("ne devine rien quand aucun mot-clé ne correspond", () => {
    expect(guessMapping(["foo", "bar"])).toEqual({});
  });
});

describe("mapRows", () => {
  it("convertit les colonnes Débit/Crédit en montants signés", () => {
    const rows = [
      ["24/10/2026", "Courses", "12,50", ""],
      ["25/10/2026", "Salaire", "", "100"],
    ];
    const { valid, errors } = mapRows(rows, { date: 0, label: 1, debit: 2, credit: 3 });
    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { date: "2026-10-24", label: "Courses", amount: -1250 },
      { date: "2026-10-25", label: "Salaire", amount: 10000 },
    ]);
  });
  it("force le débit négatif même s'il est déjà saisi avec un signe moins", () => {
    const { valid } = mapRows([["24/10/2026", "x", "-12,50", ""]], {
      date: 0,
      label: 1,
      debit: 2,
      credit: 3,
    });
    expect(valid[0].amount).toBe(-1250);
  });
  it("utilise la colonne montant unique telle quelle (signée)", () => {
    const { valid } = mapRows([["24/10/2026", "Courses", "-12,50"]], {
      date: 0,
      label: 1,
      amount: 2,
    });
    expect(valid).toEqual([{ date: "2026-10-24", label: "Courses", amount: -1250 }]);
  });
  it("signale les erreurs avec numéro de ligne (en-tête = ligne 1, 1re donnée = ligne 2)", () => {
    const rows = [
      ["24/10/2026", "OK", "-1"],
      ["31/02/2026", "Date invalide", "-1"],
      ["25/10/2026", "", "-1"],
      ["26/10/2026", "Montant invalide", "abc"],
    ];
    const { valid, errors } = mapRows(rows, { date: 0, label: 1, amount: 2 });
    expect(valid).toHaveLength(1);
    expect(errors).toEqual([
      { line: 3, reason: "Date invalide" },
      { line: 4, reason: "Libellé vide" },
      { line: 5, reason: "Montant invalide" },
    ]);
  });
  it("traite une cellule réduite à un tiret comme vide", () => {
    const m = { date: 0, label: 1, debit: 2, credit: 3 };
    const { valid, errors } = mapRows(
      [
        ["24/10/2026", "a", "5,00", "-"],
        ["24/10/2026", "b", "–", "7,00"],
        ["24/10/2026", "c", "-", "-"],
      ],
      m,
    );
    expect(valid.map((v) => v.amount)).toEqual([-500, 700]);
    expect(errors).toEqual([{ line: 4, reason: "Montant manquant" }]);
  });
  it("signale une ligne sans aucun montant", () => {
    const { errors } = mapRows([["24/10/2026", "x", "", ""]], {
      date: 0,
      label: 1,
      debit: 2,
      credit: 3,
    });
    expect(errors).toEqual([{ line: 2, reason: "Montant manquant" }]);
  });
});

describe("choix de la ligne d'en-tête (préambule bancaire)", () => {
  it("saute les lignes de préambule et prend la première ligne reconnue comme en-tête", () => {
    const r = parseCsv("Téléchargement du 24/10/2026;\nCompte n° 123;\nDate;Libellé;Montant\n24/10/2026;Courses;-12,50\n");
    expect(r.headers).toEqual(["Date", "Libellé", "Montant"]);
    expect(r.rows).toEqual([["24/10/2026", "Courses", "-12,50"]]);
    expect(r.lines).toEqual([4]);
  });
  it("reconnaît un en-tête débit/crédit sans colonne montant", () => {
    const r = parseCsv("Export;\nDate opération;Libellé;Débit;Crédit\n24/10/2026;Café;2,10;\n");
    expect(r.headers).toEqual(["Date opération", "Libellé", "Débit", "Crédit"]);
    expect(r.rows).toHaveLength(1);
  });
  it("sans en-tête reconnu, prend la 1re ligne ayant le nombre de champs le plus fréquent", () => {
    const r = parseCsv("Mon export\nA;B;C\n1;2;3\n4;5;6\n");
    expect(r.headers).toEqual(["A", "B", "C"]);
    expect(r.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });
  it("détecte le délimiteur même si le préambule contient des virgules", () => {
    const r = parseCsv("Solde au 24/10/2026 : 1 234,56\nDate;Libellé;Montant\n24/10/2026;Courses;-12,50\n");
    expect(r.delimiter).toBe(";");
    expect(r.headers).toEqual(["Date", "Libellé", "Montant"]);
  });
  it("numérote les lignes comme dans le fichier (lignes vides et champs multilignes compris)", () => {
    const r = parseCsv('Date;Libellé;Montant\r\n\r\n24/10/2026;"deux\nlignes";1\r\n25/10/2026;X;2\r\n');
    expect(r.lines).toEqual([3, 5]);
  });
  it("mapRows utilise les numéros de ligne fournis", () => {
    const { errors } = mapRows([["pas une date", "x", "1"]], { date: 0, label: 1, amount: 2 }, [9]);
    expect(errors).toEqual([{ line: 9, reason: "Date invalide" }]);
  });
});

describe("relevé Latin-1 avec préambule (tests/fixtures/releve-preambule.csv)", () => {
  const bytes = readFileSync(fileURLToPath(new URL("./fixtures/releve-preambule.csv", import.meta.url)));

  it("enchaîne decodeCsvBytes, parseCsv, guessMapping et mapRows de bout en bout", () => {
    const { headers, rows, lines, delimiter } = parseCsv(decodeCsvBytes(bytes));
    expect(delimiter).toBe(";");
    expect(headers).toEqual(["Date", "Libellé", "Débit euros", "Crédit euros"]);
    expect(rows).toHaveLength(5);

    const guess = guessMapping(headers);
    expect(guess).toEqual({ date: 0, label: 1, debit: 2, credit: 3 });

    const { valid, errors } = mapRows(rows, guess as CsvMapping, lines);
    expect(errors).toEqual([{ line: 9, reason: "Date invalide" }]);
    expect(valid).toEqual([
      { date: "2026-10-02", label: "CB CARREFOUR MARKET", amount: -4560 },
      { date: "2026-10-03", label: "PRLV SEPA EDF", amount: -7210 },
      { date: "2026-10-05", label: "VIR SALAIRE OCTOBRE", amount: 245000 },
      { date: "2026-10-08", label: "CB BOULANGERIE DU MARCHÉ", amount: -320 },
    ]);
  });
});

describe("relevé bancaire d'exemple (tests/fixtures/releve.csv)", () => {
  const text = readFileSync(fileURLToPath(new URL("./fixtures/releve.csv", import.meta.url)), "utf8");

  it("enchaîne parseCsv, guessMapping et mapRows de bout en bout", () => {
    const { headers, rows, delimiter } = parseCsv(text);
    expect(delimiter).toBe(";");
    expect(headers).toEqual(["Date", "Libellé", "Débit", "Crédit"]);
    expect(rows).toHaveLength(7);

    const guess = guessMapping(headers);
    expect(guess).toEqual({ date: 0, label: 1, debit: 2, credit: 3 });

    const { valid, errors } = mapRows(rows, guess as CsvMapping);
    expect(errors).toEqual([{ line: 5, reason: "Date invalide" }]);
    expect(valid).toEqual([
      { date: "2026-10-02", label: "CARTE CARREFOUR MARKET", amount: -4560 },
      { date: "2026-10-03", label: "PRLV EDF; CONTRAT 123", amount: -7210 },
      { date: "2026-10-05", label: "VIREMENT SALAIRE OCTOBRE", amount: 245000 },
      { date: "2026-10-08", label: 'CARTE BOULANGERIE "AU FOURNIL"', amount: -320 },
      { date: "2026-10-10", label: "REMBOURSEMENT AMI", amount: 2500 },
      { date: "2026-10-12", label: "ABONNEMENT NETFLIX", amount: -1349 },
    ]);
  });
});

describe("decodeCsvBytes", () => {
  it("lit de l'UTF-8 tel quel", () => {
    const bytes = new TextEncoder().encode("Libellé;Crédit\nCafé;1");
    expect(decodeCsvBytes(bytes)).toBe("Libellé;Crédit\nCafé;1");
  });
  it("retombe sur windows-1252 quand l'UTF-8 est invalide (export bancaire Latin-1)", () => {
    // « Libellé;Crédit » encodé en Latin-1 : é = 0xE9
    const latin = Uint8Array.from(Buffer.from("Libellé;Crédit", "latin1"));
    expect(latin).toContain(0xe9);
    expect(decodeCsvBytes(latin)).toBe("Libellé;Crédit");
  });
});
