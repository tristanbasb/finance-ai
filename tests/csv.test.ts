import { describe, expect, it } from "vitest";
import { guessMapping, mapRows, parseCsv } from "@/lib/csv";

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
  it("retourne un résultat vide pour un texte vide", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], delimiter: ";" });
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
