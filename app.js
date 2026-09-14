/* ══════════════════════════════════════════════════════════════════════════
   MemoCards — application de révision par cartes recto/verso.

   100 % statique : aucun build, aucune dépendance, aucun backend.
   Un jeu de cartes tient dans un unique fichier SVG déposé dans decks/ et
   déclaré dans decks.txt ; son nom de fichier porte les métadonnées.

   Le fichier est découpé en sections indépendantes :

     Utilitaires      — petites fonctions génériques
     DeckRepository   — lecture de decks.txt et des fichiers SVG
     ProgressStore    — persistance localStorage
     Mastery          — règle de maîtrise d'une carte / d'un jeu
     WeightedRandom   — tirage aléatoire pondéré
     StudySession     — logique des trois modes de révision
     UI               — rendu et interactions
   ══════════════════════════════════════════════════════════════════════════ */

'use strict';

(function () {

  /* ════════════════════════════ Utilitaires ════════════════════════════ */

  const $ = (selector, root = document) => root.querySelector(selector);

  /** Mélange en place (Fisher-Yates) puis renvoie le tableau. */
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /** [0, 1, 2, ..., n-1] */
  const range = (n) => Array.from({ length: n }, (_, i) => i);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  /**
   * Récupère un fichier texte. `label` sert à composer un message d'erreur
   * lisible par l'utilisateur ; le détail technique part dans la console.
   */
  async function fetchText(url, label) {
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      console.error(`MemoCards : échec réseau sur ${url}`, error);
      throw new Error(
        `Impossible de charger ${label}. ` +
        `Si tu as ouvert le fichier directement (file://), lance plutôt un petit serveur local — voir le README.`
      );
    }
    if (!response.ok) {
      console.error(`MemoCards : HTTP ${response.status} sur ${url}`);
      throw new Error(`${capitalize(label)} est introuvable (erreur ${response.status}).`);
    }
    return response.text();
  }


  /* ═══════════════════════════ DeckRepository ═══════════════════════════ */
  /*  Un jeu = un seul fichier SVG dans decks/, dont le nom porte tout :

        Anglais_les_couleurs_BothDir.svg
        └────────┬───────────┘└───┬───┘
              nom affiché      les deux sens sont possibles

      Le reste se déduit du fichier lui-même : une face fait CARD_HEIGHT de
      haut, le SVG a deux colonnes et une ligne par carte, donc

        nombre de cartes   = hauteur du SVG / CARD_HEIGHT
        largeur d'une face = largeur du SVG / 2

      Tous les chemins sont relatifs (./) pour rester valides quand le site
      est publié dans un sous-répertoire, par exemple sur GitHub Pages.      */

  /** Hauteur d'une face, en unités SVG. Seule dimension imposée aux jeux. */
  const CARD_HEIGHT = 400;

  const DeckRepository = (function () {

    /** Nom affiché et sens de révision, lus dans le nom du fichier. */
    function parseFileName(fileName) {
      const bare = fileName.replace(/\.svg$/i, '');
      const suffix = bare.match(/_(no)?bothdir$/i);

      const name = bare
        .slice(0, suffix ? suffix.index : bare.length)
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        name: name || bare,
        bothDirections: Boolean(suffix) && !suffix[1],
      };
    }

    /** Dimensions déclarées par le SVG : attributs width/height, sinon viewBox. */
    function readSvgSize(svgText, fileName) {
      const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = parsed.documentElement;

      if (!root || root.tagName.toLowerCase() !== 'svg') {
        throw new Error(`Le fichier « ${fileName} » n'est pas une image SVG lisible.`);
      }

      const viewBox = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      const width = parseFloat(root.getAttribute('width')) || viewBox[2];
      const height = parseFloat(root.getAttribute('height')) || viewBox[3];

      if (!(width > 0) || !(height > 0)) {
        throw new Error(
          `Le fichier « ${fileName} » doit déclarer ses dimensions, ` +
          `par des attributs width et height ou par un viewBox.`
        );
      }
      return { width, height };
    }

    return {
      /** Noms des fichiers SVG à afficher, dans l'ordre, lus dans decks.txt. */
      async listFiles() {
        const text = await fetchText('./decks.txt', 'la liste des jeux (decks.txt)');
        return text
          .replace(/^﻿/, '')          // marqueur ajouté par certains éditeurs
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== '' && !line.startsWith('#'));
      },

      /** Charge un jeu complet à partir de son seul fichier SVG. */
      async load(fileName) {
        const url = `./decks/${encodeURIComponent(fileName)}`;
        const svg = await fetchText(url, `le jeu « ${fileName} »`);
        const { width, height } = readSvgSize(svg, fileName);
        const { name, bothDirections } = parseFileName(fileName);

        const cards = height / CARD_HEIGHT;
        if (!Number.isInteger(cards) || cards < 1) {
          throw new Error(
            `La hauteur du SVG (${height}) doit être un multiple de ${CARD_HEIGHT}, ` +
            `à raison de ${CARD_HEIGHT} par carte.`
          );
        }

        return {
          id: name,        // clé de progression : survit à un changement de suffixe
          name,
          bothDirections,
          fileName,
          spriteUrl: url,
          cards,
          cardWidth: width / 2,
          cardHeight: CARD_HEIGHT,
        };
      },
    };
  })();


  /* ════════════════════════════ ProgressStore ═══════════════════════════ */
  /*  Forme stockée :
      { "Démonstration": { "1": { "success": 8, "failure": 2 }, ... }, ... }
      Le jeu est repéré par son nom, la carte par son numéro de ligne dans le
      SVG (à partir de 1) : lisible à l'œil nu, et facile à remplacer par un
      identifiant nommé plus tard.                                          */

  const ProgressStore = (function () {
    const STORAGE_KEY = 'memocards.progress.v1';
    let cache = null;

    function readAll() {
      if (cache) return cache;
      cache = {};
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cache = parsed;
      } catch (error) {
        console.error('MemoCards : progression illisible, on repart de zéro.', error);
      }
      return cache;
    }

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      } catch (error) {
        // Navigation privée, quota plein… : l'application reste utilisable,
        // seule la sauvegarde est perdue.
        console.error('MemoCards : impossible d\'enregistrer la progression.', error);
      }
    }

    return {
      cardKey: (cardIndex) => String(cardIndex + 1),

      /** Statistiques d'une carte, toujours sous la forme { success, failure }. */
      statsFor(deckId, cardIndex) {
        const stored = readAll()[deckId]?.[this.cardKey(cardIndex)];
        return {
          success: Number(stored?.success) || 0,
          failure: Number(stored?.failure) || 0,
        };
      },

      /** Enregistre une réponse et renvoie les statistiques mises à jour. */
      record(deckId, cardIndex, known) {
        const all = readAll();
        const deckProgress = all[deckId] || (all[deckId] = {});
        const key = this.cardKey(cardIndex);
        const stats = this.statsFor(deckId, cardIndex);

        if (known) stats.success += 1;
        else stats.failure += 1;

        deckProgress[key] = stats;
        persist();
        return stats;
      },

      hasProgress(deckId) {
        return Object.keys(readAll()[deckId] || {}).length > 0;
      },

      resetDeck(deckId) {
        delete readAll()[deckId];
        persist();
      },
    };
  })();


  /* ═══════════════════════════════ Mastery ══════════════════════════════ */
  /*  Règle volontairement simple, isolée ici pour être remplaçable.        */

  /** Une carte est acquise après 3 bonnes réponses, si elles dominent les erreurs. */
  function isMastered(stats) {
    return stats.success >= 3 && stats.success >= stats.failure * 2;
  }

  /** Part de cartes acquises dans un jeu, entre 0 et 1. */
  function deckMastery(deck) {
    if (deck.cards === 0) return 0;
    let mastered = 0;
    for (let i = 0; i < deck.cards; i++) {
      if (isMastered(ProgressStore.statsFor(deck.id, i))) mastered += 1;
    }
    return mastered / deck.cards;
  }

  const percent = (ratio) => Math.round(ratio * 100);


  /* ════════════════════════════ WeightedRandom ══════════════════════════ */

  /**
   * Poids de tirage en mode apprentissage : plus une carte est fragile,
   * plus elle revient souvent, sans jamais exclure les cartes acquises.
   */
  function cardWeight(stats) {
    if (stats.success === 0 && stats.failure === 0) return 3;  // jamais vue
    if (isMastered(stats)) return 1;                           // acquise
    const deficit = stats.failure - stats.success;
    if (deficit <= 0) return 2;   // en cours d'acquisition
    if (deficit === 1) return 4;  // fragile
    return 6;                     // à retravailler en priorité
  }

  /** Tire un élément de `items` selon `weights` (même longueur, poids > 0). */
  function pickWeighted(items, weights) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let ticket = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      ticket -= weights[i];
      if (ticket < 0) return items[i];
    }
    return items[items.length - 1];
  }


  /* ════════════════════════════ StudySession ════════════════════════════ */

  const MODES = {
    review: { key: 'review', label: 'Révision' },
    learn: { key: 'learn', label: 'Apprentissage' },
    test: { key: 'test', label: 'Test' },
  };

  /**
   * Une session de révision.
   *
   *  review — toutes les cartes une fois, en ordre aléatoire ;
   *           une carte ratée revient un peu plus loin jusqu'à être sue.
   *  learn  — sans fin, tirage pondéré par les difficultés passées.
   *  test   — toutes les cartes exactement une fois, puis bilan.
   */
  function createSession(deck, mode) {
    const total = deck.cards;
    const allIndexes = range(total);

    const state = {
      deck,
      mode,
      total,
      queue: mode === MODES.learn.key ? [] : shuffle(allIndexes.slice()),
      current: null,       // { index, reversed }
      lastIndex: -1,       // évite de tirer deux fois la même carte de suite
      answered: 0,
      correct: 0,
      cleared: 0,          // cartes définitivement validées (review)
      missed: new Set(),   // cartes ratées au moins une fois pendant la session
    };

    /** Choisit la prochaine carte, ou null si la session est terminée. */
    function next() {
      let index;

      if (mode === MODES.learn.key) {
        let candidates = allIndexes;
        if (total > 1) candidates = allIndexes.filter((i) => i !== state.lastIndex);
        const weights = candidates.map((i) => cardWeight(ProgressStore.statsFor(deck.id, i)));
        index = pickWeighted(candidates, weights);
      } else {
        if (state.queue.length === 0) {
          state.current = null;
          return null;
        }
        index = state.queue.shift();
      }

      state.lastIndex = index;
      state.current = {
        index,
        reversed: deck.bothDirections ? Math.random() < 0.5 : false,
      };
      return state.current;
    }

    /** Enregistre la réponse de l'utilisateur pour la carte courante. */
    function answer(known) {
      if (!state.current) return;
      const index = state.current.index;

      ProgressStore.record(deck.id, index, known);
      state.answered += 1;
      if (known) state.correct += 1;
      else state.missed.add(index);

      if (mode === MODES.review.key) {
        if (known) {
          state.cleared += 1;
        } else {
          // La carte ratée repasse trois à six cartes plus loin.
          const position = Math.min(state.queue.length, 3 + Math.floor(Math.random() * 4));
          state.queue.splice(position, 0, index);
        }
      }
    }

    /** Avancement affiché pendant la session. */
    function progress() {
      if (mode === MODES.learn.key) {
        const ratio = deckMastery(deck);
        return {
          ratio,
          text: `✓ ${state.correct} · ✕ ${state.answered - state.correct} — maîtrise du jeu : ${percent(ratio)} %`,
        };
      }
      const done = mode === MODES.test.key ? state.answered : state.cleared;
      return {
        ratio: total ? done / total : 0,
        text: `Carte ${Math.min(done + 1, total)} / ${total}`,
      };
    }

    /** Bilan de fin de session (modes révision et test). */
    function summary() {
      const missed = [...state.missed].sort((a, b) => a - b);
      const score = total - missed.length;
      return { total, score, ratio: total ? score / total : 0, missed };
    }

    return { state, next, answer, progress, summary };
  }


  /* ═════════════════════════════════ UI ═════════════════════════════════ */

  const el = {
    screens: {
      home: $('#screen-home'),
      session: $('#screen-session'),
      result: $('#screen-result'),
    },
    deckList: $('#deck-list'),
    homeStatus: $('#home-status'),
    deckTemplate: $('#tpl-deck'),

    sessionDeckName: $('#session-deck-name'),
    sessionMode: $('#session-mode'),
    progressText: $('#progress-text'),
    progressFill: $('#progress-fill'),
    directionBadge: $('#direction-badge'),
    card: $('#card'),
    cardFront: $('#card-front'),
    cardBack: $('#card-back'),
    btnFlip: $('#btn-flip'),
    answerButtons: $('#answer-buttons'),
    btnRight: $('#btn-right'),
    btnWrong: $('#btn-wrong'),
    btnQuit: $('#btn-quit'),

    resultScore: $('#result-score'),
    resultPercent: $('#result-percent'),
    resultMissed: $('#result-missed'),
    resultMissedList: $('#result-missed-list'),
    btnRestart: $('#btn-restart'),
    btnBackHome: $('#btn-back-home'),
  };

  /** État courant de l'écran de révision. */
  let session = null;
  let flipped = false;

  function showScreen(name) {
    for (const [key, node] of Object.entries(el.screens)) node.hidden = key !== name;
    window.scrollTo(0, 0);
  }

  /** Nom affiché d'une carte — point d'extension pour des libellés par carte. */
  function cardLabel(deck, index) {
    return `Carte ${index + 1}`;
  }


  /* ─────────────────────────────── Accueil ─────────────────────────────── */

  /** Jeux chargés au démarrage, réutilisés pour rafraîchir l'accueil. */
  let homeEntries = [];

  async function loadHome() {
    el.deckList.textContent = '';
    el.homeStatus.textContent = 'Chargement des jeux…';

    let fileNames;
    try {
      fileNames = await DeckRepository.listFiles();
    } catch (error) {
      el.homeStatus.textContent = error.message;
      return;
    }

    if (fileNames.length === 0) {
      el.homeStatus.textContent =
        'Aucun jeu déclaré dans decks.txt. Ajoute le nom d\'un fichier SVG du dossier decks/ pour commencer.';
      return;
    }

    homeEntries = await Promise.all(fileNames.map(async (fileName) => {
      try {
        return { fileName, deck: await DeckRepository.load(fileName) };
      } catch (error) {
        return { fileName, error };
      }
    }));

    el.homeStatus.textContent = '';
    renderHome();
  }

  function renderHome() {
    el.deckList.textContent = '';
    for (const entry of homeEntries) {
      el.deckList.append(entry.error ? renderBrokenDeck(entry) : renderDeck(entry.deck));
    }
  }

  function renderDeck(deck) {
    const node = el.deckTemplate.content.firstElementChild.cloneNode(true);
    const ratio = deckMastery(deck);

    $('.deck-name', node).textContent = deck.name;
    $('.deck-count', node).textContent =
      `${deck.cards} carte${deck.cards > 1 ? 's' : ''}${deck.bothDirections ? ' · dans les deux sens' : ''}`;
    $('.progress-fill', node).style.width = `${percent(ratio)}%`;
    $('.deck-progress-label', node).textContent = `${percent(ratio)} %`;
    $('.deck-progress', node).setAttribute('aria-label', `Progression : ${percent(ratio)} %`);

    for (const button of node.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-label', `${button.textContent} — ${deck.name}`);
      button.addEventListener('click', () => startSession(deck, button.dataset.mode));
    }

    const reset = $('.deck-reset', node);
    if (ProgressStore.hasProgress(deck.id)) {
      reset.addEventListener('click', () => {
        if (confirm(`Effacer toute la progression enregistrée pour « ${deck.name} » ?`)) {
          ProgressStore.resetDeck(deck.id);
          renderHome();
        }
      });
    } else {
      reset.hidden = true;
    }

    return node;
  }

  function renderBrokenDeck(entry) {
    const node = el.deckTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add('is-broken');
    $('.deck-name', node).textContent = entry.fileName;
    $('.deck-count', node).textContent = '';
    $('.deck-progress', node).remove();
    $('.deck-actions', node).remove();
    $('.deck-reset', node).remove();

    const message = document.createElement('p');
    message.className = 'deck-error';
    message.textContent = `Ce jeu n'a pas pu être chargé. ${entry.error.message}`;
    node.append(message);
    return node;
  }


  /* ─────────────────────────────── Session ─────────────────────────────── */

  function startSession(deck, modeKey) {
    const mode = MODES[modeKey] ? modeKey : MODES.review.key;
    session = createSession(deck, mode);

    el.sessionDeckName.textContent = deck.name;
    el.sessionMode.textContent = MODES[mode].label;
    document.documentElement.style.setProperty('--card-aspect', deck.cardWidth / deck.cardHeight);

    showScreen('session');
    showNextCard();
  }

  function showNextCard() {
    const card = session.next();
    if (!card) return finishSession();

    const deck = session.state.deck;

    // Reposition sans animation : la carte suivante apparaît toujours côté question.
    el.card.classList.add('no-anim');
    setFlipped(false);
    void el.card.offsetWidth;
    el.card.classList.remove('no-anim');

    // Face visible = la question, face cachée = la réponse.
    paintFace(el.cardFront, deck, card.index, card.reversed ? 'back' : 'front');
    paintFace(el.cardBack, deck, card.index, card.reversed ? 'front' : 'back');

    if (deck.bothDirections) {
      el.directionBadge.textContent = card.reversed ? 'Verso → Recto' : 'Recto → Verso';
      el.directionBadge.hidden = false;
    } else {
      el.directionBadge.hidden = true;
    }

    el.card.setAttribute(
      'aria-label',
      `${cardLabel(deck, card.index)} — question. Retourne la carte pour voir la réponse.`
    );

    updateProgress();
  }

  /**
   * Affiche une face du SVG dans un élément.
   * Le fichier contient 2 colonnes (recto | verso) et une ligne par carte :
   * on l'agrandit à 200 % × (100 × N) % puis on cadre la case voulue.
   */
  function paintFace(node, deck, cardIndex, side) {
    const rows = deck.cards;
    const x = side === 'front' ? 0 : 100;
    const y = rows > 1 ? (cardIndex / (rows - 1)) * 100 : 0;

    node.style.backgroundImage = `url("${deck.spriteUrl}")`;
    node.style.backgroundSize = `200% ${rows * 100}%`;
    node.style.backgroundPosition = `${x}% ${y}%`;
  }

  function setFlipped(value) {
    // Le bouton qui avait le focus va disparaître : on suit le fil au clavier.
    const focused = document.activeElement;
    const followFocus =
      focused === el.btnFlip || focused === el.btnRight || focused === el.btnWrong;

    flipped = value;
    el.card.classList.toggle('is-flipped', value);
    el.btnFlip.hidden = value;
    el.answerButtons.hidden = !value;

    if (value) {
      const { deck, current } = session.state;
      el.card.setAttribute('aria-label', `${cardLabel(deck, current.index)} — réponse.`);
    }

    if (followFocus) (value ? el.btnRight : el.btnFlip).focus({ preventScroll: true });
  }

  function toggleFlip() {
    if (!session || !session.state.current) return;
    setFlipped(!flipped);
  }

  function answerCard(known) {
    if (!session || !flipped) return;
    session.answer(known);
    updateProgress();
    showNextCard();
  }

  function updateProgress() {
    const { ratio, text } = session.progress();
    el.progressText.textContent = text;
    el.progressFill.style.width = `${clamp(percent(ratio), 0, 100)}%`;
  }

  function quitSession() {
    session = null;
    renderHome();       // la progression a pu changer
    showScreen('home');
  }


  /* ──────────────────────────────── Bilan ──────────────────────────────── */

  function finishSession() {
    const { deck } = session.state;
    const mode = session.state.mode;
    const { total, score, ratio, missed } = session.summary();

    el.resultScore.textContent = `${score} / ${total}`;
    el.resultPercent.textContent = `${percent(ratio)} %`;

    el.resultMissedList.textContent = '';
    if (missed.length > 0) {
      for (const index of missed) {
        const item = document.createElement('li');
        item.textContent = cardLabel(deck, index);
        el.resultMissedList.append(item);
      }
      el.resultMissed.hidden = false;
    } else {
      el.resultMissed.hidden = true;
    }

    el.btnRestart.onclick = () => startSession(deck, mode);
    renderHome();
    showScreen('result');
  }


  /* ───────────────────────────── Interactions ──────────────────────────── */

  el.card.addEventListener('click', toggleFlip);
  el.btnFlip.addEventListener('click', toggleFlip);
  el.btnRight.addEventListener('click', () => answerCard(true));
  el.btnWrong.addEventListener('click', () => answerCard(false));
  el.btnQuit.addEventListener('click', quitSession);
  el.btnBackHome.addEventListener('click', quitSession);

  document.addEventListener('keydown', (event) => {
    if (el.screens.session.hidden) return;
    if (event.repeat) return;  // une touche maintenue ne doit pas enchaîner les cartes

    // Laisse le clavier activer normalement le bouton qui a le focus.
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if (onButton && (event.key === ' ' || event.key === 'Enter')) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        toggleFlip();
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (flipped) answerCard(true);
        else toggleFlip();
        break;
      case 'ArrowLeft':
        if (flipped) {
          event.preventDefault();
          answerCard(false);
        }
        break;
      case 'Escape':
        quitSession();
        break;
    }
  });


  /* ──────────────────────────────── Départ ─────────────────────────────── */

  loadHome().catch((error) => {
    console.error('MemoCards : erreur inattendue au démarrage.', error);
    el.homeStatus.textContent = 'Une erreur inattendue est survenue au chargement. Détails dans la console du navigateur.';
  });

})();
