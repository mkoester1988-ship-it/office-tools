# PDF-Reader (`PDF`)

**Kürzel:** `PDF` · **Phase:** `live` · **Sensibilität:** 🟢 · **Stand:** 2026-11-18

> **Einstieg über WIS (kein Chronik-Ballast):** Vorwissen, Entscheidungen und Stand zuerst über MCP `wissen_suchen` (`projekt="PDF"`) abfragen, ohne MCP per `python D:\KI-Arbeitsbereich\.Wissensbasis\wissen.py suche "<Frage>" --projekt PDF` (Kurzanleitung: `D:\KI-Arbeitsbereich\.Wissensbasis\KONTEXT.md`). Im Kanal `Zusammenarbeit.md` zum Start nur „Aktive Arbeiten“ und die letzten ~80 Zeilen prüfen. Neue Ergebnisse am Ende knapp als `.md` im Projekt ablegen und `python D:\KI-Arbeitsbereich\.Wissensbasis\wissen.py aufbauen --projekt PDF` ausführen.

## Worum es geht

`D:\KI-Arbeitsbereich\PDF-Reader\` ist eine eigenständige, installierbare Windows-Desktop-App (Electron + React + TypeScript + `pdfjs-dist` + `pdf-lib` + `electron-builder` NSIS-Installer), die als Standard-App für PDFs und Bilder dient. Sie vereint einen schnellen Adobe-ähnlichen PDF-Reader (Seitenleiste, Zoom, Drehen, Volltextsuche, Lesezeichen, Drucken), einen interaktiven **Seiten-Splitter & Part-Manager** (beliebige Schnittpunkte setzen, Parts anklicken und einzeln oder gesammelt speichern, während die PDFs geöffnet bleiben, sowie weitere PDFs anreihen und abreihen) und einen **Bildviewer mit KI-Markierungswerkzeugen** (Pfeile, Rahmen, Kreise, Freihand, Text, Unschärfe, Zuschnitt) inklusive 1-Klick-Kopie in die Windows-Zwischenablage.

## Wer hier arbeitet

| Rolle | Wer | Was |
|---|---|---|
| Entscheidet | Mirco | Freigaben, Prioritäten, Design- und Funktionswünsche |
| Verantwortet | Hauptsession (Antigravity / Claude) | Zerlegen, delegieren, prüfen, zusammenführen |
| Arbeitet zu | Codex / agy / Subagenten | App-Module, UI-Komponenten, Build- und QA-Tests |

## Grenzen, die trotz Vollzugriff gelten

1. **`C:\Program Files\Adobe\Acrobat DC\` ist strikt read-only (Gebot 4: Produktion ist heilig).** Es dient ausschließlich zur Funktions- und Bedienungsanalyse. Es werden keine proprietären Adobe-Icons, -Grafiken oder Binärdateien kopiert oder ausgeliefert.
2. **100 % lokal und eigenständig:** Keine Cloud-Pflicht, keine Telemetrie, alle Assets und Bibliotheken sauber Open-Source-lizenziert.

## Fachliche Leitplanken

1. **Installierbare Windows-App mit Dateizuordnung:** Auslieferung über einen echten Windows-Installer (NSIS) mit Dateizuordnungen (`.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`), damit Windows die App als Standardprogramm zulässt.
2. **Verlustfreie PDF-Bearbeitung:** Trennen, Anreihen und Abreihen arbeiten verlustfrei auf Basis von `pdf-lib`; Originaldateien werden beim Trennen oder Anreihen niemals ungefragt überschrieben.
3. **Echte Umlaute:** Deutsche UI-Texte und Dokumentation immer mit echten Umlauten (`ä`, `ö`, `ü`, `ß`) und ohne Gedankenstriche.

## Wann gefragt wird

- Vor Änderungen an bereits installierten Systemprogrammen oder Deinstallation von Adobe Acrobat DC.
- Vor Veröffentlichung / Weitergabe außerhalb dieses Rechners.

## Verwandt

- `Zusammenarbeit.md`: der Kanal (zum Start nur „Aktive Arbeiten“ und die letzten ~80 Zeilen prüfen)
- `D:\KI-Arbeitsbereich\.Wissensbasis\KONTEXT.md`: Kurzanleitung WIS (Abfrage und Rückschreiben statt Vollimport von `MEMORY_aktuell.md`)
- `D:\PROJECTS.md`: die 10 Gebote und die Vorrangkette
