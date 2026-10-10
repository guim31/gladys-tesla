# Tesla (Teslemetry et Wall Connector)

Suivez et pilotez vos voitures Tesla, votre Powerwall et vos panneaux solaires
depuis Gladys : batterie, autonomie, charge, climatisation, verrouillage, mode
Sentinelle, et les flux d'énergie de la maison en temps réel. Une borne
**Tesla Wall Connector (gen 3)** se lit directement sur votre réseau local :
sans Teslemetry, sans abonnement.

> **Développée sans le matériel : retours bienvenus.** Cette intégration a été
> construite sans voiture, sans Powerwall ni compte Teslemetry, et testée sur
> des exemples de réponses de l'API adaptés des tests de l'intégration
> Teslemetry de Home Assistant et de la documentation de l'API Fleet de Tesla.
> La prise en charge de la Wall Connector a été construite sans borne, sur les
> exemples de réponses des tests de la bibliothèque `tesla-wall-connector`.
> Si quelque chose vous semble faux, dites-le sur le forum Gladys.

Cette intégration n'est affiliée ni à Tesla, Inc. ni à Teslemetry.

## Comment elle se connecte

L'API officielle de Tesla (l'API Fleet) s'adresse aux développeurs : chaque
utilisateur devrait enregistrer une application de développeur, héberger une
clé publique sur un nom de domaine et signer chaque commande. **Teslemetry**
fait tout cela pour vous et vous donne un seul jeton d'accès. C'est un
**service payant**, avec un abonnement par véhicule et par site d'énergie (voir
[teslemetry.com/pricing](https://teslemetry.com/pricing)) et une enveloppe
mensuelle de crédits de commande incluse.

La lecture des données **ne réveille jamais la voiture**. Une voiture endormie
garde ses dernières valeurs connues dans Gladys ; seule une commande que vous
envoyez (lancer la charge, la clim, verrouiller…) la réveille.

## Ce qu'il faut

- Gladys **5.1** ou plus récent.
- Pour une **Wall Connector seule** : rien d'autre que son adresse sur votre
  réseau (voir [Votre Wall Connector](#votre-wall-connector-en-local-sans-abonnement)).
  La suite de cette liste concerne les voitures et le Powerwall.
- Un compte [Teslemetry](https://teslemetry.com) lié à votre compte Tesla, avec
  un abonnement pour chaque voiture et chaque site d'énergie à suivre.
- Pour les commandes : la **clé virtuelle** Teslemetry ajoutée à chaque voiture
  (Teslemetry vous guide, cela prend une minute depuis l'application Tesla).
- Pour les données de la voiture en temps réel : le flux Fleet Telemetry, que
  les voitures récentes savent envoyer (il demande une version logicielle
  récente ; les Model S et Model X d'avant 2021 n'en disposent pas). Les
  voitures sans flux fonctionnent quand même, avec les données en cache de
  Teslemetry.

## Mise en route

1. Dans la console Teslemetry, créez un **jeton d'accès** avec l'accès à vos
   véhicules et sites d'énergie. Copiez-le.
2. Dans Gladys, ouvrez l'onglet **Configuration** de l'intégration Tesla,
   collez le jeton dans **Jeton d'accès Teslemetry**, vérifiez les autres
   réglages, enregistrez.
3. Ouvrez l'onglet **Découverte** : chaque voiture et chaque site d'énergie y
   figure. Ajoutez ceux que vous voulez.
4. Facultatif : cliquez sur **Tester la connexion** pour voir ce à quoi
   Teslemetry donne accès, et si le flux temps réel est connecté.

L'intégration active aussi, chez Teslemetry, le flux des quelques valeurs de la
voiture qu'elle lit (batterie, autonomie, charge, climatisation, verrouillage,
mode Sentinelle, compteur, unités d'affichage). Elle ne fait qu'ajouter des
champs, elle ne retire jamais les vôtres.

### Réglages

| Réglage                                                             | Rôle                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unités**                                                          | Unités des distances et températures **telles que les scènes les stockent et les comparent** : celles de l'écran de la voiture (par défaut), miles et °F, ou kilomètres et °C. Le tableau de bord affiche toujours les unités de chacun. |
| **Langue des noms d'appareils**                                     | Noms anglais ou français des fonctionnalités des nouveaux appareils. Gladys garde le nom d'une fonctionnalité une fois l'appareil créé.                                                                                                  |
| **Relevé de secours des voitures**                                  | Fréquence de lecture d'une voiture **éveillée** qui n'envoie rien par le flux (30 ou 60 minutes, ou jamais). Jamais pendant qu'elle dort.                                                                                                |
| **Envoyer la consommation de la maison au tableau de bord énergie** | Désactivé par défaut. Ajoute l'index de consommation aux sites Powerwall (voir plus bas).                                                                                                                                                |
| **Adresses des bornes Wall Connector**                              | Adresse IP (ou nom d'hôte) de chaque Wall Connector gen 3, séparées par des virgules. Avec ce seul champ rempli, le jeton Teslemetry peut rester vide.                                                                                   |

Changer les **Unités** d'une voiture déjà ajoutée : l'onglet Découverte propose
une **Mise à jour**. Tant que vous ne l'acceptez pas, la voiture continue d'être
publiée dans ses anciennes unités, rien ne se mélange.

## Vos voitures

| Fonctionnalité                       | Détails                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Niveau de batterie                   | %                                                                                        |
| Autonomie                            | Autonomie nominale, en km ou en miles                                                    |
| État de charge                       | En charge, véhicule connecté, en pause (voiture), en pause (borne sans courant), inactif |
| Puissance de charge                  | kW, en courant alternatif ou continu (Superchargeur)                                     |
| Limite de charge                     | 50 à 100 %, **réglable**                                                                 |
| Charge                               | **Lancer / arrêter** la charge                                                           |
| Courant de charge                    | Ampères demandés à la borne, **réglable** (pratique pour charger sur le surplus solaire) |
| Branchée                             | Oui / non                                                                                |
| Climatisation                        | **Marche / arrêt**                                                                       |
| Consigne de climatisation            | **Réglable**, 15–28 °C (59–82 °F)                                                        |
| Températures intérieure / extérieure | °C ou °F                                                                                 |
| Verrouillage                         | **Verrouiller / déverrouiller**                                                          |
| Mode Sentinelle                      | **Marche / arrêt**                                                                       |
| Kilométrage                          | km ou miles                                                                              |
| En ligne (réveillée)                 | Allumé quand la voiture est éveillée, éteint quand elle dort ou n'a pas de réseau        |

Cette version de l'intégration **ne lit jamais** la position de la voiture.

## Votre Powerwall et vos panneaux solaires

Chaque site d'énergie reçoit les fonctionnalités de ce qu'il possède : un site
uniquement solaire n'a pas de batterie, un Powerwall sans panneaux pas de
production solaire.

| Fonctionnalité                    | Détails                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Production solaire                | W                                                                                      |
| Consommation de la maison         | W, mesurée par la passerelle                                                           |
| Réseau (soutirage +, injection −) | W, **signé** : positif quand vous tirez du réseau, négatif quand vous y injectez       |
| Charge / décharge de la batterie  | W, deux fonctionnalités (toutes deux positives)                                        |
| Charge du Powerwall               | %                                                                                      |
| Réseau présent                    | Éteint pendant une coupure (la maison tourne sur le Powerwall)                         |
| Mode de fonctionnement            | Autoconsommation ou Contrôle horaire, **réglable**                                     |
| Index d'énergie                   | kWh cumulés : production solaire, soutirage et injection, batterie (maison : plus bas) |

Le mode « Secours uniquement » n'est pas proposé : Tesla l'a retiré sur de
nombreux sites. Un site réglé ainsi depuis l'application Tesla l'affiche dans
le widget énergie.

L'**index de consommation de la maison** est **désactivé par défaut** : activez
**Envoyer la consommation de la maison au tableau de bord énergie** dans les
réglages, puis acceptez la **Mise à jour** du site dans l'onglet Découverte.
Gladys en calcule alors la consommation par demi-heure et son coût, avec votre
contrat d'énergie. Gladys le rattache au compteur électrique principal défini
dans les réglages énergie : si votre compteur (Linky…) est déjà dans Gladys, le
Powerwall mesure la même maison, laissez donc l'option désactivée plutôt que de
compter la maison deux fois. L'index continue de compter tant que l'option est
désactivée : l'activer plus tard ne repart pas de zéro. Les index
commencent à compter à l'installation de l'intégration : Tesla ne donne pas de
totaux depuis la mise en service, ils sont construits à partir des totaux
journaliers que Teslemetry diffuse.

## Votre Wall Connector (en local, sans abonnement)

La **Tesla Wall Connector gen 3** répond sur votre réseau local, sans compte et
sans mot de passe. Gladys la lit là, directement : ni Teslemetry, ni
abonnement, ni cloud. Cela marche seul (laissez le jeton Teslemetry vide) ou à
côté de vos voitures.

1. Repérez l'adresse IP de la borne dans votre box (elle est sur votre Wi-Fi),
   et fixez-lui une **adresse fixe**, pour qu'elle ne change pas.
2. Dans l'onglet **Configuration**, saisissez-la dans **Adresses des bornes
   Wall Connector** (plusieurs bornes : séparez-les par des virgules),
   enregistrez.
3. Cliquez sur **Tester les bornes Wall Connector** : chaque adresse affiche la
   fin du numéro de série de la borne, son firmware et son état, ou pourquoi
   elle ne répond pas.
4. Ajoutez la borne depuis l'onglet **Découverte**.

La borne est identifiée par son numéro de série : si son adresse IP change,
saisissez la nouvelle, et le même appareil continue, avec son historique.

| Fonctionnalité             | Détails                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Connecteur                 | Disponible, occupé (une voiture est branchée), indisponible, en défaut             |
| État de charge             | En charge, véhicule connecté, en pause (voiture), inactif                          |
| Statut                     | L'état propre de la borne en toutes lettres (prête, négociation, charge terminée…) |
| Puissance de charge        | W                                                                                  |
| Énergie de la session      | kWh délivrés depuis le branchement de la voiture                                   |
| Énergie totale délivrée    | Index cumulé en kWh, pour le tableau de bord énergie de Gladys                     |
| Tension du réseau, courant | V, A                                                                               |
| Température de la poignée  | °C, ou °F sur une borne nord-américaine (ou selon le réglage **Unités**)           |

Elle est lue toutes les **15 secondes** (le compteur total toutes les minutes),
et seul ce qui change est envoyé à Gladys. Après trois lectures manquées de
suite, la borne apparaît injoignable.

L'index d'**énergie totale** est le compteur propre de la borne. Gladys en
calcule la consommation par demi-heure et son coût, et le range sous votre
compteur électrique principal : la borne apparaît comme un sous-compteur de
votre compteur principal. Ne cochez pas le compteur principal et la borne (ni
l'index maison du Powerwall) dans le même widget si vous voulez un total
juste.

La borne donne des tensions et des courants, pas la puissance : celle-ci est
calculée phase par phase (triphasé en Europe), ou comme tension × courant sur
une alimentation nord-américaine 240 V biphasée (reconnue à son réseau 60 Hz).

## Tableau de bord

Trois widgets (Gladys 5.1+), chacun réglé avec l'appareil qu'il affiche :

- **Véhicule Tesla** : batterie, autonomie, puissance de charge et température
  de l'habitacle en temps réel, l'état de la charge, de la clim, du
  verrouillage, du mode Sentinelle et de la connexion, et des boutons pour
  lancer ou arrêter la clim, lancer ou arrêter la charge (voiture branchée),
  verrouiller ou déverrouiller (le déverrouillage demande une confirmation).
- **Flux d'énergie Tesla** : solaire, maison, réseau et Powerwall en temps
  réel, les dernières 24 heures en courbe, l'état du réseau, le mode de
  fonctionnement, la réserve de secours et l'alerte tempête (Storm Watch).
- **Borne Tesla Wall Connector** : puissance de charge, énergie de la session et
  totale, courant, état de la borne, voiture branchée et durée de la session.
  Pas de bouton : l'API locale de la borne ne fait que lire.

## Scènes

Déclencheurs (chacun limitable à une voiture, une borne ou un site d'énergie) :

- **La Tesla a commencé à charger**, **Charge de la Tesla terminée**,
  **Tesla branchée**, **Tesla débranchée** — vus par la voiture, avec son
  niveau de batterie.
- **La Wall Connector a commencé à charger**, **Charge de la Wall Connector
  terminée**, **Wall Connector : voiture branchée**, **Wall Connector : voiture
  débranchée** — vus par la borne, avec l'énergie de la session en kWh. Ils
  fonctionnent sans Teslemetry ; avec une voiture suivie par Teslemetry, la
  voiture et la borne déclenchent chacune les leurs.
- **Coupure réseau (Powerwall)** et **Retour du réseau (Powerwall)** — avec la
  charge du Powerwall, et si la coupure est un passage volontaire hors réseau.

Action :

- **Régler la réserve du Powerwall** — par exemple 100 % quand une tempête est
  annoncée, puis retour à 20 %.

Toutes les fonctionnalités des voitures ci-dessus s'utilisent aussi dans les
scènes de la façon habituelle (« quand la batterie passe sous 30 % »,
« lancer la clim à 7 h 30 », « régler la limite de charge à 90 % »…).

## Fraîcheur des données et coûts Teslemetry

Ce qui suit reprend les règles publiées par Teslemetry (2026). **Elles n'ont pas
pu être mesurées sur un vrai compte pendant le développement** : pour connaître
vos propres coûts, l'intégration écrit une ligne dans ses logs à chaque appel
facturé, avec votre solde restant (`Teslemetry credits: … cost 1, balance 498`),
et **Tester la connexion** affiche le solde.

| Quoi                                                      | Quand                                                                            | Coût                                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Flux temps réel (voitures, Powerwall, totaux journaliers) | En continu, une seule connexion pour tout le compte                              | Inclus dans les abonnements, aucun crédit                                                                               |
| Lecture d'une voiture au démarrage                        | Une fois par voiture au lancement de l'intégration                               | Gratuite depuis le cache Teslemetry ; jusqu'à 2 crédits si la voiture est éveillée et son cache vieux de plus de 20 min |
| Lecture de secours d'une voiture                          | Voiture éveillée qui n'a rien envoyé pendant le délai choisi (30 min par défaut) | Idem. Jamais pour une voiture endormie, jamais pour une voiture qui envoie son flux                                     |
| Liste des véhicules, état du Powerwall                    | Toutes les 15 / 10 minutes, **seulement quand le flux est coupé**                | Gratuit a priori (appels de lecture, non vérifié)                                                                       |
| Commande (charge, clim, verrouillage, limite, réserve…)   | À votre demande                                                                  | 1 crédit ; si la voiture dort, elle est d'abord réveillée (environ 20 crédits de plus)                                  |

En pratique, avec une voiture qui envoie son flux, le coût propre de
l'intégration se limite aux commandes envoyées. L'enveloppe mensuelle de
Teslemetry est de 500 crédits par véhicule et par site d'énergie : environ 500
commandes à une voiture éveillée, ou environ 24 à une voiture endormie. Gladys
acquitte une commande au bout de 4 secondes même si la voiture se réveille
encore ; la commande continue et son résultat s'affiche quand la voiture répond.

## Limites

- Développée sans voiture, sans Powerwall et sans compte Teslemetry (voir plus
  haut).
- Pas de position, de navigation, de coffre, de fenêtres ni de sièges chauffants
  dans cette version.
- Gladys n'a pas de puissance de batterie signée : celle du Powerwall est
  séparée en « charge » et « décharge ». La réserve de secours n'a pas non plus
  de fonctionnalité d'appareil : elle s'affiche dans le widget énergie et se
  règle par l'action de scène.
- Les voitures anciennes sans Fleet Telemetry ne sont rafraîchies que depuis le
  cache de Teslemetry (toutes les 30 ou 60 minutes quand elles sont éveillées).
- Les noms des fonctionnalités sont fixés à la création de l'appareil et ne
  suivent pas un changement de langue ultérieur.
- La Wall Connector est en lecture seule : son API locale ne lance, n'arrête ni
  ne limite une charge (faites-le depuis la voiture). Seule la gen 3 a cette API
  locale ; la gen 2 et l'Universal Wall Connector ne sont pas prises en charge.
  Développée sans borne : le calcul de la puissance et les états attendent une
  vérification sur le terrain.

## Dépannage

- **« Teslemetry a refusé le jeton d'accès »** : le jeton est mal recopié,
  révoqué ou expiré. Créez-en un nouveau dans la console Teslemetry.
- **« Un abonnement est nécessaire »** : la voiture ou le site n'a pas
  d'abonnement Teslemetry actif.
- **Une commande échoue avec « vehicle unavailable »** : la voiture n'a pas de
  réseau, ou la clé virtuelle n'y est pas installée.
- **Les valeurs de la voiture ne changent que toutes les 30 minutes** : la
  voiture n'envoie pas de flux. Vérifiez dans la console Teslemetry que le flux
  est activé pour elle, et que son logiciel est à jour.
- **Une Wall Connector ne répond pas** : vérifiez son adresse IP dans votre box
  et qu'elle est bien sur le Wi-Fi ; cliquez sur **Tester les bornes Wall
  Connector**. Gladys doit être sur le même réseau.
- L'intégration journalise tout ce qu'elle fait : ouvrez ses logs depuis
  l'interface de Gladys, avec `LOG_LEVEL=debug` pour le détail complet. Les
  jetons ne sont jamais journalisés.
