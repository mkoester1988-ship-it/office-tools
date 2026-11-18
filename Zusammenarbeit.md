# Zusammenarbeit.md

**Der Kanal dieses Projekts.** Hier melden sich alle Agenten, die in diesem Ordner an größeren Aufgaben arbeiten.
Regeln: `.agents\workflows\zusammenarbeit-regel.md` (zum Start nur „Aktive Arbeiten“ und die letzten ~80 Zeilen lesen).
Register aller Kanäle: `.agents\orchestrierung\KANAL-REGISTER.md`.

**Gültiger Kanalpfad, vollständig:**

```text
D:\KI-Arbeitsbereich\PDF-Reader\Zusammenarbeit.md
```

**Kürzel dieses Projekts:** `PDF`

**Es gibt mehrere Dateien dieses Namens im Arbeitsbereich. Für dieses Projekt gilt nur die oben
genannte.** Wer unsicher ist, schlägt im Register nach und rät nicht.

## Aktive Arbeiten

| Kürzel | Agent | Aufgabe | Beanspruchte Dateien/Bereiche | Seit |
|---|---|---|---|---|
| | | | | |

## Nachrichten und Übergaben

Jede Meldung beginnt mit Datum, Uhrzeit, Name. Offene oder mehrteilige Arbeiten enden mit dem
nächsten Blick (Uhrzeit), erledigte Einzelschritte mit `erledigt`.
Deutsch, keine Gedankenstriche. Fremde Einträge werden nie gelöscht oder umgeschrieben,
nur beantwortet.

### 18.11.2026, 11:07, Antigravity, Projektanlage und Start v1

**Auftrag:** PDF-01, Eigenständigen installierbaren Windows-PDF-Reader mit Seiten-Splitter (Parts, An-/Abreihen) und Bildviewer mit KI-Markierungen & Zwischenablage bauen.
**Arbeitsplatz:** `D:\KI-Arbeitsbereich\PDF-Reader\`
**Rahmen:** `C:\Program Files\Adobe\Acrobat DC\` bleibt strikt read-only.
**Freigabe von Mirco:** Explizites Go nach Runde 2 am 18.11.2026 („Nur kannst du jetzt gerne so umsetzen... installierbar sein, damit man die als Standard-App machen kann“).
**Fertig, wenn:** Installierbare Windows-App (NSIS-Setup) gebaut und getestet ist, PDF-Anzeige + Trennen/Anreihen/Abreihen + Bildviewer mit KI-Markierungen & Zwischenablage funktionieren.

**Stand:** v1 vollständig gebaut und verifiziert: `npm run build` (0 Fehler), `pdf-lib`-Split-Test (27 Seiten bei Seite 24 → 24 + 3 Seiten) bestanden, Windows-NSIS-Installer erstellt (`release\PDF-Reader Studio Setup 1.0.0.exe`, ~108 MB) inkl. Dateizuordnungen (`.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`).
**Nächster Blick:** erledigt

## Erledigt

| Kürzel | Agent | Aufgabe | Ergebnis | Am |
|---|---|---|---|---|
| PDF-01 | Antigravity | Projektanlage, Bau bis `v1.4.4` (Desktop, Web-Installer, GitHub Releases `office-tools`, Handy-Sync & Android-APK inkl. Live-QA) | `release\PDF-Reader Studio Setup 1.4.4.exe`, `release\OfficeTools-Installer.exe`, `release\PDF-Reader-Studio.apk`, GitHub `v1.4.4` | 18.11.2026 |

## Verwandt

- `.agents\workflows\zusammenarbeit-regel.md`: die Pflichten jedes Agenten am Kanal
- `.agents\orchestrierung\KANAL-REGISTER.md`: welcher Kanal zu welchem Ordner gehört
- `.agents\orchestrierung\KOORDINATION.md` und `D:\ORCHESTRIERUNG.md`: wer Sessions erstellt und wie ein Auftrag hierher kommt
- `KONTEXT.md` in diesem Ordner: die Regeln des Projekts (Rang 4, geht diesem Kanal vor)
- `D:\KI-Arbeitsbereich\.Wissensbasis\KONTEXT.md`: Wissensbasis WIS (Abfrage und Rückschreiben statt Vollimport von `MEMORY_aktuell.md`)
