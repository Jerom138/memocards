# MemoCards

Petit site de révision par cartes recto/verso (flashcards), **100 % statique** :
pas de serveur, pas de base de données, pas de framework, pas d'étape de build.

**Un jeu de cartes = un fichier SVG.** Tout ce que l'application doit savoir tient
dans le nom du fichier et dans ses dimensions.

La progression est enregistrée dans le navigateur (`localStorage`) : aucun compte,
aucune donnée envoyée ailleurs.

## Sommaire

- [Lancer le site en local](#lancer-le-site-en-local)
- [Publier sur GitHub Pages](#publier-sur-github-pages)
- [Ajouter un nouveau jeu de cartes](#ajouter-un-nouveau-jeu-de-cartes)
- [Nommer le fichier](#nommer-le-fichier)
- [Dessiner le SVG](#dessiner-le-svg)
- [Les trois modes de révision](#les-trois-modes-de-révision)
- [Progression et données enregistrées](#progression-et-données-enregistrées)
- [Structure du projet](#structure-du-projet)

## Lancer le site en local

Depuis la racine du projet, au choix :

```bash
npx serve
```

```bash
python -m http.server 8000
```

```bash
php -S localhost:8000
```

puis ouvrir l'adresse affichée (par exemple <http://localhost:8000>).

> **Un serveur est nécessaire.** `decks.txt` et les fichiers SVG sont chargés avec
> `fetch`. En ouvrant `index.html` directement (adresse en `file://`), les
> navigateurs bloquent ces requêtes : la page affiche alors un message qui renvoie
> vers ce README.
>
> Ce n'est pas une contrainte de traitement côté serveur : n'importe quel serveur
> de fichiers statiques convient, y compris GitHub Pages.

## Publier sur GitHub Pages

1. Pousser le dépôt sur GitHub.
2. *Settings* → *Pages* → *Source* : `Deploy from a branch`, branche `main`, dossier `/ (root)`.
3. Le site est disponible sur `https://<utilisateur>.github.io/<dépôt>/`.

Tous les chemins du code sont **relatifs** (`./decks/...`), le site fonctionne donc
aussi bien à la racine d'un domaine que dans un sous-répertoire.

Après une mise à jour, le CDN de GitHub peut servir l'ancienne version quelques
minutes ; un rechargement forcé (`Ctrl+Maj+R`) suffit généralement.

## Ajouter un nouveau jeu de cartes

Deux gestes.

### 1. Déposer le fichier SVG dans `decks/`

```text
decks/Verrerie de laboratoire_NoBothDir.svg
```

### 2. Ajouter son nom dans `decks.txt`

```text
Démonstration_NoBothDir.svg
Anglais_les_couleurs_BothDir.svg
Verrerie de laboratoire_NoBothDir.svg
```

C'est tout : ni dossier à créer, ni fichier de configuration à écrire.
Recharger la page, le jeu apparaît.

> **Pourquoi `decks.txt` est-il nécessaire ?** Un navigateur ne peut pas lister le
> contenu d'un dossier : GitHub Pages ne sert aucun index de répertoire. Le site ne
> peut donc pas deviner quels fichiers existent, il faut les lui nommer.
> Ce fichier ne contient rien d'autre que des noms de fichiers ; les lignes vides
> et les lignes commençant par `#` sont ignorées.

**L'ordre des lignes de `decks.txt` est l'ordre d'affichage sur l'accueil.**
Pour mettre un jeu en avant, remonter sa ligne.

## Nommer le fichier

Le nom du fichier porte les deux seules métadonnées d'un jeu :

```text
Anglais_les_couleurs_BothDir.svg
└──────────┬─────────┘└────┬───┘
      nom affiché       sens de révision
```

| Suffixe | Effet |
|---|---|
| `_BothDir` | le jeu est interrogé **dans les deux sens** : tantôt recto → verso, tantôt verso → recto |
| `_NoBothDir` | toujours recto puis verso |
| *(aucun suffixe)* | comme `_NoBothDir` |

Le nom affiché est le reste du nom de fichier : suffixe et extension retirés, et
les `_` remplacés par des espaces. La casse du suffixe est indifférente.

| Fichier | Nom affiché | Deux sens |
|---|---|---|
| `Démonstration_NoBothDir.svg` | Démonstration | non |
| `Anglais_les_couleurs_BothDir.svg` | Anglais les couleurs | oui |
| `Verrerie de laboratoire.svg` | Verrerie de laboratoire | non |

Quelques précautions sur les noms :

- éviter `: / \ ? * " < > |` — interdits par Windows — ainsi que `#` et `%`,
  qui ont un sens particulier dans une adresse ;
- les accents et les espaces fonctionnent, en local comme en ligne ;
- **la casse compte** sur GitHub Pages, qui tourne sous Linux : un fichier
  `Verrerie.svg` déclaré `verrerie.svg` fonctionnera sous Windows et renverra une
  erreur 404 une fois publié ;
- deux jeux ne doivent pas porter le même nom : c'est lui qui identifie la
  progression enregistrée.

Renommer un fichier en changeant seulement son suffixe, ou déplacer sa ligne dans
`decks.txt`, conserve la progression. Changer le nom affiché la remet à zéro.

## Dessiner le SVG

Chaque jeu tient dans **un seul fichier SVG**, découpé à l'affichage par le CSS.
Aucune image à générer, aucun découpage à faire à la main.

Disposition : deux colonnes, une ligne par carte.

```text
┌───────────┬───────────┐
│  RECTO 1  │  VERSO 1  │
├───────────┼───────────┤
│  RECTO 2  │  VERSO 2  │
├───────────┼───────────┤
│  RECTO 3  │  VERSO 3  │
└───────────┴───────────┘
```

- colonne de gauche = recto (la question) ;
- colonne de droite = verso (la réponse) ;
- toutes les faces ont exactement la même taille.

**Une face fait 400 de haut.** C'est la seule dimension imposée : l'application
en déduit le nombre de cartes.

```text
hauteur du SVG = 400 × nombre de cartes     (obligatoire)
largeur du SVG = 2 × largeur d'une face     (600 recommandé, soit 1200)
```

Un SVG de **1200 × 4000** contient donc 10 cartes de 600 × 400. Une hauteur qui
n'est pas un multiple de 400 est signalée comme une erreur sur l'accueil.

Le SVG doit déclarer ses dimensions, par des attributs `width` et `height` ou par
un `viewBox`.

*(La hauteur de référence est la constante `CARD_HEIGHT` en tête de `app.js`, à
changer là si 400 ne convient pas.)*

### Exemple minimal : 2 cartes → SVG de 1200 × 800

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="1200" height="800" viewBox="0 0 1200 800">

  <style>
    text {
      font-family: system-ui, sans-serif;
      text-anchor: middle;
      dominant-baseline: central;
      font-size: 100px;
    }
  </style>

  <!-- Fonds : recto blanc, verso teinté -->
  <rect x="0"   y="0" width="600" height="800" fill="#ffffff"/>
  <rect x="600" y="0" width="600" height="800" fill="#eef2ff"/>

  <!-- Carte 1 : le groupe n'est pas décalé -->
  <g transform="translate(0,0)">
    <text x="300" y="200">1 + 1</text>
    <text x="900" y="200">2</text>
  </g>

  <!-- Carte 2 : le groupe est décalé de 400 -->
  <g transform="translate(0,400)">
    <text x="300" y="200">2 + 2</text>
    <text x="900" y="200">4</text>
  </g>

</svg>
```

Le décalage de la carte *n* (à partir de 1) vaut `(n - 1) × 400`. À l'intérieur
d'un groupe, le centre du recto est en `(300, 200)` et celui du verso en `(900, 200)`.

`decks/Démonstration_NoBothDir.svg` est un exemple complet à copier.

Quelques conseils :

- garder du texte SVG plutôt que des images matricielles : la carte reste nette
  sur tous les écrans, le fichier reste léger, et l'accueil se charge vite —
  il lit tous les SVG au démarrage pour compter les cartes ;
- prévoir une marge intérieure : les bords de la carte sont arrondis à l'affichage ;
- pour un jeu en deux sens, indiquer la langue ou la nature de chaque face
  directement dans le dessin, comme le fait `Anglais_les_couleurs_BothDir.svg` ;
- une police déclarée dans le SVG doit être installée sur l'appareil : préférer
  `system-ui, sans-serif`, ou convertir le texte en tracés.

## Les trois modes de révision

Chaque mode se lance depuis l'accueil.

| Mode | Déroulement | Fin de session |
|------|-------------|----------------|
| **Révision** | Toutes les cartes une fois, dans un ordre aléatoire. Une carte ratée revient quelques cartes plus loin, jusqu'à être sue. | Quand toutes les cartes sont sues → bilan. |
| **Apprentissage** | Tirage aléatoire pondéré : les cartes en difficulté reviennent beaucoup plus souvent, les cartes acquises restent présentes. Sans fin. | On quitte quand on veut, la progression est enregistrée au fur et à mesure. |
| **Test** | Chaque carte exactement une fois, aucune répétition. | Bilan chiffré et liste des cartes à retravailler. |

Poids utilisés en mode apprentissage :

| Situation de la carte | Poids |
|-----------------------|-------|
| Acquise               | 1 |
| En cours d'acquisition | 2 |
| Jamais vue            | 3 |
| Fragile (une erreur non rattrapée) | 4 |
| À retravailler (plusieurs erreurs) | 6 |

Une carte n'est jamais tirée deux fois de suite.

### Commandes

- **Clic ou appui sur la carte**, ou bouton *Retourner* : retourner la carte.
- **Espace** : retourner la carte.
- **Flèche droite** : retourner la carte, puis *Je savais*.
- **Flèche gauche** : *Je ne savais pas*.
- **Échap** : revenir à l'accueil.

Les boutons *Je savais* / *Je ne savais pas* n'apparaissent qu'une fois la carte retournée.

## Progression et données enregistrées

Pour chaque carte, l'application compte les bonnes et les mauvaises réponses,
dans la clé `memocards.progress.v1` de `localStorage` :

```json
{
  "Démonstration": {
    "1": { "success": 8, "failure": 2 },
    "2": { "success": 10, "failure": 0 }
  }
}
```

Le jeu est repéré par son nom affiché, la carte par son numéro de ligne dans le
SVG, à partir de 1.

Une carte est considérée **acquise** quand :

```text
success >= 3   ET   success >= failure × 2
```

et le pourcentage affiché sur l'accueil est le nombre de cartes acquises
divisé par le nombre total de cartes du jeu.

Cette règle est isolée dans les fonctions `isMastered()` et `deckMastery()`
de `app.js` : la remplacer ne demande de toucher à rien d'autre.

Le bouton **Réinitialiser ma progression**, sur la vignette d'un jeu, efface les
données de ce jeu uniquement, après confirmation. Les données étant propres au
navigateur, elles ne suivent pas d'un appareil à l'autre.

## Structure du projet

```text
/
├── index.html          structure des trois écrans (accueil, révision, bilan)
├── style.css           mise en forme, responsive, thème clair et sombre
├── app.js              toute la logique, sans dépendance
├── decks.txt           noms des fichiers SVG à afficher, dans l'ordre
├── .nojekyll           demande à GitHub Pages de publier les fichiers tels quels
└── decks/
    ├── Démonstration_NoBothDir.svg
    └── Anglais_les_couleurs_BothDir.svg
```

`app.js` est découpé en sections indépendantes :

| Section | Rôle |
|---------|------|
| `DeckRepository` | lecture de `decks.txt`, des noms de fichiers et des SVG |
| `ProgressStore`  | lecture/écriture de `localStorage` |
| `Mastery`        | règle de maîtrise d'une carte et d'un jeu |
| `WeightedRandom` | poids des cartes et tirage pondéré |
| `StudySession`   | déroulement des trois modes |
| `UI`             | rendu des écrans et interactions |

En cas de fichier manquant ou mal formé, le site affiche un message lisible
à la place du jeu concerné ; le détail technique est écrit dans la console
du navigateur (touche `F12`).
