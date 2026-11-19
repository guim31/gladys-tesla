# Teslemetry

Verfolge und steuere deine Tesla-Autos, deine Powerwall und deine Solaranlage
von Gladys aus über **Teslemetry**: Batterie, Reichweite, Laden, Klima,
Verriegelung, Wächter-Modus und die Energieflüsse deines Hauses in Echtzeit.

> **Ohne die Hardware entwickelt: Feedback willkommen.** Diese Integration
> wurde ohne Auto, ohne Powerwall und ohne Teslemetry-Konto gebaut und mit
> Beispielantworten der API getestet, die aus den Tests der Teslemetry-Integration
> von Home Assistant und der Dokumentation der Tesla Fleet API übernommen
> wurden. Wenn dir etwas falsch vorkommt, sag es bitte im Gladys-Forum.

Diese Integration steht in keiner Verbindung zu Tesla, Inc. oder Teslemetry.

Sie ist nach dem Dienst benannt, über den sie läuft. Andere Wege zu einem Tesla
(Tessie, TeslaMate, direkt die Fleet API …) bekommen vielleicht eine eigene
Integration.

## Wall Connector: jetzt eine eigene Integration

Version 1.1.0 dieser Integration (damals „Tesla“ genannt) las auch den **Tesla
Wall Connector** im Heimnetz aus. Die Wallbox hat jetzt ihre eigene
Integration, **Tesla Wall Connector**, die gar kein Teslemetry braucht. Falls du
eine eingerichtet hattest:

1. Installiere **Tesla Wall Connector** aus dem Gladys-Store und gib die
   Adresse der Wallbox im Tab **Konfiguration** ein.
2. Dein Wallbox-Gerät, sein Verlauf und die Dashboards, die es anzeigen, bleiben
   erhalten: Die neue Integration verwendet dieselben Gerätekennungen.
3. Szenen, die die Auslöser _Wall Connector_ verwendeten, und das Widget _Tesla
   Wall Connector_ müssen mit der neuen Integration neu eingerichtet werden.

Bis dahin zeigt diese Integration eine Erinnerung in ihrem Verbindungsstatus
und in den Protokollen an und lässt die Wallbox in Ruhe.

## So verbindet sie sich

Teslas offizielle API (die Fleet API) richtet sich an Entwickler: Jeder
Benutzer müsste eine Entwickler-Anwendung registrieren, einen öffentlichen
Schlüssel auf einer Webdomain hosten und jeden Befehl signieren. **Teslemetry**
übernimmt das alles für dich und gibt dir ein einziges Zugriffstoken. Es ist
ein **kostenpflichtiger Dienst** mit einem Abonnement pro Fahrzeug und pro
Energiestandort (siehe [teslemetry.com/pricing](https://teslemetry.com/pricing)),
inklusive eines monatlichen Kontingents an Befehls-Credits.

Das Lesen der Daten **weckt dein Auto nie**. Ein schlafendes Auto behält in
Gladys seine zuletzt bekannten Werte; nur ein Befehl von dir (Laden starten,
Klima, Verriegeln …) weckt es auf.

## Was du brauchst

- Gladys **5.1** oder neuer.
- Ein [Teslemetry](https://teslemetry.com)-Konto, das mit deinem Tesla-Konto
  verknüpft ist, mit einem Abonnement für jedes Auto und jeden Energiestandort,
  die du in Gladys haben möchtest.
- Für Befehle: den **virtuellen Schlüssel** von Teslemetry, der zu jedem Auto
  hinzugefügt wird (Teslemetry führt dich durch, mit der Tesla-App dauert es
  eine Minute).
- Für Echtzeitdaten des Autos: Fleet-Telemetry-Streaming, das neuere Autos
  unterstützen (es braucht eine aktuelle Softwareversion; Model S und Model X
  vor 2021 streamen nicht). Autos ohne Streaming funktionieren trotzdem, mit den
  zwischengespeicherten Daten von Teslemetry.

## Einrichtung

1. Erstelle in der Teslemetry-Konsole ein **Zugriffstoken** mit Zugriff auf
   deine Fahrzeuge und Energiestandorte. Kopiere es.
2. Öffne in Gladys den Tab **Konfiguration** der Teslemetry-Integration, füge
   das Token bei **Teslemetry-Zugriffstoken** ein, prüfe die anderen
   Einstellungen und speichere.
3. Öffne den Tab **Entdecken**: Jedes Auto und jeder Energiestandort wird
   aufgelistet. Füge die hinzu, die du möchtest.
4. Optional: Klicke auf **Verbindung testen**, um zu sehen, worauf Teslemetry
   Zugriff gibt und ob der Echtzeit-Stream verbunden ist.

Die Integration schaltet in Teslemetry außerdem das Streaming der wenigen
Fahrzeugwerte ein, die sie liest (Batterie, Reichweite, Laden, Klima,
Verriegelung, Wächter-Modus, Kilometerzähler, Anzeigeeinheiten). Sie fügt nur
Felder hinzu und entfernt nie deine eigenen.

### Einstellungen

| Einstellung                                       | Was sie bewirkt                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Einheiten**                                     | Einheiten für Entfernungen und Temperaturen, **so wie sie gespeichert und von Szenen verglichen werden**: die Anzeigeeinstellung des Autos (Standard), Meilen und °F oder Kilometer und °C. Das Dashboard zeigt immer die bevorzugten Einheiten jedes Benutzers an, egal was du wählst. |
| **Sprache der Gerätenamen**                       | Englische, französische, deutsche oder spanische Namen für die Funktionen neuer Geräte. Gladys behält den Namen einer Funktion, sobald das Gerät erstellt ist.                                                                                                                          |
| **Ersatzabfrage der Autos**                       | Wie oft ein **waches** Auto, das nichts streamt, gelesen wird (30 oder 60 Minuten oder nie). Nie, während das Auto schläft.                                                                                                                                                             |
| **Hausverbrauch an das Energie-Dashboard senden** | Standardmäßig aus. Fügt Powerwall-Standorten den Verbrauchszähler des Hauses hinzu (siehe unten).                                                                                                                                                                                       |

Wenn du die **Einheiten** eines Autos änderst, das du schon hinzugefügt hast,
bietet der Tab Entdecken dafür eine **Aktualisierung** an. Bis du sie
akzeptierst, wird das Auto weiter in seinen bisherigen Einheiten veröffentlicht,
damit nichts durcheinandergerät.

## Deine Autos

| Funktion                 | Details                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Batteriestand            | %                                                                                          |
| Reichweite               | Nennreichweite, in Meilen oder km                                                          |
| Ladestatus               | Lädt, angeschlossen, vom Auto pausiert, von der Ladestation pausiert (kein Strom), inaktiv |
| Ladeleistung             | kW, AC oder DC (Supercharger)                                                              |
| Ladegrenze               | 50 bis 100 %, **einstellbar**                                                              |
| Laden                    | Laden **starten / stoppen**                                                                |
| Ladestrom                | Vom Lader angeforderte Ampere, **einstellbar** (praktisch zum Laden mit Solarüberschuss)   |
| Angeschlossen            | Ja / nein                                                                                  |
| Klimaanlage              | **Ein / aus**                                                                              |
| Klima-Solltemperatur     | **Einstellbar**, 59–82 °F (15–28 °C)                                                       |
| Innen- / Außentemperatur | °F oder °C                                                                                 |
| Verriegelung             | **Verriegeln / entriegeln**                                                                |
| Wächter-Modus            | **Ein / aus**                                                                              |
| Kilometerzähler          | Meilen oder km                                                                             |
| Online (wach)            | Ein, wenn das Auto wach ist, aus, solange es schläft oder außer Reichweite ist             |
| Reifendruck (×4)         | Vorne links / rechts, hinten links / rechts: bar, psi oder kPa (wie das Auto ihn anzeigt)  |
| Reifendruck niedrig      | Ein, wenn das Auto vor einem zu niedrigen Reifendruck oder einem platten Reifen warnt      |

Die vier Reifendrücke und die Warnung bei niedrigem Druck erscheinen nur, wenn
das Auto sie meldet. Du hast dein Auto schon hinzugefügt? Klicke im Tab
Entdecken bei ihm auf **Aktualisieren**, um sie hinzuzufügen. Um gewarnt zu
werden, erstelle eine Szene, die durch **Reifendruck niedrig** ausgelöst wird,
oder durch einen Druck unter deinem Schwellenwert (an einem kalten Morgen sinkt
der Druck: lass etwas Spielraum). Das Auto misst seine Drücke während der Fahrt:
Ein geparktes Auto zeigt seine letzte Messung. Die Drücke folgen dem
Echtzeit-Stream; die Warnung bei niedrigem Druck wird durch die Abfragen des
Autos aktualisiert (beim Start und bei den Ersatzabfragen), sie kann also
hinterherhinken.

Der Standort des Autos wird von dieser Version der Integration **nie gelesen**.

## Deine Powerwall und Solaranlage

Jeder Energiestandort bekommt die Funktionen dessen, was er hat: Ein reiner
Solarstandort hat keine Batteriefunktionen, eine Powerwall ohne Panels keine
Solarfunktionen.

| Funktion                      | Details                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Solarproduktion               | W                                                                                                     |
| Hausverbrauch                 | W, vom Gateway gemessen                                                                               |
| Netz (Bezug +, Einspeisung −) | W, **mit Vorzeichen**: positiv, wenn du Strom aus dem Netz beziehst, negativ, wenn du Strom einspeist |
| Batterieladung / -entladung   | W, zwei Funktionen (beide positiv)                                                                    |
| Powerwall-Ladestand           | %                                                                                                     |
| Netz verbunden                | Aus bei einem Ausfall (das Haus läuft über die Powerwall)                                             |
| Betriebsmodus                 | Eigenverbrauch oder Zeitbasierte Steuerung, **einstellbar**                                           |
| Energiezähler                 | Kumulierte kWh: Solarproduktion, Netzbezug und Netzeinspeisung, Batterie (Haus: siehe unten)          |

„Nur Notstrom“ wird nicht angeboten: Tesla hat ihn an vielen Standorten
abgeschafft. Ein Standort, der in der Tesla-App darauf eingestellt ist, zeigt
im Energie-Widget „Nur Notstrom“ an.

Der **Hausverbrauchszähler** ist **standardmäßig aus**: Aktiviere in den
Einstellungen **Hausverbrauch an das Energie-Dashboard senden** und akzeptiere
dann die **Aktualisierung** des Standorts im Tab Entdecken. Gladys berechnet
daraus den Verbrauch pro halbe Stunde und seine Kosten mit deinem
Energievertrag. Gladys ordnet ihn dem Hauptstromzähler zu, den du in den
Energieeinstellungen festgelegt hast: Wenn dein Stromzähler schon in Gladys
ist, misst die Powerwall dasselbe Haus. Lass die Option dann aus, sonst wird
das Haus doppelt gezählt. Der Zähler zählt weiter, solange die Option aus ist;
wenn du sie später einschaltest, beginnt er also nicht bei null. Die Zähler
beginnen mit der Installation der Integration zu zählen: Tesla liefert keine
Gesamtsummen seit Inbetriebnahme, sie werden aus den Tagessummen aufgebaut, die
Teslemetry streamt.

## Dashboard

Zwei Widgets (Gladys 5.1+), die jeweils mit dem Gerät eingerichtet werden, das
sie anzeigen:

- **Tesla-Fahrzeug**: Batterie, Reichweite, Ladeleistung und Innentemperatur in
  Echtzeit, Laden, Klima, Verriegelung, Wächter-Modus und Online-Status sowie
  Tasten zum Starten oder Stoppen der Klimaanlage, zum Starten oder Stoppen des
  Ladens (wenn das Auto angeschlossen ist), zum Verriegeln oder Entriegeln
  (das Entriegeln verlangt eine Bestätigung).
- **Tesla-Energiefluss**: Solar, Haus, Netz und Powerwall in Echtzeit, die
  letzten 24 Stunden als Diagramm, der Netzstatus, Betriebsmodus,
  Notstromreserve und Storm Watch.

## Szenen

Auslöser (jeder lässt sich optional auf ein Auto oder einen Energiestandort
beschränken):

- **Tesla hat mit dem Laden begonnen**, **Tesla-Ladevorgang abgeschlossen**,
  **Tesla angeschlossen**, **Tesla abgesteckt** — mit dem Batteriestand.
- **Netzausfall (Powerwall)** und **Netz wiederhergestellt (Powerwall)** — mit
  dem Powerwall-Ladestand und der Angabe, ob der Ausfall ein absichtliches
  „Netzunabhängig gehen“ ist.

Aktion:

- **Notstromreserve der Powerwall einstellen** — zum Beispiel 100 %, wenn ein
  Sturm angekündigt ist, danach wieder 20 %.

Jede Funktion des Autos oben lässt sich auch wie gewohnt in Szenen verwenden
(„wenn der Batteriestand unter 30 % liegt“, „um 7:30 die Klimaanlage
starten“, „die Ladegrenze auf 90 % setzen“ …).

## Aktualität der Daten und Teslemetry-Kosten

Das Folgende sind die veröffentlichten Regeln von Teslemetry (2026). **Sie
konnten während der Entwicklung nicht an einem echten Konto gemessen werden**:
Damit du deine eigenen Kosten siehst, schreibt die Integration für jeden
abgerechneten Aufruf eine Zeile in ihre Protokolle, mit deinem verbleibenden
Guthaben (`Teslemetry credits: … cost 1, balance 498`), und **Verbindung
testen** zeigt das Guthaben an.

| Was                                                        | Wann                                                                                | Kosten                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Echtzeit-Stream (Autos, Powerwall, tägliche Energiesummen) | Dauerhaft, eine Verbindung für das ganze Konto                                      | In den Abonnements enthalten, kein Credit                                                                                 |
| Abfrage des Autos beim Start                               | Einmal pro Auto, wenn die Integration startet                                       | Kostenlos aus dem Cache von Teslemetry; bis zu 2 Credits, wenn das Auto wach ist und sein Cache älter als etwa 20 Minuten |
| Ersatzabfrage des Autos                                    | Ein waches Auto, das für die gewählte Dauer (Standard 30 Min.) nichts gestreamt hat | Wie oben. Nie bei einem schlafenden Auto und nie bei einem Auto, das streamt                                              |
| Fahrzeugliste, Powerwall-Status                            | Alle 15 / 10 Minuten, **nur während der Stream ausgefallen ist**                    | Voraussichtlich kostenlos (Lese-Aufrufe, nicht überprüft)                                                                 |
| Befehl (Laden, Klima, Verriegeln, Ladegrenze, Reserve …)   | Wenn du ihn auslöst                                                                 | 1 Credit; wenn das Auto schläft, wird es zuerst geweckt (etwa 20 Credits mehr)                                            |

In der Praxis sind bei einem Auto mit Streaming die Befehle, die du sendest,
die einzigen Kosten der Integration. Das monatliche Kontingent von Teslemetry
beträgt 500 Credits pro Fahrzeug und pro Energiestandort: etwa 500 Befehle an
ein waches Auto oder etwa 24 an ein schlafendes. Gladys bestätigt einen Befehl
nach 4 Sekunden, auch wenn das Auto noch aufwacht; der Befehl läuft weiter und
sein Ergebnis erscheint, sobald das Auto antwortet.

## Einschränkungen

- Ohne Auto, Powerwall und Teslemetry-Konto entwickelt (siehe oben).
- Kein Standort, keine Navigation, kein Kofferraum, keine Fenster und keine
  Sitzheizungen in dieser Version.
- Gladys kennt keine Batterieleistung mit Vorzeichen: Die Leistung der Powerwall
  wird in „Laden“ und „Entladen“ aufgeteilt. Auch die Notstromreserve hat keine
  Gerätefunktion: Sie wird im Energie-Widget angezeigt und mit der Szenenaktion
  eingestellt.
- Ältere Autos ohne Fleet Telemetry werden nur aus dem Cache von Teslemetry
  aktualisiert (alle 30 oder 60 Minuten, solange sie wach sind).
- Die Funktionsnamen werden beim Erstellen des Geräts festgelegt und folgen
  späteren Sprachänderungen nicht.

## Fehlerbehebung

- **„Teslemetry refused the access token“**: Das Token wurde falsch
  eingegeben, widerrufen oder ist abgelaufen. Erstelle in der
  Teslemetry-Konsole ein neues.
- **„A subscription is required“**: Das Auto oder der Standort hat kein aktives
  Teslemetry-Abonnement.
- **Ein Befehl schlägt mit „vehicle unavailable“ fehl**: Das Auto ist außer
  Reichweite, oder der virtuelle Schlüssel ist nicht darauf installiert.
- **Die Werte des Autos ändern sich nur alle 30 Minuten**: Das Auto streamt
  nicht. Prüfe, ob das Streaming dafür in der Teslemetry-Konsole eingeschaltet
  ist und ob seine Software aktuell ist.
- Die Protokolle der Integration (über die Gladys-Oberfläche zu öffnen) bleiben
  im normalen Betrieb ruhig: Start, Verlust und Rückkehr des Echtzeit-Streams,
  Fehler (einmal, wenn sie beginnen, einmal, wenn sie enden) und deine Befehle.
  `LOG_LEVEL=debug` zeigt jede Abfrage, jeden Zustand und jeden Auslöser.
  Token werden nie protokolliert.
