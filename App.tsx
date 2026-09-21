import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';

import {
  createPortal,
  flushSync,
} from 'react-dom';

import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  setDoc as firestoreSetDoc,
  updateDoc as firestoreUpdateDoc,
  deleteDoc as firestoreDeleteDoc,
  deleteField,
  writeBatch as firestoreWriteBatch,
} from 'firebase/firestore';

import {
  auth,
  db,
  googleProvider,
} from './firebase';

import {
  findTmdbMovie,
} from './tmdbEnrichment';

import './App.css';


const APP_VERSION = '1.585';


const GUEST_MODE =
  (() => {
    try {
      const currentUrl =
        new URL(
          window.location.href
        );

      const path =
        currentUrl.pathname
          .replace(/\/+$/, '')
          .toLowerCase();

      return (
        currentUrl.searchParams.get('guest') === '1' ||
        path === '/guest' ||
        path.endsWith('/guest') ||
        /(?:[?&#])guest=1(?:[&#]|$)/i.test(
          window.location.href
        )
      );
    } catch {
      return (
        /(?:[?&#])guest=1(?:[&#]|$)/i.test(
          window.location.href
        ) ||
        /\/guest(?:[/?#]|$)/i.test(
          window.location.href
        )
      );
    }
  })();

const guestWriteError = () =>
  Promise.reject(
    new Error('Mode invité — modification désactivée.')
  );

const setDoc: typeof firestoreSetDoc = ((
  ...args: Parameters<typeof firestoreSetDoc>
) =>
  GUEST_MODE
    ? guestWriteError()
    : (firestoreSetDoc as (...params: any[]) => any)(...args)
) as typeof firestoreSetDoc;

const updateDoc: typeof firestoreUpdateDoc = ((
  ...args: Parameters<typeof firestoreUpdateDoc>
) =>
  GUEST_MODE
    ? guestWriteError()
    : (firestoreUpdateDoc as (...params: any[]) => any)(...args)
) as typeof firestoreUpdateDoc;

const deleteDoc: typeof firestoreDeleteDoc = ((
  ...args: Parameters<typeof firestoreDeleteDoc>
) =>
  GUEST_MODE
    ? guestWriteError()
    : (firestoreDeleteDoc as (...params: any[]) => any)(...args)
) as typeof firestoreDeleteDoc;

const writeBatch: typeof firestoreWriteBatch = ((
  ...args: Parameters<typeof firestoreWriteBatch>
) => {
  if (!GUEST_MODE) {
    return (firestoreWriteBatch as (...params: any[]) => any)(...args);
  }

  const blockedBatch: any = {
    set() {
      return blockedBatch;
    },
    update() {
      return blockedBatch;
    },
    delete() {
      return blockedBatch;
    },
    commit() {
      return guestWriteError();
    },
  };

  return blockedBatch;
}) as typeof firestoreWriteBatch;


type Page =
  | 'topUS'
  | 'topFR'
  | 'soundtracks'
  | 'ucpm'
  | 'diary'
  | 'lp'
  | 'series'
  | 'jellyfin'
  | 'watchlist'
  | 'unrated'
  | 'search'
  | 'verify'
  | 'import';


type PosterSize =
  | 'huge'
  | 'large'
  | 'medium'
  | 'small'
  | 'mini';


type PosterFilter =
  | 'all'
  | 'fr'
  | 'none'
  | 'en'
  | 'other';


type TitleFilter =
  | 'all'
  | 'fr'
  | 'en'
  | 'original'
  | 'other';


type VerifyViewMode =
  | 'list'
  | 'slideshow';


type MovieSortMode =
  | 'ranking'
  | 'rating-desc'
  | 'rating-asc'
  | 'added-desc'
  | 'year-desc'
  | 'year-asc';


type AddTarget =
  | 'topUS'
  | 'topFR'
  | 'soundtracks'
  | 'ucpm'
  | 'diary'
  | 'series'
  | 'jellyfin'
  | 'watchlist';


type MultiSelectTarget =
  | 'topUS'
  | 'topFR'
  | 'diary'
  | 'watchlist'
  | 'jellyfin';




type UnratedQueueItem = {
  movie: SavedMovie;
  source: 'US' | 'FR' | 'UCPM' | 'VUS' | 'SERIES' | 'MOVIEDB';
  target: Exclude<AddTarget, 'diary'> | 'diary';
  diaryEntry: DiaryEntry | null;
};

type RankingInfo = {
  listName: string;
  position: number | null;
  description?: string;
};


type DiaryEntry = {
  entryDate?: string | null;
  watchedDate?: string | null;
  rating?: number | null;
  rewatch?: boolean;
  tags?: string[];
  letterboxdEntryUri?: string | null;
  insertedAt?: string | null;
  source?: 'letterboxd' | 'diaryCsv' | 'manual' | null;
};


type UcpmSixFilmsMembership = {
  groupId: string;
  number: number;
  itemOrder: number;
  groupOrder?: number | null;
};


type SavedMovie = {
  docId: string;

  tmdbId?: number | null;
  tmdbMediaType?: 'movie' | 'tv';

  title: string;

  localizedTitle?: string | null;

  customTitle?: string | null;
  customTitleLanguage?: string | null;

  tmdbTitle?: string | null;
  originalTitle?: string | null;

  year?: string | number | null;
  releaseDate?: string | null;

  /* Dates de création et d'entrée dans Movie Database.
     jellyfinAddedAt est distinct de addedAt : un vieux film peut être ajouté
     aujourd'hui à Movie Database et doit alors apparaître dans « Ajout + ». */
  addedAt?: unknown;
  jellyfinAddedAt?: unknown;

  posterPath?: string | null;

  customPosterPath?: string | null;
  customPosterLanguage?: string | null;
  customPosterUrl?: string | null;

  /* Soundtracks is an independent list: its title, rating and CD cover
     are deliberately stored separately from the movie fields. */
  soundtrackIndependent?: boolean;
  soundtrackTitle?: string | null;
  soundtrackRating?: number | null;
  soundtrackCoverPath?: string | null;
  soundtrackCoverUrl?: string | null;

  backdropPath?: string | null;

  overview?: string;

  rating?: number | null;
  review?: string | null;

  watched?: boolean;
  liked?: boolean;
  favorite?: boolean;
  watchlist?: boolean;
  watchlistDate?: string | null;
  /* Playlists personnalisées : un film peut appartenir à plusieurs playlists. */
  playlists?: string[];

  /* Masquage volontaire de la file « À NOTER ». Utilisé notamment quand
     une sélection multiple est rangée dans une autre liste. */
  unratedHidden?: boolean;

  favoriteProfileFilm?: boolean;

  rankings?: Record<
    string,
    RankingInfo
  >;

  diary?: DiaryEntry[];

  letterboxdFilmUri?: string | null;

  tmdbMatchStatus?:
    | 'matched'
    | 'not_found'
    | 'error'
    | null;

  ucpm?: boolean;
  ucpmPosition?: number | null;
  ucpmImdbId?: string | null;
  ucpmGroupId?: string | null;
  ucpmGroupLabel?: string | null;
  ucpmGroupOrder?: number | null;
  ucpmGroupExpectedCount?: number | null;
  ucpmGroupType?: 'podcast' | 'sixfilms' | null;
  ucpmGroupItemOrder?: number | null;
  /* Marqueur interne : permet de masquer durablement un ancien bloc
     « 6 films » sans supprimer la fiche du film ni ses autres usages UCPM. */
  ucpmSixFilmsHidden?: boolean;

  /* Depuis v1.21, les blocs « 6 films » sont des appartenances secondaires :
     un film peut rester dans son podcast UCPM et apparaître en même temps
     dans un ou plusieurs blocs 6 films sans écraser son groupe principal. */
  ucpmSixFilmsMemberships?: UcpmSixFilmsMembership[];
  /* Vrai uniquement lorsque l'entrée UCPM du film existe grâce aux blocs
     6 films et non à un podcast / import UCPM indépendant. */
  ucpmSixFilmsOnly?: boolean;
  /* Le document Movie Database a été créé à l'origine uniquement pour un
     bloc 6 films. Sert à savoir s'il peut être supprimé avec le dernier bloc. */
  ucpmSixFilmsCreatedOnly?: boolean;
  /* Visionnage VUS ajouté automatiquement lors d'un ajout UCPM / 6 films. */
  ucpmAutoVus?: boolean;
  ucpmAutoVusDate?: string | null;

  /* IMDb exact identity used for manual corrections from the movie menu. */
  imdbId?: string | null;

  [key: string]: unknown;
};


type TmdbMovie = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  poster_url?: string | null;
  backdrop_path?: string | null;
  overview?: string;
};


type UcpmComposerItem = {
  movie: TmdbMovie;
  rating: string;
  /* Quand l'item vient d'un bloc « 6 films » existant, on conserve le
     document Firestore exact afin que l'édition modifie la bonne fiche. */
  savedDocId?: string | null;
};


type ItunesAlbum = {
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
};


type MusicboardAlbumIdentity = {
  musicboardId: number | null;
  musicboardUrl: string | null;
  title: string;
  artist: string;
  artworkUrl: string | null;
  year: string | null;
  genre: string | null;
};


type SavedAlbum = {
  docId: string;
  title: string;
  artist: string;
  position?: number | null;
  sourcePosition?: number | null;
  rating?: number | null;
  year?: string | number | null;
  artworkUrl?: string | null;
  itunesCollectionId?: number | null;
  musicboardId?: number | null;
  musicboardUrl?: string | null;
  genre?: string | null;
  [key: string]: unknown;
};


type TmdbPoster = {
  file_path: string;
  iso_639_1: string | null;
  width: number;
  height: number;
  vote_average?: number;
  vote_count?: number;
};


type TmdbTranslation = {
  iso_3166_1: string;
  iso_639_1: string;
  name?: string;
  english_name?: string;

  data?: {
    title?: string;
    overview?: string;
    tagline?: string;
  };
};


type TitleOption = {
  title: string;

  language:
    | string
    | null;

  country:
    | string
    | null;

  label: string;

  kind:
    | 'translation'
    | 'original'
    | 'imported'
    | 'automatic';
};


type ImportMovie = {
  title: string;

  year?: number | null;

  letterboxdFilmUri?: string | null;

  watched?: boolean;
  watchedAddedDate?: string | null;

  rating?: number | null;
  ratingDate?: string | null;

  liked?: boolean;
  likedDate?: string | null;

  watchlist?: boolean;
  watchlistDate?: string | null;

  favoriteProfileFilm?: boolean;

  review?: string | null;
  reviewDate?: string | null;

  diary?: DiaryEntry[];

  rankings?: Record<
    string,
    RankingInfo
  >;
};


type LetterboxdImport = {
  format: string;
  movies: ImportMovie[];
};


type LetterboxdCsvKind =
  | 'diary'
  | 'ratings'
  | 'watched'
  | 'watchlist'
  | 'reviews'
  | 'generic';


type LetterboxdCsvMovie = {
  title: string;
  year?: number | null;
  letterboxdFilmUri?: string | null;
  date?: string | null;
  watchedDate?: string | null;
  rating?: number | null;
  rewatch?: boolean;
  review?: string | null;
  kind: LetterboxdCsvKind;
};


type UcpmCsvMovie = {
  position: number;
  title: string;
  year?: number | null;
  imdb?: string | null;
};


type JellyfinCsvMovie = {
  position: number;
  title: string;
  year?: number | null;
  imdb?: string | null;
  tmdbId?: number | null;
  sourceFile?: string | null;
};


type DiaryCsvEntry = {
  watchedDate: string;
  title: string;
  year?: number | null;
  rating?: number | null;
  rewatch?: boolean;
};


type EnrichmentStats = {
  current: number;
  total: number;
  matched: number;
  unmatched: number;
  errors: number;
  currentMovie: string;
};


type FrenchTitleStats = {
  current: number;
  total: number;
  updated: number;
  errors: number;
  currentMovie: string;
};


type DiaryDisplayEntry = {
  movie: SavedMovie;
  entry: DiaryEntry;
};


type PosterBackupSelection = {
  docId: string;
  posterPath: string | null;
  customPosterPath: string | null;
  customPosterLanguage: string | null;
  customPosterUrl: string | null;
  soundtrackCoverPath: string | null;
  soundtrackCoverUrl: string | null;
};


type MerlyBackup = {
  format: 'merlymoviesbox-backup';
  version: 1 | 2 | 3 | 4;
  createdAt: string;

  preferences: {
    posterSize: PosterSize;
  };

  movies: Array<
    Record<string, unknown>
  >;

  /* Version 2: manifest explicite des affiches/pochettes choisies.
     Les champs sont également présents dans movies, mais ce bloc permet
     de garantir leur restauration et de rendre la sauvegarde plus robuste. */
  posterSelections?: PosterBackupSelection[];

  /* Version 3 : albums LP. */
  albums?: Array<Record<string, unknown>>;
};


type HistoryCollectionName =
  | 'movies'
  | 'albums';


type HistoryDocumentSnapshot = {
  collection: HistoryCollectionName;
  docId: string;
  data: Record<string, unknown> | null;
};


type ActionHistoryEntry = {
  id: string;
  label: string;
  createdAt: number;
  snapshots: HistoryDocumentSnapshot[];
  fullCollections?: HistoryCollectionName[];
};


type UnratedNoteUndoEntry = {
  id: string;
  title: string;
  ratingKey: string;
  snapshotsPromise: Promise<HistoryDocumentSnapshot[]>;
  savePromise: Promise<boolean>;
};


function decodeBackupValue(
  value: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeBackupValue);
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    const objectValue =
      value as Record<string, unknown>;

    /* Backups v4 utilisent le même format typé que l'historique. */
    if (
      objectValue.__mmbType === 'timestamp' ||
      objectValue.__mmbType === 'date'
    ) {
      return decodeHistoryValue(objectValue);
    }

    /* Compatibilité avec les anciens JSON Firebase qui sérialisaient
       Timestamp sous forme d'objet au lieu de conserver la classe. */
    const seconds =
      objectValue.seconds ??
      objectValue._seconds;
    const nanoseconds =
      objectValue.nanoseconds ??
      objectValue._nanoseconds;
    const firestoreTimestampType =
      objectValue.type === 'firestore/timestamp/1.0';
    const timestampShapeOnly =
      Object.keys(objectValue).every((key) =>
        [
          'seconds',
          'nanoseconds',
          '_seconds',
          '_nanoseconds',
          'type',
        ].includes(key)
      );

    if (
      (firestoreTimestampType || timestampShapeOnly) &&
      typeof seconds === 'number' &&
      typeof nanoseconds === 'number'
    ) {
      return new Timestamp(
        seconds,
        nanoseconds
      );
    }

    return Object.fromEntries(
      Object.entries(objectValue).map(
        ([key, child]) => [
          key,
          decodeBackupValue(child),
        ]
      )
    );
  }

  return value;
}


const ACTION_HISTORY_RETENTION_MS =
  7 * 24 * 60 * 60 * 1000;

const ACTION_HISTORY_DB =
  'merylmoviesbox-action-history';

const ACTION_HISTORY_STORE =
  'history';


function encodeHistoryValue(
  value: unknown
): unknown {
  if (value instanceof Timestamp) {
    return {
      __mmbType: 'timestamp',
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }

  if (value instanceof Date) {
    return {
      __mmbType: 'date',
      value: value.toISOString(),
    };
  }

  if (Array.isArray(value)) {
    return value.map(encodeHistoryValue);
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<string, unknown>
      ).map(([key, child]) => [
        key,
        encodeHistoryValue(child),
      ])
    );
  }

  return value;
}


function decodeHistoryValue(
  value: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeHistoryValue);
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    const objectValue =
      value as Record<string, unknown>;

    if (objectValue.__mmbType === 'timestamp') {
      return new Timestamp(
        Number(objectValue.seconds) || 0,
        Number(objectValue.nanoseconds) || 0
      );
    }

    if (objectValue.__mmbType === 'date') {
      return new Date(
        String(objectValue.value || '')
      );
    }

    return Object.fromEntries(
      Object.entries(objectValue).map(
        ([key, child]) => [
          key,
          decodeHistoryValue(child),
        ]
      )
    );
  }

  return value;
}


function openActionHistoryDb() {
  return new Promise<IDBDatabase>(
    (resolve, reject) => {
      const request =
        window.indexedDB.open(
          ACTION_HISTORY_DB,
          1
        );

      request.onupgradeneeded = () => {
        const database = request.result;
        if (
          !database.objectStoreNames.contains(
            ACTION_HISTORY_STORE
          )
        ) {
          database.createObjectStore(
            ACTION_HISTORY_STORE
          );
        }
      };

      request.onsuccess = () =>
        resolve(request.result);
      request.onerror = () =>
        reject(request.error);
    }
  );
}


async function loadStoredActionHistory() {
  try {
    const database = await openActionHistoryDb();
    const stored = await new Promise<unknown>(
      (resolve, reject) => {
        const transaction = database.transaction(
          ACTION_HISTORY_STORE,
          'readonly'
        );
        const request = transaction
          .objectStore(ACTION_HISTORY_STORE)
          .get('entries');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    database.close();

    const decoded =
      decodeHistoryValue(stored);

    if (!Array.isArray(decoded)) {
      return [] as ActionHistoryEntry[];
    }

    const cutoff =
      Date.now() - ACTION_HISTORY_RETENTION_MS;

    return (decoded as ActionHistoryEntry[])
      .filter(
        (entry) =>
          Number(entry.createdAt) >= cutoff
      )
      .slice(0, 20);
  } catch (error) {
    console.error('Historique : lecture impossible', error);
    return [] as ActionHistoryEntry[];
  }
}


async function saveStoredActionHistory(
  entries: ActionHistoryEntry[]
) {
  try {
    const database = await openActionHistoryDb();
    await new Promise<void>(
      (resolve, reject) => {
        const transaction = database.transaction(
          ACTION_HISTORY_STORE,
          'readwrite'
        );
        transaction.objectStore(ACTION_HISTORY_STORE).put(
          encodeHistoryValue(entries),
          'entries'
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      }
    );
    database.close();
  } catch (error) {
    console.error('Historique : sauvegarde impossible', error);
  }
}


/*
 * v1.535 : cache ultra-léger de la page d'accueil. On ne mémorise que les
 * films TOP US, donc la lecture reste rapide et ne duplique pas toute la
 * Movie Database. Le snapshot Firestore complet reprend ensuite la main.
 */
const STARTUP_MOVIES_CACHE_PREFIX =
  'startup-top-us:';


async function loadStoredStartupMovies(
  userId: string
) {
  try {
    const database = await openActionHistoryDb();
    const stored = await new Promise<unknown>(
      (resolve, reject) => {
        const transaction = database.transaction(
          ACTION_HISTORY_STORE,
          'readonly'
        );
        const request = transaction
          .objectStore(ACTION_HISTORY_STORE)
          .get(
            `${STARTUP_MOVIES_CACHE_PREFIX}${userId}`
          );
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    database.close();

    const decoded = decodeHistoryValue(stored);

    return Array.isArray(decoded)
      ? (decoded as SavedMovie[])
      : null;
  } catch (error) {
    console.error('Cache démarrage : lecture impossible', error);
    return null;
  }
}


async function saveStoredStartupMovies(
  userId: string,
  movies: SavedMovie[]
) {
  if (movies.length === 0) {
    return;
  }

  try {
    const database = await openActionHistoryDb();
    await new Promise<void>(
      (resolve, reject) => {
        const transaction = database.transaction(
          ACTION_HISTORY_STORE,
          'readwrite'
        );
        transaction.objectStore(ACTION_HISTORY_STORE).put(
          encodeHistoryValue(movies),
          `${STARTUP_MOVIES_CACHE_PREFIX}${userId}`
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      }
    );
    database.close();
  } catch (error) {
    console.error('Cache démarrage : sauvegarde impossible', error);
  }
}


const posterSizeLabels:
  Record<
    PosterSize,
    string
  > = {
    huge: 'Très grand',
    large: 'Grand',
    medium: 'Moyen',
    small: 'Petit',
    mini: 'Mini',
  };


function formatRating(
  value: number | string | null | undefined
) {
  if (
    value == null ||
    value === ''
  ) {
    return '';
  }

  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return '';
  }

  return numericValue
    .toFixed(2)
    .replace('.', ',');
}


function sanitizeRatingDraft(
  value: string
) {
  const canonical = value
    .replace('.', ',')
    .replace(/[^0-9,]/g, '');

  const commaIndex = canonical.indexOf(',');
  const integerPart = (
    commaIndex >= 0
      ? canonical.slice(0, commaIndex)
      : canonical
  ).slice(0, 1);

  if (commaIndex < 0) {
    return integerPart;
  }

  const decimalPart = canonical
    .slice(commaIndex + 1)
    .replace(/,/g, '')
    .slice(0, 2);

  return `${integerPart || '0'},${decimalPart}`
    .slice(0, 4);
}


function normalizeTitle(
  value: string
) {
  return value
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .replace(
      /[’']/g,
      ''
    )
    .replace(
      /[^a-zA-Z0-9]+/g,
      ' '
    )
    .trim()
    .toLowerCase();
}


/*
 * Nettoyage des titres de films importés depuis des noms de fichiers /
 * médiathèques. Les marqueurs techniques ne font jamais partie de
 * l'identité d'un film : « Film 4K », « Film HD » et
 * « Film - Director's Cut » doivent donc tous correspondre à « Film ».
 *
 * Le nettoyage est volontairement ancré sur des marqueurs de diffusion,
 * qualité, codec ou édition. On ne supprime pas un morceau arbitraire d'un
 * vrai titre.
 */
const MOVIE_TITLE_NOISE = String.raw`(?:4k|uhd|ultra[\s._-]*hd|fhd|full[\s._-]*hd|hd|sd|2160p|1440p|1080p|1080i|720p|576p|480p|blu[\s._-]*ray|bluray|bdrip|brrip|br[\s._-]*rip|dvd(?:rip)?|dvdrip|web[\s._-]*dl|webrip|web[\s._-]*rip|hdtv|remux|x264|x265|h[\s._-]*264|h[\s._-]*265|hevc|av1|xvid|divx|hdr10\+?|hdr|dolby[\s._-]*vision|10[\s._-]*bit|8[\s._-]*bit|atmos|true[\s._-]*hd|dts(?:[\s._-]*hd)?|eac3|ac3|aac|multi|multilang(?:uage)?|vostfr|vff|vfq|proper|repack|remastered|restored|director[’']?s[\s._-]*cut|directors[\s._-]*cut|extended[\s._-]*(?:cut|edition)|special[\s._-]*edition|collector[’']?s[\s._-]*edition|ultimate[\s._-]*edition|theatrical[\s._-]*cut|unrated|imax|open[\s._-]*matte|criterion(?:[\s._-]*collection)?|anniversary[\s._-]*edition|limited[\s._-]*edition|steelbook|uncut|dual[\s._-]*audio)`;

const MOVIE_TITLE_NOISE_REGEX = new RegExp(
  `(?:^|[-\\s._–—/|])(${MOVIE_TITLE_NOISE})(?=$|[-\\s._–—/|])`,
  'i'
);

function sanitizeMovieTitle(
  value: string,
  yearHint?: string | number | null
) {
  const original = String(value || '').trim();

  if (!original) {
    return '';
  }

  let cleaned = original
    .replace(/\.(?:mkv|mp4|avi|mov|m4v|wmv|iso)$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /* Enlève d'abord les blocs techniques explicites : [4K], (BluRay), etc. */
  cleaned = cleaned.replace(
    /\s*[\[({]([^\])}]+)[\])}]\s*/g,
    (full, inner: string) =>
      MOVIE_TITLE_NOISE_REGEX.test(` ${inner} `)
        ? ' '
        : full
  );

  /* Dès qu'un marqueur technique apparaît après le vrai titre, tout ce qui
     suit appartient généralement au nom de fichier / à l'édition. */
  const hadTechnicalNoise = MOVIE_TITLE_NOISE_REGEX.test(cleaned);
  const noiseMatch = MOVIE_TITLE_NOISE_REGEX.exec(cleaned);

  if (noiseMatch) {
    if ((noiseMatch.index || 0) > 0) {
      cleaned = cleaned.slice(0, noiseMatch.index);
    } else {
      const withoutPrefix = cleaned
        .slice(noiseMatch[0].length)
        .replace(/^[-\s._–—/|]+/, '')
        .trim();

      if (withoutPrefix) {
        cleaned = withoutPrefix;
      }
    }
  }

  const year = String(yearHint || '').match(/(?:19|20)\d{2}/)?.[0] || '';

  if (year) {
    const yearSuffix = new RegExp(
      `(?:[-\\s._–—/|]+|\\()${year}(?:\\))?$`,
      'i'
    );
    const withoutYear = cleaned.replace(yearSuffix, '').trim();

    /* Ne transforme jamais un titre qui est lui-même une année, ex. « 1917 ». */
    if (withoutYear) {
      cleaned = withoutYear;
    }
  }

  if (hadTechnicalNoise) {
    cleaned = cleaned.replace(/[.]+/g, ' ');
  }

  cleaned = cleaned
    .replace(/[-\s._–—/|]+$/g, '')
    .replace(/^[-\s._–—/|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || original;
}

function normalizeMovieTitle(
  value: string,
  yearHint?: string | number | null
) {
  return normalizeTitle(
    sanitizeMovieTitle(value, yearHint)
  );
}


function dedupeImportedMovieRows<
  T extends {
    title: string;
    year?: number | null;
    imdb?: string | null;
    tmdbId?: number | null;
  }
>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = item.tmdbId
      ? `tmdb:${item.tmdbId}`
      : item.imdb
      ? `imdb:${String(item.imdb).toLowerCase()}`
      : `title:${normalizeMovieTitle(
          item.title,
          item.year
        )}|${String(item.year || '')}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}


const LOOSE_TITLE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'and', 'in', 'on', 'for', 'with',
  'part', 'chapter', 'episode',
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'en',
  'au', 'aux', 'sur', 'pour', 'avec', 'vers',
]);


const LOOSE_ROMAN_NUMERALS: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};


function getLooseTitleTokens(
  value: string
) {
  const tokens =
    normalizeMovieTitle(value)
      .split(' ')
      .map((token) => LOOSE_ROMAN_NUMERALS[token] || token)
      .filter(Boolean)
      .filter((token) => !LOOSE_TITLE_STOP_WORDS.has(token))
      .map((token) => {
        if (/^\d+$/.test(token)) {
          return token;
        }

        let stem = token;

        /* Petit rapprochement FR/EN utile pour des titres comme
           « futur » / « future » sans transformer le titre en traduction. */
        if (stem.length >= 5 && stem.endsWith('e')) {
          stem = stem.slice(0, -1);
        }

        if (stem.length >= 5 && stem.endsWith('s')) {
          stem = stem.slice(0, -1);
        }

        return stem;
      })
      .filter((token) => token.length >= 2 || /^\d+$/.test(token));

  return new Set(tokens);
}


function looseTitleSimilarity(
  left: string,
  right: string
) {
  const a = getLooseTitleTokens(left);
  const b = getLooseTitleTokens(right);

  if (!a.size || !b.size) {
    return 0;
  }

  const numbersA = new Set(
    Array.from(a).filter((token) => /^\d+$/.test(token))
  );
  const numbersB = new Set(
    Array.from(b).filter((token) => /^\d+$/.test(token))
  );

  if (numbersA.size && numbersB.size) {
    const sameNumber =
      Array.from(numbersA).some((token) => numbersB.has(token));

    if (!sameNumber) {
      return 0;
    }
  }

  let common = 0;

  for (const token of a) {
    if (b.has(token)) {
      common += 1;
    }
  }

  if (!common) {
    return 0;
  }

  const containment = common / Math.min(a.size, b.size);
  const union = new Set([...a, ...b]).size;
  const jaccard = union ? common / union : 0;

  let score = containment * 0.65 + jaccard * 0.35;

  if (numbersA.size && numbersB.size) {
    score += 0.15;
  }

  return Math.min(1, score);
}


function normalizeHeader(
  value: string
) {
  return value
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ''
    );
}


type UcpmPodcastGroup = {
  id?: string;
  label: string;
  start: number;
  end: number;
  order: number;
  expectedCount?: number | null;
  kind?: 'podcast' | 'sixfilms' | 'legacy';
};

const UCPM_LEGACY_SIX_FILMS_START = 865;
const UCPM_LEGACY_SIX_FILMS_END = 888;

const UCPM_LEGACY_SIX_FILMS_TITLES: Record<number, string[][]> = {
  1: [
    ['Sometimes I Think About Dying'],
    ['Yannick'],
    ['Sans pitié', 'Sans pitie'],
    ['Mystic River'],
    ['Collateral'],
    ['Danse avec les loups'],
  ],
  2: [
    ['Rain Man'],
    ['Dream Scenario'],
    ['Kickboxer'],
    ["L’échange", "L'echange", 'The Changeling'],
    ['Le rituel', 'The Ritual'],
    ['Dirty Dancing'],
  ],
  3: [
    ['Emily the Criminal'],
    ['Mad Dog and Glory'],
    ['Jungle'],
    ['Le jeu', 'Nothing to Hide'],
    ['Freaks'],
    ['Ghostbusters 2', 'Ghostbusters II'],
  ],
  4: [
    ['Liaison fatale', 'Fatal Attraction'],
    ['Hot Spot', 'The Hot Spot'],
    ['Woman of the Hour'],
    ["Harley Davidson et l’homme aux santiags", "Harley Davidson et l'homme aux santiags", "H-Davidson et l’homme aux santiags", "H-Davidson et l'homme aux santiags"],
    ['Sorgoï Prakov', 'Sorgoi Prakov', 'Sorgoï Prokov', 'Sorgoi Prokov', 'Sorgoï Prakov, My European Dream', 'Sorgoi Prakov, My European Dream', 'Descent Into Darkness'],
    ["La couleur de l’argent", "La couleur de l'argent", 'The Color of Money'],
  ],
};
const UCPM_LEGACY_SIX_FILMS_SIZE = 6;

const UCPM_PODCAST_GROUPS: UcpmPodcastGroup[] = [
  { label: "#50’s", start: 1, end: 4, order: 0 },
  { label: "#60’s", start: 5, end: 12, order: 1 },
  { label: "#68", start: 13, end: 17, order: 2 },
  { label: "#69", start: 18, end: 26, order: 3 },
  { label: "#70", start: 27, end: 31, order: 4 },
  { label: "#71", start: 32, end: 39, order: 5 },
  { label: "#72", start: 40, end: 51, order: 6 },
  { label: "#73", start: 52, end: 60, order: 7 },
  { label: "#74", start: 61, end: 72, order: 8 },
  { label: "#75", start: 73, end: 84, order: 9 },
  { label: "#76", start: 85, end: 102, order: 10 },
  { label: "#77", start: 103, end: 112, order: 11 },
  { label: "#78", start: 113, end: 124, order: 12 },
  { label: "#79", start: 125, end: 142, order: 13 },
  { label: "#80", start: 143, end: 158, order: 14 },
  { label: "#81", start: 159, end: 178, order: 15 },
  { label: "#82", start: 179, end: 194, order: 16 },
  { label: "#83", start: 195, end: 209, order: 17 },
  { label: "#84", start: 210, end: 230, order: 18 },
  { label: "#85", start: 231, end: 245, order: 19 },
  { label: "#86", start: 246, end: 257, order: 20 },
  { label: "#87", start: 258, end: 273, order: 21 },
  { label: "#88", start: 274, end: 289, order: 22 },
  { label: "#89", start: 290, end: 302, order: 23 },
  { label: "#90", start: 303, end: 316, order: 24 },
  { label: "#91", start: 317, end: 329, order: 25 },
  { label: "#92", start: 330, end: 343, order: 26 },
  { label: "#93", start: 344, end: 356, order: 27 },
  { label: "#94", start: 357, end: 380, order: 28 },
  { label: "#95", start: 381, end: 401, order: 29 },
  { label: "#96", start: 402, end: 422, order: 30 },
  { label: "#97", start: 423, end: 438, order: 31 },
  { label: "#98", start: 439, end: 451, order: 32 },
  { label: "#99", start: 452, end: 465, order: 33 },
  { label: "#00", start: 466, end: 485, order: 34 },
  { label: "#01", start: 486, end: 510, order: 35 },
  { label: "#2002", start: 511, end: 524, order: 36 },
  { label: "#2003", start: 525, end: 542, order: 37 },
  { label: "#2004", start: 543, end: 565, order: 38 },
  { label: "#2005", start: 566, end: 582, order: 39 },
  { label: "#2006", start: 583, end: 600, order: 40 },
  { label: "#2007", start: 601, end: 626, order: 41 },
  { label: "#2008", start: 627, end: 649, order: 42 },
  // Le document source contient deux titres #42 / 2009 successifs.
  // Ils appartiennent au même podcast et ne doivent surtout pas créer
  // un numéro supplémentaire dans l'interface.
  { label: "#2009", start: 650, end: 674, order: 43 },
  { label: "#2010", start: 675, end: 688, order: 44 },
  { label: "#2011", start: 689, end: 697, order: 45 },
  { label: "#2012", start: 698, end: 708, order: 46 },
  { label: "#2013", start: 709, end: 719, order: 47 },
  { label: "#2014", start: 720, end: 729, order: 48 },
  { label: "#2015", start: 730, end: 743, order: 49 },
  { label: "#2016", start: 744, end: 758, order: 50 },
  { label: "#2017", start: 759, end: 772, order: 51 },
  { label: "#2018", start: 773, end: 792, order: 52 },
  { label: "#2019", start: 793, end: 806, order: 53 },
  { label: "#2020", start: 807, end: 817, order: 54 },
  { label: "#2021", start: 818, end: 827, order: 55 },
  { label: "#2022", start: 828, end: 846, order: 56 },
  { label: "#2023", start: 847, end: 859, order: 57 },
  { label: "#2024", start: 860, end: 864, order: 58 },
];

function getUcpmPodcastGroup(
  movie: SavedMovie
): UcpmPodcastGroup | null {
  const position =
    Number(
      movie.ucpmPosition ??
      0
    );

  if (
    !Number.isFinite(position) ||
    position <= 0
  ) {
    return null;
  }

  /*
   * IMPORTANT : pour tout l'historique UCPM jusqu'au podcast 2024,
   * la position officielle est la source de vérité. Certaines anciennes
   * versions ont écrit un ucpmGroupLabel / ucpmGroupId erroné sur quelques
   * fiches, ce qui pouvait fabriquer un faux podcast d'un seul film.
   * On ignore donc ces métadonnées parasites pour les positions 1 à 864.
   */
  if (position <= 864) {
    /*
     * Cas historique particulier : dans le document source, le bloc de
     * titres situé à la charnière 2009/2010 est dupliqué une seconde fois.
     * La fiche Shutter Island a été importée depuis cette seconde occurrence
     * (position 681) alors que les autres titres correspondants utilisent
     * leur première occurrence, dans le podcast #42 / 2009.
     * On rattache donc explicitement ce film à sa première occurrence afin
     * d'éviter la création artificielle d'un podcast #43 contenant 1 film.
     */
    const normalizedHistoricalTitle = normalizeTitle(
      sanitizeMovieTitle(
        movie.customTitle ||
          movie.localizedTitle ||
          movie.title ||
          movie.originalTitle ||
          movie.tmdbTitle ||
          '',
        movie.year
      )
    );

    if (normalizedHistoricalTitle === 'shutter island') {
      const podcast42 = UCPM_PODCAST_GROUPS.find(
        (group) => group.label === '#2009' && group.start === 650
      );

      if (podcast42) {
        return { ...podcast42, kind: 'legacy' };
      }
    }

    const legacy =
      UCPM_PODCAST_GROUPS.find(
        (group) =>
          position >= group.start &&
          position <= group.end
      ) || null;

    return legacy
      ? { ...legacy, kind: 'legacy' }
      : null;
  }

  /*
   * Les 24 films historiques « 6 films #1 » à « 6 films #4 » suivent
   * directement le podcast #2024 dans le fichier UCPM : positions 865 à 888.
   * Les anciens imports ne stockaient pas toujours ucpmGroupType/Label ;
   * on reconstruit donc le groupe à partir de la position UCPM.
   */
  if (
    position >= UCPM_LEGACY_SIX_FILMS_START &&
    position <= UCPM_LEGACY_SIX_FILMS_END
  ) {
    const sixFilmsNumber =
      Math.floor(
        (position - UCPM_LEGACY_SIX_FILMS_START) /
          UCPM_LEGACY_SIX_FILMS_SIZE
      ) + 1;
    const start =
      UCPM_LEGACY_SIX_FILMS_START +
      (sixFilmsNumber - 1) * UCPM_LEGACY_SIX_FILMS_SIZE;

    return {
      id: `legacy_sixfilms_${sixFilmsNumber}`,
      label: `6 films #${sixFilmsNumber}`,
      start,
      end: start + UCPM_LEGACY_SIX_FILMS_SIZE - 1,
      order: 60 + sixFilmsNumber - 1,
      expectedCount: UCPM_LEGACY_SIX_FILMS_SIZE,
      kind: 'sixfilms',
    };
  }

  /*
   * Au-delà de l'historique, les groupes créés depuis l'application
   * utilisent volontairement leurs métadonnées explicites.
   */
  if (movie.ucpmGroupLabel) {
    const groupLabel = movie.ucpmGroupLabel;
    const groupOrder =
      typeof movie.ucpmGroupOrder === 'number'
        ? movie.ucpmGroupOrder
        : 60;

    return {
      id:
        movie.ucpmGroupId ||
        `ucpm_label_${normalizeHeader(groupLabel)}_${String(groupOrder)}`,
      label: groupLabel,
      start: position,
      end: position,
      order: groupOrder,
      expectedCount:
        typeof movie.ucpmGroupExpectedCount === 'number'
          ? movie.ucpmGroupExpectedCount
          : null,
      kind:
        movie.ucpmGroupType === 'sixfilms' ||
        /^6\s*films\b/i.test(groupLabel)
          ? 'sixfilms'
          : 'podcast',
    };
  }

  return null;
}


function getUcpmPodcastGroupKey(
  group: UcpmPodcastGroup | null
) {
  if (!group) {
    return '__unclassified__';
  }

  if (group.id) {
    return group.id;
  }

  return `legacy:${group.order}:${group.start}:${group.end}:${group.label}`;
}


function getUcpmSixFilmsMemberships(
  movie: SavedMovie
): UcpmSixFilmsMembership[] {
  const raw = movie.ucpmSixFilmsMemberships;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((membership) => {
      if (!membership || typeof membership !== 'object') {
        return null;
      }

      const groupId = String((membership as any).groupId || '').trim();
      const number = Number((membership as any).number);
      const itemOrder = Number((membership as any).itemOrder);
      const groupOrderRaw = Number((membership as any).groupOrder);

      if (
        !groupId ||
        !Number.isFinite(number) ||
        number <= 0 ||
        !Number.isFinite(itemOrder) ||
        itemOrder <= 0
      ) {
        return null;
      }

      return {
        groupId,
        number: Math.round(number),
        itemOrder: Math.round(itemOrder),
        groupOrder:
          Number.isFinite(groupOrderRaw)
            ? groupOrderRaw
            : null,
      } satisfies UcpmSixFilmsMembership;
    })
    .filter(Boolean) as UcpmSixFilmsMembership[];
}


function getUcpmPodcastYearLabel(
  group: UcpmPodcastGroup | null
) {
  if (!group) {
    return 'Année inconnue';
  }

  const raw = group.label
    .replace(/^#/, '')
    .trim();

  if (/^50[’']?s$/i.test(raw)) {
    return 'Années 1950';
  }

  if (/^60[’']?s$/i.test(raw)) {
    return 'Années 1960';
  }

  if (/^\d{4}$/.test(raw)) {
    return raw;
  }

  if (/^\d{2}$/.test(raw)) {
    const value = Number(raw);
    return value >= 50
      ? `19${raw}`
      : `20${raw}`;
  }

  return raw || 'Année inconnue';
}

/*
 * Numérotation historique réelle des podcasts.
 * Dans le document source, les blocs « Années 1950 » et « Années 1960 »
 * sont des archives d'introduction, pas les podcasts #01 et #02.
 * Le podcast #01 commence en 1968 ; dès lors le numéro est simplement
 * année - 1967 (2009 = #42, 2010 = #43, 2013 = #46, 2024 = #57).
 */
function getLegacyUcpmPodcastNumber(
  group: UcpmPodcastGroup | null
): number | null {
  if (!group || group.kind === 'podcast' || group.kind === 'sixfilms') {
    return null;
  }

  const year = Number(getUcpmPodcastYearLabel(group));

  if (!Number.isFinite(year) || year < 1968) {
    return null;
  }

  return Math.round(year) - 1967;
}

function getLastLegacyUcpmPodcastNumber() {
  return UCPM_PODCAST_GROUPS.reduce(
    (max, group) =>
      Math.max(
        max,
        getLegacyUcpmPodcastNumber({ ...group, kind: 'legacy' }) ?? 0
      ),
    0
  );
}


/*
 * Films mis en avant dans le fichier SYNTHÈSE :
 * - le film rouge de chaque année passe en première position ;
 * - 1977, 1978 et 1990 utilisent les corrections manuelles demandées.
 * 1990 possède volontairement deux films mis en avant.
 */
const UCPM_FEATURED_TITLES_BY_YEAR: Record<string, string[]> = {
  '1968': ["Rosemary’s Baby", "Rosemary's Baby"],
  '1969': ['Un homme qui me plait', 'Un homme qui me plaît'],
  '1970': ['Borsalino'],
  '1971': ['Wake in fright'],
  '1972': ['Orange mécanique', 'A Clockwork Orange'],
  '1973': ['Le Magnifique'],
  '1974': ["L’exorciste", "L'exorciste", 'The Exorcist'],
  '1975': ['Peur sur la ville'],
  '1976': ['Le corps de mon ennemi'],
  '1977': ['Rocky'],
  '1978': ['Les Bronzés', 'Les bronzés'],
  '1979': ['Flic ou voyou'],
  '1980': ['Shining', 'The Shining'],
  '1981': ['Le professionnel', 'Le Professionnel'],
  '1982': ['Le père Noël est une ordure', 'Le pere Noel est une ordure'],
  '1983': ['La valse des pantins', 'The King of Comedy'],
  '1984': ['Joyeuses Pâques', 'Joyeuses Paques'],
  '1985': ['Retour vers le futur', 'Back to the Future'],
  '1986': ['37°2 le matin', '37 2 le matin', 'Betty Blue'],
  '1987': ['Au revoir les enfants'],
  '1988': ['Le grand bleu', 'The Big Blue'],
  '1989': ['Mystery train', 'Mystery Train'],
  '1990': ['La gloire de mon père', 'Le château de ma mère'],
  '1991': ['Thelma et Louise', 'Thelma & Louise'],
  '1992': ['Hook'],
  '1993': ['Un jour sans fin', 'Groundhog Day'],
  '1994': ['Le péril jeune', 'Le peril jeune'],
  '1995': ['La haine'],
  '1996': ['Trainspotting'],
  '1997': ['On connaît la chanson', 'On connait la chanson'],
  '1998': ['Jackie Brown'],
  '1999': ['Happiness'],
  '2000': ['Le goût des autres', 'Le gout des autres'],
  '2001': ['Mulholland drive', 'Mulholland Drive'],
  '2002': ['Irréversible', 'Irreversible'],
  '2003': ['Punch-drunk love', 'Punch-Drunk Love'],
  '2004': ['Kill Bill 2', 'Kill Bill: Vol. 2', 'Kill Bill Vol. 2'],
  '2005': ['Calvaire'],
  '2006': ["Un ticket pour l’espace", "Un ticket pour l'espace"],
  '2007': ['Boulevard de la mort', 'Death Proof'],
  '2008': ['Step Brothers'],
  '2009': ['Tellement proches'],
  '2010': ['Le nom des gens', 'The Names of Love'],
  '2011': ['Polisse'],
  '2012': ['Une nuit'],
  '2013': ['Prisoners'],
  '2014': ['Whiplash'],
  '2015': ['Mon roi', 'My King'],
  '2016': ['Masterminds'],
  '2017': ['Brimstone'],
  '2018': ['Brawl in Cell Block 99'],
  '2019': ['Once upon a time in Hollywood', 'Once Upon a Time... in Hollywood'],
  '2020': ['Le cas Richard Jewell', 'Richard Jewell'],
  '2021': ['Aline'],
  '2022': ["Don’t worry darling", "Don't Worry Darling", 'Don’t Worry Darling'],
  '2023': ["Une affaire d'honneur", 'Une affaire d’honneur'],
  '2024': ['Le Successeur', 'The Successor'],
};

function getUcpmFeaturedRank(movie: SavedMovie): number | null {
  const group = getUcpmPodcastGroup(movie);

  if (!group || group.kind !== 'legacy') {
    return null;
  }

  const year = getUcpmPodcastYearLabel(group);
  const preferredTitles = UCPM_FEATURED_TITLES_BY_YEAR[year];

  if (!preferredTitles?.length) {
    return null;
  }

  const candidateTitles = [
    movie.customTitle,
    movie.localizedTitle,
    movie.title,
    movie.originalTitle,
    movie.tmdbTitle,
  ]
    .filter(Boolean)
    .map((value) =>
      normalizeTitle(
        sanitizeMovieTitle(
          String(value || ''),
          movie.year
        )
      )
    );

  for (let index = 0; index < preferredTitles.length; index += 1) {
    const preferred = normalizeTitle(preferredTitles[index]);

    if (
      candidateTitles.some(
        (candidate) =>
          candidate === preferred ||
          (preferred.length >= 6 && candidate.includes(preferred)) ||
          (candidate.length >= 6 && preferred.includes(candidate))
      )
    ) {
      if (year === '1990') {
        return index;
      }

      return 0;
    }
  }

  return null;
}

function orderUcpmFeaturedMoviesFirst(movies: SavedMovie[]) {
  const ordered: SavedMovie[] = [];
  let index = 0;

  while (index < movies.length) {
    const firstGroupKey = getUcpmPodcastGroupKey(
      getUcpmPodcastGroup(movies[index])
    );

    let end = index + 1;

    while (
      end < movies.length &&
      getUcpmPodcastGroupKey(
        getUcpmPodcastGroup(movies[end])
      ) === firstGroupKey
    ) {
      end += 1;
    }

    const chunk = movies
      .slice(index, end)
      .map((movie, originalIndex) => ({
        movie,
        originalIndex,
        featuredRank: getUcpmFeaturedRank(movie),
      }))
      .sort((a, b) => {
        const aFeatured = a.featuredRank !== null;
        const bFeatured = b.featuredRank !== null;

        if (aFeatured !== bFeatured) {
          return aFeatured ? -1 : 1;
        }

        if (
          a.featuredRank !== null &&
          b.featuredRank !== null &&
          a.featuredRank !== b.featuredRank
        ) {
          return a.featuredRank - b.featuredRank;
        }

        return a.originalIndex - b.originalIndex;
      })
      .map((item) => item.movie);

    ordered.push(...chunk);
    index = end;
  }

  return ordered;
}


function hashString(
  value: string
) {
  let hash =
    2166136261;

  for (
    let i = 0;
    i < value.length;
    i++
  ) {
    hash ^=
      value.charCodeAt(i);

    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (
    hash >>> 0
  ).toString(16);
}


function extractImdbId(
  value: string
) {
  const trimmed =
    value.trim();

  const match =
    trimmed.match(
      /tt\d{5,10}/i
    );

  if (match) {
    return match[0]
      .toLowerCase();
  }

  if (
    /^\d{5,10}$/.test(
      trimmed
    )
  ) {
    return `tt${trimmed}`;
  }

  return null;
}


function detectDelimiter(
  line: string
) {
  const candidates = [
    ',',
    ';',
    '\t',
  ];

  let selected = ',';
  let bestCount = -1;

  for (
    const delimiter
    of candidates
  ) {
    const count =
      line.split(
        delimiter
      ).length;

    if (
      count >
      bestCount
    ) {
      bestCount =
        count;

      selected =
        delimiter;
    }
  }

  return selected;
}


function parseCsvLine(
  line: string,
  delimiter: string
) {
  const cells:
    string[] = [];

  let current = '';
  let insideQuotes =
    false;

  for (
    let index = 0;
    index <
    line.length;
    index++
  ) {
    const character =
      line[index];

    if (
      character === '"'
    ) {
      if (
        insideQuotes &&
        line[
          index + 1
        ] === '"'
      ) {
        current += '"';
        index++;
      } else {
        insideQuotes =
          !insideQuotes;
      }

      continue;
    }

    if (
      character ===
        delimiter &&
      !insideQuotes
    ) {
      cells.push(
        current.trim()
      );

      current = '';

      continue;
    }

    current +=
      character;
  }

  cells.push(
    current.trim()
  );

  return cells;
}


function parseCsvTable(
  content: string,
  delimiter: string
) {
  const rows:
    string[][] = [];

  let row:
    string[] = [];

  let current = '';
  let insideQuotes =
    false;

  const cleanContent =
    content
      .replace(
        /^\uFEFF/,
        ''
      )
      .replace(
        /\r/g,
        ''
      );

  for (
    let index = 0;
    index < cleanContent.length;
    index++
  ) {
    const character =
      cleanContent[index];

    if (
      character === '"'
    ) {
      if (
        insideQuotes &&
        cleanContent[
          index + 1
        ] === '"'
      ) {
        current += '"';
        index++;
      } else {
        insideQuotes =
          !insideQuotes;
      }

      continue;
    }

    if (
      character === delimiter &&
      !insideQuotes
    ) {
      row.push(
        current.trim()
      );

      current = '';
      continue;
    }

    if (
      character === '\n' &&
      !insideQuotes
    ) {
      row.push(
        current.trim()
      );

      if (
        row.some(
          (cell) =>
            Boolean(
              cell.trim()
            )
        )
      ) {
        rows.push(
          row
        );
      }

      row = [];
      current = '';
      continue;
    }

    current +=
      character;
  }

  row.push(
    current.trim()
  );

  if (
    row.some(
      (cell) =>
        Boolean(
          cell.trim()
        )
    )
  ) {
    rows.push(
      row
    );
  }

  return rows;
}


function normalizeLetterboxdCsvDate(
  value: string
) {
  const raw =
    value.trim();

  if (!raw) {
    return null;
  }

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      raw
    )
  ) {
    return raw;
  }

  const frenchDate =
    raw.match(
      /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/
    );

  if (
    frenchDate
  ) {
    return `${frenchDate[3]}-${frenchDate[2].padStart(
      2,
      '0'
    )}-${frenchDate[1].padStart(
      2,
      '0'
    )}`;
  }

  const isoDateTime =
    raw.match(
      /^(\d{4}-\d{2}-\d{2})[T ]/
    );

  return isoDateTime
    ? isoDateTime[1]
    : null;
}


function parseLetterboxdCsv(
  content: string,
  fileName: string
): LetterboxdCsvMovie[] {
  const cleanContent =
    content
      .replace(
        /^\uFEFF/,
        ''
      )
      .replace(
        /\r/g,
        ''
      );

  const firstLine =
    cleanContent
      .split('\n')[0] ||
    '';

  if (
    !firstLine.trim()
  ) {
    return [];
  }

  const delimiter =
    detectDelimiter(
      firstLine
    );

  const table =
    parseCsvTable(
      cleanContent,
      delimiter
    );

  if (
    table.length < 2
  ) {
    return [];
  }

  const headers =
    table[0].map(
      normalizeHeader
    );

  const findColumn = (
    aliases: string[]
  ) =>
    headers.findIndex(
      (header) =>
        aliases.includes(
          header
        )
    );

  const titleIndex =
    findColumn([
      'name',
      'title',
      'titre',
      'film',
      'nom',
    ]);

  if (
    titleIndex === -1
  ) {
    return [];
  }

  const yearIndex =
    findColumn([
      'year',
      'annee',
    ]);

  const uriIndex =
    findColumn([
      'letterboxduri',
      'letterboxdfilmuri',
      'uri',
      'url',
    ]);

  const dateIndex =
    findColumn([
      'date',
      'addeddate',
      'ratingdate',
    ]);

  const watchedDateIndex =
    findColumn([
      'watcheddate',
      'datevisionnage',
      'visionnage',
    ]);

  const ratingIndex =
    findColumn([
      'rating',
      'note',
    ]);

  const exactRatingIndex =
    findColumn([
      'mmbratingexact',
    ]);

  const rating10Index =
    findColumn([
      'rating10',
    ]);

  const rewatchIndex =
    findColumn([
      'rewatch',
      'rewatched',
      'revisionnage',
    ]);

  const reviewIndex =
    findColumn([
      'review',
      'critique',
      'comment',
      'commentaire',
    ]);

  const lowerFileName =
    fileName.toLowerCase();

  let kind:
    LetterboxdCsvKind =
      'generic';

  if (
    lowerFileName.includes(
      'watchlist'
    )
  ) {
    kind = 'watchlist';
  } else if (
    lowerFileName.includes(
      'diary'
    )
  ) {
    kind = 'diary';
  } else if (
    lowerFileName.includes(
      'review'
    ) ||
    reviewIndex >= 0
  ) {
    kind = 'reviews';
  } else if (
    lowerFileName.includes(
      'rating'
    )
  ) {
    kind = 'ratings';
  } else if (
    lowerFileName.includes(
      'watched'
    )
  ) {
    kind = 'watched';
  } else if (
    watchedDateIndex >= 0 ||
    rewatchIndex >= 0
  ) {
    kind = 'diary';
  } else if (
    ratingIndex >= 0
  ) {
    kind = 'ratings';
  }

  const movies:
    LetterboxdCsvMovie[] = [];

  for (
    let index = 1;
    index < table.length;
    index++
  ) {
    const cells =
      table[index];

    const rawTitle =
      cells[
        titleIndex
      ]?.trim() ||
      '';

    if (
      !rawTitle
    ) {
      continue;
    }

    const rawYear =
      yearIndex >= 0
        ? cells[
            yearIndex
          ]?.trim() ||
          ''
        : '';

    const year =
      /^\d{4}$/.test(
        rawYear
      )
        ? Number(
            rawYear
          )
        : null;

    const rawRating =
      exactRatingIndex >= 0 &&
      cells[
        exactRatingIndex
      ]?.trim()
        ? cells[
            exactRatingIndex
          ]?.trim() ||
          ''
        : ratingIndex >= 0
        ? cells[
            ratingIndex
          ]?.trim() ||
          ''
        : '';

    const parsedRating =
      rawRating
        ? Number(
            rawRating.replace(
              ',',
              '.'
            )
          )
        : null;

    const rawRating10 =
      rating10Index >= 0
        ? cells[
            rating10Index
          ]?.trim() ||
          ''
        : '';

    const parsedRating10 =
      rawRating10
        ? Number(
            rawRating10.replace(
              ',',
              '.'
            )
          )
        : null;

    const rating =
      parsedRating != null &&
      Number.isFinite(
        parsedRating
      ) &&
      parsedRating >= 0 &&
      parsedRating <= 5
        ? parsedRating
        : parsedRating10 != null &&
          Number.isFinite(
            parsedRating10
          ) &&
          parsedRating10 >= 0 &&
          parsedRating10 <= 10
        ? parsedRating10 / 2
        : null;

    const rawRewatch =
      rewatchIndex >= 0
        ? (
            cells[
              rewatchIndex
            ]?.trim() ||
            ''
          ).toLowerCase()
        : '';

    const rewatch =
      [
        '1',
        'true',
        'yes',
        'oui',
        'x',
        'rewatch',
      ].includes(
        rawRewatch
      );

    const date =
      dateIndex >= 0
        ? normalizeLetterboxdCsvDate(
            cells[
              dateIndex
            ] ||
              ''
          )
        : null;

    const watchedDate =
      watchedDateIndex >= 0
        ? normalizeLetterboxdCsvDate(
            cells[
              watchedDateIndex
            ] ||
              ''
          )
        : null;

    movies.push({
      title:
        sanitizeMovieTitle(
          rawTitle,
          year
        ),
      year,
      letterboxdFilmUri:
        uriIndex >= 0
          ? cells[
              uriIndex
            ]?.trim() ||
            null
          : null,
      date,
      watchedDate,
      rating,
      rewatch,
      review:
        reviewIndex >= 0
          ? cells[
              reviewIndex
            ] ||
            null
          : null,
      kind,
    });
  }

  return movies;
}


function parseUcpmCsv(
  content: string
): UcpmCsvMovie[] {
  const cleanContent =
    content
      .replace(
        /^\uFEFF/,
        ''
      )
      .replace(
        /\r/g,
        ''
      );

  const lines =
    cleanContent
      .split('\n')
      .map(
        (line) =>
          line.trim()
      )
      .filter(
        Boolean
      );

  if (
    lines.length ===
    0
  ) {
    return [];
  }

  const delimiter =
    detectDelimiter(
      lines[0]
    );

  const firstCells =
    parseCsvLine(
      lines[0],
      delimiter
    );

  const normalizedHeaders =
    firstCells.map(
      normalizeHeader
    );

  const titleAliases = [
    'title',
    'titre',
    'film',
    'name',
    'nom',
  ];

  const positionAliases = [
    'position',
    'rank',
    'rang',
    'numero',
    'number',
    'no',
    'n',
  ];

  const yearAliases = [
    'year',
    'annee',
    'date',
  ];

  const imdbAliases = [
    'imdb',
    'imdbid',
    'codeimdb',
  ];

  const findColumn = (
    aliases: string[]
  ) =>
    normalizedHeaders
      .findIndex(
        (
          header
        ) =>
          aliases.includes(
            header
          )
      );

  let titleIndex =
    findColumn(
      titleAliases
    );

  let positionIndex =
    findColumn(
      positionAliases
    );

  let yearIndex =
    findColumn(
      yearAliases
    );

  let imdbIndex =
    findColumn(
      imdbAliases
    );

  const hasHeader =
    titleIndex !== -1 ||
    positionIndex !== -1 ||
    yearIndex !== -1 ||
    imdbIndex !== -1;

  let startIndex =
    0;

  if (
    hasHeader
  ) {
    startIndex =
      1;

    if (
      titleIndex === -1
    ) {
      titleIndex =
        1;
    }

    if (
      positionIndex === -1
    ) {
      positionIndex =
        0;
    }
  } else {
    positionIndex =
      0;

    titleIndex =
      1;

    yearIndex =
      2;

    imdbIndex =
      3;
  }

  const movies:
    UcpmCsvMovie[] = [];

  for (
    let index =
      startIndex;
    index <
    lines.length;
    index++
  ) {
    const cells =
      parseCsvLine(
        lines[index],
        delimiter
      );

    const rawTitle =
      cells[
        titleIndex
      ]?.trim();

    if (
      !rawTitle
    ) {
      continue;
    }

    const rawPosition =
      cells[
        positionIndex
      ]?.trim();

    const position =
      Number(
        rawPosition
      );

    const rawYear =
      yearIndex >= 0
        ? cells[
            yearIndex
          ]?.trim()
        : '';

    const parsedYear =
      rawYear &&
      /^\d{4}$/.test(
        rawYear
      )
        ? Number(
            rawYear
          )
        : null;

    const rawImdb =
      imdbIndex >= 0
        ? cells[
            imdbIndex
          ]?.trim()
        : '';

    movies.push({
      position:
        Number.isFinite(
          position
        )
          ? position
          : movies.length +
            1,

      title:
        sanitizeMovieTitle(
          rawTitle,
          parsedYear
        ),

      year:
        parsedYear,

      imdb:
        rawImdb
          ? extractImdbId(
              rawImdb
            )
          : null,
    });
  }

  return dedupeImportedMovieRows(movies);
}


function parseJellyfinCsv(
  content: string
): JellyfinCsvMovie[] {
  const cleanContent =
    content
      .replace(/^\uFEFF/, '')
      .replace(/\r/g, '');

  const lines =
    cleanContent
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const delimiter =
    detectDelimiter(lines[0]);

  const firstCells =
    parseCsvLine(lines[0], delimiter);

  const headers =
    firstCells.map(normalizeHeader);

  const findColumn =
    (aliases: string[]) =>
      headers.findIndex((header) => aliases.includes(header));

  let titleIndex = findColumn([
    'name',
    'title',
    'titre',
    'moviename',
    'sortname',
  ]);

  let yearIndex = findColumn([
    'productionyear',
    'year',
    'annee',
    'premieredate',
    'releasedate',
  ]);

  let imdbIndex = findColumn([
    'imdb',
    'imdbid',
    'provideridimdb',
  ]);

  let tmdbIndex = findColumn([
    'tmdb',
    'tmdbid',
    'provideridtmdb',
  ]);

  const providerIdsIndex = findColumn([
    'providerids',
    'providerid',
    'externalids',
  ]);

  const typeIndex = findColumn([
    'type',
    'mediatype',
    'itemtype',
  ]);

  const sourceFileIndex = findColumn([
    'path',
    'filepath',
    'filename',
    'file',
    'mediafile',
    'mediapath',
    'sourcefile',
    'sourcefilename',
    'fullpath',
    'filelocation',
    'pathname',
  ]);

  const hasHeader =
    titleIndex !== -1 ||
    yearIndex !== -1 ||
    imdbIndex !== -1 ||
    tmdbIndex !== -1 ||
    providerIdsIndex !== -1;

  let startIndex = 0;

  if (hasHeader) {
    startIndex = 1;
    if (titleIndex === -1) {
      titleIndex = 0;
    }
  } else {
    titleIndex = 0;
    yearIndex = 1;
    imdbIndex = 2;
    tmdbIndex = 3;
  }

  const movies: JellyfinCsvMovie[] = [];

  for (let index = startIndex; index < lines.length; index++) {
    const cells =
      parseCsvLine(lines[index], delimiter);

    if (typeIndex >= 0) {
      const rawType =
        normalizeHeader(cells[typeIndex] || '');

      if (
        rawType &&
        !['movie', 'movies', 'film', 'films'].includes(rawType)
      ) {
        continue;
      }
    }

    const rawTitle =
      cells[titleIndex]?.trim();

    if (!rawTitle) {
      continue;
    }

    const rawYear =
      yearIndex >= 0
        ? cells[yearIndex]?.trim() || ''
        : '';

    const yearMatch =
      rawYear.match(/(?:19|20)\d{2}/);

    const rawProviderIds =
      providerIdsIndex >= 0
        ? cells[providerIdsIndex]?.trim() || ''
        : '';

    const rawImdb =
      imdbIndex >= 0
        ? cells[imdbIndex]?.trim() || ''
        : '';

    const rawTmdb =
      tmdbIndex >= 0
        ? cells[tmdbIndex]?.trim() || ''
        : '';

    const imdbFromProviders =
      rawProviderIds.match(/imdb\s*[=:]\s*(tt\d+)/i)?.[1] || '';

    const tmdbFromProviders =
      rawProviderIds.match(/tmdb\s*[=:]\s*(\d+)/i)?.[1] || '';

    const imdb =
      extractImdbId(rawImdb || imdbFromProviders);

    const tmdbNumber =
      Number(rawTmdb || tmdbFromProviders);

    const rawSourceFile =
      sourceFileIndex >= 0
        ? cells[sourceFileIndex]?.trim() || ''
        : '';

    movies.push({
      position: movies.length + 1,
      title: sanitizeMovieTitle(
        rawTitle,
        yearMatch ? Number(yearMatch[0]) : null
      ),
      year: yearMatch ? Number(yearMatch[0]) : null,
      imdb: imdb || null,
      tmdbId:
        Number.isFinite(tmdbNumber) && tmdbNumber > 0
          ? tmdbNumber
          : null,
      sourceFile:
        rawSourceFile ||
        (/\.(?:mkv|mp4|avi|mov|m4v|wmv|ts|m2ts|webm|mpg|mpeg)$/i.test(rawTitle)
          ? rawTitle
          : null),
    });
  }

  return dedupeImportedMovieRows(movies);
}


function parseDiaryCsv(
  content: string
): DiaryCsvEntry[] {
  const cleanContent =
    content
      .replace(
        /^\uFEFF/,
        ''
      )
      .replace(
        /\r/g,
        ''
      );

  const lines =
    cleanContent
      .split('\n')
      .map(
        (line) =>
          line.trim()
      )
      .filter(
        Boolean
      );

  if (
    lines.length ===
    0
  ) {
    return [];
  }

  const delimiter =
    detectDelimiter(
      lines[0]
    );

  const headers =
    parseCsvLine(
      lines[0],
      delimiter
    ).map(
      normalizeHeader
    );

  const findColumn = (
    aliases: string[]
  ) =>
    headers.findIndex(
      (
        header
      ) =>
        aliases.includes(
          header
        )
    );

  const dateIndex =
    findColumn([
      'date',
      'watcheddate',
      'datevisionnage',
      'visionnage',
    ]);

  const titleIndex =
    findColumn([
      'name',
      'title',
      'titre',
      'film',
      'nom',
    ]);

  const yearIndex =
    findColumn([
      'year',
      'annee',
    ]);

  const ratingIndex =
    findColumn([
      'rating',
      'note',
    ]);

  const rewatchIndex =
    findColumn([
      'rewatch',
      'rewatched',
      'revisionnage',
    ]);

  if (
    dateIndex === -1 ||
    titleIndex === -1
  ) {
    return [];
  }

  const entries:
    DiaryCsvEntry[] = [];

  for (
    let index = 1;
    index < lines.length;
    index++
  ) {
    const cells =
      parseCsvLine(
        lines[index],
        delimiter
      );

    const rawDate =
      cells[
        dateIndex
      ]?.trim() ||
      '';

    const rawTitle =
      cells[
        titleIndex
      ]?.trim() ||
      '';

    if (
      !rawDate ||
      !rawTitle
    ) {
      continue;
    }

    let watchedDate =
      rawDate;

    const frenchDate =
      rawDate.match(
        /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/
      );

    if (
      frenchDate
    ) {
      watchedDate =
        `${frenchDate[3]}-${frenchDate[2].padStart(
          2,
          '0'
        )}-${frenchDate[1].padStart(
          2,
          '0'
        )}`;
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        watchedDate
      )
    ) {
      continue;
    }

    const rawYear =
      yearIndex >= 0
        ? cells[
            yearIndex
          ]?.trim() ||
          ''
        : '';

    const year =
      /^\d{4}$/.test(
        rawYear
      )
        ? Number(
            rawYear
          )
        : null;

    const rawRating =
      ratingIndex >= 0
        ? cells[
            ratingIndex
          ]?.trim() ||
          ''
        : '';

    const parsedRating =
      rawRating === ''
        ? null
        : Number(
            rawRating.replace(
              ',',
              '.'
            )
          );

    const rating =
      parsedRating != null &&
      Number.isFinite(
        parsedRating
      ) &&
      parsedRating >= 0 &&
      parsedRating <= 5
        ? parsedRating
        : null;

    const rawRewatch =
      rewatchIndex >= 0
        ? (
            cells[
              rewatchIndex
            ]?.trim() ||
            ''
          ).toLowerCase()
        : '';

    const rewatch =
      [
        '1',
        'true',
        'yes',
        'oui',
        'x',
        'rewatch',
      ].includes(
        rawRewatch
      );

    entries.push({
      watchedDate,
      title:
        sanitizeMovieTitle(
          rawTitle,
          year
        ),
      year,
      rating,
      rewatch,
    });
  }

  return entries;
}


function posterLanguagePriority(
  poster: TmdbPoster
) {
  if (
    poster.iso_639_1 ===
    'fr'
  ) {
    return 0;
  }

  if (
    poster.iso_639_1 ===
    null
  ) {
    return 1;
  }

  if (
    poster.iso_639_1 ===
    'en'
  ) {
    return 2;
  }

  return 3;
}


function sortPosters(
  posters: TmdbPoster[]
) {
  return [
    ...posters,
  ].sort(
    (
      a,
      b
    ) => {
      const languageDifference =
        posterLanguagePriority(
          a
        ) -
        posterLanguagePriority(
          b
        );

      if (
        languageDifference !==
        0
      ) {
        return languageDifference;
      }

      const voteDifference =
        (
          b.vote_average ||
          0
        ) -
        (
          a.vote_average ||
          0
        );

      if (
        voteDifference !==
        0
      ) {
        return voteDifference;
      }

      return (
        (
          b.vote_count ||
          0
        ) -
        (
          a.vote_count ||
          0
        )
      );
    }
  );
}


function getTitleOptionCategory(
  option:
    TitleOption
): TitleFilter {
  if (
    option.kind ===
    'original'
  ) {
    return 'original';
  }

  if (
    option.language ===
    'fr'
  ) {
    return 'fr';
  }

  if (
    option.language ===
    'en'
  ) {
    return 'en';
  }

  return 'other';
}


function App() {

  const [
    authenticatedUser,
    setAuthenticatedUser,
  ] =
    useState<
      User | null
    >(
      () => auth.currentUser
    );


  const [
    authResolved,
    setAuthResolved,
  ] =
    useState(() => GUEST_MODE ? false : Boolean(auth.currentUser));


  const [
    guestOwnerUid,
    setGuestOwnerUid,
  ] = useState<string | null>(null);


  const [
    guestModeError,
    setGuestModeError,
  ] = useState('');


  const user =
    GUEST_MODE
      ? (
          guestOwnerUid
            ? ({ uid: guestOwnerUid } as User)
            : null
        )
      : authenticatedUser;


  const [
    page,
    setPage,
  ] =
    useState<Page>(
      'topUS'
    );


  const [
    pageSearchQuery,
    setPageSearchQuery,
  ] = useState('');

  const [
    pageSearchStatus,
    setPageSearchStatus,
  ] = useState('');

  const pageSearchDebounceRef = useRef<number | null>(null);
  const pageSearchHighlightTimerRef = useRef<number | null>(null);
  const pageSearchLastQueryRef = useRef('');
  const pageSearchLastIndexRef = useRef(-1);

  useEffect(() => {
    setPageSearchQuery('');
    setPageSearchStatus('');
    pageSearchLastQueryRef.current = '';
    pageSearchLastIndexRef.current = -1;

    if (pageSearchDebounceRef.current !== null) {
      window.clearTimeout(pageSearchDebounceRef.current);
      pageSearchDebounceRef.current = null;
    }

    if (pageSearchHighlightTimerRef.current !== null) {
      window.clearTimeout(pageSearchHighlightTimerRef.current);
      pageSearchHighlightTimerRef.current = null;
    }

    document
      .querySelectorAll<HTMLElement>('.pageSearchBlink')
      .forEach((element) => element.classList.remove('pageSearchBlink'));
  }, [page]);


  /*
   * BANDEAU
   * On choisit directement l'image selon
   * la largeur réelle de l'écran.
   */

  const [
    isMobileBanner,
    setIsMobileBanner,
  ] =
    useState(
      () =>
        window.innerWidth <=
        800
    );


  /* Bandeau fixe sur toutes les pages : l'image mobile est également
     celle de la version PC. Le CSS ajuste sa taille à la fenêtre. */
  const bannerSrc = '/img_bando_mobile.png?v=16';


  /*
   * INTRO D'OUVERTURE
   * Elle se rejoue à chaque chargement / rafraîchissement de la page.
   * Le choix PC / mobile dépend de l'appareil et non de la largeur de la
   * fenêtre : une fenêtre PC étroite conserve donc toujours intro_pc.mp4.
   */
  const [
    isMobileIntro,
  ] =
    useState(
      () => {
        const browserNavigator =
          navigator as Navigator & {
            userAgentData?: {
              mobile?: boolean;
            };
          };

        if (
          typeof browserNavigator
            .userAgentData
            ?.mobile ===
          'boolean'
        ) {
          return Boolean(
            browserNavigator
              .userAgentData
              ?.mobile
          );
        }

        if (
          navigator.platform ===
            'MacIntel' &&
          navigator.maxTouchPoints >
            1
        ) {
          return true;
        }

        return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(
          navigator.userAgent
        );
      }
    );


  const [
    showIntro,
    setShowIntro,
  ] =
    useState(() => !GUEST_MODE);


  const [
    introFading,
    setIntroFading,
  ] =
    useState(false);


  const introCloseTimerRef =
    useRef<number | null>(
      null
    );


  const introOverlayRef =
    useRef<HTMLDivElement | null>(
      null
    );


  const introSafetyTimerRef =
    useRef<number | null>(
      null
    );


  const showIntroRef =
    useRef(!GUEST_MODE);


  /*
   * v1.533 : la fin de la vidéo et l'affichage du site sont désormais
   * découplés. La vidéo peut se terminer immédiatement, puis le snapshot
   * Firestore est rendu derrière l'overlay. L'overlay n'est retiré qu'une
   * fois la première grille réellement prête, ce qui évite l'écran à 0 film.
   */
  const [
    introPlaybackFinished,
    setIntroPlaybackFinished,
  ] = useState(false);

  const introPlaybackFinishedRef =
    useRef(false);


  useEffect(
    () => {
      if (!GUEST_MODE) {
        return;
      }

      showIntroRef.current = false;
      introPlaybackFinishedRef.current = true;
      setIntroPlaybackFinished(true);
      setIntroFading(false);
      setShowIntro(false);
    },
    []
  );


  const introHydrationStartedRef =
    useRef(false);


  /*
   * v1.531 : au premier affichage, on ne monte qu'une petite partie de la
   * grille. Cela permet au dernier frame de l'intro de basculer directement
   * vers une page déjà utilisable, puis le reste des affiches est ajouté par
   * petits lots après le premier paint.
   */
  const [
    startupGridRenderLimit,
    setStartupGridRenderLimit,
  ] = useState(28);

  const startupGridRenderDoneRef =
    useRef(false);


  const posterRevealRootRef =
    useRef<HTMLElement | null>(
      null
    );


  /*
   * Les affiches apparaissent dans l'ordre de la grille à chaque ouverture
   * d'une rubrique. L'observateur prend aussi en charge les listes reçues
   * après le chargement Firestore, sans ralentir les longues collections.
   */
  useLayoutEffect(
    () => {
      const root =
        posterRevealRootRef.current;

      if (!root) {
        return;
      }

      let animationFrame:
        number | null = null;

      const revealPosters = (
        restart = false
      ) => {
        const selector = restart
          ? '.movies .movie'
          : '.movies .movie:not([data-poster-revealed="true"])';

        const cards =
          Array.from(
            root.querySelectorAll<HTMLElement>(
              selector
            )
          );

        /* Pendant l'intro, les cartes peuvent être préparées derrière la
           vidéo, mais sans lancer des centaines d'animations invisibles.
           Cela laisse le thread principal disponible pour la vidéo. */
        if (showIntroRef.current) {
          cards.forEach(
            (card) => {
              card.classList.remove(
                'posterRevealItem'
              );
              card.style.removeProperty(
                '--poster-reveal-delay'
              );
              card.dataset.posterRevealed =
                'true';
            }
          );

          return;
        }

        if (restart) {
          cards.forEach(
            (card) => {
              card.classList.remove(
                'posterRevealItem'
              );
              delete card.dataset.posterRevealed;
            }
          );

          void root.offsetWidth;
        }

        cards.forEach(
          (card, index) => {
            const delay =
              Math.min(index, 24) * 55;

            card.style.setProperty(
              '--poster-reveal-delay',
              `${delay}ms`
            );
            card.dataset.posterRevealed =
              'true';
            card.classList.add(
              'posterRevealItem'
            );
          }
        );
      };

      const scheduleReveal = () => {
        if (animationFrame !== null) {
          window.cancelAnimationFrame(
            animationFrame
          );
        }

        animationFrame =
          window.requestAnimationFrame(
            () => {
              animationFrame = null;
              revealPosters();
            }
          );
      };

      revealPosters(true);

      const observer =
        new MutationObserver(
          (mutations) => {
            const hasNewMovieCard =
              mutations.some(
                (mutation) =>
                  Array.from(
                    mutation.addedNodes
                  ).some((node) => {
                    if (!(node instanceof Element)) {
                      return false;
                    }

                    return (
                      node.matches(
                        '.movies .movie'
                      ) ||
                      Boolean(
                        node.querySelector(
                          '.movies .movie'
                        )
                      )
                    );
                  })
              );

            if (hasNewMovieCard) {
              scheduleReveal();
            }
          }
        );

      observer.observe(
        root,
        {
          childList: true,
          subtree: true,
        }
      );

      return () => {
        observer.disconnect();

        if (animationFrame !== null) {
          window.cancelAnimationFrame(
            animationFrame
          );
        }
      };
    },
    [page]
  );


  const [
    posterSize,
    setPosterSize,
  ] =
    useState<PosterSize>(
      () => {
        const saved =
          window
            .localStorage
            .getItem(
              'merlymoviesbox-poster-size'
            );

        if (saved === 'huge') {
          return 'huge';
        }

        if (saved === 'large') {
          return 'large';
        }

        if (
          saved === 'medium' ||
          saved === 'small' ||
          saved === 'mini'
        ) {
          return 'mini';
        }

        return 'large';
      }
    );


  const [
    query,
    setQuery,
  ] =
    useState(
      ''
    );


  const [
    searchResults,
    setSearchResults,
  ] =
    useState<
      TmdbMovie[]
    >(
      []
    );


  const [
    savedMovies,
    setSavedMovies,
  ] =
    useState<
      SavedMovie[]
    >(
      []
    );


  const [
    savedAlbums,
    setSavedAlbums,
  ] =
    useState<SavedAlbum[]>(
      []
    );


  /*
   * Pendant l'intro, on reçoit les snapshots Firestore mais on ne déclenche
   * pas encore le rendu de milliers de cartes. Ils sont appliqués juste
   * après le retrait de la vidéo, sans passer par une transition React
   * différée qui pouvait laisser l'écran bloqué sur 0 / Log on.
   */
  const pendingMoviesSnapshotRef =
    useRef<SavedMovie[] | null>(null);

  const pendingAlbumsSnapshotRef =
    useRef<SavedAlbum[] | null>(null);


  /*
   * Phase de démarrage rapide : React ne reçoit d'abord que la rubrique US.
   * La collection complète est conservée ici puis appliquée après le premier
   * paint du site. Cela évite de bloquer la disparition de la barre de
   * chargement sur les calculs de toute la bibliothèque.
   */
  const deferredStartupFullMoviesRef =
    useRef<SavedMovie[] | null>(null);

  const startupFullHydrationTimerRef =
    useRef<number | null>(null);

  const startupFastPhaseRef =
    useRef(false);

  const moviesNetworkSnapshotReceivedRef =
    useRef(false);


  const [
    moviesSnapshotReady,
    setMoviesSnapshotReady,
  ] =
    useState(false);


  const [
    albumsSnapshotReady,
    setAlbumsSnapshotReady,
  ] =
    useState(false);


  const [
    lastAutoBackupAt,
    setLastAutoBackupAt,
  ] =
    useState<string | null>(
      null
    );


  const autoBackupPreviousRef =
    useRef<{
      score: number;
      backup: MerlyBackup;
    } | null>(null);


  const autoBackupSuspendedRef =
    useRef(false);


  const [
    actionHistory,
    setActionHistory,
  ] =
    useState<ActionHistoryEntry[]>(
      []
    );


  const [
    historyStorageReady,
    setHistoryStorageReady,
  ] =
    useState(false);


  const [
    historyOpen,
    setHistoryOpen,
  ] =
    useState(false);


  const [
    undoingHistoryId,
    setUndoingHistoryId,
  ] =
    useState<string | null>(
      null
    );


  const [
    selectedHistoryIds,
    setSelectedHistoryIds,
  ] =
    useState<string[]>(
      []
    );


  useEffect(
    () => {
      let cancelled = false;

      void loadStoredActionHistory().then(
        (entries) => {
          if (cancelled) {
            return;
          }

          setActionHistory(entries);
          setHistoryStorageReady(true);
        }
      );

      return () => {
        cancelled = true;
      };
    },
    []
  );


  useEffect(
    () => {
      if (!historyStorageReady) {
        return;
      }

      const cutoff =
        Date.now() - ACTION_HISTORY_RETENTION_MS;

      const kept = actionHistory
        .filter(
          (entry) => entry.createdAt >= cutoff
        )
        .slice(0, 20);

      void saveStoredActionHistory(kept);
    },
    [actionHistory, historyStorageReady]
  );


  useEffect(
    () => {
      const existingIds =
        new Set(
          actionHistory.map(
            (entry) => entry.id
          )
        );

      setSelectedHistoryIds(
        (current) =>
          current.filter(
            (id) => existingIds.has(id)
          )
      );
    },
    [actionHistory]
  );


  /*
   * Index global des occurrences d’un même film.
   *
   * getLinkedMovies() était auparavant basé sur savedMovies.filter(...), donc
   * chaque appel reparcourait toute la bibliothèque et renormalisait les titres.
   * La page VUS l’appelait depuis son tri par note, plusieurs fois par comparaison,
   * ce qui pouvait bloquer toute l’interface à chaque clic.
   *
   * Ici, les correspondances sont construites une seule fois lorsque savedMovies
   * change. Les recherches suivantes ne parcourent plus toute la collection.
   */
  const linkedMovieIndex =
    useMemo(
      () => {
        const byTmdb =
          new Map<string, SavedMovie[]>();
        const byImdb =
          new Map<string, SavedMovie[]>();
        const byTitleYear =
          new Map<string, SavedMovie[]>();
        const byTitleAny =
          new Map<string, SavedMovie[]>();
        const byTitleNoYear =
          new Map<string, SavedMovie[]>();

        const add = (
          map: Map<string, SavedMovie[]>,
          key: string,
          movie: SavedMovie
        ) => {
          if (!key) {
            return;
          }

          const current =
            map.get(key);

          if (current) {
            current.push(movie);
          } else {
            map.set(key, [movie]);
          }
        };

        for (const movie of savedMovies) {
          const mediaType =
            movie.tmdbMediaType ||
            'movie';
          const year =
            getMovieIdentityYear(movie);

          if (movie.tmdbId) {
            add(
              byTmdb,
              `${mediaType}:${movie.tmdbId}`,
              movie
            );
          }

          const imdb =
            normalizeImdbIdentity(
              movie.imdbId ||
              movie.ucpmImdbId
            );

          if (imdb) {
            add(
              byImdb,
              `${mediaType}:${imdb}`,
              movie
            );
          }

          for (const title of getMovieIdentityTitles(movie)) {
            const titleKey =
              `${mediaType}:${title}`;

            add(
              byTitleAny,
              titleKey,
              movie
            );

            if (year) {
              add(
                byTitleYear,
                `${titleKey}__${year}`,
                movie
              );
            } else {
              add(
                byTitleNoYear,
                titleKey,
                movie
              );
            }
          }
        }

        return {
          byTmdb,
          byImdb,
          byTitleYear,
          byTitleAny,
          byTitleNoYear,
        };
      },
      [savedMovies]
    );


  /* Candidats TOP US / TOP FR regroupés par année.
     Ce second niveau sert uniquement lorsque les identifiants exacts
     (TMDB / IMDb / titres alternatifs) ne suffisent pas, par exemple
     entre un titre Jellyfin anglais et son titre français dans TOP US. */
  const usFrMoviesByYear =
    useMemo(
      () => {
        const byYear =
          new Map<string, SavedMovie[]>();

        for (const movie of savedMovies) {
          if (
            !movie.rankings?.topUS &&
            !movie.rankings?.topFR
          ) {
            continue;
          }

          const year =
            String(movie.year || '')
              .match(/(?:19|20)\d{2}/)?.[0] ||
            String(movie.releaseDate || '')
              .match(/(?:19|20)\d{2}/)?.[0] ||
            '';

          if (!year) {
            continue;
          }

          const current = byYear.get(year);

          if (current) {
            current.push(movie);
          } else {
            byYear.set(year, [movie]);
          }
        }

        return byYear;
      },
      [savedMovies]
    );


  /*
   * Index rapide pour la page UCPM.
   * Avant, chaque affiche UCPM recherchait son film canonique en reparcourant
   * toute la bibliothèque plusieurs fois (titre, note, affiche). Avec 800+ films,
   * cela devenait coûteux. Ici on construit les correspondances une seule fois
   * quand savedMovies change, puis l'affichage UCPM travaille en O(1).
   */
  const ucpmCanonicalByDocId =
    useMemo(
      () => {
        const tmdbBest =
          new Map<string, SavedMovie>();
        const imdbBest =
          new Map<string, SavedMovie>();
        const titleYearBest =
          new Map<string, SavedMovie>();
        const titleAnyBest =
          new Map<string, SavedMovie>();
        const titleNoYearBest =
          new Map<string, SavedMovie>();

        const keepBest = (
          map: Map<string, SavedMovie>,
          key: string,
          movie: SavedMovie
        ) => {
          if (!key) {
            return;
          }

          const current =
            map.get(key);

          if (
            !current ||
            scoreMovieDocument(movie) >
              scoreMovieDocument(current)
          ) {
            map.set(
              key,
              movie
            );
          }
        };

        for (const movie of savedMovies) {
          if (movie.tmdbId) {
            keepBest(
              tmdbBest,
              String(movie.tmdbId),
              movie
            );
          }

          const imdb =
            normalizeImdbIdentity(
              movie.ucpmImdbId
            );

          if (imdb) {
            keepBest(
              imdbBest,
              imdb,
              movie
            );
          }

          const year =
            String(
              movie.year ||
              ''
            );

          for (const title of getMovieIdentityTitles(movie)) {
            keepBest(
              titleAnyBest,
              title,
              movie
            );

            if (year) {
              keepBest(
                titleYearBest,
                `${title}__${year}`,
                movie
              );
            } else {
              keepBest(
                titleNoYearBest,
                title,
                movie
              );
            }
          }
        }

        const byDocId =
          new Map<string, SavedMovie>();

        for (const movie of savedMovies) {
          if (!movie.ucpm) {
            continue;
          }

          const candidates =
            new Map<string, SavedMovie>();

          const addCandidate = (
            candidate?: SavedMovie
          ) => {
            if (candidate) {
              candidates.set(
                candidate.docId,
                candidate
              );
            }
          };

          addCandidate(movie);

          if (movie.tmdbId) {
            addCandidate(
              tmdbBest.get(
                String(movie.tmdbId)
              )
            );
          }

          const imdb =
            normalizeImdbIdentity(
              movie.ucpmImdbId
            );

          if (imdb) {
            addCandidate(
              imdbBest.get(imdb)
            );
          }

          const year =
            String(
              movie.year ||
              ''
            );

          for (const title of getMovieIdentityTitles(movie)) {
            if (year) {
              addCandidate(
                titleYearBest.get(
                  `${title}__${year}`
                )
              );
              addCandidate(
                titleNoYearBest.get(
                  title
                )
              );
            } else {
              addCandidate(
                titleAnyBest.get(
                  title
                )
              );
            }
          }

          const canonical =
            Array.from(
              candidates.values()
            ).sort(
              (a, b) =>
                scoreMovieDocument(b) -
                scoreMovieDocument(a)
            )[0] ||
            movie;

          byDocId.set(
            movie.docId,
            canonical
          );
        }

        return byDocId;
      },
      [savedMovies]
    );


  /*
   * Index léger des notes partagées entre les occurrences d'un même film.
   * Une seule passe sur la bibliothèque construit quelques tables de recherche.
   * Le tri n'a ensuite plus besoin de reparcourir tous les films pour chaque comparaison.
   */
  const sharedMovieRatingIndex =
    useMemo(
      () => {
        type RatingCandidate = {
          rating: number;
          priority: number;
          score: number;
          source: 'US' | 'FR' | 'UCPM' | 'VUS' | 'SERIES' | 'SELF';
        };

        const byTmdb =
          new Map<string, RatingCandidate>();
        const byImdb =
          new Map<string, RatingCandidate>();
        const byTitleYear =
          new Map<string, RatingCandidate>();
        const byTitleAny =
          new Map<string, RatingCandidate>();
        const byTitleNoYear =
          new Map<string, RatingCandidate>();

        /* L'index des notes reste vivant en permanence. Ainsi, une modification
           faite dans TOP US ou TOP FR est déjà répercutée lorsque Movie Database
           s'affiche, sans avoir besoin de recharger la page. */

        const remember = (
          index: Map<string, RatingCandidate>,
          key: string,
          movie: SavedMovie,
          rating: number
        ) => {
          if (!key) {
            return;
          }

          const source: RatingCandidate['source'] =
            movie.rankings?.topUS
              ? 'US'
              : movie.rankings?.topFR
                ? 'FR'
                : movie.ucpm
                  ? 'UCPM'
                  : (movie.diary?.length || 0) > 0
                    ? 'VUS'
                    : movie.rankings?.series
                      ? 'SERIES'
                      : 'SELF';

          const candidate: RatingCandidate = {
            rating,
            /*
             * Une seule hiérarchie de note pour Movie Database :
             * US > FR > UCPM > VUS > Séries > note propre Movie Database.
             * Movie Database ne doit jamais pouvoir contredire une liste
             * qui fait autorité pour ce film.
             */
            priority:
              source === 'US'
                ? 6
                : source === 'FR'
                  ? 5
                  : source === 'UCPM'
                    ? 4
                    : source === 'VUS'
                      ? 3
                      : source === 'SERIES'
                        ? 2
                        : 1,
            score:
              scoreMovieDocument(
                movie
              ),
            source,
          };

          const current =
            index.get(key);

          if (
            !current ||
            candidate.priority > current.priority ||
            (candidate.priority === current.priority &&
              candidate.score > current.score)
          ) {
            index.set(
              key,
              candidate
            );
          }
        };

        for (const movie of savedMovies) {
          if (
            movie.rating == null ||
            !Number.isFinite(
              Number(movie.rating)
            )
          ) {
            continue;
          }

          const rating =
            Number(movie.rating);
          const mediaType =
            movie.tmdbMediaType ||
            'movie';
          const year =
            String(movie.year || '');

          if (movie.tmdbId) {
            remember(
              byTmdb,
              `${mediaType}:${movie.tmdbId}`,
              movie,
              rating
            );
          }

          const imdb =
            normalizeImdbIdentity(
              movie.imdbId ||
              movie.ucpmImdbId
            );

          if (imdb) {
            remember(
              byImdb,
              `${mediaType}:${imdb}`,
              movie,
              rating
            );
          }

          for (const title of getMovieIdentityTitles(movie)) {
            remember(
              byTitleAny,
              `${mediaType}:${title}`,
              movie,
              rating
            );

            if (year) {
              remember(
                byTitleYear,
                `${mediaType}:${title}__${year}`,
                movie,
                rating
              );
            } else {
              remember(
                byTitleNoYear,
                `${mediaType}:${title}`,
                movie,
                rating
              );
            }
          }
        }

        return {
          byTmdb,
          byImdb,
          byTitleYear,
          byTitleAny,
          byTitleNoYear,
        };
      },
      [savedMovies]
    );


  function getUcpmCanonicalMovie(
    movie: SavedMovie
  ) {
    return (
      ucpmCanonicalByDocId.get(
        movie.docId
      ) ||
      movie
    );
  }


  function historyMovieSnapshot(
    movie: SavedMovie
  ): HistoryDocumentSnapshot {
    const {
      docId,
      ...data
    } = movie;

    return {
      collection: 'movies',
      docId,
      data,
    };
  }


  function historyAlbumSnapshot(
    album: SavedAlbum
  ): HistoryDocumentSnapshot {
    const {
      docId,
      ...data
    } = album;

    return {
      collection: 'albums',
      docId,
      data,
    };
  }


  function snapshotMovieIds(
    ids: Iterable<string>
  ) {
    const byId =
      new Map<string, SavedMovie>(
        savedMovies.map(
          (movie) => [
            movie.docId,
            movie,
          ] as const
        )
      );

    return Array.from(
      new Set(ids)
    ).map(
      (docId):
        HistoryDocumentSnapshot => {
        const movie =
          byId.get(docId);

        return movie
          ? historyMovieSnapshot(
              movie
            )
          : {
              collection:
                'movies',
              docId,
              data: null,
            };
      }
    );
  }


  function snapshotAlbumIds(
    ids: Iterable<string>
  ) {
    const byId =
      new Map<string, SavedAlbum>(
        savedAlbums.map(
          (album) => [
            album.docId,
            album,
          ] as const
        )
      );

    return Array.from(
      new Set(ids)
    ).map(
      (docId):
        HistoryDocumentSnapshot => {
        const album =
          byId.get(docId);

        return album
          ? historyAlbumSnapshot(
              album
            )
          : {
              collection:
                'albums',
              docId,
              data: null,
            };
      }
    );
  }


  function snapshotFullHistory(
    collectionsToCapture:
      HistoryCollectionName[]
  ) {
    const snapshots:
      HistoryDocumentSnapshot[] = [];

    if (
      collectionsToCapture.includes(
        'movies'
      )
    ) {
      snapshots.push(
        ...savedMovies.map(
          historyMovieSnapshot
        )
      );
    }

    if (
      collectionsToCapture.includes(
        'albums'
      )
    ) {
      snapshots.push(
        ...savedAlbums.map(
          historyAlbumSnapshot
        )
      );
    }

    return snapshots;
  }


  function addHistoryEntry(
    label: string,
    snapshots:
      HistoryDocumentSnapshot[],
    fullCollections:
      HistoryCollectionName[] = []
  ) {
    if (
      snapshots.length === 0 &&
      fullCollections.length === 0
    ) {
      return;
    }

    const deduped =
      new Map<
        string,
        HistoryDocumentSnapshot
      >();

    for (
      const snapshot
      of snapshots
    ) {
      deduped.set(
        `${snapshot.collection}:${snapshot.docId}`,
        snapshot
      );
    }

    const entry:
      ActionHistoryEntry = {
      id:
        `${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      label,
      createdAt:
        Date.now(),
      snapshots:
        Array.from(
          deduped.values()
        ),
      fullCollections:
        Array.from(
          new Set(
            fullCollections
          )
        ),
    };

    setActionHistory(
      (current) => [
        entry,
        ...current,
      ].slice(
        0,
        20
      )
    );
  }


  async function restoreHistoryDocuments(
    snapshots:
      HistoryDocumentSnapshot[]
  ) {
    if (!user) {
      return;
    }

    for (
      let start = 0;
      start <
      snapshots.length;
      start += 350
    ) {
      const batch =
        writeBatch(db);

      for (
        const snapshot
        of snapshots.slice(
          start,
          start + 350
        )
      ) {
        const targetRef =
          doc(
            db,
            'users',
            user.uid,
            snapshot.collection,
            snapshot.docId
          );

        if (
          snapshot.data ===
          null
        ) {
          batch.delete(
            targetRef
          );
        } else {
          batch.set(
            targetRef,
            snapshot.data
          );
        }
      }

      await batch.commit();
    }
  }


  async function restoreFullHistoryCollection(
    collectionName:
      HistoryCollectionName,
    snapshots:
      HistoryDocumentSnapshot[]
  ) {
    if (!user) {
      return;
    }

    const before =
      snapshots.filter(
        (snapshot) =>
          snapshot.collection ===
            collectionName &&
          snapshot.data !==
            null
      );

    const beforeIds =
      new Set(
        before.map(
          (snapshot) =>
            snapshot.docId
        )
      );

    const live =
      await getDocs(
        collection(
          db,
          'users',
          user.uid,
          collectionName
        )
      );

    const deletions:
      HistoryDocumentSnapshot[] =
      live.docs
        .filter(
          (document) =>
            !beforeIds.has(
              document.id
            )
        )
        .map(
          (document) => ({
            collection:
              collectionName,
            docId:
              document.id,
            data:
              null,
          })
        );

    await restoreHistoryDocuments(
      [
        ...deletions,
        ...before,
      ]
    );
  }


  async function restoreHistoryEntry(
    entry:
      ActionHistoryEntry
  ) {
    const fullCollections =
      new Set(
        entry.fullCollections ||
        []
      );

    for (
      const collectionName
      of fullCollections
    ) {
      await restoreFullHistoryCollection(
        collectionName,
        entry.snapshots
      );
    }

    const partialSnapshots =
      entry.snapshots.filter(
        (snapshot) =>
          !fullCollections.has(
            snapshot.collection
          )
      );

    await restoreHistoryDocuments(
      partialSnapshots
    );
  }


  function toggleHistorySelection(
    entry:
      ActionHistoryEntry
  ) {
    if (undoingHistoryId) {
      return;
    }

    setSelectedHistoryIds(
      (current) =>
        current.includes(entry.id)
          ? current.filter(
              (id) => id !== entry.id
            )
          : [...current, entry.id]
    );
  }


  async function undoSelectedHistoryEntries() {
    if (
      !user ||
      undoingHistoryId ||
      selectedHistoryIds.length === 0
    ) {
      return;
    }

    const selectedSet =
      new Set(selectedHistoryIds);

    /* actionHistory est stocké du plus récent au plus ancien.
       Pour annuler plusieurs actions correctement, on restaure donc
       d'abord la plus récente, puis on remonte dans le temps. */
    const entriesToUndo =
      actionHistory.filter(
        (entry) => selectedSet.has(entry.id)
      );

    if (entriesToUndo.length === 0) {
      setSelectedHistoryIds([]);
      return;
    }

    try {
      setUndoingHistoryId(
        '__history_selection__'
      );

      for (const entry of entriesToUndo) {
        await restoreHistoryEntry(entry);
      }

      setActionHistory(
        (current) =>
          current.filter(
            (entry) =>
              !selectedSet.has(entry.id)
          )
      );

      setSelectedHistoryIds([]);

      setMessage(
        `${entriesToUndo.length} action${entriesToUndo.length > 1 ? 's' : ''} annulée${entriesToUndo.length > 1 ? 's' : ''}.`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        "Impossible d'annuler la sélection."
      );
    } finally {
      setUndoingHistoryId(
        null
      );
    }
  }


  function formatHistoryTime(
    timestamp: number
  ) {
    return new Date(
      timestamp
    ).toLocaleTimeString(
      'fr-FR',
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    );
  }


  const [
    loading,
    setLoading,
  ] =
    useState(
      false
    );


  const [
    message,
    setMessage,
  ] =
    useState(
      ''
    );


  const [
    addingMovie,
    setAddingMovie,
  ] =
    useState<
      number | null
    >(
      null
    );


  const [
    backupMessage,
    setBackupMessage,
  ] =
    useState(
      ''
    );


  const [
    restoringBackup,
    setRestoringBackup,
  ] =
    useState(
      false
    );


  const [
    importing,
    setImporting,
  ] =
    useState(
      false
    );


  const [
    importProgress,
    setImportProgress,
  ] =
    useState(
      ''
    );


  const [
    ucpmImporting,
    setUcpmImporting,
  ] =
    useState(
      false
    );


  const [
    ucpmImportProgress,
    setUcpmImportProgress,
  ] =
    useState(
      ''
    );


  const [
    jellyfinImporting,
    setJellyfinImporting,
  ] =
    useState(
      false
    );


  const [
    jellyfinImportProgress,
    setJellyfinImportProgress,
  ] =
    useState(
      ''
    );


  const [
    diaryCsvImporting,
    setDiaryCsvImporting,
  ] =
    useState(
      false
    );


  const [
    diaryCsvImportProgress,
    setDiaryCsvImportProgress,
  ] =
    useState(
      ''
    );


  const [
    enriching,
    setEnriching,
  ] =
    useState(
      false
    );


  const [
    enrichmentMessage,
    setEnrichmentMessage,
  ] =
    useState(
      ''
    );


  const [
    enrichmentStats,
    setEnrichmentStats,
  ] =
    useState<
      EnrichmentStats
    >({
      current: 0,
      total: 0,
      matched: 0,
      unmatched: 0,
      errors: 0,
      currentMovie: '',
    });


  const [
    updatingFrenchTitles,
    setUpdatingFrenchTitles,
  ] =
    useState(
      false
    );


  const [
    frenchTitleMessage,
    setFrenchTitleMessage,
  ] =
    useState(
      ''
    );


  const [
    frenchTitleStats,
    setFrenchTitleStats,
  ] =
    useState<
      FrenchTitleStats
    >({
      current: 0,
      total: 0,
      updated: 0,
      errors: 0,
      currentMovie: '',
    });


  const [
    selectedVerifyMovie,
    setSelectedVerifyMovie,
  ] =
    useState<
      SavedMovie | null
    >(
      null
    );


  const [
    verifyQuery,
    setVerifyQuery,
  ] =
    useState(
      ''
    );


  const [
    verifyResults,
    setVerifyResults,
  ] =
    useState<
      TmdbMovie[]
    >(
      []
    );


  const [
    verifyLoading,
    setVerifyLoading,
  ] =
    useState(
      false
    );


  const [
    associatingMovie,
    setAssociatingMovie,
  ] =
    useState<
      number | null
    >(
      null
    );


  const [
    deletingVerifyMovieId,
    setDeletingVerifyMovieId,
  ] =
    useState<string | null>(
      null
    );


  const [
    selectedVerifyMovieIds,
    setSelectedVerifyMovieIds,
  ] =
    useState<Set<string>>(
      () => new Set()
    );


  const [
    pendingTmdbOpen,
    setPendingTmdbOpen,
  ] =
    useState(false);


  const [
    selectedPendingTmdbIds,
    setSelectedPendingTmdbIds,
  ] =
    useState<Set<string>>(
      () => new Set()
    );


  const [
    deletingPendingTmdb,
    setDeletingPendingTmdb,
  ] =
    useState(false);


  const [
    deletingPendingTmdbId,
    setDeletingPendingTmdbId,
  ] =
    useState<string | null>(null);


  const [
    verifyViewMode,
    setVerifyViewMode,
  ] =
    useState<VerifyViewMode>(
      () =>
        window.localStorage.getItem('merylmoviesbox-verify-view') === 'slideshow'
          ? 'slideshow'
          : 'list'
    );


  const [
    recentAddedOpen,
    setRecentAddedOpen,
  ] =
    useState(false);


  const [
    deletingRecentMovieId,
    setDeletingRecentMovieId,
  ] =
    useState<string | null>(null);


  const [
    bulkDeletingVerify,
    setBulkDeletingVerify,
  ] =
    useState(false);


  const [
    basicImportingVerify,
    setBasicImportingVerify,
  ] =
    useState(false);


  const [
    basicImportVerifyProgress,
    setBasicImportVerifyProgress,
  ] =
    useState('');


  const [
    imdbCode,
    setImdbCode,
  ] =
    useState(
      ''
    );


  const [
    imdbLookupLoading,
    setImdbLookupLoading,
  ] =
    useState(
      false
    );


  const [
    selectedPosterMovie,
    setSelectedPosterMovie,
  ] =
    useState<
      SavedMovie | null
    >(
      null
    );


  const [
    posterOptions,
    setPosterOptions,
  ] =
    useState<
      TmdbPoster[]
    >(
      []
    );


  const [
    posterFilter,
    setPosterFilter,
  ] =
    useState<
      PosterFilter
    >(
      'all'
    );


  const [
    posterLoading,
    setPosterLoading,
  ] =
    useState(
      false
    );


  const [
    posterMessage,
    setPosterMessage,
  ] =
    useState(
      ''
    );


  const [
    savingPosterPath,
    setSavingPosterPath,
  ] =
    useState<
      string | null
    >(
      null
    );


  const [
    selectedTitleMovie,
    setSelectedTitleMovie,
  ] =
    useState<
      SavedMovie | null
    >(
      null
    );


  const [
    titleOptions,
    setTitleOptions,
  ] =
    useState<
      TitleOption[]
    >(
      []
    );


  const [
    titleFilter,
    setTitleFilter,
  ] =
    useState<
      TitleFilter
    >(
      'all'
    );


  const [
    titleLoading,
    setTitleLoading,
  ] =
    useState(
      false
    );


  const [
    titleMessage,
    setTitleMessage,
  ] =
    useState(
      ''
    );


  const [
    savingTitleValue,
    setSavingTitleValue,
  ] =
    useState<
      string | null
    >(
      null
    );


  const jellyfinRecentSortAfterImportRef =
    useRef(false);


  const [
    sortMode,
    setSortMode,
  ] =
    useState<MovieSortMode>(
      'rating-desc'
    );


  const [
    lpSortMode,
    setLpSortMode,
  ] =
    useState<MovieSortMode>(
      'rating-desc'
    );


  const [
    diarySortMode,
    setDiarySortMode,
  ] =
    useState<MovieSortMode>(
      'ranking'
    );


  useEffect(
    () => {
      if (
        page === 'topUS' ||
        page === 'topFR' ||
        page === 'soundtracks' ||
        page === 'series'
      ) {
        setSortMode(
          'rating-desc'
        );
      } else if (
        page === 'watchlist'
      ) {
        setSortMode(
          'added-desc'
        );
      } else if (
        page === 'jellyfin'
      ) {
        setSortMode(
          jellyfinRecentSortAfterImportRef.current
            ? 'added-desc'
            : 'rating-desc'
        );
        jellyfinRecentSortAfterImportRef.current = false;
      } else if (
        page === 'ucpm'
      ) {
        setSortMode(
          'ranking'
        );
      } else if (
        page === 'diary'
      ) {
        setDiarySortMode(
          'ranking'
        );
      } else if (
        page === 'lp'
      ) {
        setLpSortMode(
          'rating-desc'
        );
      }
    },
    [page]
  );


  const [
    selectedMovieMenu,
    setSelectedMovieMenu,
  ] =
    useState<
      SavedMovie | null
    >(
      null
    );


  const [
    posterEraseMovieId,
    setPosterEraseMovieId,
  ] =
    useState<string | null>(
      null
    );


  const [
    reviewSavingMovieId,
    setReviewSavingMovieId,
  ] =
    useState<string | null>(
      null
    );


  const [
    posterEraseAlbumId,
    setPosterEraseAlbumId,
  ] =
    useState<string | null>(
      null
    );


  const [
    movieMenuRating,
    setMovieMenuRating,
  ] =
    useState(
      ''
    );


  const [
    movieMenuTitle,
    setMovieMenuTitle,
  ] =
    useState(
      ''
    );


  const [
    movieMenuYear,
    setMovieMenuYear,
  ] =
    useState(
      ''
    );


  const [
    movieMenuInitialRating,
    setMovieMenuInitialRating,
  ] =
    useState(
      ''
    );


  const [
    movieMenuInitialTitle,
    setMovieMenuInitialTitle,
  ] =
    useState(
      ''
    );


  const [
    movieMenuInitialYear,
    setMovieMenuInitialYear,
  ] =
    useState(
      ''
    );


  const [
    selectedDiaryEntry,
    setSelectedDiaryEntry,
  ] =
    useState<DiaryEntry | null>(
      null
    );


  const [
    diaryYearPageIndex,
    setDiaryYearPageIndex,
  ] =
    useState(0);


  const [
    posterPickerScope,
    setPosterPickerScope,
  ] =
    useState<'movie' | 'soundtrack'>(
      'movie'
    );


  const [
    reorderMode,
    setReorderMode,
  ] =
    useState(
      false
    );


  const [
    reorderMovies,
    setReorderMovies,
  ] =
    useState<SavedMovie[]>(
      []
    );


  const [
    reorderDirty,
    setReorderDirty,
  ] =
    useState(
      false
    );


  const [
    lpReorderMode,
    setLpReorderMode,
  ] =
    useState(false);


  const [
    lpReorderAlbums,
    setLpReorderAlbums,
  ] =
    useState<SavedAlbum[]>([]);


  const [
    lpReorderDirty,
    setLpReorderDirty,
  ] =
    useState(false);


  const [
    mobileMovieAction,
    setMobileMovieAction,
  ] =
    useState<{
      movie: SavedMovie;
      diaryEntry: DiaryEntry | null;
      anchorRect?: {
        left: number;
        right: number;
        top: number;
        bottom: number;
      };
    } | null>(null);


  const [
    mobileMovieActionSaving,
    setMobileMovieActionSaving,
  ] =
    useState(false);


  const [
    multiSelectMode,
    setMultiSelectMode,
  ] = useState(false);


  const [
    multiSelectMovies,
    setMultiSelectMovies,
  ] = useState<SavedMovie[]>([]);


  const [
    multiSelectSavingTarget,
    setMultiSelectSavingTarget,
  ] = useState<MultiSelectTarget | null>(null);


  const [
    mobileReorderFocusId,
    setMobileReorderFocusId,
  ] =
    useState<string | null>(null);


  const [
    movieMenuMessage,
    setMovieMenuMessage,
  ] =
    useState(
      ''
    );


  const [
    savingMovieMenu,
    setSavingMovieMenu,
  ] =
    useState(
      false
    );


  /*
   * NOTE RAPIDE
   * Permet de noter directement depuis les grilles sans ouvrir la fiche.
   * Une seule saisie rapide est active à la fois.
   */
  const [
    quickRatingKey,
    setQuickRatingKey,
  ] =
    useState<string | null>(
      null
    );


  const [
    quickRatingValue,
    setQuickRatingValue,
  ] =
    useState(
      ''
    );


  const [
    quickRatingSavingKey,
    setQuickRatingSavingKey,
  ] =
    useState<string | null>(
      null
    );


  const [
    quickRatingErrorKey,
    setQuickRatingErrorKey,
  ] =
    useState<string | null>(
      null
    );


  const [
    quickRatingPresetPicker,
    setQuickRatingPresetPicker,
  ] =
    useState<{
      ratingKey: string;
      left: number;
      top: number;
      placement: 'above' | 'below';
      value: number;
    } | null>(null);


  const quickRatingLongPressTimerRef =
    useRef<number | null>(null);

  const quickRatingLongPressConsumedKeyRef =
    useRef<string | null>(null);


  /* Empêche la molette de faire défiler la page pendant le réglage rapide.
     L'écoute native non passive est nécessaire pour bloquer le scroll du
     document tout en laissant l'événement atteindre le bouton React. */
  useEffect(() => {
    if (!quickRatingPresetPicker) {
      return;
    }

    const blockPageScrollWhileRating = (event: WheelEvent) => {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('.quickRatingPresetPopover')
      ) {
        event.preventDefault();
      }
    };

    document.addEventListener(
      'wheel',
      blockPageScrollWhileRating,
      { passive: false, capture: true }
    );

    return () => {
      document.removeEventListener(
        'wheel',
        blockPageScrollWhileRating,
        true
      );
    };
  }, [quickRatingPresetPicker?.ratingKey]);


  /*
   * Historique local des dernières notes saisies depuis « À NOTER ».
   * Chaque clic sur Annuler restaure exactement l'état du film avant la note.
   * La pile reste disponible tant que l'application reste ouverte.
   */
  const [
    unratedNoteUndoStack,
    setUnratedNoteUndoStack,
  ] =
    useState<UnratedNoteUndoEntry[]>([]);


  const [
    undoingUnratedNoteId,
    setUndoingUnratedNoteId,
  ] =
    useState<string | null>(null);


  /* Le mini-menu d'appui long n'ouvre plus automatiquement l'éditeur de note. */


  const [
    uploadingPoster,
    setUploadingPoster,
  ] =
    useState(
      false
    );


  const [
    addTarget,
    setAddTarget,
  ] =
    useState<
      AddTarget | null
    >(
      null
    );


  const [
    addQuery,
    setAddQuery,
  ] =
    useState(
      ''
    );


  const [
    addResults,
    setAddResults,
  ] =
    useState<
      TmdbMovie[]
    >(
      []
    );


  const [
    addSuggestions,
    setAddSuggestions,
  ] =
    useState<TmdbMovie[]>([]);


  const [
    addSuggestionsLoading,
    setAddSuggestionsLoading,
  ] =
    useState(false);


  const addSuggestionSelectedQueryRef =
    useRef('');


  const [
    addLoading,
    setAddLoading,
  ] =
    useState(
      false
    );


  const [movieMenuSearchQuery, setMovieMenuSearchQuery] = useState('');
  const [movieMenuSearchResults, setMovieMenuSearchResults] = useState<TmdbMovie[]>([]);
  const [movieMenuSearchLoading, setMovieMenuSearchLoading] = useState(false);

  const [movieMenuPosterLookupLoading, setMovieMenuPosterLookupLoading] = useState(false);

  const [selectedSoundtrackSearchMovie, setSelectedSoundtrackSearchMovie] = useState<SavedMovie | null>(null);
  const [soundtrackSearchQuery, setSoundtrackSearchQuery] = useState('');
  const [soundtrackSearchResults, setSoundtrackSearchResults] = useState<ItunesAlbum[]>([]);
  const [soundtrackSearchLoading, setSoundtrackSearchLoading] = useState(false);
  const [soundtrackSearchMessage, setSoundtrackSearchMessage] = useState('');


  const [
    ucpmComposerOpen,
    setUcpmComposerOpen,
  ] = useState(false);

  const [
    ucpmComposerMode,
    setUcpmComposerMode,
  ] = useState<'podcast' | 'sixfilms'>('podcast');

  const [
    ucpmComposerItems,
    setUcpmComposerItems,
  ] = useState<UcpmComposerItem[]>([]);

  const [
    ucpmComposerQuery,
    setUcpmComposerQuery,
  ] = useState('');

  const [
    ucpmComposerResults,
    setUcpmComposerResults,
  ] = useState<TmdbMovie[]>([]);

  const [
    ucpmComposerLocalResults,
    setUcpmComposerLocalResults,
  ] = useState<SavedMovie[]>([]);

  const [
    ucpmComposerSixFilmsNumber,
    setUcpmComposerSixFilmsNumber,
  ] = useState(1);

  const [
    ucpmComposerSearching,
    setUcpmComposerSearching,
  ] = useState(false);

  const [
    ucpmComposerSaving,
    setUcpmComposerSaving,
  ] = useState(false);

  const [
    ucpmComposerMessage,
    setUcpmComposerMessage,
  ] = useState('');

  const [
    deletingUcpmSixFilmsGroup,
    setDeletingUcpmSixFilmsGroup,
  ] = useState<number | null>(null);

  const [
    editingUcpmSixFilmsGroup,
    setEditingUcpmSixFilmsGroup,
  ] = useState<{
    number: number;
    groupId: string | null;
    groupOrder: number;
    startPosition: number;
    originalDocIds: string[];
  } | null>(null);


  const [
    addMessage,
    setAddMessage,
  ] =
    useState(
      ''
    );


  const [
    addingToSection,
    setAddingToSection,
  ] =
    useState<
      number | null
    >(
      null
    );


  const [
    addDiaryDate,
    setAddDiaryDate,
  ] =
    useState(
      () =>
        new Date()
          .toISOString()
          .slice(
            0,
            10
          )
    );


  const [
    addDiaryMediaType,
    setAddDiaryMediaType,
  ] =
    useState<'movie' | 'tv'>(
      'movie'
    );


  const [
    lpAddOpen,
    setLpAddOpen,
  ] =
    useState(false);


  const [
    lpSearchQuery,
    setLpSearchQuery,
  ] =
    useState('');


  const [
    lpSearchResults,
    setLpSearchResults,
  ] =
    useState<ItunesAlbum[]>([]);


  const [
    lpSuggestions,
    setLpSuggestions,
  ] =
    useState<ItunesAlbum[]>([]);


  const [
    lpSuggestionsLoading,
    setLpSuggestionsLoading,
  ] =
    useState(false);


  const [
    lpSearchLoading,
    setLpSearchLoading,
  ] =
    useState(false);


  const [
    lpAddMessage,
    setLpAddMessage,
  ] =
    useState('');


  const [
    lpItunesIdOpen,
    setLpItunesIdOpen,
  ] =
    useState(false);


  const [
    lpItunesIdInput,
    setLpItunesIdInput,
  ] =
    useState('');


  const [
    lpItunesIdLoading,
    setLpItunesIdLoading,
  ] =
    useState(false);


  const [
    addingLpAlbum,
    setAddingLpAlbum,
  ] =
    useState<number | null>(null);


  const [
    lpCsvImporting,
    setLpCsvImporting,
  ] =
    useState(false);


  const [
    lpCsvImportProgress,
    setLpCsvImportProgress,
  ] =
    useState('');


  const [
    selectedLpCoverAlbum,
    setSelectedLpCoverAlbum,
  ] =
    useState<SavedAlbum | null>(null);


  const [
    lpCoverYear,
    setLpCoverYear,
  ] =
    useState('');


  const [
    savingLpYear,
    setSavingLpYear,
  ] =
    useState(false);


  const [
    lpCoverRating,
    setLpCoverRating,
  ] =
    useState('');


  const [
    savingLpRating,
    setSavingLpRating,
  ] =
    useState(false);


  const [
    lpCoverSearchQuery,
    setLpCoverSearchQuery,
  ] =
    useState('');


  const [
    lpCoverSearchResults,
    setLpCoverSearchResults,
  ] =
    useState<ItunesAlbum[]>([]);


  const [
    lpCoverSearchLoading,
    setLpCoverSearchLoading,
  ] =
    useState(false);


  const [
    lpCoverMessage,
    setLpCoverMessage,
  ] =
    useState('');


  const [
    lpCoverExternalIdInput,
    setLpCoverExternalIdInput,
  ] =
    useState('');


  const [
    lpCoverExternalIdLoading,
    setLpCoverExternalIdLoading,
  ] =
    useState<'itunes' | 'musicboard' | null>(null);


  const [
    savingLpCover,
    setSavingLpCover,
  ] =
    useState<number | null>(null);


  const [
    uploadingLpCover,
    setUploadingLpCover,
  ] =
    useState(false);


  const [
    deletingLpAlbum,
    setDeletingLpAlbum,
  ] =
    useState(false);


  const addSearchInputRef =
    useRef<HTMLInputElement | null>(
      null
    );


  const moviePosterUploadInputRef =
    useRef<HTMLInputElement | null>(null);


  const moviePosterClickTimerRef =
    useRef<number | null>(null);


  const mobileActionPosterClickTimerRef =
    useRef<number | null>(null);


  const lpCoverUploadInputRef =
    useRef<HTMLInputElement | null>(null);


  const lpCoverClickTimerRef =
    useRef<number | null>(null);


  const stopRequested =
    useRef(
      false
    );


  const stopFrenchTitlesRequested =
    useRef(
      false
    );


  const reorderDragIdRef =
    useRef<string | null>(
      null
    );


  const reorderMovedIdsRef =
    useRef<Set<string>>(
      new Set()
    );


  const lpReorderDragIdRef =
    useRef<string | null>(
      null
    );


  const lpReorderMovedIdsRef =
    useRef<Set<string>>(
      new Set()
    );


  const mobileHoldTimerRef =
    useRef<number | null>(
      null
    );


  const mobileHoldStartRef =
    useRef<{
      x: number;
      y: number;
    } | null>(null);


  const suppressMobileMovieClickRef =
    useRef<string | null>(
      null
    );


  const diaryAddLockRef =
    useRef(
      new Set<string>()
    );


  const swipeStartRef =
    useRef<{
      x: number;
      y: number;
    } | null>(
      null
    );


  const swipePages: Page[] = [
    'topUS',
    'topFR',
    'soundtracks',
    'ucpm',
    'diary',
    'lp',
    'series',
    'verify',
    'search',
    'import',
  ];


  const soundtrackMigrationRequested =
    useRef(
      new Set<string>()
    );


  const movieTitleCleanupRunningRef =
    useRef(false);


  const ucpmSixFilmsPosterRepairRequested =
    useRef(
      new Set<string>()
    );


  /* Réparation manuelle des affiches manquantes dans Movie Database.
     Le bouton COVER n'apparaît que lorsqu'il reste des cases vides. */
  const [
    movieDatabaseCoverRunning,
    setMovieDatabaseCoverRunning,
  ] =
    useState(false);

  const [
    movieDatabaseCoverCancelRequested,
    setMovieDatabaseCoverCancelRequested,
  ] =
    useState(false);

  const movieDatabaseCoverCancelRequestedRef =
    useRef(false);

  const [
    movieDatabaseCoverCancelMenuOpen,
    setMovieDatabaseCoverCancelMenuOpen,
  ] =
    useState(false);

  const movieDatabaseCoverRollbackRequestedRef =
    useRef(false);

  const [
    movieDatabaseCoverCurrentTitle,
    setMovieDatabaseCoverCurrentTitle,
  ] =
    useState('');

  const [
    movieDatabaseCoverRecentTitles,
    setMovieDatabaseCoverRecentTitles,
  ] =
    useState<string[]>([]);

  /* Synchronisation persistante des affiches Movie Database avec les listes
     prioritaires. Un petit compteur interne permet de refaire un passage une
     fois le batch terminé si le listener Firestore a reçu des changements
     pendant la synchronisation. */
  const movieDatabasePosterSyncRunningRef =
    useRef(false);


  const apiKey =
    import.meta.env
      .VITE_TMDB_API_KEY;


  /*
   * Caches réseau de session.
   * Ils évitent de redemander plusieurs fois les mêmes métadonnées quand
   * on ouvre successivement le menu d'un film, le sélecteur d'affiche ou
   * qu'une réparation UCPM travaille sur la même fiche.
   * Les promesses en cours sont aussi partagées : deux appels simultanés
   * vers la même ressource ne déclenchent donc qu'une seule requête HTTP.
   */
  const tmdbPostersCacheRef =
    useRef(
      new Map<string, Promise<TmdbPoster[]>>()
    );


  const tmdbFrenchTitleCacheRef =
    useRef(
      new Map<string, Promise<string | null>>()
    );


  const itunesAlbumsCacheRef =
    useRef(
      new Map<string, Promise<ItunesAlbum[]>>()
    );


  async function fetchItunesAlbums(
    url: string
  ): Promise<ItunesAlbum[]> {
    const cached =
      itunesAlbumsCacheRef.current.get(url);

    if (cached) {
      return cached;
    }

    const request =
      (async () => {
        const response =
          await fetch(url);

        if (!response.ok) {
          throw new Error('Erreur iTunes');
        }

        const data =
          await response.json();

        return Array.isArray(data.results)
          ? data.results as ItunesAlbum[]
          : [];
      })();

    itunesAlbumsCacheRef.current.set(
      url,
      request
    );

    try {
      return await request;
    } catch (error) {
      /* Une erreur temporaire ne doit jamais rester mémorisée. */
      itunesAlbumsCacheRef.current.delete(url);
      throw error;
    }
  }


  /* Ferme l'éditeur / sélecteur de note dès qu'un clic ou appui se fait ailleurs. */
  useEffect(() => {
    if (!quickRatingKey && !quickRatingPresetPicker) {
      return;
    }

    const handleOutsideQuickRating = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;

      if (
        target?.closest(
          '[data-quick-rating-ui="true"]'
        )
      ) {
        return;
      }

      closeQuickRating();
    };

    document.addEventListener(
      'pointerdown',
      handleOutsideQuickRating,
      true
    );

    return () => {
      document.removeEventListener(
        'pointerdown',
        handleOutsideQuickRating,
        true
      );
    };
  }, [quickRatingKey, quickRatingSavingKey, quickRatingPresetPicker]);


  useEffect(() => {
    return () => {
      if (quickRatingLongPressTimerRef.current != null) {
        window.clearTimeout(
          quickRatingLongPressTimerRef.current
        );
      }
    };
  }, []);


  /*
   * PAGE « À NOTER » : après Entrée, le film courant disparaît de la file
   * une fois sa note enregistrée. Le champ du film suivant est donc remonté
   * ailleurs dans le DOM. On refait explicitement le focus après ce rendu,
   * au lieu de dépendre uniquement de autoFocus.
   */
  useEffect(() => {
    if (
      page !== 'unrated' ||
      !quickRatingKey ||
      quickRatingSavingKey === quickRatingKey
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        '.unratedQueueCard .quickRatingInput'
      );

      if (!input) {
        return;
      }

      input.focus();
      input.select();
      input.scrollIntoView({
        behavior: 'auto',
        block: 'nearest',
        inline: 'nearest',
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [page, quickRatingKey, quickRatingSavingKey]);


  /* Suggestions de titres TMDb pendant la saisie dans la fenêtre +. */
  useEffect(() => {
    const query = addQuery.trim();

    if (addSuggestionSelectedQueryRef.current) {
      if (
        normalizeTitle(addSuggestionSelectedQueryRef.current) ===
        normalizeTitle(query)
      ) {
        addSuggestionSelectedQueryRef.current = '';
        setAddSuggestions([]);
        setAddSuggestionsLoading(false);
        return;
      }

      addSuggestionSelectedQueryRef.current = '';
    }

    if (
      !addTarget ||
      !apiKey ||
      query.length < 2 ||
      extractImdbId(query)
    ) {
      setAddSuggestions([]);
      setAddSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setAddSuggestionsLoading(true);

        const mediaType: 'movie' | 'tv' =
          addTarget === 'series'
            ? 'tv'
            : addTarget === 'diary'
            ? addDiaryMediaType
            : 'movie';

        const response = await fetch(
          `https://api.themoviedb.org/3/search/${mediaType}?api_key=${apiKey}&language=fr-FR&include_adult=false&query=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error('Erreur TMDb');
        }

        const data = await response.json();
        const suggestions: TmdbMovie[] =
          (Array.isArray(data.results) ? data.results : [])
            .slice(0, 7)
            .map((item: any) => ({
              id: item.id,
              title: item.title || item.name || '',
              original_title:
                item.original_title ||
                item.original_name ||
                '',
              release_date:
                item.release_date ||
                item.first_air_date ||
                '',
              poster_path: item.poster_path || null,
              backdrop_path: item.backdrop_path || null,
              overview: item.overview || '',
            }))
            .filter((item: TmdbMovie) => item.title);

        setAddSuggestions(suggestions);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error(error);
          setAddSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setAddSuggestionsLoading(false);
        }
      }
    }, 260);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [addQuery, addTarget, addDiaryMediaType, apiKey]);


  /* Suggestions iTunes pour LP pendant la saisie. */
  useEffect(() => {
    const query = lpSearchQuery.trim();

    if (!lpAddOpen || query.length < 2) {
      setLpSuggestions([]);
      setLpSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setLpSuggestionsLoading(true);
        const response = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&country=FR&limit=8`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error('Erreur iTunes');
        }

        const data = await response.json();
        setLpSuggestions(
          Array.isArray(data.results)
            ? data.results.slice(0, 8)
            : []
        );
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error(error);
          setLpSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLpSuggestionsLoading(false);
        }
      }
    }, 260);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [lpSearchQuery, lpAddOpen]);


  function getStartupTopUsMovies(
    list: SavedMovie[]
  ) {
    const topUs = list.filter(
      (movie) => Boolean(movie.rankings?.topUS)
    );

    /* Une base très ancienne pourrait ne pas encore avoir rankings.topUS.
       Dans ce cas, quelques fiches suffisent pour ne jamais bloquer l'écran. */
    return topUs.length > 0
      ? topUs
      : list.slice(0, 60);
  }


  function scheduleDeferredStartupMovies(
    delay = 260
  ) {
    const pending =
      deferredStartupFullMoviesRef.current;

    if (!pending) {
      return;
    }

    if (
      startupFullHydrationTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        startupFullHydrationTimerRef.current
      );
    }

    startupFullHydrationTimerRef.current =
      window.setTimeout(
        () => {
          startupFullHydrationTimerRef.current = null;

          window.requestAnimationFrame(
            () => {
              const latest =
                deferredStartupFullMoviesRef.current;

              if (!latest) {
                startupFastPhaseRef.current = false;
                return;
              }

              deferredStartupFullMoviesRef.current = null;
              startupFastPhaseRef.current = false;
              setSavedMovies(latest);
            }
          );
        },
        delay
      );
  }


  function hydrateStartupMovies(
    list: SavedMovie[],
    completeSnapshot = true
  ) {
    const startupMovies =
      getStartupTopUsMovies(list);

    startupFastPhaseRef.current = true;

    if (
      completeSnapshot &&
      startupMovies.length < list.length
    ) {
      deferredStartupFullMoviesRef.current = list;
    }

    setSavedMovies(startupMovies);
    setMoviesSnapshotReady(true);
  }


  function finishIntro() {
    if (introPlaybackFinishedRef.current) {
      return;
    }

    /*
     * v1.533 : on ne retire plus l'overlay au même moment que l'injection
     * de toute la bibliothèque. Ce premier changement d'état est volontairement
     * minuscule : il permet au navigateur de peindre immédiatement la fin de
     * l'intro / l'indicateur de chargement avant le rendu lourd de la collection.
     */
    introPlaybackFinishedRef.current = true;
    setIntroPlaybackFinished(true);

    if (
      introSafetyTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        introSafetyTimerRef.current
      );
      introSafetyTimerRef.current =
        null;
    }

    if (
      introCloseTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        introCloseTimerRef.current
      );
      introCloseTimerRef.current =
        null;
    }
  }


  /*
   * Une fois la fin de l'intro peinte, on injecte le snapshot déjà reçu.
   * React construit alors la première grille derrière l'overlay.
   */
  useEffect(
    () => {
      if (
        !introPlaybackFinished ||
        !showIntro ||
        !authResolved
      ) {
        return;
      }

      /* Pas de session : on affiche simplement l'écran de connexion. */
      if (!user) {
        showIntroRef.current = false;
        setIntroFading(false);
        setShowIntro(false);
        return;
      }

      if (introHydrationStartedRef.current) {
        return;
      }

      const pendingMovies =
        pendingMoviesSnapshotRef.current;

      if (!pendingMovies) {
        /* Le listener Firestore terminera l'hydratation dès son premier snapshot. */
        return;
      }

      introHydrationStartedRef.current = true;

      hydrateStartupMovies(
        pendingMovies,
        moviesNetworkSnapshotReceivedRef.current
      );

      const pendingAlbums =
        pendingAlbumsSnapshotRef.current;

      if (pendingAlbums) {
        setSavedAlbums(pendingAlbums);
        setAlbumsSnapshotReady(true);
      }
    },
    [
      introPlaybackFinished,
      showIntro,
      authResolved,
      user,
    ]
  );


  /*
   * Le snapshot films a été rendu derrière l'intro : on attend encore une
   * frame pour garantir son paint, puis on retire l'overlay. Le passage vers
   * le site chargé devient ainsi direct, sans écran intermédiaire à zéro.
   */
  useEffect(
    () => {
      if (
        !introPlaybackFinished ||
        !showIntro ||
        !authResolved ||
        (user && !moviesSnapshotReady)
      ) {
        return;
      }

      const frame =
        window.requestAnimationFrame(
          () => {
            showIntroRef.current = false;
            setIntroFading(false);
            setShowIntro(false);
          }
        );

      return () => {
        window.cancelAnimationFrame(frame);
      };
    },
    [
      introPlaybackFinished,
      showIntro,
      authResolved,
      user,
      moviesSnapshotReady,
    ]
  );



  /*
   * Dès que l'overlay est réellement parti, on laisse au navigateur un court
   * instant pour peindre la page US, puis on injecte toute la bibliothèque.
   */
  useEffect(
    () => {
      if (
        showIntro ||
        !moviesSnapshotReady ||
        !startupFastPhaseRef.current
      ) {
        return;
      }

      scheduleDeferredStartupMovies(260);

      return () => {
        if (
          startupFullHydrationTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            startupFullHydrationTimerRef.current
          );
          startupFullHydrationTimerRef.current = null;
        }
      };
    },
    [showIntro, moviesSnapshotReady]
  );


  /*
   * Le délai de sécurité évite qu'une vidéo défectueuse bloque l'application.
   * Aucun marqueur de session n'est enregistré : un F5 relance donc l'intro.
   */
  useEffect(
    () => {
      if (
        !showIntro
      ) {
        return;
      }

      introSafetyTimerRef.current =
        window.setTimeout(
          () => {
            finishIntro();
          },
          12000
        );

      return () => {
        if (
          introSafetyTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            introSafetyTimerRef.current
          );

          introSafetyTimerRef.current =
            null;
        }
      };
    },
    [
      showIntro,
    ]
  );


  useEffect(
    () => {
      return () => {
        if (
          introCloseTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            introCloseTimerRef.current
          );
        }

        if (
          introSafetyTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            introSafetyTimerRef.current
          );
        }
      };
    },
    []
  );


  /*
   * DETECTION PC / MOBILE DU BANDEAU
   */

  useEffect(
    () => {
      const handleResize =
        () => {
          setIsMobileBanner(
            window.innerWidth <=
              800
          );
        };

      handleResize();

      window.addEventListener(
        'resize',
        handleResize
      );

      return () => {
        window.removeEventListener(
          'resize',
          handleResize
        );
      };
    },
    []
  );


  useEffect(
    () => {
      window
        .localStorage
        .setItem(
          'merlymoviesbox-poster-size',
          posterSize
        );
    },
    [
      posterSize,
    ]
  );


  useEffect(
    () => {
      window.localStorage.setItem(
        'merylmoviesbox-verify-view',
        verifyViewMode
      );
    },
    [verifyViewMode]
  );


  useEffect(
    () => {
      const unsubscribe =
        onAuthStateChanged(
          auth,
          (
            currentUser
          ) => {
            setAuthenticatedUser(
              currentUser
            );

            if (!GUEST_MODE) {
              setAuthResolved(
                true
              );
            }
          }
        );

      return unsubscribe;
    },
    []
  );


  useEffect(
    () => {
      if (!GUEST_MODE) {
        return;
      }

      /*
       * v1.559 :
       * on écoute la configuration invitée en temps réel.
       * Si le propriétaire l'initialise dans un autre onglet, cette page
       * se débloque automatiquement sans rechargement.
       *
       * Important : on ne fait plus signOut(auth) ici, car cela déconnectait
       * aussi le compte propriétaire dans les autres onglets du même navigateur.
       */
      const unsubscribeGuestConfig =
        onSnapshot(
          doc(
            db,
            'public',
            'guestConfig'
          ),
          (guestConfigSnapshot) => {
            const ownerUid =
              String(
                guestConfigSnapshot.data()?.ownerUid ?? ''
              ).trim();

            if (
              !guestConfigSnapshot.exists() ||
              !ownerUid
            ) {
              setGuestOwnerUid(null);
              setGuestModeError(
                'Mode invité non initialisé. Connecte-toi une fois normalement avec le compte propriétaire ; cette page se débloquera automatiquement.'
              );
              setAuthResolved(true);
              return;
            }

            setGuestOwnerUid(ownerUid);
            setGuestModeError('');
            setAuthResolved(true);
          },
          (error) => {
            console.error(
              'Chargement du mode invité impossible :',
              error
            );
            setGuestOwnerUid(null);
            setGuestModeError(
              'Impossible de charger le mode invité.'
            );
            setAuthResolved(true);
          }
        );

      return unsubscribeGuestConfig;
    },
    []
  );


  useEffect(
    () => {
      if (
        GUEST_MODE ||
        !authenticatedUser
      ) {
        return;
      }

      /*
       * Le premier compte propriétaire qui ouvre le site publie uniquement
       * son UID dans un document de configuration lisible par les invités.
       * Les données de films restent dans /users/{uid}/... et ne sont jamais copiées.
       */
      void firestoreSetDoc(
        doc(
          db,
          'public',
          'guestConfig'
        ),
        {
          ownerUid: authenticatedUser.uid,
          updatedAt: serverTimestamp(),
        },
        {
          merge: true,
        }
      ).catch((error) => {
        console.warn(
          'Initialisation du mode invité impossible :',
          error
        );
      });
    },
    [
      authenticatedUser,
    ]
  );




  /*
   * v1.561 — MODE INVITÉ
   * Le visiteur n'utilise plus la mécanique d'intro/cache/onSnapshot du compte
   * propriétaire. Une lecture Firestore simple charge directement les films et
   * les albums, ce qui élimine le blocage persistant sur « Chargement… ».
   */
  useEffect(
    () => {
      if (
        !GUEST_MODE ||
        !guestOwnerUid
      ) {
        return;
      }

      let cancelled = false;

      setGuestModeError('');
      setMoviesSnapshotReady(false);
      setAlbumsSnapshotReady(false);

      const withTimeout = <T,>(
        promise: Promise<T>,
        label: string
      ) =>
        Promise.race<T>([
          promise,
          new Promise<T>((_, reject) => {
            window.setTimeout(
              () => reject(
                new Error(`${label} : délai dépassé`)
              ),
              15000
            );
          }),
        ]);

      void (async () => {
        try {
          const [
            moviesSnapshot,
            albumsSnapshot,
          ] =
            await Promise.all([
              withTimeout(
                getDocs(
                  collection(
                    db,
                    'users',
                    guestOwnerUid,
                    'movies'
                  )
                ),
                'Films'
              ),
              withTimeout(
                getDocs(
                  collection(
                    db,
                    'users',
                    guestOwnerUid,
                    'albums'
                  )
                ),
                'Albums'
              ),
            ]);

          if (cancelled) {
            return;
          }

          const movies =
            moviesSnapshot.docs.map(
              (document) => ({
                docId: document.id,
                ...document.data(),
              })
            ) as SavedMovie[];

          const albums =
            albumsSnapshot.docs.map(
              (document) => ({
                docId: document.id,
                ...document.data(),
              })
            ) as SavedAlbum[];

          pendingMoviesSnapshotRef.current = movies;
          pendingAlbumsSnapshotRef.current = albums;
          deferredStartupFullMoviesRef.current = null;
          startupFastPhaseRef.current = false;
          moviesNetworkSnapshotReceivedRef.current = true;

          setSavedMovies(movies);
          setSavedAlbums(albums);
          setMoviesSnapshotReady(true);
          setAlbumsSnapshotReady(true);
          setAuthResolved(true);
          setGuestModeError('');
        } catch (error) {
          console.error(
            'Chargement direct du mode invité impossible :',
            error
          );

          if (!cancelled) {
            setSavedMovies([]);
            setSavedAlbums([]);
            setMoviesSnapshotReady(true);
            setAlbumsSnapshotReady(true);
            setAuthResolved(true);
            setGuestModeError(
              'Impossible de charger la bibliothèque invitée. Vérifie le déploiement de firestore.rules v1.561.'
            );
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    },
    [
      guestOwnerUid,
    ]
  );

  useEffect(
    () => {
      if (GUEST_MODE) {
        return;
      }

      if (
        !user
      ) {
        pendingMoviesSnapshotRef.current = null;
        deferredStartupFullMoviesRef.current = null;
        startupFastPhaseRef.current = false;
        moviesNetworkSnapshotReceivedRef.current = false;

        if (startupFullHydrationTimerRef.current !== null) {
          window.clearTimeout(startupFullHydrationTimerRef.current);
          startupFullHydrationTimerRef.current = null;
        }

        setSavedMovies(
          []
        );
        setMoviesSnapshotReady(
          false
        );

        return;
      }

      setMoviesSnapshotReady(
        false
      );

      moviesNetworkSnapshotReceivedRef.current = false;
      const currentUserId = user.uid;
      let cancelled = false;

      /*
       * Le cache TOP US est lu en parallèle du réseau pendant la vidéo.
       * Il n'écrase jamais un snapshot Firestore déjà arrivé.
       */
      void (async () => {
        const cached =
          await loadStoredStartupMovies(currentUserId);

        if (
          cancelled ||
          !cached ||
          cached.length === 0 ||
          moviesNetworkSnapshotReceivedRef.current
        ) {
          return;
        }

        pendingMoviesSnapshotRef.current = cached;

        if (
          showIntroRef.current &&
          introPlaybackFinishedRef.current &&
          !introHydrationStartedRef.current
        ) {
          introHydrationStartedRef.current = true;
          hydrateStartupMovies(cached, false);
        }
      })();

      const moviesRef =
        collection(
          db,
          'users',
          user.uid,
          'movies'
        );

      const unsubscribe =
        onSnapshot(
          moviesRef,

          (
            snapshot
          ) => {
            const list =
              snapshot.docs
                .map(
                  (
                    document
                  ) => ({
                    docId:
                      document.id,

                    ...document.data(),
                  })
                ) as
                SavedMovie[];

            moviesNetworkSnapshotReceivedRef.current = true;

            /* Garde toujours le dernier snapshot complet disponible. */
            pendingMoviesSnapshotRef.current = list;

            /* Le cache ne contient que TOP US : petit, rapide à relire. */
            const startupCache =
              getStartupTopUsMovies(list);
            void saveStoredStartupMovies(
              currentUserId,
              startupCache
            );

            if (showIntroRef.current) {
              /*
               * Fin de vidéo : on ne donne à React que TOP US. La collection
               * complète reste en attente pour le paint suivant.
               */
              if (
                introPlaybackFinishedRef.current &&
                !introHydrationStartedRef.current
              ) {
                introHydrationStartedRef.current = true;
                hydrateStartupMovies(list, true);

                const pendingAlbums =
                  pendingAlbumsSnapshotRef.current;

                if (pendingAlbums) {
                  setSavedAlbums(pendingAlbums);
                  setAlbumsSnapshotReady(true);
                }
              }

              return;
            }

            /*
             * Si le site vient d'être affiché grâce au cache / TOP US, on
             * actualise le snapshot complet sans rebloquer le premier paint.
             */
            if (startupFastPhaseRef.current) {
              deferredStartupFullMoviesRef.current = list;
              scheduleDeferredStartupMovies(220);
              return;
            }

            setSavedMovies(list);
            setMoviesSnapshotReady(true);
          },

          (
            error
          ) => {
            console.error(
              error
            );

            if (GUEST_MODE) {
              setGuestModeError(
                'Impossible de lire la bibliothèque en mode invité. Vérifie que les règles Firestore v1.560 ont bien été déployées.'
              );
              setMoviesSnapshotReady(true);
            } else {
              setMessage(
                'Impossible de charger ta collection.'
              );
            }
          }
        );

      return () => {
        cancelled = true;
        unsubscribe();
      };
    },
    [
      user,
    ]
  );


  /* Nettoyage automatique des anciens titres techniques déjà enregistrés.
     On ne touche qu'au titre principal / titre manuel : les titres TMDb
     officiels restent intacts. L'affichage est de toute façon nettoyé
     immédiatement via getMovieDisplayTitle(). */
  useEffect(
    () => {
      if (
        !user ||
        showIntro ||
        savedMovies.length === 0 ||
        movieTitleCleanupRunningRef.current
      ) {
        return;
      }

      const dirty = savedMovies
        .map((movie) => {
          const patch: Record<string, unknown> = {};

          const cleanTitle = sanitizeMovieTitle(
            movie.title || '',
            movie.year
          );

          if (
            cleanTitle &&
            cleanTitle !== (movie.title || '').trim()
          ) {
            patch.title = cleanTitle;
          }

          if (movie.customTitle) {
            const cleanCustomTitle = sanitizeMovieTitle(
              movie.customTitle,
              movie.year
            );

            if (
              cleanCustomTitle &&
              cleanCustomTitle !== movie.customTitle.trim()
            ) {
              patch.customTitle = cleanCustomTitle;
            }
          }

          return { movie, patch };
        })
        .filter(({ patch }) => Object.keys(patch).length > 0);

      if (dirty.length === 0) {
        return;
      }

      movieTitleCleanupRunningRef.current = true;

      void (async () => {
        try {
          const chunkSize = 300;

          for (let start = 0; start < dirty.length; start += chunkSize) {
            const batch = writeBatch(db);

            for (const { movie, patch } of dirty.slice(start, start + chunkSize)) {
              batch.set(
                doc(db, 'users', user.uid, 'movies', movie.docId),
                {
                  ...patch,
                  titleSanitizedAt: serverTimestamp(),
                },
                { merge: true }
              );
            }

            await batch.commit();
          }
        } catch (error) {
          console.error('Nettoyage titres films', error);
        } finally {
          movieTitleCleanupRunningRef.current = false;
        }
      })();
    },
    [user, savedMovies, showIntro]
  );



  useEffect(
    () => {
      if (
        !user ||
        !apiKey ||
        page !== 'ucpm'
      ) {
        return;
      }

      const missingSixFilmsPosters =
        savedMovies.filter(
          (movie) =>
            Boolean(
              movie.ucpm &&
              movie.ucpmGroupType === 'sixfilms' &&
              movie.tmdbId &&
              !movie.customPosterUrl &&
              !movie.customPosterPath &&
              !movie.posterPath &&
              !ucpmSixFilmsPosterRepairRequested.current.has(movie.docId)
            )
        );

      if (missingSixFilmsPosters.length === 0) {
        return;
      }

      let cancelled = false;

      void (async () => {
        for (const movie of missingSixFilmsPosters) {
          if (cancelled || !movie.tmdbId) {
            break;
          }

          ucpmSixFilmsPosterRepairRequested.current.add(movie.docId);

          try {
            const preferredPoster =
              await getPreferredPosterPath(
                movie.tmdbId,
                null,
                'movie'
              );

            if (!preferredPoster || cancelled) {
              if (!preferredPoster) {
                ucpmSixFilmsPosterRepairRequested.current.delete(movie.docId);
              }
              continue;
            }

            await setDoc(
              doc(
                db,
                'users',
                user.uid,
                'movies',
                movie.docId
              ),
              {
                posterPath: preferredPoster,
                tmdbMatchStatus: 'matched',
                tmdbMatchedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } catch (error) {
            console.error(
              'Impossible de réparer une affiche 6 films :',
              error
            );
            ucpmSixFilmsPosterRepairRequested.current.delete(movie.docId);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    },
    [
      user,
      apiKey,
      page,
      savedMovies,
    ]
  );



  useEffect(
    () => {
      if (GUEST_MODE) {
        return;
      }

      if (!user) {
        pendingAlbumsSnapshotRef.current = null;
        setSavedAlbums([]);
        setAlbumsSnapshotReady(false);
        return;
      }

      setAlbumsSnapshotReady(false);

      const albumsRef =
        collection(
          db,
          'users',
          user.uid,
          'albums'
        );

      const unsubscribe =
        onSnapshot(
          albumsRef,
          (snapshot) => {
            const list =
              snapshot.docs.map(
                (document) => ({
                  docId: document.id,
                  ...document.data(),
                })
              ) as SavedAlbum[];

            pendingAlbumsSnapshotRef.current = list;

            if (showIntroRef.current) {
              /* Si les films sont déjà en cours de rendu derrière l'intro,
                 l'album peut être injecté sans attendre la disparition de l'overlay. */
              if (
                introPlaybackFinishedRef.current &&
                introHydrationStartedRef.current
              ) {
                setSavedAlbums(list);
                setAlbumsSnapshotReady(true);
              }

              return;
            }

            setSavedAlbums(list);
            setAlbumsSnapshotReady(true);
          },
          (error) => {
            console.error(error);

            if (GUEST_MODE) {
              setAlbumsSnapshotReady(true);
            } else {
              setMessage(
                'Impossible de charger les albums LP.'
              );
            }
          }
        );

      return unsubscribe;
    },
    [user]
  );


  useEffect(
    () => {
      autoBackupPreviousRef.current =
        null;

      if (!user) {
        setLastAutoBackupAt(null);
        return;
      }

      try {
        const stored =
          window.localStorage.getItem(
            autoBackupStorageKey()
          );

        if (!stored) {
          setLastAutoBackupAt(null);
          return;
        }

        const backup =
          JSON.parse(stored) as MerlyBackup;

        setLastAutoBackupAt(
          backup.createdAt || null
        );
      } catch {
        setLastAutoBackupAt(null);
      }
    },
    [user]
  );


  useEffect(
    () => {
      if (
        !user ||
        !moviesSnapshotReady ||
        !albumsSnapshotReady
      ) {
        return;
      }

      const current = {
        score: automaticBackupAdditionScore(
          savedMovies,
          savedAlbums
        ),
        backup: buildBackupPayload(
          savedMovies,
          savedAlbums
        ),
      };

      const previous =
        autoBackupPreviousRef.current;

      if (
        !autoBackupSuspendedRef.current &&
        previous &&
        current.score > previous.score
      ) {
        try {
          window.localStorage.setItem(
            autoBackupStorageKey(),
            JSON.stringify(previous.backup)
          );
          setLastAutoBackupAt(
            previous.backup.createdAt
          );
          setBackupMessage(
            'Sauvegarde automatique créée avant le dernier ajout.'
          );
        } catch (error) {
          console.error(
            'Sauvegarde automatique',
            error
          );
          setBackupMessage(
            'Sauvegarde automatique impossible dans ce navigateur.'
          );
        }
      }

      autoBackupPreviousRef.current =
        current;
    },
    [
      user,
      moviesSnapshotReady,
      albumsSnapshotReady,
      savedMovies,
      savedAlbums,
      posterSize,
    ]
  );


  /* Freeze the existing Soundtracks display into list-specific fields once.
     From that point onward, global movie title/poster/rating changes no longer
     alter the B.O. list. */
  useEffect(
    () => {
      if (
        !user ||
        savedMovies.length ===
          0
      ) {
        return;
      }

      const pending =
        savedMovies
          .filter(
            (
              movie
            ) =>
              Boolean(
                movie.rankings
                  ?.soundtracks
              ) &&
              movie.soundtrackIndependent !==
                true &&
              !soundtrackMigrationRequested.current.has(
                movie.docId
              )
          )
          .slice(
            0,
            350
          );

      if (
        pending.length ===
        0
      ) {
        return;
      }

      for (
        const movie
        of pending
      ) {
        soundtrackMigrationRequested.current.add(
          movie.docId
        );
      }

      const batch =
        writeBatch(
          db
        );

      for (
        const movie
        of pending
      ) {
        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            movie.docId
          );

        batch.set(
          movieRef,
          {
            soundtrackIndependent:
              true,
            soundtrackTitle:
              movie.soundtrackTitle ||
              getMovieDisplayTitle(
                movie
              ),
            soundtrackRating:
              movie.soundtrackRating ??
              movie.rating ??
              null,
            soundtrackCoverUrl:
              movie.soundtrackCoverUrl ??
              movie.customPosterUrl ??
              null,
            soundtrackCoverPath:
              movie.soundtrackCoverPath ??
              movie.customPosterPath ??
              movie.posterPath ??
              null,
          },
          {
            merge: true,
          }
        );
      }

      batch
        .commit()
        .catch(
          (
            error
          ) => {
            console.error(
              'Migration Soundtracks :',
              error
            );

            for (
              const movie
              of pending
            ) {
              soundtrackMigrationRequested.current.delete(
                movie.docId
              );
            }
          }
        );
    },
    [
      user,
      savedMovies,
    ]
  );


  useEffect(
    () => {
      setReorderMode(
        false
      );
      setReorderMovies(
        []
      );
      setReorderDirty(
        false
      );
      setLpReorderMode(false);
      setLpReorderAlbums([]);
      setLpReorderDirty(false);
      setMobileMovieAction(
        null
      );
      setMobileReorderFocusId(
        null
      );
      clearMobileMovieHoldTimer();
      reorderDragIdRef.current =
        null;
      reorderMovedIdsRef.current.clear();
      lpReorderDragIdRef.current = null;
      lpReorderMovedIdsRef.current.clear();
    },
    [
      page,
    ]
  );


  useEffect(
    () => {
      function handleKeyDown(
        event:
          KeyboardEvent
      ) {
        if (
          event.key !==
          'Escape'
        ) {
          return;
        }

        if (
          selectedPosterMovie
        ) {
          closePosterPicker();
          return;
        }

        if (
          selectedTitleMovie
        ) {
          closeTitlePicker();
          return;
        }

        if (
          selectedMovieMenu
        ) {
          closeMovieMenu();
        }

        if (
          addTarget
        ) {
          closeAddToSection();
        }

        if (lpAddOpen) {
          closeLpAdd();
        }

        if (selectedLpCoverAlbum) {
          closeLpCoverPicker();
        }
      }

      window.addEventListener(
        'keydown',
        handleKeyDown
      );

      return () => {
        window.removeEventListener(
          'keydown',
          handleKeyDown
        );
      };
    },
    [
      selectedPosterMovie,
      selectedTitleMovie,
      selectedMovieMenu,
      addTarget,
      lpAddOpen,
      selectedLpCoverAlbum,
    ]
  );


  async function loginGoogle() {
    try {
      setMessage(
        ''
      );

      const loginResult =
        await signInWithPopup(
          auth,
          googleProvider
        );

      /*
       * v1.559 :
       * dès qu'un propriétaire se connecte normalement, on initialise
       * explicitement le mode invité. On ne dépend plus seulement du useEffect.
       */
      if (!GUEST_MODE) {
        try {
          await firestoreSetDoc(
            doc(
              db,
              'public',
              'guestConfig'
            ),
            {
              ownerUid: loginResult.user.uid,
              updatedAt: serverTimestamp(),
            },
            {
              merge: true,
            }
          );
        } catch (guestInitError) {
          console.error(
            'Initialisation du mode invité impossible :',
            guestInitError
          );

          setMessage(
            'Connexion réussie, mais le mode invité n’a pas pu être initialisé. Redéploie les règles Firestore de la v1.559.'
          );
        }
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        'Impossible de se connecter avec Google.'
      );
    }
  }


  async function logout() {
    try {
      stopRequested.current =
        true;

      stopFrenchTitlesRequested.current =
        true;

      await signOut(
        auth
      );

      setPage(
        'topUS'
      );

      setSearchResults(
        []
      );

      setMessage(
        ''
      );
    } catch (
      error
    ) {
      console.error(
        error
      );
    }
  }


  function getMovieIdentityTitles(
    movie:
      SavedMovie
  ) {
    return new Set(
      [
        movie.title,
        movie.customTitle,
        movie.localizedTitle,
        movie.originalTitle,
        movie.tmdbTitle,
      ]
        .filter(
          (
            value
          ): value is string =>
            typeof value ===
              'string' &&
            Boolean(
              value.trim()
            )
        )
        .map(
          (value) =>
            normalizeMovieTitle(
              value,
              movie.year
            )
        )
    );
  }


  function normalizeImdbIdentity(
    value:
      unknown
  ) {
    if (
      typeof value !==
      'string'
    ) {
      return '';
    }

    return value
      .trim()
      .toLowerCase();
  }


  function getMovieIdentityYear(
    movie: SavedMovie
  ) {
    return (
      String(movie.year || '')
        .match(/(?:19|20)\d{2}/)?.[0] ||
      String(movie.releaseDate || '')
        .match(/(?:19|20)\d{2}/)?.[0] ||
      ''
    );
  }


  function titleIdentityGroupIsUnambiguous(
    items: SavedMovie[]
  ) {
    const years = new Set<string>();
    const tmdbIds = new Set<string>();
    const imdbIds = new Set<string>();

    for (const item of items) {
      const itemYear = getMovieIdentityYear(item);
      if (itemYear) {
        years.add(itemYear);
      }

      if (item.tmdbId) {
        tmdbIds.add(
          `${item.tmdbMediaType || 'movie'}:${item.tmdbId}`
        );
      }

      const itemImdb = normalizeImdbIdentity(
        item.imdbId || item.ucpmImdbId
      );
      if (itemImdb) {
        imdbIds.add(
          `${item.tmdbMediaType || 'movie'}:${itemImdb}`
        );
      }
    }

    return (
      years.size <= 1 &&
      tmdbIds.size <= 1 &&
      imdbIds.size <= 1
    );
  }


  function getLinkedMovies(
    movie:
      SavedMovie
  ) {
    const mediaType =
      movie.tmdbMediaType ||
      'movie';
    const year =
      getMovieIdentityYear(movie);
    const candidates =
      new Map<string, SavedMovie>();

    const addCandidates = (
      items: SavedMovie[] | undefined
    ) => {
      if (!items) {
        return;
      }

      for (const item of items) {
        candidates.set(
          item.docId,
          item
        );
      }
    };

    candidates.set(
      movie.docId,
      movie
    );

    if (movie.tmdbId) {
      addCandidates(
        linkedMovieIndex.byTmdb.get(
          `${mediaType}:${movie.tmdbId}`
        )
      );
    }

    const imdb =
      normalizeImdbIdentity(
        movie.imdbId ||
        movie.ucpmImdbId
      );

    if (imdb) {
      addCandidates(
        linkedMovieIndex.byImdb.get(
          `${mediaType}:${imdb}`
        )
      );
    }

    for (const title of getMovieIdentityTitles(movie)) {
      const titleKey =
        `${mediaType}:${title}`;
      const titleCandidates =
        linkedMovieIndex.byTitleAny.get(titleKey) || [];
      const titleGroupSafe =
        titleIdentityGroupIsUnambiguous(
          titleCandidates
        );

      if (year) {
        addCandidates(
          linkedMovieIndex.byTitleYear.get(
            `${titleKey}__${year}`
          )
        );

        /* Une vieille occurrence sans année n'est rattachée par le titre
           que si ce titre ne correspond pas à plusieurs films distincts.
           Cela évite qu'une suppression globale d'un remake homonyme touche
           un autre film portant le même titre. */
        if (titleGroupSafe) {
          addCandidates(
            linkedMovieIndex.byTitleNoYear.get(
              titleKey
            )
          );
        }
      } else if (titleGroupSafe) {
        addCandidates(
          titleCandidates
        );
      }
    }

    return Array.from(
      candidates.values()
    );
  }


  function addedAtMillis(
    value: unknown
  ) {
    if (value instanceof Timestamp) {
      return value.toMillis();
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    if (
      value &&
      typeof value === 'object' &&
      'toMillis' in value &&
      typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ) {
      try {
        return (value as { toMillis: () => number }).toMillis();
      } catch {
        return 0;
      }
    }

    return 0;
  }


  function recentMovieIdentityKey(
    movie: SavedMovie
  ) {
    const mediaType = movie.tmdbMediaType || 'movie';

    if (movie.tmdbId) {
      return `${mediaType}:tmdb:${movie.tmdbId}`;
    }

    const imdb = normalizeImdbIdentity(
      movie.imdbId || movie.ucpmImdbId
    );

    if (imdb) {
      return `${mediaType}:imdb:${imdb}`;
    }

    return `${mediaType}:title:${normalizeMovieTitle(
      getMovieDisplayTitle(movie) || movie.title || movie.docId,
      movie.year
    )}:${String(movie.year || '')}`;
  }


  const recentAddedMovies =
    useMemo(
      () => {
        const sorted =
          savedMovies
            .filter(
              (movie) => movie.tmdbMediaType !== 'tv'
            )
            .sort(
              (a, b) => {
                const addedA =
                  addedAtMillis(a.addedAt);
                const addedB =
                  addedAtMillis(b.addedAt);

                if (addedA !== addedB) {
                  return addedB - addedA;
                }

                /* Compatibilité avec les anciennes fiches sans addedAt :
                   la position Movie Database donne un ordre de secours
                   cohérent au lieu d'un ordre aléatoire. */
                const positionA =
                  a.rankings?.jellyfin?.position ??
                  -1;
                const positionB =
                  b.rankings?.jellyfin?.position ??
                  -1;

                return positionB - positionA;
              }
            );

        const seen =
          new Set<string>();
        const recent:
          SavedMovie[] = [];

        for (const movie of sorted) {
          const key =
            recentMovieIdentityKey(movie);

          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          recent.push(movie);

          if (recent.length >= 50) {
            break;
          }
        }

        return recent;
      },
      [savedMovies]
    );


  async function eraseRecentAddedMovie(
    movie: SavedMovie
  ) {
    if (!user) {
      return;
    }

    const linked =
      getLinkedMovies(movie);
    const historyBefore =
      snapshotMovieIds(
        linked.map(
          (linkedMovie) =>
            linkedMovie.docId
        )
      );
    const title =
      getMovieDisplayTitle(movie);

    const confirmed =
      window.confirm(
        `Effacer définitivement « ${title} » ?\n\nLe film sera supprimé de toutes les listes où cette même fiche est présente.`
      );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingRecentMovieId(movie.docId);

      for (let start = 0; start < linked.length; start += 400) {
        const batch = writeBatch(db);

        for (const linkedMovie of linked.slice(start, start + 400)) {
          batch.delete(
            doc(
              db,
              'users',
              user.uid,
              'movies',
              linkedMovie.docId
            )
          );
        }

        await batch.commit();
      }

      addHistoryEntry(
        `Suppression film : ${title}`,
        historyBefore
      );

      if (
        selectedMovieMenu &&
        linked.some(
          (linkedMovie) =>
            linkedMovie.docId === selectedMovieMenu.docId
        )
      ) {
        closeMovieMenu();
      }

      setMessage(`« ${title} » a été effacé.`);
    } catch (error) {
      console.error(error);
      setMessage(
        "Impossible d'effacer définitivement ce film."
      );
    } finally {
      setDeletingRecentMovieId(null);
    }
  }


  function scoreMovieDocument(
    movie:
      SavedMovie
  ) {
    let score =
      0;

    score +=
      Object.keys(
        movie.rankings ||
        {}
      ).length *
      5;

    score +=
      (
        movie.diary
          ?.length ||
        0
      ) *
      3;

    if (
      movie.ucpm
    ) {
      score += 4;
    }

    if (
      movie.letterboxdFilmUri
    ) {
      score += 4;
    }

    if (
      movie.tmdbId
    ) {
      score += 6;
    }

    if (
      movie.posterPath ||
      movie.customPosterPath ||
      movie.customPosterUrl
    ) {
      score += 2;
    }

    if (
      movie.rating !=
      null
    ) {
      score += 2;
    }

    return score;
  }


  function getLooseUsFrPriorityMovie(
    movie: SavedMovie,
    requireRating = false
  ) {
    const year =
      String(movie.year || '')
        .match(/(?:19|20)\d{2}/)?.[0] ||
      String(movie.releaseDate || '')
        .match(/(?:19|20)\d{2}/)?.[0] ||
      '';

    if (!year) {
      return null;
    }

    const targetTitles =
      Array.from(getMovieIdentityTitles(movie));

    if (!targetTitles.length) {
      return null;
    }

    const mediaType =
      movie.tmdbMediaType || 'movie';

    const candidates =
      usFrMoviesByYear.get(year) || [];

    const scored = candidates
      .filter((candidate) =>
        (candidate.tmdbMediaType || 'movie') === mediaType
      )
      .filter((candidate) =>
        !requireRating ||
        (candidate.rating != null &&
          Number.isFinite(Number(candidate.rating)))
      )
      .map((candidate) => {
        const candidateTitles =
          Array.from(getMovieIdentityTitles(candidate));

        let similarity = 0;

        for (const left of targetTitles) {
          for (const right of candidateTitles) {
            similarity = Math.max(
              similarity,
              looseTitleSimilarity(left, right)
            );
          }
        }

        return {
          movie: candidate,
          similarity,
          sourcePriority: candidate.rankings?.topUS ? 2 : 1,
        };
      })
      .filter((candidate) => candidate.similarity >= 0.68)
      .sort((a, b) =>
        b.similarity - a.similarity ||
        b.sourcePriority - a.sourcePriority ||
        scoreMovieDocument(b.movie) - scoreMovieDocument(a.movie)
      );

    if (!scored.length) {
      return null;
    }

    /* Si US et FR décrivent manifestement le même film, US reste
       l'autorité prioritaire. On ne laisse toutefois pas un rapprochement
       nettement moins bon battre un titre FR beaucoup plus précis. */
    const bestScore = scored[0].similarity;
    const nearBest = scored.filter(
      (candidate) => bestScore - candidate.similarity <= 0.04
    );

    return (
      nearBest.find((candidate) => candidate.movie.rankings?.topUS)?.movie ||
      nearBest[0]?.movie ||
      null
    );
  }


  function getUsFrPriorityRating(
    movie: SavedMovie
  ): { rating: number; source: 'US' | 'FR' } | null {
    const linked = getLinkedMovies(movie);

    const usCarrier =
      linked
        .filter(
          (item) =>
            Boolean(item.rankings?.topUS) &&
            item.rating != null &&
            Number.isFinite(Number(item.rating))
        )
        .sort(
          (a, b) =>
            scoreMovieDocument(b) -
            scoreMovieDocument(a)
        )[0];

    if (usCarrier?.rating != null) {
      return {
        rating: Number(usCarrier.rating),
        source: 'US',
      };
    }

    const frCarrier =
      linked
        .filter(
          (item) =>
            Boolean(item.rankings?.topFR) &&
            item.rating != null &&
            Number.isFinite(Number(item.rating))
        )
        .sort(
          (a, b) =>
            scoreMovieDocument(b) -
            scoreMovieDocument(a)
        )[0];

    if (frCarrier?.rating != null) {
      return {
        rating: Number(frCarrier.rating),
        source: 'FR',
      };
    }

    const looseCarrier =
      getLooseUsFrPriorityMovie(movie, true);

    if (
      looseCarrier?.rating != null &&
      Number.isFinite(Number(looseCarrier.rating))
    ) {
      return {
        rating: Number(looseCarrier.rating),
        source: looseCarrier.rankings?.topUS ? 'US' : 'FR',
      };
    }

    return null;
  }


  function getUsFrPropagationMovies(
    movie: SavedMovie
  ) {
    const matches =
      new Map<string, SavedMovie>();

    for (const linkedMovie of getLinkedMovies(movie)) {
      if (
        linkedMovie.rankings?.topUS ||
        linkedMovie.rankings?.topFR
      ) {
        matches.set(
          linkedMovie.docId,
          linkedMovie
        );
      }
    }

    const year =
      String(movie.year || '')
        .match(/(?:19|20)\d{2}/)?.[0] ||
      String(movie.releaseDate || '')
        .match(/(?:19|20)\d{2}/)?.[0] ||
      '';

    const targetTitles =
      Array.from(getMovieIdentityTitles(movie));

    if (year && targetTitles.length) {
      const mediaType =
        movie.tmdbMediaType || 'movie';

      const candidates =
        (usFrMoviesByYear.get(year) || [])
          .filter(
            (candidate) =>
              (candidate.tmdbMediaType || 'movie') === mediaType
          )
          .map((candidate) => {
            const candidateTitles =
              Array.from(getMovieIdentityTitles(candidate));

            let similarity = 0;

            for (const left of targetTitles) {
              for (const right of candidateTitles) {
                similarity = Math.max(
                  similarity,
                  looseTitleSimilarity(left, right)
                );
              }
            }

            return {
              movie: candidate,
              similarity,
            };
          })
          .filter(
            (candidate) =>
              candidate.similarity >= 0.68
          );

      const bestSimilarity =
        candidates.reduce(
          (best, candidate) =>
            Math.max(best, candidate.similarity),
          0
        );

      for (const candidate of candidates) {
        if (
          bestSimilarity - candidate.similarity <= 0.04
        ) {
          matches.set(
            candidate.movie.docId,
            candidate.movie
          );
        }
      }
    }

    return Array.from(matches.values());
  }


  function getUsFrPriorityPosterMovie(
    movie: SavedMovie
  ) {
    const linked =
      getLinkedMovies(movie);

    const hasPoster =
      (item: SavedMovie) =>
        Boolean(
          item.customPosterUrl ||
          item.customPosterPath ||
          item.posterPath
        );

    const pickBest =
      (items: SavedMovie[]) =>
        [...items].sort(
          (a, b) => {
            const customA =
              a.customPosterUrl ||
              a.customPosterPath
                ? 1
                : 0;
            const customB =
              b.customPosterUrl ||
              b.customPosterPath
                ? 1
                : 0;

            return (
              customB - customA ||
              scoreMovieDocument(b) -
                scoreMovieDocument(a)
            );
          }
        )[0];

    const us = pickBest(
      linked.filter(
        (item) =>
          Boolean(item.rankings?.topUS) &&
          hasPoster(item)
      )
    );

    if (us) {
      return us;
    }

    const fr = pickBest(
      linked.filter(
        (item) =>
          Boolean(item.rankings?.topFR) &&
          hasPoster(item)
      )
    );

    if (fr) {
      return fr;
    }

    const loosePosterMovie =
      getLooseUsFrPriorityMovie(movie, false);

    if (
      loosePosterMovie &&
      hasPoster(loosePosterMovie)
    ) {
      return loosePosterMovie;
    }

    return getCanonicalMovie(movie);
  }


  type MovieDatabasePosterAuthoritySource =
    | 'US'
    | 'FR'
    | 'UCPM'
    | 'VUS'
    | 'SELF';


  function getMovieDatabasePosterAuthority(
    movie: SavedMovie
  ): {
    movie: SavedMovie;
    source: MovieDatabasePosterAuthoritySource;
  } {
    const linked = getLinkedMovies(movie);
    const usFrMatches = getUsFrPropagationMovies(movie);
    const usFrCandidates = Array.from(
      new Map(
        [...linked, ...usFrMatches].map((item) => [item.docId, item])
      ).values()
    );

    const hasPoster =
      (item: SavedMovie) =>
        Boolean(
          item.customPosterUrl ||
          item.customPosterPath ||
          item.posterPath
        );

    const pickBest =
      (items: SavedMovie[]) =>
        [...items]
          .filter(hasPoster)
          .sort((a, b) => {
            const customA =
              a.customPosterUrl || a.customPosterPath
                ? 1
                : 0;
            const customB =
              b.customPosterUrl || b.customPosterPath
                ? 1
                : 0;

            return (
              customB - customA ||
              scoreMovieDocument(b) -
                scoreMovieDocument(a)
            );
          })[0] || null;

    /* 1. TOP US est l'autorité absolue quand une affiche existe. */
    const us = pickBest(
      usFrCandidates.filter(
        (item) =>
          Boolean(item.rankings?.topUS)
      )
    );

    if (us) {
      return {
        movie: us,
        source: 'US',
      };
    }

    /* 2. Puis TOP FR. */
    const fr = pickBest(
      usFrCandidates.filter(
        (item) =>
          Boolean(item.rankings?.topFR)
      )
    );

    if (fr) {
      return {
        movie: fr,
        source: 'FR',
      };
    }

    /* Les imports historiques peuvent avoir des titres US/FR légèrement
       différents. On conserve donc le rapprochement tolérant déjà utilisé
       pour les notes/affiches TOP, tout en respectant US > FR. */
    const looseUsFr =
      getLooseUsFrPriorityMovie(
        movie,
        false
      );

    if (
      looseUsFr &&
      hasPoster(looseUsFr)
    ) {
      return {
        movie: looseUsFr,
        source:
          looseUsFr.rankings?.topUS
            ? 'US'
            : 'FR',
      };
    }

    /* 3. UCPM sert de source uniquement si le film n'a pas d'affiche US/FR. */
    const ucpm = pickBest(
      linked.filter(
        (item) => Boolean(item.ucpm)
      )
    );

    if (ucpm) {
      return {
        movie: ucpm,
        source: 'UCPM',
      };
    }

    /* 4. VUS vient ensuite. Une présence VUS est matérialisée par au moins
       une entrée diary sur l'une des occurrences liées. */
    const vus = pickBest(
      linked.filter(
        (item) =>
          (item.diary?.length || 0) > 0
      )
    );

    if (vus) {
      return {
        movie: vus,
        source: 'VUS',
      };
    }

    /* 5. Hors US/FR/UCPM/VUS, on garde l'affiche propre de Movie Database.
       Si elle est vide, le bouton COVER cherchera la première affiche TMDb
       correspondant au titre. */
    return {
      movie,
      source: 'SELF',
    };
  }


  function getMovieDatabasePriorityPosterMovie(
    movie: SavedMovie
  ) {
    return getMovieDatabasePosterAuthority(
      movie
    ).movie;
  }


  function getSharedMovieRatingCandidate(
    movie: SavedMovie
  ) {
    const mediaType =
      movie.tmdbMediaType ||
      'movie';
    const year =
      String(movie.year || '');
    type SharedRatingCandidate = NonNullable<
      ReturnType<typeof sharedMovieRatingIndex.byTmdb.get>
    >;
    const candidates: SharedRatingCandidate[] = [];

    const addCandidate = (
      candidate: SharedRatingCandidate | undefined
    ) => {
      if (candidate) {
        candidates.push(candidate);
      }
    };

    if (movie.tmdbId) {
      addCandidate(
        sharedMovieRatingIndex.byTmdb.get(
          `${mediaType}:${movie.tmdbId}`
        )
      );
    }

    const imdb =
      normalizeImdbIdentity(
        movie.imdbId ||
        movie.ucpmImdbId
      );

    if (imdb) {
      addCandidate(
        sharedMovieRatingIndex.byImdb.get(
          `${mediaType}:${imdb}`
        )
      );
    }

    for (const title of getMovieIdentityTitles(movie)) {
      if (year) {
        addCandidate(
          sharedMovieRatingIndex.byTitleYear.get(
            `${mediaType}:${title}__${year}`
          )
        );

        addCandidate(
          sharedMovieRatingIndex.byTitleNoYear.get(
            `${mediaType}:${title}`
          )
        );
      } else {
        addCandidate(
          sharedMovieRatingIndex.byTitleAny.get(
            `${mediaType}:${title}`
          )
        );
      }
    }

    if (
      movie.rating != null &&
      Number.isFinite(Number(movie.rating))
    ) {
      candidates.push({
        rating: Number(movie.rating),
        priority:
          movie.rankings?.topUS
            ? 6
            : movie.rankings?.topFR
              ? 5
              : movie.ucpm
                ? 4
                : (movie.diary?.length || 0) > 0
                  ? 3
                  : movie.rankings?.series
                    ? 2
                    : 1,
        score: scoreMovieDocument(movie),
        source:
          movie.rankings?.topUS
            ? 'US' as const
            : movie.rankings?.topFR
              ? 'FR' as const
              : movie.ucpm
                ? 'UCPM' as const
                : (movie.diary?.length || 0) > 0
                  ? 'VUS' as const
                  : movie.rankings?.series
                    ? 'SERIES' as const
                    : 'SELF' as const,
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort(
      (a, b) =>
        b.priority - a.priority ||
        b.score - a.score
    );

    return candidates[0];
  }


  function getSharedMovieRating(
    movie: SavedMovie
  ) {
    return (
      getSharedMovieRatingCandidate(movie)?.rating ??
      null
    );
  }


  /* Movie Database suit immédiatement les notes des listes qui font autorité.
     TOP US puis TOP FR sont consultés en priorité, y compris via le rapprochement
     titre/année utilisé par l'application. On prépare l'index une seule fois à
     chaque changement Firestore : le tri Movie Database reste donc instantané. */
  const movieDatabaseEffectiveRatingIndex =
    useMemo(
      () => {
        const index =
          new Map<string, number | null>();

        for (const movie of savedMovies) {
          if (!movie.rankings?.jellyfin) {
            continue;
          }

          const usFrRating =
            getUsFrPriorityRating(movie)?.rating ?? null;
          const sharedRating =
            getSharedMovieRating(movie);

          index.set(
            movie.docId,
            usFrRating ?? sharedRating
          );
        }

        return index;
      },
      [
        savedMovies,
        linkedMovieIndex,
        usFrMoviesByYear,
        sharedMovieRatingIndex,
      ]
    );


  function getMovieDatabaseEffectiveRating(
    movie: SavedMovie
  ) {
    if (movieDatabaseEffectiveRatingIndex.has(movie.docId)) {
      return (
        movieDatabaseEffectiveRatingIndex.get(movie.docId) ??
        null
      );
    }

    return (
      getUsFrPriorityRating(movie)?.rating ??
      getSharedMovieRating(movie)
    );
  }


  function getMovieDatabaseEditAuthoritySource(
    movie: SavedMovie
  ): 'US' | 'FR' | 'UCPM' | 'VUS' | 'SERIES' | null {
    const linked = getLinkedMovies(movie);

    if (linked.some((item) => Boolean(item.rankings?.topUS))) {
      return 'US';
    }

    if (linked.some((item) => Boolean(item.rankings?.topFR))) {
      return 'FR';
    }

    if (linked.some((item) => Boolean(item.ucpm))) {
      return 'UCPM';
    }

    if (linked.some((item) => (item.diary?.length || 0) > 0)) {
      return 'VUS';
    }

    if (linked.some((item) => Boolean(item.rankings?.series))) {
      return 'SERIES';
    }

    return null;
  }



  function getCanonicalMovie(
    movie:
      SavedMovie
  ) {
    const linked =
      getLinkedMovies(
        movie
      );

    return [
      ...linked,
    ].sort(
      (
        a,
        b
      ) =>
        scoreMovieDocument(
          b
        ) -
        scoreMovieDocument(
          a
        )
    )[0] ||
      movie;
  }


  function findCanonicalMovieByTmdbId(
    tmdbId:
      number,
    mediaType: 'movie' | 'tv' = 'movie'
  ) {
    const matches =
      savedMovies.filter(
        (
          movie
        ) =>
          movie.tmdbId ===
          tmdbId &&
          (movie.tmdbMediaType || 'movie') === mediaType
      );

    if (
      matches.length ===
      0
    ) {
      return null;
    }

    return [
      ...matches,
    ].sort(
      (
        a,
        b
      ) =>
        scoreMovieDocument(
          b
        ) -
        scoreMovieDocument(
          a
        )
    )[0];
  }


  function findExistingMovieForTmdb(
    movie:
      TmdbMovie,
    mediaType: 'movie' | 'tv' = 'movie'
  ) {
    const byId =
      findCanonicalMovieByTmdbId(
        movie.id,
        mediaType
      );

    if (
      byId
    ) {
      return byId;
    }

    const candidateYear =
      movie.release_date
        ?.substring(
          0,
          4
        ) ||
      '';

    const candidateTitles =
      new Set(
        [
          movie.title,
          movie.original_title ||
            '',
        ]
          .filter(
            Boolean
          )
          .map(
            (title) =>
              normalizeMovieTitle(
                title,
                candidateYear
              )
          )
      );

    const matches =
      savedMovies.filter(
        (
          saved
        ) => {
          if ((saved.tmdbMediaType || 'movie') !== mediaType) {
            return false;
          }

          const savedTitles =
            [
              saved.title,
              saved.localizedTitle,
              saved.customTitle,
              saved.originalTitle,
              saved.tmdbTitle,
            ]
              .filter(
                (
                  value
                ): value is string =>
                  typeof value ===
                    'string' &&
                  Boolean(
                    value.trim()
                  )
              )
              .map(
                (title) =>
                  normalizeMovieTitle(
                    title,
                    saved.year
                  )
              );

          const titleMatches =
            savedTitles.some(
              (
                title
              ) =>
                candidateTitles.has(
                  title
                )
            );

          if (
            !titleMatches
          ) {
            return false;
          }

          const savedYear =
            String(
              saved.year ||
              ''
            );

          if (
            candidateYear &&
            savedYear
          ) {
            return (
              candidateYear ===
              savedYear
            );
          }

          return true;
        }
      );

    if (
      matches.length ===
      0
    ) {
      return null;
    }

    return [
      ...matches,
    ].sort(
      (
        a,
        b
      ) =>
        scoreMovieDocument(
          b
        ) -
        scoreMovieDocument(
          a
        )
    )[0];
  }


  async function updateMovieEverywhere(
    movie:
      SavedMovie,

    patch:
      Record<
        string,
        unknown
      >
  ) {
    if (
      !user
    ) {
      return;
    }

    const linked =
      getLinkedMovies(
        movie
      );

    const batch =
      writeBatch(
        db
      );

    for (
      const linkedMovie
      of linked
    ) {
      const movieRef =
        doc(
          db,
          'users',
          user.uid,
          'movies',
          linkedMovie.docId
        );

      batch.set(
        movieRef,
        patch,
        {
          merge: true,
        }
      );
    }

    await batch.commit();
  }


  function getMoviePosterSrc(
    movie:
      SavedMovie,

    tmdbSize =
      'w500'
  ) {
    if (
      movie.customPosterUrl
    ) {
      return movie.customPosterUrl;
    }

    const posterPath =
      movie.customPosterPath ||
      movie.posterPath;

    if (
      !posterPath
    ) {
      return null;
    }

    return `https://image.tmdb.org/t/p/${tmdbSize}${posterPath}`;
  }


  function normalizeMovieMenuRating(
    value:
      string
  ) {
    const trimmed =
      value.trim();

    if (
      !trimmed
    ) {
      return null;
    }

    if (
      !/^\d(?:[.,]\d{0,2})?$/.test(
        trimmed
      )
    ) {
      return undefined;
    }

    const parsed =
      Number(
        trimmed.replace(
          ',',
          '.'
        )
      );

    if (
      !Number.isFinite(
        parsed
      ) ||
      parsed <
        0 ||
      parsed >
        5
    ) {
      return undefined;
    }

    return Math.round(
      parsed *
      100
    ) /
      100;
  }


  function quickRatingKeyForList(
    movie: SavedMovie,
    target: Exclude<AddTarget, 'diary'>
  ) {
    return `list:${target}:${movie.docId}`;
  }


  function quickRatingKeyForDiary(
    movie: SavedMovie,
    entry: DiaryEntry
  ) {
    return `diary:${movie.docId}:${hashString(
      diaryEntrySignature(entry)
    )}`;
  }


  function getQuickListRating(
    movie: SavedMovie,
    target: Exclude<AddTarget, 'diary'>
  ) {
    if (target === 'soundtracks') {
      return movie.soundtrackRating ?? null;
    }

    if (target === 'ucpm') {
      return getUcpmCanonicalMovie(movie).rating ?? null;
    }

    if (target === 'jellyfin') {
      return getMovieDatabaseEffectiveRating(movie);
    }

    return movie.rating ?? null;
  }


  function clearQuickRatingLongPressTimer() {
    if (quickRatingLongPressTimerRef.current != null) {
      window.clearTimeout(
        quickRatingLongPressTimerRef.current
      );
      quickRatingLongPressTimerRef.current = null;
    }
  }


  function startQuickRatingLongPress(
    event: ReactPointerEvent<HTMLButtonElement>,
    ratingKey: string
  ) {
    if (
      quickRatingSavingKey ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }

    clearQuickRatingLongPressTimer();
    quickRatingLongPressConsumedKeyRef.current = null;

    const rect =
      event.currentTarget.getBoundingClientRect();

    quickRatingLongPressTimerRef.current =
      window.setTimeout(() => {
        const viewportWidth =
          Math.max(1, window.innerWidth);
        const viewportHeight =
          Math.max(1, window.innerHeight);
        const pickerWidth = 40;
        const pickerHeight = 29;
        const gap = 4;
        const placement = 'below' as const;

        /* La roulette reste collée à l'encart de note : à droite par défaut,
           avec repli à gauche uniquement si l'espace manque. */
        const preferredRight =
          rect.right + gap;
        const fallbackLeft =
          rect.left - pickerWidth - gap;
        const left =
          preferredRight + pickerWidth <= viewportWidth - 6
            ? preferredRight
            : Math.max(
                6,
                fallbackLeft
              );
        const top =
          Math.max(
            6,
            Math.min(
              rect.top + (rect.height - pickerHeight) / 2,
              viewportHeight - pickerHeight - 6
            )
          );

        quickRatingLongPressConsumedKeyRef.current =
          ratingKey;

        setQuickRatingKey(null);
        setQuickRatingValue('');
        setQuickRatingErrorKey(null);
        setQuickRatingPresetPicker({
          ratingKey,
          left,
          top,
          placement,
          value: 5,
        });

        quickRatingLongPressTimerRef.current = null;
      }, 520);
  }


  function finishQuickRatingLongPress() {
    clearQuickRatingLongPressTimer();
  }


  function consumeQuickRatingLongPressClick(
    ratingKey: string
  ) {
    if (
      quickRatingLongPressConsumedKeyRef.current !==
      ratingKey
    ) {
      return false;
    }

    quickRatingLongPressConsumedKeyRef.current = null;
    return true;
  }


  function openQuickRating(
    key: string,
    rating: number | null | undefined
  ) {
    if (quickRatingSavingKey) {
      return;
    }

    setQuickRatingPresetPicker(null);
    setQuickRatingKey(key);
    setQuickRatingValue(
      rating != null
        ? formatRating(rating)
        : ''
    );
    setQuickRatingErrorKey(null);
  }


  function closeQuickRating() {
    setQuickRatingPresetPicker(null);
    clearQuickRatingLongPressTimer();

    if (quickRatingSavingKey) {
      return;
    }

    setQuickRatingKey(null);
    setQuickRatingValue('');
    setQuickRatingErrorKey(null);
  }


  async function saveQuickListRating(
    movie: SavedMovie,
    target: Exclude<AddTarget, 'diary'>,
    nextMovie: SavedMovie | null = null,
    preserveEditor = false,
    ratingDraftOverride: string | null = null,
    silentBackground = false
  ): Promise<boolean> {
    if (!user) {
      return false;
    }

    const key =
      quickRatingKeyForList(
        movie,
        target
      );

    const normalizedRating =
      normalizeMovieMenuRating(
        ratingDraftOverride ?? quickRatingValue
      );

    if (normalizedRating === undefined) {
      setQuickRatingErrorKey(key);
      return false;
    }

    try {
      if (!silentBackground) {
        setQuickRatingSavingKey(key);
        setQuickRatingErrorKey(null);
      }

      if (target === 'soundtracks') {
        const carrier =
          getSoundtrackCarrier(movie);

        const movieRef = doc(
          db,
          'users',
          user.uid,
          'movies',
          carrier.docId
        );

        await setDoc(
          movieRef,
          {
            soundtrackIndependent: true,
            soundtrackRating:
              normalizedRating,
            soundtrackUpdatedAt:
              serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        const authoritySource =
          target === 'jellyfin'
            ? getMovieDatabaseEditAuthoritySource(movie)
            : null;

        if (authoritySource) {
          const authorityRating = getMovieDatabaseEffectiveRating(movie);
          setQuickRatingValue(
            authorityRating != null
              ? formatRating(authorityRating)
              : ''
          );
          setMessage(
            `Note ${authoritySource} prioritaire : modification désactivée dans Movie Database.`
          );
        } else {
          const ratingMovie =
            target === 'ucpm'
              ? getUcpmCanonicalMovie(movie)
              : movie;

          await updateMovieEverywhere(
            ratingMovie,
            {
              rating: normalizedRating,
              ratingUpdatedAt:
                serverTimestamp(),
            }
          );
        }
      }

      if (!preserveEditor) {
        if (nextMovie) {
          const nextKey =
            quickRatingKeyForList(
              nextMovie,
              target
            );

          setQuickRatingKey(nextKey);
          setQuickRatingValue(
            getQuickListRating(
              nextMovie,
              target
            ) != null
              ? formatRating(
                  getQuickListRating(
                    nextMovie,
                    target
                  ) as number
                )
              : ''
          );
        } else if (
          mobileMovieAction &&
          mobileMovieAction.movie.docId === movie.docId
        ) {
          const retainedAuthoritySource =
            target === 'jellyfin'
              ? getMovieDatabaseEditAuthoritySource(movie)
              : null;
          const retainedAuthorityRating =
            retainedAuthoritySource
              ? getMovieDatabaseEffectiveRating(movie)
              : null;
          const retainedRating =
            retainedAuthorityRating ??
            normalizedRating;

          setQuickRatingKey(key);
          setQuickRatingValue(
            retainedRating != null
              ? formatRating(retainedRating)
              : ''
          );
        } else {
          setQuickRatingKey(null);
          setQuickRatingValue('');
        }
      }

      return true;
    } catch (error) {
      console.error(error);
      if (!silentBackground) {
        setQuickRatingErrorKey(key);
      }
      return false;
    } finally {
      if (!silentBackground) {
        setQuickRatingSavingKey((currentKey) =>
          currentKey === key ? null : currentKey
        );
      }
    }
  }


  async function saveQuickDiaryRating(
    movie: SavedMovie,
    entry: DiaryEntry,
    nextItem: DiaryDisplayEntry | null = null,
    preserveEditor = false,
    ratingDraftOverride: string | null = null,
    silentBackground = false
  ): Promise<boolean> {
    if (!user) {
      return false;
    }

    const key =
      quickRatingKeyForDiary(
        movie,
        entry
      );

    const normalizedRating =
      normalizeMovieMenuRating(
        ratingDraftOverride ?? quickRatingValue
      );

    if (normalizedRating === undefined) {
      setQuickRatingErrorKey(key);
      return false;
    }

    const diary = movie.diary || [];
    const signature =
      diaryEntrySignature(entry);
    const entryIndex =
      diary.findIndex(
        (candidate) =>
          candidate === entry ||
          diaryEntrySignature(candidate) ===
            signature
      );

    if (entryIndex < 0) {
      setQuickRatingErrorKey(key);
      return false;
    }

    const nextDiary = [
      ...diary,
    ];

    nextDiary[entryIndex] = {
      ...nextDiary[entryIndex],
      rating: normalizedRating,
    };

    try {
      if (!silentBackground) {
        setQuickRatingSavingKey(key);
        setQuickRatingErrorKey(null);
      }

      /* La note VUS devient aussi la note actuelle du film.
         On regroupe la note + le visionnage dans un seul batch :
         une seule attente réseau au lieu de deux. */
      const linkedMovies =
        getLinkedMovies(movie);
      const batch =
        writeBatch(db);
      let currentMovieIncluded =
        false;

      for (const linkedMovie of linkedMovies) {
        const linkedMovieRef = doc(
          db,
          'users',
          user.uid,
          'movies',
          linkedMovie.docId
        );

        const patch:
          Record<string, unknown> = {
            rating: normalizedRating,
            ratingUpdatedAt:
              serverTimestamp(),
          };

        if (linkedMovie.docId === movie.docId) {
          currentMovieIncluded = true;
          patch.diary = nextDiary;
          patch.diaryUpdatedAt =
            serverTimestamp();
        }

        batch.set(
          linkedMovieRef,
          patch,
          { merge: true }
        );
      }

      if (!currentMovieIncluded) {
        batch.set(
          doc(
            db,
            'users',
            user.uid,
            'movies',
            movie.docId
          ),
          {
            rating: normalizedRating,
            ratingUpdatedAt:
              serverTimestamp(),
            diary: nextDiary,
            diaryUpdatedAt:
              serverTimestamp(),
          },
          { merge: true }
        );
      }

      await batch.commit();

      if (!preserveEditor) {
        if (nextItem) {
          const nextKey =
            quickRatingKeyForDiary(
              nextItem.movie,
              nextItem.entry
            );

          const nextRating =
            getDiaryPriorityRating(
              nextItem.movie,
              nextItem.entry
            );

          setQuickRatingKey(nextKey);
          setQuickRatingValue(
            nextRating != null
              ? formatRating(nextRating)
              : ''
          );
        } else if (
          mobileMovieAction &&
          mobileMovieAction.movie.docId === movie.docId &&
          mobileMovieAction.diaryEntry &&
          diaryEntrySignature(
            mobileMovieAction.diaryEntry
          ) === signature
        ) {
          const retainedAuthority =
            getUsFrPriorityRating(movie);
          const retainedRating =
            retainedAuthority?.rating ??
            normalizedRating;

          setQuickRatingKey(key);
          setQuickRatingValue(
            retainedRating != null
              ? formatRating(retainedRating)
              : ''
          );
        } else {
          setQuickRatingKey(null);
          setQuickRatingValue('');
        }
      }

      return true;
    } catch (error) {
      console.error(error);
      if (!silentBackground) {
        setQuickRatingErrorKey(key);
      }
      return false;
    } finally {
      if (!silentBackground) {
        setQuickRatingSavingKey((currentKey) =>
          currentKey === key ? null : currentKey
        );
      }
    }
  }


  function quickRatingKeyForAlbum(
    album: SavedAlbum
  ) {
    return `lp:${album.docId}`;
  }


  async function saveQuickAlbumRating(
    album: SavedAlbum,
    nextAlbum: SavedAlbum | null = null,
    ratingDraftOverride: string | null = null
  ) {
    if (!user) {
      return;
    }

    const key =
      quickRatingKeyForAlbum(album);
    const normalizedRating =
      normalizeMovieMenuRating(
        ratingDraftOverride ?? quickRatingValue
      );

    if (normalizedRating === undefined) {
      setQuickRatingErrorKey(key);
      return;
    }

    try {
      setQuickRatingSavingKey(key);
      setQuickRatingErrorKey(null);

      const albumRef =
        doc(
          db,
          'users',
          user.uid,
          'albums',
          album.docId
        );

      await setDoc(
        albumRef,
        {
          rating: normalizedRating,
          ratingUpdatedAt:
            serverTimestamp(),
        },
        { merge: true }
      );

      if (nextAlbum) {
        setQuickRatingKey(
          quickRatingKeyForAlbum(
            nextAlbum
          )
        );
        setQuickRatingValue(
          nextAlbum.rating != null
            ? formatRating(
                nextAlbum.rating
              )
            : ''
        );
      } else {
        setQuickRatingKey(null);
        setQuickRatingValue('');
      }
    } catch (error) {
      console.error(error);
      setQuickRatingErrorKey(key);
    } finally {
      setQuickRatingSavingKey(null);
    }
  }


  function renderUnratedPosterRating(
    options: {
      ratingKey: string;
      currentRating: number | null;
      ariaLabel: string;
      onSave: (
        ratingDraftOverride?: string
      ) => void | Promise<unknown>;
      showRated?: boolean;
      disabled?: boolean;
      disabledTitle?: string;
    }
  ) {
    const {
      ratingKey,
      currentRating,
      ariaLabel,
      onSave,
      showRated = true,
      disabled = false,
      disabledTitle,
    } = options;

    if (currentRating != null && disabled) {
      return null;
    }

    if (currentRating != null && !showRated) {
      return null;
    }

    if (currentRating == null && disabled) {
      return null;
    }

    const active =
      quickRatingKey === ratingKey;

    const presetPickerActive =
      quickRatingPresetPicker?.ratingKey ===
      ratingKey;

    const handleRatingPointerDown = (
      event: ReactPointerEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
      startQuickRatingLongPress(
        event,
        ratingKey
      );
    };

    const handleRatingPointerFinish = (
      event: ReactPointerEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
      finishQuickRatingLongPress();
    };

    const handleRatingClick = (
      event: ReactMouseEvent<HTMLButtonElement>
    ) => {
      event.preventDefault();
      event.stopPropagation();

      if (
        consumeQuickRatingLongPressClick(
          ratingKey
        )
      ) {
        return;
      }

      openQuickRating(
        ratingKey,
        currentRating
      );
    };

    const picker =
      presetPickerActive &&
      quickRatingPresetPicker
        ? createPortal(
            <div
              className={`quickRatingPresetPopover ${quickRatingPresetPicker.placement}`}
              data-quick-rating-ui="true"
              role="dialog"
              aria-label={`Choisir une note pour ${ariaLabel}`}
              style={{
                left: quickRatingPresetPicker.left,
                top: quickRatingPresetPicker.top,
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <button
                type="button"
                className="quickRatingPresetWheelValue"
                aria-label={`Valider la note ${String(
                  quickRatingPresetPicker.value
                ).replace('.', ',')} pour ${ariaLabel}`}
                title="Molette : changer la note · clic : valider"
                onWheel={(event) => {
                  event.preventDefault();
                  event.stopPropagation();

                  const direction =
                    event.deltaY > 0
                      ? -0.01
                      : 0.01;

                  setQuickRatingPresetPicker((current) => {
                    if (
                      !current ||
                      current.ratingKey !== ratingKey
                    ) {
                      return current;
                    }

                    return {
                      ...current,
                      value: Math.max(
                        0,
                        Math.min(
                          5,
                          Math.round(
                            (current.value + direction) * 100
                          ) / 100
                        )
                      ),
                    };
                  });
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();

                  const ratingDraft =
                    String(
                      quickRatingPresetPicker.value
                    ).replace('.', ',');

                  setQuickRatingPresetPicker(null);
                  setQuickRatingValue(ratingDraft);
                  setQuickRatingErrorKey(null);
                  void onSave(ratingDraft);
                }}
              >
                {quickRatingPresetPicker.value
                  .toFixed(2)
                  .replace('.', ',')}
              </button>
            </div>,
            document.body
          )
        : null;

    return (
      <Fragment>
        <div
          className={`unratedPosterRatingOverlay${
            active ? ' active' : ''
          }${currentRating != null ? ' rated' : ''}${
            presetPickerActive ? ' presetOpen' : ''
          }`}
          data-quick-rating-ui="true"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          title={disabled ? disabledTitle : undefined}
        >
          {currentRating != null ? (
            active ? (
              renderQuickRatingControl({
                ratingKey,
                currentRating,
                ariaLabel,
                onSave,
                disabled,
              })
            ) : (
              <button
                type="button"
                className="posterTinyRatingTrigger"
                disabled={disabled || Boolean(quickRatingSavingKey)}
                onPointerDown={handleRatingPointerDown}
                onPointerUp={handleRatingPointerFinish}
                onPointerCancel={handleRatingPointerFinish}
                onContextMenu={(event) => {
                  event.preventDefault();
                }}
                onClick={handleRatingClick}
                aria-label={ariaLabel}
                title="Cliquer pour modifier · maintenir pour choisir"
              >
                {formatRating(currentRating)}
              </button>
            )
          ) : active ? (
            renderQuickRatingControl({
              ratingKey,
              currentRating,
              ariaLabel,
              onSave,
            })
          ) : (
            <button
              type="button"
              className="posterTinyRatingTrigger posterTinyRatingTriggerEmpty"
              disabled={Boolean(quickRatingSavingKey)}
              onPointerDown={handleRatingPointerDown}
              onPointerUp={handleRatingPointerFinish}
              onPointerCancel={handleRatingPointerFinish}
              onPointerLeave={handleRatingPointerFinish}
              onContextMenu={(event) => {
                event.preventDefault();
              }}
              onClick={handleRatingClick}
              aria-label={ariaLabel}
              title="Cliquer pour ajouter · maintenir pour choisir"
            >
              —
            </button>
          )}
        </div>

        {picker}
      </Fragment>
    );
  }


  function renderQuickRatingControl(
    options: {
      ratingKey: string;
      currentRating: number | null;
      ariaLabel: string;
      onSave: (ratingDraftOverride?: string) => void | Promise<unknown>;
      disabled?: boolean;
      displayValue?: boolean;
    }
  ) {
    const {
      ratingKey,
      currentRating,
      ariaLabel,
      onSave,
      disabled = false,
      displayValue = false,
    } = options;

    const active =
      quickRatingKey ===
      ratingKey;

    const saving =
      quickRatingSavingKey ===
      ratingKey;

    const hasError =
      quickRatingErrorKey ===
      ratingKey;

    if (!active) {
      return (
        <button
          type="button"
          data-quick-rating-ui="true"
          className={`rating quickRatingTrigger${
            currentRating == null
              ? ' quickRatingTriggerEmpty'
              : ''
          }${displayValue ? ' quickRatingValueTrigger' : ''}`}
          disabled={
            disabled ||
            Boolean(quickRatingSavingKey)
          }
          onClick={() =>
            openQuickRating(
              ratingKey,
              currentRating
            )
          }
          aria-label={ariaLabel}
          title="Cliquer pour noter rapidement"
        >
          {displayValue
            ? currentRating != null
              ? formatRating(currentRating)
              : '—'
            : currentRating != null
              ? '★'
              : '☆'}
        </button>
      );
    }

    return (
      <form
        data-quick-rating-ui="true"
        className={`rating quickRatingEditor${
          hasError
            ? ' quickRatingEditorError'
            : ''
        }`}
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
        title={
          hasError
            ? 'La note doit être comprise entre 0,00 et 5,00.'
            : 'Entrée pour enregistrer · Échap pour annuler'
        }
      >
        <input
          className="quickRatingInput"
          value={quickRatingValue}
          inputMode="decimal"
          autoFocus
          disabled={saving}
          aria-label={ariaLabel}
          aria-invalid={hasError}
          placeholder="0,00"
          maxLength={4}
          onFocus={(event) =>
            event.currentTarget.select()
          }
          onChange={(event) => {
            setQuickRatingValue(
              sanitizeRatingDraft(
                event.target.value
              )
            );
            if (hasError) {
              setQuickRatingErrorKey(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();

              if (!saving) {
                void onSave();
              }

              return;
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeQuickRating();
            }
          }}
        />

        <button
          type="submit"
          className="quickRatingSave"
          disabled={saving}
          aria-label="Enregistrer la note"
          title="Enregistrer"
        >
          {saving ? '…' : '✓'}
        </button>
      </form>
    );
  }


  function openMovieMenu(
    movie:
      SavedMovie,

    diaryEntry:
      DiaryEntry | null =
      null
  ) {
    const soundtrackMode =
      page ===
      'soundtracks';

    const currentTitle =
      soundtrackMode
        ? getSoundtrackDisplayTitle(
            movie
          )
        : getMovieDisplayTitle(
            movie
          );

    const currentRating =
      soundtrackMode
        ? movie.soundtrackRating ??
          null
        : page === 'jellyfin'
          ? getMovieDatabaseEffectiveRating(
              movie
            )
        : page === 'diary'
          ? getDiaryPriorityRating(
              movie,
              diaryEntry || {}
            )
          : movie.rating ??
            null;

    const ratingText =
      currentRating !=
      null
        ? formatRating(
            currentRating
          )
        : '';

    setSelectedMovieMenu(
      movie
    );

    setSelectedDiaryEntry(
      diaryEntry
    );

    setMovieMenuTitle(
      currentTitle
    );

    setMovieMenuInitialTitle(
      currentTitle
    );

    const currentYear =
      movie.year != null
        ? String(movie.year)
        : '';

    setMovieMenuYear(
      currentYear
    );

    setMovieMenuInitialYear(
      currentYear
    );

    setMovieMenuRating(
      ratingText
    );

    setMovieMenuInitialRating(
      ratingText
    );

    setMovieMenuMessage(
      ''
    );
    setMovieMenuSearchQuery('');
    setMovieMenuSearchResults([]);
    setMovieMenuPosterLookupLoading(false);
  }


  function openMovieMenuPosterSource() {
    if (!selectedMovieMenu) {
      return;
    }

    const movie = selectedMovieMenu;

    if (page === 'soundtracks') {
      void runSoundtrackSearch(movie);
      return;
    }

    const posterMovie =
      page === 'diary'
        ? getUsFrPriorityPosterMovie(movie)
        : movie;

    if (!posterMovie.tmdbId) {
      setMovieMenuMessage(
        'Ajoute d’abord un ID TMDb / IMDb pour rechercher une affiche.'
      );
      return;
    }

    /* Le menu du film reste ouvert en arrière-plan : après le choix
       d'une affiche, on revient directement sur le même film. */
    void openPosterPicker(posterMovie, 'movie');
  }


  function handleMovieMenuPosterClick() {
    if (moviePosterClickTimerRef.current !== null) {
      window.clearTimeout(moviePosterClickTimerRef.current);
    }

    moviePosterClickTimerRef.current = window.setTimeout(() => {
      moviePosterClickTimerRef.current = null;
      openMovieMenuPosterSource();
    }, 230);
  }


  function handleMovieMenuPosterDoubleClick() {
    if (moviePosterClickTimerRef.current !== null) {
      window.clearTimeout(moviePosterClickTimerRef.current);
      moviePosterClickTimerRef.current = null;
    }

    if (!uploadingPoster) {
      moviePosterUploadInputRef.current?.click();
    }
  }


  function handleMobileActionPosterClick() {
    if (!mobileMovieAction) {
      return;
    }

    if (mobileActionPosterClickTimerRef.current !== null) {
      window.clearTimeout(mobileActionPosterClickTimerRef.current);
    }

    mobileActionPosterClickTimerRef.current = window.setTimeout(() => {
      mobileActionPosterClickTimerRef.current = null;

      const action = mobileMovieAction;

      if (!action) {
        return;
      }

      setMobileMovieAction(null);

      if (page === 'soundtracks') {
        void runSoundtrackSearch(action.movie);
        return;
      }

      const posterMovie =
        page === 'diary'
          ? getUsFrPriorityPosterMovie(action.movie)
          : action.movie;

      if (posterMovie.tmdbId) {
        void openPosterPicker(posterMovie, 'movie');
        return;
      }

      openMovieMenu(action.movie, action.diaryEntry);
    }, 230);
  }


  function handleMobileActionPosterDoubleClick() {
    if (!mobileMovieAction) {
      return;
    }

    if (mobileActionPosterClickTimerRef.current !== null) {
      window.clearTimeout(mobileActionPosterClickTimerRef.current);
      mobileActionPosterClickTimerRef.current = null;
    }

    const action = mobileMovieAction;
    setMobileMovieAction(null);
    openMovieMenu(action.movie, action.diaryEntry);

    window.setTimeout(() => {
      if (!uploadingPoster) {
        moviePosterUploadInputRef.current?.click();
      }
    }, 0);
  }


  // Fonctions conservées pour l'interface mobile ; lecture explicite pour TypeScript noUnusedLocals.
  void handleMobileActionPosterClick;
  void handleMobileActionPosterDoubleClick;

  function closeMovieMenu() {
    if (moviePosterClickTimerRef.current !== null) {
      window.clearTimeout(moviePosterClickTimerRef.current);
      moviePosterClickTimerRef.current = null;
    }

    setSelectedMovieMenu(
      null
    );

    setSelectedDiaryEntry(
      null
    );

    setMovieMenuTitle(
      ''
    );

    setMovieMenuInitialTitle(
      ''
    );

    setMovieMenuYear(
      ''
    );

    setMovieMenuInitialYear(
      ''
    );

    setMovieMenuRating(
      ''
    );

    setMovieMenuInitialRating(
      ''
    );

    setMovieMenuMessage(
      ''
    );
    setMovieMenuSearchQuery('');
    setMovieMenuSearchResults([]);
    setMovieMenuPosterLookupLoading(false);

    setSavingMovieMenu(
      false
    );

    setUploadingPoster(
      false
    );
  }


  function movieMenuHasChanges() {
    if (
      !selectedMovieMenu
    ) {
      return false;
    }

    const titleChanged =
      movieMenuTitle.trim() !==
      movieMenuInitialTitle.trim();

    const yearChanged =
      movieMenuYear.trim() !==
      movieMenuInitialYear.trim();

    const rating =
      normalizeMovieMenuRating(
        movieMenuRating
      );

    const initialRating =
      normalizeMovieMenuRating(
        movieMenuInitialRating
      );

    const rawRatingChanged =
      movieMenuRating
        .trim()
        .replace(
          ',',
          '.'
        ) !==
      movieMenuInitialRating
        .trim()
        .replace(
          ',',
          '.'
        );

    const ratingChanged =
      rating ===
      undefined
        ? rawRatingChanged
        : initialRating !==
            undefined &&
          rating !==
            initialRating;

    return (
      titleChanged ||
      yearChanged ||
      ratingChanged
    );
  }


  async function saveMovieMenuChanges() {
    if (
      !selectedMovieMenu ||
      !user ||
      !movieMenuHasChanges()
    ) {
      return;
    }

    const cleanTitle =
      sanitizeMovieTitle(
        movieMenuTitle.trim(),
        movieMenuYear.trim() ||
          selectedMovieMenu.year
      );

    if (
      !cleanTitle
    ) {
      setMovieMenuMessage(
        'Le titre ne peut pas être vide.'
      );
      return;
    }

    const cleanYear =
      movieMenuYear.trim();

    if (
      cleanYear &&
      !/^\d{4}$/.test(
        cleanYear
      )
    ) {
      setMovieMenuMessage(
        'L’année doit contenir 4 chiffres.'
      );
      return;
    }

    const normalizedRating =
      normalizeMovieMenuRating(
        movieMenuRating
      );

    if (
      normalizedRating ===
      undefined
    ) {
      setMovieMenuMessage(
        'La note doit être comprise entre 0,0 et 5,0.'
      );
      return;
    }

    const titleChanged =
      cleanTitle !==
      movieMenuInitialTitle.trim();

    const yearChanged =
      cleanYear !==
      movieMenuInitialYear.trim();

    const initialRating =
      normalizeMovieMenuRating(
        movieMenuInitialRating
      );

    const ratingChanged =
      initialRating !==
      undefined &&
      normalizedRating !==
      initialRating;

    const usFrAuthority =
      page === 'jellyfin' ||
      page === 'diary'
        ? getUsFrPriorityRating(selectedMovieMenu)
        : null;

    const preserveUsFrRating =
      Boolean(usFrAuthority);

    const historyIds =
      new Set(
        getLinkedMovies(
          selectedMovieMenu
        ).map(
          (linkedMovie) =>
            linkedMovie.docId
        )
      );

    if (
      page === 'soundtracks'
    ) {
      historyIds.add(
        getSoundtrackCarrier(
          selectedMovieMenu
        ).docId
      );
    }

    const historyBefore =
      snapshotMovieIds(
        historyIds
      );

    try {
      setSavingMovieMenu(
        true
      );

      if (
        page ===
        'soundtracks'
      ) {
        const carrier =
          getSoundtrackCarrier(
            selectedMovieMenu
          );

        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            carrier.docId
          );

        const patch:
          Record<
            string,
            unknown
          > = {
          soundtrackIndependent:
            true,
          soundtrackUpdatedAt:
            serverTimestamp(),
        };

        if (
          titleChanged
        ) {
          patch.soundtrackTitle =
            cleanTitle;
        }

        if (
          ratingChanged
        ) {
          patch.soundtrackRating =
            normalizedRating;
        }

        await setDoc(
          movieRef,
          patch,
          {
            merge: true,
          }
        );

        if (
          yearChanged
        ) {
          await updateMovieEverywhere(
            selectedMovieMenu,
            {
              year:
                cleanYear || null,
              yearUpdatedAt:
                serverTimestamp(),
            }
          );
        }

        setSelectedMovieMenu({
          ...selectedMovieMenu,
          year:
            yearChanged
              ? cleanYear || null
              : selectedMovieMenu.year,
          soundtrackTitle:
            titleChanged
              ? cleanTitle
              : selectedMovieMenu.soundtrackTitle,
          soundtrackRating:
            ratingChanged
              ? normalizedRating
              : selectedMovieMenu.soundtrackRating,
          soundtrackIndependent:
            true,
        });
      } else {
        const patch:
          Record<
            string,
            unknown
          > = {};

        if (
          titleChanged
        ) {
          patch.customTitle =
            cleanTitle;
          patch.customTitleLanguage =
            'manual';
          patch.customTitleUpdatedAt =
            serverTimestamp();
        }

        if (
          yearChanged
        ) {
          patch.year =
            cleanYear || null;
          patch.yearUpdatedAt =
            serverTimestamp();
        }

        if (
          ratingChanged &&
          !preserveUsFrRating
        ) {
          patch.rating =
            normalizedRating;
          patch.ratingUpdatedAt =
            serverTimestamp();
        }

        await updateMovieEverywhere(
          selectedMovieMenu,
          patch
        );

        setSelectedMovieMenu({
          ...selectedMovieMenu,
          customTitle:
            titleChanged
              ? cleanTitle
              : selectedMovieMenu.customTitle,
          customTitleLanguage:
            titleChanged
              ? 'manual'
              : selectedMovieMenu.customTitleLanguage,
          year:
            yearChanged
              ? cleanYear || null
              : selectedMovieMenu.year,
          rating:
            preserveUsFrRating && usFrAuthority
              ? usFrAuthority.rating
              : ratingChanged
              ? normalizedRating
              : selectedMovieMenu.rating,
        });
      }

      const finalSavedRating =
        preserveUsFrRating && usFrAuthority
          ? usFrAuthority.rating
          : normalizedRating;

      const savedRatingText =
        finalSavedRating !=
        null
          ? formatRating(
              finalSavedRating
            )
          : '';

      setMovieMenuTitle(
        cleanTitle
      );
      setMovieMenuInitialTitle(
        cleanTitle
      );
      setMovieMenuYear(
        cleanYear
      );
      setMovieMenuInitialYear(
        cleanYear
      );
      setMovieMenuRating(
        savedRatingText
      );
      setMovieMenuInitialRating(
        savedRatingText
      );

      setMovieMenuMessage(
        'Modifications sauvegardées.'
      );

      addHistoryEntry(
        `Modification film : ${cleanTitle}`,
        historyBefore
      );

      /* Save ne ferme plus le menu : on peut continuer à corriger,
         changer l'affiche ou passer au film suivant. */
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMovieMenuMessage(
        "Impossible d'enregistrer les modifications."
      );
    } finally {
      setSavingMovieMenu(
        false
      );
    }
  }


  async function searchMovieMenuTitleOnTmdb(
    searchTitle: string
  ) {
    const cleanSearchTitle =
      searchTitle.trim();

    if (
      !selectedMovieMenu ||
      !cleanSearchTitle ||
      !apiKey
    ) {
      return;
    }

    try {
      setMovieMenuSearchLoading(true);
      setMovieMenuMessage('');
      setMovieMenuSearchResults([]);

      const endpoint =
        selectedMovieMenu.tmdbMediaType === 'tv' || page === 'series'
          ? 'tv'
          : 'movie';

      const imdbId =
        extractImdbId(cleanSearchTitle);

      let rawResults: any[] = [];

      if (imdbId) {
        const response = await fetch(
          `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&language=fr-FR&external_source=imdb_id`
        );

        if (!response.ok) {
          throw new Error('Erreur TMDb');
        }

        const data = await response.json();
        rawResults = endpoint === 'tv'
          ? data.tv_results || []
          : data.movie_results || [];
      } else {
        const response = await fetch(
          `https://api.themoviedb.org/3/search/${endpoint}?api_key=${apiKey}&language=fr-FR&include_adult=false&query=${encodeURIComponent(cleanSearchTitle)}`
        );

        if (!response.ok) {
          throw new Error('Erreur TMDb');
        }

        const data = await response.json();
        rawResults = Array.isArray(data.results)
          ? data.results
          : [];
      }

      const results = rawResults
        .slice(0, 8)
        .map((item: any) => ({
          id: item.id,
          title: item.title || item.name || '',
          original_title: item.original_title || item.original_name || '',
          release_date: item.release_date || item.first_air_date || '',
          poster_path: item.poster_path || null,
          backdrop_path: item.backdrop_path || null,
          overview: item.overview || '',
        }));

      setMovieMenuSearchResults(results);

      if (results.length === 0) {
        setMovieMenuMessage(
          imdbId
            ? `Aucun résultat TMDb pour ${imdbId}.`
            : 'Aucun résultat TMDb.'
        );
      }
    } catch (error) {
      console.error(error);
      setMovieMenuMessage(
        'Impossible de rechercher ce film sur TMDb.'
      );
    } finally {
      setMovieMenuSearchLoading(false);
    }
  }

  function startMovieMenuTmdbSearch() {
    if (!selectedMovieMenu) {
      return;
    }

    const title =
      movieMenuTitle.trim() ||
      getMovieDisplayTitle(
        selectedMovieMenu
      ).trim();

    if (!title) {
      setMovieMenuMessage(
        'Aucun titre disponible pour la recherche TMDb.'
      );
      return;
    }

    setMovieMenuSearchQuery(
      title
    );
    void searchMovieMenuTitleOnTmdb(
      title
    );
  }

  async function associateUnknownMovieFromMenu(candidate: TmdbMovie) {
    if (!selectedMovieMenu || !user) return;
    const mediaType: 'movie' | 'tv' = selectedMovieMenu.tmdbMediaType === 'tv' || page === 'series' ? 'tv' : 'movie';
    try {
      setSavingMovieMenu(true);
      const preferredPoster = await getPreferredPosterPath(candidate.id, candidate.poster_path, mediaType);
      const preferredTitle = await getPreferredFrenchTitle(candidate.id, candidate.title, mediaType);
      const patch = {
        tmdbId: candidate.id,
        tmdbMediaType: mediaType,
        tmdbTitle: candidate.title,
        localizedTitle: preferredTitle,
        originalTitle: candidate.original_title || null,
        releaseDate: candidate.release_date || null,
        year: candidate.release_date ? candidate.release_date.substring(0,4) : selectedMovieMenu.year || null,
        posterPath: preferredPoster,
        backdropPath: candidate.backdrop_path || null,
        overview: candidate.overview || '',
        tmdbMatchStatus: 'matched' as const,
        tmdbManualMatch: true,
        tmdbMatchedAt: serverTimestamp(),
      };
      await updateMovieEverywhere(selectedMovieMenu, patch);
      setSelectedMovieMenu({ ...selectedMovieMenu, ...patch });

      const associatedYear =
        patch.year != null
          ? String(patch.year)
          : '';
      setMovieMenuYear(associatedYear);
      setMovieMenuInitialYear(associatedYear);

      /* Si l'ID IMDb a été saisi temporairement dans le champ Titre pour
         effectuer la recherche, on remet le vrai titre après l'association
         afin de ne jamais enregistrer accidentellement « tt… » comme titre. */
      if (
        extractImdbId(movieMenuSearchQuery) ||
        extractImdbId(movieMenuTitle)
      ) {
        setMovieMenuTitle(
          movieMenuInitialTitle.trim() ||
          preferredTitle ||
          candidate.title
        );
      }

      setMovieMenuSearchResults([]);
      setMovieMenuSearchQuery('');
      setMovieMenuMessage('Association TMDb enregistrée.');
    } catch (error) {
      console.error(error);
      setMovieMenuMessage("Impossible d'associer ce titre.");
    } finally {
      setSavingMovieMenu(false);
    }
  }

  async function findMovieMenuPostersByTitle() {
    if (!selectedMovieMenu || !apiKey) {
      return;
    }

    const cleanTitle =
      movieMenuTitle.trim() ||
      getMovieDisplayTitle(selectedMovieMenu).trim();

    if (!cleanTitle) {
      setMovieMenuMessage('Aucun titre ou ID IMDb disponible pour rechercher des affiches.');
      return;
    }

    const imdbId =
      extractImdbId(cleanTitle);

    const cleanYear =
      movieMenuYear.trim() ||
      (selectedMovieMenu.year != null ? String(selectedMovieMenu.year) : '');

    const mediaType: 'movie' | 'tv' =
      selectedMovieMenu.tmdbMediaType === 'tv' || page === 'series'
        ? 'tv'
        : 'movie';

    const mapCandidate = (item: any): TmdbMovie => ({
      id: item.id,
      title: item.title || item.name || '',
      original_title: item.original_title || item.original_name || '',
      release_date: item.release_date || item.first_air_date || '',
      poster_path: item.poster_path || null,
      backdrop_path: item.backdrop_path || null,
      overview: item.overview || '',
    });

    const runImdbSearch = async (): Promise<TmdbMovie | null> => {
      if (!imdbId) {
        return null;
      }

      const response = await fetch(
        `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&language=fr-FR&external_source=imdb_id`
      );

      if (!response.ok) {
        throw new Error(`Recherche IMDb ${response.status}`);
      }

      const data = await response.json();
      const rawResults =
        mediaType === 'tv'
          ? data.tv_results || []
          : data.movie_results || [];

      const results: TmdbMovie[] = rawResults
        .slice(0, 8)
        .map(mapCandidate);

      if (results.length === 0) {
        return null;
      }

      return (
        results.find((candidate) => Boolean(candidate.poster_path)) ||
        results[0] ||
        null
      );
    };

    const runSearch = async (withYear: boolean): Promise<TmdbMovie | null> => {
      const params = new URLSearchParams({
        api_key: apiKey,
        language: 'fr-FR',
        include_adult: 'false',
        query: cleanTitle,
      });

      if (withYear && cleanYear) {
        params.set(
          mediaType === 'tv' ? 'first_air_date_year' : 'primary_release_year',
          cleanYear
        );
      }

      const response = await fetch(
        `https://api.themoviedb.org/3/search/${mediaType}?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`Recherche affiches ${response.status}`);
      }

      const data = await response.json();
      const results: TmdbMovie[] = (Array.isArray(data?.results) ? data.results : [])
        .slice(0, 20)
        .map(mapCandidate);

      if (results.length === 0) {
        return null;
      }

      const normalizedWanted = normalizeMovieTitle(cleanTitle, cleanYear);
      const exactMatches = results.filter((candidate) =>
        [candidate.title, candidate.original_title]
          .map((value) => normalizeMovieTitle(value || '', cleanYear))
          .includes(normalizedWanted)
      );

      const exactWithPoster = exactMatches.find((candidate) => Boolean(candidate.poster_path));
      if (exactWithPoster) {
        return exactWithPoster;
      }

      const firstWithPoster = results.find((candidate) => Boolean(candidate.poster_path));
      return firstWithPoster || exactMatches[0] || results[0] || null;
    };

    try {
      setMovieMenuPosterLookupLoading(true);
      setMovieMenuMessage(
        imdbId
          ? `Recherche des affiches pour ${imdbId}…`
          : 'Recherche des affiches correspondant au titre…'
      );

      let candidate = imdbId
        ? await runImdbSearch()
        : await runSearch(Boolean(cleanYear));

      if (!candidate && !imdbId && cleanYear) {
        candidate = await runSearch(false);
      }

      if (!candidate) {
        setMovieMenuMessage(
          imdbId
            ? `Aucune affiche trouvée pour ${imdbId}.`
            : `Aucune affiche trouvée pour « ${cleanTitle} ».`
        );
        return;
      }

      if (imdbId) {
        const currentDisplayTitle =
          getMovieDisplayTitle(selectedMovieMenu).trim();

        if (currentDisplayTitle) {
          setMovieMenuTitle(currentDisplayTitle);
        }
      }

      await openPosterPicker(
        selectedMovieMenu,
        'movie',
        candidate.id,
        mediaType
      );

      setMovieMenuMessage('');
    } catch (error) {
      console.error(error);
      setMovieMenuMessage(
        imdbId
          ? 'Impossible de rechercher les affiches avec cet ID IMDb.'
          : 'Impossible de rechercher les affiches pour ce titre.'
      );
    } finally {
      setMovieMenuPosterLookupLoading(false);
    }
  }

  function upscaleItunesArtwork(url?: string) {
    if (!url) return '';
    return url.replace(/100x100bb/i, '600x600bb').replace(/100x100-75/i, '600x600-75');
  }

  async function runSoundtrackSearch(movie: SavedMovie, query?: string) {
    const linked = getLinkedMovies(movie);
    const usCarrier =
      linked.find((item) => Boolean(item.rankings?.topUS)) ||
      null;

    const rawRequestedQuery =
      query?.trim() || '';

    const requestedImdbId =
      extractImdbId(rawRequestedQuery);

    let imdbResolvedTitle = '';
    let imdbResolvedOriginalTitle = '';

    /* Le champ B.O. accepte aussi un ID / une URL IMDb. On résout d'abord
       l'identité via TMDb, puis on envoie le vrai titre à iTunes. */
    if (requestedImdbId) {
      if (!apiKey) {
        setSelectedSoundtrackSearchMovie(movie);
        setSoundtrackSearchQuery(rawRequestedQuery);
        setSoundtrackSearchResults([]);
        setSoundtrackSearchMessage(
          "La clé TMDb n'est pas configurée pour résoudre cet IMDb."
        );
        return;
      }

      try {
        const response = await fetch(
          `https://api.themoviedb.org/3/find/${encodeURIComponent(requestedImdbId)}?api_key=${apiKey}&language=fr-FR&external_source=imdb_id`
        );

        if (!response.ok) {
          throw new Error('Erreur TMDb');
        }

        const data = await response.json();
        const match =
          (data.movie_results || [])[0] ||
          (data.tv_results || [])[0] ||
          null;

        if (!match) {
          setSelectedSoundtrackSearchMovie(movie);
          setSoundtrackSearchQuery(rawRequestedQuery);
          setSoundtrackSearchResults([]);
          setSoundtrackSearchMessage(
            `Aucun film trouvé pour ${requestedImdbId}.`
          );
          return;
        }

        imdbResolvedTitle =
          match.title ||
          match.name ||
          '';
        imdbResolvedOriginalTitle =
          match.original_title ||
          match.original_name ||
          '';
      } catch (error) {
        console.error(error);
        setSelectedSoundtrackSearchMovie(movie);
        setSoundtrackSearchQuery(rawRequestedQuery);
        setSoundtrackSearchResults([]);
        setSoundtrackSearchMessage(
          'Impossible de résoudre cet IMDb.'
        );
        return;
      }
    }

    const titleCandidates = Array.from(
      new Set(
        [
          imdbResolvedTitle,
          imdbResolvedOriginalTitle,
          requestedImdbId ? '' : rawRequestedQuery,
          usCarrier?.originalTitle || '',
          usCarrier?.tmdbTitle || '',
          usCarrier?.title || '',
          movie.originalTitle || '',
          movie.tmdbTitle || '',
          movie.title || '',
          getSoundtrackDisplayTitle(movie),
        ]
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );

    const primaryQuery =
      titleCandidates[0] ||
      getSoundtrackDisplayTitle(movie).trim();

    setSelectedSoundtrackSearchMovie(movie);
    setSoundtrackSearchQuery(
      requestedImdbId
        ? rawRequestedQuery
        : primaryQuery
    );
    setSoundtrackSearchResults([]);
    setSoundtrackSearchMessage('');

    if (!primaryQuery) return;

    try {
      setSoundtrackSearchLoading(true);

      /* Les noms US/originaux donnent en général des résultats iTunes
         nettement plus pertinents pour les bandes originales. */
      const searchTitles =
        titleCandidates.slice(0, 4);

      const requests = searchTitles.flatMap((title) => [
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          `${title} soundtrack`
        )}&entity=album&country=US&limit=30`,
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          `${title} original motion picture soundtrack`
        )}&entity=album&country=US&limit=20`,
      ]);

      /* On conserve toutes les variantes de recherche, mais sans lancer
         huit requêtes iTunes d'un seul coup. */
      const responses: ItunesAlbum[][] = [];

      for (let index = 0; index < requests.length; index += 3) {
        const batch =
          requests.slice(index, index + 3);

        const batchResults =
          await Promise.all(
            batch.map(async (url) => {
              try {
                return await fetchItunesAlbums(url);
              } catch {
                return [] as ItunesAlbum[];
              }
            })
          );

        responses.push(...batchResults);
      }

      const unique = new Map<number, ItunesAlbum>();
      for (const result of responses.flat()) {
        if (!unique.has(result.collectionId)) {
          unique.set(result.collectionId, result);
        }
      }

      const normalizedTitles =
        titleCandidates.map(normalizeTitle);
      const movieYear = Number(movie.year || 0);

      const scoreResult = (album: ItunesAlbum) => {
        const albumName = normalizeTitle(album.collectionName || '');
        const artistName = normalizeTitle(album.artistName || '');
        const genre = normalizeTitle(album.primaryGenreName || '');
        let score = 0;

        for (const title of normalizedTitles) {
          if (!title) continue;
          if (albumName === title) score += 35;
          else if (albumName.includes(title)) score += 28;
          else {
            const words = title.split(' ').filter((word) => word.length > 2);
            const matched = words.filter((word) => albumName.includes(word)).length;
            score += Math.min(16, matched * 4);
          }
        }

        if (/soundtrack|bande originale|original motion picture/.test(albumName)) {
          score += 24;
        }
        if (/score|original score/.test(albumName)) {
          score += 16;
        }
        if (/soundtrack/.test(genre)) {
          score += 12;
        }
        if (/tribute|karaoke|cover version|inspired by/.test(albumName + ' ' + artistName)) {
          score -= 25;
        }

        if (movieYear && album.releaseDate) {
          const albumYear = Number(album.releaseDate.slice(0, 4));
          if (albumYear) {
            const delta = Math.abs(albumYear - movieYear);
            if (delta === 0) score += 8;
            else if (delta <= 2) score += 5;
            else if (delta <= 5) score += 2;
          }
        }

        return score;
      };

      const ranked = Array.from(unique.values())
        .map((album) => ({ album, score: scoreResult(album) }))
        .filter((item) => item.score > 8)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map((item) => item.album);

      setSoundtrackSearchResults(ranked);
      if (ranked.length === 0) {
        setSoundtrackSearchMessage(
          'Aucune B.O. suffisamment pertinente trouvée sur iTunes. Essaie le titre US/original.'
        );
      }
    } catch (error) {
      console.error(error);
      setSoundtrackSearchMessage('Impossible de rechercher les pochettes iTunes.');
    } finally {
      setSoundtrackSearchLoading(false);
    }
  }

  function closeSoundtrackSearch() {
    setSelectedSoundtrackSearchMovie(null);
    setSoundtrackSearchResults([]);
    setSoundtrackSearchMessage('');
  }

  async function chooseItunesSoundtrack(album: ItunesAlbum) {
    if (!user || !selectedSoundtrackSearchMovie) return;
    try {
      const carrier = getSoundtrackCarrier(selectedSoundtrackSearchMovie);
      const cover = upscaleItunesArtwork(album.artworkUrl100);
      const movieRef = doc(db, 'users', user.uid, 'movies', carrier.docId);
      await setDoc(movieRef, {
        soundtrackIndependent: true,
        soundtrackCoverUrl: cover || null,
        soundtrackCoverPath: null,
        soundtrackMusicSource: 'itunes',
        soundtrackMusicAlbumId: album.collectionId,
        soundtrackCoverUpdatedAt: serverTimestamp(),
      }, { merge: true });
      closeSoundtrackSearch();
    } catch (error) {
      console.error(error);
      setSoundtrackSearchMessage("Impossible d'enregistrer cette pochette.");
    }
  }


  function lpAlbumIdentityKey(
    title: string,
    artist: string
  ) {
    return `${normalizeTitle(title)}|${normalizeTitle(artist)}`;
  }


  function getNextLpPosition() {
    const positions =
      savedAlbums
        .map((album) => album.position)
        .filter(
          (position): position is number =>
            typeof position === 'number' &&
            Number.isFinite(position)
        );

    return positions.length > 0
      ? Math.max(...positions) + 1
      : 1;
  }


  function openLpAdd() {
    setLpAddOpen(true);
    setLpSearchQuery('');
    setLpSearchResults([]);
    setLpSuggestions([]);
    setLpSuggestionsLoading(false);
    setLpAddMessage('');
    setLpItunesIdOpen(false);
    setLpItunesIdInput('');
    setLpItunesIdLoading(false);
  }


  function closeLpAdd() {
    setLpAddOpen(false);
    setLpSearchQuery('');
    setLpSearchResults([]);
    setLpSuggestions([]);
    setLpSuggestionsLoading(false);
    setLpAddMessage('');
    setLpItunesIdOpen(false);
    setLpItunesIdInput('');
    setLpItunesIdLoading(false);
    setAddingLpAlbum(null);
  }


  async function searchLpAlbums(
    event: FormEvent
  ) {
    event.preventDefault();

    const q =
      lpSearchQuery.trim();

    if (!q) {
      return;
    }

    try {
      setLpSearchLoading(true);
      setLpSuggestions([]);
      setLpAddMessage('');

      const results =
        await fetchItunesAlbums(
          `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&country=FR&limit=40`
        );

      setLpSearchResults(results);

      if (results.length === 0) {
        setLpAddMessage(
          'Aucun album trouvé.'
        );
      }
    } catch (error) {
      console.error(error);
      setLpAddMessage(
        'Impossible de rechercher cet album.'
      );
    } finally {
      setLpSearchLoading(false);
    }
  }


  function extractItunesCollectionId(
    value: string
  ) {
    const raw = value.trim();

    if (!raw) {
      return null;
    }

    if (/^\d+$/.test(raw)) {
      const directId = Number(raw);
      return Number.isSafeInteger(directId) && directId > 0
        ? directId
        : null;
    }

    const urlMatch = raw.match(
      /(?:\/id|[?&](?:id|i)=)(\d+)/i
    );

    if (!urlMatch) {
      return null;
    }

    const urlId = Number(urlMatch[1]);
    return Number.isSafeInteger(urlId) && urlId > 0
      ? urlId
      : null;
  }


  async function addLpAlbumByItunesId() {
    if (!user || lpItunesIdLoading) {
      return;
    }

    const collectionId =
      extractItunesCollectionId(
        lpItunesIdInput
      );

    if (!collectionId) {
      setLpAddMessage(
        'Entre un ID iTunes valide (ou une URL d’album iTunes).'
      );
      return;
    }

    try {
      setLpItunesIdLoading(true);
      setLpAddMessage(
        `Recherche de l’album iTunes #${collectionId}…`
      );

      const results =
        await fetchItunesAlbums(
          `https://itunes.apple.com/lookup?id=${collectionId}&country=FR`
        );

      const album =
        results.find(
          (candidate) =>
            Number(candidate.collectionId) === collectionId &&
            Boolean(candidate.collectionName) &&
            Boolean(candidate.artistName)
        ) ||
        results.find(
          (candidate) =>
            Boolean(candidate.collectionName) &&
            Boolean(candidate.artistName)
        ) ||
        null;

      if (!album) {
        setLpAddMessage(
          `Aucun album iTunes trouvé pour l’ID ${collectionId}.`
        );
        return;
      }

      setLpSearchResults([album]);
      setLpSearchQuery(album.collectionName);
      setLpSuggestions([]);
      setLpItunesIdInput('');

      await addItunesAlbumToLp(
        album
      );
    } catch (error) {
      console.error(error);
      setLpAddMessage(
        'Impossible de récupérer cet album avec son ID iTunes.'
      );
    } finally {
      setLpItunesIdLoading(false);
    }
  }


  function cleanMusicboardSlug(value: string) {
    try {
      return decodeURIComponent(value)
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      return value
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }


  function extractMusicboardReference(value: string) {
    const raw = value.trim();

    if (!raw) {
      return null;
    }

    if (/^\d+$/.test(raw)) {
      const directId = Number(raw);
      return Number.isSafeInteger(directId) && directId > 0
        ? {
            id: directId,
            title: null as string | null,
            artist: null as string | null,
            url: null as string | null,
          }
        : null;
    }

    if (!/musicboard\.app/i.test(raw)) {
      return null;
    }

    const idMatch =
      raw.match(/[?&](?:id|album_id|content_id)=(\d+)/i) ||
      raw.match(/\/(?:album|albums)\/(\d+)(?:[/?#]|$)/i);

    const slugMatch =
      raw.match(/\/(?:review\/)?album\/([^/?#]+)\/([^/?#]+)(?:[/?#]|$)/i);

    return {
      id: idMatch ? Number(idMatch[1]) : null,
      title: slugMatch ? cleanMusicboardSlug(slugMatch[1]) : null,
      artist: slugMatch ? cleanMusicboardSlug(slugMatch[2]) : null,
      url: raw,
    };
  }


  function findMusicboardAlbumObject(
    value: unknown,
    expectedId: number | null,
    depth = 0
  ): Record<string, unknown> | null {
    if (depth > 7 || value == null) {
      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findMusicboardAlbumObject(
          item,
          expectedId,
          depth + 1
        );
        if (found) {
          return found;
        }
      }
      return null;
    }

    if (typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    const title =
      typeof record.title === 'string'
        ? record.title.trim()
        : '';
    const artistRecord =
      record.artist && typeof record.artist === 'object'
        ? (record.artist as Record<string, unknown>)
        : null;
    const artist =
      typeof record.artist === 'string'
        ? record.artist.trim()
        : artistRecord && typeof artistRecord.name === 'string'
        ? artistRecord.name.trim()
        : '';
    const recordId = Number(record.id);
    const idMatches =
      expectedId == null ||
      !Number.isFinite(recordId) ||
      recordId === expectedId;

    if (title && artist && idMatches) {
      return record;
    }

    for (const nested of Object.values(record)) {
      const found = findMusicboardAlbumObject(
        nested,
        expectedId,
        depth + 1
      );
      if (found) {
        return found;
      }
    }

    return null;
  }


  function musicboardObjectToIdentity(
    record: Record<string, unknown>,
    fallbackId: number | null,
    fallbackUrl: string | null
  ): MusicboardAlbumIdentity | null {
    const artistRecord =
      record.artist && typeof record.artist === 'object'
        ? (record.artist as Record<string, unknown>)
        : null;
    const title =
      typeof record.title === 'string'
        ? record.title.trim()
        : '';
    const artist =
      typeof record.artist === 'string'
        ? record.artist.trim()
        : artistRecord && typeof artistRecord.name === 'string'
        ? artistRecord.name.trim()
        : '';

    if (!title || !artist) {
      return null;
    }

    const rawId = Number(record.id);
    const releaseDate =
      typeof record.release_date === 'string'
        ? record.release_date
        : typeof record.releaseDate === 'string'
        ? record.releaseDate
        : typeof record.year === 'string' || typeof record.year === 'number'
        ? String(record.year)
        : '';
    const artwork = [
      record.cover_large,
      record.cover_medium,
      record.cover,
      record.artworkUrl,
      record.artwork,
      record.image,
    ].find(
      (item) =>
        typeof item === 'string' &&
        Boolean(item.trim())
    ) as string | undefined;
    const rawGenre =
      typeof record.genre === 'string'
        ? record.genre
        : typeof record.primaryGenreName === 'string'
        ? record.primaryGenreName
        : null;

    return {
      musicboardId:
        Number.isSafeInteger(rawId) && rawId > 0
          ? rawId
          : fallbackId,
      musicboardUrl: fallbackUrl,
      title,
      artist,
      artworkUrl: artwork?.trim() || null,
      year: releaseDate ? releaseDate.substring(0, 4) : null,
      genre: rawGenre,
    };
  }


  async function resolveMusicboardAlbum(
    rawValue: string
  ): Promise<MusicboardAlbumIdentity | null> {
    const reference = extractMusicboardReference(rawValue);

    if (!reference) {
      return null;
    }

    if (reference.id != null) {
      const id = reference.id;
      const endpoints = [
        `https://api.musicboard.app/v2/albums/${id}/`,
        `https://api.musicboard.app/v2/album/${id}/`,
        `https://api.musicboard.app/v2/contents/${id}/`,
        `https://api.musicboard.app/v2/content/${id}/`,
        `https://api.musicboard.app/v2/albums/?id=${id}`,
        `https://api.musicboard.app/v2/contents/?id=${id}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            headers: { Accept: 'application/json' },
          });

          if (!response.ok) {
            continue;
          }

          const payload = (await response.json()) as unknown;
          const albumObject = findMusicboardAlbumObject(
            payload,
            id
          );

          if (albumObject) {
            const identity = musicboardObjectToIdentity(
              albumObject,
              id,
              reference.url
            );
            if (identity) {
              return identity;
            }
          }
        } catch {
          /* Musicboard n'expose pas toujours les mêmes routes publiques.
             On essaie automatiquement la route suivante. */
        }
      }
    }

    if (reference.title && reference.artist) {
      return {
        musicboardId: reference.id,
        musicboardUrl: reference.url,
        title: reference.title,
        artist: reference.artist,
        artworkUrl: null,
        year: null,
        genre: null,
      };
    }

    return null;
  }


  async function findItunesEquivalentForMusicboard(
    identity: MusicboardAlbumIdentity
  ) {
    const results = await fetchItunesAlbums(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        `${identity.artist} ${identity.title}`
      )}&entity=album&country=FR&limit=40`
    );

    const normalizedTitle = normalizeTitle(identity.title);
    const normalizedArtist = normalizeTitle(identity.artist);

    return (
      results.find(
        (candidate) =>
          normalizeTitle(candidate.collectionName) === normalizedTitle &&
          normalizeTitle(candidate.artistName) === normalizedArtist
      ) ||
      results.find(
        (candidate) =>
          normalizeTitle(candidate.collectionName) === normalizedTitle &&
          itunesArtistMatches(identity.artist, candidate.artistName)
      ) ||
      results.find((candidate) =>
        itunesArtistMatches(identity.artist, candidate.artistName)
      ) ||
      results[0] ||
      null
    );
  }


  async function addMusicboardAlbumToLp(
    identity: MusicboardAlbumIdentity
  ) {
    if (!user) {
      return;
    }

    const existing = savedAlbums.find(
      (saved) =>
        (identity.musicboardId != null &&
          saved.musicboardId != null &&
          Number(saved.musicboardId) === identity.musicboardId) ||
        lpAlbumIdentityKey(saved.title, saved.artist) ===
          lpAlbumIdentityKey(identity.title, identity.artist)
    );

    if (existing) {
      setLpCoverMessage(`${identity.title} est déjà dans LP.`);
      return;
    }

    const suffix =
      identity.musicboardId != null
        ? String(identity.musicboardId)
        : hashString(
            `${normalizeTitle(identity.artist)}|${normalizeTitle(
              identity.title
            )}`
          );
    const documentId = `lp_mb_${suffix}`;
    const nextPosition = getNextLpPosition();
    const albumRef = doc(
      db,
      'users',
      user.uid,
      'albums',
      documentId
    );
    const historyBefore = snapshotAlbumIds([documentId]);

    await setDoc(
      albumRef,
      {
        title: identity.title,
        artist: identity.artist,
        position: nextPosition,
        rating: null,
        year: identity.year,
        artworkUrl: identity.artworkUrl,
        musicboardId: identity.musicboardId,
        musicboardUrl: identity.musicboardUrl,
        genre: identity.genre,
        lpArtworkSource: 'musicboard',
        addedAt: serverTimestamp(),
      },
      { merge: true }
    );

    addHistoryEntry(
      `Ajout album LP : ${identity.title}`,
      historyBefore
    );
    setLpCoverMessage(`${identity.title} ajouté à LP.`);
  }


  async function addLpAlbumFromCoverExternalId(
    provider: 'itunes' | 'musicboard'
  ) {
    if (
      !user ||
      !selectedLpCoverAlbum ||
      lpCoverExternalIdLoading
    ) {
      return;
    }

    const raw = lpCoverExternalIdInput.trim();
    if (!raw) {
      return;
    }

    try {
      setLpCoverExternalIdLoading(provider);
      setLpCoverMessage('');

      if (provider === 'itunes') {
        const collectionId = extractItunesCollectionId(raw);

        if (!collectionId) {
          setLpCoverMessage('ID / URL iTunes invalide.');
          return;
        }

        const results = await fetchItunesAlbums(
          `https://itunes.apple.com/lookup?id=${collectionId}&country=FR`
        );
        const album =
          results.find(
            (candidate) =>
              Number(candidate.collectionId) === collectionId &&
              Boolean(candidate.collectionName) &&
              Boolean(candidate.artistName)
          ) ||
          results.find(
            (candidate) =>
              Boolean(candidate.collectionName) &&
              Boolean(candidate.artistName)
          ) ||
          null;

        if (!album) {
          setLpCoverMessage(
            `Aucun album iTunes trouvé pour l’ID ${collectionId}.`
          );
          return;
        }

        await addItunesAlbumToLp(album, {
          keepCoverPickerOpen: true,
        });
        setLpCoverExternalIdInput('');
        return;
      }

      const identity = await resolveMusicboardAlbum(raw);

      if (!identity) {
        setLpCoverMessage(
          'ID Musicboard introuvable. Tu peux aussi coller l’URL Musicboard de l’album.'
        );
        return;
      }

      try {
        const itunesEquivalent =
          await findItunesEquivalentForMusicboard(identity);

        if (itunesEquivalent) {
          await addItunesAlbumToLp(itunesEquivalent, {
            keepCoverPickerOpen: true,
          });
          setLpCoverExternalIdInput('');
          return;
        }
      } catch {
        /* Pas d'équivalent iTunes : on garde directement Musicboard. */
      }

      await addMusicboardAlbumToLp(identity);
      setLpCoverExternalIdInput('');
    } catch (error) {
      console.error(error);
      setLpCoverMessage(
        provider === 'itunes'
          ? 'Impossible de récupérer cet album iTunes.'
          : 'Impossible de récupérer cet album Musicboard.'
      );
    } finally {
      setLpCoverExternalIdLoading(null);
    }
  }


  async function addItunesAlbumToLp(
    album: ItunesAlbum,
    options?: { keepCoverPickerOpen?: boolean }
  ) {
    if (!user) {
      return;
    }

    const keepCoverPickerOpen =
      options?.keepCoverPickerOpen === true;

    try {
      setAddingLpAlbum(
        album.collectionId
      );

      if (keepCoverPickerOpen) {
        setLpCoverMessage('');
      } else {
        setLpAddMessage('');
      }

      const existing =
        savedAlbums.find(
          (saved) =>
            (saved.itunesCollectionId != null &&
              saved.itunesCollectionId === album.collectionId) ||
            lpAlbumIdentityKey(
              saved.title,
              saved.artist
            ) ===
              lpAlbumIdentityKey(
                album.collectionName,
                album.artistName
              )
        );

      if (existing) {
        const message =
          `${album.collectionName} est déjà dans LP.`;

        if (keepCoverPickerOpen) {
          setLpCoverMessage(message);
        } else {
          setLpAddMessage(message);
        }
        return;
      }

      const documentId =
        `lp_${album.collectionId}`;

      const albumRef =
        doc(
          db,
          'users',
          user.uid,
          'albums',
          documentId
        );

      const historyBefore =
        snapshotAlbumIds([
          documentId,
        ]);

      const nextPosition = getNextLpPosition();
      const nextYear =
        album.releaseDate
          ? album.releaseDate.substring(0, 4)
          : null;
      const nextArtwork =
        upscaleItunesArtwork(
          album.artworkUrl100
        ) || null;

      await setDoc(
        albumRef,
        {
          title:
            album.collectionName,
          artist:
            album.artistName,
          position:
            nextPosition,
          rating: null,
          year:
            nextYear,
          artworkUrl:
            nextArtwork,
          itunesCollectionId:
            album.collectionId,
          genre:
            album.primaryGenreName || null,
          addedAt:
            serverTimestamp(),
        },
        { merge: true }
      );

      addHistoryEntry(
        `Ajout album LP : ${album.collectionName}`,
        historyBefore
      );

      if (keepCoverPickerOpen) {
        setLpCoverMessage(
          `${album.collectionName} ajouté à LP.`
        );
      } else {
        setLpAddMessage(
          `${album.collectionName} ajouté à LP.`
        );
        setLpSearchQuery('');
        setLpSuggestions([]);

        openLpCoverPicker({
          docId: documentId,
          title: album.collectionName,
          artist: album.artistName,
          position: nextPosition,
          rating: null,
          year: nextYear,
          artworkUrl: nextArtwork,
          itunesCollectionId: album.collectionId,
          genre: album.primaryGenreName || null,
        });
      }
    } catch (error) {
      console.error(error);
      if (keepCoverPickerOpen) {
        setLpCoverMessage(
          "Impossible d'ajouter cet album à LP."
        );
      } else {
        setLpAddMessage(
          "Impossible d'ajouter cet album."
        );
      }
    } finally {
      setAddingLpAlbum(null);
    }
  }


  function closeLpCoverPicker() {
    if (lpCoverClickTimerRef.current !== null) {
      window.clearTimeout(lpCoverClickTimerRef.current);
      lpCoverClickTimerRef.current = null;
    }

    setSelectedLpCoverAlbum(null);
    setLpCoverYear('');
    setSavingLpYear(false);
    setLpCoverSearchQuery('');
    setLpCoverSearchResults([]);
    setLpCoverMessage('');
    setLpCoverExternalIdInput('');
    setLpCoverExternalIdLoading(null);
    setSavingLpCover(null);
    setUploadingLpCover(false);
    setDeletingLpAlbum(false);
  }


  function itunesArtistMatches(
    selectedArtist: string,
    candidateArtist: string
  ) {
    const selected =
      normalizeTitle(selectedArtist);
    const candidate =
      normalizeTitle(candidateArtist);

    if (!selected || !candidate) {
      return false;
    }

    return (
      selected === candidate ||
      selected.includes(candidate) ||
      candidate.includes(selected)
    );
  }


  async function runLpCoverSearch(
    album: SavedAlbum,
    query?: string
  ) {
    /*
     * Le sélecteur LP est verrouillé sur l'artiste de l'album choisi.
     * Le champ de recherche sert uniquement à préciser un titre d'album ;
     * les résultats d'autres artistes sont filtrés avant affichage.
     */
    const albumQuery =
      (query ?? album.title).trim();

    const searchTerm =
      `${album.artist} ${albumQuery}`.trim();

    setSelectedLpCoverAlbum(album);
    setLpCoverYear(
      album.year != null
        ? String(album.year)
        : ''
    );
    setLpCoverRating(
      album.rating != null
        ? formatRating(album.rating)
        : ''
    );
    setLpCoverSearchQuery(albumQuery);
    setLpCoverSearchResults([]);
    setLpCoverMessage('');

    if (!album.artist.trim()) {
      setLpCoverMessage(
        'Artiste introuvable pour cet album.'
      );
      return;
    }

    try {
      setLpCoverSearchLoading(true);

      const rawResults =
        await fetchItunesAlbums(
          `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=album&country=FR&limit=100`
        );

      const seenCollections =
        new Set<number>();

      const results =
        rawResults.filter(
          (candidate) => {
            if (
              !itunesArtistMatches(
                album.artist,
                candidate.artistName
              )
            ) {
              return false;
            }

            const artwork =
              upscaleItunesArtwork(
                candidate.artworkUrl100
              );

            if (
              !artwork ||
              seenCollections.has(
                candidate.collectionId
              )
            ) {
              return false;
            }

            seenCollections.add(
              candidate.collectionId
            );
            return true;
          }
        );

      setLpCoverSearchResults(results);

      if (results.length === 0) {
        setLpCoverMessage(
          `Aucun album de ${album.artist} trouvé pour cette recherche.`
        );
      }
    } catch (error) {
      console.error(error);
      setLpCoverMessage(
        'Impossible de rechercher les pochettes iTunes.'
      );
    } finally {
      setLpCoverSearchLoading(false);
    }
  }


  function openLpCoverPicker(
    album: SavedAlbum
  ) {
    void runLpCoverSearch(
      album,
      album.title
    );
  }


  function handleLpCurrentCoverClick() {
    if (!selectedLpCoverAlbum) {
      return;
    }

    if (lpCoverClickTimerRef.current !== null) {
      window.clearTimeout(lpCoverClickTimerRef.current);
    }

    lpCoverClickTimerRef.current = window.setTimeout(() => {
      lpCoverClickTimerRef.current = null;

      if (!selectedLpCoverAlbum) {
        return;
      }

      void runLpCoverSearch(
        selectedLpCoverAlbum,
        selectedLpCoverAlbum.title
      );
    }, 230);
  }


  function handleLpCurrentCoverDoubleClick() {
    if (lpCoverClickTimerRef.current !== null) {
      window.clearTimeout(lpCoverClickTimerRef.current);
      lpCoverClickTimerRef.current = null;
    }

    if (!uploadingLpCover) {
      lpCoverUploadInputRef.current?.click();
    }
  }


  async function chooseLpCover(
    candidate: ItunesAlbum
  ) {
    if (!user || !selectedLpCoverAlbum) {
      return;
    }

    const artwork =
      upscaleItunesArtwork(
        candidate.artworkUrl100
      );

    if (!artwork) {
      setLpCoverMessage(
        'Cette pochette est indisponible.'
      );
      return;
    }

    try {
      setSavingLpCover(
        candidate.collectionId
      );
      setLpCoverMessage('');

      const historyBefore =
        snapshotAlbumIds([
          selectedLpCoverAlbum.docId,
        ]);

      const albumRef =
        doc(
          db,
          'users',
          user.uid,
          'albums',
          selectedLpCoverAlbum.docId
        );

      await setDoc(
        albumRef,
        {
          /*
           * Choisir un résultat iTunes ne change pas seulement l'image :
           * le résultat devient l'identité de référence de l'album LP.
           * La position et la note restent volontairement intactes.
           */
          title:
            candidate.collectionName,
          artist:
            candidate.artistName,
          year:
            candidate.releaseDate
              ? candidate.releaseDate.substring(0, 4)
              : null,
          genre:
            candidate.primaryGenreName || null,
          artworkUrl: artwork,
          itunesCollectionId:
            candidate.collectionId,
          lpArtworkSource: 'itunes',
          lpArtworkCollectionId:
            candidate.collectionId,
          lpArtworkUpdatedAt:
            serverTimestamp(),
          lpMetadataUpdatedAt:
            serverTimestamp(),
        },
        { merge: true }
      );

      addHistoryEntry(
        `Pochette LP modifiée : ${selectedLpCoverAlbum.title}`,
        historyBefore
      );

      closeLpCoverPicker();
    } catch (error) {
      console.error(error);
      setLpCoverMessage(
        "Impossible d'enregistrer cette pochette."
      );
    } finally {
      setSavingLpCover(null);
    }
  }


  async function saveSelectedLpYear() {
    if (!user || !selectedLpCoverAlbum) {
      return;
    }

    const cleanYear =
      lpCoverYear.trim();

    if (
      cleanYear &&
      !/^\d{4}$/.test(cleanYear)
    ) {
      setLpCoverMessage(
        'L’année doit contenir 4 chiffres.'
      );
      return;
    }

    try {
      setSavingLpYear(true);
      setLpCoverMessage('');

      const historyBefore =
        snapshotAlbumIds([
          selectedLpCoverAlbum.docId,
        ]);

      const albumRef =
        doc(
          db,
          'users',
          user.uid,
          'albums',
          selectedLpCoverAlbum.docId
        );

      await setDoc(
        albumRef,
        {
          year: cleanYear || null,
          yearUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setSelectedLpCoverAlbum({
        ...selectedLpCoverAlbum,
        year: cleanYear || null,
      });

      addHistoryEntry(
        `Année LP modifiée : ${selectedLpCoverAlbum.title}`,
        historyBefore
      );

      setLpCoverMessage(
        'Année sauvegardée.'
      );
    } catch (error) {
      console.error(error);
      setLpCoverMessage(
        'Impossible de sauvegarder l’année.'
      );
    } finally {
      setSavingLpYear(false);
    }
  }


  async function saveSelectedLpRating() {
    if (!user || !selectedLpCoverAlbum) {
      return;
    }

    const normalizedRating =
      normalizeMovieMenuRating(
        lpCoverRating
      );

    if (normalizedRating === undefined) {
      setLpCoverMessage(
        'La note doit être comprise entre 0,00 et 5,00.'
      );
      return;
    }

    try {
      setSavingLpRating(true);
      setLpCoverMessage('');

      const historyBefore =
        snapshotAlbumIds([
          selectedLpCoverAlbum.docId,
        ]);

      const albumRef =
        doc(
          db,
          'users',
          user.uid,
          'albums',
          selectedLpCoverAlbum.docId
        );

      await setDoc(
        albumRef,
        {
          rating: normalizedRating,
          ratingUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setSelectedLpCoverAlbum({
        ...selectedLpCoverAlbum,
        rating: normalizedRating,
      });
      setLpCoverRating(
        normalizedRating != null
          ? formatRating(normalizedRating)
          : ''
      );
      addHistoryEntry(
        `Note LP modifiée : ${selectedLpCoverAlbum.title}`,
        historyBefore
      );

      setLpCoverMessage(
        'Note sauvegardée.'
      );
    } catch (error) {
      console.error(error);
      setLpCoverMessage(
        'Impossible de sauvegarder la note.'
      );
    } finally {
      setSavingLpRating(false);
    }
  }


  async function deleteSelectedLpAlbum() {
    if (!user || !selectedLpCoverAlbum) {
      return;
    }

    const confirmed =
      window.confirm(
        `Supprimer « ${selectedLpCoverAlbum.title} » de LP ?\n\nLa suppression est définitive pour cet album dans la rubrique LP.`
      );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingLpAlbum(true);
      setLpCoverMessage('');

      const historyBefore =
        snapshotAlbumIds([
          selectedLpCoverAlbum.docId,
        ]);

      const albumRef =
        doc(
          db,
          'users',
          user.uid,
          'albums',
          selectedLpCoverAlbum.docId
        );

      await deleteDoc(albumRef);

      addHistoryEntry(
        `Suppression album LP : ${selectedLpCoverAlbum.title}`,
        historyBefore
      );

      closeLpCoverPicker();
    } catch (error) {
      console.error(error);
      setLpCoverMessage(
        "Impossible de supprimer cet album."
      );
    } finally {
      setDeletingLpAlbum(false);
    }
  }


  async function uploadLpCover(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file || !user || !selectedLpCoverAlbum) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setLpCoverMessage(
        'Choisis un fichier image.'
      );
      event.target.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setLpCoverMessage(
        "L'image doit faire moins de 10 Mo."
      );
      event.target.value = '';
      return;
    }

    const cloudName =
      import.meta.env
        .VITE_CLOUDINARY_CLOUD_NAME;

    const uploadPreset =
      import.meta.env
        .VITE_CLOUDINARY_UPLOAD_PRESET;

    const cloudinaryApiKey =
      import.meta.env
        .VITE_CLOUDINARY_API_KEY;

    if (!cloudName || !uploadPreset || !cloudinaryApiKey) {
      setLpCoverMessage(
        'Cloudinary n’est pas encore complètement configuré dans le fichier .env.'
      );
      event.target.value = '';
      return;
    }

    try {
      setUploadingLpCover(true);
      setLpCoverMessage(
        'Envoi de la pochette...'
      );

      const formData =
        new FormData();

      formData.append('file', file);
      formData.append(
        'upload_preset',
        uploadPreset
      );
      formData.append(
        'api_key',
        cloudinaryApiKey
      );
      formData.append(
        'context',
        `user_id=${user.uid}|lp=${selectedLpCoverAlbum.docId}`
      );

      const response =
        await fetch(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(
            cloudName
          )}/image/upload`,
          {
            method: 'POST',
            body: formData,
          }
        );

      if (!response.ok) {
        const errorText =
          await response.text();
        throw new Error(
          `Cloudinary ${response.status}: ${errorText}`
        );
      }

      const result =
        await response.json() as {
          secure_url?: string;
        };

      if (!result.secure_url) {
        throw new Error(
          'Cloudinary n’a pas renvoyé d’URL sécurisée.'
        );
      }

      const historyBefore =
        snapshotAlbumIds([
          selectedLpCoverAlbum.docId,
        ]);

      const albumRef =
        doc(
          db,
          'users',
          user.uid,
          'albums',
          selectedLpCoverAlbum.docId
        );

      await setDoc(
        albumRef,
        {
          artworkUrl:
            result.secure_url,
          lpArtworkSource:
            'upload',
          lpArtworkUpdatedAt:
            serverTimestamp(),
        },
        { merge: true }
      );

      addHistoryEntry(
        `Pochette LP uploadée : ${selectedLpCoverAlbum.title}`,
        historyBefore
      );

      closeLpCoverPicker();
    } catch (error) {
      console.error(error);
      setLpCoverMessage(
        "Impossible d'envoyer cette pochette."
      );
    } finally {
      setUploadingLpCover(false);
      event.target.value = '';
    }
  }


  async function findItunesAlbumForLpImport(
    title: string,
    artist: string
  ) {
    try {
      const results =
        await fetchItunesAlbums(
          `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=album&country=FR&limit=12`
        );

      if (results.length === 0) {
        return null;
      }

      const wantedTitle =
        normalizeTitle(title);
      const wantedArtist =
        normalizeTitle(artist);

      const scored =
        results
          .map((candidate) => {
            const candidateTitle =
              normalizeTitle(
                candidate.collectionName
              );
            const candidateArtist =
              normalizeTitle(
                candidate.artistName
              );

            let score = 0;

            if (candidateTitle === wantedTitle) {
              score += 8;
            } else if (
              candidateTitle.includes(wantedTitle) ||
              wantedTitle.includes(candidateTitle)
            ) {
              score += 5;
            }

            if (candidateArtist === wantedArtist) {
              score += 5;
            } else if (
              candidateArtist.includes(wantedArtist) ||
              wantedArtist.includes(candidateArtist)
            ) {
              score += 2;
            }

            return {
              candidate,
              score,
            };
          })
          .sort(
            (a, b) =>
              b.score - a.score
          );

      return scored[0]?.score >= 7
        ? scored[0].candidate
        : null;
    } catch (error) {
      console.error(error);
      return null;
    }
  }


  async function importLpCsv(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file || !user) {
      return;
    }

    try {
      setLpCsvImporting(true);
      setLpCsvImportProgress(
        'Lecture du CSV LP...'
      );

      const content =
        (await file.text())
          .replace(/^\uFEFF/, '')
          .replace(/\r/g, '');

      const lines =
        content
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

      if (lines.length < 2) {
        throw new Error(
          'CSV LP vide ou invalide.'
        );
      }

      const delimiter =
        detectDelimiter(lines[0]);
      const headers =
        parseCsvLine(
          lines[0],
          delimiter
        ).map(normalizeHeader);

      const findColumn =
        (aliases: string[]) =>
          headers.findIndex(
            (header) =>
              aliases.includes(header)
          );

      const positionIndex =
        findColumn([
          'position',
          'rank',
          'rang',
        ]);
      const sourcePositionIndex =
        findColumn([
          'sourceposition',
          'positionorigine',
          'originalposition',
        ]);
      const titleIndex =
        findColumn([
          'album',
          'title',
          'titre',
        ]);
      const artistIndex =
        findColumn([
          'artist',
          'artiste',
        ]);

      if (
        titleIndex < 0 ||
        artistIndex < 0
      ) {
        throw new Error(
          'Colonnes album / artist introuvables.'
        );
      }

      const rows =
        lines
          .slice(1)
          .map((line, index) => {
            const cells =
              parseCsvLine(
                line,
                delimiter
              );

            const title =
              cells[titleIndex]?.trim() || '';
            const artist =
              cells[artistIndex]?.trim() || '';
            const rawPosition =
              positionIndex >= 0
                ? Number(cells[positionIndex])
                : index + 1;
            const rawSourcePosition =
              sourcePositionIndex >= 0
                ? Number(cells[sourcePositionIndex])
                : rawPosition;

            return {
              title,
              artist,
              position:
                Number.isFinite(rawPosition)
                  ? rawPosition
                  : index + 1,
              sourcePosition:
                Number.isFinite(rawSourcePosition)
                  ? rawSourcePosition
                  : null,
            };
          })
          .filter(
            (row) =>
              row.title &&
              row.artist
          );

      if (rows.length === 0) {
        throw new Error(
          'Aucun album valide dans le CSV.'
        );
      }

      const historyBefore =
        snapshotFullHistory([
          'albums',
        ]);

      let enriched = 0;

      for (
        let index = 0;
        index < rows.length;
        index++
      ) {
        const row = rows[index];
        const existing =
          savedAlbums.find(
            (album) =>
              lpAlbumIdentityKey(
                album.title,
                album.artist
              ) ===
              lpAlbumIdentityKey(
                row.title,
                row.artist
              )
          );

        const match =
          await findItunesAlbumForLpImport(
            row.title,
            row.artist
          );

        if (match) {
          enriched++;
        }

        const documentId =
          existing?.docId ||
          (match
            ? `lp_${match.collectionId}`
            : `lp_${hashString(
                `${row.title}|${row.artist}`
              )}`);

        const albumRef =
          doc(
            db,
            'users',
            user.uid,
            'albums',
            documentId
          );

        const hasManualLpMetadata =
          Boolean(
            existing?.lpMetadataUpdatedAt
          );
        const hasManualLpArtwork =
          Boolean(
            existing?.lpArtworkUpdatedAt ||
            existing?.lpArtworkSource
          );
        const hasManualLpYear =
          Boolean(
            existing?.yearUpdatedAt ||
            existing?.lpMetadataUpdatedAt
          );

        const payload: Record<string, unknown> = {
          title:
            existing && hasManualLpMetadata
              ? existing.title
              : row.title,
          artist:
            existing && hasManualLpMetadata
              ? existing.artist
              : row.artist,
          position: row.position,
          sourcePosition:
            row.sourcePosition,
          importedFromLpCsv: true,
          lpImportedAt:
            serverTimestamp(),
        };

        if (!existing) {
          payload.addedAt =
            serverTimestamp();
        }

        if (match) {
          if (!existing || !hasManualLpMetadata) {
            payload.itunesCollectionId =
              match.collectionId;
            payload.genre =
              match.primaryGenreName || null;
          }

          if (!existing || !hasManualLpArtwork) {
            payload.artworkUrl =
              upscaleItunesArtwork(
                match.artworkUrl100
              ) || null;
          }

          if (!existing || !hasManualLpYear) {
            payload.year =
              match.releaseDate
                ? match.releaseDate.substring(0, 4)
                : null;
          }
        }

        await setDoc(
          albumRef,
          payload,
          { merge: true }
        );

        setLpCsvImportProgress(
          `${index + 1} / ${rows.length} albums importés · ${enriched} pochettes trouvées`
        );
      }

      setLpCsvImportProgress(
        `Import LP terminé : ${rows.length} albums · ${enriched} pochettes iTunes trouvées.`
      );

      addHistoryEntry(
        `Import LP : ${file.name}`,
        historyBefore,
        ['albums']
      );
    } catch (error) {
      console.error(error);
      setLpCsvImportProgress(
        "L'import LP a échoué. Vérifie le fichier CSV."
      );
    } finally {
      setLpCsvImporting(false);
      event.target.value = '';
    }
  }


  async function uploadCustomPoster(

    event:
      ChangeEvent<
        HTMLInputElement
      >
  ) {
    const file =
      event.target
        .files?.[0];

    if (
      !file ||
      !user ||
      !selectedMovieMenu
    ) {
      return;
    }

    if (
      !file.type.startsWith(
        'image/'
      )
    ) {
      setMovieMenuMessage(
        'Choisis un fichier image.'
      );

      event.target.value =
        '';

      return;
    }

    if (
      file.size >
      10 *
        1024 *
        1024
    ) {
      setMovieMenuMessage(
        "L'image doit faire moins de 10 Mo."
      );

      event.target.value =
        '';

      return;
    }

    const cloudName =
      import.meta.env
        .VITE_CLOUDINARY_CLOUD_NAME;

    const uploadPreset =
      import.meta.env
        .VITE_CLOUDINARY_UPLOAD_PRESET;

    const cloudinaryApiKey =
      import.meta.env
        .VITE_CLOUDINARY_API_KEY;

    if (
      !cloudName ||
      !uploadPreset ||
      !cloudinaryApiKey
    ) {
      setMovieMenuMessage(
        'Cloudinary n’est pas encore complètement configuré dans le fichier .env.'
      );

      event.target.value =
        '';

      return;
    }

    try {
      setUploadingPoster(
        true
      );

      setMovieMenuMessage(
        "Envoi de l'affiche..."
      );

      const identity =
        selectedMovieMenu.tmdbId
          ? `tmdb_${selectedMovieMenu.tmdbId}`
          : selectedMovieMenu.docId;

      const formData =
        new FormData();

      formData.append(
        'file',
        file
      );

      formData.append(
        'upload_preset',
        uploadPreset
      );

      formData.append(
        'api_key',
        cloudinaryApiKey
      );

      formData.append(
        'context',
        `user_id=${user.uid}|movie=${identity}`
      );

      const response =
        await fetch(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(
            cloudName
          )}/image/upload`,
          {
            method:
              'POST',
            body:
              formData,
          }
        );

      if (
        !response.ok
      ) {
        const errorText =
          await response
            .text();

        throw new Error(
          `Cloudinary ${response.status}: ${errorText}`
        );
      }

      const result =
        await response.json() as {
          secure_url?: string;
        };

      const downloadUrl =
        result.secure_url;

      if (
        !downloadUrl
      ) {
        throw new Error(
          'Cloudinary n’a pas renvoyé d’URL sécurisée.'
        );
      }

      if (
        page ===
        'soundtracks'
      ) {
        const carrier =
          getSoundtrackCarrier(
            selectedMovieMenu
          );

        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            carrier.docId
          );

        await setDoc(
          movieRef,
          {
            soundtrackIndependent:
              true,
            soundtrackCoverUrl:
              downloadUrl,
            soundtrackCoverPath:
              null,
            soundtrackCoverUpdatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );

        setSelectedMovieMenu({
          ...selectedMovieMenu,
          soundtrackIndependent:
            true,
          soundtrackCoverUrl:
            downloadUrl,
          soundtrackCoverPath:
            null,
        });

        setMovieMenuMessage(
          'Pochette CD personnelle enregistrée.'
        );
      } else {
        await updateMovieEverywhere(
          selectedMovieMenu,
          {
            customPosterUrl:
              downloadUrl,

            customPosterPath:
              null,

            customPosterLanguage:
              'upload',

            customPosterUpdatedAt:
              serverTimestamp(),
          }
        );

        setSelectedMovieMenu({
          ...selectedMovieMenu,
          customPosterUrl:
            downloadUrl,
          customPosterPath:
            null,
          customPosterLanguage:
            'upload',
        });

        setMovieMenuMessage(
          'Affiche personnelle enregistrée.'
        );
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMovieMenuMessage(
        "Impossible d'envoyer l'affiche sur Cloudinary. Vérifie le Cloud name, l'API Key et l'Upload preset."
      );
    } finally {
      setUploadingPoster(
        false
      );

      event.target.value =
        '';
    }
  }


  function sectionLabel(
    target:
      AddTarget
  ) {
    if (
      target ===
      'topUS'
    ) {
      return 'TOP US';
    }

    if (
      target ===
      'topFR'
    ) {
      return 'TOP FR';
    }

    if (
      target ===
      'soundtracks'
    ) {
      return 'Soundtracks';
    }

    if (
      target ===
      'ucpm'
    ) {
      return 'UCPM';
    }

    if (target === 'series') {
      return 'SÉRIE';
    }

    if (target === 'jellyfin') {
      return 'MOVIE DATABASE';
    }

    if (target === 'watchlist') {
      return 'À VOIR';
    }

    return 'VUS';
  }


  function movieIsInDiary(
    movie:
      SavedMovie
  ) {
    return getLinkedMovies(
      movie
    ).some(
      (linkedMovie) =>
        (linkedMovie.diary?.length || 0) > 0
    );
  }


  function movieIsInSection(
    movie:
      SavedMovie,

    target:
      Exclude<
        AddTarget,
        'diary'
      >
  ) {
    const linked =
      getLinkedMovies(
        movie
      );

    if (
      target ===
      'ucpm'
    ) {
      return linked.some(
        (
          linkedMovie
        ) =>
          Boolean(
            linkedMovie.ucpm
          )
      );
    }

    if (target === 'watchlist') {
      return linked.some(
        (linkedMovie) => Boolean(linkedMovie.watchlist)
      );
    }

    return linked.some(
      (
        linkedMovie
      ) =>
        Boolean(
          linkedMovie
            .rankings?.[
              target
            ]
        )
    );
  }


  function getNextSectionPosition(
    target:
      Exclude<
        AddTarget,
        'diary'
      >
  ) {
    const positions =
      savedMovies
        .map(
          (
            movie
          ) => {
            if (
              target ===
              'ucpm'
            ) {
              return movie.ucpmPosition;
            }

            return movie
              .rankings?.[
                target
              ]
              ?.position;
          }
        )
        .filter(
          (
            position
          ): position is number =>
            typeof position ===
              'number' &&
            Number.isFinite(
              position
            )
        );

    if (
      positions.length ===
      0
    ) {
      return 1;
    }

    return (
      Math.max(
        ...positions
      ) +
      1
    );
  }


  async function setMovieSectionPresence(
    movie:
      SavedMovie,

    target:
      Exclude<
        AddTarget,
        'diary'
      >,

    shouldBePresent:
      boolean
  ) {
    if (
      !user
    ) {
      return;
    }

    const linked =
      getLinkedMovies(
        movie
      );

    const canonical =
      getCanonicalMovie(
        movie
      );

    const historyBefore =
      snapshotMovieIds(
        new Set([
          ...linked.map(
            (linkedMovie) =>
              linkedMovie.docId
          ),
          canonical.docId,
        ])
      );

    if (
      !shouldBePresent
    ) {
      const batch =
        writeBatch(
          db
        );

      for (
        const linkedMovie
        of linked
      ) {
        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            linkedMovie.docId
          );

        if (target === 'watchlist') {
          if (linkedMovie.watchlist) {
            batch.set(
              movieRef,
              {
                watchlist: false,
                watchlistDate: null,
              },
              { merge: true }
            );
          }
        } else if (
          target ===
          'ucpm'
        ) {
          if (
            linkedMovie.ucpm
          ) {
            batch.set(
              movieRef,
              {
                ucpm:
                  false,
                ucpmPosition:
                  null,
              },
              {
                merge: true,
              }
            );
          }
        } else if (
          linkedMovie.rankings?.[
            target
          ]
        ) {
          /*
           * IMPORTANT : avec setDoc(..., { merge: true }), supprimer la clé
           * du nouvel objet `rankings` ne supprimait pas réellement le champ
           * déjà présent dans Firestore. Il faut utiliser deleteField() sur
           * le chemin imbriqué exact.
           */
          batch.update(
            movieRef,
            {
              [`rankings.${target}`]:
                deleteField(),
            }
          );
        }
      }

      await batch.commit();

      addHistoryEntry(
        `Retrait de ${sectionLabel(target)} : ${getMovieDisplayTitle(movie)}`,
        historyBefore
      );

      return;
    }

    const movieRef =
      doc(
        db,
        'users',
        user.uid,
        'movies',
        canonical.docId
      );

    if (target === 'watchlist') {
      await setDoc(
        movieRef,
        {
          watchlist: true,
          watchlistDate: new Date().toISOString(),
        },
        {
          merge: true,
        }
      );

      addHistoryEntry(
        `Ajout à ${sectionLabel(target)} : ${getMovieDisplayTitle(movie)}`,
        historyBefore
      );

      return;
    }

    if (
      target ===
      'ucpm'
    ) {
      await setDoc(
        movieRef,
        {
          ucpm:
            true,
          ucpmPosition:
            getNextSectionPosition(
              target
            ),
          ...getAutomaticUcpmVusPatch(canonical),
        },
        {
          merge: true,
        }
      );

      addHistoryEntry(
        `Ajout à ${sectionLabel(target)} : ${getMovieDisplayTitle(movie)}`,
        historyBefore
      );

      return;
    }

    const rankingEntry = {
      listName:
        sectionLabel(
          target
        ),
      position:
        getNextSectionPosition(
          target
        ),
    };

    const patch:
      Record<
        string,
        unknown
      > = {
      [`rankings.${target}`]:
        rankingEntry,
    };

    if (target === 'jellyfin') {
      patch.jellyfinAddedAt =
        serverTimestamp();

      if (page === 'jellyfin') {
        setSortMode('added-desc');
        jellyfinRecentSortAfterImportRef.current =
          false;
      } else {
        jellyfinRecentSortAfterImportRef.current =
          true;
      }
    }

    if (
      target ===
      'soundtracks'
    ) {
      patch.soundtrackIndependent =
        true;
      patch.soundtrackTitle =
        canonical.soundtrackTitle ||
        getMovieDisplayTitle(
          canonical
        );
      patch.soundtrackRating =
        canonical.soundtrackRating ??
        canonical.rating ??
        null;
      patch.soundtrackCoverUrl =
        canonical.soundtrackCoverUrl ??
        canonical.customPosterUrl ??
        null;
      patch.soundtrackCoverPath =
        canonical.soundtrackCoverPath ??
        canonical.customPosterPath ??
        canonical.posterPath ??
        null;
    }

    await updateDoc(
      movieRef,
      patch
    );

    addHistoryEntry(
      `Ajout à ${sectionLabel(target)} : ${getMovieDisplayTitle(movie)}`,
      historyBefore
    );
  }


  async function toggleMovieSection(
    movie:
      SavedMovie,

    target:
      Exclude<
        AddTarget,
        'diary'
      >
  ) {
    if (
      !user
    ) {
      return;
    }

    const isInSection =
      movieIsInSection(
        movie,
        target
      );

    try {
      setSavingMovieMenu(
        true
      );

      await setMovieSectionPresence(
        movie,
        target,
        !isInSection
      );

      setMovieMenuMessage(
        isInSection
          ? `Retiré de ${sectionLabel(target)}.`
          : `Ajouté à ${sectionLabel(target)}.`
      );

      if (!isInSection && target === 'jellyfin' && page === 'jellyfin') {
        setSortMode('added-desc');
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMovieMenuMessage(
        'Impossible de modifier cette liste.'
      );
    } finally {
      setSavingMovieMenu(
        false
      );
    }
  }




  function diaryEntrySignature(
    entry:
      DiaryEntry
  ) {
    return JSON.stringify({
      watchedDate:
        entry.watchedDate ||
        null,
      entryDate:
        entry.entryDate ||
        null,
      rating:
        entry.rating ??
        null,
      rewatch:
        Boolean(
          entry.rewatch
        ),
      letterboxdEntryUri:
        entry.letterboxdEntryUri ||
        null,
      /* Indispensable pour les doublons volontaires de VUS : deux
         visionnages manuels le même jour doivent rester deux entrées
         distinctes lors d'une modification de note ou d'une suppression. */
      insertedAt:
        entry.insertedAt ||
        null,
    });
  }


  function currentPageSupportsMovieReorder() {
    return (
      page === 'topUS' ||
      page === 'topFR' ||
      page === 'soundtracks' ||
      page === 'ucpm' ||
      page === 'series' ||
      page === 'jellyfin'
    );
  }


  function currentPageSupportsMobileMovieActions() {
    return (
      currentPageSupportsMovieReorder() ||
      page === 'diary' ||
      page === 'watchlist' ||
      page === 'unrated'
    );
  }


  useEffect(() => {
    setMultiSelectMode(false);
    setMultiSelectMovies([]);
    setMultiSelectSavingTarget(null);
  }, [page]);


  function isMultiSelectMovieSelected(
    movie: SavedMovie
  ) {
    const identity = movieNavigationIdentity(movie);

    return multiSelectMovies.some(
      (selectedMovie) =>
        movieNavigationIdentity(selectedMovie) === identity
    );
  }


  function toggleMultiSelectMovie(
    movie: SavedMovie
  ) {
    const identity = movieNavigationIdentity(movie);

    setMultiSelectMovies((current) => {
      const exists = current.some(
        (selectedMovie) =>
          movieNavigationIdentity(selectedMovie) === identity
      );

      if (exists) {
        return current.filter(
          (selectedMovie) =>
            movieNavigationIdentity(selectedMovie) !== identity
        );
      }

      return [...current, movie];
    });
  }


  function startMultiSelectFromMobileAction() {
    if (!mobileMovieAction) {
      return;
    }

    const firstMovie = mobileMovieAction.movie;
    setMultiSelectMovies([firstMovie]);
    setMultiSelectMode(true);
    setMobileMovieAction(null);
    setMessage(
      `Sélection multiple : 1 film sélectionné. Clique sur d’autres affiches puis choisis une liste.`
    );
  }


  function stopMultiSelectMode() {
    setMultiSelectMode(false);
    setMultiSelectMovies([]);
    setMultiSelectSavingTarget(null);
  }


  function isMovieInMultiSelectTarget(
    movie: SavedMovie,
    target: MultiSelectTarget
  ) {
    if (target === 'diary') {
      return movieIsInDiary(movie);
    }

    return movieIsInSection(movie, target);
  }


  function multiSelectTargetIsActive(
    target: MultiSelectTarget
  ) {
    return (
      multiSelectMovies.length > 0 &&
      multiSelectMovies.every((movie) =>
        isMovieInMultiSelectTarget(movie, target)
      )
    );
  }


  async function hideMovieFromUnratedQueue(
    movie: SavedMovie
  ) {
    if (!user) {
      return;
    }

    const linkedMovies = [
      ...getLinkedMovies(movie),
      getCanonicalMovie(movie),
    ];

    const uniqueDocIds = Array.from(
      new Set(
        linkedMovies
          .map((linkedMovie) => linkedMovie.docId)
          .filter(Boolean)
      )
    );

    for (let start = 0; start < uniqueDocIds.length; start += 400) {
      const batch = writeBatch(db);

      for (const docId of uniqueDocIds.slice(start, start + 400)) {
        batch.set(
          doc(
            db,
            'users',
            user.uid,
            'movies',
            docId
          ),
          { unratedHidden: true },
          { merge: true }
        );
      }

      await batch.commit();
    }
  }


  async function applyMultiSelectTarget(
    target: MultiSelectTarget
  ) {
    if (
      !user ||
      multiSelectMovies.length === 0 ||
      multiSelectSavingTarget
    ) {
      return;
    }

    const shouldBePresent =
      !multiSelectTargetIsActive(target);
    const movies = [...multiSelectMovies];

    try {
      setMultiSelectSavingTarget(target);

      for (const movie of movies) {
        const currentlyPresent =
          isMovieInMultiSelectTarget(movie, target);

        if (currentlyPresent !== shouldBePresent) {
          if (target === 'diary') {
            if (shouldBePresent) {
              await addDiaryEntryToMovie(movie);
            } else {
              await clearMovieDiary(movie);
            }
          } else {
            await setMovieSectionPresence(
              movie,
              target,
              shouldBePresent
            );
          }
        }

        /* Quand une sélection multiple est rangée dans une liste, elle ne
           doit plus rester dans « À NOTER », même si elle n'a pas encore
           reçu de note. Le marqueur est posé après l'action principale pour
           qu'un éventuel Annuler global puisse restaurer l'état précédent. */
        if (shouldBePresent) {
          await hideMovieFromUnratedQueue(movie);
        }

        if (currentlyPresent === shouldBePresent && !shouldBePresent) {
          continue;
        }

        /* Laisse le snapshot Firestore / React intégrer la position
           précédente avant d'ajouter le film suivant à une liste classée. */
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, 0)
        );
      }

      setMessage(
        `${movies.length} film${movies.length > 1 ? 's' : ''} ${
          shouldBePresent ? 'ajouté' : 'retiré'
        }${movies.length > 1 ? 's' : ''} ${
          shouldBePresent ? 'à' : 'de'
        } ${sectionLabel(target)}.${
          shouldBePresent && page === 'unrated'
            ? ` Retiré${movies.length > 1 ? 's' : ''} de À NOTER.`
            : ''
        }`
      );
    } catch (error) {
      console.error(error);
      setMessage('Impossible de modifier la sélection multiple.');
    } finally {
      setMultiSelectSavingTarget(null);
    }
  }


  function mobileMovieActionKey(
    movie:
      SavedMovie,
    diaryEntry:
      DiaryEntry | null
  ) {
    return diaryEntry
      ? `${movie.docId}:${diaryEntrySignature(diaryEntry)}`
      : `${movie.docId}:section`;
  }


  function clearMobileMovieHoldTimer() {
    if (
      mobileHoldTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        mobileHoldTimerRef.current
      );
      mobileHoldTimerRef.current =
        null;
    }

    mobileHoldStartRef.current =
      null;
  }


  function handleMobileMovieHoldStart(
    event:
      ReactPointerEvent<HTMLElement>,
    movie:
      SavedMovie,
    diaryEntry:
      DiaryEntry | null =
      null
  ) {
    if (
      reorderMode ||
      multiSelectMode ||
      !currentPageSupportsMobileMovieActions() ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }

    clearMobileMovieHoldTimer();

    mobileHoldStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };

    const heldRect =
      event.currentTarget.getBoundingClientRect();

    const anchorRect = {
      left: heldRect.left,
      right: heldRect.right,
      top: heldRect.top,
      bottom: heldRect.bottom,
    };

    const actionKey =
      mobileMovieActionKey(
        movie,
        diaryEntry
      );

    mobileHoldTimerRef.current =
      window.setTimeout(
        () => {
          suppressMobileMovieClickRef.current =
            actionKey;

          setMobileMovieAction({
            movie,
            diaryEntry,
            anchorRect,
          });

          mobileHoldTimerRef.current =
            null;
        },
        520
      );
  }


  function handleMobileMovieHoldMove(
    event:
      ReactPointerEvent<HTMLElement>
  ) {
    const start =
      mobileHoldStartRef.current;

    if (
      !start ||
      mobileHoldTimerRef.current ===
        null
    ) {
      return;
    }

    const distanceX =
      event.clientX -
      start.x;
    const distanceY =
      event.clientY -
      start.y;

    if (
      Math.hypot(
        distanceX,
        distanceY
      ) > 12
    ) {
      clearMobileMovieHoldTimer();
    }
  }


  function handleMobileMovieHoldEnd() {
    clearMobileMovieHoldTimer();
  }


  function consumeMobileMovieHoldClick(
    movie:
      SavedMovie,
    diaryEntry:
      DiaryEntry | null =
      null
  ) {
    const actionKey =
      mobileMovieActionKey(
        movie,
        diaryEntry
      );

    if (
      suppressMobileMovieClickRef.current !==
      actionKey
    ) {
      return false;
    }

    suppressMobileMovieClickRef.current =
      null;

    return true;
  }




  function getMobileMovieActionPositionStyle(): CSSProperties {
    const edge = 8;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const rect = mobileMovieAction?.anchorRect;
    const wantedWidth = Math.min(256, viewportWidth - edge * 2);
    const menuHeight = Math.min(518, Math.max(1, viewportHeight - edge * 2));

    if (!rect) {
      return {
        left: Math.max(edge, (viewportWidth - wantedWidth) / 2),
        top: Math.max(edge, (viewportHeight - menuHeight) / 2),
        '--movie-menu-width': `${wantedWidth}px`,
        '--movie-menu-height': `${menuHeight}px`,
      } as CSSProperties;
    }

    /* Menu vertical à côté de l'affiche lorsque c'est possible.
       S'il ne tient pas à côté, il se superpose à la grille sans
       sortir du viewport, y compris sur les petits téléphones. */
    const rightSpace = Math.max(0, viewportWidth - edge - rect.right);
    const leftSpace = Math.max(0, rect.left - edge);
    const left = rightSpace >= wantedWidth
      ? rect.right
      : leftSpace >= wantedWidth
        ? rect.left - wantedWidth
        : Math.max(edge, Math.min(rect.left, viewportWidth - wantedWidth - edge));
    const top = Math.max(edge, Math.min(rect.top, viewportHeight - menuHeight - edge));

    return {
      left,
      top,
      '--movie-menu-width': `${wantedWidth}px`,
      '--movie-menu-height': `${menuHeight}px`,
    } as CSSProperties;
  }


  async function toggleMobileMovieMembership(
    target: 'topUS' | 'topFR' | 'diary' | 'watchlist' | 'jellyfin'
  ) {
    if (!user || !mobileMovieAction || mobileMovieActionSaving) {
      return;
    }

    const movie = mobileMovieAction.movie;

    try {
      setMobileMovieActionSaving(true);

      if (target === 'diary') {
        const active = movieIsInDiary(movie);

        if (active) {
          await clearMovieDiary(movie);
          setMessage(`« ${getMovieDisplayTitle(movie)} » retiré de VUS.`);
        } else {
          const added = await addDiaryEntryToMovie(movie);
          setMessage(
            added
              ? `« ${getMovieDisplayTitle(movie)} » ajouté à VUS.`
              : `« ${getMovieDisplayTitle(movie)} » est déjà dans VUS aujourd’hui.`
          );
        }

        return;
      }

      const active = movieIsInSection(movie, target);
      await setMovieSectionPresence(movie, target, !active);
      setMessage(
        active
          ? `« ${getMovieDisplayTitle(movie)} » retiré de ${sectionLabel(target)}.`
          : `« ${getMovieDisplayTitle(movie)} » ajouté à ${sectionLabel(target)}.`
      );
    } catch (error) {
      console.error(error);
      setMessage('Impossible de modifier cette liste.');
    } finally {
      setMobileMovieActionSaving(false);
    }
  }


  function renderMobileMovieActionRating() {
    if (!mobileMovieAction) {
      return null;
    }

    const { movie, diaryEntry } =
      mobileMovieAction;

    if (
      page === 'diary' &&
      diaryEntry
    ) {
      return renderQuickRatingControl({
        ratingKey:
          quickRatingKeyForDiary(
            movie,
            diaryEntry
          ),
        currentRating:
          getDiaryPriorityRating(
            movie,
            diaryEntry
          ),
        ariaLabel:
          `Noter ${getMovieDisplayTitle(movie)}`,
        onSave: () =>
          saveQuickDiaryRating(
            movie,
            diaryEntry
          ),
      });
    }

    if (
      page === 'topUS' ||
      page === 'topFR' ||
      page === 'soundtracks' ||
      page === 'ucpm' ||
      page === 'series' ||
      page === 'jellyfin' ||
      page === 'watchlist'
    ) {
      const target =
        page as Exclude<
          AddTarget,
          'diary'
        >;

      return renderQuickRatingControl({
        ratingKey:
          quickRatingKeyForList(
            movie,
            target
          ),
        currentRating:
          getQuickListRating(
            movie,
            target
          ),
        ariaLabel:
          `Noter ${
            page === 'soundtracks'
              ? getSoundtrackDisplayTitle(movie)
              : getMovieDisplayTitle(movie)
          }`,
        onSave: () =>
          saveQuickListRating(
            movie,
            target
          ),
      });
    }

    return null;
  }


  // Conservé pour le panneau de notation mobile.
  void renderMobileMovieActionRating;

  async function removeMobileMovieFromCurrentSection() {
    if (
      !user ||
      !mobileMovieAction
    ) {
      return;
    }

    const {
      movie,
      diaryEntry,
    } =
      mobileMovieAction;

    const label =
      page === 'diary'
        ? 'VUS'
        : page === 'topUS'
        ? 'TOP US'
        : page === 'topFR'
        ? 'TOP FR'
        : page === 'soundtracks'
        ? 'B.O'
        : page === 'ucpm'
        ? 'UCPM'
        : page === 'jellyfin'
        ? 'MOVIE DATABASE'
        : page === 'watchlist'
        ? 'À VOIR'
        : 'SÉRIE';

    const confirmed =
      window.confirm(
        page === 'diary'
          ? 'Supprimer ce visionnage de VUS ?\n\nLe film restera dans ses autres listes.'
          : `Retirer ce film de ${label} ?\n\nLe film restera dans ses autres listes.`
      );

    if (
      !confirmed
    ) {
      return;
    }

    try {
      setMobileMovieActionSaving(
        true
      );

      if (
        page === 'diary' &&
        diaryEntry
      ) {
        const signature =
          diaryEntrySignature(
            diaryEntry
          );

        const linked =
          getLinkedMovies(
            movie
          );

        const carrier =
          linked.find(
            (linkedMovie) =>
              (linkedMovie.diary || []).some(
                (entry) =>
                  diaryEntrySignature(entry) ===
                  signature
              )
          );

        if (
          !carrier
        ) {
          throw new Error(
            'Visionnage introuvable.'
          );
        }

        const diary =
          carrier.diary ||
          [];

        const entryIndex =
          diary.findIndex(
            (entry) =>
              diaryEntrySignature(entry) ===
              signature
          );

        if (
          entryIndex < 0
        ) {
          throw new Error(
            'Visionnage introuvable.'
          );
        }

        const nextDiary =
          diary.filter(
            (
              _entry,
              index
            ) =>
              index !==
              entryIndex
          );

        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            carrier.docId
          );

        const historyBefore =
          snapshotMovieIds([
            carrier.docId,
          ]);

        await setDoc(
          movieRef,
          {
            diary:
              nextDiary,
            watched:
              nextDiary.length >
              0,
          },
          {
            merge: true,
          }
        );

        addHistoryEntry(
          `Suppression visionnage VUS : ${getMovieDisplayTitle(movie)}`,
          historyBefore
        );
      } else if (page === 'watchlist') {
        await setMovieSectionPresence(
          movie,
          'watchlist',
          false
        );
      } else if (
        currentPageSupportsMovieReorder()
      ) {
        const target =
          page as
            Exclude<
              AddTarget,
              'diary'
            >;

        await setMovieSectionPresence(
          movie,
          target,
          false
        );
      }

      setMobileMovieAction(
        null
      );

      setMessage(
        page === 'diary'
          ? 'Visionnage retiré de VUS.'
          : `Film retiré de ${label}.`
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        'Impossible de supprimer cet élément de cette partie.'
      );
    } finally {
      setMobileMovieActionSaving(
        false
      );
    }
  }


  async function removeMovieFromMovieDatabase(
    movie: SavedMovie
  ) {
    if (!user) {
      return;
    }

    const title =
      getMovieDisplayTitle(
        movie
      );

    const confirmed =
      window.confirm(
        `Supprimer « ${title} » de Movie Database ?\n\nLe film restera dans US, FR, UCPM, VUS ou B.O. s'il y est présent.`
      );

    if (!confirmed) {
      return;
    }

    try {
      setPosterEraseMovieId(
        movie.docId
      );

      await setMovieSectionPresence(
        movie,
        'jellyfin',
        false
      );

      setMessage(
        `« ${title} » a été retiré de Movie Database.`
      );
    } catch (
      error
    ) {
      console.error(
        error
      );
      setMessage(
        "Impossible de retirer ce film de Movie Database."
      );
    } finally {
      setPosterEraseMovieId(
        null
      );
    }
  }


  async function removeMovieFromWatchlist(
    movie: SavedMovie
  ) {
    if (!user) {
      return;
    }

    const title = getMovieDisplayTitle(movie);

    const confirmed = window.confirm(
      `Retirer « ${title} » de À VOIR ?\n\nLe film restera dans ses autres listes.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setPosterEraseMovieId(movie.docId);
      await setMovieSectionPresence(
        movie,
        'watchlist',
        false
      );
      setMessage(`« ${title} » a été retiré de À VOIR.`);
    } catch (error) {
      console.error(error);
      setMessage("Impossible de retirer ce film de À VOIR.");
    } finally {
      setPosterEraseMovieId(null);
    }
  }


  async function eraseMovieFromPoster(
    movie: SavedMovie
  ) {
    if (!user) {
      return;
    }

    const linked = getLinkedMovies(movie);
    const historyBefore =
      snapshotMovieIds(
        linked.map(
          (linkedMovie) =>
            linkedMovie.docId
        )
      );
    const title =
      page === 'soundtracks'
        ? getSoundtrackDisplayTitle(movie)
        : getMovieDisplayTitle(movie);

    const confirmed = window.confirm(
      `Effacer définitivement « ${title} » ?\n\nLe film sera supprimé de toutes les listes où cette même fiche est présente.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setPosterEraseMovieId(movie.docId);

      for (let start = 0; start < linked.length; start += 400) {
        const batch = writeBatch(db);

        for (const linkedMovie of linked.slice(start, start + 400)) {
          batch.delete(
            doc(
              db,
              'users',
              user.uid,
              'movies',
              linkedMovie.docId
            )
          );
        }

        await batch.commit();
      }

      addHistoryEntry(
        `Suppression film : ${title}`,
        historyBefore
      );

      setMessage(`« ${title} » a été effacé.`);
    } catch (error) {
      console.error(error);
      setMessage("Impossible d'effacer définitivement ce film.");
    } finally {
      setPosterEraseMovieId(null);
    }
  }


  async function eraseAlbumFromPoster(
    album: SavedAlbum
  ) {
    if (!user) {
      return;
    }

    const historyBefore =
      snapshotAlbumIds([
        album.docId,
      ]);

    const confirmed = window.confirm(
      `Effacer définitivement « ${album.title} » de LP ?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setPosterEraseAlbumId(album.docId);

      await deleteDoc(
        doc(
          db,
          'users',
          user.uid,
          'albums',
          album.docId
        )
      );

      addHistoryEntry(
        `Suppression album : ${album.title}`,
        historyBefore
      );

      setMessage(`« ${album.title} » a été effacé de LP.`);
    } catch (error) {
      console.error(error);
      setMessage("Impossible d'effacer cet album.");
    } finally {
      setPosterEraseAlbumId(null);
    }
  }


  async function eraseSelectedMovieEverywhere() {
    if (!selectedMovieMenu || !user) {
      return;
    }

    const linked = getLinkedMovies(selectedMovieMenu);
    const historyBefore =
      snapshotMovieIds(
        linked.map(
          (linkedMovie) =>
            linkedMovie.docId
        )
      );
    const title = getMovieDisplayTitle(selectedMovieMenu);

    const confirmed = window.confirm(
      `Effacer définitivement « ${title} » ?\n\nLe film sera supprimé de toutes les listes où cette même fiche est présente.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setSavingMovieMenu(true);

      for (let start = 0; start < linked.length; start += 400) {
        const batch = writeBatch(db);

        for (const linkedMovie of linked.slice(start, start + 400)) {
          batch.delete(
            doc(
              db,
              'users',
              user.uid,
              'movies',
              linkedMovie.docId
            )
          );
        }

        await batch.commit();
      }

      addHistoryEntry(
        `Suppression film : ${title}`,
        historyBefore
      );

      closeMovieMenu();
      setMessage(`« ${title} » a été effacé.`);
    } catch (error) {
      console.error(error);
      setMovieMenuMessage("Impossible d'effacer définitivement ce film.");
    } finally {
      setSavingMovieMenu(false);
    }
  }


  async function addDiaryEntryToMovie(

    movie:
      SavedMovie,

    watchedDate =
      new Date()
        .toISOString()
        .slice(
          0,
          10
        ),

    options?: {
      allowSameDateDuplicate?: boolean;
    }
  ): Promise<boolean> {
    if (
      !user
    ) {
      return false;
    }

    const linked =
      getLinkedMovies(
        movie
      );

    const diaryCarrier =
      [
        ...linked,
      ].sort(
        (
          a,
          b
        ) =>
          (
            b.diary
              ?.length ||
            0
          ) -
          (
            a.diary
              ?.length ||
            0
          )
      )[0] ||
      getCanonicalMovie(
        movie
      );

    const existingDiary =
      diaryCarrier.diary ||
      [];

    /* Par défaut, un double clic le même jour reste bloqué.
       L'action « Revu » est l'exception volontaire : VUS est la seule
       page qui autorise plusieurs visionnages du même film, y compris
       à la même date. */
    const allowSameDateDuplicate =
      Boolean(options?.allowSameDateDuplicate);

    const alreadyAddedForDate =
      existingDiary.some(
        (existingEntry) =>
          (
            existingEntry.watchedDate ||
            existingEntry.entryDate ||
            ''
          ) === watchedDate
      );

    const additionKey =
      allowSameDateDuplicate
        ? `review:${diaryCarrier.docId}`
        : `${diaryCarrier.docId}:${watchedDate}`;

    if (
      (!allowSameDateDuplicate && alreadyAddedForDate) ||
      diaryAddLockRef.current.has(
        additionKey
      )
    ) {
      return false;
    }

    diaryAddLockRef.current.add(
      additionKey
    );

    const entry:
      DiaryEntry = {
      watchedDate,
      entryDate:
        watchedDate,
      rating:
        getDiaryPriorityRating(movie, {}) ??
        null,
      rewatch:
        existingDiary.length >
        0,
      tags: [],
      letterboxdEntryUri:
        null,
      insertedAt:
        new Date().toISOString(),
      source:
        'manual',
    };

    const movieRef =
      doc(
        db,
        'users',
        user.uid,
        'movies',
        diaryCarrier.docId
      );

    const historyBefore =
      snapshotMovieIds([
        diaryCarrier.docId,
      ]);

    let saved =
      false;

    try {
      await setDoc(
        movieRef,
        {
          diary: [
            ...existingDiary,
            entry,
          ],

          watched:
            true,
        },
        {
          merge: true,
        }
      );

      saved =
        true;

      addHistoryEntry(
        `Ajout VUS : ${getMovieDisplayTitle(movie)}`,
        historyBefore
      );

      /* Un ajout manuel doit devenir visible immédiatement, même si
         l'utilisateur consultait une autre année de VUS. */
      focusDiaryYearForDate(
        watchedDate
      );

      return true;
    } finally {
      if (
        saved
      ) {
        window.setTimeout(
          () => {
            diaryAddLockRef.current.delete(
              additionKey
            );
          },
          1800
        );
      } else {
        diaryAddLockRef.current.delete(
          additionKey
        );
      }
    }
  }


  async function markMovieAsReviewed(
    movie: SavedMovie
  ) {
    if (!user || reviewSavingMovieId) {
      return;
    }

    setReviewSavingMovieId(movie.docId);

    try {
      const watchedDate = new Date().toISOString().slice(0, 10);
      const added = await addDiaryEntryToMovie(
        movie,
        watchedDate,
        { allowSameDateDuplicate: true }
      );

      setMessage(
        added
          ? `Revu ajouté à VUS : ${getMovieDisplayTitle(movie)}`
          : `Ajout déjà en cours pour ${getMovieDisplayTitle(movie)}.`
      );
    } catch (error) {
      console.error(error);
      setMessage(
        `Impossible d'ajouter « ${getMovieDisplayTitle(movie)} » à VUS.`
      );
    } finally {
      setReviewSavingMovieId(null);
    }
  }


  async function clearMovieDiary(
    movie:
      SavedMovie
  ) {
    if (
      !user
    ) {
      return;
    }

    const linked =
      getLinkedMovies(
        movie
      );

    const historyBefore =
      snapshotMovieIds(
        linked
          .filter(
            (linkedMovie) =>
              (linkedMovie.diary?.length || 0) > 0
          )
          .map(
            (linkedMovie) => linkedMovie.docId
          )
      );

    const batch =
      writeBatch(
        db
      );

    let changed =
      false;

    for (
      const linkedMovie
      of linked
    ) {
      if (
        (linkedMovie.diary?.length || 0) === 0
      ) {
        continue;
      }

      changed =
        true;

      const movieRef =
        doc(
          db,
          'users',
          user.uid,
          'movies',
          linkedMovie.docId
        );

      batch.set(
        movieRef,
        {
          diary: [],
          watched: false,
          ucpmAutoVus: deleteField(),
          ucpmAutoVusDate: deleteField(),
        },
        {
          merge: true,
        }
      );
    }

    if (
      changed
    ) {
      await batch.commit();

      addHistoryEntry(
        `Retrait VUS : ${getMovieDisplayTitle(movie)}`,
        historyBefore
      );
    }
  }


  async function toggleCurrentMovieDiary() {
    if (
      !selectedMovieMenu ||
      !user
    ) {
      return;
    }

    const isInDiary =
      movieIsInDiary(
        selectedMovieMenu
      );

    try {
      setSavingMovieMenu(
        true
      );

      if (
        isInDiary
      ) {
        await clearMovieDiary(
          selectedMovieMenu
        );

        setSelectedDiaryEntry(
          null
        );

        setMovieMenuMessage(
          'Retiré de VUS.'
        );
      } else {
        const added =
          await addDiaryEntryToMovie(
            selectedMovieMenu
          );

        setMovieMenuMessage(
          added
            ? 'Ajouté à VUS.'
            : 'Ce film est déjà ajouté à VUS pour cette date.'
        );
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMovieMenuMessage(
        isInDiary
          ? 'Impossible de retirer ce film de VUS.'
          : "Impossible d'ajouter ce film à VUS."
      );
    } finally {
      setSavingMovieMenu(
        false
      );
    }
  }


  function openUcpmComposer() {
    setEditingUcpmSixFilmsGroup(null);
    setUcpmComposerOpen(true);
    /* Le bouton + d'UCPM sert d'abord à créer un bloc 6 films. */
    setUcpmComposerMode('sixfilms');
    setUcpmComposerSixFilmsNumber(getNextUcpmSixFilmsNumber());
    setUcpmComposerItems([]);
    setUcpmComposerQuery('');
    setUcpmComposerResults([]);
    setUcpmComposerLocalResults([]);
    setUcpmComposerMessage('');
  }


  function closeUcpmComposer() {
    if (ucpmComposerSaving) {
      return;
    }

    setUcpmComposerOpen(false);
    setEditingUcpmSixFilmsGroup(null);
    setUcpmComposerItems([]);
    setUcpmComposerQuery('');
    setUcpmComposerResults([]);
    setUcpmComposerLocalResults([]);
    setUcpmComposerMessage('');
  }


  function savedMovieToUcpmComposerItem(
    movie: SavedMovie,
    fallbackIndex: number
  ): UcpmComposerItem {
    const numericTmdbId = Number(movie.tmdbId ?? 0);
    let syntheticId = 0;

    for (let index = 0; index < movie.docId.length; index += 1) {
      syntheticId = (syntheticId * 31 + movie.docId.charCodeAt(index)) >>> 0;
    }

    const itemId =
      Number.isFinite(numericTmdbId) && numericTmdbId > 0
        ? numericTmdbId
        : -Math.max(1, syntheticId || fallbackIndex + 1);

    return {
      savedDocId: movie.docId,
      rating:
        movie.rating != null && Number.isFinite(Number(movie.rating))
          ? formatRating(Number(movie.rating))
          : '',
      movie: {
        id: itemId,
        title: getMovieDisplayTitle(movie),
        original_title: movie.originalTitle || movie.title || '',
        release_date:
          movie.releaseDate ||
          (movie.year ? `${String(movie.year)}-01-01` : ''),
        poster_path: movie.customPosterPath || movie.posterPath || null,
        poster_url: movie.customPosterUrl || null,
        backdrop_path: movie.backdropPath || null,
        overview: movie.overview || '',
      },
    };
  }


  function openEditUcpmSixFilmsGroup(
    group: { number: number; movies: SavedMovie[]; groupId?: string | null }
  ) {
    const groupIdFromMembership =
      group.groupId ||
      group.movies
        .flatMap((movie) => getUcpmSixFilmsMemberships(movie))
        .find((membership) => membership.number === group.number)?.groupId ||
      null;

    const orderedMovies = group.movies
      .slice()
      .sort((a, b) => {
        const membershipA = getUcpmSixFilmsMemberships(a).find(
          (membership) =>
            membership.number === group.number &&
            (!groupIdFromMembership || membership.groupId === groupIdFromMembership)
        );
        const membershipB = getUcpmSixFilmsMemberships(b).find(
          (membership) =>
            membership.number === group.number &&
            (!groupIdFromMembership || membership.groupId === groupIdFromMembership)
        );
        const orderA =
          membershipA?.itemOrder ??
          (typeof a.ucpmGroupItemOrder === 'number'
            ? a.ucpmGroupItemOrder
            : Number(a.ucpmPosition ?? 9999));
        const orderB =
          membershipB?.itemOrder ??
          (typeof b.ucpmGroupItemOrder === 'number'
            ? b.ucpmGroupItemOrder
            : Number(b.ucpmPosition ?? 9999));
        return orderA - orderB;
      })
      .slice(0, 6);

    if (orderedMovies.length === 0) {
      return;
    }

    const firstMovie = orderedMovies[0];
    const firstMembership = getUcpmSixFilmsMemberships(firstMovie).find(
      (membership) =>
        membership.number === group.number &&
        (!groupIdFromMembership || membership.groupId === groupIdFromMembership)
    );
    const currentGroup = getUcpmPodcastGroup(firstMovie);
    const isStoredSixFilmsGroup =
      firstMovie.ucpmGroupType === 'sixfilms' &&
      Boolean(firstMovie.ucpmGroupId);
    const positions = orderedMovies
      .map((movie) => Number(movie.ucpmPosition ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    const historicalStart =
      group.number >= 1 && group.number <= 4
        ? UCPM_LEGACY_SIX_FILMS_START +
          (group.number - 1) * UCPM_LEGACY_SIX_FILMS_SIZE
        : null;

    setEditingUcpmSixFilmsGroup({
      number: group.number,
      groupId:
        groupIdFromMembership ||
        (isStoredSixFilmsGroup
          ? firstMovie.ucpmGroupId || null
          : `sixfilms_edit_${group.number}_${Date.now()}`),
      groupOrder:
        typeof firstMembership?.groupOrder === 'number'
          ? firstMembership.groupOrder
          : isStoredSixFilmsGroup && typeof firstMovie.ucpmGroupOrder === 'number'
            ? firstMovie.ucpmGroupOrder
            : currentGroup?.kind === 'sixfilms'
              ? currentGroup.order
              : 60 + group.number - 1,
      startPosition:
        isStoredSixFilmsGroup && positions.length > 0
          ? Math.min(...positions)
          : historicalStart ??
            (positions.length > 0
              ? Math.min(...positions)
              : getNextSectionPosition('ucpm')),
      originalDocIds: orderedMovies.map((movie) => movie.docId),
    });

    setUcpmComposerOpen(true);
    setUcpmComposerMode('sixfilms');
    setUcpmComposerSixFilmsNumber(group.number);
    setUcpmComposerItems(
      orderedMovies.map((movie, index) =>
        savedMovieToUcpmComposerItem(movie, index)
      )
    );
    setUcpmComposerQuery('');
    setUcpmComposerResults([]);
    setUcpmComposerLocalResults([]);
    setUcpmComposerMessage('');
  }


  async function searchUcpmComposerMovies(
    event: FormEvent
  ) {
    event.preventDefault();

    const rawQuery = ucpmComposerQuery.trim();

    if (!rawQuery) {
      return;
    }

    const normalizedQuery = normalizeTitle(rawQuery);
    const imdbQuery = extractImdbId(rawQuery)?.toLowerCase() || null;
    const localMatches = savedMovies
      .filter((movie) => {
        if (
          movie.tmdbMediaType === 'tv' ||
          Boolean(movie.rankings?.series)
        ) {
          return false;
        }

        if (imdbQuery) {
          return (
            String(movie.imdbId || '').toLowerCase() === imdbQuery ||
            String(movie.ucpmImdbId || '').toLowerCase() === imdbQuery
          );
        }

        const titles = [
          movie.customTitle,
          movie.localizedTitle,
          movie.title,
          movie.originalTitle,
          movie.tmdbTitle,
        ]
          .filter(Boolean)
          .map((value) => normalizeTitle(String(value || '')))
          .filter(Boolean);

        return titles.some(
          (title) =>
            title === normalizedQuery ||
            title.startsWith(normalizedQuery) ||
            title.includes(normalizedQuery)
        );
      })
      .sort((a, b) => {
        const aTitle = normalizeTitle(getMovieDisplayTitle(a));
        const bTitle = normalizeTitle(getMovieDisplayTitle(b));
        const aStarts = aTitle.startsWith(normalizedQuery) ? 0 : 1;
        const bStarts = bTitle.startsWith(normalizedQuery) ? 0 : 1;
        if (aStarts !== bStarts) {
          return aStarts - bStarts;
        }
        return aTitle.localeCompare(bTitle, 'fr');
      })
      .slice(0, 18);

    setUcpmComposerLocalResults(localMatches);

    if (!apiKey) {
      setUcpmComposerResults([]);
      setUcpmComposerMessage(
        localMatches.length > 0
          ? ''
          : 'Aucun film trouvé dans la base.'
      );
      return;
    }

    try {
      setUcpmComposerSearching(true);
      setUcpmComposerMessage('');

      const imdbId = extractImdbId(rawQuery);
      let results: TmdbMovie[] = [];

      if (imdbId) {
        const response = await fetch(
          `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&language=fr-FR&external_source=imdb_id`
        );

        if (!response.ok) {
          throw new Error('Erreur TMDb');
        }

        const data = await response.json();
        results = (data.movie_results || []).map((item: any) => ({
          id: item.id,
          title: item.title || '',
          original_title: item.original_title || '',
          release_date: item.release_date || '',
          poster_path: item.poster_path || null,
          backdrop_path: item.backdrop_path || null,
          overview: item.overview || '',
        }));
      } else {
        const response = await fetch(
          `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&language=fr-FR&include_adult=false&query=${encodeURIComponent(rawQuery)}`
        );

        if (!response.ok) {
          throw new Error('Erreur TMDb');
        }

        const data = await response.json();
        results = (data.results || []).map((item: any) => ({
          id: item.id,
          title: item.title || '',
          original_title: item.original_title || '',
          release_date: item.release_date || '',
          poster_path: item.poster_path || null,
          backdrop_path: item.backdrop_path || null,
          overview: item.overview || '',
        }));
      }

      const localTmdbIds = new Set(
        localMatches
          .map((movie) => Number(movie.tmdbId ?? 0))
          .filter((id) => Number.isFinite(id) && id > 0)
      );
      const localDocIds = new Set(
        localMatches.map((movie) => movie.docId)
      );

      const filteredResults = results
        .filter((movie) => {
          if (localTmdbIds.has(movie.id)) {
            return false;
          }

          const existing = findExistingMovieForTmdb(movie, 'movie');
          return !existing || !localDocIds.has(existing.docId);
        })
        .slice(0, 20);

      setUcpmComposerResults(filteredResults);

      if (localMatches.length === 0 && filteredResults.length === 0) {
        setUcpmComposerMessage('Aucun film trouvé.');
      }
    } catch (error) {
      console.error(error);
      setUcpmComposerResults([]);
      setUcpmComposerMessage(
        localMatches.length > 0
          ? 'Films de la base trouvés. Recherche TMDb indisponible.'
          : 'Impossible de rechercher ce film.'
      );
    } finally {
      setUcpmComposerSearching(false);
    }
  }


  function addSavedMovieToUcpmComposer(movie: SavedMovie) {
    if (ucpmComposerIsFull()) {
      setUcpmComposerMessage('Ce 6 films contient déjà 6 films.');
      return;
    }

    const tmdbId = Number(movie.tmdbId ?? 0);
    const alreadyInBlock = ucpmComposerItems.some(
      (item) =>
        item.savedDocId === movie.docId ||
        (Number.isFinite(tmdbId) && tmdbId > 0 && item.movie.id === tmdbId)
    );

    if (alreadyInBlock) {
      setUcpmComposerMessage('Ce film est déjà dans ce 6 films.');
      return;
    }

    setUcpmComposerItems((current) => [
      ...current,
      savedMovieToUcpmComposerItem(movie, current.length),
    ]);
    setUcpmComposerMessage('');
  }


  function addMovieToUcpmComposer(movie: TmdbMovie) {
    const existing = findExistingMovieForTmdb(movie, 'movie');

    /* Un film déjà présent dans Movie Database / UCPM doit pouvoir être
       réutilisé dans un bloc « 6 films » sans créer de doublon. */
    if (existing) {
      addSavedMovieToUcpmComposer(existing);
      return;
    }

    if (ucpmComposerIsFull()) {
      setUcpmComposerMessage('Ce 6 films contient déjà 6 films.');
      return;
    }

    const alreadyInBlock = ucpmComposerItems.some(
      (item) => item.movie.id === movie.id
    );

    if (alreadyInBlock) {
      setUcpmComposerMessage('Ce film est déjà dans ce 6 films.');
      return;
    }

    setUcpmComposerItems((current) => [
      ...current,
      {
        movie,
        savedDocId: null,
        rating: '',
      },
    ]);
    setUcpmComposerMessage('');
  }


  function updateUcpmComposerRating(
    movieId: number,
    value: string
  ) {
    const nextValue = sanitizeRatingDraft(value);

    setUcpmComposerItems((current) =>
      current.map((item) =>
        item.movie.id === movieId
          ? { ...item, rating: nextValue }
          : item
      )
    );
  }


  function removeMovieFromUcpmComposer(movieId: number) {
    setUcpmComposerItems((current) =>
      current.filter((item) => item.movie.id !== movieId)
    );
    setUcpmComposerMessage('');
  }


  async function ensureSavedMovieForUcpmComposer(
    movie: TmdbMovie
  ): Promise<SavedMovie> {
    if (!user) {
      throw new Error('Utilisateur non connecté.');
    }

    let existing = findExistingMovieForTmdb(movie, 'movie');

    if (!existing) {
      const preferredPoster = await getPreferredPosterPath(
        movie.id,
        movie.poster_path,
        'movie'
      );
      const preferredTitle = await getPreferredFrenchTitle(
        movie.id,
        movie.title,
        'movie'
      );
      const documentId = `tmdb_${movie.id}`;
      const movieRef = doc(
        db,
        'users',
        user.uid,
        'movies',
        documentId
      );

      const newMovie: SavedMovie = {
        docId: documentId,
        tmdbId: movie.id,
        tmdbMediaType: 'movie',
        title: movie.title,
        localizedTitle: preferredTitle,
        tmdbTitle: movie.title,
        originalTitle: movie.original_title || null,
        releaseDate: movie.release_date || null,
        year: movie.release_date
          ? movie.release_date.substring(0, 4)
          : null,
        posterPath: preferredPoster,
        backdropPath: movie.backdrop_path || null,
        overview: movie.overview || '',
        rating: null,
        review: '',
        favorite: false,
        liked: false,
        watched: false,
        watchlist: false,
        rankings: {},
        diary: [],
        tmdbMatchStatus: 'matched',
      };

      const { docId: _docId, ...newMovieData } = newMovie;
      void _docId;

      await setDoc(
        movieRef,
        {
          ...newMovieData,
          addedAt: serverTimestamp(),
        },
        { merge: true }
      );

      existing = newMovie;
    } else if (!existing.tmdbId) {
      const preferredPoster = await getPreferredPosterPath(
        movie.id,
        movie.poster_path,
        'movie'
      );
      const preferredTitle = await getPreferredFrenchTitle(
        movie.id,
        movie.title,
        'movie'
      );
      const movieRef = doc(
        db,
        'users',
        user.uid,
        'movies',
        existing.docId
      );
      const tmdbPatch = {
        tmdbId: movie.id,
        tmdbMediaType: 'movie' as const,
        tmdbTitle: movie.title,
        localizedTitle: preferredTitle,
        originalTitle: movie.original_title || null,
        releaseDate: movie.release_date || null,
        year: movie.release_date
          ? movie.release_date.substring(0, 4)
          : existing.year || null,
        posterPath: preferredPoster,
        backdropPath: movie.backdrop_path || null,
        overview: movie.overview || '',
        tmdbMatchStatus: 'matched' as const,
        tmdbMatchedAt: serverTimestamp(),
      };

      await setDoc(movieRef, tmdbPatch, { merge: true });
      existing = { ...existing, ...tmdbPatch };
    } else if (
      !existing.customPosterUrl &&
      !existing.customPosterPath &&
      !existing.posterPath
    ) {
      const preferredPoster = await getPreferredPosterPath(
        movie.id,
        movie.poster_path,
        'movie'
      );

      if (preferredPoster) {
        const movieRef = doc(
          db,
          'users',
          user.uid,
          'movies',
          existing.docId
        );

        const posterPatch = {
          posterPath: preferredPoster,
          tmdbMatchStatus: 'matched' as const,
          tmdbMatchedAt: serverTimestamp(),
        };

        await setDoc(movieRef, posterPatch, { merge: true });
        existing = { ...existing, ...posterPatch };
      }
    }

    return existing;
  }


  function getNextUcpmCustomGroupOrder() {
    const customOrders = savedMovies
      .map((movie) => movie.ucpmGroupOrder)
      .filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value)
      );

    const legacyMax = UCPM_PODCAST_GROUPS.reduce(
      (max, group) => Math.max(max, group.order),
      0
    );

    return Math.max(legacyMax, ...customOrders, 59) + 1;
  }


  function getUsedUcpmSixFilmsNumbers(
    excludedGroupId?: string | null,
    excludedLegacyDocIds: string[] = []
  ) {
    const used = new Set<number>();
    const excludedDocs = new Set(excludedLegacyDocIds);

    for (const movie of savedMovies) {
      for (const membership of getUcpmSixFilmsMemberships(movie)) {
        if (excludedGroupId && membership.groupId === excludedGroupId) {
          continue;
        }

        if (membership.number >= 1 && membership.number <= 10) {
          used.add(membership.number);
        }
      }

      if (movie.ucpmSixFilmsHidden === true || excludedDocs.has(movie.docId)) {
        continue;
      }

      const group = getUcpmPodcastGroup(movie);
      if (!group || group.kind !== 'sixfilms') {
        continue;
      }

      const explicitMatch = group.label.match(
        /^6\s*films\s*#?\s*(\d+)\b/i
      );
      const explicitNumber = explicitMatch
        ? Number(explicitMatch[1])
        : 0;

      if (
        Number.isFinite(explicitNumber) &&
        explicitNumber >= 1 &&
        explicitNumber <= 10
      ) {
        used.add(explicitNumber);
      }
    }

    return used;
  }


  function getNextUcpmSixFilmsNumber() {
    const used = getUsedUcpmSixFilmsNumbers();

    for (let number = 1; number <= 10; number += 1) {
      if (!used.has(number)) {
        return number;
      }
    }

    return 10;
  }


  function getNextUcpmPodcastMeta() {
    const customPodcastGroups = new Map<string, UcpmPodcastGroup>();

    for (const movie of savedMovies) {
      const group = getUcpmPodcastGroup(movie);

      if (!group || group.kind !== 'podcast') {
        continue;
      }

      const key = getUcpmPodcastGroupKey(group);
      if (!customPodcastGroups.has(key)) {
        customPodcastGroups.set(key, group);
      }
    }

    const orderedCustomGroups = [...customPodcastGroups.values()].sort(
      (a, b) => a.order - b.order
    );
    const orderedLegacyGroups = UCPM_PODCAST_GROUPS
      .slice()
      .sort((a, b) => a.order - b.order);
    const lastLegacyGroup =
      orderedLegacyGroups.length > 0
        ? orderedLegacyGroups[orderedLegacyGroups.length - 1]
        : null;
    let lastYear = Number(getUcpmPodcastYearLabel(lastLegacyGroup));

    if (!Number.isFinite(lastYear)) {
      lastYear = new Date().getFullYear() - 1;
    }

    const lastCustomGroup =
      orderedCustomGroups.length > 0
        ? orderedCustomGroups[orderedCustomGroups.length - 1]
        : null;
    if (lastCustomGroup) {
      const parsedYear = Number(getUcpmPodcastYearLabel(lastCustomGroup));
      if (Number.isFinite(parsedYear)) {
        lastYear = parsedYear;
      } else {
        lastYear += orderedCustomGroups.length;
      }
    }

    return {
      number: getLastLegacyUcpmPodcastNumber() + orderedCustomGroups.length + 1,
      year: Math.round(lastYear) + 1,
    };
  }


  function ucpmComposerIsFull() {
    const isSixFilms = Boolean(editingUcpmSixFilmsGroup) || ucpmComposerMode === 'sixfilms';
    return isSixFilms && ucpmComposerItems.length >= 6;
  }


  function getAutomaticUcpmVusPatch(
    movie: SavedMovie,
    ratingOverride?: number | null
  ): Record<string, unknown> {
    /* Tout film ajouté à UCPM / Podcast / 6 films doit aussi apparaître
       automatiquement dans VUS. On ne crée jamais un second visionnage
       si ce film (ou un doublon lié) possède déjà une entrée VUS. */
    if (movieIsInDiary(movie)) {
      return {};
    }

    const watchedDate = new Date().toISOString().slice(0, 10);
    const existingDiary = movie.diary || [];
    const entry: DiaryEntry = {
      watchedDate,
      entryDate: watchedDate,
      rating:
        ratingOverride ??
        getDiaryPriorityRating(movie, {}) ??
        null,
      rewatch: existingDiary.length > 0,
      tags: [],
      letterboxdEntryUri: null,
      insertedAt: new Date().toISOString(),
      source: 'manual',
    };

    return {
      diary: [...existingDiary, entry],
      watched: true,
      ucpmAutoVus: true,
      ucpmAutoVusDate: watchedDate,
    };
  }


  function movieHasUseOutsideSixFilms(movie: SavedMovie) {
    const primaryGroup = getUcpmPodcastGroup(movie);
    const hasIndependentUcpm = Boolean(
      movie.ucpm &&
      (primaryGroup
        ? primaryGroup.kind !== 'sixfilms'
        : movie.ucpmSixFilmsOnly !== true)
    );

    const automaticVusDate =
      movie.ucpmAutoVus === true
        ? String(movie.ucpmAutoVusDate || '')
        : '';
    const hasIndependentDiary = (movie.diary || []).some((entry) => {
      const entryDate = entry.watchedDate || entry.entryDate || '';
      return !(automaticVusDate && entryDate === automaticVusDate);
    });
    const hasIndependentWatched = Boolean(
      movie.watched && movie.ucpmAutoVus !== true
    );

    return Boolean(
      Object.values(movie.rankings || {}).some(Boolean) ||
      hasIndependentDiary ||
      movie.favorite ||
      movie.liked ||
      hasIndependentWatched ||
      movie.watchlist ||
      movie.favoriteProfileFilm ||
      hasIndependentUcpm
    );
  }


  async function saveUcpmSixFilmsComposer(
    normalizedRatings: Array<number | null | undefined>
  ) {
    if (!user) {
      return;
    }

    const editingGroup = editingUcpmSixFilmsGroup;
    const number = Math.max(
      1,
      Math.min(10, Math.round(Number(ucpmComposerSixFilmsNumber) || 1))
    );
    const usedNumbers = getUsedUcpmSixFilmsNumbers(
      editingGroup?.groupId || null,
      editingGroup?.originalDocIds || []
    );

    if (
      usedNumbers.has(number) &&
      (!editingGroup || number !== editingGroup.number)
    ) {
      const nextFree = Array.from({ length: 10 }, (_, index) => index + 1).find(
        (candidate) => !usedNumbers.has(candidate)
      );
      setUcpmComposerMessage(
        nextFree
          ? `6 films #${number} existe déjà. Choisis un numéro libre, par exemple #${nextFree}.`
          : `Les numéros #1 à #10 sont déjà utilisés. Supprime ou modifie un 6 films existant.`
      );
      return;
    }

    const groupLabel = `6 films #${number}`;
    const groupId =
      editingGroup?.groupId ||
      `sixfilms_${number}_${Date.now()}`;
    const groupOrder =
      editingGroup?.groupOrder ??
      60 + number - 1;

    const historyDocumentIds = Array.from(
      new Set([
        ...(editingGroup?.originalDocIds ?? []),
        ...ucpmComposerItems.map((item) => {
          if (item.savedDocId) {
            return item.savedDocId;
          }

          const existing = findExistingMovieForTmdb(item.movie, 'movie');
          return existing?.docId || `tmdb_${item.movie.id}`;
        }),
      ])
    );
    const historyBefore = snapshotMovieIds(historyDocumentIds);

    try {
      setUcpmComposerSaving(true);
      setUcpmComposerMessage(
        editingGroup
          ? `Enregistrement de ${groupLabel}…`
          : `Création de ${groupLabel}…`
      );

      const resolved: Array<{
        item: UcpmComposerItem;
        movie: SavedMovie;
        createdForSixFilms: boolean;
      }> = [];

      for (const item of ucpmComposerItems) {
        const existingByDocId = item.savedDocId
          ? savedMovies.find((movie) => movie.docId === item.savedDocId) || null
          : null;
        const existingBefore =
          existingByDocId ||
          findExistingMovieForTmdb(item.movie, 'movie');
        const savedMovie =
          existingBefore ||
          await ensureSavedMovieForUcpmComposer(item.movie);

        resolved.push({
          item,
          movie: savedMovie,
          createdForSixFilms: !existingBefore,
        });
      }

      const batch = writeBatch(db);
      const selectedDocIds = new Set(
        resolved.map((entry) => entry.movie.docId)
      );

      /* Les films retirés pendant une édition quittent uniquement ce bloc.
         On ne les supprime pas de Movie Database ici : la suppression complète
         d'un bloc applique la règle de provenance demandée par l'utilisateur. */
      if (editingGroup) {
        for (const oldDocId of editingGroup.originalDocIds) {
          if (selectedDocIds.has(oldDocId)) {
            continue;
          }

          const oldMovie = savedMovies.find((movie) => movie.docId === oldDocId);
          if (!oldMovie) {
            continue;
          }

          const oldRef = doc(db, 'users', user.uid, 'movies', oldDocId);
          const oldMemberships = getUcpmSixFilmsMemberships(oldMovie);
          const nextMemberships = oldMemberships.filter(
            (membership) => membership.groupId !== groupId
          );
          const oldPrimaryGroup = getUcpmPodcastGroup(oldMovie);
          const oldPrimaryNumberMatch = oldPrimaryGroup?.label.match(
            /^6\s*films\s*#?\s*(\d+)\b/i
          );
          const oldPrimaryNumber = oldPrimaryNumberMatch
            ? Number(oldPrimaryNumberMatch[1])
            : null;
          const removesLegacyPrimary =
            oldPrimaryGroup?.kind === 'sixfilms' &&
            oldPrimaryNumber === editingGroup.number;
          const patch: Record<string, unknown> = {};

          patch.ucpmSixFilmsMemberships =
            nextMemberships.length > 0
              ? nextMemberships
              : deleteField();

          if (removesLegacyPrimary) {
            patch.ucpmPosition = deleteField();
            patch.ucpmGroupId = deleteField();
            patch.ucpmGroupLabel = deleteField();
            patch.ucpmGroupOrder = deleteField();
            patch.ucpmGroupExpectedCount = deleteField();
            patch.ucpmGroupType = deleteField();
            patch.ucpmGroupItemOrder = deleteField();
            patch.ucpmSixFilmsHidden = true;
          }

          if (
            nextMemberships.length === 0 &&
            (oldMovie.ucpmSixFilmsOnly === true || removesLegacyPrimary)
          ) {
            patch.ucpm = false;
            patch.ucpmSixFilmsOnly = deleteField();
          }

          batch.set(oldRef, patch, { merge: true });
        }
      }

      for (let index = 0; index < resolved.length; index += 1) {
        const { movie: savedMovie, createdForSixFilms } = resolved[index];
        const movieRef = doc(
          db,
          'users',
          user.uid,
          'movies',
          savedMovie.docId
        );
        const oldMemberships = getUcpmSixFilmsMemberships(savedMovie);
        const nextMemberships = oldMemberships.filter(
          (membership) => membership.groupId !== groupId
        );
        nextMemberships.push({
          groupId,
          number,
          itemOrder: index + 1,
          groupOrder,
        });

        const primaryGroup = getUcpmPodcastGroup(savedMovie);
        const primaryNumberMatch = primaryGroup?.label.match(
          /^6\s*films\s*#?\s*(\d+)\b/i
        );
        const primaryNumber = primaryNumberMatch
          ? Number(primaryNumberMatch[1])
          : null;
        const migratesEditedPrimary = Boolean(
          editingGroup &&
          editingGroup.originalDocIds.includes(savedMovie.docId) &&
          primaryGroup?.kind === 'sixfilms' &&
          primaryNumber === editingGroup.number
        );
        const hasIndependentUcpm = Boolean(
          savedMovie.ucpm &&
          (primaryGroup
            ? primaryGroup.kind !== 'sixfilms'
            : savedMovie.ucpmSixFilmsOnly !== true)
        );
        const patch: Record<string, unknown> = {
          ucpm: true,
          ucpmSixFilmsMemberships: nextMemberships,
        };

        if (hasIndependentUcpm) {
          patch.ucpmSixFilmsOnly = deleteField();
        } else {
          patch.ucpmSixFilmsOnly = true;
        }

        if (createdForSixFilms) {
          patch.ucpmSixFilmsCreatedOnly = true;
        }

        /* Migration des anciens blocs : leur appartenance principale est
           convertie en appartenance secondaire pour qu'un même film puisse
           aussi rester / revenir dans un podcast UCPM. */
        if (migratesEditedPrimary) {
          patch.ucpmPosition = deleteField();
          patch.ucpmGroupId = deleteField();
          patch.ucpmGroupLabel = deleteField();
          patch.ucpmGroupOrder = deleteField();
          patch.ucpmGroupExpectedCount = deleteField();
          patch.ucpmGroupType = deleteField();
          patch.ucpmGroupItemOrder = deleteField();
        }

        const normalizedRating = normalizedRatings[index];
        if (normalizedRating !== null && normalizedRating !== undefined) {
          patch.rating = normalizedRating;
          patch.ratingUpdatedAt = serverTimestamp();
        }

        const newlyAddedToThisSixFilms =
          !editingGroup ||
          !editingGroup.originalDocIds.includes(savedMovie.docId);
        if (newlyAddedToThisSixFilms) {
          Object.assign(
            patch,
            getAutomaticUcpmVusPatch(
              savedMovie,
              normalizedRating ?? null
            )
          );
        }

        batch.set(movieRef, patch, { merge: true });
      }

      await batch.commit();

      addHistoryEntry(
        `${editingGroup ? 'Modification' : 'Création'} UCPM : ${groupLabel}`,
        historyBefore
      );

      setUcpmComposerMessage(
        editingGroup
          ? `${groupLabel} mis à jour.`
          : `${groupLabel} créé avec 6 films.`
      );
      setUcpmComposerItems([]);
      setUcpmComposerQuery('');
      setUcpmComposerResults([]);
      setUcpmComposerLocalResults([]);

      window.setTimeout(() => {
        setUcpmComposerOpen(false);
        setEditingUcpmSixFilmsGroup(null);
        setUcpmComposerMessage('');
      }, 550);
    } catch (error) {
      console.error(error);
      setUcpmComposerMessage(
        editingGroup
          ? 'Impossible de modifier ce 6 films UCPM.'
          : 'Impossible de créer ce 6 films UCPM.'
      );
    } finally {
      setUcpmComposerSaving(false);
    }
  }


  async function saveUcpmComposer() {
    if (!user) {
      return;
    }

    const editingGroup = editingUcpmSixFilmsGroup;
    const isSixFilms = Boolean(editingGroup) || ucpmComposerMode === 'sixfilms';
    const nextPodcast = getNextUcpmPodcastMeta();
    const year = String(nextPodcast.year);
    const targetCount = isSixFilms ? 6 : ucpmComposerItems.length;

    if (isSixFilms) {
      const selectedNumber = Number(ucpmComposerSixFilmsNumber);
      if (!Number.isFinite(selectedNumber) || selectedNumber < 1 || selectedNumber > 10) {
        setUcpmComposerMessage('Aucun numéro de 6 films libre n’est disponible.');
        return;
      }

      if (ucpmComposerItems.length !== 6) {
        setUcpmComposerMessage(
          `Ajoute exactement 6 films avant ${editingGroup ? 'd’enregistrer' : 'de créer le 6 films'}.`
        );
        return;
      }
    } else if (ucpmComposerItems.length === 0) {
      setUcpmComposerMessage('Ajoute au moins un film avant de créer le podcast.');
      return;
    }

    const normalizedRatings = ucpmComposerItems.map((item) => {
      if (!item.rating.trim()) {
        return null;
      }

      return normalizeMovieMenuRating(item.rating);
    });

    if (normalizedRatings.some((rating) => rating === undefined)) {
      setUcpmComposerMessage('Une note est invalide. Utilise une valeur de 0,00 à 5,00.');
      return;
    }

    if (isSixFilms) {
      await saveUcpmSixFilmsComposer(normalizedRatings);
      return;
    }

    try {
      setUcpmComposerSaving(true);
      setUcpmComposerMessage(
        editingGroup
          ? 'Enregistrement des modifications…'
          : ucpmComposerMode === 'podcast'
            ? `Création du podcast #${nextPodcast.number}…`
            : 'Création du 6 films…'
      );

      /* Le mode « 6 films » a déjà été traité juste au-dessus et retourne.
         À partir d'ici, on enregistre donc nécessairement un podcast. */
      const groupLabel = `#${year}`;
      const groupId = editingGroup?.groupId || `${ucpmComposerMode}_${Date.now()}`;
      const groupOrder = editingGroup?.groupOrder ?? getNextUcpmCustomGroupOrder();
      const startPosition =
        editingGroup?.startPosition ?? getNextSectionPosition('ucpm');

      /* L'historique doit être pris AVANT ensureSavedMovieForUcpmComposer(). */
      const historyDocumentIds = Array.from(
        new Set([
          ...(editingGroup?.originalDocIds ?? []),
          ...ucpmComposerItems.map((item) => {
            if (item.savedDocId) {
              return item.savedDocId;
            }

            const existing = findExistingMovieForTmdb(item.movie, 'movie');
            return existing?.docId || `tmdb_${item.movie.id}`;
          }),
        ])
      );

      const historyBefore = snapshotMovieIds(historyDocumentIds);
      const resolvedMovies: SavedMovie[] = [];

      for (const item of ucpmComposerItems) {
        if (item.savedDocId) {
          const existingByDocId = savedMovies.find(
            (movie) => movie.docId === item.savedDocId
          );

          if (existingByDocId) {
            resolvedMovies.push(existingByDocId);
            continue;
          }
        }

        resolvedMovies.push(
          await ensureSavedMovieForUcpmComposer(item.movie)
        );
      }

      const batch = writeBatch(db);
      const selectedDocIds = new Set(
        resolvedMovies.map((movie) => movie.docId)
      );

      /* En édition, les films retirés sortent du bloc mais restent dans la
         Movie Database. Le marqueur hidden évite qu'un ancien fallback #1-#4
         les réinjecte automatiquement. */
      if (editingGroup) {
        for (const oldDocId of editingGroup.originalDocIds) {
          if (selectedDocIds.has(oldDocId)) {
            continue;
          }

          const oldMovie = savedMovies.find((movie) => movie.docId === oldDocId);
          if (!oldMovie) {
            continue;
          }

          const oldRef = doc(db, 'users', user.uid, 'movies', oldDocId);
          const oldPatch: Record<string, unknown> = {
            ucpmSixFilmsHidden: true,
          };
          const oldGroup = getUcpmPodcastGroup(oldMovie);

          if (oldGroup?.kind === 'sixfilms') {
            oldPatch.ucpm = false;
            oldPatch.ucpmPosition = deleteField();
            oldPatch.ucpmGroupId = deleteField();
            oldPatch.ucpmGroupLabel = deleteField();
            oldPatch.ucpmGroupOrder = deleteField();
            oldPatch.ucpmGroupExpectedCount = deleteField();
            oldPatch.ucpmGroupType = deleteField();
            oldPatch.ucpmGroupItemOrder = deleteField();
          }

          batch.set(oldRef, oldPatch, { merge: true });
        }
      }

      for (let index = 0; index < resolvedMovies.length; index += 1) {
        const savedMovie = resolvedMovies[index];
        const movieRef = doc(
          db,
          'users',
          user.uid,
          'movies',
          savedMovie.docId
        );
        const normalizedRating = normalizedRatings[index];
        const patch: Record<string, unknown> = {
          ucpm: true,
          ucpmPosition: startPosition + index,
          ucpmGroupId: groupId,
          ucpmGroupLabel: groupLabel,
          ucpmGroupOrder: groupOrder,
          ucpmGroupExpectedCount: targetCount,
          ucpmGroupType: editingGroup ? 'sixfilms' : ucpmComposerMode,
          ucpmGroupItemOrder: index + 1,
        };

        if (normalizedRating !== null && normalizedRating !== undefined) {
          patch.rating = normalizedRating;
          patch.ratingUpdatedAt = serverTimestamp();
        }

        Object.assign(
          patch,
          getAutomaticUcpmVusPatch(
            savedMovie,
            normalizedRating ?? null
          )
        );

        batch.set(movieRef, patch, { merge: true });
      }

      await batch.commit();

      addHistoryEntry(
        `${editingGroup ? 'Modification' : 'Création'} UCPM : ${groupLabel}`,
        historyBefore
      );

      setUcpmComposerMessage(
        editingGroup
          ? `${groupLabel} mis à jour.`
          : `${groupLabel} créé avec ${targetCount} films.`
      );
      setUcpmComposerItems([]);
      setUcpmComposerQuery('');
      setUcpmComposerResults([]);

      window.setTimeout(() => {
        setUcpmComposerOpen(false);
        setEditingUcpmSixFilmsGroup(null);
        setUcpmComposerMessage('');
      }, 550);
    } catch (error) {
      console.error(error);
      setUcpmComposerMessage(
        editingGroup
          ? 'Impossible de modifier ce 6 films UCPM.'
          : 'Impossible de créer ce 6 films UCPM.'
      );
    } finally {
      setUcpmComposerSaving(false);
    }
  }


  async function deleteUcpmSixFilmsGroup(
    group: { number: number; movies: SavedMovie[]; groupId?: string | null }
  ) {
    if (
      !user ||
      deletingUcpmSixFilmsGroup !== null ||
      group.movies.length === 0
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Supprimer « 6 films #${group.number} » ?\n\nLes films créés uniquement pour ce bloc seront supprimés de Movie Database. Les films qui existaient déjà avant, ou qui sont utilisés ailleurs, seront conservés.`
    );

    if (!confirmed) {
      return;
    }

    const uniqueMovies = Array.from(
      new Map(group.movies.map((movie) => [movie.docId, movie])).values()
    );
    const explicitGroupId =
      group.groupId ||
      uniqueMovies
        .flatMap((movie) => getUcpmSixFilmsMemberships(movie))
        .find((membership) => membership.number === group.number)?.groupId ||
      null;
    const historyBefore = snapshotMovieIds(
      uniqueMovies.map((movie) => movie.docId)
    );

    try {
      setDeletingUcpmSixFilmsGroup(group.number);
      setMessage('');

      const batch = writeBatch(db);

      for (const movie of uniqueMovies) {
        const movieRef = doc(
          db,
          'users',
          user.uid,
          'movies',
          movie.docId
        );
        const memberships = getUcpmSixFilmsMemberships(movie);
        const nextMemberships = memberships.filter((membership) =>
          explicitGroupId
            ? membership.groupId !== explicitGroupId
            : membership.number !== group.number
        );
        const membershipRemoved =
          nextMemberships.length !== memberships.length;
        const primaryGroup = getUcpmPodcastGroup(movie);
        const primaryNumberMatch = primaryGroup?.label.match(
          /^6\s*films\s*#?\s*(\d+)\b/i
        );
        const primaryNumber = primaryNumberMatch
          ? Number(primaryNumberMatch[1])
          : null;
        const removesLegacyPrimary = Boolean(
          primaryGroup?.kind === 'sixfilms' &&
          primaryNumber === group.number
        );
        const belongsToDeletedGroup =
          membershipRemoved || removesLegacyPrimary;

        const canDeleteDocument = Boolean(
          belongsToDeletedGroup &&
          movie.ucpmSixFilmsCreatedOnly === true &&
          nextMemberships.length === 0 &&
          !movieHasUseOutsideSixFilms(movie)
        );

        if (canDeleteDocument) {
          batch.delete(movieRef);
          continue;
        }

        const patch: Record<string, unknown> = {};

        if (membershipRemoved || memberships.length > 0) {
          patch.ucpmSixFilmsMemberships =
            nextMemberships.length > 0
              ? nextMemberships
              : deleteField();
        }

        if (removesLegacyPrimary) {
          patch.ucpmPosition = deleteField();
          patch.ucpmGroupId = deleteField();
          patch.ucpmGroupLabel = deleteField();
          patch.ucpmGroupOrder = deleteField();
          patch.ucpmGroupExpectedCount = deleteField();
          patch.ucpmGroupType = deleteField();
          patch.ucpmGroupItemOrder = deleteField();
        }

        /* Pour les anciens blocs reconstruits par titre, ce marqueur empêche
           leur réapparition tant que l'utilisateur ne les ajoute pas à nouveau
           explicitement dans un bloc moderne. */
        if (!explicitGroupId || removesLegacyPrimary) {
          patch.ucpmSixFilmsHidden = true;
        }

        if (
          nextMemberships.length === 0 &&
          (movie.ucpmSixFilmsOnly === true || removesLegacyPrimary)
        ) {
          patch.ucpm = false;
          patch.ucpmSixFilmsOnly = deleteField();
        }

        if (Object.keys(patch).length > 0) {
          batch.set(movieRef, patch, { merge: true });
        }
      }

      await batch.commit();

      addHistoryEntry(
        `Suppression UCPM : 6 films #${group.number}`,
        historyBefore
      );

      setMessage(`6 films #${group.number} supprimé.`);
    } catch (error) {
      console.error(error);
      setMessage(`Impossible de supprimer 6 films #${group.number}.`);
    } finally {
      setDeletingUcpmSixFilmsGroup(null);
    }
  }


  function openAddToSection(
    target:
      AddTarget
  ) {
    setAddTarget(
      target
    );

    setAddQuery(
      ''
    );

    setAddResults(
      []
    );

    setAddSuggestions([]);
    setAddSuggestionsLoading(false);
    addSuggestionSelectedQueryRef.current = '';

    setAddMessage(
      ''
    );

    setAddDiaryDate(
      new Date()
        .toISOString()
        .slice(
          0,
          10
        )
    );

    if (target === 'diary') {
      setAddDiaryMediaType('movie');
    }

    window.requestAnimationFrame(
      () => {
        addSearchInputRef.current
          ?.focus();
      }
    );
  }


  function closeAddToSection() {
    setAddTarget(
      null
    );

    setAddQuery(
      ''
    );

    setAddResults(
      []
    );

    setAddSuggestions([]);
    setAddSuggestionsLoading(false);
    addSuggestionSelectedQueryRef.current = '';

    setAddMessage(
      ''
    );

    setAddingToSection(
      null
    );
  }


  async function searchMoviesForSection(
    event:
      FormEvent
  ) {
    event.preventDefault();

    const rawQuery =
      addQuery.trim();

    if (
      !rawQuery ||
      !apiKey
    ) {
      return;
    }

    try {
      setAddLoading(
        true
      );
      setAddSuggestions([]);

      setAddMessage(
        ''
      );

      const mediaType: 'movie' | 'tv' =
        addTarget === 'series'
          ? 'tv'
          : addTarget === 'diary'
          ? addDiaryMediaType
          : 'movie';

      const imdbId =
        extractImdbId(
          rawQuery
        );

      let results:
        TmdbMovie[] = [];

      if (imdbId) {
        const response =
          await fetch(
            `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&language=fr-FR&external_source=imdb_id`
          );

        if (
          !response.ok
        ) {
          throw new Error(
            'Erreur TMDb'
          );
        }

        const data =
          await response.json();

        const imdbResults =
          mediaType === 'tv'
            ? data.tv_results || []
            : data.movie_results || [];

        results =
          imdbResults.map(
            (item: any) => ({
              id: item.id,
              title:
                item.title ||
                item.name ||
                '',
              original_title:
                item.original_title ||
                item.original_name ||
                '',
              release_date:
                item.release_date ||
                item.first_air_date ||
                '',
              poster_path:
                item.poster_path ||
                null,
              backdrop_path:
                item.backdrop_path ||
                null,
              overview:
                item.overview ||
                '',
            })
          );
      } else {
        const response =
          await fetch(
            `https://api.themoviedb.org/3/search/${mediaType}?api_key=${apiKey}&language=fr-FR&include_adult=false&query=${encodeURIComponent(rawQuery)}`
          );

        if (
          !response.ok
        ) {
          throw new Error(
            'Erreur TMDb'
          );
        }

        const data =
          await response.json();

        results =
          (data.results || []).map(
            (item: any) => ({
              id: item.id,
              title:
                item.title ||
                item.name ||
                '',
              original_title:
                item.original_title ||
                item.original_name ||
                '',
              release_date:
                item.release_date ||
                item.first_air_date ||
                '',
              poster_path:
                item.poster_path ||
                null,
              backdrop_path:
                item.backdrop_path ||
                null,
              overview:
                item.overview ||
                '',
            })
          );
      }

      setAddResults(
        results.slice(
          0,
          20
        )
      );

      if (
        results.length ===
        0
      ) {
        const searchingSeries =
          mediaType === 'tv';

        setAddMessage(
          imdbId
            ? `Aucun ${searchingSeries ? 'résultat série' : 'film'} trouvé pour ${imdbId}.`
            : searchingSeries
            ? 'Aucune série trouvée.'
            : 'Aucun film trouvé.'
        );
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      const searchingSeries =
        addTarget === 'series' ||
        (addTarget === 'diary' && addDiaryMediaType === 'tv');

      setAddMessage(
        searchingSeries
          ? 'Impossible de rechercher cette série.'
          : 'Impossible de rechercher ce film.'
      );
    } finally {
      setAddLoading(
        false
      );
    }
  }


  async function addTmdbMovieToSection(
    movie:
      TmdbMovie
  ) {
    if (
      !user ||
      !addTarget
    ) {
      return;
    }

    try {
      setAddingToSection(
        movie.id
      );

      setAddMessage(
        ''
      );

      const mediaType: 'movie' | 'tv' =
        addTarget === 'series'
          ? 'tv'
          : addTarget === 'diary'
          ? addDiaryMediaType
          : 'movie';

      let existing =
        findExistingMovieForTmdb(
          movie,
          mediaType
        );

      const historyDocumentId =
        existing?.docId ||
        (
          mediaType === 'tv'
            ? `tv_${movie.id}`
            : `tmdb_${movie.id}`
        );

      const historyBefore =
        snapshotMovieIds([
          historyDocumentId,
        ]);

      let targetAppliedDuringCreate =
        false;

      if (
        !existing
      ) {
        const preferredPoster =
          await getPreferredPosterPath(
            movie.id,
            movie.poster_path,
            mediaType
          );

        const preferredTitle =
          await getPreferredFrenchTitle(
            movie.id,
            movie.title,
            mediaType
          );

        const documentId =
          mediaType === 'tv' ? `tv_${movie.id}` : `tmdb_${movie.id}`;

        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            documentId
          );

        const newMovie:
          SavedMovie = {
          docId:
            documentId,
          tmdbId:
            movie.id,
          tmdbMediaType:
            mediaType,
          title:
            movie.title,
          localizedTitle:
            preferredTitle,
          tmdbTitle:
            movie.title,
          originalTitle:
            movie.original_title ||
            null,
          releaseDate:
            movie.release_date ||
            null,
          year:
            movie.release_date
              ? movie.release_date.substring(
                  0,
                  4
                )
              : null,
          posterPath:
            preferredPoster,
          backdropPath:
            movie.backdrop_path ||
            null,
          overview:
            movie.overview ||
            '',
          rating:
            null,
          review:
            '',
          favorite:
            false,
          liked:
            false,
          watched:
            false,
          watchlist:
            false,
          rankings: {},
          diary: [],
          tmdbMatchStatus:
            'matched',
        };

        const createPatch:
          Record<string, unknown> = {
          ...newMovie,
        };

        delete createPatch.docId;

        if (
          addTarget ===
          'diary'
        ) {
          const diaryEntry:
            DiaryEntry = {
            watchedDate:
              addDiaryDate,
            entryDate:
              addDiaryDate,
            rating:
              getDiaryPriorityRating(
                newMovie,
                {}
              ) ?? null,
            rewatch:
              false,
            tags: [],
            letterboxdEntryUri:
              null,
            insertedAt:
              new Date().toISOString(),
            source:
              'manual',
          };

          createPatch.diary = [
            diaryEntry,
          ];
          createPatch.watched =
            true;

          existing = {
            ...newMovie,
            diary: [
              diaryEntry,
            ],
            watched: true,
          };

          targetAppliedDuringCreate =
            true;
        } else if (addTarget === 'watchlist') {
          const insertedAt = new Date().toISOString();
          createPatch.watchlist = true;
          createPatch.watchlistDate = insertedAt;

          existing = {
            ...newMovie,
            watchlist: true,
            watchlistDate: insertedAt,
          };

          targetAppliedDuringCreate = true;
        } else if (
          addTarget ===
          'ucpm'
        ) {
          const nextUcpmPosition =
            getNextSectionPosition(
              'ucpm'
            );

          createPatch.ucpm =
            true;
          createPatch.ucpmPosition =
            nextUcpmPosition;
          const automaticVusPatch =
            getAutomaticUcpmVusPatch(newMovie);
          Object.assign(createPatch, automaticVusPatch);

          existing = {
            ...newMovie,
            ucpm: true,
            ucpmPosition:
              nextUcpmPosition,
            ...(automaticVusPatch as Partial<SavedMovie>),
          };

          targetAppliedDuringCreate =
            true;
        } else {
          const rankingEntry = {
            listName:
              sectionLabel(
                addTarget
              ),
            position:
              getNextSectionPosition(
                addTarget
              ),
          };

          const rankings = {
            [addTarget]:
              rankingEntry,
          } as Record<string, RankingInfo>;

          createPatch.rankings =
            rankings;

          if (addTarget === 'jellyfin') {
            createPatch.jellyfinAddedAt =
              serverTimestamp();
            jellyfinRecentSortAfterImportRef.current =
              true;
          }

          const soundtrackPatch =
            addTarget === 'soundtracks'
              ? {
                  soundtrackIndependent: true,
                  soundtrackTitle:
                    getMovieDisplayTitle(
                      newMovie
                    ),
                  soundtrackRating:
                    newMovie.rating ??
                    null,
                  soundtrackCoverUrl:
                    newMovie.customPosterUrl ??
                    null,
                  soundtrackCoverPath:
                    newMovie.customPosterPath ??
                    newMovie.posterPath ??
                    null,
                }
              : {};

          Object.assign(
            createPatch,
            soundtrackPatch
          );

          existing = {
            ...newMovie,
            rankings,
            ...soundtrackPatch,
          };

          targetAppliedDuringCreate =
            true;
        }

        await setDoc(
          movieRef,
          {
            ...createPatch,
            addedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );

        if (
          addTarget ===
          'diary'
        ) {
          focusDiaryYearForDate(
            addDiaryDate
          );
        }
      } else if (
        !existing.tmdbId
      ) {
        const preferredPoster =
          await getPreferredPosterPath(
            movie.id,
            movie.poster_path,
            mediaType
          );

        const preferredTitle =
          await getPreferredFrenchTitle(
            movie.id,
            movie.title,
            mediaType
          );

        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            existing.docId
          );

        const tmdbPatch = {
          tmdbId:
            movie.id,
          tmdbMediaType:
            mediaType,
          tmdbTitle:
            movie.title,
          localizedTitle:
            preferredTitle,
          originalTitle:
            movie.original_title ||
            null,
          releaseDate:
            movie.release_date ||
            null,
          year:
            movie.release_date
              ? movie.release_date.substring(
                  0,
                  4
                )
              : existing.year ||
                null,
          posterPath:
            preferredPoster,
          backdropPath:
            movie.backdrop_path ||
            null,
          overview:
            movie.overview ||
            '',
          tmdbMatchStatus:
            'matched' as const,
          tmdbMatchedAt:
            serverTimestamp(),
        };

        await setDoc(
          movieRef,
          tmdbPatch,
          {
            merge: true,
          }
        );

        existing = {
          ...existing,
          ...tmdbPatch,
        };
      }

      let menuMovie =
        existing;

      if (
        addTarget ===
        'diary'
      ) {
        if (
          !targetAppliedDuringCreate
        ) {
          const added =
            await addDiaryEntryToMovie(
              existing,
              addDiaryDate
            );

          if (
            !added
          ) {
            setAddMessage(
              `${movie.title} est déjà dans VUS pour cette date.`
            );
            return;
          }

          menuMovie = {
            ...existing,
            watched: true,
            diary: [
              ...(existing.diary || []),
              {
                watchedDate: addDiaryDate,
                entryDate: addDiaryDate,
                rating:
                  getDiaryPriorityRating(
                    existing,
                    {}
                  ) ?? null,
                rewatch:
                  (existing.diary?.length || 0) > 0,
                tags: [],
                letterboxdEntryUri: null,
                insertedAt: new Date().toISOString(),
                source: 'manual',
              },
            ],
          };
        }
      } else if (addTarget === 'watchlist') {
        if (!targetAppliedDuringCreate) {
          const movieRef = doc(
            db,
            'users',
            user.uid,
            'movies',
            existing.docId
          );
          const insertedAt = new Date().toISOString();

          await setDoc(
            movieRef,
            {
              watchlist: true,
              watchlistDate: insertedAt,
            },
            { merge: true }
          );

          menuMovie = {
            ...existing,
            watchlist: true,
            watchlistDate: insertedAt,
          };
        }
      } else if (
        addTarget ===
        'ucpm'
      ) {
        if (
          !targetAppliedDuringCreate
        ) {
          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              existing.docId
            );

          const nextUcpmPosition =
            getNextSectionPosition(
              'ucpm'
            );

          const automaticVusPatch =
            getAutomaticUcpmVusPatch(existing);

          await setDoc(
            movieRef,
            {
              ucpm:
                true,
              ucpmPosition:
                nextUcpmPosition,
              ...automaticVusPatch,
            },
            {
              merge: true,
            }
          );

          menuMovie = {
            ...existing,
            ucpm: true,
            ucpmPosition:
              nextUcpmPosition,
            ...(automaticVusPatch as Partial<SavedMovie>),
          };
        }
      } else if (
        !targetAppliedDuringCreate
      ) {
        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            existing.docId
          );

        const rankingEntry = {
          listName:
            sectionLabel(
              addTarget
            ),

          position:
            getNextSectionPosition(
              addTarget
            ),
        };

        const rankings = {
          ...(existing.rankings || {}),
          [addTarget]: rankingEntry,
        };

        const sectionPatch:
          Record<
            string,
            unknown
          > = {
          [`rankings.${addTarget}`]:
            rankingEntry,
        };

        if (addTarget === 'jellyfin') {
          sectionPatch.jellyfinAddedAt =
            serverTimestamp();
          jellyfinRecentSortAfterImportRef.current =
            true;
        }

        if (
          addTarget ===
          'soundtracks'
        ) {
          sectionPatch.soundtrackIndependent =
            true;
          sectionPatch.soundtrackTitle =
            existing.soundtrackTitle ||
            getMovieDisplayTitle(
              existing
            );
          sectionPatch.soundtrackRating =
            existing.soundtrackRating ??
            existing.rating ??
            null;
          sectionPatch.soundtrackCoverUrl =
            existing.soundtrackCoverUrl ??
            existing.customPosterUrl ??
            null;
          sectionPatch.soundtrackCoverPath =
            existing.soundtrackCoverPath ??
            existing.customPosterPath ??
            existing.posterPath ??
            null;
        }

        await updateDoc(
          movieRef,
          sectionPatch
        );

        menuMovie = {
          ...existing,
          rankings,
          ...(addTarget === 'soundtracks'
            ? {
                soundtrackIndependent: true,
                soundtrackTitle:
                  existing.soundtrackTitle ||
                  getMovieDisplayTitle(
                    existing
                  ),
                soundtrackRating:
                  existing.soundtrackRating ??
                  existing.rating ??
                  null,
                soundtrackCoverUrl:
                  existing.soundtrackCoverUrl ??
                  existing.customPosterUrl ??
                  null,
                soundtrackCoverPath:
                  existing.soundtrackCoverPath ??
                  existing.customPosterPath ??
                  existing.posterPath ??
                  null,
              }
            : {}),
        };
      }

      setAddMessage(
        addTarget === 'watchlist'
          ? `« ${movie.title} » a bien été ajouté à À VOIR.`
          : `${movie.title} ajouté à ${sectionLabel(addTarget)}.`
      );

      if (addTarget === 'jellyfin') {
        /* Le film ajouté est montré en tête immédiatement si Movie Database
           est ouverte, ou à la prochaine ouverture sinon. Après cette vue
           ponctuelle, Note + redevient le tri par défaut. */
        if (page === 'jellyfin') {
          setSortMode('added-desc');
          jellyfinRecentSortAfterImportRef.current =
            false;
        } else {
          jellyfinRecentSortAfterImportRef.current =
            true;
        }
      }

      /* addDiaryEntryToMovie() historise déjà l'ajout VUS d'une fiche existante.
         Pour un nouveau film VUS, la création et le visionnage sont une seule écriture
         et doivent donc produire une seule entrée d'historique ici. */
      if (
        addTarget !== 'diary' ||
        targetAppliedDuringCreate
      ) {
        addHistoryEntry(
          `Ajout à ${sectionLabel(addTarget)} : ${movie.title}`,
          historyBefore
        );
      }

      /*
       * À VOIR est pensé comme une liste d'ajout rapide : après un ajout,
       * on reste dans la fenêtre de recherche avec les résultats visibles et
       * un simple message de confirmation. Pour les autres rubriques, le
       * comportement historique reste inchangé : le menu complet du film
       * s'ouvre immédiatement après l'ajout.
       */
      if (addTarget === 'watchlist') {
        setAddSuggestions([]);
        window.requestAnimationFrame(() => {
          addSearchInputRef.current?.focus();
        });
      } else {
        openMovieMenu(
          menuMovie
        );

        /*
         * La fenêtre d'ajout reste ouverte pour permettre les ajouts en série.
         * Le formulaire est simplement remis à zéro pendant que la liste derrière
         * la modale se met à jour via le listener Firestore.
         */
        setAddQuery(
          ''
        );
        setAddSuggestions([]);
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      const addingSeries =
        addTarget === 'series' ||
        (addTarget === 'diary' && addDiaryMediaType === 'tv');

      setAddMessage(
        addingSeries
          ? "Impossible d'ajouter cette série."
          : "Impossible d'ajouter ce film."
      );
    } finally {
      setAddingToSection(
        null
      );
    }
  }


  function autoBackupStorageKey() {
    return user
      ? `merylmoviesbox-last-auto-backup-${user.uid}`
      : 'merylmoviesbox-last-auto-backup';
  }


  function buildBackupPayload(
    movieSource: SavedMovie[] = savedMovies,
    albumSource: SavedAlbum[] = savedAlbums
  ): MerlyBackup {
    const movies =
      movieSource.map(
        (movie) => {
          const {
            docId,
            ...data
          } = movie;

          return encodeHistoryValue({
            docId,
            ...data,
          }) as Record<string, unknown>;
        }
      );

    const albums =
      albumSource.map(
        (album) => {
          const {
            docId,
            ...data
          } = album;

          return encodeHistoryValue({
            docId,
            ...data,
          }) as Record<string, unknown>;
        }
      );

    const posterSelections:
      PosterBackupSelection[] =
      movieSource
        .map(
          (movie) => ({
            docId: movie.docId,
            posterPath:
              movie.posterPath ?? null,
            customPosterPath:
              movie.customPosterPath ?? null,
            customPosterLanguage:
              movie.customPosterLanguage ?? null,
            customPosterUrl:
              movie.customPosterUrl ?? null,
            soundtrackCoverPath:
              movie.soundtrackCoverPath ?? null,
            soundtrackCoverUrl:
              movie.soundtrackCoverUrl ?? null,
          })
        )
        .filter(
          (selection) =>
            selection.posterPath !== null ||
            selection.customPosterPath !== null ||
            selection.customPosterUrl !== null ||
            selection.soundtrackCoverPath !== null ||
            selection.soundtrackCoverUrl !== null
        );

    return {
      format: 'merlymoviesbox-backup',
      version: 4,
      createdAt: new Date().toISOString(),
      preferences: {
        posterSize,
      },
      movies,
      albums,
      posterSelections,
    };
  }


  function automaticBackupAdditionScore(
    movies: SavedMovie[],
    albums: SavedAlbum[]
  ) {
    let score = albums.length;

    for (const movie of movies) {
      /* Un nouveau document, une nouvelle appartenance à une liste ou un
         nouveau visionnage VUS sont tous considérés comme un ajout. */
      score += 1;
      score += movie.rankings?.topUS ? 1 : 0;
      score += movie.rankings?.topFR ? 1 : 0;
      score += movie.rankings?.soundtracks ? 1 : 0;
      score += movie.rankings?.series ? 1 : 0;
      score += movie.rankings?.jellyfin ? 1 : 0;
      score += movie.ucpm ? 1 : 0;
      score += (movie.diary || []).filter(
        (entry) => isExplicitVusEntry(movie, entry)
      ).length;
    }

    return score;
  }


  async function restoreLastAutomaticBackup() {
    if (!user || restoringBackup) {
      return;
    }

    const stored =
      window.localStorage.getItem(
        autoBackupStorageKey()
      );

    if (!stored) {
      setBackupMessage(
        'Aucune sauvegarde automatique disponible.'
      );
      return;
    }

    try {
      const backup =
        JSON.parse(stored) as MerlyBackup;

      if (
        backup.format !== 'merlymoviesbox-backup' ||
        !Array.isArray(backup.movies)
      ) {
        throw new Error(
          'Sauvegarde automatique invalide.'
        );
      }

      autoBackupSuspendedRef.current = true;
      setRestoringBackup(true);
      setBackupMessage(
        'Retour à la dernière sauvegarde automatique…'
      );

      const historyBefore =
        snapshotFullHistory([
          'movies',
          'albums',
        ]);

      const movieRecords =
        backup.movies.map((saved) => {
          const decoded =
            decodeBackupValue(saved) as Record<string, unknown>;
          const record = { ...decoded };
          const rawDocId = record.docId;
          delete record.docId;
          const documentId =
            typeof rawDocId === 'string' && rawDocId.trim()
              ? rawDocId
              : `backup_${hashString(JSON.stringify(record))}`;
          return { documentId, record };
        });

      const albumRecords =
        (backup.albums || []).map((saved) => {
          const decoded =
            decodeBackupValue(saved) as Record<string, unknown>;
          const record = { ...decoded };
          const rawDocId = record.docId;
          delete record.docId;
          const documentId =
            typeof rawDocId === 'string' && rawDocId.trim()
              ? rawDocId
              : `lp_backup_${hashString(JSON.stringify(record))}`;
          return { documentId, record };
        });

      const backupMovieIds =
        new Set(movieRecords.map((item) => item.documentId));
      const backupAlbumIds =
        new Set(albumRecords.map((item) => item.documentId));

      const movieDeletes =
        savedMovies
          .map((movie) => movie.docId)
          .filter((docId) => !backupMovieIds.has(docId));

      const albumDeletes =
        savedAlbums
          .map((album) => album.docId)
          .filter((docId) => !backupAlbumIds.has(docId));

      const chunkSize = 300;

      for (let start = 0; start < movieDeletes.length; start += chunkSize) {
        const batch = writeBatch(db);
        for (const documentId of movieDeletes.slice(start, start + chunkSize)) {
          batch.delete(
            doc(db, 'users', user.uid, 'movies', documentId)
          );
        }
        await batch.commit();
      }

      for (let start = 0; start < albumDeletes.length; start += chunkSize) {
        const batch = writeBatch(db);
        for (const documentId of albumDeletes.slice(start, start + chunkSize)) {
          batch.delete(
            doc(db, 'users', user.uid, 'albums', documentId)
          );
        }
        await batch.commit();
      }

      for (let start = 0; start < movieRecords.length; start += chunkSize) {
        const batch = writeBatch(db);
        for (const { documentId, record } of movieRecords.slice(start, start + chunkSize)) {
          /* Pas de merge : on revient exactement à l'état sauvegardé. */
          batch.set(
            doc(db, 'users', user.uid, 'movies', documentId),
            record
          );
        }
        await batch.commit();
      }

      for (let start = 0; start < albumRecords.length; start += chunkSize) {
        const batch = writeBatch(db);
        for (const { documentId, record } of albumRecords.slice(start, start + chunkSize)) {
          batch.set(
            doc(db, 'users', user.uid, 'albums', documentId),
            record
          );
        }
        await batch.commit();
      }

      const size =
        backup.preferences?.posterSize;

      if (
        size === 'huge' ||
        size === 'large' ||
        size === 'medium' ||
        size === 'small' ||
        size === 'mini'
      ) {
        setPosterSize(size);
      }

      setBackupMessage(
        `Retour effectué : sauvegarde automatique du ${new Date(backup.createdAt).toLocaleString('fr-FR')}.`
      );

      addHistoryEntry(
        'Retour à la dernière sauvegarde automatique',
        historyBefore,
        ['movies', 'albums']
      );
    } catch (error) {
      console.error(error);
      setBackupMessage(
        'Impossible de revenir à la dernière sauvegarde automatique.'
      );
    } finally {
      setRestoringBackup(false);
      autoBackupPreviousRef.current = null;
      window.setTimeout(() => {
        autoBackupSuspendedRef.current = false;
      }, 1200);
    }
  }


  function createBackup() {
    if (
      !user
    ) {
      return;
    }

    try {
      const movies =
        savedMovies.map(
          (
            movie
          ) => {
            const {
              docId,
              ...data
            } =
              movie;

            return encodeHistoryValue({
              docId,
              ...data,
            }) as Record<string, unknown>;
          }
        );

      const albums =
        savedAlbums.map(
          (album) => {
            const {
              docId,
              ...data
            } = album;

            return encodeHistoryValue({
              docId,
              ...data,
            }) as Record<string, unknown>;
          }
        );


      const posterSelections:
        PosterBackupSelection[] =
        savedMovies
          .map(
            (
              movie
            ) => ({
              docId:
                movie.docId,
              posterPath:
                movie.posterPath ??
                null,
              customPosterPath:
                movie.customPosterPath ??
                null,
              customPosterLanguage:
                movie.customPosterLanguage ??
                null,
              customPosterUrl:
                movie.customPosterUrl ??
                null,
              soundtrackCoverPath:
                movie.soundtrackCoverPath ??
                null,
              soundtrackCoverUrl:
                movie.soundtrackCoverUrl ??
                null,
            })
          )
          .filter(
            (
              selection
            ) =>
              selection.posterPath !==
                null ||
              selection.customPosterPath !==
                null ||
              selection.customPosterUrl !==
                null ||
              selection.soundtrackCoverPath !==
                null ||
              selection.soundtrackCoverUrl !==
                null
          );

      const backup:
        MerlyBackup = {
        format:
          'merlymoviesbox-backup',

        version: 4,

        createdAt:
          new Date()
            .toISOString(),

        preferences: {
          posterSize,
        },

        movies,

        albums,

        posterSelections,
      };

      const json =
        JSON.stringify(
          backup,
          null,
          2
        );

      const blob =
        new Blob(
          [
            json,
          ],
          {
            type:
              'application/json',
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const date =
        new Date()
          .toISOString()
          .substring(
            0,
            10
          );

      const anchor =
        document
          .createElement(
            'a'
          );

      anchor.href =
        url;

      anchor.download =
        `merlymoviesbox-backup-${date}.json`;

      document.body
        .appendChild(
          anchor
        );

      anchor.click();

      anchor.remove();

      URL.revokeObjectURL(
        url
      );

      setBackupMessage(
        `${savedMovies.length} films/séries et ${savedAlbums.length} albums LP sauvegardés, avec ${posterSelections.length} choix d'affiches/pochettes.`
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setBackupMessage(
        'Impossible de créer la sauvegarde.'
      );
    }
  }



  function csvCell(
    value: unknown
  ) {
    const text =
      value == null
        ? ''
        : String(value);

    if (
      /[",\r\n]/.test(text)
    ) {
      return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
  }


  function toLetterboxdRating10(
    value: unknown
  ) {
    const rating =
      Number(value);

    if (
      !Number.isFinite(rating) ||
      rating <= 0
    ) {
      return '';
    }

    return String(
      Math.max(
        1,
        Math.min(
          10,
          Math.round(
            rating * 2
          )
        )
      )
    );
  }


  function exportLetterboxdCsv() {
    try {
      const grouped =
        new Map<
          string,
          SavedMovie[]
        >();

      for (
        const movie
        of savedMovies
      ) {
        if (
          movie.tmdbMediaType === 'tv' ||
          Boolean(movie.rankings?.series)
        ) {
          continue;
        }

        const linked =
          getLinkedMovies(movie);

        const relevant =
          linked.some(
            (item) =>
              Boolean(
                item.rankings?.topUS ||
                item.rankings?.topFR ||
                item.rankings?.soundtracks ||
                item.rankings?.jellyfin ||
                item.ucpm
              ) ||
              (item.diary || []).some(
                (entry) =>
                  isExplicitVusEntry(
                    item,
                    entry
                  )
              )
          );

        if (!relevant) {
          continue;
        }

        const key =
          recentMovieIdentityKey(
            movie
          );

        if (!grouped.has(key)) {
          grouped.set(
            key,
            []
          );
        }

        const bucket =
          grouped.get(key)!;

        if (
          !bucket.some(
            (item) =>
              item.docId ===
              movie.docId
          )
        ) {
          bucket.push(
            movie
          );
        }
      }

      const rows:
        Array<
          Record<
            string,
            string
          >
        > = [];

      for (
        const movies
        of grouped.values()
      ) {
        const seed =
          movies[0];

        if (!seed) {
          continue;
        }

        const linked =
          Array.from(
            new Map(
              movies
                .flatMap(
                  (movie) =>
                    getLinkedMovies(
                      movie
                    )
                )
                .map(
                  (movie) => [
                    movie.docId,
                    movie,
                  ] as const
                )
            ).values()
          );

        const canonical =
          getCanonicalMovie(
            seed
          );

        const title =
          getMovieDisplayTitle(
            canonical
          );

        const year =
          getMovieIdentityYear(
            canonical
          );

        const tmdbId =
          linked.find(
            (movie) =>
              Boolean(
                movie.tmdbId
              )
          )?.tmdbId ??
          canonical.tmdbId ??
          null;

        const imdbId =
          linked
            .map(
              (movie) =>
                normalizeImdbIdentity(
                  movie.imdbId ||
                  movie.ucpmImdbId
                )
            )
            .find(
              Boolean
            ) ||
          '';

        const letterboxdUri =
          linked
            .map(
              (movie) =>
                movie.letterboxdFilmUri ||
                ''
            )
            .find(
              Boolean
            ) ||
          '';

        const sources:
          string[] = [];

        if (
          linked.some(
            (movie) =>
              Boolean(
                movie.rankings?.topUS
              )
          )
        ) {
          sources.push('US');
        }

        if (
          linked.some(
            (movie) =>
              Boolean(
                movie.rankings?.topFR
              )
          )
        ) {
          sources.push('FR');
        }

        if (
          linked.some(
            (movie) =>
              Boolean(
                movie.rankings?.soundtracks
              )
          )
        ) {
          sources.push('B.O.');
        }

        if (
          linked.some(
            (movie) =>
              Boolean(
                movie.ucpm
              )
          )
        ) {
          sources.push('UCPM');
        }

        if (
          linked.some(
            (movie) =>
              Boolean(
                movie.rankings?.jellyfin
              )
          )
        ) {
          sources.push('Movie Database');
        }

        const diaryEntries =
          linked
            .flatMap(
              (movie) =>
                (movie.diary || [])
                  .filter(
                    (entry) =>
                      isExplicitVusEntry(
                        movie,
                        entry
                      )
                  )
                  .map(
                    (entry) => ({
                      movie,
                      entry,
                    })
                  )
            );

        const uniqueDiary =
          Array.from(
            new Map(
              diaryEntries.map(
                (item) => [
                  diaryEntrySignature(
                    item.entry
                  ),
                  item,
                ] as const
              )
            ).values()
          )
            .sort(
              (a, b) =>
                getDiaryWatchDate(
                  a.entry
                ).localeCompare(
                  getDiaryWatchDate(
                    b.entry
                  )
                )
            );

        if (
          uniqueDiary.length > 0
        ) {
          sources.push('VUS');
        }

        const sharedRating =
          getUsFrPriorityRating(
            seed
          )?.rating ??
          getSharedMovieRating(
            seed
          ) ??
          linked.find(
            (movie) =>
              movie.soundtrackRating !=
              null
          )?.soundtrackRating ??
          canonical.rating ??
          null;

        const rating10 =
          toLetterboxdRating10(
            sharedRating
          );

        const exactRating =
          sharedRating != null &&
          Number.isFinite(
            Number(
              sharedRating
            )
          )
            ? String(
                Number(
                  sharedRating
                )
              )
            : '';

        const base = {
          LetterboxdURI:
            letterboxdUri,
          tmdbID:
            tmdbId != null
              ? String(
                  tmdbId
                )
              : '',
          imdbID:
            imdbId,
          Title:
            title,
          Year:
            year,
          Rating10:
            rating10,
          WatchedDate:
            '',
          Rewatch:
            '',
          MMBSources:
            sources.join(
              ' + '
            ),
          MMBRatingExact:
            exactRating,
        };

        if (
          uniqueDiary.length ===
          0
        ) {
          rows.push(
            base
          );

          continue;
        }

        uniqueDiary.forEach(
          (
            item,
            index
          ) => {
            const diaryRating =
              getDiaryPriorityRating(
                item.movie,
                item.entry
              );

            rows.push({
              ...base,
              Rating10:
                toLetterboxdRating10(
                  diaryRating
                ) ||
                rating10,
              WatchedDate:
                getDiaryWatchDate(
                  item.entry
                ),
              Rewatch:
                item.entry.rewatch ||
                index > 0
                  ? 'true'
                  : 'false',
              MMBRatingExact:
                diaryRating != null &&
                Number.isFinite(
                  Number(
                    diaryRating
                  )
                )
                  ? String(
                      Number(
                        diaryRating
                      )
                    )
                  : exactRating,
            });
          }
        );
      }

      const columns = [
        'LetterboxdURI',
        'tmdbID',
        'imdbID',
        'Title',
        'Year',
        'Rating10',
        'WatchedDate',
        'Rewatch',
        'MMBSources',
        'MMBRatingExact',
      ];

      const csv =
        [
          columns.join(','),
          ...rows.map(
            (row) =>
              columns
                .map(
                  (column) =>
                    csvCell(
                      row[column]
                    )
                )
                .join(',')
          ),
        ].join('\r\n');

      const blob =
        new Blob(
          [
            '\ufeff',
            csv,
          ],
          {
            type:
              'text/csv;charset=utf-8',
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const date =
        new Date()
          .toISOString()
          .slice(
            0,
            10
          );

      const anchor =
        document.createElement(
          'a'
        );

      anchor.href =
        url;
      anchor.download =
        `merylmoviesbox-letterboxd-${date}.csv`;

      document.body.appendChild(
        anchor
      );
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(
        url
      );

      setBackupMessage(
        `${rows.length} ligne${rows.length > 1 ? 's' : ''} exportée${rows.length > 1 ? 's' : ''} pour Letterboxd.`
      );
    } catch (
      error
    ) {
      console.error(
        error
      );
      setBackupMessage(
        'Impossible de créer le CSV Letterboxd.'
      );
    }
  }


  async function restoreBackup(
    event:
      ChangeEvent<
        HTMLInputElement
      >
  ) {
    const file =
      event.target
        .files?.[0];

    if (
      !file ||
      !user
    ) {
      return;
    }

    try {
      autoBackupSuspendedRef.current =
        true;
      setRestoringBackup(
        true
      );

      setBackupMessage(
        'Lecture de la sauvegarde...'
      );

      const text =
        await file.text();

      const backup =
        JSON.parse(
          text
        ) as
        MerlyBackup;

      if (
        backup.format !==
          'merlymoviesbox-backup' ||
        !Array.isArray(
          backup.movies
        )
      ) {
        throw new Error(
          'Format de sauvegarde invalide.'
        );
      }

      const historyBefore =
        snapshotFullHistory([
          'movies',
          'albums',
        ]);

      const chunkSize =
        300;

      for (
        let start = 0;
        start <
        backup.movies
          .length;
        start +=
          chunkSize
      ) {
        const batch =
          writeBatch(
            db
          );

        const chunk =
          backup.movies
            .slice(
              start,
              start +
                chunkSize
            );

        for (
          const saved
          of chunk
        ) {
          const decodedSaved =
            decodeBackupValue(saved) as
              Record<string, unknown>;

          const record =
            {
              ...decodedSaved,
            };

          const rawDocId =
            record.docId;

          delete record.docId;

          const documentId =
            typeof rawDocId ===
              'string' &&
            rawDocId
              .trim()
            ? rawDocId
            : `backup_${hashString(
                JSON.stringify(
                  record
                )
              )}`;

          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              documentId
            );

          batch.set(
            movieRef,
            record,
            {
              merge: true,
            }
          );
        }

        await batch.commit();

        const restored =
          Math.min(
            start +
              chunkSize,
            backup.movies
              .length
          );

        setBackupMessage(
          `${restored} / ${backup.movies.length} films restaurés`
        );
      }

      if (
        Array.isArray(
          backup.albums
        ) &&
        backup.albums.length > 0
      ) {
        const albumChunkSize = 300;

        for (
          let start = 0;
          start < backup.albums.length;
          start += albumChunkSize
        ) {
          const batch =
            writeBatch(db);
          const chunk =
            backup.albums.slice(
              start,
              start + albumChunkSize
            );

          for (const saved of chunk) {
            const decodedSaved =
              decodeBackupValue(saved) as
                Record<string, unknown>;

            const record = {
              ...decodedSaved,
            };
            const rawDocId =
              record.docId;
            delete record.docId;

            const documentId =
              typeof rawDocId === 'string' &&
              rawDocId.trim()
                ? rawDocId
                : `lp_backup_${hashString(
                    JSON.stringify(record)
                  )}`;

            const albumRef =
              doc(
                db,
                'users',
                user.uid,
                'albums',
                documentId
              );

            batch.set(
              albumRef,
              record,
              { merge: true }
            );
          }

          await batch.commit();
        }
      }


      const backupMoviesByDocId =
        new Map<string, Record<string, unknown>>(
          backup.movies
            .map((saved) => {
              const decoded =
                decodeBackupValue(saved) as
                  Record<string, unknown>;
              const id =
                typeof decoded.docId === 'string'
                  ? decoded.docId
                  : '';
              return [id, decoded] as const;
            })
            .filter(([id]) => Boolean(id))
        );


      if (
        Array.isArray(
          backup.posterSelections
        ) &&
        backup.posterSelections
          .length > 0
      ) {
        const posterChunkSize =
          300;

        for (
          let start = 0;
          start <
          backup.posterSelections
            .length;
          start +=
            posterChunkSize
        ) {
          const batch =
            writeBatch(
              db
            );

          const chunk =
            backup.posterSelections
              .slice(
                start,
                start +
                  posterChunkSize
              );

          for (
            const selection
            of chunk
          ) {
            if (
              !selection.docId
            ) {
              continue;
            }

            const movieRef =
              doc(
                db,
                'users',
                user.uid,
                'movies',
                selection.docId
              );

            const movieFromBackup =
              backupMoviesByDocId.get(
                selection.docId
              );

            const posterPatch:
              Record<string, unknown> = {};

            const posterFields = [
              'posterPath',
              'customPosterPath',
              'customPosterLanguage',
              'customPosterUrl',
              'soundtrackCoverPath',
              'soundtrackCoverUrl',
            ] as const;

            for (const field of posterFields) {
              /* Le document movies reste la source principale. Le manifeste
                 ne sert que de secours si un ancien backup ne contenait pas
                 encore ce champ, afin d'éviter d'écraser une donnée récente
                 avec un null redondant. */
              if (
                movieFromBackup &&
                Object.prototype.hasOwnProperty.call(
                  movieFromBackup,
                  field
                )
              ) {
                continue;
              }

              const value = selection[field];
              if (value !== null && value !== undefined) {
                posterPatch[field] = value;
              }
            }

            if (Object.keys(posterPatch).length > 0) {
              batch.set(
                movieRef,
                posterPatch,
                {
                  merge: true,
                }
              );
            }
          }

          await batch.commit();
        }
      }


      if (
        backup.preferences
          ?.posterSize
      ) {
        const size =
          backup
            .preferences
            .posterSize;

        if (
          size ===
            'huge' ||
          size ===
            'large' ||
          size ===
            'medium' ||
          size ===
            'small' ||
          size ===
            'mini'
        ) {
          setPosterSize(
            size
          );
        }
      }

      setBackupMessage(
        `Sauvegarde restaurée : ${backup.movies.length} films/séries et ${backup.albums?.length || 0} albums LP mis à jour.`
      );

      addHistoryEntry(
        `Restauration sauvegarde : ${file.name}`,
        historyBefore,
        ['movies', 'albums']
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setBackupMessage(
        'Impossible de restaurer cette sauvegarde.'
      );
    } finally {
      setRestoringBackup(
        false
      );
      autoBackupPreviousRef.current =
        null;
      window.setTimeout(
        () => {
          autoBackupSuspendedRef.current =
            false;
        },
        1200
      );

      event.target.value =
        '';
    }
  }


  function getMovieDisplayTitle(
    movie:
      SavedMovie
  ) {
    return sanitizeMovieTitle(
      movie.customTitle ||
      movie.localizedTitle ||
      movie.title,
      movie.year
    );
  }


  function getSoundtrackDisplayTitle(
    movie:
      SavedMovie
  ) {
    return (
      movie.soundtrackTitle ||
      getMovieDisplayTitle(
        movie
      )
    );
  }


  function getListDisplayTitle(
    movie:
      SavedMovie
  ) {
    if (
      page ===
      'soundtracks'
    ) {
      return getSoundtrackDisplayTitle(
        movie
      );
    }

    if (
      page ===
      'ucpm'
    ) {
      return getMovieDisplayTitle(
        getUcpmCanonicalMovie(
          movie
        )
      );
    }

    return getMovieDisplayTitle(
      movie
    );
  }




  function getSoundtrackCarrier(
    movie:
      SavedMovie
  ) {
    const linked =
      getLinkedMovies(
        movie
      );

    return (
      linked.find(
        (
          linkedMovie
        ) =>
          Boolean(
            linkedMovie.rankings
              ?.soundtracks
          )
      ) ||
      getCanonicalMovie(
        movie
      )
    );
  }


  function getSoundtrackCoverSrc(
    movie:
      SavedMovie,

    tmdbSize =
      'w500'
  ) {
    if (
      movie.soundtrackCoverUrl
    ) {
      return movie.soundtrackCoverUrl;
    }

    const path =
      movie.soundtrackCoverPath ||
      movie.customPosterPath ||
      movie.posterPath;

    if (
      !path
    ) {
      return null;
    }

    return `https://image.tmdb.org/t/p/${tmdbSize}${path}`;
  }


  function getListPosterSrc(
    movie:
      SavedMovie,

    tmdbSize =
      'w500'
  ) {
    if (
      page ===
      'soundtracks'
    ) {
      return getSoundtrackCoverSrc(
        movie,
        tmdbSize
      );
    }

    if (
      page ===
      'ucpm'
    ) {
      const canonical =
        getUcpmCanonicalMovie(
          movie
        );

      return (
        getMoviePosterSrc(
          canonical,
          tmdbSize
        ) ||
        getMoviePosterSrc(
          movie,
          tmdbSize
        )
      );
    }

    if (
      page ===
      'diary'
    ) {
      return getMoviePosterSrc(
        getUsFrPriorityPosterMovie(
          movie
        ),
        tmdbSize
      );
    }

    if (
      page ===
      'jellyfin'
    ) {
      return getMoviePosterSrc(
        getMovieDatabasePriorityPosterMovie(
          movie
        ),
        tmdbSize
      );
    }

    return getMoviePosterSrc(
      movie,
      tmdbSize
    );
  }


  /*
   * PAGE « À NOTER »
   * Regroupement volontairement simple et robuste : une seule passe sur
   * savedMovies, puis une seule occurrence par identité de film.
   * Priorité : US > FR > UCPM > VUS > Séries > Movie Database.
   */
  const unratedQueueItems =
    useMemo<UnratedQueueItem[]>(
      () => {
        type QueueCandidate = UnratedQueueItem & {
          priority: number;
          hasRating: boolean;
          score: number;
        };

        const groups =
          new Map<string, QueueCandidate>();

        const latestDiaryEntry = (
          movie: SavedMovie
        ) => {
          const entries = [...(movie.diary || [])];
          entries.sort((a, b) =>
            getDiaryWatchDate(b).localeCompare(
              getDiaryWatchDate(a)
            )
          );
          return entries[0] || null;
        };

        const getIdentityKey = (
          movie: SavedMovie
        ) => {
          const mediaType =
            movie.tmdbMediaType || 'movie';

          if (movie.tmdbId) {
            return `tmdb:${mediaType}:${movie.tmdbId}`;
          }

          const imdb = normalizeImdbIdentity(
            movie.imdbId || movie.ucpmImdbId
          );

          if (imdb) {
            return `imdb:${mediaType}:${imdb}`;
          }

          const year =
            getMovieIdentityYear(movie);
          const normalizedTitle =
            normalizeMovieTitle(
              getMovieDisplayTitle(movie) || movie.title || '',
              year || movie.year
            );

          if (normalizedTitle) {
            return `title:${mediaType}:${normalizedTitle}:${year || ''}`;
          }

          return `doc:${movie.docId}`;
        };

        /* Une seule résolution des occurrences liées par film. La v1.532
           vérifiait séparément « présent ailleurs » et « masqué », ce qui
           doublait inutilement ce travail au chargement. */
        const linkedQueueStatus =
          new Map<
            string,
            { blocked: boolean; hidden: boolean }
          >();

        const getLinkedQueueStatus = (
          movie: SavedMovie
        ) => {
          const cached =
            linkedQueueStatus.get(movie.docId);

          if (cached) {
            return cached;
          }

          const linked =
            getLinkedMovies(movie);

          const status = {
            blocked: linked.some(
              (linkedMovie) =>
                Boolean(linkedMovie.rankings?.topUS) ||
                Boolean(linkedMovie.rankings?.topFR) ||
                Boolean(linkedMovie.ucpm) ||
                Boolean(linkedMovie.watchlist) ||
                (linkedMovie.diary?.length || 0) > 0
            ),
            hidden: linked.some(
              (linkedMovie) =>
                linkedMovie.unratedHidden === true
            ),
          };

          linkedQueueStatus.set(
            movie.docId,
            status
          );

          return status;
        };

        const getCandidate = (
          movie: SavedMovie
        ): QueueCandidate | null => {
          if (movie.tmdbMediaType === 'tv') {
            return null;
          }

          let source: UnratedQueueItem['source'] | null = null;
          let target: UnratedQueueItem['target'] | null = null;
          let priority = 0;
          let diaryEntry: DiaryEntry | null = null;

          if (movie.rankings?.topUS) {
            source = 'US';
            target = 'topUS';
            priority = 6;
          } else if (movie.rankings?.topFR) {
            source = 'FR';
            target = 'topFR';
            priority = 5;
          } else if (movie.ucpm) {
            source = 'UCPM';
            target = 'ucpm';
            priority = 4;
          } else if ((movie.diary?.length || 0) > 0) {
            source = 'VUS';
            target = 'diary';
            priority = 3;
            diaryEntry = latestDiaryEntry(movie);
          } else if (movie.rankings?.series) {
            source = 'SERIES';
            target = 'series';
            priority = 2;
          } else if (movie.rankings?.jellyfin) {
            source = 'MOVIEDB';
            target = 'jellyfin';
            priority = 1;
          }

          if (!source || !target) {
            return null;
          }

          const rawRating =
            source === 'VUS'
              ? diaryEntry?.rating ?? movie.rating ?? null
              : movie.rating ?? null;

          const hasRating =
            rawRating != null &&
            Number.isFinite(Number(rawRating));

          return {
            movie,
            source,
            target,
            diaryEntry,
            priority,
            hasRating,
            score: scoreMovieDocument(movie),
          };
        };

        for (const movie of savedMovies) {
          /* « À NOTER » ne doit contenir que les films réellement absents
             des rubriques déjà notées. On exclut aussi leurs doublons/liens
             (TMDb, IMDb ou titre/année), pas seulement le document courant. */
          const linkedStatus =
            getLinkedQueueStatus(movie);

          if (
            linkedStatus.hidden ||
            linkedStatus.blocked
          ) {
            continue;
          }

          const candidate = getCandidate(movie);

          if (!candidate) {
            continue;
          }

          const key = getIdentityKey(movie);
          const current = groups.get(key);

          if (
            !current ||
            candidate.priority > current.priority ||
            (candidate.priority === current.priority &&
              Number(candidate.hasRating) > Number(current.hasRating)) ||
            (candidate.priority === current.priority &&
              candidate.hasRating === current.hasRating &&
              candidate.score > current.score)
          ) {
            groups.set(key, candidate);
          }
        }

        return Array.from(groups.values())
          .filter(
            (candidate) =>
              !candidate.hasRating &&
              getUnratedExistingRating(candidate.movie) === null
          )
          .sort((a, b) =>
            b.priority - a.priority ||
            getMovieDisplayTitle(a.movie).localeCompare(
              getMovieDisplayTitle(b.movie),
              'fr',
              { sensitivity: 'base' }
            )
          )
          .map(({ priority: _priority, hasRating: _hasRating, score: _score, ...item }) => item);
      },
      [savedMovies, linkedMovieIndex]
    );


  function getUnratedSourceFileName(
    movie: SavedMovie
  ): string | null {
    const candidates = [
      movie,
      ...getLinkedMovies(movie),
    ];

    const keys = [
      'jellyfinSourceFile',
      'sourceFile',
      'sourceFileName',
      'sourceFilename',
      'fileName',
      'filename',
      'mediaFile',
      'jellyfinSourcePath',
      'sourcePath',
      'filePath',
      'path',
      'mediaPath',
      'jellyfinPath',
    ];

    for (const candidate of candidates) {
      for (const key of keys) {
        const rawValue = candidate[key];

        if (
          typeof rawValue !== 'string' ||
          !rawValue.trim()
        ) {
          continue;
        }

        const normalized = rawValue
          .replace(/^file:\/\//i, '')
          .trim();

        const parts = normalized
          .split(/[\\/]+/)
          .filter(Boolean);

        return parts[parts.length - 1] || normalized;
      }
    }

    return null;
  }


  function getUnratedQueueRatingKey(
    item: UnratedQueueItem
  ) {
    if (
      item.target === 'diary' &&
      item.diaryEntry
    ) {
      return quickRatingKeyForDiary(
        item.movie,
        item.diaryEntry
      );
    }

    return quickRatingKeyForList(
      item.movie,
      item.target as Exclude<AddTarget, 'diary'>
    );
  }


  /* Note déjà connue pour ce film dans une rubrique faisant autorité.
     Priorité : US > FR > UCPM > VUS. */
  function getUnratedExistingRating(
    movie: SavedMovie
  ): {
    rating: number;
    source: 'US' | 'FR' | 'UCPM' | 'VUS';
  } | null {
    const usFr = getUsFrPriorityRating(movie);

    if (usFr) {
      return usFr;
    }

    const linked = getLinkedMovies(movie);

    const ucpmCarrier =
      linked
        .filter(
          (item) =>
            Boolean(item.ucpm) &&
            item.rating != null &&
            Number.isFinite(Number(item.rating))
        )
        .sort(
          (a, b) =>
            scoreMovieDocument(b) -
            scoreMovieDocument(a)
        )[0];

    if (ucpmCarrier?.rating != null) {
      return {
        rating: Number(ucpmCarrier.rating),
        source: 'UCPM',
      };
    }

    const vusCandidates =
      linked
        .filter((item) => (item.diary?.length || 0) > 0)
        .map((item) => {
          const ratedEntries =
            [...(item.diary || [])]
              .filter(
                (entry) =>
                  entry.rating != null &&
                  Number.isFinite(Number(entry.rating))
              )
              .sort((a, b) =>
                getDiaryWatchDate(b).localeCompare(
                  getDiaryWatchDate(a)
                )
              );

          const rating =
            ratedEntries[0]?.rating ??
            item.rating ??
            null;

          if (
            rating == null ||
            !Number.isFinite(Number(rating))
          ) {
            return null;
          }

          return {
            rating: Number(rating),
            date: ratedEntries[0]
              ? getDiaryWatchDate(ratedEntries[0])
              : '',
            score: scoreMovieDocument(item),
          };
        })
        .filter(
          (candidate): candidate is {
            rating: number;
            date: string;
            score: number;
          } => candidate != null
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.score - a.score
        );

    if (vusCandidates.length > 0) {
      return {
        rating: vusCandidates[0].rating,
        source: 'VUS',
      };
    }

    return null;
  }


  async function removeUnratedQueueItem(
    item: UnratedQueueItem
  ) {
    if (!user) {
      return;
    }

    const title =
      getMovieDisplayTitle(item.movie);

    const confirmed =
      window.confirm(
        `Retirer « ${title} » de À NOTER ?\n\nLe film sera retiré de ${item.source === 'MOVIEDB' ? 'Movie Database' : item.source} mais restera dans ses autres rubriques éventuelles.`
      );

    if (!confirmed) {
      return;
    }

    try {
      setPosterEraseMovieId(
        item.movie.docId
      );

      if (
        item.target === 'diary' &&
        item.diaryEntry
      ) {
        const signature =
          diaryEntrySignature(
            item.diaryEntry
          );

        const carrier =
          getLinkedMovies(
            item.movie
          ).find(
            (linkedMovie) =>
              (linkedMovie.diary || []).some(
                (entry) =>
                  diaryEntrySignature(entry) ===
                  signature
              )
          );

        if (!carrier) {
          throw new Error(
            'Visionnage introuvable.'
          );
        }

        const nextDiary =
          (carrier.diary || []).filter(
            (entry) =>
              diaryEntrySignature(entry) !==
              signature
          );

        const historyBefore =
          snapshotMovieIds([
            carrier.docId,
          ]);

        await setDoc(
          doc(
            db,
            'users',
            user.uid,
            'movies',
            carrier.docId
          ),
          {
            diary: nextDiary,
            watched:
              nextDiary.length > 0,
          },
          { merge: true }
        );

        addHistoryEntry(
          `Retrait de À NOTER : ${title}`,
          historyBefore
        );
      } else {
        await setMovieSectionPresence(
          item.movie,
          item.target as Exclude<
            AddTarget,
            'diary'
          >,
          false
        );
      }

      setMessage(
        `« ${title} » a été retiré de À NOTER.`
      );
    } catch (error) {
      console.error(error);
      setMessage(
        'Impossible de retirer ce film de À NOTER.'
      );
    } finally {
      setPosterEraseMovieId(null);
    }
  }


  function getUnratedNoteUndoSnapshots(
    item: UnratedQueueItem
  ) {
    const ratingMovie =
      item.target === 'ucpm'
        ? getUcpmCanonicalMovie(item.movie)
        : item.movie;

    /* On évite snapshotMovieIds ici : cette fonction reconstruit une Map de
       toute la bibliothèque. Pour ne pas ralentir la notation instantanée,
       on photographie uniquement les quelques fiches réellement liées. */
    const moviesById =
      new Map<string, SavedMovie>();

    const remember =
      (movie: SavedMovie) => {
        moviesById.set(
          movie.docId,
          movie
        );
      };

    remember(item.movie);
    remember(ratingMovie);

    for (const linkedMovie of getLinkedMovies(item.movie)) {
      remember(linkedMovie);
    }

    for (const linkedMovie of getLinkedMovies(ratingMovie)) {
      remember(linkedMovie);
    }

    return Array.from(
      moviesById.values()
    ).map(historyMovieSnapshot);
  }


  async function undoLastUnratedRating() {
    if (
      !user ||
      undoingUnratedNoteId ||
      unratedNoteUndoStack.length === 0
    ) {
      return;
    }

    const entry =
      unratedNoteUndoStack[0];

    try {
      setUndoingUnratedNoteId(entry.id);

      /* Si la sauvegarde ultra-rapide est encore en vol, on attend qu'elle
         se termine avant de restaurer l'état précédent. Cela évite qu'une
         écriture Firebase retardée ne remette la note après l'annulation. */
      const [
        snapshots,
        saved,
      ] = await Promise.all([
        entry.snapshotsPromise,
        entry.savePromise,
      ]);

      if (saved) {
        await restoreHistoryDocuments(
          snapshots
        );
      }

      setUnratedNoteUndoStack(
        (current) =>
          current.filter(
            (candidate) =>
              candidate.id !== entry.id
          )
      );

      setQuickRatingErrorKey(null);

      setMessage(
        saved
          ? `Note annulée : « ${entry.title} » revient dans À NOTER sans note.`
          : `« ${entry.title} » n'avait pas été enregistré : il reste dans À NOTER sans note.`
      );
    } catch (error) {
      console.error(error);
      setMessage(
        `Impossible d'annuler la note de « ${entry.title} ».`
      );
    } finally {
      setUndoingUnratedNoteId(null);
    }
  }


  async function saveUnratedQueueRating(
    item: UnratedQueueItem,
    ratingDraftOverride: string | null = null
  ) {
    const currentKey =
      getUnratedQueueRatingKey(item);

    /*
     * MODE INSTANTANÉ V1.508
     * ---------------------
     * La priorité absolue est désormais l'affichage du champ suivant.
     * Rien de coûteux (snapshot Annuler, Firebase, historique) n'est exécuté
     * avant que React ait effectivement affiché le prochain éditeur.
     */
    const ratingDraft =
      ratingDraftOverride ?? quickRatingValue;
    const normalizedRating =
      normalizeMovieMenuRating(
        ratingDraft
      );

    if (normalizedRating === undefined) {
      setQuickRatingErrorKey(currentKey);
      return;
    }

    const currentIndex =
      unratedQueueItems.findIndex(
        (candidate) =>
          getUnratedQueueRatingKey(candidate) ===
          currentKey
      );

    const nextItem =
      currentIndex >= 0
        ? unratedQueueItems[currentIndex + 1] || null
        : null;

    /*
     * flushSync force le prochain champ à exister dans le DOM AVANT de
     * continuer la fonction. La file « À NOTER » ne contient par définition
     * que des films sans note : inutile de recalculer ici leurs notes liées,
     * ce qui évite un parcours coûteux de la bibliothèque.
     */
    flushSync(() => {
      if (nextItem) {
        setQuickRatingKey(
          getUnratedQueueRatingKey(nextItem)
        );
        setQuickRatingValue('');
      } else {
        setQuickRatingKey(null);
        setQuickRatingValue('');
      }

      setQuickRatingErrorKey(null);
    });

    /* Focus immédiat : pas besoin d'attendre useEffect / un autre rendu. */
    if (nextItem) {
      const nextInput =
        document.querySelector<HTMLInputElement>(
          '.unratedQueueCard .quickRatingInput'
        );

      if (nextInput) {
        nextInput.focus({
          preventScroll: true,
        });
        nextInput.select();

        /* On ne déplace la page que si le nouveau champ sort réellement
           de l'écran. Aucun scroll n'est lancé entre deux affiches visibles. */
        const rect =
          nextInput.getBoundingClientRect();
        const topLimit = 118;
        const bottomLimit =
          window.innerHeight - 90;

        if (
          rect.top < topLimit ||
          rect.bottom > bottomLimit
        ) {
          nextInput.scrollIntoView({
            behavior: 'auto',
            block: 'nearest',
            inline: 'nearest',
          });
        }
      }
    }

    const undoEntryId =
      `unrated-note-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    const undoTitle =
      getMovieDisplayTitle(item.movie);

    /*
     * Les snapshots nécessaires à « Annuler » étaient encore calculés dans
     * le même événement clavier : React ne pouvait donc pas peindre le champ
     * suivant avant la fin de ce calcul. Ils sont maintenant repoussés APRÈS
     * un premier affichage navigateur (double requestAnimationFrame).
     */
    let resolveSnapshots:
      (snapshots: HistoryDocumentSnapshot[]) => void =
        () => undefined;
    const snapshotsPromise =
      new Promise<HistoryDocumentSnapshot[]>((resolve) => {
        resolveSnapshots = resolve;
      });

    let resolveSave:
      (saved: boolean) => void =
        () => undefined;
    const savePromise =
      new Promise<boolean>((resolve) => {
        resolveSave = resolve;
      });

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        let snapshots:
          HistoryDocumentSnapshot[] = [];

        try {
          snapshots =
            getUnratedNoteUndoSnapshots(item);
        } catch (error) {
          console.error(error);
        }

        resolveSnapshots(snapshots);

        setUnratedNoteUndoStack(
          (current) => [
            {
              id: undoEntryId,
              title: undoTitle,
              ratingKey: currentKey,
              snapshotsPromise,
              savePromise,
            },
            ...current,
          ].slice(0, 20)
        );

        const request =
          item.target === 'diary' &&
          item.diaryEntry
            ? saveQuickDiaryRating(
                item.movie,
                item.diaryEntry,
                null,
                true,
                ratingDraft,
                true
              )
            : saveQuickListRating(
                item.movie,
                item.target as Exclude<AddTarget, 'diary'>,
                null,
                true,
                ratingDraft,
                true
              );

        void request
          .then(resolveSave)
          .catch((error) => {
            console.error(error);
            resolveSave(false);
          });
      });
    });

    void savePromise.then((saved) => {
      if (!saved) {
        setUnratedNoteUndoStack(
          (current) =>
            current.filter(
              (entry) =>
                entry.id !== undoEntryId
            )
        );
        setMessage(
          'La note n’a pas pu être enregistrée. Réessaie sur le film concerné.'
        );
      }
    });
  }


  async function getPreferredFrenchTitle(
    tmdbId: number,
    fallback: string,
    mediaType: 'movie' | 'tv' = 'movie'
  ) {
    if (
      !apiKey
    ) {
      return fallback;
    }

    const cacheKey =
      `${mediaType}:${tmdbId}`;

    let request =
      tmdbFrenchTitleCacheRef.current.get(
        cacheKey
      );

    if (!request) {
      request =
        (async () => {
          const response =
            await fetch(
              `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${apiKey}&language=fr-FR`
            );

          if (!response.ok) {
            return null;
          }

          const data =
            await response.json();

          const frenchTitle =
            String(
              mediaType === 'tv'
                ? (data.name || '')
                : (data.title || '')
            ).trim();

          return frenchTitle || null;
        })();

      tmdbFrenchTitleCacheRef.current.set(
        cacheKey,
        request
      );
    }

    try {
      const frenchTitle =
        await request;

      return frenchTitle || fallback;
    } catch (error) {
      console.error(error);
      tmdbFrenchTitleCacheRef.current.delete(
        cacheKey
      );
      return fallback;
    }
  }


  async function syncFrenchTitles() {
    if (
      !user ||
      !apiKey ||
      updatingFrenchTitles
    ) {
      return;
    }

    const pending =
      savedMovies
        .filter(
          (
            movie
          ) =>
            Boolean(
              movie.tmdbId
            ) &&
            !movie.localizedTitle
        );

    if (
      pending.length ===
      0
    ) {
      setFrenchTitleMessage(
        'Tous les films associés à TMDb ont déjà leur titre français enregistré.'
      );

      return;
    }

    stopFrenchTitlesRequested.current =
      false;

    setUpdatingFrenchTitles(
      true
    );

    setFrenchTitleMessage(
      ''
    );

    let updated =
      0;

    let errors =
      0;

    let processed =
      0;

    setFrenchTitleStats({
      current: 0,
      total:
        pending.length,
      updated: 0,
      errors: 0,
      currentMovie: '',
    });

    try {
      for (
        const movie
        of pending
      ) {
        if (
          stopFrenchTitlesRequested
            .current
        ) {
          break;
        }

        setFrenchTitleStats({
          current:
            processed,

          total:
            pending.length,

          updated,
          errors,

          currentMovie:
            movie.title,
        });

        try {
          const response =
            await fetch(
              `https://api.themoviedb.org/3/${movie.tmdbMediaType === 'tv' ? 'tv' : 'movie'}/${movie.tmdbId}?api_key=${apiKey}&language=fr-FR`
            );

          if (
            !response.ok
          ) {
            throw new Error(
              `TMDb ${response.status}`
            );
          }

          const data =
            await response
              .json();

          const frenchTitle =
            String(
              movie.tmdbMediaType === 'tv' ? (data.name || '') : (data.title || '')
            ).trim();

          if (
            frenchTitle
          ) {
            const movieRef =
              doc(
                db,
                'users',
                user.uid,
                'movies',
                movie.docId
              );

            await updateDoc(
              movieRef,
              {
                localizedTitle:
                  frenchTitle,

                localizedTitleUpdatedAt:
                  serverTimestamp(),
              }
            );

            updated++;
          }
        } catch (
          error
        ) {
          console.error(
            error
          );

          errors++;
        }

        processed++;

        setFrenchTitleStats({
          current:
            processed,

          total:
            pending.length,

          updated,
          errors,

          currentMovie:
            movie.title,
        });

        await new Promise(
          (
            resolve
          ) =>
            setTimeout(
              resolve,
              140
            )
        );
      }

      if (
        stopFrenchTitlesRequested
          .current
      ) {
        setFrenchTitleMessage(
          `Traitement arrêté : ${processed} / ${pending.length} films traités.`
        );
      } else {
        setFrenchTitleMessage(
          `Terminé : ${updated} titres enregistrés, ${errors} erreur(s).`
        );
      }
    } finally {
      setUpdatingFrenchTitles(
        false
      );

      stopFrenchTitlesRequested.current =
        false;
    }
  }


  function stopFrenchTitleSync() {
    stopFrenchTitlesRequested.current =
      true;

    setFrenchTitleMessage(
      'Arrêt demandé…'
    );
  }


  async function fetchTmdbTitleOptions(
    movie:
      SavedMovie
  ): Promise<
    TitleOption[]
  > {
    if (
      !apiKey ||
      !movie.tmdbId
    ) {
      return [];
    }

    const response =
      await fetch(
        `https://api.themoviedb.org/3/${movie.tmdbMediaType === 'tv' ? 'tv' : 'movie'}/${movie.tmdbId}/translations?api_key=${apiKey}`
      );

    if (
      !response.ok
    ) {
      throw new Error(
        'Erreur traductions TMDb'
      );
    }

    const data =
      await response
        .json();

    const translations:
      TmdbTranslation[] =
      Array.isArray(
        data.translations
      )
        ? data.translations
        : [];

    const options:
      TitleOption[] = [];

    const seen =
      new Set<
        string
      >();


    function addOption(
      option:
        TitleOption
    ) {
      const cleanTitle =
        option.title
          .trim();

      if (
        !cleanTitle
      ) {
        return;
      }

      const key =
        cleanTitle
          .toLocaleLowerCase();

      if (
        seen.has(
          key
        )
      ) {
        return;
      }

      seen.add(
        key
      );

      options.push({
        ...option,
        title:
          cleanTitle,
      });
    }


    if (
      movie.localizedTitle
    ) {
      addOption({
        title:
          movie.localizedTitle,

        language:
          'fr',

        country:
          'FR',

        label:
          'Français',

        kind:
          'automatic',
      });
    }


    const orderedTranslations =
      [
        ...translations,
      ].sort(
        (
          a,
          b
        ) => {
          const priority = (
            translation:
              TmdbTranslation
          ) => {
            if (
              translation
                .iso_639_1 ===
              'fr'
            ) {
              return 0;
            }

            if (
              translation
                .iso_639_1 ===
              'en'
            ) {
              return 1;
            }

            return 2;
          };

          return (
            priority(
              a
            ) -
            priority(
              b
            )
          );
        }
      );


    for (
      const translation
      of orderedTranslations
    ) {
      const translatedTitle =
        translation
          .data
          ?.title
          ?.trim();

      if (
        !translatedTitle
      ) {
        continue;
      }

      let label =
        translation
          .english_name ||
        translation
          .name ||
        translation
          .iso_639_1
          .toUpperCase();

      if (
        translation
          .iso_639_1 ===
        'fr'
      ) {
        label =
          'Français';
      }

      if (
        translation
          .iso_639_1 ===
        'en'
      ) {
        label =
          'Anglais';
      }

      addOption({
        title:
          translatedTitle,

        language:
          translation
            .iso_639_1,

        country:
          translation
            .iso_3166_1,

        label,

        kind:
          'translation',
      });
    }


    if (
      movie.originalTitle
    ) {
      addOption({
        title:
          movie.originalTitle,

        language:
          null,

        country:
          null,

        label:
          'Titre original',

        kind:
          'original',
      });
    }


    if (
      movie.tmdbTitle
    ) {
      addOption({
        title:
          movie.tmdbTitle,

        language:
          null,

        country:
          null,

        label:
          'TMDb',

        kind:
          'translation',
      });
    }


    if (
      movie.title
    ) {
      addOption({
        title:
          movie.title,

        language:
          null,

        country:
          null,

        label:
          'Titre importé',

        kind:
          'imported',
      });
    }

    return options;
  }


  async function openTitlePicker(
    movie:
      SavedMovie
  ) {
    if (
      !movie.tmdbId
    ) {
      return;
    }

    setSelectedTitleMovie(
      movie
    );

    setTitleOptions(
      []
    );

    setTitleLoading(
      true
    );

    setTitleMessage(
      ''
    );

    setTitleFilter(
      'all'
    );

    try {
      const options =
        await fetchTmdbTitleOptions(
          movie
        );

      setTitleOptions(
        options
      );

      if (
        options.some(
          (
            option
          ) =>
            getTitleOptionCategory(
              option
            ) ===
            'fr'
        )
      ) {
        setTitleFilter(
          'fr'
        );
      }

      if (
        options.length ===
        0
      ) {
        setTitleMessage(
          'Aucun autre titre disponible sur TMDb.'
        );
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setTitleMessage(
        'Impossible de récupérer les différents titres TMDb.'
      );
    } finally {
      setTitleLoading(
        false
      );
    }
  }

  // The title picker is kept for compatibility with existing data/UI code.
  // Reading the function here prevents TypeScript's noUnusedLocals build error
  // while leaving current behaviour unchanged.
  void openTitlePicker;


  function closeTitlePicker() {
    setSelectedTitleMovie(
      null
    );

    setTitleOptions(
      []
    );

    setTitleMessage(
      ''
    );

    setSavingTitleValue(
      null
    );
  }


  async function chooseTitle(
    option:
      TitleOption
  ) {
    if (
      !user ||
      !selectedTitleMovie
    ) {
      return;
    }

    try {
      setSavingTitleValue(
        option.title
      );

      await updateMovieEverywhere(
        selectedTitleMovie,
        {
          customTitle:
            option.title,

          customTitleLanguage:
            option.language,

          customTitleUpdatedAt:
            serverTimestamp(),
        }
      );

      closeTitlePicker();
    } catch (
      error
    ) {
      console.error(
        error
      );

      setTitleMessage(
        "Impossible d'enregistrer ce titre."
      );
    } finally {
      setSavingTitleValue(
        null
      );
    }
  }


  async function resetTitleChoice() {
    if (
      !user ||
      !selectedTitleMovie
    ) {
      return;
    }

    try {
      await updateMovieEverywhere(
        selectedTitleMovie,
        {
          customTitle:
            null,

          customTitleLanguage:
            null,

          customTitleUpdatedAt:
            serverTimestamp(),
        }
      );

      closeTitlePicker();
    } catch (
      error
    ) {
      console.error(
        error
      );

      setTitleMessage(
        'Impossible de restaurer le titre automatique.'
      );
    }
  }


  async function fetchTmdbPosters(
    tmdbId:
      number,
    mediaType: 'movie' | 'tv' = 'movie'
  ): Promise<
    TmdbPoster[]
  > {
    if (
      !apiKey
    ) {
      return [];
    }

    const cacheKey =
      `${mediaType}:${tmdbId}`;

    const cached =
      tmdbPostersCacheRef.current.get(
        cacheKey
      );

    if (cached) {
      return cached;
    }

    const request =
      (async () => {
        const response =
          await fetch(
            `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/images?api_key=${apiKey}`
          );

        if (!response.ok) {
          throw new Error(
            'Erreur images TMDb'
          );
        }

        const data =
          await response.json();

        const posters:
          TmdbPoster[] =
          Array.isArray(
            data.posters
          )
            ? data.posters
            : [];

        return sortPosters(
          posters
        );
      })();

    tmdbPostersCacheRef.current.set(
      cacheKey,
      request
    );

    try {
      return await request;
    } catch (error) {
      /* Un 429 / souci réseau temporaire doit pouvoir être retenté. */
      tmdbPostersCacheRef.current.delete(
        cacheKey
      );
      throw error;
    }
  }


  async function getPreferredPosterPath(
    tmdbId:
      number,

    fallback:
      | string
      | null
      | undefined,
    mediaType: 'movie' | 'tv' = 'movie'
  ) {
    try {
      const posters =
        await fetchTmdbPosters(
          tmdbId,
          mediaType
        );

      const french =
        posters.filter(
          (
            poster
          ) =>
            poster
              .iso_639_1 ===
            'fr'
        );

      if (
        french.length >
        0
      ) {
        return french[0]
          .file_path;
      }

      const textless =
        posters.filter(
          (
            poster
          ) =>
            poster
              .iso_639_1 ===
            null
        );

      if (
        textless.length >
        0
      ) {
        return textless[0]
          .file_path;
      }

      return (
        fallback ||
        posters[0]
          ?.file_path ||
        null
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      return (
        fallback ||
        null
      );
    }
  }


  function getMoviePosterPath(
    movie:
      SavedMovie
  ) {
    return (
      movie.customPosterPath ||
      movie.posterPath ||
      null
    );
  }


  async function openPosterPicker(
    movie:
      SavedMovie,

    scope:
      'movie' | 'soundtrack' =
      'movie',

    tmdbIdOverride?: number,
    mediaTypeOverride?: 'movie' | 'tv'
  ) {
    const posterTmdbId = tmdbIdOverride || movie.tmdbId;
    const posterMediaType = mediaTypeOverride || movie.tmdbMediaType || 'movie';

    if (
      !posterTmdbId
    ) {
      return;
    }

    setSelectedPosterMovie(
      movie
    );

    setPosterPickerScope(
      scope
    );

    setPosterOptions(
      []
    );

    setPosterLoading(
      true
    );

    setPosterMessage(
      ''
    );

    setPosterFilter(
      'all'
    );

    try {
      const posters =
        await fetchTmdbPosters(
          posterTmdbId,
          posterMediaType
        );

      setPosterOptions(
        posters.slice(
          0,
          80
        )
      );

      if (
        posters.some(
          (
            poster
          ) =>
            poster
              .iso_639_1 ===
            'fr'
        )
      ) {
        setPosterFilter(
          'fr'
        );
      }

      if (
        posters.length ===
        0
      ) {
        setPosterMessage(
          'Aucune autre affiche disponible sur TMDb.'
        );
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setPosterMessage(
        'Impossible de récupérer les affiches TMDb.'
      );
    } finally {
      setPosterLoading(
        false
      );
    }
  }


  function closePosterPicker() {
    setSelectedPosterMovie(
      null
    );

    setPosterOptions(
      []
    );

    setPosterMessage(
      ''
    );

    setSavingPosterPath(
      null
    );

    setPosterPickerScope(
      'movie'
    );
  }


  async function choosePoster(
    poster:
      TmdbPoster
  ) {
    if (
      !user ||
      !selectedPosterMovie
    ) {
      return;
    }

    try {
      setSavingPosterPath(
        poster.file_path
      );

      const historyBefore =
        posterPickerScope ===
        'soundtrack'
          ? snapshotMovieIds([
              getSoundtrackCarrier(
                selectedPosterMovie
              ).docId,
            ])
          : snapshotMovieIds(
              getLinkedMovies(
                selectedPosterMovie
              ).map(
                (movie) => movie.docId
              )
            );

      if (
        posterPickerScope ===
        'soundtrack'
      ) {
        const carrier =
          getSoundtrackCarrier(
            selectedPosterMovie
          );

        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            carrier.docId
          );

        await setDoc(
          movieRef,
          {
            soundtrackIndependent:
              true,
            soundtrackCoverPath:
              poster.file_path,
            soundtrackCoverUrl:
              null,
            soundtrackCoverUpdatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );
      } else {
        await updateMovieEverywhere(
          selectedPosterMovie,
          {
            customPosterPath:
              poster.file_path,

            customPosterUrl:
              null,

            customPosterLanguage:
              poster.iso_639_1,

            customPosterUpdatedAt:
              serverTimestamp(),
          }
        );

        /* Mise à jour immédiate de l'affiche dans le menu film resté ouvert. */
        if (
          selectedMovieMenu &&
          getLinkedMovies(selectedMovieMenu).some(
            (linkedMovie) => linkedMovie.docId === selectedPosterMovie.docId
          )
        ) {
          setSelectedMovieMenu({
            ...selectedMovieMenu,
            customPosterPath: poster.file_path,
            customPosterUrl: null,
            customPosterLanguage: poster.iso_639_1,
          });
        }
      }

      addHistoryEntry(
        posterPickerScope === 'soundtrack'
          ? `Pochette BO modifiée : ${getMovieDisplayTitle(selectedPosterMovie)}`
          : `Affiche modifiée : ${getMovieDisplayTitle(selectedPosterMovie)}`,
        historyBefore
      );

      closePosterPicker();
    } catch (
      error
    ) {
      console.error(
        error
      );

      setPosterMessage(
        "Impossible d'enregistrer cette affiche."
      );
    } finally {
      setSavingPosterPath(
        null
      );
    }
  }


  async function resetPosterChoice() {
    if (
      !user ||
      !selectedPosterMovie
    ) {
      return;
    }

    try {
      const historyBefore =
        posterPickerScope ===
        'soundtrack'
          ? snapshotMovieIds([
              getSoundtrackCarrier(
                selectedPosterMovie
              ).docId,
            ])
          : snapshotMovieIds(
              getLinkedMovies(
                selectedPosterMovie
              ).map(
                (movie) => movie.docId
              )
            );

      if (
        posterPickerScope ===
        'soundtrack'
      ) {
        const carrier =
          getSoundtrackCarrier(
            selectedPosterMovie
          );

        const movieRef =
          doc(
            db,
            'users',
            user.uid,
            'movies',
            carrier.docId
          );

        await setDoc(
          movieRef,
          {
            soundtrackCoverPath:
              carrier.posterPath ||
              null,
            soundtrackCoverUrl:
              null,
            soundtrackIndependent:
              true,
            soundtrackCoverUpdatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );
      } else {
        await updateMovieEverywhere(
          selectedPosterMovie,
          {
            customPosterPath:
              null,

            customPosterUrl:
              null,

            customPosterLanguage:
              null,

            customPosterUpdatedAt:
              serverTimestamp(),
          }
        );

        if (
          selectedMovieMenu &&
          getLinkedMovies(selectedMovieMenu).some(
            (linkedMovie) => linkedMovie.docId === selectedPosterMovie.docId
          )
        ) {
          setSelectedMovieMenu({
            ...selectedMovieMenu,
            customPosterPath: null,
            customPosterUrl: null,
            customPosterLanguage: null,
          });
        }
      }

      addHistoryEntry(
        posterPickerScope === 'soundtrack'
          ? `Pochette BO restaurée : ${getMovieDisplayTitle(selectedPosterMovie)}`
          : `Affiche restaurée : ${getMovieDisplayTitle(selectedPosterMovie)}`,
        historyBefore
      );

      closePosterPicker();
    } catch (
      error
    ) {
      console.error(
        error
      );

      setPosterMessage(
        "Impossible de restaurer l'affiche automatique."
      );
    }
  }


  async function searchMovies(
    event:
      FormEvent
  ) {
    event.preventDefault();

    const rawQuery =
      query.trim();

    if (
      !rawQuery
    ) {
      return;
    }

    if (
      !apiKey
    ) {
      setMessage(
        "La clé TMDb n'est pas configurée."
      );

      return;
    }

    setLoading(
      true
    );

    setMessage(
      ''
    );

    try {
      const imdbId =
        extractImdbId(
          rawQuery
        );

      let results:
        TmdbMovie[] = [];

      if (imdbId) {
        const response =
          await fetch(
            `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&language=fr-FR&external_source=imdb_id`
          );

        if (
          !response.ok
        ) {
          throw new Error(
            'Erreur TMDb'
          );
        }

        const data =
          await response.json();

        results =
          (data.movie_results || []).map(
            (item: any) => ({
              id: item.id,
              title:
                item.title ||
                '',
              original_title:
                item.original_title ||
                '',
              release_date:
                item.release_date ||
                '',
              poster_path:
                item.poster_path ||
                null,
              backdrop_path:
                item.backdrop_path ||
                null,
              overview:
                item.overview ||
                '',
            })
          );
      } else {
        const response =
          await fetch(
            `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&language=fr-FR&query=${encodeURIComponent(
              rawQuery
            )}`
          );

        if (
          !response.ok
        ) {
          throw new Error(
            'Erreur TMDb'
          );
        }

        const data =
          await response
            .json();

        results =
          data.results ||
          [];
      }

      setSearchResults(
        results
      );

      if (
        !results.length
      ) {
        setMessage(
          imdbId
            ? `Aucun film trouvé pour ${imdbId}.`
            : 'Aucun film trouvé.'
        );
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        'Erreur pendant la recherche.'
      );
    } finally {
      setLoading(
        false
      );
    }
  }


  function movieIsSaved(
    movie:
      TmdbMovie
  ) {
    return Boolean(
      findExistingMovieForTmdb(
        movie
      )
    );
  }


  async function addMovie(
    movie:
      TmdbMovie
  ) {
    if (
      !user
    ) {
      return;
    }

    try {
      setAddingMovie(
        movie.id
      );

      const preferredPoster =
        await getPreferredPosterPath(
          movie.id,
          movie.poster_path
        );

      const preferredTitle =
        await getPreferredFrenchTitle(
          movie.id,
          movie.title
        );

      const existing =
        findExistingMovieForTmdb(
          movie
        );

      const documentId =
        existing?.docId ||
        `tmdb_${movie.id}`;

      const movieRef =
        doc(
          db,
          'users',
          user.uid,
          'movies',
          documentId
        );

      const historyBefore =
        snapshotMovieIds([
          documentId,
        ]);

      const payload:
        Record<
          string,
          unknown
        > = {
        tmdbId:
          movie.id,

        localizedTitle:
          preferredTitle,

        tmdbTitle:
          movie.title,

        originalTitle:
          movie.original_title ||
          null,

        releaseDate:
          movie.release_date ||
          null,

        year:
          movie.release_date
            ? movie.release_date
                .substring(
                  0,
                  4
                )
            : existing?.year ||
              null,

        posterPath:
          preferredPoster,

        backdropPath:
          movie.backdrop_path ||
          null,

        overview:
          movie.overview ||
          '',

        tmdbMatchStatus:
          'matched',

        tmdbMatchedAt:
          serverTimestamp(),
      };

      if (
        !existing
      ) {
        Object.assign(
          payload,
          {
            title:
              movie.title,
            rating:
              null,
            review:
              '',
            favorite:
              false,
            liked:
              false,
            watched:
              false,
            watchlist:
              false,
            rankings:
              {},
            diary:
              [],
            addedAt:
              serverTimestamp(),
          }
        );
      }

      await setDoc(
        movieRef,
        payload,
        {
          merge: true,
        }
      );

      addHistoryEntry(
        `Ajout film : ${movie.title}`,
        historyBefore
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        "Impossible d'ajouter le film."
      );
    } finally {
      setAddingMovie(
        null
      );
    }
  }


  async function importLetterboxd(
    event:
      ChangeEvent<
        HTMLInputElement
      >
  ) {
    const file =
      event.target
        .files?.[0];

    if (
      !file ||
      !user
    ) {
      return;
    }

    try {
      setImporting(
        true
      );

      setMessage(
        ''
      );

      setImportProgress(
        'Lecture du fichier...'
      );

      const text =
        await file.text();

      const data =
        JSON.parse(
          text
        ) as
        LetterboxdImport;

      if (
        !data.movies ||
        !Array.isArray(
          data.movies
        )
      ) {
        throw new Error(
          'Format incorrect'
        );
      }

      const movies =
        data.movies;

      const historyBefore =
        snapshotFullHistory([
          'movies',
        ]);

      const chunkSize =
        350;

      for (
        let start = 0;
        start <
        movies.length;
        start +=
          chunkSize
      ) {
        const batch =
          writeBatch(
            db
          );

        const chunk =
          movies.slice(
            start,
            start +
              chunkSize
          );

        for (
          const movie
          of chunk
        ) {
          const cleanImportedTitle =
            sanitizeMovieTitle(
              movie.title,
              movie.year
            );

          const normalizedTitle =
            normalizeMovieTitle(
              cleanImportedTitle,
              movie.year
            );

          const letterboxdUri =
            (movie.letterboxdFilmUri || '')
              .trim();

          let existing =
            letterboxdUri
              ? savedMovies.find(
                  (saved) =>
                    (saved.letterboxdFilmUri || '').trim() ===
                    letterboxdUri
                )
              : undefined;

          if (!existing) {
            const titleCandidates =
              savedMovies.filter(
                (saved) =>
                  getMovieIdentityTitles(
                    saved
                  ).has(
                    normalizedTitle
                  )
              );

            if (movie.year != null) {
              const exactYearCandidates =
                titleCandidates.filter(
                  (saved) =>
                    String(saved.year || '') ===
                    String(movie.year)
                );

              if (exactYearCandidates.length === 1) {
                existing = exactYearCandidates[0];
              }
            } else if (titleCandidates.length === 1) {
              existing = titleCandidates[0];
            }
          }

          const identity =
            `${cleanImportedTitle}|${movie.year || ''}|${movie.letterboxdFilmUri || ''}`;

          const documentId =
            existing?.docId ||
            `lb_${hashString(
              identity
            )}`;

          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              documentId
            );

          const payload:
            Record<
              string,
              unknown
            > = {
            title:
              existing?.title ||
              cleanImportedTitle,

            letterboxdFilmUri:
              movie.letterboxdFilmUri ??
              existing?.letterboxdFilmUri ??
              null,

            watched:
              movie.watched ??
              false,

            watchedAddedDate:
              movie.watchedAddedDate ??
              null,

            rating:
              movie.rating ??
              null,

            ratingDate:
              movie.ratingDate ??
              null,

            liked:
              movie.liked ??
              false,

            likedDate:
              movie.likedDate ??
              null,

            watchlist:
              movie.watchlist ??
              false,

            watchlistDate:
              movie.watchlistDate ??
              null,

            favoriteProfileFilm:
              movie.favoriteProfileFilm ??
              false,

            review:
              movie.review ??
              null,

            reviewDate:
              movie.reviewDate ??
              null,

            diary:
              (movie.diary ?? []).map((entry, index) => ({
                ...entry,
                source:
                  entry.source ||
                  'letterboxd',
                insertedAt:
                  entry.insertedAt ||
                  `${entry.watchedDate || entry.entryDate || movie.watchedAddedDate || '1970-01-01'}T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
              })),

            importedFromLetterboxd:
              true,

            importedAt:
              serverTimestamp(),
          };

          if (movie.year != null) {
            payload.year =
              movie.year;
          } else if (!existing) {
            payload.year =
              null;
          }

          if (!existing) {
            payload.addedAt =
              serverTimestamp();
            payload.rankings = {
              ...(movie.rankings || {}),
            };

            batch.set(
              movieRef,
              payload,
              {
                merge: true,
              }
            );
          } else {
            for (const [rankingKey, rankingValue] of Object.entries(
              movie.rankings || {}
            )) {
              payload[`rankings.${rankingKey}`] =
                rankingValue;
            }

            batch.update(
              movieRef,
              payload
            );
          }
        }

        await batch
          .commit();

        const imported =
          Math.min(
            start +
              chunkSize,
            movies.length
          );

        setImportProgress(
          `${imported} / ${movies.length} films importés`
        );
      }

      setImportProgress(
        `Import terminé : ${movies.length} films`
      );

      addHistoryEntry(
        `Import Letterboxd : ${file.name}`,
        historyBefore,
        ['movies']
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        "L'import Letterboxd a échoué."
      );

      setImportProgress(
        ''
      );
    } finally {
      setImporting(
        false
      );

      event.target.value =
        '';
    }
  }


  async function importLetterboxdCsv(
    event:
      ChangeEvent<
        HTMLInputElement
      >
  ) {
    const files =
      Array.from(
        event.target
          .files ||
          []
      );

    if (
      files.length === 0 ||
      !user
    ) {
      return;
    }

    try {
      setImporting(
        true
      );

      setMessage(
        ''
      );

      setImportProgress(
        'Lecture CSV Letterboxd...'
      );

      const parsedRows:
        LetterboxdCsvMovie[] = [];

      for (
        const file
        of files
      ) {
        const text =
          await file.text();

        parsedRows.push(
          ...parseLetterboxdCsv(
            text,
            file.name
          )
        );
      }

      if (
        parsedRows.length === 0
      ) {
        throw new Error(
          'Aucune ligne Letterboxd reconnue.'
        );
      }

      const historyBefore =
        snapshotFullHistory([
          'movies',
        ]);

      type LetterboxdCsvGroup = {
        title: string;
        year:
          number | null;
        letterboxdFilmUri:
          string | null;
        watched:
          boolean;
        watchedDate:
          string | null;
        watchlist:
          boolean;
        watchlistDate:
          string | null;
        rating:
          number | null;
        ratingDate:
          string | null;
        review:
          string | null;
        reviewDate:
          string | null;
        diary:
          DiaryEntry[];
      };

      const groups =
        new Map<
          string,
          LetterboxdCsvGroup
        >();

      for (
        const row
        of parsedRows
      ) {
        const key =
          `${normalizeMovieTitle(
            row.title,
            row.year
          )}|${String(
            row.year ||
            ''
          )}`;

        const group =
          groups.get(
            key
          ) || {
            title:
              row.title,
            year:
              row.year ??
              null,
            letterboxdFilmUri:
              row.letterboxdFilmUri ??
              null,
            watched:
              false,
            watchedDate:
              null,
            watchlist:
              false,
            watchlistDate:
              null,
            rating:
              null,
            ratingDate:
              null,
            review:
              null,
            reviewDate:
              null,
            diary:
              [],
          };

        if (
          !group.letterboxdFilmUri &&
          row.letterboxdFilmUri
        ) {
          group.letterboxdFilmUri =
            row.letterboxdFilmUri;
        }

        if (
          row.kind ===
            'watchlist'
        ) {
          group.watchlist =
            true;
          group.watchlistDate =
            row.date ||
            group.watchlistDate;
        }

        if (
          row.kind ===
            'watched'
        ) {
          group.watched =
            true;
          group.watchedDate =
            row.date ||
            group.watchedDate;
        }

        if (
          row.kind ===
            'ratings'
        ) {
          if (
            row.rating !=
            null
          ) {
            group.rating =
              row.rating;
            group.ratingDate =
              row.date ||
              group.ratingDate;
          }
        }

        if (
          row.kind ===
            'diary' ||
          row.kind ===
            'reviews'
        ) {
          const watchedDate =
            row.watchedDate ||
            row.date;

          if (
            watchedDate
          ) {
            group.watched =
              true;
            group.watchedDate =
              watchedDate;

            group.diary.push({
              watchedDate,
              entryDate:
                row.date ||
                watchedDate,
              rating:
                row.rating ??
                null,
              rewatch:
                row.rewatch ??
                false,
              tags: [],
              letterboxdEntryUri:
                null,
              insertedAt:
                `${watchedDate}T00:00:00.000Z`,
              source:
                'letterboxd',
            });
          }

          if (
            row.rating !=
            null
          ) {
            group.rating =
              row.rating;
            group.ratingDate =
              row.date ||
              watchedDate ||
              group.ratingDate;
          }

          if (
            row.kind ===
              'reviews' &&
            row.review?.trim()
          ) {
            group.review =
              row.review.trim();
            group.reviewDate =
              row.date ||
              watchedDate ||
              group.reviewDate;
          }
        }

        groups.set(
          key,
          group
        );
      }

      const writes:
        Array<{
          documentId: string;
          payload:
            Record<
              string,
              unknown
            >;
        }> = [];

      let diaryAdded =
        0;

      let createdMovies =
        0;

      for (
        const [
          key,
          group,
        ]
        of groups
      ) {
        let existing =
          group.letterboxdFilmUri
            ? savedMovies.find(
                (saved) =>
                  (
                    saved.letterboxdFilmUri ||
                    ''
                  ).trim() ===
                  group.letterboxdFilmUri
              )
            : undefined;

        if (
          !existing
        ) {
          const titleCandidates =
            savedMovies.filter(
              (saved) =>
                getMovieIdentityTitles(
                  saved
                ).has(
                  normalizeMovieTitle(
                    group.title,
                    group.year
                  )
                )
            );

          if (
            group.year !=
            null
          ) {
            const exactYearCandidates =
              titleCandidates.filter(
                (saved) =>
                  String(
                    saved.year ||
                    ''
                  ) ===
                  String(
                    group.year
                  )
              );

            if (
              exactYearCandidates.length ===
              1
            ) {
              existing =
                exactYearCandidates[0];
            }
          } else if (
            titleCandidates.length ===
            1
          ) {
            existing =
              titleCandidates[0];
          }
        }

        const existingDiary =
          existing?.diary ||
          [];

        const knownDiary =
          new Set(
            existingDiary.map(
              (entry) =>
                `${entry.watchedDate || entry.entryDate || ''}|${entry.rating ?? ''}|${entry.rewatch ? '1' : '0'}`
            )
          );

        const newDiary:
          DiaryEntry[] = [];

        for (
          const entry
          of group.diary
        ) {
          const signature =
            `${entry.watchedDate || entry.entryDate || ''}|${entry.rating ?? ''}|${entry.rewatch ? '1' : '0'}`;

          if (
            knownDiary.has(
              signature
            )
          ) {
            continue;
          }

          knownDiary.add(
            signature
          );
          newDiary.push(
            entry
          );
          diaryAdded++;
        }

        const documentId =
          existing?.docId ||
          `lb_csv_${hashString(
            key
          )}`;

        const payload:
          Record<
            string,
            unknown
          > = {
          title:
            existing?.title ||
            group.title,
          importedFromLetterboxd:
            true,
          importedAt:
            serverTimestamp(),
        };

        if (
          group.letterboxdFilmUri
        ) {
          payload.letterboxdFilmUri =
            group.letterboxdFilmUri;
        }

        if (
          group.watched
        ) {
          payload.watched =
            true;

          if (
            group.watchedDate
          ) {
            payload.watchedAddedDate =
              group.watchedDate;
          }
        }

        if (
          group.watchlist
        ) {
          payload.watchlist =
            true;

          if (
            group.watchlistDate
          ) {
            payload.watchlistDate =
              group.watchlistDate;
          }
        }

        if (
          group.rating !=
          null
        ) {
          payload.rating =
            group.rating;

          if (
            group.ratingDate
          ) {
            payload.ratingDate =
              group.ratingDate;
          }
        }

        if (
          group.review !=
          null
        ) {
          payload.review =
            group.review;

          if (
            group.reviewDate
          ) {
            payload.reviewDate =
              group.reviewDate;
          }
        }

        if (
          newDiary.length > 0
        ) {
          payload.diary = [
            ...existingDiary,
            ...newDiary,
          ];
          payload.watched =
            true;
        }

        if (
          !existing
        ) {
          createdMovies++;

          payload.year =
            group.year;
          payload.watched =
            group.watched;
          payload.watchlist =
            group.watchlist;
          payload.favorite =
            false;
          payload.liked =
            false;
          payload.rankings =
            {};
          payload.addedAt =
            serverTimestamp();
        }

        writes.push({
          documentId,
          payload,
        });
      }

      const chunkSize =
        350;

      for (
        let start = 0;
        start < writes.length;
        start +=
          chunkSize
      ) {
        const batch =
          writeBatch(
            db
          );

        const chunk =
          writes.slice(
            start,
            start +
              chunkSize
          );

        for (
          const write
          of chunk
        ) {
          batch.set(
            doc(
              db,
              'users',
              user.uid,
              'movies',
              write.documentId
            ),
            write.payload,
            {
              merge: true,
            }
          );
        }

        await batch.commit();

        setImportProgress(
          `${Math.min(
            start +
              chunkSize,
            writes.length
          )} / ${writes.length} films importés...`
        );
      }

      setImportProgress(
        `Import CSV Letterboxd terminé : ${writes.length} films, ${diaryAdded} visionnages, ${createdMovies} nouvelles fiches.`
      );

      addHistoryEntry(
        `Import CSV Letterboxd : ${files.map((file) => file.name).join(', ')}`,
        historyBefore,
        ['movies']
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        "L'import CSV Letterboxd a échoué."
      );

      setImportProgress(
        ''
      );
    } finally {
      setImporting(
        false
      );

      event.target.value =
        '';
    }
  }


  async function importUcpm(
    event:
      ChangeEvent<
        HTMLInputElement
      >
  ) {
    const file =
      event.target
        .files?.[0];

    if (
      !file ||
      !user
    ) {
      return;
    }

    try {
      setUcpmImporting(
        true
      );

      setMessage(
        ''
      );

      setUcpmImportProgress(
        'Lecture du fichier UCPM...'
      );

      const text =
        await file.text();

      const movies =
        parseUcpmCsv(
          text
        );

      if (
        movies.length ===
        0
      ) {
        throw new Error(
          'Aucun film trouvé'
        );
      }

      const historyBefore =
        snapshotFullHistory([
          'movies',
        ]);

      setUcpmImportProgress(
        `${movies.length} films détectés. Import en cours...`
      );

      const chunkSize =
        350;

      for (
        let start = 0;
        start <
        movies.length;
        start +=
          chunkSize
      ) {
        const batch =
          writeBatch(
            db
          );

        const chunk =
          movies.slice(
            start,
            start +
              chunkSize
          );

        for (
          const movie
          of chunk
        ) {
          const normalized =
            normalizeMovieTitle(
              movie.title,
              movie.year
            );

          const candidates =
            savedMovies.filter(
              (saved) =>
                getMovieIdentityTitles(
                  saved
                ).has(
                  normalized
                )
            );

          let existing:
            | SavedMovie
            | undefined;

          if (
            movie.year
          ) {
            existing =
              candidates
                .find(
                  (
                    saved
                  ) =>
                    String(
                      saved.year ||
                      ''
                    ) ===
                    String(
                      movie.year
                    )
                );
          }

          if (
            !existing &&
            candidates.length ===
              1
          ) {
            existing =
              candidates[0];
          }

          const documentId =
            existing
              ? existing.docId
              : `ucpm_${movie.position}_${hashString(
                  `${movie.title}|${movie.year || ''}`
                )}`;

          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              documentId
            );

          const payload:
            Record<
              string,
              unknown
            > = {
            title:
              existing?.title ||
              movie.title,

            ucpm:
              true,

            ucpmPosition:
              movie.position,

            importedFromUcpm:
              true,

            ucpmImportedAt:
              serverTimestamp(),
          };

          if (movie.imdb) {
            /* Un CSV sans IMDb ne doit jamais effacer un identifiant
               déjà connu sur une fiche existante. */
            payload.ucpmImdbId =
              movie.imdb;
          }

          if (!existing) {
            payload.addedAt =
              serverTimestamp();

            if (movie.year) {
              payload.year =
                movie.year;
            }
          }

          batch.set(
            movieRef,
            payload,
            {
              merge: true,
            }
          );
        }

        await batch
          .commit();

        const imported =
          Math.min(
            start +
              chunkSize,
            movies.length
          );

        setUcpmImportProgress(
          `${imported} / ${movies.length} films UCPM importés`
        );
      }

      setUcpmImportProgress(
        `Import UCPM terminé : ${movies.length} films`
      );

      addHistoryEntry(
        `Import UCPM : ${file.name}`,
        historyBefore,
        ['movies']
      );

      setPage(
        'ucpm'
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        "L'import UCPM a échoué."
      );

      setUcpmImportProgress(
        ''
      );
    } finally {
      setUcpmImporting(
        false
      );

      event.target.value =
        '';
    }
  }


  async function importJellyfinCsv(
    event:
      ChangeEvent<
        HTMLInputElement
      >
  ) {
    const file =
      event.target.files?.[0];

    if (!file || !user) {
      return;
    }

    try {
      setJellyfinImporting(true);
      setMessage('');
      setJellyfinImportProgress('Lecture de la liste Jellyfin...');

      const text =
        await file.text();

      const movies =
        parseJellyfinCsv(text);

      if (movies.length === 0) {
        throw new Error('Aucun film trouvé dans le fichier Jellyfin.');
      }

      const historyBefore =
        snapshotFullHistory([
          'movies',
        ]);

      setJellyfinImportProgress(
        `${movies.length} films détectés. Synchronisation...`
      );

      const importedDocIds =
        new Set<string>();

      const chunkSize = 300;

      for (let start = 0; start < movies.length; start += chunkSize) {
        const batch =
          writeBatch(db);

        const chunk =
          movies.slice(start, start + chunkSize);

        for (const movie of chunk) {
          let existing: SavedMovie | undefined;

          if (movie.tmdbId) {
            existing =
              savedMovies.find((saved) => saved.tmdbId === movie.tmdbId);
          }

          if (!existing && movie.imdb) {
            existing =
              savedMovies.find(
                (saved) =>
                  saved.imdbId === movie.imdb ||
                  saved.ucpmImdbId === movie.imdb
              );
          }

          if (!existing) {
            const normalized =
              normalizeMovieTitle(
                movie.title,
                movie.year
              );

            const candidates =
              savedMovies.filter(
                (saved) =>
                  normalizeMovieTitle(saved.title, saved.year) === normalized ||
                  normalizeMovieTitle(saved.localizedTitle || '', saved.year) === normalized ||
                  normalizeMovieTitle(saved.originalTitle || '', saved.year) === normalized ||
                  normalizeMovieTitle(saved.tmdbTitle || '', saved.year) === normalized
              );

            if (movie.year) {
              existing =
                candidates.find(
                  (saved) => String(saved.year || '') === String(movie.year)
                );
            }

            if (!existing && candidates.length === 1) {
              existing = candidates[0];
            }
          }

          const documentId =
            existing
              ? existing.docId
              : `jellyfin_${hashString(
                  `${movie.tmdbId || ''}|${movie.imdb || ''}|${movie.title}|${movie.year || ''}`
                )}`;

          importedDocIds.add(documentId);

          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              documentId
            );

          const jellyfinRanking = {
            listName: 'MOVIE DATABASE',
            position: movie.position,
          };

          const payload: Record<string, unknown> = {
            title: existing?.title || movie.title,
            importedFromJellyfin: true,
            jellyfinImportedAt: serverTimestamp(),
          };

          if (!existing) {
            /* Date de création réelle de la fiche : utilisée par le tri
               Ajout + et par la fenêtre Derniers films ajoutés. */
            payload.addedAt = serverTimestamp();

            if (movie.year) {
              payload.year = movie.year;
            }
          }

          if (movie.imdb) {
            payload.imdbId = movie.imdb;
          }

          if (movie.tmdbId) {
            payload.tmdbId = movie.tmdbId;
            payload.tmdbMediaType = 'movie';
          }

          if (movie.sourceFile) {
            const normalizedSourcePath =
              String(movie.sourceFile)
                .replace(/^file:\/\//i, '')
                .trim();

            const sourceParts =
              normalizedSourcePath
                .split(/[\\/]+/)
                .filter(Boolean);

            payload.jellyfinSourcePath =
              normalizedSourcePath;
            payload.jellyfinSourceFile =
              sourceParts[sourceParts.length - 1] ||
              normalizedSourcePath;
          }

          if (existing) {
            payload['rankings.jellyfin'] =
              jellyfinRanking;

            /* Ne pas réinitialiser la date à chaque synchro CSV : elle
               correspond au moment où le film est réellement entré dans
               Movie Database. */
            if (!existing.rankings?.jellyfin) {
              payload.jellyfinAddedAt =
                serverTimestamp();
            }

            batch.update(
              movieRef,
              payload
            );
          } else {
            payload.rankings = {
              jellyfin:
                jellyfinRanking,
            };
            payload.jellyfinAddedAt =
              serverTimestamp();

            batch.set(
              movieRef,
              payload,
              { merge: true }
            );
          }
        }

        await batch.commit();

        const imported =
          Math.min(start + chunkSize, movies.length);

        setJellyfinImportProgress(
          `${imported} / ${movies.length} films Jellyfin synchronisés`
        );
      }

      const obsolete =
        savedMovies.filter(
          (movie) =>
            Boolean(movie.rankings?.jellyfin) &&
            !importedDocIds.has(movie.docId)
        );

      for (let start = 0; start < obsolete.length; start += chunkSize) {
        const batch =
          writeBatch(db);

        for (const movie of obsolete.slice(start, start + chunkSize)) {
          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              movie.docId
            );

          batch.update(
            movieRef,
            {
              'rankings.jellyfin': deleteField(),
            }
          );
        }

        await batch.commit();
      }

      setJellyfinImportProgress(
        `Mise à jour Jellyfin terminée : ${movies.length} films${
          obsolete.length > 0
            ? ` · ${obsolete.length} retirés de l’ancienne liste`
            : ''
        }.`
      );

      addHistoryEntry(
        `Import Movie Database : ${file.name}`,
        historyBefore,
        ['movies']
      );

      /* Après une synchro Movie Database, on montre temporairement les
         derniers éléments de la liste en premier. Une ouverture normale
         de la rubrique reste bien sur Note + par défaut. */
      jellyfinRecentSortAfterImportRef.current = true;
      setPage('jellyfin');
    } catch (error) {
      console.error(error);
      setMessage("La mise à jour Jellyfin a échoué.");
      setJellyfinImportProgress('');
    } finally {
      setJellyfinImporting(false);
      event.target.value = '';
    }
  }


  async function importDiaryCsv(
    event:
      ChangeEvent<
        HTMLInputElement
      >
  ) {
    const file =
      event.target
        .files?.[0];

    if (
      !file ||
      !user
    ) {
      return;
    }

    try {
      setDiaryCsvImporting(
        true
      );

      setMessage(
        ''
      );

      setDiaryCsvImportProgress(
        'Lecture du CSV Diary...'
      );

      const text =
        await file.text();

      const entries =
        parseDiaryCsv(
          text
        );

      if (
        entries.length ===
        0
      ) {
        throw new Error(
          'Aucune entrée Diary valide trouvée.'
        );
      }

      const historyBefore =
        snapshotFullHistory([
          'movies',
        ]);

      const existingByKey =
        new Map<
          string,
          SavedMovie
        >();

      const existingByTitle =
        new Map<
          string,
          SavedMovie[]
        >();

      for (
        const movie
        of savedMovies
      ) {
        const yearKey =
          String(
            movie.year ||
            ''
          );

        const titles =
          [
            movie.title,
            movie.customTitle,
            movie.localizedTitle,
            movie.tmdbTitle,
            movie.originalTitle,
          ]
            .filter(
              (
                value
              ): value is string =>
                Boolean(
                  value &&
                  value.trim()
                )
            );

        for (
          const title
          of titles
        ) {
          const key =
            `${normalizeMovieTitle(
              title,
              yearKey
            )}|${yearKey}`;

          if (
            !existingByKey.has(
              key
            )
          ) {
            existingByKey.set(
              key,
              movie
            );
          }

          const titleKey =
            normalizeMovieTitle(
              title,
              movie.year
            );

          const titleMatches =
            existingByTitle.get(titleKey) || [];

          if (
            !titleMatches.some(
              (item) => item.docId === movie.docId
            )
          ) {
            titleMatches.push(movie);
            existingByTitle.set(titleKey, titleMatches);
          }
        }
      }

      type DiaryImportGroup = {
        existing?:
          SavedMovie;
        title: string;
        year:
          number | null;
        entries:
          DiaryEntry[];
      };

      const groups =
        new Map<
          string,
          DiaryImportGroup
        >();

      for (
        const entry
        of entries
      ) {
        const key =
          `${normalizeMovieTitle(
            entry.title,
            entry.year
          )}|${String(
            entry.year ||
            ''
          )}`;

        let existing =
          existingByKey.get(
            key
          );

        if (
          !existing &&
          !entry.year
        ) {
          const titleCandidates =
            existingByTitle.get(
              normalizeMovieTitle(
                entry.title
              )
            ) || [];

          if (titleCandidates.length === 1) {
            existing = titleCandidates[0];
          }
        }

        const group =
          groups.get(
            key
          ) || {
            existing,
            title:
              entry.title,
            year:
              entry.year ??
              null,
            entries:
              [],
          };

        group.entries.push({
          watchedDate:
            entry.watchedDate,
          entryDate:
            entry.watchedDate,
          rating:
            entry.rating ??
            null,
          rewatch:
            entry.rewatch ??
            false,
          tags:
            [],
          insertedAt:
            `${entry.watchedDate}T00:00:00.000Z`,
          source:
            'diaryCsv',
        });

        groups.set(
          key,
          group
        );
      }

      const writes:
        Array<{
          documentId:
            string;
          payload:
            Record<
              string,
              unknown
            >;
        }> = [];

      let addedEntries =
        0;

      let skippedEntries =
        0;

      let createdMovies =
        0;

      for (
        const [
          key,
          group,
        ]
        of groups
      ) {
        const existingDiary =
          group.existing
            ?.diary ||
          [];

        const knownDates =
          new Set(
            existingDiary
              .map(
                (
                  diaryEntry
                ) =>
                  diaryEntry
                    .watchedDate ||
                  diaryEntry
                    .entryDate ||
                  ''
              )
              .filter(
                Boolean
              )
          );

        const newEntries:
          DiaryEntry[] = [];

        for (
          const diaryEntry
          of group.entries
        ) {
          const date =
            diaryEntry
              .watchedDate ||
            diaryEntry
              .entryDate ||
            '';

          if (
            !date ||
            knownDates.has(
              date
            )
          ) {
            skippedEntries++;

            continue;
          }

          knownDates.add(
            date
          );

          newEntries.push(
            diaryEntry
          );

          addedEntries++;
        }

        if (
          newEntries.length ===
          0
        ) {
          continue;
        }

        const documentId =
          group.existing
            ?.docId ||
          `diary_${hashString(
            key
          )}`;

        const mergedDiary =
          [
            ...existingDiary,
            ...newEntries,
          ];

        const newestImportedRating =
          [...newEntries]
            .sort(
              (
                a,
                b
              ) =>
                (
                  b.watchedDate ||
                  b.entryDate ||
                  ''
                ).localeCompare(
                  a.watchedDate ||
                  a.entryDate ||
                  ''
                )
            )
            .find(
              (
                diaryEntry
              ) =>
                diaryEntry.rating !=
                null
            )
            ?.rating ??
          null;

        const payload:
          Record<
            string,
            unknown
          > = {
          title:
            group.existing
              ?.title ||
            group.title,

          watched:
            true,

          diary:
            mergedDiary,

          importedFromDiaryCsv:
            true,

          diaryCsvImportedAt:
            serverTimestamp(),
        };

        if (
          !group.existing
        ) {
          createdMovies++;

          payload.year =
            group.year;

          payload.rating =
            newestImportedRating;

          payload.review =
            '';

          payload.favorite =
            false;

          payload.liked =
            false;

          payload.watchlist =
            false;

          payload.rankings =
            {};

          payload.addedAt =
            serverTimestamp();
        } else if (
          group.existing.rating ==
            null &&
          newestImportedRating !=
            null
        ) {
          payload.rating =
            newestImportedRating;
        }

        writes.push({
          documentId,
          payload,
        });
      }

      if (
        writes.length ===
        0
      ) {
        setDiaryCsvImportProgress(
          `Aucune nouvelle entrée : ${skippedEntries} doublons déjà présents.`
        );

        setPage(
          'diary'
        );

        return;
      }

      const chunkSize =
        350;

      for (
        let start = 0;
        start <
        writes.length;
        start +=
          chunkSize
      ) {
        const batch =
          writeBatch(
            db
          );

        const chunk =
          writes.slice(
            start,
            start +
              chunkSize
          );

        for (
          const write
          of chunk
        ) {
          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              write.documentId
            );

          batch.set(
            movieRef,
            write.payload,
            {
              merge: true,
            }
          );
        }

        await batch
          .commit();

        setDiaryCsvImportProgress(
          `${Math.min(
            start +
              chunkSize,
            writes.length
          )} / ${writes.length} fiches mises à jour...`
        );
      }

      setDiaryCsvImportProgress(
        `Import Diary terminé : ${addedEntries} visionnages ajoutés, ${skippedEntries} doublons ignorés, ${createdMovies} nouvelles fiches créées.`
      );

      addHistoryEntry(
        `Import VUS / Diary : ${file.name}`,
        historyBefore,
        ['movies']
      );

      setPage(
        'diary'
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        "L'import du Diary CSV a échoué."
      );

      setDiaryCsvImportProgress(
        ''
      );
    } finally {
      setDiaryCsvImporting(
        false
      );

      event.target.value =
        '';
    }
  }


  async function enrichMovies(
    limit?: number
  ) {
    if (
      !user ||
      !apiKey ||
      enriching
    ) {
      return;
    }

    const allPending =
      savedMovies
        .filter(
          (movie) => {
            if (!movie.title) {
              return false;
            }

            const hasPoster = Boolean(
              movie.customPosterUrl ||
              movie.customPosterPath ||
              movie.posterPath
            );

            /* Les boutons 50 / Tout traitent désormais aussi les fiches déjà
               associées à TMDb mais dont l'affiche manque. */
            return (
              (!movie.tmdbId &&
                movie.tmdbMatchStatus !== 'not_found') ||
              (Boolean(movie.tmdbId) && !hasPoster)
            );
          }
        );

    const pending =
      typeof limit ===
      'number'
        ? allPending
            .slice(
              0,
              limit
            )
        : allPending;

    if (
      !pending.length
    ) {
      setEnrichmentMessage(
        'Tous les films disponibles ont déjà été traités et ont une affiche.'
      );

      return;
    }

    const historyBefore =
      snapshotMovieIds(
        pending.map(
          (movie) => movie.docId
        )
      );

    stopRequested.current =
      false;

    setEnriching(
      true
    );

    setEnrichmentMessage(
      ''
    );

    let matched =
      0;

    let unmatched =
      0;

    let errors =
      0;

    let processed =
      0;

    setEnrichmentStats({
      current: 0,
      total:
        pending.length,
      matched: 0,
      unmatched: 0,
      errors: 0,
      currentMovie: '',
    });

    try {
      for (
        const movie
        of pending
      ) {
        if (
          stopRequested.current
        ) {
          break;
        }

        setEnrichmentStats({
          current:
            processed,

          total:
            pending.length,

          matched,
          unmatched,
          errors,

          currentMovie:
            movie.title,
        });

        try {
          const mediaType: 'movie' | 'tv' =
            movie.tmdbMediaType === 'tv'
              ? 'tv'
              : 'movie';

          let match: TmdbMovie | null = null;

          /* Si la fiche possède déjà un ID TMDb mais pas d'affiche, on utilise
             d'abord cet ID exact. Sinon on prend le premier film correspondant
             au titre importé (et à l'année quand elle est disponible). */
          if (movie.tmdbId) {
            const response = await fetch(
              `https://api.themoviedb.org/3/${mediaType}/${movie.tmdbId}?api_key=${apiKey}&language=fr-FR`
            );

            if (response.ok) {
              const raw = await response.json();
              match = {
                id: raw.id,
                title: raw.title || raw.name || movie.title,
                original_title:
                  raw.original_title ||
                  raw.original_name ||
                  '',
                release_date:
                  raw.release_date ||
                  raw.first_air_date ||
                  '',
                poster_path: raw.poster_path || null,
                backdrop_path: raw.backdrop_path || null,
                overview: raw.overview || '',
              };
            }
          }

          if (!match) {
            match =
              await findTmdbMovie(
                apiKey,
                movie.title,
                movie.year
              );
          }

          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              movie.docId
            );

          if (
            match
          ) {
            /* Pour les imports par 50 / Tout, on ne lance plus une seconde
               recherche d'affiche : la première affiche du résultat TMDb est
               appliquée immédiatement. Elle pourra être corrigée ensuite. */
            const firstMatchingPoster =
              match.poster_path ||
              movie.posterPath ||
              null;

            const preferredTitle =
              await getPreferredFrenchTitle(
                match.id,
                match.title,
                mediaType
              );

            await updateDoc(
              movieRef,
              {
                tmdbId:
                  match.id,

                tmdbMediaType:
                  mediaType,

                tmdbTitle:
                  match.title,

                localizedTitle:
                  preferredTitle,

                originalTitle:
                  match.original_title ||
                  null,

                releaseDate:
                  match.release_date ||
                  null,

                year:
                  match.release_date
                    ? match.release_date.substring(0, 4)
                    : movie.year || null,

                posterPath:
                  firstMatchingPoster,

                backdropPath:
                  match.backdrop_path ||
                  null,

                overview:
                  match.overview ||
                  '',

                tmdbMatchStatus:
                  'matched',

                tmdbMatchedAt:
                  serverTimestamp(),
              }
            );

            matched++;
          } else if (!movie.tmdbId) {
            await updateDoc(
              movieRef,
              {
                tmdbMatchStatus:
                  'not_found',

                tmdbCheckedAt:
                  serverTimestamp(),
              }
            );

            unmatched++;
          } else {
            /* Une fiche déjà associée à TMDb reste associée même si TMDb
               n'a pas fourni d'affiche lors de cette tentative. */
            unmatched++;
          }
        } catch (
          error
        ) {
          console.error(
            error
          );

          errors++;
        }

        processed++;

        setEnrichmentStats({
          current:
            processed,

          total:
            pending.length,

          matched,
          unmatched,
          errors,

          currentMovie:
            movie.title,
        });

        await new Promise(
          (
            resolve
          ) =>
            setTimeout(
              resolve,
              160
            )
        );
      }

      if (
        stopRequested.current
      ) {
        setEnrichmentMessage(
          `Traitement arrêté : ${processed} / ${pending.length} traités.`
        );
      } else {
        setEnrichmentMessage(
          `Terminé : ${matched} trouvés / affiches complétées, ${unmatched} à vérifier, ${errors} erreur(s).`
        );
      }

      if (processed > 0) {
        addHistoryEntry(
          `Enrichissement TMDb : ${processed} film${processed > 1 ? 's' : ''}`,
          historyBefore
        );
      }
    } finally {
      setEnriching(
        false
      );

      stopRequested.current =
        false;
    }
  }


  function stopEnrichment() {
    stopRequested.current =
      true;

    setEnrichmentMessage(
      'Arrêt demandé…'
    );
  }


  async function openVerifyMovie(
    movie:
      SavedMovie
  ) {
    setSelectedVerifyMovie(
      movie
    );

    setVerifyQuery(
      movie.title
    );

    setImdbCode(
      movie.ucpmImdbId ||
      ''
    );

    setVerifyResults(
      []
    );

    await searchVerifyCandidates(
      movie.title
    );
  }


  async function searchVerifyCandidates(
    title?: string
  ) {
    const searchText =
      (title || verifyQuery).trim();

    if (
      !searchText ||
      !apiKey
    ) {
      return;
    }

    setVerifyLoading(
      true
    );

    setMessage(
      ''
    );

    try {
      const imdbId =
        extractImdbId(searchText);

      let rawResults: any[] = [];

      if (imdbId) {
        const response =
          await fetch(
            `https://api.themoviedb.org/3/find/${encodeURIComponent(
              imdbId
            )}?api_key=${apiKey}&language=fr-FR&external_source=imdb_id`
          );

        if (
          !response.ok
        ) {
          throw new Error(
            'Erreur TMDb'
          );
        }

        const data =
          await response.json();

        rawResults =
          data.movie_results ||
          [];
      } else {
        const response =
          await fetch(
            `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&language=fr-FR&include_adult=false&query=${encodeURIComponent(
              searchText
            )}`
          );

        if (
          !response.ok
        ) {
          throw new Error(
            'Erreur TMDb'
          );
        }

        const data =
          await response.json();

        rawResults =
          data.results ||
          [];
      }

      const results: TmdbMovie[] =
        rawResults.map(
          (item: any) => ({
            id: item.id,
            title:
              item.title ||
              item.name ||
              '',
            original_title:
              item.original_title ||
              item.original_name ||
              '',
            release_date:
              item.release_date ||
              item.first_air_date ||
              '',
            poster_path:
              item.poster_path ||
              null,
            backdrop_path:
              item.backdrop_path ||
              null,
            overview:
              item.overview ||
              '',
          })
        );

      setVerifyResults(
        results
      );

      if (
        results.length === 0
      ) {
        setMessage(
          imdbId
            ? `Aucun film trouvé pour ${imdbId}.`
            : 'Aucun film trouvé.'
        );
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        'Impossible de rechercher ce film sur TMDb.'
      );
    } finally {
      setVerifyLoading(
        false
      );
    }
  }

  async function searchByImdbCode(
    event?: FormEvent
  ) {
    event
      ?.preventDefault();

    if (
      !apiKey
    ) {
      return;
    }

    const imdbId =
      extractImdbId(
        imdbCode
      );

    if (
      !imdbId
    ) {
      setMessage(
        'Code IMDb invalide. Exemple : tt0110912.'
      );

      return;
    }

    setImdbLookupLoading(
      true
    );

    setMessage(
      ''
    );

    try {
      const response =
        await fetch(
          `https://api.themoviedb.org/3/find/${encodeURIComponent(
            imdbId
          )}?api_key=${apiKey}&language=fr-FR&external_source=imdb_id`
        );

      if (
        !response.ok
      ) {
        throw new Error(
          'Erreur TMDb'
        );
      }

      const data =
        await response
          .json();

      const results:
        TmdbMovie[] =
        data.movie_results ||
        [];

      setVerifyResults(
        results
      );

      if (
        results.length ===
        0
      ) {
        setMessage(
          `Aucun film TMDb trouvé pour ${imdbId}.`
        );
      } else {
        setMessage(
          `Film IMDb ${imdbId} trouvé.`
        );
      }
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        'Impossible de retrouver ce code IMDb.'
      );
    } finally {
      setImdbLookupLoading(
        false
      );
    }
  }


  function toggleVerifyMovieSelection(
    docId: string
  ) {
    setSelectedVerifyMovieIds(
      (current) => {
        const next =
          new Set(current);

        if (
          next.has(docId)
        ) {
          next.delete(docId);
        } else {
          next.add(docId);
        }

        return next;
      }
    );
  }


  function selectAllVerifyMovies() {
    setSelectedVerifyMovieIds(
      new Set(
        moviesToVerify.map(
          (movie) =>
            movie.docId
        )
      )
    );
  }


  function clearVerifyMovieSelection() {
    setSelectedVerifyMovieIds(
      new Set()
    );
  }


  function togglePendingTmdbSelection(
    docId: string
  ) {
    setSelectedPendingTmdbIds(
      (current) => {
        const next =
          new Set(current);

        if (next.has(docId)) {
          next.delete(docId);
        } else {
          next.add(docId);
        }

        return next;
      }
    );
  }


  function selectAllPendingTmdbMovies() {
    setSelectedPendingTmdbIds(
      new Set(
        moviesPendingTmdbList.map(
          (movie) => movie.docId
        )
      )
    );
  }


  function clearPendingTmdbSelection() {
    setSelectedPendingTmdbIds(
      new Set()
    );
  }


  async function editPendingTmdbMovie(
    movie: SavedMovie
  ) {
    setPendingTmdbOpen(false);
    setPage('verify');
    await openVerifyMovie(movie);
  }


  async function deletePendingTmdbMovie(
    movie: SavedMovie
  ) {
    if (!user || deletingPendingTmdbId) {
      return;
    }

    const confirmed =
      window.confirm(
        `Supprimer définitivement « ${getMovieDisplayTitle(movie)} » de la liste À traiter ?\n\nCette fiche sera supprimée avec toutes les rubriques qu'elle contient. Les autres copies liées éventuelles ne seront pas supprimées.`
      );

    if (!confirmed) {
      return;
    }

    const historyBefore =
      snapshotMovieIds([
        movie.docId,
      ]);

    try {
      setDeletingPendingTmdbId(
        movie.docId
      );
      setMessage('');

      const batch =
        writeBatch(db);

      batch.delete(
        doc(
          db,
          'users',
          user.uid,
          'movies',
          movie.docId
        )
      );

      await batch.commit();

      addHistoryEntry(
        `Suppression À traiter : ${getMovieDisplayTitle(movie)}`,
        historyBefore
      );

      setSelectedPendingTmdbIds(
        (current) => {
          const next =
            new Set(current);
          next.delete(movie.docId);
          return next;
        }
      );

      setMessage(
        `« ${getMovieDisplayTitle(movie)} » supprimé.`
      );
    } catch (error) {
      console.error(error);
      setMessage(
        'Impossible de supprimer ce film.'
      );
    } finally {
      setDeletingPendingTmdbId(null);
    }
  }


  async function deleteSelectedPendingTmdbMovies() {
    if (
      !user ||
      deletingPendingTmdb ||
      selectedPendingTmdbIds.size === 0
    ) {
      return;
    }

    const selectedMovies =
      moviesPendingTmdbList.filter(
        (movie) =>
          selectedPendingTmdbIds.has(
            movie.docId
          )
      );

    if (selectedMovies.length === 0) {
      clearPendingTmdbSelection();
      return;
    }

    const confirmed =
      window.confirm(
        `Supprimer définitivement ${selectedMovies.length} fiche${selectedMovies.length > 1 ? 's' : ''} « À traiter » ?\n\nLes rubriques contenues dans ces fiches seront supprimées. Les autres copies liées éventuelles ne seront pas supprimées. Cette opération pourra être annulée depuis l'historique.`
      );

    if (!confirmed) {
      return;
    }

    const historyBefore =
      snapshotMovieIds(
        selectedMovies.map(
          (movie) => movie.docId
        )
      );

    try {
      setDeletingPendingTmdb(true);
      setMessage('');

      for (
        let start = 0;
        start < selectedMovies.length;
        start += 350
      ) {
        const batch =
          writeBatch(db);

        for (
          const movie of selectedMovies.slice(
            start,
            start + 350
          )
        ) {
          batch.delete(
            doc(
              db,
              'users',
              user.uid,
              'movies',
              movie.docId
            )
          );
        }

        await batch.commit();
      }

      addHistoryEntry(
        `Suppression À traiter : ${selectedMovies.length} film${selectedMovies.length > 1 ? 's' : ''}`,
        historyBefore
      );

      clearPendingTmdbSelection();

      setMessage(
        `${selectedMovies.length} fiche${selectedMovies.length > 1 ? 's' : ''} supprimée${selectedMovies.length > 1 ? 's' : ''}.`
      );
    } catch (error) {
      console.error(error);
      setMessage(
        'Impossible de supprimer toute la sélection.'
      );
    } finally {
      setDeletingPendingTmdb(false);
    }
  }


  async function deleteAllPendingTmdbMovies() {
    if (
      !user ||
      deletingPendingTmdb ||
      moviesPendingTmdbList.length === 0
    ) {
      return;
    }

    const selectedMovies = [...moviesPendingTmdbList];

    const confirmed =
      window.confirm(
        `Supprimer définitivement les ${selectedMovies.length} film${selectedMovies.length > 1 ? 's' : ''} « À traiter » ?\n\nCette opération supprimera uniquement ces fiches et pourra être annulée depuis l’historique.`
      );

    if (!confirmed) {
      return;
    }

    const historyBefore =
      snapshotMovieIds(
        selectedMovies.map(
          (movie) => movie.docId
        )
      );

    try {
      setDeletingPendingTmdb(true);
      setMessage('');

      for (
        let start = 0;
        start < selectedMovies.length;
        start += 350
      ) {
        const batch = writeBatch(db);

        for (
          const movie of selectedMovies.slice(
            start,
            start + 350
          )
        ) {
          batch.delete(
            doc(
              db,
              'users',
              user.uid,
              'movies',
              movie.docId
            )
          );
        }

        await batch.commit();
      }

      addHistoryEntry(
        `Suppression À traiter : ${selectedMovies.length} film${selectedMovies.length > 1 ? 's' : ''}`,
        historyBefore
      );

      clearPendingTmdbSelection();
      setPendingTmdbOpen(false);

      setMessage(
        `${selectedMovies.length} film${selectedMovies.length > 1 ? 's' : ''} À traiter supprimé${selectedMovies.length > 1 ? 's' : ''}.`
      );
    } catch (error) {
      console.error(error);
      setMessage(
        'Impossible de supprimer tous les films À traiter.'
      );
    } finally {
      setDeletingPendingTmdb(false);
    }
  }


  async function importBasicVerifyMovies() {
    if (
      !user ||
      !apiKey ||
      basicImportingVerify ||
      basicImportVerifyTargetCount === 0
    ) {
      return;
    }

    /* Une seule cible par document : les films À vérifier et les films déjà
       dans MOVIE DATABASE sans affiche peuvent se recouper. */
    const targetMap =
      new Map<
        string,
        SavedMovie
      >();

    for (
      const movie of [
        ...moviesToVerify,
        ...movieDatabaseMoviesWithoutPoster,
      ]
    ) {
      targetMap.set(
        movie.docId,
        movie
      );
    }

    const targets =
      [...targetMap.values()];

    const movieDatabasePosterlessCount =
      movieDatabaseMoviesWithoutPoster.length;

    const confirmed =
      window.confirm(
        `Import basic va traiter ${targets.length} film${targets.length > 1 ? 's' : ''} au total : ${moviesToVerify.length} film${moviesToVerify.length > 1 ? 's' : ''} à vérifier et ${movieDatabasePosterlessCount} film${movieDatabasePosterlessCount > 1 ? 's' : ''} déjà présent${movieDatabasePosterlessCount > 1 ? 's' : ''} dans Movie Database sans affiche.\n\nPour chacun, l'application utilisera le film TMDb correspondant et sa première affiche disponible. Tu pourras tout corriger ensuite et annuler l'opération depuis l'historique.`
      );

    if (!confirmed) {
      return;
    }

    const historyBefore =
      snapshotMovieIds(
        targets.map(
          (movie) => movie.docId
        )
      );

    let matched = 0;
    let posterAdded = 0;
    let unmatched = 0;
    let errors = 0;

    async function loadExactTmdbMovie(
      tmdbId: unknown
    ): Promise<TmdbMovie | null> {
      const numericId =
        Number(tmdbId);

      if (
        !Number.isFinite(numericId) ||
        numericId <= 0
      ) {
        return null;
      }

      try {
        const response =
          await fetch(
            `https://api.themoviedb.org/3/movie/${encodeURIComponent(
              String(numericId)
            )}?api_key=${apiKey}&language=fr-FR`
          );

        if (!response.ok) {
          return null;
        }

        return (
          await response.json()
        ) as TmdbMovie;
      } catch (error) {
        console.error(error);
        return null;
      }
    }

    try {
      setBasicImportingVerify(true);
      setBasicImportVerifyProgress(
        `Import basic : 0 / ${targets.length}`
      );

      for (
        let index = 0;
        index < targets.length;
        index += 1
      ) {
        const movie =
          targets[index];

        try {
          /* Si le film possède déjà un TMDb ID, on recharge exactement ce
             film afin de ne pas remplacer une bonne association uniquement
             parce que l'affiche manque. Sinon, on prend le premier résultat
             correspondant au titre importé et à l'année. */
          let match =
            movie.tmdbId
              ? await loadExactTmdbMovie(
                  movie.tmdbId
                )
              : null;

          if (!match) {
            match =
              await findTmdbMovie(
                apiKey,
                movie.title,
                movie.year
              );
          }

          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              movie.docId
            );

          if (match) {
            const hadPoster =
              Boolean(
                movie.customPosterUrl ||
                movie.posterPath
              );

            const nextPosterPath =
              match.poster_path ||
              movie.posterPath ||
              null;

            await updateDoc(
              movieRef,
              {
                tmdbId:
                  match.id,
                tmdbMediaType:
                  'movie',
                tmdbTitle:
                  match.title,
                localizedTitle:
                  match.title ||
                  movie.localizedTitle ||
                  movie.title,
                originalTitle:
                  match.original_title ||
                  movie.originalTitle ||
                  null,
                releaseDate:
                  match.release_date ||
                  movie.releaseDate ||
                  null,
                year:
                  match.release_date
                    ? match.release_date.substring(0, 4)
                    : movie.year || null,
                posterPath:
                  nextPosterPath,
                backdropPath:
                  match.backdrop_path ||
                  movie.backdropPath ||
                  null,
                overview:
                  match.overview ||
                  movie.overview ||
                  '',
                tmdbMatchStatus:
                  'matched',
                tmdbManualMatch:
                  false,
                tmdbBasicImport:
                  true,
                tmdbMatchedAt:
                  serverTimestamp(),
              }
            );

            matched += 1;

            if (
              !hadPoster &&
              Boolean(nextPosterPath)
            ) {
              posterAdded += 1;
            }
          } else {
            await updateDoc(
              movieRef,
              {
                tmdbMatchStatus:
                  'not_found',
                tmdbCheckedAt:
                  serverTimestamp(),
              }
            );

            unmatched += 1;
          }
        } catch (error) {
          console.error(error);
          errors += 1;
        }

        setBasicImportVerifyProgress(
          `Import basic : ${index + 1} / ${targets.length} — ${matched} associé${matched > 1 ? 's' : ''}, ${posterAdded} affiche${posterAdded > 1 ? 's' : ''} ajoutée${posterAdded > 1 ? 's' : ''}, ${unmatched} non trouvé${unmatched > 1 ? 's' : ''}, ${errors} erreur${errors > 1 ? 's' : ''}`
        );

        /* Petite pause pour ne pas marteler l'API TMDb lors d'un gros lot. */
        await new Promise(
          (resolve) =>
            setTimeout(resolve, 120)
        );
      }

      addHistoryEntry(
        `Import basic : ${matched} film${matched > 1 ? 's' : ''} traité${matched > 1 ? 's' : ''}, ${posterAdded} affiche${posterAdded > 1 ? 's' : ''} ajoutée${posterAdded > 1 ? 's' : ''}`,
        historyBefore
      );

      clearVerifyMovieSelection();

      setBasicImportVerifyProgress(
        `Import basic terminé : ${matched} film${matched > 1 ? 's' : ''} traité${matched > 1 ? 's' : ''}, ${posterAdded} affiche${posterAdded > 1 ? 's' : ''} ajoutée${posterAdded > 1 ? 's' : ''}, ${unmatched} non trouvé${unmatched > 1 ? 's' : ''}, ${errors} erreur${errors > 1 ? 's' : ''}.`
      );
    } finally {
      setBasicImportingVerify(false);
    }
  }


  async function importBasicSingleVerifyMovie(
    movie: SavedMovie
  ) {
    if (
      !user ||
      !apiKey ||
      basicImportingVerify ||
      bulkDeletingVerify
    ) {
      return;
    }

    const before =
      snapshotMovieIds([movie.docId]);

    try {
      setBasicImportingVerify(true);
      setBasicImportVerifyProgress(
        `Import : ${getMovieDisplayTitle(movie)}…`
      );

      let match: TmdbMovie | null = null;

      if (movie.tmdbId) {
        const response = await fetch(
          `https://api.themoviedb.org/3/movie/${encodeURIComponent(String(movie.tmdbId))}?api_key=${apiKey}&language=fr-FR`
        );

        if (response.ok) {
          match = (await response.json()) as TmdbMovie;
        }
      }

      if (!match) {
        match = await findTmdbMovie(
          apiKey,
          movie.title,
          movie.year
        );
      }

      if (!match) {
        setBasicImportVerifyProgress(
          `Import : aucun résultat pour ${getMovieDisplayTitle(movie)}.`
        );
        return;
      }

      await updateDoc(
        doc(
          db,
          'users',
          user.uid,
          'movies',
          movie.docId
        ),
        {
          tmdbId: match.id,
          tmdbMediaType: 'movie',
          tmdbTitle: match.title,
          localizedTitle:
            match.title || movie.localizedTitle || movie.title,
          originalTitle:
            match.original_title || movie.originalTitle || null,
          releaseDate:
            match.release_date || movie.releaseDate || null,
          year: match.release_date
            ? match.release_date.substring(0, 4)
            : movie.year || null,
          posterPath:
            match.poster_path || movie.posterPath || null,
          backdropPath:
            match.backdrop_path || movie.backdropPath || null,
          overview:
            match.overview || movie.overview || '',
          tmdbMatchStatus: 'matched',
          tmdbManualMatch: false,
          tmdbBasicImport: true,
          tmdbMatchedAt: serverTimestamp(),
        }
      );

      addHistoryEntry(
        `Import : ${getMovieDisplayTitle(movie)}`,
        before
      );

      setBasicImportVerifyProgress(
        `Import terminé : ${getMovieDisplayTitle(movie)}.`
      );
    } catch (error) {
      console.error(error);
      setBasicImportVerifyProgress(
        `Import impossible : ${getMovieDisplayTitle(movie)}.`
      );
    } finally {
      setBasicImportingVerify(false);
    }
  }


  async function deleteSelectedVerifyMovies() {
    if (
      !user ||
      bulkDeletingVerify ||
      selectedVerifyMovieIds.size ===
        0
    ) {
      return;
    }

    const selectedMovies =
      moviesToVerify.filter(
        (movie) =>
          selectedVerifyMovieIds.has(
            movie.docId
          )
      );

    if (
      selectedMovies.length ===
      0
    ) {
      clearVerifyMovieSelection();
      return;
    }

    const linkedById =
      new Map<
        string,
        SavedMovie
      >();

    for (
      const movie
      of selectedMovies
    ) {
      for (
        const linkedMovie
        of getLinkedMovies(
          movie
        )
      ) {
        linkedById.set(
          linkedMovie.docId,
          linkedMovie
        );
      }
    }

    const linkedMovies =
      Array.from(
        linkedById.values()
      );

    const confirmed =
      window.confirm(
        `Supprimer ${selectedMovies.length} film${selectedMovies.length > 1 ? 's' : ''} sélectionné${selectedMovies.length > 1 ? 's' : ''} ?\n\n${linkedMovies.length} fiche${linkedMovies.length > 1 ? 's' : ''} liée${linkedMovies.length > 1 ? 's' : ''} seront supprimées. Cette opération pourra être annulée depuis l’historique.`
      );

    if (!confirmed) {
      return;
    }

    const historyBefore =
      snapshotMovieIds(
        linkedMovies.map(
          (movie) =>
            movie.docId
        )
      );

    try {
      setBulkDeletingVerify(
        true
      );
      setMessage('');

      for (
        let start = 0;
        start <
        linkedMovies.length;
        start += 350
      ) {
        const batch =
          writeBatch(db);

        for (
          const movie
          of linkedMovies.slice(
            start,
            start + 350
          )
        ) {
          batch.delete(
            doc(
              db,
              'users',
              user.uid,
              'movies',
              movie.docId
            )
          );
        }

        await batch.commit();
      }

      addHistoryEntry(
        `Suppression groupée : ${selectedMovies.length} film${selectedMovies.length > 1 ? 's' : ''}`,
        historyBefore
      );

      clearVerifyMovieSelection();

      if (
        selectedVerifyMovie &&
        linkedById.has(
          selectedVerifyMovie.docId
        )
      ) {
        setSelectedVerifyMovie(
          null
        );
        setVerifyResults([]);
        setVerifyQuery('');
        setImdbCode('');
      }

      setMessage(
        `${selectedMovies.length} film${selectedMovies.length > 1 ? 's' : ''} supprimé${selectedMovies.length > 1 ? 's' : ''}.`
      );
    } catch (error) {
      console.error(error);
      setMessage(
        'Impossible de supprimer toute la sélection.'
      );
    } finally {
      setBulkDeletingVerify(
        false
      );
    }
  }


  async function deleteVerifyMovie(
    movie: SavedMovie
  ) {
    if (!user) {
      return;
    }

    const linkedMovies =
      getLinkedMovies(movie);

    const historyBefore =
      snapshotMovieIds(
        linkedMovies.map(
          (linkedMovie) =>
            linkedMovie.docId
        )
      );

    const confirmed =
      window.confirm(
        `Supprimer définitivement « ${getMovieDisplayTitle(movie)} » ?\n\nLe film sera retiré de toutes les rubriques où cette même fiche est présente.`
      );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingVerifyMovieId(
        movie.docId
      );
      setMessage('');

      const batch =
        writeBatch(db);

      for (
        const linkedMovie
        of linkedMovies
      ) {
        batch.delete(
          doc(
            db,
            'users',
            user.uid,
            'movies',
            linkedMovie.docId
          )
        );
      }

      await batch.commit();

      addHistoryEntry(
        `Suppression film à vérifier : ${getMovieDisplayTitle(movie)}`,
        historyBefore
      );

      setSelectedVerifyMovieIds(
        (current) => {
          const next =
            new Set(current);

          for (
            const linkedMovie
            of linkedMovies
          ) {
            next.delete(
              linkedMovie.docId
            );
          }

          return next;
        }
      );

      if (
        selectedVerifyMovie &&
        linkedMovies.some(
          (linkedMovie) =>
            linkedMovie.docId ===
              selectedVerifyMovie.docId
        )
      ) {
        setSelectedVerifyMovie(null);
        setVerifyResults([]);
        setVerifyQuery('');
        setImdbCode('');
      }
    } catch (error) {
      console.error(error);
      setMessage(
        'Impossible de supprimer ce film.'
      );
    } finally {
      setDeletingVerifyMovieId(null);
    }
  }


  async function associateTmdbMovie(
    candidate:
      TmdbMovie
  ) {
    if (
      !user ||
      !selectedVerifyMovie
    ) {
      return;
    }

    const historyBefore =
      snapshotMovieIds([
        selectedVerifyMovie.docId,
      ]);

    try {
      setAssociatingMovie(
        candidate.id
      );

      const preferredPoster =
        await getPreferredPosterPath(
          candidate.id,
          candidate.poster_path
        );

      const preferredTitle =
        await getPreferredFrenchTitle(
          candidate.id,
          candidate.title
        );

      const associatedYear =
        candidate.release_date
          ? candidate.release_date.substring(0, 4)
          : selectedVerifyMovie.year || null;

      const manualImdbId =
        extractImdbId(imdbCode);

      const movieRef =
        doc(
          db,
          'users',
          user.uid,
          'movies',
          selectedVerifyMovie
            .docId
        );

      await updateDoc(
        movieRef,
        {
          tmdbId:
            candidate.id,

          tmdbTitle:
            candidate.title,

          localizedTitle:
            preferredTitle,

          originalTitle:
            candidate.original_title ||
            null,

          releaseDate:
            candidate.release_date ||
            null,

          year:
            associatedYear,

          ...(manualImdbId
            ? { imdbId: manualImdbId }
            : {}),

          posterPath:
            preferredPoster,

          backdropPath:
            candidate.backdrop_path ||
            null,

          overview:
            candidate.overview ||
            '',

          tmdbMatchStatus:
            'matched',

          tmdbManualMatch:
            true,

          tmdbMatchedAt:
            serverTimestamp(),
        }
      );

      addHistoryEntry(
        `Correction TMDb : ${getMovieDisplayTitle(selectedVerifyMovie)}`,
        historyBefore
      );

      const associatedMovie: SavedMovie = {
        ...selectedVerifyMovie,
        tmdbId: candidate.id,
        tmdbMediaType: 'movie',
        tmdbTitle: candidate.title,
        localizedTitle: preferredTitle,
        originalTitle: candidate.original_title || null,
        releaseDate: candidate.release_date || null,
        year: associatedYear,
        ...(manualImdbId
          ? { imdbId: manualImdbId }
          : {}),
        posterPath: preferredPoster,
        backdropPath: candidate.backdrop_path || null,
        overview: candidate.overview || '',
        tmdbMatchStatus: 'matched',
        tmdbManualMatch: true,
      };

      setSelectedVerifyMovieIds(
        (current) => {
          const next =
            new Set(current);

          next.delete(
            selectedVerifyMovie.docId
          );

          return next;
        }
      );

      setSelectedVerifyMovie(
        null
      );

      setVerifyResults(
        []
      );

      setVerifyQuery(
        ''
      );

      setImdbCode(
        ''
      );

      setMessage(
        ''
      );

      /* Après « Associer ce film », on ouvre directement la fiche complète :
         note éditable, choix US / FR / B.O / UCPM / Movie Database / VU, etc. */
      openMovieMenu(
        associatedMovie
      );
      setMovieMenuMessage(
        'Association enregistrée. Tu peux maintenant noter le film et choisir ses listes.'
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        "Impossible d'associer ce film."
      );
    } finally {
      setAssociatingMovie(
        null
      );
    }
  }


  function getDisplayedMovies() {
    let list = [
      ...savedMovies,
    ];

    if (
      page ===
      'topUS'
    ) {
      list =
        list.filter(
          (
            movie
          ) =>
            Boolean(
              movie
                .rankings
                ?.topUS
            )
        );
    }


    if (
      page ===
      'topFR'
    ) {
      list =
        list.filter(
          (
            movie
          ) =>
            Boolean(
              movie
                .rankings
                ?.topFR
            )
        );
    }


    if (page === 'series') {
      list = list.filter((movie) => Boolean(movie.rankings?.series));
    }

    if (page === 'jellyfin') {
      list = list.filter((movie) => Boolean(movie.rankings?.jellyfin));
    }

    if (page === 'watchlist') {
      list = list.filter((movie) => Boolean(movie.watchlist));
    }

    if (
      page ===
      'soundtracks'
    ) {
      list =
        list.filter(
          (
            movie
          ) =>
            Boolean(
              movie
                .rankings
                ?.soundtracks
            )
        );
    }


    if (
      page ===
      'ucpm'
    ) {
      list =
        list.filter(
          (
            movie
          ) =>
            Boolean(
              movie.ucpm
            )
        );
    }


    const deduped =
      new Map<
        string,
        SavedMovie
      >();

    for (
      const movie
      of list
    ) {
      const imdbIdentity =
        normalizeImdbIdentity(
          movie.imdbId ||
          movie.ucpmImdbId
        );

      const key =
        movie.tmdbId
          ? `tmdb_${movie.tmdbMediaType || 'movie'}_${movie.tmdbId}`
          : imdbIdentity
          ? `imdb_${movie.tmdbMediaType || 'movie'}_${imdbIdentity}`
          : `${movie.tmdbMediaType || 'movie'}_${normalizeMovieTitle(
              getMovieDisplayTitle(movie) || movie.title,
              movie.year
            )}_${String(movie.year || '')}`;

      const existing =
        deduped.get(
          key
        );

      if (
        !existing ||
        scoreMovieDocument(
          movie
        ) >
          scoreMovieDocument(
            existing
          )
      ) {
        deduped.set(
          key,
          movie
        );
      }
    }

    list =
      Array.from(
        deduped.values()
      );


    function rankingPosition(
      movie:
        SavedMovie
    ) {
      if (
        page ===
        'topUS'
      ) {
        return (
          movie.rankings
            ?.topUS
            ?.position ??
          99999
        );
      }

      if (
        page ===
        'topFR'
      ) {
        return (
          movie.rankings
            ?.topFR
            ?.position ??
          99999
        );
      }

      if (page === 'series') {
        return movie.rankings?.series?.position ?? 99999;
      }

      if (page === 'jellyfin') {
        return movie.rankings?.jellyfin?.position ?? 99999;
      }

      if (
        page ===
        'soundtracks'
      ) {
        return (
          movie.rankings
            ?.soundtracks
            ?.position ??
          99999
        );
      }

      if (
        page ===
        'ucpm'
      ) {
        return (
          movie.ucpmPosition ??
          99999
        );
      }

      return 99999;
    }


    list.sort(
      (
        a,
        b
      ) => {
        if (
          page === 'ucpm'
        ) {
          const groupA =
            getUcpmPodcastGroup(
              a
            );

          const groupB =
            getUcpmPodcastGroup(
              b
            );

          /* UCPM : les blocs « 6 films » restent toujours tout en haut.
             Ensuite viennent les podcasts les plus récents, puis les non classés. */
          const sixFilmsA = groupA?.kind === 'sixfilms';
          const sixFilmsB = groupB?.kind === 'sixfilms';

          if (sixFilmsA !== sixFilmsB) {
            return sixFilmsA ? -1 : 1;
          }

          if (!groupA && groupB) {
            return 1;
          }

          if (groupA && !groupB) {
            return -1;
          }

          const groupOrderA =
            groupA?.order ??
            -1;

          const groupOrderB =
            groupB?.order ??
            -1;

          if (
            groupOrderA !==
            groupOrderB
          ) {
            return (
              groupOrderB -
              groupOrderA
            );
          }

          if (
            groupA?.id &&
            groupB?.id &&
            groupA.id === groupB.id
          ) {
            const itemOrderA =
              typeof a.ucpmGroupItemOrder === 'number'
                ? a.ucpmGroupItemOrder
                : 9999;
            const itemOrderB =
              typeof b.ucpmGroupItemOrder === 'number'
                ? b.ucpmGroupItemOrder
                : 9999;

            if (itemOrderA !== itemOrderB) {
              return itemOrderA - itemOrderB;
            }
          }

          const positionA =
            Number(
              a.ucpmPosition ??
              -1
            );

          const positionB =
            Number(
              b.ucpmPosition ??
              -1
            );

          if (
            positionA !==
            positionB
          ) {
            return (
              positionB -
              positionA
            );
          }
        }


        if (
          (page === 'jellyfin' || page === 'watchlist') &&
          sortMode === 'added-desc'
        ) {
          /* Vrai tri par date d'ajout. Les anciennes fiches créées avant
             l'introduction de addedAt n'ont pas toujours de date : dans ce
             cas seulement, la position Movie Database sert de secours. */
          const addedA =
            addedAtMillis(
              page === 'watchlist'
                ? a.watchlistDate ?? a.addedAt
                : a.jellyfinAddedAt ?? a.addedAt
            );
          const addedB =
            addedAtMillis(
              page === 'watchlist'
                ? b.watchlistDate ?? b.addedAt
                : b.jellyfinAddedAt ?? b.addedAt
            );

          if (addedA !== addedB) {
            return addedB - addedA;
          }

          const positionA =
            page === 'jellyfin'
              ? a.rankings?.jellyfin?.position ?? -1
              : -1;
          const positionB =
            page === 'jellyfin'
              ? b.rankings?.jellyfin?.position ?? -1
              : -1;

          if (positionA !== positionB) {
            return positionB - positionA;
          }
        }


        if (
          sortMode ===
          'rating-desc' ||
          sortMode ===
          'rating-asc'
        ) {
          const rawRatingA =
            page === 'soundtracks'
              ? a.soundtrackRating
              : page === 'jellyfin'
                ? getMovieDatabaseEffectiveRating(a)
                : a.rating;

          const rawRatingB =
            page === 'soundtracks'
              ? b.soundtrackRating
              : page === 'jellyfin'
                ? getMovieDatabaseEffectiveRating(b)
                : b.rating;

          const ratingA =
            rawRatingA ==
            null
              ? null
              : Number(
                  rawRatingA
                );

          const ratingB =
            rawRatingB ==
            null
              ? null
              : Number(
                  rawRatingB
                );

          if (
            ratingA ===
            null &&
            ratingB !==
            null
          ) {
            return 1;
          }

          if (
            ratingB ===
            null &&
            ratingA !==
            null
          ) {
            return -1;
          }

          if (
            ratingA !==
              null &&
            ratingB !==
              null &&
            ratingA !==
              ratingB
          ) {
            return sortMode ===
              'rating-desc'
              ? ratingB -
                  ratingA
              : ratingA -
                  ratingB;
          }
        }

        if (
          sortMode ===
          'year-desc' ||
          sortMode ===
          'year-asc'
        ) {
          const yearA =
            Number(
              a.year ||
              0
            );

          const yearB =
            Number(
              b.year ||
              0
            );

          if (
            yearA ===
              0 &&
            yearB !==
              0
          ) {
            return 1;
          }

          if (
            yearB ===
              0 &&
            yearA !==
              0
          ) {
            return -1;
          }

          if (
            yearA !==
            yearB
          ) {
            return sortMode ===
              'year-desc'
              ? yearB -
                  yearA
              : yearA -
                  yearB;
          }
        }

        return (
          rankingPosition(
            a
          ) -
          rankingPosition(
            b
          )
        );
      }
    );

    return list;
  }


  function renderPosterSizeSelector() {
    const sizes: PosterSize[] = [
      'huge',
      'large',
      'medium',
      'mini',
    ];

    return (
      <details
        className="posterSizeControl posterSizeMenu"
      >
        <summary
          className="posterSizeMenuButton posterSizeEyeButton"
          aria-label="Choisir l’affichage"
          title="Affichage"
        >
          <span aria-hidden="true">👁</span>
        </summary>

        <div
          className="posterSizeMenuChoices"
        >
          {sizes.map((size) => (
            <button
              key={size}
              type="button"
              className={
                posterSize === size
                  ? 'posterSizeMenuChoice active'
                  : 'posterSizeMenuChoice'
              }
              aria-label={posterSizeLabels[size]}
              title={posterSizeLabels[size]}
              onClick={(event) => {
                setPosterSize(size);
                event.currentTarget
                  .closest('details')
                  ?.removeAttribute('open');
              }}
            >
              <span
                className={`sizeIcon sizeIcon-${size}`}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
                <i />
              </span>
            </button>
          ))}
        </div>
      </details>
    );
  }


  function currentPageSupportsManualReorder() {
    return (
      page === 'topUS' ||
      page === 'topFR' ||
      page === 'soundtracks' ||
      page === 'series'
    );
  }


  function numericRating(value: unknown) {
    if (value == null || value === '') {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number)
      ? Math.max(0, Math.min(5, number))
      : null;
  }


  function roundRating(value: number) {
    return Math.round(Math.max(0, Math.min(5, value)) * 100) / 100;
  }


  function ratingBetweenNeighbours(
    previous: number | null,
    next: number | null
  ) {
    if (previous == null && next == null) {
      return 0;
    }

    if (previous == null && next != null) {
      return roundRating(Math.min(5, next + 0.01));
    }

    if (previous != null && next == null) {
      return roundRating(Math.max(0, previous - 0.01));
    }

    const upper = previous as number;
    const lower = next as number;

    if (upper >= lower) {
      const gap = upper - lower;
      if (gap >= 0.02) {
        return roundRating(lower + gap / 2);
      }

      /* Quand deux notes sont déjà collées au centième, une égalité est
         volontairement acceptée : la position de liste tranche ensuite. */
      return roundRating(lower);
    }

    return roundRating((upper + lower) / 2);
  }


  function getMovieReorderRating(movie: SavedMovie) {
    return page === 'soundtracks'
      ? numericRating(movie.soundtrackRating)
      : numericRating(movie.rating);
  }


  function startCurrentMovieReorder() {
    if (!currentPageSupportsManualReorder()) {
      return;
    }

    const initialOrder = [...displayedMovies];
    const indexById = new Map(
      initialOrder.map((movie, index) => [movie.docId, index])
    );

    initialOrder.sort((a, b) => {
      const ratingA = getMovieReorderRating(a);
      const ratingB = getMovieReorderRating(b);

      if (ratingA == null && ratingB != null) return 1;
      if (ratingA != null && ratingB == null) return -1;
      if (ratingA != null && ratingB != null && ratingA !== ratingB) {
        return ratingB - ratingA;
      }

      return (indexById.get(a.docId) ?? 0) - (indexById.get(b.docId) ?? 0);
    });

    setSortMode('rating-desc');
    setReorderMovies(initialOrder);
    setReorderDirty(false);
    reorderMovedIdsRef.current.clear();
    reorderDragIdRef.current = null;
    setReorderMode(true);
  }


  function startLpReorder() {
    const initialOrder = [...sortedAlbums];
    const indexById = new Map(
      initialOrder.map((album, index) => [album.docId, index])
    );

    initialOrder.sort((a, b) => {
      const ratingA = numericRating(a.rating);
      const ratingB = numericRating(b.rating);

      if (ratingA == null && ratingB != null) return 1;
      if (ratingA != null && ratingB == null) return -1;
      if (ratingA != null && ratingB != null && ratingA !== ratingB) {
        return ratingB - ratingA;
      }

      return (indexById.get(a.docId) ?? 0) - (indexById.get(b.docId) ?? 0);
    });

    setLpSortMode('rating-desc');
    setLpReorderAlbums(initialOrder);
    setLpReorderDirty(false);
    setMobileReorderFocusId(null);
    lpReorderMovedIdsRef.current.clear();
    lpReorderDragIdRef.current = null;
    setLpReorderMode(true);
  }


  function startCurrentReorder() {
    if (page === 'lp') {
      startLpReorder();
      return;
    }

    startCurrentMovieReorder();
  }


  function moveReorderMovie(
    sourceId:
      string,

    targetId:
      string
  ) {
    if (
      sourceId ===
      targetId
    ) {
      return;
    }

    setReorderMovies(
      (
        current
      ) => {
        const sourceIndex =
          current.findIndex(
            (
              movie
            ) =>
              movie.docId ===
              sourceId
          );

        const targetIndex =
          current.findIndex(
            (
              movie
            ) =>
              movie.docId ===
              targetId
          );

        if (
          sourceIndex <
            0 ||
          targetIndex <
            0 ||
          sourceIndex ===
            targetIndex
        ) {
          return current;
        }

        const next =
          [
            ...current,
          ];

        const [moved] =
          next.splice(
            sourceIndex,
            1
          );

        next.splice(
          targetIndex,
          0,
          moved
        );

        return next;
      }
    );

    reorderMovedIdsRef.current.add(
      sourceId
    );

    setReorderDirty(
      true
    );
  }




  function cancelReorderMode() {
    setReorderMode(
      false
    );

    setReorderMovies(
      []
    );

    setReorderDirty(
      false
    );

    setMobileReorderFocusId(
      null
    );

    reorderDragIdRef.current =
      null;
    reorderMovedIdsRef.current.clear();
  }


  function handleReorderDragStart(
    event:
      ReactDragEvent<HTMLElement>,

    movieId:
      string
  ) {
    reorderDragIdRef.current =
      movieId;

    event.dataTransfer.effectAllowed =
      'move';

    event.dataTransfer.setData(
      'text/plain',
      movieId
    );
  }


  function handleReorderDragOver(
    event:
      ReactDragEvent<HTMLElement>,

    targetId:
      string
  ) {
    event.preventDefault();

    const sourceId =
      reorderDragIdRef.current ||
      event.dataTransfer.getData(
        'text/plain'
      );

    if (
      sourceId
    ) {
      moveReorderMovie(
        sourceId,
        targetId
      );
    }
  }


  function handleReorderPointerDown(
    event:
      ReactPointerEvent<HTMLButtonElement>,

    movieId:
      string
  ) {
    reorderDragIdRef.current =
      movieId;

    event.currentTarget.setPointerCapture(
      event.pointerId
    );
  }


  function handleReorderPointerMove(
    event:
      ReactPointerEvent<HTMLButtonElement>
  ) {
    const sourceId =
      reorderDragIdRef.current;

    if (
      !sourceId
    ) {
      return;
    }

    event.preventDefault();

    const pointed =
      document.elementFromPoint(
        event.clientX,
        event.clientY
      ) as
        HTMLElement |
        null;

    const card =
      pointed?.closest(
        '[data-reorder-id]'
      ) as
        HTMLElement |
        null;

    const targetId =
      card?.dataset
        .reorderId;

    if (
      targetId
    ) {
      moveReorderMovie(
        sourceId,
        targetId
      );
    }
  }


  function handleReorderPointerUp(
    event:
      ReactPointerEvent<HTMLButtonElement>
  ) {
    reorderDragIdRef.current =
      null;

    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId
      );
    }
  }


  function lpArtistReorderKey(album: SavedAlbum) {
    return (
      normalizeTitle(String(album.artist || '')) ||
      `__album_${album.docId}`
    );
  }


  function moveLpReorderAlbum(
    sourceId: string,
    targetId: string
  ) {
    if (sourceId === targetId) {
      return;
    }

    setLpReorderAlbums((current) => {
      const sourceIndex = current.findIndex((album) => album.docId === sourceId);
      const targetIndex = current.findIndex((album) => album.docId === targetId);

      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        sourceIndex === targetIndex
      ) {
        return current;
      }

      const sourceAlbum = current[sourceIndex];
      const targetAlbum = current[targetIndex];
      const sourceArtist = lpArtistReorderKey(sourceAlbum);
      const targetArtist = lpArtistReorderKey(targetAlbum);

      /* Une pochette LP représente maintenant tout son artiste pendant le
         déplacement : tous les albums du même groupe / artiste suivent le
         mouvement et restent côte à côte. */
      if (sourceArtist === targetArtist) {
        return current;
      }

      const sourceGroup = current.filter(
        (album) => lpArtistReorderKey(album) === sourceArtist
      );
      const sourceGroupIds = new Set(sourceGroup.map((album) => album.docId));
      const remaining = current.filter((album) => !sourceGroupIds.has(album.docId));

      const targetGroupIndexes = remaining
        .map((album, index) =>
          lpArtistReorderKey(album) === targetArtist ? index : -1
        )
        .filter((index) => index >= 0);

      if (targetGroupIndexes.length === 0) {
        return current;
      }

      const movingForward = sourceIndex < targetIndex;
      const insertionIndex = movingForward
        ? targetGroupIndexes[targetGroupIndexes.length - 1] + 1
        : targetGroupIndexes[0];

      const next = [
        ...remaining.slice(0, insertionIndex),
        ...sourceGroup,
        ...remaining.slice(insertionIndex),
      ];

      sourceGroup.forEach((album) =>
        lpReorderMovedIdsRef.current.add(album.docId)
      );
      setLpReorderDirty(true);

      return next;
    });
  }


  function lpReorderColumnCount() {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-lp-reorder-id]'
      )
    );

    if (cards.length <= 1) {
      return 1;
    }

    const firstTop = cards[0].getBoundingClientRect().top;
    let count = 0;

    for (const card of cards) {
      if (
        Math.abs(
          card.getBoundingClientRect().top - firstTop
        ) <= 4
      ) {
        count += 1;
      } else if (count > 0) {
        break;
      }
    }

    return Math.max(1, count);
  }


  function moveFocusedLpReorderAlbum(
    direction: 'up' | 'down' | 'left' | 'right'
  ) {
    if (!lpReorderMode || !mobileReorderFocusId) {
      return;
    }

    const sourceIndex = lpReorderAlbums.findIndex(
      (album) => album.docId === mobileReorderFocusId
    );

    if (sourceIndex < 0) {
      return;
    }

    const columns = lpReorderColumnCount();
    const columnIndex = sourceIndex % columns;
    let targetIndex = sourceIndex;
    let step = 0;

    if (direction === 'left') {
      if (columnIndex === 0) {
        return;
      }
      step = -1;
      targetIndex = sourceIndex + step;
    } else if (direction === 'right') {
      if (
        columnIndex >= columns - 1 ||
        sourceIndex + 1 >= lpReorderAlbums.length
      ) {
        return;
      }
      step = 1;
      targetIndex = sourceIndex + step;
    } else if (direction === 'up') {
      step = -columns;
      targetIndex = sourceIndex + step;
    } else {
      step = columns;
      targetIndex = sourceIndex + step;
    }

    const sourceArtist = lpArtistReorderKey(lpReorderAlbums[sourceIndex]);

    /* Si la flèche tombe sur une autre pochette du même artiste, on continue
       dans la même direction jusqu'au groupe voisin : le bloc entier bouge. */
    while (
      targetIndex >= 0 &&
      targetIndex < lpReorderAlbums.length &&
      lpArtistReorderKey(lpReorderAlbums[targetIndex]) === sourceArtist
    ) {
      targetIndex += step;
    }

    if (
      targetIndex < 0 ||
      targetIndex >= lpReorderAlbums.length ||
      targetIndex === sourceIndex
    ) {
      return;
    }

    const target = lpReorderAlbums[targetIndex];
    if (!target) {
      return;
    }

    moveLpReorderAlbum(
      mobileReorderFocusId,
      target.docId
    );

    window.requestAnimationFrame(() => {
      const focused = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-lp-reorder-id]'
        )
      ).find(
        (element) =>
          element.dataset.lpReorderId ===
          mobileReorderFocusId
      );

      focused?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    });
  }


  function handleLpReorderDragStart(
    event: ReactDragEvent<HTMLElement>,
    albumId: string
  ) {
    lpReorderDragIdRef.current = albumId;
    setMobileReorderFocusId(albumId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', albumId);
  }


  function handleLpReorderDragOver(
    event: ReactDragEvent<HTMLElement>,
    targetId: string
  ) {
    event.preventDefault();

    const sourceId =
      lpReorderDragIdRef.current ||
      event.dataTransfer.getData('text/plain');

    if (sourceId) {
      moveLpReorderAlbum(sourceId, targetId);
    }
  }


  function handleLpReorderPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    albumId: string
  ) {
    lpReorderDragIdRef.current = albumId;
    setMobileReorderFocusId(albumId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }


  function handleLpReorderPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    const sourceId = lpReorderDragIdRef.current;
    if (!sourceId) {
      return;
    }

    event.preventDefault();

    const pointed = document.elementFromPoint(
      event.clientX,
      event.clientY
    ) as HTMLElement | null;

    const card = pointed?.closest(
      '[data-lp-reorder-id]'
    ) as HTMLElement | null;

    const targetId = card?.dataset.lpReorderId;
    if (targetId) {
      moveLpReorderAlbum(sourceId, targetId);
    }
  }


  function handleLpReorderPointerUp(
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    lpReorderDragIdRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }


  function cancelLpReorderMode() {
    setLpReorderMode(false);
    setLpReorderAlbums([]);
    setLpReorderDirty(false);
    setMobileReorderFocusId(null);
    lpReorderDragIdRef.current = null;
    lpReorderMovedIdsRef.current.clear();
  }


  async function saveLpReorderedList() {
    if (!user || !lpReorderMode || !lpReorderDirty) {
      return;
    }

    const historyBefore =
      snapshotAlbumIds(
        lpReorderAlbums.map(
          (album) =>
            album.docId
        )
      );

    try {
      const ratingOverrides = new Map<string, number>();

      lpReorderAlbums.forEach((album, index) => {
        if (!lpReorderMovedIdsRef.current.has(album.docId)) {
          return;
        }

        const previous =
          index > 0
            ? numericRating(lpReorderAlbums[index - 1]?.rating)
            : null;
        const next =
          index < lpReorderAlbums.length - 1
            ? numericRating(lpReorderAlbums[index + 1]?.rating)
            : null;

        ratingOverrides.set(
          album.docId,
          ratingBetweenNeighbours(previous, next)
        );
      });

      for (let start = 0; start < lpReorderAlbums.length; start += 400) {
        const batch = writeBatch(db);

        lpReorderAlbums
          .slice(start, start + 400)
          .forEach((album, chunkIndex) => {
            const absoluteIndex = start + chunkIndex;
            const albumRef = doc(
              db,
              'users',
              user.uid,
              'albums',
              album.docId
            );

            const patch: Record<string, unknown> = {
              position: absoluteIndex + 1,
            };

            if (ratingOverrides.has(album.docId)) {
              patch.rating = ratingOverrides.get(album.docId) as number;
              patch.ratingUpdatedAt = serverTimestamp();
            }

            batch.set(albumRef, patch, { merge: true });
          });

        await batch.commit();
      }

      setLpReorderMode(false);
      setLpReorderAlbums([]);
      setLpReorderDirty(false);
      setMobileReorderFocusId(null);
      lpReorderDragIdRef.current = null;
      lpReorderMovedIdsRef.current.clear();
      addHistoryEntry(
        'Reclassement LP',
        historyBefore
      );

      setMessage('LP reclassé, notes ajustées et sauvegardées.');
    } catch (error) {
      console.error(error);
      setMessage('Impossible de sauvegarder le classement LP.');
    }
  }


  async function saveReorderedList() {
    if (
      !user ||
      !reorderMode ||
      !reorderDirty ||
      (
        page !==
          'topUS' &&
        page !==
          'topFR' &&
        page !==
          'soundtracks' &&
        page !==
          'ucpm' &&
        page !==
          'series'
      )
    ) {
      return;
    }

    const target =
      page as
        Exclude<
          AddTarget,
          'diary'
        >;

    const historyIds =
      new Set<string>();

    for (
      const movie
      of reorderMovies
    ) {
      for (
        const linkedMovie
        of getLinkedMovies(movie)
      ) {
        historyIds.add(
          linkedMovie.docId
        );
      }

      if (
        target === 'jellyfin'
      ) {
        for (
          const linkedMovie
          of getUsFrPropagationMovies(movie)
        ) {
          historyIds.add(
            linkedMovie.docId
          );
        }
      }
    }

    const historyBefore =
      snapshotMovieIds(
        historyIds
      );

    try {
      const updates =
        new Map<
          string,
          Record<
            string,
            unknown
          >
        >();

      const ratingOverrides =
        new Map<string, number>();

      if (target !== 'ucpm') {
        reorderMovies.forEach((movie, index) => {
          if (!reorderMovedIdsRef.current.has(movie.docId)) {
            return;
          }

          const previous =
            index > 0
              ? getMovieReorderRating(reorderMovies[index - 1])
              : null;
          const next =
            index < reorderMovies.length - 1
              ? getMovieReorderRating(reorderMovies[index + 1])
              : null;

          ratingOverrides.set(
            movie.docId,
            ratingBetweenNeighbours(previous, next)
          );
        });
      }

      reorderMovies.forEach(
        (
          movie,
          index
        ) => {
          const linked =
            getLinkedMovies(
              movie
            );

          const carriers =
            target ===
            'ucpm'
              ? linked.filter(
                  (
                    linkedMovie
                  ) =>
                    Boolean(
                      linkedMovie.ucpm
                    )
                )
              : linked.filter(
                  (
                    linkedMovie
                  ) =>
                    Boolean(
                      linkedMovie.rankings?.[
                        target
                      ]
                    )
                );

          const effectiveCarriers =
            carriers.length >
            0
              ? carriers
              : [
                  getCanonicalMovie(
                    movie
                  ),
                ];

          for (
            const carrier
            of effectiveCarriers
          ) {
            if (
              target ===
              'ucpm'
            ) {
              updates.set(
                carrier.docId,
                {
                  ucpm:
                    true,
                  ucpmPosition:
                    index +
                    1,
                }
              );
            } else {
              const patch:
                Record<string, unknown> = {
                [`rankings.${target}`]: {
                  ...(
                    carrier.rankings?.[
                      target
                    ] ||
                    {}
                  ),
                  listName:
                    sectionLabel(
                      target
                    ),
                  position:
                    index +
                    1,
                },
              };

              const adjustedRating =
                ratingOverrides.get(movie.docId);

              if (adjustedRating != null) {
                if (target === 'soundtracks') {
                  patch.soundtrackIndependent = true;
                  patch.soundtrackRating = adjustedRating;
                  patch.soundtrackUpdatedAt = serverTimestamp();
                } else {
                  patch.rating = adjustedRating;
                  patch.ratingUpdatedAt = serverTimestamp();
                }
              }

              updates.set(
                carrier.docId,
                patch
              );
            }
          }
        }
      );

      const entries =
        Array.from(
          updates.entries()
        );

      for (
        let start =
          0;
        start <
        entries.length;
        start +=
          400
      ) {
        const batch =
          writeBatch(
            db
          );

        for (
          const [
            docId,
            patch,
          ]
          of entries.slice(
            start,
            start +
              400
          )
        ) {
          const movieRef =
            doc(
              db,
              'users',
              user.uid,
              'movies',
              docId
            );

          batch.update(
            movieRef,
            patch
          );
        }

        await batch.commit();
      }

      setReorderDirty(
        false
      );
      setReorderMode(
        false
      );
      setReorderMovies(
        []
      );
      setMobileReorderFocusId(
        null
      );
      reorderDragIdRef.current =
        null;
      reorderMovedIdsRef.current.clear();

      addHistoryEntry(
        `Reclassement ${sectionLabel(target)}`,
        historyBefore
      );

      setMessage(
        `${sectionLabel(target)} reclassé, notes ajustées et sauvegardé.`
      );
    } catch (
      error
    ) {
      console.error(
        error
      );

      setMessage(
        'Impossible de sauvegarder ce classement.'
      );
    }
  }


  function renderSortSelector(
    value: MovieSortMode,
    onChange: (
      value: MovieSortMode
    ) => void,
    includeRecent = false
  ) {
    return (
      <label
        className="sortControl compactSortControl"
        title="Trier la rubrique"
      >
        <span>Tri</span>
        <select
          value={value}
          onChange={(event) =>
            onChange(
              event.target.value as MovieSortMode
            )
          }
          aria-label="Trier la rubrique"
        >
          <option value="rating-desc">Note +</option>
          <option value="rating-asc">Note -</option>
          {includeRecent && (
            <option value="added-desc">Ajout +</option>
          )}
          <option value="ranking">Letbxd</option>
          <option value="year-desc">Année +</option>
          <option value="year-asc">Année -</option>
        </select>
      </label>
    );
  }


  function pageSupportsInlineSearch() {
    return (
      page === 'topUS' ||
      page === 'topFR' ||
      page === 'soundtracks' ||
      page === 'ucpm' ||
      page === 'diary' ||
      page === 'series' ||
      page === 'lp' ||
      page === 'jellyfin' ||
      page === 'watchlist'
    );
  }


  function matchesPageSearchValues(...values: unknown[]) {
    const query = normalizeTitle(pageSearchQuery);

    if (!query) {
      return true;
    }

    return values.some((value) =>
      normalizeTitle(String(value ?? '')).includes(query)
    );
  }


  function movieMatchesPageSearch(movie: SavedMovie) {
    return matchesPageSearchValues(
      getMovieDisplayTitle(movie),
      movie.title,
      movie.customTitle,
      movie.localizedTitle,
      movie.originalTitle,
      movie.tmdbTitle,
      movie.year,
      movie.imdbId,
      movie.ucpmImdbId,
      movie.tmdbId
    );
  }


  function albumMatchesPageSearch(album: SavedAlbum) {
    return matchesPageSearchValues(
      album.title,
      album.artist,
      album.year,
      album.collectionId
    );
  }


  function clearPageSearchHighlight() {
    document
      .querySelectorAll<HTMLElement>('.pageSearchBlink')
      .forEach((element) => element.classList.remove('pageSearchBlink'));

    if (pageSearchHighlightTimerRef.current !== null) {
      window.clearTimeout(pageSearchHighlightTimerRef.current);
      pageSearchHighlightTimerRef.current = null;
    }
  }


  function runPageSearch(
    rawQuery: string,
    cycle = false
  ) {
    const normalizedQuery = normalizeTitle(rawQuery);

    clearPageSearchHighlight();

    if (!normalizedQuery || !pageSupportsInlineSearch()) {
      setPageSearchStatus('');
      pageSearchLastQueryRef.current = '';
      pageSearchLastIndexRef.current = -1;
      return;
    }

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('[data-page-search-title]')
    );

    const startsWithMatches = candidates.filter((element) =>
      normalizeTitle(element.dataset.pageSearchTitle || '').startsWith(normalizedQuery)
    );

    const matches =
      startsWithMatches.length > 0
        ? startsWithMatches
        : candidates.filter((element) =>
            normalizeTitle(element.dataset.pageSearchTitle || '').includes(normalizedQuery)
          );

    if (matches.length === 0) {
      setPageSearchStatus('Aucun résultat');
      pageSearchLastQueryRef.current = normalizedQuery;
      pageSearchLastIndexRef.current = -1;
      return;
    }

    let matchIndex = 0;

    if (
      cycle &&
      pageSearchLastQueryRef.current === normalizedQuery &&
      pageSearchLastIndexRef.current >= 0
    ) {
      matchIndex = (pageSearchLastIndexRef.current + 1) % matches.length;
    }

    const target = matches[matchIndex];
    target.classList.add('pageSearchBlink');
    target.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });

    setPageSearchStatus(
      matches.length > 1
        ? `${matchIndex + 1}/${matches.length}`
        : 'Trouvé'
    );

    pageSearchLastQueryRef.current = normalizedQuery;
    pageSearchLastIndexRef.current = matchIndex;

    pageSearchHighlightTimerRef.current = window.setTimeout(() => {
      target.classList.remove('pageSearchBlink');
      pageSearchHighlightTimerRef.current = null;
    }, 3000);
  }


  function renderPageSearchControl(floating = false) {
    if (!pageSupportsInlineSearch()) {
      return null;
    }

    return (
      <label className={`pageSearchControl${floating ? ' pageSearchFloating' : ''}`}>
        <span className="pageSearchIcon" aria-hidden="true">⌕</span>
        <input
          type="search"
          className="pageSearchInput"
          value={pageSearchQuery}
          placeholder="Rechercher…"
          aria-label="Rechercher dans la page"
          onChange={(event) => {
            const nextQuery = event.target.value;
            setPageSearchQuery(nextQuery);
            pageSearchLastQueryRef.current = '';
            pageSearchLastIndexRef.current = -1;

            if (pageSearchDebounceRef.current !== null) {
              window.clearTimeout(pageSearchDebounceRef.current);
            }

            pageSearchDebounceRef.current = window.setTimeout(() => {
              runPageSearch(nextQuery, false);
              pageSearchDebounceRef.current = null;
            }, 260);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();

              if (pageSearchDebounceRef.current !== null) {
                window.clearTimeout(pageSearchDebounceRef.current);
                pageSearchDebounceRef.current = null;
              }

              runPageSearch(pageSearchQuery, true);
            }

            if (event.key === 'Escape') {
              setPageSearchQuery('');
              setPageSearchStatus('');
              clearPageSearchHighlight();
              pageSearchLastQueryRef.current = '';
              pageSearchLastIndexRef.current = -1;
            }
          }}
        />
        {pageSearchStatus && (
          <span className="pageSearchStatus">{pageSearchStatus}</span>
        )}
      </label>
    );
  }


  function renderDiaryHeaderControls() {
    return (
      <div
        className="listControls diaryHeaderControls"
      >
        {renderPosterSizeSelector()}
      </div>
    );
  }


  function renderLpHeaderControls() {
    return (
      <div
        className="listControls"
      >
        {renderPosterSizeSelector()}
      </div>
    );
  }


  function renderListControls() {
    if (
      page !== 'topUS' &&
      page !== 'topFR' &&
      page !== 'soundtracks' &&
      page !== 'ucpm' &&
      page !== 'series' &&
      page !== 'jellyfin' &&
      page !== 'watchlist'
    ) {
      return null;
    }

    return (
      <div
        className={`listControls${
          page === 'ucpm'
            ? ' ucpmHeaderControls'
            : ''
        }`}
      >
        {renderPosterSizeSelector()}
        {page !== 'ucpm' &&
          renderSortSelector(
            sortMode,
            setSortMode,
            page === 'jellyfin' || page === 'watchlist'
          )}
      </div>
    );
  }


  function openAddForCurrentPage() {
    if (page === 'lp') {
      openLpAdd();
      return;
    }

    if (page === 'diary') {
      openAddToSection('diary');
      return;
    }

    if (page === 'series') {
      openAddToSection('series');
      return;
    }

    if (page === 'topUS') {
      openAddToSection('topUS');
      return;
    }

    if (page === 'topFR') {
      openAddToSection('topFR');
      return;
    }

    if (page === 'soundtracks') {
      openAddToSection('soundtracks');
      return;
    }

    if (page === 'jellyfin') {
      openAddToSection('jellyfin');
      return;
    }

    if (page === 'watchlist') {
      openAddToSection('watchlist');
      return;
    }

    if (page === 'ucpm') {
      openUcpmComposer();
    }
  }


  /*
   * Le filtre + dédoublonnage + tri principal peut parcourir toute la
   * bibliothèque. On le mémorise pour éviter de tout recalculer lors d'un
   * simple rendu de modal, d'un changement de champ ou d'un message UI.
   */
  const displayedMovies =
    useMemo(
      () => getDisplayedMovies(),
      [
        savedMovies,
        page,
        sortMode,
        sharedMovieRatingIndex,
      ]
    );


  const visibleListMovies =
    (
      reorderMode
        ? reorderMovies
        : displayedMovies
    ).filter(movieMatchesPageSearch);


  const groupMoviesByDecade =
    !reorderMode &&
    (
      sortMode ===
        'year-desc' ||
      sortMode ===
        'year-asc'
    );


  const groupMoviesByUcpmPodcast =
    !reorderMode &&
    page === 'ucpm';


  const ucpmPodcastVisibleCounts =
    new Map<
      string,
      number
    >();


  /*
   * Les numéros de groupes UCPM ne dépendent que de la collection.
   * Avant, ils étaient reconstruits à chaque rendu de l'application, y compris
   * lorsqu'on ouvrait simplement un menu. On conserve maintenant les Maps
   * tant que savedMovies ne change pas.
   */
  const {
    ucpmPodcastGroupNumbers,
    ucpmSixFilmsGroupNumbers,
  } =
    useMemo(
      () => {
        const podcastGroupNumbers =
          new Map<string, number>();
        const sixFilmsGroupNumbers =
          new Map<string, number>();

        /*
         * La numérotation vient maintenant du document source :
         * #01 = 1968, #42 = 2009, #43 = 2010, #46 = 2013, #57 = 2024.
         * Les blocs Années 1950 / Années 1960 ne consomment aucun numéro,
         * et les nouveaux podcasts continuent donc #58, #59…
         */
        UCPM_PODCAST_GROUPS
          .slice()
          .sort((a, b) => a.order - b.order)
          .forEach((group) => {
            const legacyNumber = getLegacyUcpmPodcastNumber({
              ...group,
              kind: 'legacy',
            });

            if (legacyNumber) {
              podcastGroupNumbers.set(
                getUcpmPodcastGroupKey({ ...group, kind: 'legacy' }),
                legacyNumber
              );
            }
          });

        const customPodcastGroups =
          new Map<string, UcpmPodcastGroup>();
        const sixFilmGroups =
          new Map<string, UcpmPodcastGroup>();

        for (const movie of savedMovies) {
          const group =
            getUcpmPodcastGroup(movie);

          if (!group) {
            continue;
          }

          const key =
            getUcpmPodcastGroupKey(group);

          if (group.kind === 'sixfilms') {
            if (!sixFilmGroups.has(key)) {
              sixFilmGroups.set(key, group);
            }
            continue;
          }

          if (
            group.kind === 'podcast' &&
            !customPodcastGroups.has(key)
          ) {
            customPodcastGroups.set(key, group);
          }
        }

        let nextPodcastNumber =
          getLastLegacyUcpmPodcastNumber() + 1;

        [...customPodcastGroups.entries()]
          .sort((a, b) => a[1].order - b[1].order)
          .forEach(([key]) => {
            podcastGroupNumbers.set(
              key,
              nextPodcastNumber
            );
            nextPodcastNumber += 1;
          });

        const usedSixFilmNumbers =
          new Set<number>();
        let nextFallbackSixFilmNumber = 1;

        [...sixFilmGroups.entries()]
          .sort((a, b) => a[1].order - b[1].order)
          .forEach(([key, group]) => {
            const explicitMatch =
              group.label.match(
                /^6\s*films\s*#?\s*(\d+)\b/i
              );
            const explicitNumber =
              explicitMatch
                ? Number(explicitMatch[1])
                : 0;

            if (
              Number.isFinite(explicitNumber) &&
              explicitNumber > 0 &&
              !usedSixFilmNumbers.has(explicitNumber)
            ) {
              sixFilmsGroupNumbers.set(
                key,
                explicitNumber
              );
              usedSixFilmNumbers.add(
                explicitNumber
              );
              return;
            }

            while (
              usedSixFilmNumbers.has(
                nextFallbackSixFilmNumber
              )
            ) {
              nextFallbackSixFilmNumber += 1;
            }

            sixFilmsGroupNumbers.set(
              key,
              nextFallbackSixFilmNumber
            );
            usedSixFilmNumbers.add(
              nextFallbackSixFilmNumber
            );
            nextFallbackSixFilmNumber += 1;
          });

        return {
          ucpmPodcastGroupNumbers:
            podcastGroupNumbers,
          ucpmSixFilmsGroupNumbers:
            sixFilmsGroupNumbers,
        };
      },
      [savedMovies]
    );


  const ucpmSixFilmsShowcaseGroups =
    useMemo(
      () =>
        page === 'ucpm'
      ? (() => {
          const groups = new Map<
            number,
            {
              number: number;
              groupId: string | null;
              modern: boolean;
              items: Array<{ movie: SavedMovie; itemOrder: number }>;
            }
          >();

          /* v1.21 : les nouvelles appartenances « 6 films » sont secondaires.
             Elles n'écrasent donc plus le podcast UCPM principal du film. */
          for (const movie of savedMovies) {
            for (const membership of getUcpmSixFilmsMemberships(movie)) {
              if (membership.number < 1 || membership.number > 10) {
                continue;
              }

              const current = groups.get(membership.number);
              if (current && current.modern) {
                if (
                  !current.items.some((item) => item.movie.docId === movie.docId)
                ) {
                  current.items.push({
                    movie,
                    itemOrder: membership.itemOrder,
                  });
                }
              } else if (!current) {
                groups.set(membership.number, {
                  number: membership.number,
                  groupId: membership.groupId,
                  modern: true,
                  items: [
                    {
                      movie,
                      itemOrder: membership.itemOrder,
                    },
                  ],
                });
              }
            }
          }

          /* Compatibilité avec les anciens blocs stockés directement dans les
             champs ucpmGroup*. Un bloc moderne portant le même numéro a priorité. */
          for (const movie of savedMovies) {
            if (!movie.ucpm || movie.ucpmSixFilmsHidden === true) {
              continue;
            }

            const group = getUcpmPodcastGroup(movie);
            if (!group || group.kind !== 'sixfilms') {
              continue;
            }

            const explicitNumberMatch = group.label.match(
              /^6\s*films\s*#?\s*(\d+)\b/i
            );
            const explicitNumber = explicitNumberMatch
              ? Number(explicitNumberMatch[1])
              : 0;
            const key = getUcpmPodcastGroupKey(group);
            const number =
              Number.isFinite(explicitNumber) && explicitNumber > 0
                ? explicitNumber
                : ucpmSixFilmsGroupNumbers.get(key) ?? 0;

            if (number < 1 || number > 10) {
              continue;
            }

            const current = groups.get(number);
            if (current?.modern) {
              continue;
            }

            const itemOrder =
              typeof movie.ucpmGroupItemOrder === 'number'
                ? movie.ucpmGroupItemOrder
                : Number(movie.ucpmPosition ?? 9999);

            if (current) {
              if (
                !current.items.some((item) => item.movie.docId === movie.docId)
              ) {
                current.items.push({ movie, itemOrder });
              }
            } else {
              groups.set(number, {
                number,
                groupId: movie.ucpmGroupId || null,
                modern: false,
                items: [{ movie, itemOrder }],
              });
            }
          }

          return [...groups.values()]
            .sort((a, b) => a.number - b.number)
            .map((current) => {
              current.items.sort((a, b) => a.itemOrder - b.itemOrder);

              if (current.modern) {
                return {
                  number: current.number,
                  groupId: current.groupId,
                  movies: current.items.map((item) => item.movie).slice(0, 6),
                };
              }

              const positionalMovies = current.items.map((item) => item.movie);
              const expectedTitles =
                UCPM_LEGACY_SIX_FILMS_TITLES[current.number];

              /* Le fallback historique ne complète qu'un ancien bloc qui existe
                 réellement encore. Il ne crée plus de bloc fantôme après une
                 suppression. */
              if (expectedTitles) {
                const usedDocIds = new Set<string>();
                const resolvedMovies = expectedTitles
                  .map((aliases, slotIndex) => {
                    const normalizedAliases = aliases.map((alias) =>
                      normalizeTitle(alias)
                    );
                    const expectedImdbId =
                      current.number === 4 && slotIndex === 4
                        ? 'tt4965254'
                        : null;

                    const byImdb = expectedImdbId
                      ? savedMovies.find((candidate) => {
                          if (
                            usedDocIds.has(candidate.docId) ||
                            candidate.ucpmSixFilmsHidden === true
                          ) {
                            return false;
                          }

                          return (
                            String(candidate.imdbId || '').toLowerCase() ===
                              expectedImdbId ||
                            String(candidate.ucpmImdbId || '').toLowerCase() ===
                              expectedImdbId
                          );
                        })
                      : null;

                    const byTitle = savedMovies.find((candidate) => {
                      if (
                        usedDocIds.has(candidate.docId) ||
                        candidate.ucpmSixFilmsHidden === true
                      ) {
                        return false;
                      }

                      const candidateTitles = [
                        candidate.customTitle,
                        candidate.localizedTitle,
                        candidate.title,
                        candidate.originalTitle,
                        candidate.tmdbTitle,
                      ]
                        .filter(Boolean)
                        .map((value) =>
                          normalizeTitle(
                            sanitizeMovieTitle(String(value || ''), candidate.year)
                          )
                        );

                      return normalizedAliases.some((alias) =>
                        candidateTitles.some(
                          (candidateTitle) =>
                            candidateTitle === alias ||
                            (alias.length >= 6 && candidateTitle.includes(alias)) ||
                            (candidateTitle.length >= 6 && alias.includes(candidateTitle))
                        )
                      );
                    });

                    const historicalPosition =
                      UCPM_LEGACY_SIX_FILMS_START +
                      (current.number - 1) * UCPM_LEGACY_SIX_FILMS_SIZE +
                      slotIndex;
                    const byHistoricalPosition = positionalMovies.find(
                      (candidate) =>
                        !usedDocIds.has(candidate.docId) &&
                        Number(candidate.ucpmPosition) === historicalPosition
                    );
                    const fallback =
                      byImdb ||
                      byTitle ||
                      byHistoricalPosition ||
                      null;

                    if (fallback) {
                      usedDocIds.add(fallback.docId);
                    }

                    return fallback;
                  })
                  .filter((movie): movie is SavedMovie => Boolean(movie));

                return {
                  number: current.number,
                  groupId: current.groupId,
                  movies: resolvedMovies.slice(0, 6),
                };
              }

              return {
                number: current.number,
                groupId: current.groupId,
                movies: positionalMovies.slice(0, 6),
              };
            })
            .map((group) => ({
              ...group,
              movies: group.movies.filter(movieMatchesPageSearch),
            }))
            .filter((group) => group.movies.length > 0);
        })()
      : [],
      [
        page,
        savedMovies,
        ucpmSixFilmsGroupNumbers,
        pageSearchQuery,
      ]
    );


  const [
    mobileUcpmSixFilmsOpenNumber,
    setMobileUcpmSixFilmsOpenNumber,
  ] = useState<number | null>(null);

  useEffect(() => {
    if (page !== 'ucpm' || !isMobileBanner) {
      return;
    }

    if (ucpmSixFilmsShowcaseGroups.length === 0) {
      setMobileUcpmSixFilmsOpenNumber(null);
      return;
    }

    setMobileUcpmSixFilmsOpenNumber((current) => {
      if (
        current !== null &&
        ucpmSixFilmsShowcaseGroups.some(
          (group) => group.number === current
        )
      ) {
        return current;
      }

      return ucpmSixFilmsShowcaseGroups[0].number;
    });
  }, [
    page,
    isMobileBanner,
    ucpmSixFilmsShowcaseGroups,
  ]);


  const ucpmGridMovies =
    useMemo(
      () => {
        if (page !== 'ucpm') {
          return visibleListMovies;
        }

        const filtered =
          visibleListMovies.filter((movie) => {
            const group = getUcpmPodcastGroup(movie);

            return (
              movie.ucpmSixFilmsOnly !== true &&
              group?.kind !== 'sixfilms'
            );
          });

        return orderUcpmFeaturedMoviesFirst(filtered);
      },
      [page, visibleListMovies]
    );


  const renderedGridMovies =
    startupGridRenderDoneRef.current
      ? ucpmGridMovies
      : ucpmGridMovies.slice(
          0,
          startupGridRenderLimit
        );


  useEffect(
    () => {
      if (
        showIntro ||
        !moviesSnapshotReady ||
        startupGridRenderDoneRef.current
      ) {
        return;
      }

      if (
        startupGridRenderLimit >=
        ucpmGridMovies.length
      ) {
        startupGridRenderDoneRef.current = true;
        return;
      }

      const timer =
        window.setTimeout(
          () => {
            window.requestAnimationFrame(
              () => {
                setStartupGridRenderLimit(
                  (current) => {
                    const next =
                      Math.min(
                        current + 36,
                        ucpmGridMovies.length
                      );

                    if (
                      next >=
                      ucpmGridMovies.length
                    ) {
                      startupGridRenderDoneRef.current = true;
                    }

                    return next;
                  }
                );
              }
            );
          },
          55
        );

      return () => {
        window.clearTimeout(
          timer
        );
      };
    },
    [
      showIntro,
      moviesSnapshotReady,
      startupGridRenderLimit,
      ucpmGridMovies.length,
    ]
  );


  if (
    groupMoviesByUcpmPodcast
  ) {
    for (
      const movie
      of ucpmGridMovies
    ) {
      const group =
        getUcpmPodcastGroup(
          movie
        );

      const key =
        getUcpmPodcastGroupKey(
          group
        );

      ucpmPodcastVisibleCounts.set(
        key,
        (
          ucpmPodcastVisibleCounts.get(
            key
          ) ||
          0
        ) + 1
      );
    }
  }


  /* Record UCPM : parmi les vrais podcasts numérotés, le total de films
     le plus élevé est mis en rouge. Les blocs « 6 films » et les archives
     non numérotées ne participent pas au record. */
  const ucpmPodcastRecordCount =
    groupMoviesByUcpmPodcast
      ? Array.from(ucpmPodcastVisibleCounts.entries()).reduce(
          (maxCount, [key, count]) =>
            ucpmPodcastGroupNumbers.has(key)
              ? Math.max(maxCount, count)
              : maxCount,
          0
        )
      : 0;


  function getDecadeLabel(
    movie:
      SavedMovie
  ) {
    const year =
      Number(
        movie.year ||
        0
      );

    if (
      !Number.isFinite(
        year
      ) ||
      year <= 0
    ) {
      return 'Année inconnue';
    }

    const decade =
      Math.floor(
        year / 10
      ) * 10;

    return `Années ${decade}`;
  }


  function getMovieReeditIssues(
    movie: SavedMovie
  ) {
    if (
      movie.tmdbMediaType === 'tv' ||
      Boolean(movie.rankings?.series)
    ) {
      return [] as string[];
    }

    const issues: string[] = [];
    const title =
      getMovieDisplayTitle(movie).trim();
    const year =
      getMovieIdentityYear(movie);
    const hasPoster =
      Boolean(
        movie.customPosterUrl ||
        movie.customPosterPath ||
        movie.posterPath
      );

    if (!title) {
      issues.push('titre');
    }

    if (!year) {
      issues.push('année');
    }

    if (!movie.tmdbId) {
      issues.push('TMDb');
    }

    if (!hasPoster) {
      issues.push('affiche');
    }

    if (
      movie.tmdbMatchStatus === 'not_found' ||
      movie.tmdbMatchStatus === 'error'
    ) {
      issues.push('correspondance');
    }

    return Array.from(
      new Set(issues)
    );
  }


  /*
   * États de bibliothèque utilisés par MAJ / Films à rééditer / UCPM.
   * Une seule passe remplace plusieurs filter() complets exécutés à chaque rendu.
   */
  const libraryStatus =
    useMemo(
      () => {
        let moviesWithoutTmdb = 0;
        let moviesPendingTmdb = 0;
        let moviesMissingFrenchTitle = 0;
        const moviesPendingTmdbList: SavedMovie[] = [];
        const moviesToVerify: SavedMovie[] = [];
        const movieDatabaseMoviesWithoutPoster: SavedMovie[] = [];
        const ucpmMovies: SavedMovie[] = [];

        for (const movie of savedMovies) {
          const hasTmdb =
            Boolean(movie.tmdbId);
          const hasPoster =
            Boolean(
              movie.customPosterUrl ||
              movie.customPosterPath ||
              movie.posterPath
            );

          if (!hasTmdb) {
            moviesWithoutTmdb += 1;
          }

          if (
            (!hasTmdb &&
              movie.tmdbMatchStatus !== 'not_found') ||
            (hasTmdb && !hasPoster)
          ) {
            moviesPendingTmdb += 1;
            moviesPendingTmdbList.push(movie);
          }

          if (
            getMovieReeditIssues(movie).length > 0
          ) {
            moviesToVerify.push(movie);
          }

          if (
            Boolean(movie.rankings?.jellyfin)
          ) {
            const priorityPosterMovie =
              getMovieDatabasePriorityPosterMovie(
                movie
              );
            const hasMovieDatabasePoster =
              Boolean(
                priorityPosterMovie.customPosterUrl ||
                priorityPosterMovie.customPosterPath ||
                priorityPosterMovie.posterPath
              );

            if (!hasMovieDatabasePoster) {
              movieDatabaseMoviesWithoutPoster.push(
                movie
              );
            }
          }

          if (
            hasTmdb &&
            !movie.localizedTitle
          ) {
            moviesMissingFrenchTitle += 1;
          }

          if (movie.ucpm) {
            ucpmMovies.push(movie);
          }
        }

        return {
          moviesWithoutTmdb,
          moviesPendingTmdb,
          moviesPendingTmdbList,
          moviesMissingFrenchTitle,
          moviesToVerify,
          movieDatabaseMoviesWithoutPoster,
          ucpmMovies,
        };
      },
      [savedMovies]
    );

  const {
    moviesWithoutTmdb,
    moviesPendingTmdb,
    moviesPendingTmdbList,
    moviesMissingFrenchTitle,
    moviesToVerify,
    movieDatabaseMoviesWithoutPoster,
    ucpmMovies,
  } = libraryStatus;


  useEffect(
    () => {
      const validIds =
        new Set(
          moviesPendingTmdbList.map(
            (movie) => movie.docId
          )
        );

      setSelectedPendingTmdbIds(
        (current) => {
          const next =
            new Set(
              [...current].filter(
                (docId) => validIds.has(docId)
              )
            );

          if (
            next.size === current.size &&
            [...next].every(
              (docId) => current.has(docId)
            )
          ) {
            return current;
          }

          return next;
        }
      );

      if (
        moviesPendingTmdbList.length === 0
      ) {
        setPendingTmdbOpen(false);
      }
    },
    [moviesPendingTmdbList]
  );


  /* Movie Database suit en permanence la hiérarchie d'affiches :
     US > FR > UCPM > VUS. Le rendu utilise immédiatement la source prioritaire,
     et cet effet recopie également les champs d'affiche dans la fiche Movie
     Database afin que la cohérence soit persistante dans Firestore. */
  useEffect(
    () => {
      if (
        !user ||
        page !== 'jellyfin' ||
        movieDatabasePosterSyncRunningRef.current
      ) {
        return;
      }

      const normalizePosterValue =
        (value: unknown) =>
          value == null
            ? null
            : String(value);

      const updates:
        Array<{
          target: SavedMovie;
          source: SavedMovie;
          sourceLabel: MovieDatabasePosterAuthoritySource;
        }> = [];

      for (const movie of savedMovies) {
        if (!movie.rankings?.jellyfin) {
          continue;
        }

        const authority =
          getMovieDatabasePosterAuthority(
            movie
          );

        if (
          authority.source === 'SELF' ||
          authority.movie.docId === movie.docId
        ) {
          continue;
        }

        const source = authority.movie;
        const sourceHasPoster =
          Boolean(
            source.customPosterUrl ||
            source.customPosterPath ||
            source.posterPath
          );

        if (!sourceHasPoster) {
          continue;
        }

        const samePoster =
          normalizePosterValue(movie.customPosterUrl) ===
            normalizePosterValue(source.customPosterUrl) &&
          normalizePosterValue(movie.customPosterPath) ===
            normalizePosterValue(source.customPosterPath) &&
          normalizePosterValue(movie.customPosterLanguage) ===
            normalizePosterValue(source.customPosterLanguage) &&
          normalizePosterValue(movie.posterPath) ===
            normalizePosterValue(source.posterPath);

        if (!samePoster) {
          updates.push({
            target: movie,
            source,
            sourceLabel: authority.source,
          });
        }
      }

      if (updates.length === 0) {
        return;
      }

      movieDatabasePosterSyncRunningRef.current =
        true;

      void (
        async () => {
          try {
            const chunkSize = 350;

            for (
              let offset = 0;
              offset < updates.length;
              offset += chunkSize
            ) {
              const chunk =
                updates.slice(
                  offset,
                  offset + chunkSize
                );
              const batch =
                writeBatch(db);

              for (const update of chunk) {
                batch.set(
                  doc(
                    db,
                    'users',
                    user.uid,
                    'movies',
                    update.target.docId
                  ),
                  {
                    customPosterUrl:
                      update.source.customPosterUrl ?? null,
                    customPosterPath:
                      update.source.customPosterPath ?? null,
                    customPosterLanguage:
                      update.source.customPosterLanguage ?? null,
                    posterPath:
                      update.source.posterPath ?? null,
                    movieDatabasePosterSource:
                      update.sourceLabel,
                    movieDatabasePosterSourceDocId:
                      update.source.docId,
                    movieDatabasePosterSyncedAt:
                      serverTimestamp(),
                  },
                  {
                    merge: true,
                  }
                );
              }

              await batch.commit();
            }
          } catch (error) {
            console.error(
              'Synchronisation des affiches Movie Database impossible :',
              error
            );
          } finally {
            movieDatabasePosterSyncRunningRef.current =
              false;
          }
        }
      )();
    },
    [
      user,
      page,
      savedMovies,
    ]
  );


  /* Bouton COVER — Movie Database.
     Cette recherche est volontairement plus tolérante que l'enrichissement
     automatique général : l'utilisateur demande ici explicitement de prendre
     la première affiche correspondant au titre. L'année reste prioritaire,
     mais une recherche sans année est retentée si nécessaire. */

  type CoverTmdbMatch = {
    id: number;
    title: string;
    original_title?: string;
    release_date?: string;
    poster_path?: string | null;
  };

  async function searchFirstTmdbCover(
    title: string,
    year?: string | number | null
  ): Promise<CoverTmdbMatch | null> {
    const cleanTitle = String(title || '').trim();

    if (!apiKey || !cleanTitle) {
      return null;
    }

    const runSearch = async (
      searchYear?: string | number | null
    ): Promise<CoverTmdbMatch | null> => {
      const params = new URLSearchParams({
        api_key: apiKey,
        query: cleanTitle,
        include_adult: 'false',
        language: 'fr-FR',
      });

      if (searchYear) {
        params.set('primary_release_year', String(searchYear));
      }

      const response = await fetch(
        `https://api.themoviedb.org/3/search/movie?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`TMDb COVER search ${response.status}`);
      }

      const data = await response.json();
      const results: CoverTmdbMatch[] =
        Array.isArray(data?.results) ? data.results : [];

      if (results.length === 0) {
        return null;
      }

      return results.find((candidate) => Boolean(candidate.poster_path)) || results[0] || null;
    };

    const withYear = await runSearch(year || null);

    if (withYear?.poster_path || !year) {
      return withYear;
    }

    return await runSearch(null);
  }

  async function fetchTmdbMainPosterPath(
    tmdbId: number
  ): Promise<string | null> {
    if (!apiKey || !Number.isFinite(tmdbId) || tmdbId <= 0) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        api_key: apiKey,
        language: 'fr-FR',
      });

      const response = await fetch(
        `https://api.themoviedb.org/3/movie/${tmdbId}?${params.toString()}`
      );

      if (response.ok) {
        const data = await response.json();
        if (data?.poster_path) {
          return String(data.poster_path);
        }
      }
    } catch (error) {
      console.warn('COVER détail TMDb indisponible :', error);
    }

    try {
      const posters = await fetchTmdbPosters(tmdbId, 'movie');
      return posters[0]?.file_path || null;
    } catch (error) {
      console.warn('COVER images TMDb indisponibles :', error);
      return null;
    }
  }

  function requestMovieDatabaseCoverCancel(
    mode: 'stop' | 'undo'
  ) {
    if (!movieDatabaseCoverRunning || movieDatabaseCoverCancelRequestedRef.current) {
      return;
    }

    movieDatabaseCoverRollbackRequestedRef.current =
      mode === 'undo';
    movieDatabaseCoverCancelRequestedRef.current = true;
    setMovieDatabaseCoverCancelRequested(true);
    setMovieDatabaseCoverCancelMenuOpen(false);
    setMessage(
      mode === 'undo'
        ? 'COVER : annulation demandée… l’affiche en cours se termine puis les changements de cette session seront restaurés.'
        : 'COVER : STOP demandé… arrêt après l’affiche en cours, les affiches déjà ajoutées seront conservées.'
    );
  }

  async function repairMovieDatabaseEmptyCovers() {
    if (
      !user ||
      !apiKey ||
      movieDatabaseCoverRunning ||
      jellyfinImporting ||
      basicImportingVerify
    ) {
      return;
    }

    /* COVER suit exactement l'ordre actuellement affiché dans Movie Database :
       de haut en bas et de gauche à droite. On construit donc la file d'attente
       à partir de displayedMovies, puis on ne garde que les fiches dont
       l'affiche est encore vide. Les éventuelles fiches manquantes au rendu
       sont ajoutées à la fin par sécurité. */
    const pendingById = new Map(
      movieDatabaseMoviesWithoutPoster.map((movie) => [movie.docId, movie])
    );

    const pending = displayedMovies
      .map((movie) => pendingById.get(movie.docId))
      .filter((movie): movie is SavedMovie => Boolean(movie));

    for (const movie of movieDatabaseMoviesWithoutPoster) {
      if (!pending.some((candidate) => candidate.docId === movie.docId)) {
        pending.push(movie);
      }
    }

    if (pending.length === 0) {
      return;
    }

    movieDatabaseCoverCancelRequestedRef.current = false;
    movieDatabaseCoverRollbackRequestedRef.current = false;
    setMovieDatabaseCoverCancelRequested(false);
    setMovieDatabaseCoverCancelMenuOpen(false);
    setMovieDatabaseCoverCurrentTitle('');
    setMovieDatabaseCoverRecentTitles([]);
    setMovieDatabaseCoverRunning(true);

    let repaired = 0;
    let notFound = 0;
    let errors = 0;
    let cancelled = false;
    const historySnapshots: HistoryDocumentSnapshot[] = [];

    setMessage(
      `COVER : recherche de ${pending.length} affiche${pending.length > 1 ? 's' : ''}…`
    );

    try {
      for (let index = 0; index < pending.length; index += 1) {
        if (movieDatabaseCoverCancelRequestedRef.current) {
          cancelled = true;
          break;
        }

        const movie = pending[index];

        try {
          const currentMovie =
            savedMovies.find((candidate) => candidate.docId === movie.docId) || movie;
          const currentCoverTitle =
            getMovieDisplayTitle(currentMovie) ||
            currentMovie.title ||
            'Film sans titre';

          setMovieDatabaseCoverCurrentTitle(
            String(currentCoverTitle)
          );

          if (
            currentMovie.customPosterUrl ||
            currentMovie.customPosterPath ||
            currentMovie.posterPath
          ) {
            continue;
          }

          let match: CoverTmdbMatch | null = null;
          let tmdbId = Number(currentMovie.tmdbId || 0);
          let posterPath: string | null = null;

          if (Number.isFinite(tmdbId) && tmdbId > 0) {
            posterPath = await fetchTmdbMainPosterPath(tmdbId);
          }

          if (!posterPath) {
            const titleCandidates = Array.from(
              new Set(
                [
                  currentMovie.title,
                  currentMovie.localizedTitle,
                  currentMovie.tmdbTitle,
                  currentMovie.originalTitle,
                  getMovieDisplayTitle(currentMovie),
                ]
                  .map((value) => String(value || '').trim())
                  .filter(Boolean)
              )
            );

            for (const title of titleCandidates) {
              try {
                match = await searchFirstTmdbCover(title, currentMovie.year);
              } catch (error) {
                console.warn(`COVER recherche "${title}" impossible :`, error);
                continue;
              }

              if (!match) {
                continue;
              }

              tmdbId = match.id;
              posterPath =
                match.poster_path ||
                (await fetchTmdbMainPosterPath(match.id));

              if (posterPath) {
                break;
              }
            }
          }

          if (!posterPath) {
            notFound += 1;
            setMessage(
              `COVER : ${repaired} récupérée${repaired > 1 ? 's' : ''} · ${notFound} introuvable${notFound > 1 ? 's' : ''} · ${index + 1}/${pending.length}`
            );
            continue;
          }

          historySnapshots.push(historyMovieSnapshot(currentMovie));

          const patch: Record<string, unknown> = {
            posterPath,
            tmdbMatchStatus: 'matched',
            tmdbMatchedAt: serverTimestamp(),
          };

          if (Number.isFinite(tmdbId) && tmdbId > 0) {
            patch.tmdbId = tmdbId;
            patch.tmdbMediaType = 'movie';
          }

          if (match) {
            patch.tmdbTitle = match.title || currentMovie.tmdbTitle || currentMovie.title;
            patch.originalTitle = match.original_title || currentMovie.originalTitle || null;
            patch.releaseDate = match.release_date || currentMovie.releaseDate || null;

            if (match.release_date) {
              patch.year = match.release_date.substring(0, 4);
            }
          }

          await setDoc(
            doc(db, 'users', user.uid, 'movies', currentMovie.docId),
            patch,
            { merge: true }
          );

          repaired += 1;
          setMovieDatabaseCoverRecentTitles(
            (current) => [
              ...current,
              String(currentCoverTitle),
            ].slice(-12)
          );

          setMessage(
            `COVER : ${repaired} affiche${repaired > 1 ? 's' : ''} récupérée${repaired > 1 ? 's' : ''} · ${index + 1}/${pending.length}`
          );
        } catch (error) {
          console.error('COVER Movie Database impossible :', error);
          errors += 1;
          setMessage(
            `COVER : ${repaired} récupérée${repaired > 1 ? 's' : ''} · ${errors} erreur${errors > 1 ? 's' : ''} · ${index + 1}/${pending.length}`
          );
        }

        if (movieDatabaseCoverCancelRequestedRef.current) {
          cancelled = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 140));
      }

      const rollbackRequested =
        cancelled && movieDatabaseCoverRollbackRequestedRef.current;

      if (rollbackRequested && historySnapshots.length > 0) {
        await restoreHistoryDocuments(historySnapshots);
      } else if (historySnapshots.length > 0) {
        addHistoryEntry(
          `${cancelled ? 'COVER stoppé' : 'COVER Movie Database'} · ${repaired} affiche${repaired > 1 ? 's' : ''}`,
          historySnapshots
        );
      }

      if (rollbackRequested) {
        setMessage(
          `COVER annulé : ${repaired} changement${repaired > 1 ? 's' : ''} restauré${repaired > 1 ? 's' : ''}.`
        );
      } else if (cancelled) {
        setMessage(
          `COVER stoppé : ${repaired} affiche${repaired > 1 ? 's' : ''} conservée${repaired > 1 ? 's' : ''}${notFound > 0 ? ` · ${notFound} titre${notFound > 1 ? 's' : ''} sans affiche trouvée` : ''}${errors > 0 ? ` · ${errors} erreur${errors > 1 ? 's' : ''}` : ''}.`
        );
      } else {
        setMessage(
          `COVER terminé : ${repaired} affiche${repaired > 1 ? 's' : ''} récupérée${repaired > 1 ? 's' : ''}${notFound > 0 ? ` · ${notFound} titre${notFound > 1 ? 's' : ''} sans affiche trouvée` : ''}${errors > 0 ? ` · ${errors} erreur${errors > 1 ? 's' : ''}` : ''}.`
        );
      }
    } finally {
      movieDatabaseCoverCancelRequestedRef.current = false;
      movieDatabaseCoverRollbackRequestedRef.current = false;
      setMovieDatabaseCoverCancelRequested(false);
      setMovieDatabaseCoverCancelMenuOpen(false);
      setMovieDatabaseCoverCurrentTitle('');
      setMovieDatabaseCoverRunning(false);
    }
  }


  const basicImportVerifyTargetCount =
    useMemo(
      () =>
        new Set(
          [
            ...moviesToVerify,
            ...movieDatabaseMoviesWithoutPoster,
          ].map(
            (movie) =>
              movie.docId
          )
        ).size,
      [
        moviesToVerify,
        movieDatabaseMoviesWithoutPoster,
      ]
    );


  function getDiaryPriorityRating(
    movie: SavedMovie,
    entry: DiaryEntry
  ) {
    /* Dans VUS, TOP US est prioritaire, puis TOP FR.
       La note Letterboxd/VUS n'est utilisée que si le film n'existe
       dans aucune de ces deux listes. */
    const authority =
      getUsFrPriorityRating(movie);

    if (authority) {
      return authority.rating;
    }

    if (entry.rating != null) {
      return entry.rating;
    }

    const canonical =
      getCanonicalMovie(movie);

    return (
      canonical.rating ??
      movie.rating ??
      null
    );
  }


  function getDiaryWatchDate(
    entry: DiaryEntry
  ) {
    const explicitDate =
      entry.watchedDate ||
      entry.entryDate ||
      '';

    if (/^\d{4}-\d{2}-\d{2}/.test(explicitDate)) {
      return explicitDate.slice(0, 10);
    }

    if (
      entry.insertedAt &&
      /^\d{4}-\d{2}-\d{2}/.test(entry.insertedAt)
    ) {
      return entry.insertedAt.slice(0, 10);
    }

    return '';
  }


  function formatDiaryPosterDate(
    entry: DiaryEntry
  ) {
    const date =
      getDiaryWatchDate(entry);

    if (!date) {
      return 'Date inconnue';
    }

    const match =
      date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
      return date;
    }

    const monthLabels = [
      'janv.',
      'févr.',
      'mars',
      'avr.',
      'mai',
      'juin',
      'juil.',
      'août',
      'sept.',
      'oct.',
      'nov.',
      'déc.',
    ];

    const monthIndex =
      Number(match[2]) - 1;
    const day =
      Number(match[3]);

    if (
      monthIndex < 0 ||
      monthIndex >= monthLabels.length ||
      !Number.isFinite(day)
    ) {
      return date;
    }

    return `${day} ${monthLabels[monthIndex]}`;
  }


  function getDiaryInsertionDateTime(
    entry: DiaryEntry
  ) {
    if (entry.insertedAt) {
      return entry.insertedAt;
    }

    const watchDate =
      getDiaryWatchDate(entry);

    return watchDate
      ? `${watchDate}T00:00:00.000Z`
      : '';
  }


  function focusDiaryYearForDate(
    watchedDate: string
  ) {
    const targetYear =
      watchedDate.slice(0, 4);

    if (!/^\d{4}$/.test(targetYear)) {
      return;
    }

    /* diaryYears reflète le rendu courant. On ajoute aussi l'année cible
       pour le cas où ce nouvel ajout crée une année qui n'existait pas encore. */
    const yearsWithTarget =
      Array.from(
        new Set([
          ...diaryYears.filter((year) => /^\d{4}$/.test(year)),
          targetYear,
        ])
      ).sort((a, b) => b.localeCompare(a));

    const targetIndex =
      yearsWithTarget.indexOf(targetYear);

    setDiaryYearPageIndex(
      targetIndex >= 0
        ? targetIndex
        : 0
    );
  }


  function selectDiaryYearPage(
    nextIndex: number
  ) {
    setDiaryYearPageIndex(nextIndex);

    /* Après le changement d'année, replace immédiatement le début de
       l'année affichée en haut de la fenêtre. Deux frames laissent React
       terminer le rendu du nouveau groupe avant de calculer sa position. */
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target =
          document.querySelector<HTMLElement>(
            '.diaryGroupedGrid .diaryYearHeading'
          ) ||
          document.querySelector<HTMLElement>(
            '.diaryGroupedGrid'
          );

        if (!target) {
          return;
        }

        const top =
          target.getBoundingClientRect().top +
          window.scrollY;

        window.scrollTo({
          top,
          behavior: 'smooth',
        });
      });
    });
  }


  function compareDiaryChronology(
    a: DiaryDisplayEntry,
    b: DiaryDisplayEntry
  ) {
    const watchedA =
      getDiaryWatchDate(a.entry);
    const watchedB =
      getDiaryWatchDate(b.entry);

    if (watchedA !== watchedB) {
      return watchedB.localeCompare(watchedA);
    }

    const insertedA =
      getDiaryInsertionDateTime(a.entry);
    const insertedB =
      getDiaryInsertionDateTime(b.entry);

    if (insertedA !== insertedB) {
      return insertedB.localeCompare(insertedA);
    }

    const ratingA =
      getDiaryPriorityRating(
        a.movie,
        a.entry
      );
    const ratingB =
      getDiaryPriorityRating(
        b.movie,
        b.entry
      );

    if (ratingA != null && ratingB != null && Number(ratingA) !== Number(ratingB)) {
      return Number(ratingB) - Number(ratingA);
    }

    if (ratingA != null && ratingB == null) return -1;
    if (ratingA == null && ratingB != null) return 1;

    return getMovieDisplayTitle(a.movie).localeCompare(
      getMovieDisplayTitle(b.movie),
      'fr'
    );
  }


  function isExplicitVusEntry(
    movie: SavedMovie,
    entry: DiaryEntry
  ) {
    /* VUS ne doit contenir que les vrais visionnages :
       - import Letterboxd / diary.csv ;
       - ajout manuel effectué dans MerylMoviesBox.
       Les entrées sans origine identifiable sont volontairement exclues
       afin d'éviter les films hérités d'US, FR, UCPM ou Movie Database. */
    if (
      entry.source === 'manual' ||
      entry.source === 'letterboxd' ||
      entry.source === 'diaryCsv' ||
      Boolean(entry.letterboxdEntryUri)
    ) {
      return true;
    }

    /* Compatibilité avec les anciens imports : avant l'ajout du champ
       source sur chaque entrée, l'origine n'était enregistrée qu'au niveau
       du document film. Les nouvelles entrées utilisent source=manual /
       letterboxd / diaryCsv, mais on garde ce secours pour ne pas masquer
       l'historique déjà présent dans Firestore. */
    if (
      Boolean(movie.importedFromLetterboxd) ||
      Boolean(movie.importedFromDiaryCsv)
    ) {
      return true;
    }

    /*
     * Compatibilité MerylMoviesBox :
     * les ajouts manuels créés avant l'ajout du champ `source`
     * possèdent déjà une vraie date de visionnage, rewatch/tags et
     * letterboxdEntryUri=null. Ils doivent rester visibles dans VUS,
     * même si le même film existe aussi dans US, FR, UCPM ou Movie Database.
     */
    const legacyWatchDate =
      entry.watchedDate ||
      entry.entryDate ||
      '';

    const looksLikeLegacyMerylMoviesBoxEntry =
      !entry.source &&
      entry.letterboxdEntryUri == null &&
      movie.watched === true &&
      /^\d{4}-\d{2}-\d{2}/.test(
        legacyWatchDate
      ) &&
      (
        typeof entry.rewatch ===
          'boolean' ||
        Array.isArray(
          entry.tags
        )
      );

    if (
      looksLikeLegacyMerylMoviesBoxEntry
    ) {
      return true;
    }

    return false;
  }


  const diaryEntries:
    DiaryDisplayEntry[] =
    useMemo(
      () =>
        savedMovies
          .flatMap(
            (movie) =>
              (movie.diary || [])
                .filter((entry) =>
                  isExplicitVusEntry(movie, entry)
                )
                .map((entry) => ({
                  movie,
                  entry,
                }))
          )
          .sort(
            compareDiaryChronology
          ),
      [savedMovies]
    );


  const searchedDiaryEntries =
    useMemo(
      () =>
        page === 'diary' && normalizeTitle(pageSearchQuery)
          ? diaryEntries.filter((item) =>
              matchesPageSearchValues(
                getMovieDisplayTitle(item.movie),
                item.movie.title,
                item.movie.customTitle,
                item.movie.localizedTitle,
                item.movie.originalTitle,
                item.movie.tmdbTitle,
                item.movie.year,
                getDiaryWatchDate(item.entry)
              )
            )
          : diaryEntries,
      [diaryEntries, page, pageSearchQuery]
    );


  /*
   * Compteurs de navigation et total traité : auparavant chaque compteur
   * relançait un filter/map/Set sur toute la collection. Une passe unique
   * suffit et n'est rejouée que lorsque savedMovies change.
   */
  const navigationCounts =
    useMemo(
      () => {
        const topUS =
          new Set<string>();
        const topFR =
          new Set<string>();
        const soundtracks =
          new Set<string>();
        const ucpm =
          new Set<string>();
        const series =
          new Set<string>();
        const jellyfin =
          new Set<string>();
        const watchlist =
          new Set<string>();
        const processedMovies: SavedMovie[] = [];

        for (const movie of savedMovies) {
          const identity =
            movieNavigationIdentity(movie);

          if (movie.rankings?.topUS) {
            topUS.add(identity);
          }

          if (movie.rankings?.topFR) {
            topFR.add(identity);
          }

          if (movie.rankings?.soundtracks) {
            soundtracks.add(identity);
          }

          if (movie.ucpm) {
            ucpm.add(identity);
          }

          if (movie.rankings?.series) {
            series.add(identity);
          }

          if (movie.rankings?.jellyfin) {
            jellyfin.add(identity);
          }

          if (movie.watchlist) {
            watchlist.add(identity);
          }

          const isSeries =
            movie.tmdbMediaType === 'tv' ||
            Boolean(movie.rankings?.series);

          const hasExplicitVusEntry =
            (movie.diary || []).some(
              (entry) =>
                isExplicitVusEntry(
                  movie,
                  entry
                )
            );

          const isFilmInMainCatalog =
            Boolean(movie.rankings?.topUS) ||
            Boolean(movie.rankings?.topFR) ||
            Boolean(movie.ucpm) ||
            hasExplicitVusEntry ||
            Boolean(movie.rankings?.jellyfin);

          if (
            !isSeries &&
            isFilmInMainCatalog
          ) {
            /*
             * Compteur Films du bandeau : union US + FR + UCPM + VUS +
             * Movie Database, avec déduplication robuste juste en dessous.
             * Les B.O. sont comptées avec LP et les séries séparément.
             */
            processedMovies.push(movie);
          }
        }

        /*
         * Déduplication globale robuste. Une même œuvre peut exister dans
         * d'anciens imports sous plusieurs documents : l'un avec TMDb,
         * l'autre avec IMDb, voire seulement avec titre + année. On relie
         * toutes les identités connues d'une fiche puis on compte les
         * composantes uniques.
         */
        const parent = new Map<string, string>();

        const ensureAlias = (alias: string) => {
          if (!parent.has(alias)) {
            parent.set(alias, alias);
          }
        };

        const findAlias = (alias: string): string => {
          ensureAlias(alias);
          const current = parent.get(alias)!;

          if (current === alias) {
            return alias;
          }

          const root = findAlias(current);
          parent.set(alias, root);
          return root;
        };

        const unionAliases = (left: string, right: string) => {
          const leftRoot = findAlias(left);
          const rightRoot = findAlias(right);

          if (leftRoot !== rightRoot) {
            parent.set(rightRoot, leftRoot);
          }
        };

        const processedAnchors: string[] = [];

        processedMovies.forEach((movie, index) => {
          const anchor = `doc:${movie.docId || `index-${index}`}`;
          ensureAlias(anchor);
          processedAnchors.push(anchor);

          if (movie.tmdbId) {
            unionAliases(anchor, `tmdb:${movie.tmdbId}`);
          }

          const imdb = normalizeImdbIdentity(
            movie.imdbId || movie.ucpmImdbId
          );

          if (imdb) {
            unionAliases(anchor, `imdb:${imdb}`);
          }

          const year = String(movie.year || '');
          const titleCandidates = [
            movie.title,
            movie.customTitle,
            movie.localizedTitle,
            movie.originalTitle,
            movie.tmdbTitle,
            getMovieDisplayTitle(movie),
          ];

          const normalizedTitles = new Set(
            titleCandidates
              .filter(Boolean)
              .map((title) =>
                normalizeMovieTitle(String(title || ''), movie.year)
              )
              .filter(Boolean)
          );

          for (const title of normalizedTitles) {
            unionAliases(anchor, `title:${title}:${year}`);
          }
        });

        const processed = new Set(
          processedAnchors.map((anchor) => findAlias(anchor))
        );

        return {
          topUS: topUS.size,
          topFR: topFR.size,
          soundtracks: soundtracks.size,
          ucpm: ucpm.size,
          series: series.size,
          jellyfin: jellyfin.size,
          watchlist: watchlist.size,
          processed: processed.size,
        };
      },
      [savedMovies]
    );


  const navTopUSCount =
    navigationCounts.topUS;
  const navTopFRCount =
    navigationCounts.topFR;
  const navSoundtracksCount =
    navigationCounts.soundtracks;
  const navUcpmCount =
    navigationCounts.ucpm;
  const navSeriesCount =
    navigationCounts.series;
  const navJellyfinCount =
    navigationCounts.jellyfin;
  const navWatchlistCount =
    navigationCounts.watchlist;

  const diaryWatchlistPreviewMovies =
    useMemo(
      () => {
        const unique = new Map<string, SavedMovie>();

        const sourceIndex = new Map<string, number>();
        savedMovies.forEach((movie, index) => {
          sourceIndex.set(String(movie.docId), index);
        });

        savedMovies
          .filter((movie) => Boolean(movie.watchlist))
          .sort((a, b) => {
            const insertedA = addedAtMillis(a.watchlistDate ?? a.addedAt);
            const insertedB = addedAtMillis(b.watchlistDate ?? b.addedAt);

            if (insertedA !== insertedB) {
              return insertedB - insertedA;
            }

            /* Anciennes entrées : watchlistDate pouvait ne contenir que le jour.
               En cas d'égalité, on conserve l'ordre déjà fourni par la base au lieu
               de le mélanger arbitrairement. */
            return (sourceIndex.get(String(a.docId)) ?? 0) - (sourceIndex.get(String(b.docId)) ?? 0);
          })
          .forEach((movie) => {
            const identity = movieNavigationIdentity(movie);
            if (!unique.has(identity)) {
              unique.set(identity, movie);
            }
          });

        return [...unique.values()];
      },
      [savedMovies]
    );

  const processedFilmCount =
    navigationCounts.processed;


  const sortedAlbums =
    useMemo(
      () => {
        /*
         * LP : les albums restent regroupés par groupe / artiste, mais les
         * groupes sont désormais classés selon le tri demandé. Par défaut,
         * cela donne donc un classement par note : l'artiste dont le meilleur
         * album est le mieux noté apparaît en premier, et ses autres albums
         * restent immédiatement à côté, eux aussi triés par note.
         */
        const originalIndex = new Map(
          savedAlbums.map((album, index) => [album.docId, index])
        );

        const artistKey = (album: SavedAlbum) =>
          normalizeTitle(String(album.artist || '')) ||
          `__album_${album.docId}`;

        const compareAlbums = (a: SavedAlbum, b: SavedAlbum) => {
          if (
            lpSortMode === 'rating-desc' ||
            lpSortMode === 'rating-asc'
          ) {
            const ratingA =
              a.rating == null ? null : Number(a.rating);
            const ratingB =
              b.rating == null ? null : Number(b.rating);

            if (ratingA == null && ratingB != null) return 1;
            if (ratingA != null && ratingB == null) return -1;
            if (ratingA != null && ratingB != null && ratingA !== ratingB) {
              return lpSortMode === 'rating-desc'
                ? ratingB - ratingA
                : ratingA - ratingB;
            }

            const positionA =
              typeof a.position === 'number' ? a.position : 999999;
            const positionB =
              typeof b.position === 'number' ? b.position : 999999;

            if (positionA !== positionB) {
              return positionA - positionB;
            }
          }

          if (
            lpSortMode === 'year-desc' ||
            lpSortMode === 'year-asc'
          ) {
            const yearA = Number(a.year || 0);
            const yearB = Number(b.year || 0);
            if (yearA !== yearB) {
              return lpSortMode === 'year-desc'
                ? yearB - yearA
                : yearA - yearB;
            }
          }

          if (lpSortMode === 'ranking') {
            const positionA =
              typeof a.position === 'number' ? a.position : 999999;
            const positionB =
              typeof b.position === 'number' ? b.position : 999999;
            if (positionA !== positionB) {
              return positionA - positionB;
            }
          }

          return a.title.localeCompare(b.title, 'fr');
        };

        const groups = new Map<string, SavedAlbum[]>();

        savedAlbums.forEach((album) => {
          const key = artistKey(album);
          const current = groups.get(key);
          if (current) {
            current.push(album);
          } else {
            groups.set(key, [album]);
          }
        });

        const groupedAlbums = [...groups.entries()].map(([key, albums]) => {
          const sorted = [...albums].sort(compareAlbums);
          const firstOriginalIndex = Math.min(
            ...albums.map((album) => originalIndex.get(album.docId) ?? 999999)
          );

          return {
            key,
            albums: sorted,
            first: sorted[0],
            firstOriginalIndex,
          };
        });

        groupedAlbums.sort((a, b) => {
          const byLeadingAlbum = compareAlbums(a.first, b.first);
          if (byLeadingAlbum !== 0) {
            return byLeadingAlbum;
          }

          if (a.firstOriginalIndex !== b.firstOriginalIndex) {
            return a.firstOriginalIndex - b.firstOriginalIndex;
          }

          return a.key.localeCompare(b.key, 'fr');
        });

        return groupedAlbums.flatMap((group) => group.albums);
      },
      [savedAlbums, lpSortMode]
    );

  const visibleLpAlbums =
    (
      lpReorderMode
        ? lpReorderAlbums
        : sortedAlbums
    ).filter(albumMatchesPageSearch);


  const lpQuickOrder =
    useMemo(
      () =>
        new Map(
          sortedAlbums.map(
            (album, index) => [
              quickRatingKeyForAlbum(album),
              index,
            ]
          )
        ),
      [sortedAlbums]
    );


  function movieNavigationIdentity(
    movie: SavedMovie
  ) {
    const mediaType =
      movie.tmdbMediaType ||
      'movie';

    if (movie.tmdbId) {
      return `${mediaType}:tmdb:${movie.tmdbId}`;
    }

    const imdb =
      normalizeImdbIdentity(
        movie.imdbId ||
        movie.ucpmImdbId
      );

    if (imdb) {
      return `${mediaType}:imdb:${imdb}`;
    }

    return `${mediaType}:title:${normalizeMovieTitle(
      movie.title ||
      getMovieDisplayTitle(movie),
      movie.year
    )}:${String(movie.year || '')}`;
  }


  const diaryMonthNames = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ];


  const diaryGroups =
    searchedDiaryEntries.reduce<
      Array<{
        key: string;
        year: string;
        month: string;
        items: DiaryDisplayEntry[];
      }>
    >(
      (groups, item) => {
        const date =
          getDiaryWatchDate(
            item.entry
          );

        const match =
          date.match(
            /^(\d{4})-(\d{2})/
          );

        const year =
          match?.[1] ||
          'Date inconnue';

        const monthNumber =
          match?.[2] ||
          '00';

        const monthIndex =
          Number(
            monthNumber
          ) - 1;

        const month =
          monthIndex >= 0 &&
          monthIndex < 12
            ? diaryMonthNames[
                monthIndex
              ]
            : 'Mois inconnu';

        const key =
          `${year}-${monthNumber}`;

        const lastGroup =
          groups[
            groups.length - 1
          ];

        if (
          lastGroup &&
          lastGroup.key ===
            key
        ) {
          lastGroup.items.push(
            item
          );
        } else {
          groups.push({
            key,
            year,
            month,
            items: [item],
          });
        }

        return groups;
      },
      []
    );


  const diaryYears =
    Array.from(
      new Set(
        diaryGroups.map(
          (group) =>
            group.year
        )
      )
    );


  const safeDiaryYearPageIndex =
    diaryYears.length > 0
      ? Math.min(
          diaryYearPageIndex,
          diaryYears.length - 1
        )
      : 0;


  const activeDiaryYear =
    diaryYears[
      safeDiaryYearPageIndex
    ] || '';


  const baseVisibleDiaryGroups =
    activeDiaryYear
      ? diaryGroups.filter(
          (group) =>
            group.year ===
              activeDiaryYear
        )
      : [];


  /* Record mensuel VUS : calculé uniquement sur l'année affichée.
     Le total du meilleur mois est mis en rouge. */
  const diaryActiveYearRecordCount =
    baseVisibleDiaryGroups.reduce(
      (maxCount, group) =>
        Math.max(
          maxCount,
          group.items.length
        ),
      0
    );


  const visibleDiaryGroups =
    (() => {
      /* VUS reste toujours présenté par année puis par mois.
         Le mode de tri ne détruit plus les groupes : il ne fait que
         réordonner les films à l'intérieur de chaque mois. */
      if (page !== 'diary') {
        return [];
      }

      const sortItems =
        (items: DiaryDisplayEntry[]) =>
          [...items].sort(
            (a, b) => {
              if (
                diarySortMode === 'rating-desc' ||
                diarySortMode === 'rating-asc'
              ) {
                const ratingA =
                  getDiaryPriorityRating(
                    a.movie,
                    a.entry
                  );
                const ratingB =
                  getDiaryPriorityRating(
                    b.movie,
                    b.entry
                  );

                if (ratingA == null && ratingB != null) return 1;
                if (ratingA != null && ratingB == null) return -1;

                if (
                  ratingA != null &&
                  ratingB != null &&
                  Number(ratingA) !== Number(ratingB)
                ) {
                  return diarySortMode === 'rating-desc'
                    ? Number(ratingB) - Number(ratingA)
                    : Number(ratingA) - Number(ratingB);
                }

                return compareDiaryChronology(a, b);
              }

              if (
                diarySortMode === 'year-desc' ||
                diarySortMode === 'year-asc'
              ) {
                const yearA =
                  Number(a.movie.year || 0);
                const yearB =
                  Number(b.movie.year || 0);

                if (yearA === 0 && yearB !== 0) return 1;
                if (yearB === 0 && yearA !== 0) return -1;

                if (yearA !== yearB) {
                  return diarySortMode === 'year-desc'
                    ? yearB - yearA
                    : yearA - yearB;
                }

                return compareDiaryChronology(a, b);
              }

              /* Date VUS : date de visionnage Letterboxd ou date saisie
                 lors de l'ajout MerylMoviesBox, puis heure d'insertion. */
              return compareDiaryChronology(a, b);
            }
          );

      return baseVisibleDiaryGroups.map(
        (group) => ({
          ...group,
          items: sortItems(group.items),
        })
      );
    })();


  const visibleDiaryEntries =
    visibleDiaryGroups.flatMap(
      (group) =>
        group.items
    );


  type MovieMenuNavigationItem = {
    movie: SavedMovie;
    diaryEntry: DiaryEntry | null;
  };


  const movieMenuNavigationItems: MovieMenuNavigationItem[] =
    selectedMovieMenu
      ? page === 'unrated'
        ? unratedQueueItems.map((item) => ({
            movie: item.movie,
            diaryEntry: item.diaryEntry ?? null,
          }))
        : page === 'diary'
        ? visibleDiaryEntries.map((item) => ({
            movie: item.movie,
            diaryEntry: item.entry,
          }))
        : page === 'ucpm'
        ? [
            ...ucpmSixFilmsShowcaseGroups.flatMap((group) => group.movies),
            ...ucpmGridMovies,
          ].map((movie) => ({
            movie,
            diaryEntry: null,
          }))
        : (
            page === 'topUS' ||
            page === 'topFR' ||
            page === 'soundtracks' ||
            page === 'series' ||
            page === 'jellyfin' ||
            page === 'watchlist'
          )
        ? visibleListMovies.map((movie) => ({
            movie,
            diaryEntry: null,
          }))
        : savedMovies.map((movie) => ({
            movie,
            diaryEntry: null,
          }))
      : [];


  const movieMenuNavigationIndex =
    selectedMovieMenu
      ? movieMenuNavigationItems.findIndex((item) => {
          if (item.movie.docId !== selectedMovieMenu.docId) {
            return false;
          }

          if (page !== 'diary' || !selectedDiaryEntry) {
            return true;
          }

          return (
            item.diaryEntry != null &&
            diaryEntrySignature(item.diaryEntry) ===
              diaryEntrySignature(selectedDiaryEntry)
          );
        })
      : -1;


  function navigateMovieMenu(direction: -1 | 1) {
    if (
      !selectedMovieMenu ||
      savingMovieMenu ||
      movieMenuHasChanges() ||
      movieMenuNavigationIndex < 0
    ) {
      return;
    }

    const nextIndex =
      movieMenuNavigationIndex +
      direction;

    if (
      nextIndex < 0 ||
      nextIndex >= movieMenuNavigationItems.length
    ) {
      return;
    }

    const nextItem =
      movieMenuNavigationItems[nextIndex];

    openMovieMenu(
      nextItem.movie,
      nextItem.diaryEntry
    );
  }


  const progressPercent =
    enrichmentStats
      .total >
    0
      ? Math.round(
          (
            enrichmentStats
              .current /
            enrichmentStats
              .total
          ) *
            100
        )
      : 0;


  const frenchTitleProgressPercent =
    frenchTitleStats
      .total >
    0
      ? Math.round(
          (
            frenchTitleStats
              .current /
            frenchTitleStats
              .total
          ) *
            100
        )
      : 0;


  /* La section manuelle "Titres français" a été retirée de MAJ.
     Le moteur reste conservé pour compatibilité avec les anciennes données. */
  void moviesMissingFrenchTitle;
  void syncFrenchTitles;
  void stopFrenchTitleSync;
  void frenchTitleProgressPercent;
  void frenchTitleMessage;


  const filteredPosterOptions =
    posterOptions
      .filter(
        (
          poster
        ) => {
          if (
            posterFilter ===
            'all'
          ) {
            return true;
          }

          if (
            posterFilter ===
            'fr'
          ) {
            return (
              poster
                .iso_639_1 ===
              'fr'
            );
          }

          if (
            posterFilter ===
            'none'
          ) {
            return (
              poster
                .iso_639_1 ===
              null
            );
          }

          if (
            posterFilter ===
            'en'
          ) {
            return (
              poster
                .iso_639_1 ===
              'en'
            );
          }

          return (
            poster
              .iso_639_1 !==
              null &&
            poster
              .iso_639_1 !==
              'fr' &&
            poster
              .iso_639_1 !==
              'en'
          );
        }
      );


  function posterCount(
    filter:
      PosterFilter
  ) {
    if (
      filter ===
      'all'
    ) {
      return posterOptions
        .length;
    }

    return posterOptions
      .filter(
        (
          poster
        ) => {
          if (
            filter ===
            'fr'
          ) {
            return (
              poster
                .iso_639_1 ===
              'fr'
            );
          }

          if (
            filter ===
            'none'
          ) {
            return (
              poster
                .iso_639_1 ===
              null
            );
          }

          if (
            filter ===
            'en'
          ) {
            return (
              poster
                .iso_639_1 ===
              'en'
            );
          }

          return (
            poster
              .iso_639_1 !==
              null &&
            poster
              .iso_639_1 !==
              'fr' &&
            poster
              .iso_639_1 !==
              'en'
          );
        }
      )
      .length;
  }


  const filteredTitleOptions =
    titleOptions
      .filter(
        (
          option
        ) => {
          if (
            titleFilter ===
            'all'
          ) {
            return true;
          }

          return (
            getTitleOptionCategory(
              option
            ) ===
            titleFilter
          );
        }
      );


  function handleMenuSwipeStart(
    event:
      ReactTouchEvent<HTMLElement>
  ) {
    if (
      !user ||
      reorderMode ||
      selectedMovieMenu ||
      selectedPosterMovie ||
      selectedTitleMovie ||
      addTarget
    ) {
      swipeStartRef.current =
        null;
      return;
    }

    const target =
      event.target as HTMLElement;

    if (
      target.closest(
        'input, textarea, select, [contenteditable="true"], .reorderHandle'
      )
    ) {
      swipeStartRef.current =
        null;
      return;
    }

    const touch =
      event.touches[0];

    if (!touch) {
      return;
    }

    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }


  function handleMenuSwipeEnd(
    event:
      ReactTouchEvent<HTMLElement>
  ) {
    const start =
      swipeStartRef.current;

    swipeStartRef.current =
      null;

    if (
      !start ||
      !user ||
      reorderMode ||
      selectedMovieMenu ||
      selectedPosterMovie ||
      selectedTitleMovie ||
      addTarget
    ) {
      return;
    }

    const touch =
      event.changedTouches[0];

    if (!touch) {
      return;
    }

    const deltaX =
      touch.clientX -
      start.x;

    const deltaY =
      touch.clientY -
      start.y;

    const horizontalDistance =
      Math.abs(
        deltaX
      );

    const verticalDistance =
      Math.abs(
        deltaY
      );

    if (
      horizontalDistance <
        70 ||
      horizontalDistance <=
        verticalDistance *
          1.25
    ) {
      return;
    }

    const currentIndex =
      swipePages.indexOf(
        page
      );

    if (
      currentIndex < 0
    ) {
      return;
    }

    const nextIndex =
      deltaX < 0
        ? currentIndex +
          1
        : currentIndex -
          1;

    if (
      nextIndex < 0 ||
      nextIndex >=
        swipePages.length
    ) {
      return;
    }

    setPage(
      swipePages[
        nextIndex
      ]
    );
  }


  function titleCount(
    filter:
      TitleFilter
  ) {
    if (
      filter ===
      'all'
    ) {
      return titleOptions
        .length;
    }

    return titleOptions
      .filter(
        (
          option
        ) =>
          getTitleOptionCategory(
            option
          ) ===
          filter
      )
      .length;
  }


  function getListScrollTopOffset() {
    const header = document.querySelector<HTMLElement>('header');
    const headerBottom = header
      ? Math.max(0, header.getBoundingClientRect().bottom)
      : 0;

    return headerBottom + 10;
  }


  function scrollToAlignedElement(
    element: HTMLElement
  ) {
    const absoluteTop =
      element.getBoundingClientRect().top +
      window.scrollY;

    window.scrollTo({
      top: Math.max(
        0,
        absoluteTop - getListScrollTopOffset()
      ),
      behavior: 'smooth',
    });
  }


  function getCurrentScrollAnchorIndex(
    elements: HTMLElement[]
  ) {
    if (elements.length === 0) {
      return -1;
    }

    const contentTop =
      window.scrollY +
      getListScrollTopOffset() +
      4;

    let currentIndex = 0;

    for (
      let index = 0;
      index < elements.length;
      index += 1
    ) {
      const absoluteTop =
        elements[index].getBoundingClientRect().top +
        window.scrollY;

      if (absoluteTop <= contentTop) {
        currentIndex = index;
      } else {
        break;
      }
    }

    return currentIndex;
  }


  function scrollMovieListByFive(
    direction: 'up' | 'down'
  ) {
    /*
     * Navigation contextuelle :
     * - VUS avance/recul de 2 mois complets ;
     * - UCPM avance/recul de 2 podcasts ;
     * - US / FR / B.O / Séries / LP / Movie Database restent calés sur
     *   une vraie rangée d'affiches afin qu'aucune affiche ne soit coupée
     *   en haut de l'écran après le déplacement.
     */
    if (page === 'diary') {
      const monthBlocks = Array.from(
        document.querySelectorAll<HTMLElement>(
          'main .diaryMonthBlock'
        )
      ).filter((block) => {
        const rect = block.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (monthBlocks.length > 0) {
        const currentIndex =
          getCurrentScrollAnchorIndex(monthBlocks);
        const targetIndex = Math.max(
          0,
          Math.min(
            monthBlocks.length - 1,
            currentIndex +
              (direction === 'down' ? 2 : -2)
          )
        );

        scrollToAlignedElement(
          monthBlocks[targetIndex]
        );
        return;
      }
    }

    if (page === 'ucpm') {
      const podcastHeadings = Array.from(
        document.querySelectorAll<HTMLElement>(
          'main .ucpmPodcastHeading'
        )
      ).filter((heading) => {
        const rect = heading.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (podcastHeadings.length > 0) {
        const currentIndex =
          getCurrentScrollAnchorIndex(
            podcastHeadings
          );
        const targetIndex = Math.max(
          0,
          Math.min(
            podcastHeadings.length - 1,
            currentIndex +
              (direction === 'down' ? 2 : -2)
          )
        );

        scrollToAlignedElement(
          podcastHeadings[targetIndex]
        );
        return;
      }
    }

    const movieCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        page === 'lp'
          ? 'main article.movie.lpAlbumCard'
          : 'main article.movie'
      )
    ).filter((card) => {
      const rect = card.getBoundingClientRect();
      const style = window.getComputedStyle(card);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    });

    if (movieCards.length === 0) {
      return;
    }

    /* Une rangée = toutes les affiches qui partagent pratiquement le même
       top absolu. On navigue de cinq rangées mais on atterrit toujours sur
       le début exact d'une rangée, jamais au milieu d'une affiche. */
    const rows: HTMLElement[] = [];
    let lastRowTop: number | null = null;

    for (const card of movieCards) {
      const absoluteTop =
        card.getBoundingClientRect().top +
        window.scrollY;

      if (
        lastRowTop === null ||
        Math.abs(absoluteTop - lastRowTop) > 4
      ) {
        rows.push(card);
        lastRowTop = absoluteTop;
      }
    }

    const currentRowIndex =
      getCurrentScrollAnchorIndex(rows);
    const targetRowIndex = Math.max(
      0,
      Math.min(
        rows.length - 1,
        currentRowIndex +
          (direction === 'down' ? 5 : -5)
      )
    );

    scrollToAlignedElement(
      rows[targetRowIndex]
    );
  }


  const showFiveMovieScroller =
    user &&
    (
      page === 'topUS' ||
      page === 'topFR' ||
      page === 'soundtracks' ||
      page === 'ucpm' ||
      page === 'diary' ||
      page === 'series' ||
      page === 'jellyfin' ||
      page === 'watchlist' ||
      page === 'unrated'
    );


  return (
    <div
      className={[
        'app',
        GUEST_MODE ? 'guestModeActive' : '',
        reorderMode || lpReorderMode ? 'reorderActive' : '',
        multiSelectMode ? 'multiSelectModeActive' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >

      {GUEST_MODE && (
        <div
          className="guestReadOnlyBanner"
          role="status"
          aria-live="polite"
        >
          MODE INVITÉ · lecture seule · v{APP_VERSION}
        </div>
      )}

      {GUEST_MODE && guestModeError && (
        <div
          className="guestModeError"
          role="alert"
        >
          {guestModeError}
        </div>
      )}

      {showIntro && !GUEST_MODE && (

        <div
          ref={introOverlayRef}
          className={
            introFading
              ? 'introOverlay introOverlayFading'
              : 'introOverlay'
          }
          aria-label="Introduction MerylMoviesBox"
        >

          <video
            key={
              isMobileIntro
                ? 'intro-mobile'
                : 'intro-pc'
            }
            className="introVideo"
            autoPlay
            muted
            playsInline
            preload="auto"
            onCanPlay={(event) => {
              const video = event.currentTarget;

              /* Une seule correction au premier démarrage : si le navigateur
                 a déjà fait avancer la vidéo avant son premier affichage, on
                 repart de zéro sans risquer de redémarrer ensuite. */
              if (!video.dataset.introCanPlayHandled) {
                video.dataset.introCanPlayHandled = 'true';

                if (video.currentTime > 0.15 && video.currentTime < 1.5) {
                  video.currentTime = 0;
                }
              }

              void video.play().catch(() => {
                /* muted + playsInline doit normalement autoriser l'autoplay. */
              });
            }}
            onTimeUpdate={(event) => {
              const video =
                event.currentTarget;
              const remaining =
                video.duration -
                video.currentTime;

              /* Coupe uniquement la toute fin noire / silencieuse éventuelle.
                 Ne met jamais la vidéo en pause : l'intro reste fluide jusqu'à
                 son retrait immédiat. */
              if (
                Number.isFinite(remaining) &&
                video.duration > 0 &&
                remaining <= 0.35
              ) {
                finishIntro();
              }
            }}
            onEnded={
              finishIntro
            }
            onError={
              finishIntro
            }
          >
            <source
              src={
                isMobileIntro
                  ? '/intro_mobile.mp4'
                  : '/intro_pc.mp4'
              }
              type="video/mp4"
            />
          </video>

          {introPlaybackFinished && (
            <div
              className="introSiteLoading"
              role="status"
              aria-live="polite"
            >
              <span
                className="introSiteLoadingSpinner"
                aria-hidden="true"
              />
              <span>Chargement…</span>
            </div>
          )}

          <button
            type="button"
            className="introSkipButton"
            onClick={
              finishIntro
            }
          >
            Passer
          </button>

        </div>

      )}

      <header>

        <div
          className="topBanner topBannerRefreshLink"
          role="button"
          tabIndex={0}
          title="Actualisation Ctrl+(F5)"
          aria-label="Actualisation Ctrl+(F5)"
          onClick={() => {
            window.location.reload();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              window.location.reload();
            }
          }}
        >

          <div
            className="topBannerHomeButton"
          >
            <img
              key={bannerSrc}
              className="topBannerImage"
              src={
                bannerSrc
              }
              alt="MerylMoviesBox"
              draggable={
                false
              }
              onError={(
                event
              ) => {
                console.error(
                  'Erreur chargement bandeau :',
                  event.currentTarget.src
                );
              }}
            />
            <div className="bannerTopRightActions">
              <span className="siteVersionFloating">v{APP_VERSION}</span>
              <button
                type="button"
                className="topBannerMajButton"
                onClick={(event) => {
                  event.stopPropagation();
                  setPage('import');
                }}
                title="Mises à jour / Import"
              >
                MAJ
              </button>
            </div>
          </div>

          <div className="bannerCredit">
            <div className="bannerStatsLine">
            <span className="bannerCreditGroup">
              <strong className="bannerProcessedLabel">Films :</strong>
              <strong className="bannerProcessedCount">{processedFilmCount}</strong>
            </span>
            <span className="bannerCreditGroup">
              <span> / Series: </span>
              <strong className="bannerProcessedCount">{navSeriesCount}</strong>
            </span>
            <span className="bannerCreditGroup">
              <span> / LP: </span>
              <strong className="bannerProcessedCount">{savedAlbums.length + navSoundtracksCount}</strong>
            </span>
            </div>
            <span className="bannerCreditSignature">cooked with Chatgpt and I design with <span className="bannerCanvaAnchor">Canva</span> | 10/9/26</span>
          </div>

        </div>


        {user &&
          (
            page === 'topUS' ||
            page === 'topFR' ||
            page === 'soundtracks' ||
            page === 'ucpm' ||
            page === 'diary' ||
            page === 'lp' ||
            page === 'series' ||
            page === 'jellyfin' ||
            page === 'watchlist' ||
            page === 'unrated'
          ) && (

          <section
            className="headerListBar"
          >

            <div
              className="headerListTitle"
            >
              <strong>
                {page === 'topUS' && 'TOP US'}
                {page === 'topFR' && 'TOP FR'}
                {page === 'soundtracks' && 'B.O'}
                {page === 'ucpm' && 'UCPM'}
                {page === 'diary' && 'VUS'}
                {page === 'lp' && 'LP'}
                {page === 'series' && 'SÉRIES'}
                {page === 'jellyfin' && 'MovieDB'}
                {page === 'watchlist' && 'À VOIR'}
                {page === 'unrated' && 'À NOTER'}
              </strong>

              <span className="headerListCount desktopSectionCount">
                  {page === 'series'
                    ? `${navSeriesCount} série${navSeriesCount > 1 ? 's' : ''}`
                    : page === 'jellyfin'
                      ? `${navJellyfinCount} film${navJellyfinCount > 1 ? 's' : ''}`
                    : page === 'watchlist'
                      ? `${navWatchlistCount} film${navWatchlistCount > 1 ? 's' : ''}`
                    : page === 'unrated'
                      ? `${unratedQueueItems.length} film${unratedQueueItems.length > 1 ? 's' : ''}`
                    : page === 'lp'
                      ? `${savedAlbums.length} album${savedAlbums.length > 1 ? 's' : ''}`
                      : `${
                          page === 'topUS'
                            ? navTopUSCount
                            : page === 'topFR'
                              ? navTopFRCount
                              : page === 'soundtracks'
                                ? navSoundtracksCount
                                : page === 'ucpm'
                                  ? navUcpmCount
                                  : diaryEntries.length
                        } film${
                          (page === 'topUS'
                            ? navTopUSCount
                            : page === 'topFR'
                              ? navTopFRCount
                              : page === 'soundtracks'
                                ? navSoundtracksCount
                                : page === 'ucpm'
                                  ? navUcpmCount
                                  : diaryEntries.length) > 1
                            ? 's'
                            : ''
                        }`}
              </span>

            </div>

            {page === 'diary'
              ? renderDiaryHeaderControls()
              : page === 'lp'
              ? renderLpHeaderControls()
              : page === 'unrated'
              ? renderPosterSizeSelector()
              : renderListControls()}


          </section>

        )}


        {user &&
          (
            page === 'verify' ||
            page === 'search' ||
            page === 'import'
          ) && (
          <section
            className="headerListBar headerListBarPlaceholder"
            aria-hidden="true"
          />
        )}


        {user && (

          <nav>

            <div
              className="navUsWithTotal"
            >
              <button
                className={
                  page ===
                  'topUS'
                    ? 'navButton active'
                    : 'navButton'
                }
                onClick={() =>
                  setPage(
                    'topUS'
                  )
                }
                title="TOP US"
              >
                US
              </button>
            </div>


            <button
              className={
                page ===
                'topFR'
                  ? 'navButton active'
                  : 'navButton'
              }
              onClick={() =>
                setPage(
                  'topFR'
                )
              }
              title="TOP FR"
            >
              FR
            </button>


            <button
              className={
                page ===
                'soundtracks'
                  ? 'navButton active'
                  : 'navButton'
              }
              onClick={() =>
                setPage(
                  'soundtracks'
                )
              }
              title="Bandes originales"
            >
              B.O
            </button>


            <button
              className={
                page ===
                'ucpm'
                  ? 'navButton active'
                  : 'navButton'
              }
              onClick={() =>
                setPage(
                  'ucpm'
                )
              }
            >
              UCPM
            </button>


            <button
              className={
                page ===
                'diary'
                  ? 'navButton active'
                  : 'navButton'
              }
              onClick={() =>
                setPage(
                  'diary'
                )
              }
              title="Films et séries vus"
            >
              VUS
            </button>


            <button
              className={page === 'series' ? 'navButton active' : 'navButton'}
              onClick={() => setPage('series')}
              title="Séries vues"
            >
              SÉRIES
            </button>


            <button
              className={
                page === 'lp'
                  ? 'navButton active'
                  : 'navButton'
              }
              onClick={() =>
                setPage('lp')
              }
              title="Albums favoris"
            >
              LP
            </button>



            <button
              className={
                page ===
                'import'
                  ? 'navButton mobileRelocatedNavButton active'
                  : 'navButton mobileRelocatedNavButton'
              }
              onClick={() =>
                setPage(
                  'import'
                )
              }
              title="Mises à jour / Import"
            >
              MAJ
            </button>

          </nav>

        )}


        {!(
          user &&
          (
            page === 'topUS' ||
            page === 'topFR' ||
            page === 'soundtracks' ||
            page === 'ucpm' ||
            page === 'series' ||
            page === 'jellyfin' ||
            page === 'watchlist' ||
            page === 'unrated' ||
            page === 'lp' ||
            page === 'diary' ||
            page === 'verify' ||
            page === 'import'
          )
        ) && (
          <div
            className={
              user
                ? 'account accountConnected'
                : 'account accountDisconnected'
            }
          >

            {!authResolved ? (

              <button
                className="accountButton"
                type="button"
                disabled
              >
                Connexion…
              </button>

            ) : user ? (

              <button
                className="accountButton"
                onClick={
                  logout
                }
              >
                Log off
              </button>

            ) : (

              <button
                className="accountButton"
                onClick={
                  loginGoogle
                }
              >
                Log on
              </button>

            )}

          </div>
        )}


        {user && page === 'unrated' && !multiSelectMode && (
          <button
            type="button"
            className="secondaryButton unratedUndoRatingButton unratedUndoRatingFloating"
            data-quick-rating-ui="true"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            disabled={
              unratedNoteUndoStack.length === 0 ||
              Boolean(undoingUnratedNoteId)
            }
            onClick={() => {
              void undoLastUnratedRating();
            }}
            title={
              unratedNoteUndoStack.length > 0
                ? `Annuler la dernière note : ${unratedNoteUndoStack[0].title}`
                : 'Aucune note récente à annuler'
            }
          >
            {undoingUnratedNoteId
              ? '↶ Annulation…'
              : `↶ Annuler dernière note${
                  unratedNoteUndoStack.length > 0
                    ? ` (${unratedNoteUndoStack.length})`
                    : ''
                }`}
          </button>
        )}


        {user && multiSelectMode && (
          <div
            className="multiSelectFloatingBar"
            role="toolbar"
            aria-label="Sélection multiple de films"
          >
            <strong className="multiSelectCount">
              {multiSelectMovies.length} sélectionné{multiSelectMovies.length > 1 ? 's' : ''}
            </strong>

            <div className="multiSelectTargets">
              {([
                ['topUS', 'US'],
                ['topFR', 'FR'],
                ['diary', 'VUS'],
                ['watchlist', 'À VOIR'],
                ['jellyfin', 'MOVIE DB'],
              ] as const).map(([target, label]) => {
                const active = multiSelectTargetIsActive(target);
                const saving = multiSelectSavingTarget === target;

                return (
                  <button
                    key={target}
                    type="button"
                    className={`multiSelectTargetButton${active ? ' active' : ''}${target === 'jellyfin' ? ' movieDb' : ''}`}
                    disabled={
                      multiSelectMovies.length === 0 ||
                      Boolean(multiSelectSavingTarget)
                    }
                    onClick={() => void applyMultiSelectTarget(target)}
                    aria-pressed={active}
                    title={`${active ? 'Retirer la sélection de' : 'Ajouter la sélection à'} ${label}`}
                  >
                    <span>{saving ? '…' : active ? '✓' : '+'}</span>
                    {label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="multiSelectDoneButton"
              disabled={Boolean(multiSelectSavingTarget)}
              onClick={stopMultiSelectMode}
              title="Terminer la sélection multiple"
            >
              ✓ Terminer
            </button>
          </div>
        )}

      </header>


      {user && pageSupportsInlineSearch() && (
        <div
          className="pageSearchViewportDock"
          aria-label="Recherche dans la liste"
        >
          {renderPageSearchControl()}
        </div>
      )}


      {user &&
        (
          page === 'topUS' ||
          page === 'topFR' ||
          page === 'soundtracks' ||
          page === 'ucpm' ||
          page === 'diary' ||
          page === 'lp' ||
          page === 'series' ||
          page === 'jellyfin' ||
          page === 'watchlist' ||
          page === 'unrated'
        ) && (

        <div
          className="mobileBottomBar"
          aria-label="Rubrique et affichage"
        >

          <div
            className="mobileBottomSection"
          >
            <strong
              className="mobileBottomSectionTitle"
            >
              {page === 'topUS' && 'TOP US'}
              {page === 'topFR' && 'TOP FR'}
              {page === 'soundtracks' && 'B.O'}
              {page === 'ucpm' && 'UCPM'}
              {page === 'diary' && 'VUS'}
              {page === 'lp' && 'LP'}
              {page === 'series' && 'SÉRIES'}
              {page === 'jellyfin' && 'MovieDB'}
              {page === 'watchlist' && 'À VOIR'}
              {page === 'unrated' && 'À NOTER'}
            </strong>

            <span
              className="mobileBottomSectionCount"
              aria-label="Nombre d'éléments"
            >
              {page === 'topUS' && navTopUSCount}
              {page === 'topFR' && navTopFRCount}
              {page === 'soundtracks' && navSoundtracksCount}
              {page === 'ucpm' && navUcpmCount}
              {page === 'diary' && diaryEntries.length}
              {page === 'lp' && savedAlbums.length}
              {page === 'series' && navSeriesCount}
              {page === 'jellyfin' && navJellyfinCount}
              {page === 'watchlist' && navWatchlistCount}
              {page === 'unrated' && unratedQueueItems.length}
            </span>
          </div>

          {showFiveMovieScroller && (
            <div
              aria-label="Navigation de la liste"
              className="mobileBottomScrollNav"
              style={{
                gridColumn: '2',
                justifySelf: 'center',
                position: 'relative',
                zIndex: 2,
                display: 'inline-flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                width: 'fit-content',
                maxWidth: 'max-content',
                flex: '0 0 auto',
                gap: '2px',
                padding: '3px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.22)',
                background: 'var(--mmb-orange, #f55e32)',
                boxShadow: '0 3px 10px rgba(0,0,0,0.3)',
              }}
            >
              {[
                { label: '⇈', title: 'Tout en haut', action: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
                { label: '↑', title: 'Remonter dans la liste', action: () => scrollMovieListByFive('up') },
                { label: '↓', title: 'Descendre dans la liste', action: () => scrollMovieListByFive('down') },
                {
                  label: '⇊',
                  title: 'Tout en bas',
                  action: () =>
                    window.scrollTo({
                      top: Math.max(
                        document.documentElement.scrollHeight,
                        document.body.scrollHeight
                      ),
                      behavior: 'smooth',
                    }),
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="floatingFiveMovieScrollButton"
                  onClick={item.action}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = '#d40000';
                    event.currentTarget.style.borderColor = '#ff3b3b';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'rgba(12,12,14,0.9)';
                    event.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)';
                  }}
                  title={item.title}
                  aria-label={item.title}
                  style={{
                    width: '22px',
                    height: '22px',
                    minWidth: '22px',
                    minHeight: '22px',
                    padding: 0,
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.28)',
                    background: 'rgba(12,12,14,0.9)',
                    color: '#fff',
                    fontSize: '12px',
                    lineHeight: 1,
                    cursor: 'pointer',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.28)',
                    transition: 'background 120ms ease, border-color 120ms ease',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <div
            className="mobileBottomRightControls"
            style={{
              gridColumn: '3',
              justifySelf: 'end',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
            }}
          >
            <div className="mobileBottomDisplay">
              {renderPosterSizeSelector()}
            </div>

            {(currentPageSupportsManualReorder() || page === 'lp') &&
              !reorderMode &&
              !lpReorderMode && (
                <button
                  type="button"
                  className="mobileBottomReorderButton"
                  onClick={startCurrentReorder}
                >
                  Déplacer
                </button>
              )}

            {GUEST_MODE ? (
              <span
                className="mobileBottomGuestBadge"
                title="Mode invité — lecture seule"
              >
                Invité
              </span>
            ) : (
              <button
                type="button"
                className="mobileBottomLogButton"
                onClick={logout}
              >
                Log off
              </button>
            )}
          </div>

        </div>

      )}


      <main
        ref={
          posterRevealRootRef
        }
        onTouchStart={
          handleMenuSwipeStart
        }
        onTouchEnd={
          handleMenuSwipeEnd
        }
      >



        {user &&
          page === 'unrated' && (

            <>

              <div className="unratedQueueToolbar">
                <div className="sectionContentCount">
                  {unratedQueueItems.length} film{unratedQueueItems.length > 1 ? 's' : ''} sans note
                </div>

              </div>

              {unratedQueueItems.length === 0 ? (
                <section className="unratedQueueEmpty">
                  <span aria-hidden="true">★</span>
                  <strong>Tout est noté.</strong>
                  <small>Aucun film ne reste dans la file de notation.</small>
                </section>
              ) : (
                <section
                  className={`movies movies-${posterSize} unratedRatingQueue`}
                  aria-label="Films sans note"
                >
                  {unratedQueueItems.map((item) => {
                    const movie = item.movie;
                    const displayTitle = getMovieDisplayTitle(movie);
                    const posterMovie =
                      getMovieDatabasePriorityPosterMovie(movie);
                    const posterSrc = getMoviePosterSrc(
                      posterMovie,
                      posterSize === 'huge' || posterSize === 'large'
                        ? 'w500'
                        : posterSize === 'medium'
                          ? 'w342'
                          : 'w185'
                    );
                    const ratingKey =
                      getUnratedQueueRatingKey(item);
                    const existingRating =
                      getUnratedExistingRating(movie);
                    const sourceFileName =
                      getUnratedSourceFileName(movie);

                    return (
                      <article
                        className={`movie unratedQueueCard${
                          multiSelectMode && isMultiSelectMovieSelected(movie)
                            ? ' multiSelectSelected'
                            : ''
                        }`}
                        key={`${item.source}:${movie.docId}`}
                      >
                        <div className="posterHoverShell unratedQueuePosterShell">
                          <div
                            className="poster unratedQueuePoster"
                            title={`${displayTitle} · cliquer pour éditer`}
                            role="button"
                            tabIndex={0}
                            aria-label={`Éditer ${displayTitle}`}
                            onPointerDown={(event) =>
                              handleMobileMovieHoldStart(
                                event,
                                movie,
                                item.diaryEntry ?? null
                              )
                            }
                            onPointerMove={handleMobileMovieHoldMove}
                            onPointerUp={handleMobileMovieHoldEnd}
                            onPointerCancel={handleMobileMovieHoldEnd}
                            onContextMenu={(event) => {
                              event.preventDefault();
                            }}
                            onClick={(event) => {
                              if (multiSelectMode) {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleMultiSelectMovie(movie);
                                return;
                              }

                              if (
                                consumeMobileMovieHoldClick(
                                  movie,
                                  item.diaryEntry ?? null
                                )
                              ) {
                                event.preventDefault();
                                return;
                              }

                              openMovieMenu(
                                movie,
                                item.diaryEntry ?? null
                              );
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key === 'Enter' ||
                                event.key === ' '
                              ) {
                                event.preventDefault();

                                if (multiSelectMode) {
                                  toggleMultiSelectMovie(movie);
                                  return;
                                }

                                openMovieMenu(
                                  movie,
                                  item.diaryEntry ?? null
                                );
                              }
                            }}
                          >
                            {posterSrc ? (
                              <img
                                src={posterSrc}
                                alt={displayTitle}
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <span className="noPoster">
                                {displayTitle}
                              </span>
                            )}
                          </div>

                          <span className={`unratedQueueSource unratedQueueSource${item.source}`}>
                            {item.source === 'MOVIEDB' ? 'MOVIE DB' : item.source}
                          </span>

                          {renderUnratedPosterRating({
                            ratingKey,
                            currentRating:
                              existingRating?.rating ?? null,
                            ariaLabel: existingRating
                              ? `Modifier la note ${formatRating(existingRating.rating)} issue de ${existingRating.source} pour ${displayTitle}`
                              : `Noter rapidement ${displayTitle}`,
                            onSave: (ratingDraftOverride) =>
                              saveUnratedQueueRating(
                                item,
                                ratingDraftOverride ?? null
                              ),
                          })}

                          <button
                            type="button"
                            className="unratedQueueDeleteButton"
                            disabled={
                              posterEraseMovieId === movie.docId
                            }
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void removeUnratedQueueItem(item);
                            }}
                            title={`Retirer ${displayTitle} de À NOTER`}
                            aria-label={`Retirer ${displayTitle} de À NOTER`}
                          >
                            {posterEraseMovieId === movie.docId
                              ? '…'
                              : '×'}
                          </button>

                          <div className="unratedQueueCaption">
                            <div className="unratedQueueCaptionMain">
                              {sourceFileName && (
                                <span
                                  className="unratedQueueSourceFile"
                                  title={sourceFileName}
                                >
                                  Fichier : {sourceFileName}
                                </span>
                              )}
                              <strong>{displayTitle}</strong>
                            </div>
                            {movie.year != null && String(movie.year).trim() && (
                              <span>{String(movie.year)}</span>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </section>
              )}

            </>

          )}



        {user &&
          page === 'lp' && (

            <>

              {savedAlbums.length === 0 && (
                <section
                  className="emptyCollectionMessage"
                >
                  Aucun album dans LP pour le moment. Importe ton CSV depuis MAJ ou utilise « + Album ».
                </section>
              )}

              <div className="sectionContentCount">
                {savedAlbums.length} album{savedAlbums.length > 1 ? 's' : ''}
              </div>

              <section
                className={`movies movies-${posterSize} lpMovies`}
              >
                {visibleLpAlbums.map(
                  (album) => {
                    const ratingKey =
                      quickRatingKeyForAlbum(
                        album
                      );
                    const ratingIndex =
                      lpQuickOrder.get(
                        ratingKey
                      ) ?? -1;
                    const nextAlbum =
                      ratingIndex >= 0
                        ? sortedAlbums[
                            ratingIndex + 1
                          ] || null
                        : null;

                    return (
                      <article
                        className={[
                          lpReorderMode
                            ? 'movie lpAlbumCard reorderableMovie'
                            : 'movie lpAlbumCard',
                          lpReorderMode &&
                          mobileReorderFocusId === album.docId
                            ? 'mobileReorderFocus'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={album.docId}
                        data-lp-reorder-id={
                          lpReorderMode
                            ? album.docId
                            : undefined
                        }
                        draggable={lpReorderMode}
                        onDragStart={(event) => {
                          if (lpReorderMode) {
                            handleLpReorderDragStart(event, album.docId);
                          }
                        }}
                        onDragOver={(event) => {
                          if (lpReorderMode) {
                            handleLpReorderDragOver(event, album.docId);
                          }
                        }}
                      >
                        <div
                          className="posterHoverShell richPosterHoverShell"
                          data-page-search-title={`${album.title} ${album.artist} ${album.year ?? ''}`}
                        >
                        <button
                          type="button"
                          className="poster posterButton albumCover lpCoverButton"
                          onPointerDown={(event) => {
                            if (lpReorderMode) {
                              handleLpReorderPointerDown(event, album.docId);
                            }
                          }}
                          onPointerMove={(event) => {
                            if (lpReorderMode) {
                              handleLpReorderPointerMove(event);
                            }
                          }}
                          onPointerUp={(event) => {
                            if (lpReorderMode) {
                              handleLpReorderPointerUp(event);
                            }
                          }}
                          onPointerCancel={(event) => {
                            if (lpReorderMode) {
                              handleLpReorderPointerUp(event);
                            }
                          }}
                          onClick={() => {
                            if (lpReorderMode) {
                              setMobileReorderFocusId(album.docId);
                              return;
                            }

                            openLpCoverPicker(album);
                          }}
                          title={
                            lpReorderMode
                              ? `Déplacer ${album.title}`
                              : `Changer la pochette de ${album.title}`
                          }
                          aria-label={
                            lpReorderMode
                              ? `Déplacer ${album.title}`
                              : `Changer la pochette de ${album.title} — ${album.artist}`
                          }
                        >
                          {album.artworkUrl ? (
                            <img
                              src={album.artworkUrl}
                              alt={`${album.title} — ${album.artist}`}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span
                              className="noPoster lpBlankPoster"
                              aria-label="Pochette à ajouter"
                            />
                          )}
                        </button>

                          {!lpReorderMode &&
                            renderUnratedPosterRating({
                              ratingKey,
                              currentRating: album.rating ?? null,
                              ariaLabel: `Noter rapidement ${album.title} de ${album.artist}`,
                              onSave: (ratingDraftOverride) =>
                                saveQuickAlbumRating(
                                  album,
                                  ratingDraftOverride == null
                                    ? nextAlbum
                                    : null,
                                  ratingDraftOverride ?? null
                                ),
                              showRated: true,
                            })}

                          {!lpReorderMode && (
                            <div className="posterHoverPanel">
                              <strong className="posterHoverPanelTitle">
                                {album.title}
                              </strong>
                              <span className="posterHoverPanelYearTop">
                                {album.year != null && String(album.year).trim()
                                  ? String(album.year)
                                  : '—'}
                              </span>
                              <button
                                type="button"
                                className="posterHoverEraseButton"
                                disabled={posterEraseAlbumId === album.docId}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void eraseAlbumFromPoster(album);
                                }}
                              >
                                {posterEraseAlbumId === album.docId ? '...' : 'Effacer'}
                              </button>
                            </div>
                          )}
                        </div>

                      </article>
                    );
                  }
                )}

              </section>

            </>

          )}


        {user &&
          page ===
            'diary' && (

            <>

              <section
                className="diaryWatchlistPanel"
                aria-label="À voir"
              >
                <div className="diaryWatchlistHeader">
                  <div
                    className="diaryWatchlistOpenButton diaryWatchlistEmbeddedTitle"
                    aria-label="Films à voir intégrés à VUS"
                  >
                    <span className="diaryWatchlistTitle">À VOIR</span>
                    <span className="diaryWatchlistCount">
                      {navWatchlistCount} film{navWatchlistCount > 1 ? 's' : ''}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="diaryWatchlistAddButton"
                    onClick={() => openAddToSection('watchlist')}
                    title="Ajouter un film à voir"
                    aria-label="Ajouter un film à voir"
                  >
                    + Ajouter
                  </button>
                </div>

                {diaryWatchlistPreviewMovies.length > 0 ? (
                  <div
                    className="diaryWatchlistPosters movies movies-mini"
                    aria-label="Films à voir"
                  >
                    {diaryWatchlistPreviewMovies.map((movie) => {
                      const posterSrc = getMoviePosterSrc(movie, 'w342');
                      const title = getMovieDisplayTitle(movie);
                      const selected =
                        multiSelectMode && isMultiSelectMovieSelected(movie);

                      return (
                        <div
                          className={`diaryWatchlistPosterWrap movie${selected ? ' multiSelectSelected' : ''}`}
                          key={`watchlist_preview_${movie.docId}`}
                        >
                          <button
                            type="button"
                            className="diaryWatchlistPosterButton"
                            onPointerDown={(event) =>
                              handleMobileMovieHoldStart(event, movie)
                            }
                            onPointerMove={handleMobileMovieHoldMove}
                            onPointerUp={() => handleMobileMovieHoldEnd()}
                            onPointerCancel={() => handleMobileMovieHoldEnd()}
                            onContextMenu={(event) => {
                              if (window.innerWidth <= 800) {
                                event.preventDefault();
                              }
                            }}
                            onClick={(event) => {
                              if (multiSelectMode) {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleMultiSelectMovie(movie);
                                return;
                              }

                              if (consumeMobileMovieHoldClick(movie)) {
                                event.preventDefault();
                                return;
                              }

                              openMovieMenu(movie, null);
                            }}
                            title={`${title}${movie.year ? ` (${movie.year})` : ''} · clic : menu · maintien : actions`}
                            aria-label={`Ouvrir le menu de ${title}`}
                          >
                            {posterSrc ? (
                              <img
                                src={posterSrc}
                                alt={title}
                                loading="lazy"
                              />
                            ) : (
                              <span className="diaryWatchlistPosterFallback">
                                {title}
                              </span>
                            )}
                          </button>

                          <button
                            type="button"
                            className="diaryWatchlistPosterRemoveButton"
                            disabled={posterEraseMovieId === movie.docId || multiSelectMode}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void removeMovieFromWatchlist(movie);
                            }}
                            title={`Retirer ${title} de À voir`}
                            aria-label={`Retirer ${title} de À voir`}
                          >
                            {posterEraseMovieId === movie.docId ? '…' : 'Effacer'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="diaryWatchlistEmpty"
                    onClick={() => openAddToSection('watchlist')}
                  >
                    Aucun film · + Ajouter
                  </button>
                )}
              </section>

              <div className="sectionContentCount">
                {diaryEntries.length} film{diaryEntries.length > 1 ? 's' : ''}
              </div>

              {diaryYears.length > 0 && (
                <section
                  className="diaryYearPager"
                  aria-label="Navigation VUS par année"
                >
                  <button
                    type="button"
                    className="diaryYearPagerButton"
                    disabled={
                      safeDiaryYearPageIndex >=
                      diaryYears.length - 1
                    }
                    onClick={() =>
                      selectDiaryYearPage(
                        Math.min(
                          safeDiaryYearPageIndex + 1,
                          diaryYears.length - 1
                        )
                      )
                    }
                  >
                    ← {diaryYears[
                      safeDiaryYearPageIndex + 1
                    ] || 'Plus ancien'}
                  </button>

                  <div
                    className="diaryYearPagerCurrent"
                  >
                    <strong>
                      {activeDiaryYear}
                    </strong>
                    <span>
                      {visibleDiaryEntries.length}{' '}
                      visionnage{visibleDiaryEntries.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="diaryYearPagerButton"
                    disabled={
                      safeDiaryYearPageIndex === 0
                    }
                    onClick={() =>
                      selectDiaryYearPage(
                        Math.max(
                          safeDiaryYearPageIndex - 1,
                          0
                        )
                      )
                    }
                  >
                    {diaryYears[
                      safeDiaryYearPageIndex - 1
                    ] || 'Plus récent'} →
                  </button>
                </section>
              )}

              <section
                className="diaryGroupedGrid"
              >

                {visibleDiaryGroups.map(
                  (
                    group,
                    groupIndex
                  ) => {
                    const showYear =
                      groupIndex === 0 ||
                      visibleDiaryGroups[
                        groupIndex - 1
                      ].year !==
                        group.year;

                    return (
                      <Fragment
                        key={
                          group.key
                        }
                      >

                        {showYear && (
                          <h2
                            className="diaryYearHeading"
                          >
                            {group.year}
                          </h2>
                        )}

                        <div
                          className="diaryMonthBlock"
                        >

                          <h3
                            className="diaryMonthHeading"
                          >
                            {group.month}
                            <span
                              className={
                                diaryActiveYearRecordCount > 0 &&
                                group.items.length === diaryActiveYearRecordCount
                                  ? 'diaryMonthCount diaryMonthCountRecord'
                                  : 'diaryMonthCount'
                              }
                              style={
                                diaryActiveYearRecordCount > 0 &&
                                group.items.length === diaryActiveYearRecordCount
                                  ? {
                                      color: '#ff3131',
                                      fontWeight: 900,
                                    }
                                  : undefined
                              }
                            >
                              {group.items.length}
                            </span>
                          </h3>

                          <div
                            className={`movies movies-${posterSize} diaryMonthMovies`}
                          >

                            {group.items.map(
                              (
                                item,
                                index
                              ) => {
                                const diaryPosterMovie =
                                  getUsFrPriorityPosterMovie(
                                    item.movie
                                  );

                                const posterSrc =
                                  getMoviePosterSrc(
                                    diaryPosterMovie,
                                    'w500'
                                  );

                                const itemDate =
                                  item.entry
                                    .watchedDate ||
                                  item.entry
                                    .entryDate ||
                                  'Date inconnue';

                                const displayTitle =
                                  getMovieDisplayTitle(
                                    item.movie
                                  );

                                const displayItemDate =
                                  formatDiaryPosterDate(
                                    item.entry
                                  );

                                return (
                                  <article
                                    className={`movie diaryGridMovie${
                                      multiSelectMode && isMultiSelectMovieSelected(item.movie)
                                        ? ' multiSelectSelected'
                                        : ''
                                    }`}
                                    key={`${group.key}_${item.movie.docId}_${itemDate}_${index}`}
                                    data-page-search-title={`${displayTitle} ${item.movie.title ?? ''} ${item.movie.originalTitle ?? ''} ${item.movie.year ?? ''} ${itemDate}`}
                                  >

                                    <div className="posterHoverShell richPosterHoverShell diaryPosterHoverShell">
                                      <button
                                        type="button"
                                        className="poster posterButton"
                                        onPointerDown={(event) =>
                                          handleMobileMovieHoldStart(
                                            event,
                                            item.movie,
                                            item.entry
                                          )
                                        }
                                        onPointerMove={
                                          handleMobileMovieHoldMove
                                        }
                                        onPointerUp={
                                          handleMobileMovieHoldEnd
                                        }
                                        onPointerCancel={
                                          handleMobileMovieHoldEnd
                                        }
                                        onContextMenu={(event) => {
                                          if (
                                            window.innerWidth <= 800
                                          ) {
                                            event.preventDefault();
                                          }
                                        }}
                                        onClick={(event) => {
                                          if (multiSelectMode) {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            toggleMultiSelectMovie(item.movie);
                                            return;
                                          }

                                          if (
                                            consumeMobileMovieHoldClick(
                                              item.movie,
                                              item.entry
                                            )
                                          ) {
                                            event.preventDefault();
                                            return;
                                          }

                                          openMovieMenu(
                                            item.movie,
                                            item.entry
                                          );
                                        }}
                                        title={`${displayTitle} · ${itemDate}`}
                                      >

                                        {posterSrc ? (
                                          <img
                                            src={posterSrc}
                                            alt={displayTitle}
                                            loading="lazy"
                                            decoding="async"
                                          />
                                        ) : (
                                          <span className="noPoster">
                                            Affiche à récupérer
                                          </span>
                                        )}
                                      </button>

                                      {renderUnratedPosterRating({
                                        ratingKey: quickRatingKeyForDiary(
                                          item.movie,
                                          item.entry
                                        ),
                                        currentRating: getDiaryPriorityRating(
                                          item.movie,
                                          item.entry
                                        ),
                                        ariaLabel: `Noter rapidement ${displayTitle}`,
                                        onSave: (ratingDraftOverride) =>
                                          saveQuickDiaryRating(
                                            item.movie,
                                            item.entry,
                                            null,
                                            false,
                                            ratingDraftOverride ?? null
                                          ),
                                      })}

                                      <button
                                        type="button"
                                        className="posterReviewedButton"
                                        disabled={reviewSavingMovieId !== null}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          void markMovieAsReviewed(item.movie);
                                        }}
                                        title={`Ajouter un nouveau visionnage de ${displayTitle} dans VUS`}
                                        aria-label={`Revu : ajouter ${displayTitle} à VUS`}
                                      >
                                        {reviewSavingMovieId === item.movie.docId ? '…' : 'Revu'}
                                      </button>

                                      <div className="posterHoverPanel diaryPosterHoverPanel">
                                        <strong className="posterHoverPanelTitle">
                                          {displayTitle}
                                        </strong>

                                        <div className="diaryPosterHoverMeta">
                                          <span className="diaryPosterHoverDate">
                                            {displayItemDate}
                                          </span>

                                        </div>
                                      </div>
                                    </div>


                                    {item.movie.tmdbMediaType === 'tv' && (
                                      <div
                                        className="diaryMediaBadge"
                                      >
                                        Série
                                      </div>
                                    )}

                                  </article>
                                );
                              }
                            )}

                          </div>

                        </div>

                      </Fragment>
                    );
                  }
                )}

              </section>

            </>

          )}

        {user &&
          page ===
            'verify' && (

            <section
              className="verifyPage"
            >

              {!selectedVerifyMovie ? (

                <>

                  <section
                    className="hero"
                  >

                    <h1>
                      Films à rééditer
                    </h1>


                  </section>

                  <section
                    className="diarySummaryBar"
                  >
                    {moviesToVerify.length}
                    {movieDatabaseMoviesWithoutPoster.length > 0
                      ? ` · ${movieDatabaseMoviesWithoutPoster.length} sans affiche`
                      : ''}
                  </section>

                  <div
                    className="verifyBulkBar verifyBulkBarCompact"
                  >
                    <button
                      type="button"
                      className="greenButton verifyImportBasicButton"
                      onClick={() =>
                        void importBasicVerifyMovies()
                      }
                      disabled={
                        basicImportVerifyTargetCount === 0 ||
                        basicImportingVerify ||
                        bulkDeletingVerify
                      }
                      title="Import basic"
                    >
                      {basicImportingVerify
                        ? 'Basic…'
                        : 'Basic'}
                    </button>

                    {selectedVerifyMovieIds.size > 0 && (
                      <label
                        className="verifySelectAllCompact"
                        title="Tout sélectionner / tout désélectionner"
                      >
                        <input
                          type="checkbox"
                          checked={
                            moviesToVerify.length > 0 &&
                            selectedVerifyMovieIds.size === moviesToVerify.length
                          }
                          onChange={(event) => {
                            if (event.target.checked) {
                              selectAllVerifyMovies();
                            } else {
                              clearVerifyMovieSelection();
                            }
                          }}
                          disabled={
                            moviesToVerify.length === 0 ||
                            bulkDeletingVerify ||
                            basicImportingVerify
                          }
                        />
                        <span>Tous</span>
                      </label>
                    )}

                    <button
                      type="button"
                      className="verifyBulkSelectButton verifyCompactButton"
                      onClick={selectAllVerifyMovies}
                      disabled={
                        moviesToVerify.length === 0 ||
                        selectedVerifyMovieIds.size === moviesToVerify.length ||
                        bulkDeletingVerify ||
                        basicImportingVerify
                      }
                      title="Tout sélectionner"
                    >
                      Tout
                    </button>

                    <span
                      className="verifyBulkCount verifyBulkCountCompact"
                      title="Nombre sélectionné"
                    >
                      {selectedVerifyMovieIds.size}
                    </span>

                    {selectedVerifyMovieIds.size > 0 && (
                      <button
                        type="button"
                        className="verifyBulkDeleteButton verifyCompactButton"
                        onClick={() =>
                          void deleteSelectedVerifyMovies()
                        }
                        disabled={
                          bulkDeletingVerify ||
                          basicImportingVerify
                        }
                        title="Supprimer la sélection"
                      >
                        {bulkDeletingVerify ? '…' : '🗑'}
                      </button>
                    )}

                    <div
                      className="verifyViewSwitch"
                      role="group"
                      aria-label="Affichage"
                    >
                      <button
                        type="button"
                        className={
                          verifyViewMode === 'list'
                            ? 'active'
                            : ''
                        }
                        onClick={() =>
                          setVerifyViewMode('list')
                        }
                        title="Affichage en ligne"
                      >
                        ☰
                      </button>
                      <button
                        type="button"
                        className={
                          verifyViewMode === 'slideshow'
                            ? 'active'
                            : ''
                        }
                        onClick={() =>
                          setVerifyViewMode('slideshow')
                        }
                        title="Affichage en diaporama"
                      >
                        ▣
                      </button>
                    </div>
                  </div>

                  {basicImportVerifyProgress && (
                    <p
                      className="status verifyBasicImportStatus"
                    >
                      {basicImportVerifyProgress}
                    </p>
                  )}


                  {verifyViewMode === 'list' ? (
                    <div
                      className="verifyList"
                    >
                      {[...moviesToVerify]
                        .sort((a, b) =>
                          getMovieDisplayTitle(a).localeCompare(
                            getMovieDisplayTitle(b),
                            'fr'
                          )
                        )
                        .map((movie) => (
                          <div
                            key={movie.docId}
                            className={
                              selectedVerifyMovieIds.has(movie.docId)
                                ? 'verifyItem verifyItemSelected'
                                : 'verifyItem'
                            }
                          >
                            <button
                              type="button"
                              className="verifyItemMain"
                              aria-pressed={
                                selectedVerifyMovieIds.has(movie.docId)
                              }
                              onClick={() =>
                                toggleVerifyMovieSelection(movie.docId)
                              }
                            >
                              <span
                                className={
                                  selectedVerifyMovieIds.has(movie.docId)
                                    ? 'verifySelectionMark selected'
                                    : 'verifySelectionMark'
                                }
                                aria-hidden="true"
                              >
                                {selectedVerifyMovieIds.has(movie.docId)
                                  ? '✓'
                                  : ''}
                              </span>

                              <span
                                className="verifyItemIdentity"
                              >
                                <strong>
                                  {getMovieDisplayTitle(movie)}
                                </strong>
                                <span>
                                  {movie.year || '—'}
                                </span>
                                <span className="verifyIssueText">
                                  {getMovieReeditIssues(movie).join(' · ')}
                                </span>
                              </span>
                            </button>

                            <div
                              className="verifyItemButtons"
                            >
                              <button
                                type="button"
                                className="verifyEditButton verifyIconButton"
                                onClick={() => openVerifyMovie(movie)}
                                title="Corriger"
                                aria-label={`Corriger ${getMovieDisplayTitle(movie)}`}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="verifyDeleteButton verifyIconButton"
                                disabled={
                                  deletingVerifyMovieId === movie.docId ||
                                  bulkDeletingVerify
                                }
                                onClick={() =>
                                  void deleteVerifyMovie(movie)
                                }
                                title="Effacer"
                                aria-label={`Effacer ${getMovieDisplayTitle(movie)}`}
                              >
                                {deletingVerifyMovieId === movie.docId
                                  ? '…'
                                  : '×'}
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div
                      className="verifySlideshow"
                    >
                      {[...moviesToVerify]
                        .sort((a, b) =>
                          getMovieDisplayTitle(a).localeCompare(
                            getMovieDisplayTitle(b),
                            'fr'
                          )
                        )
                        .map((movie) => {
                          const posterSrc =
                            getMoviePosterSrc(
                              getUsFrPriorityPosterMovie(movie),
                              'w342'
                            );

                          return (
                            <article
                              key={movie.docId}
                              className={
                                selectedVerifyMovieIds.has(movie.docId)
                                  ? 'verifySlideCard selected'
                                  : 'verifySlideCard'
                              }
                            >
                              <button
                                type="button"
                                className="verifySlideSelect"
                                aria-pressed={
                                  selectedVerifyMovieIds.has(movie.docId)
                                }
                                onClick={() =>
                                  toggleVerifyMovieSelection(movie.docId)
                                }
                                title="Sélectionner"
                              >
                                {selectedVerifyMovieIds.has(movie.docId)
                                  ? '✓'
                                  : '○'}
                              </button>

                              <div
                                className="verifySlidePoster"
                              >
                                {posterSrc ? (
                                  <img
                                    src={posterSrc}
                                    alt={getMovieDisplayTitle(movie)}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <span
                                    className="noPoster"
                                  >
                                    Affiche à récupérer
                                  </span>
                                )}

                                <div
                                  className="verifySlideOverlay"
                                >
                                  <strong>
                                    {getMovieDisplayTitle(movie)}
                                  </strong>
                                  <span>
                                    {movie.year || ''}
                                  </span>

                                  <div
                                    className="verifySlideActions"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => openVerifyMovie(movie)}
                                    >
                                      Corriger
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openMovieMenu(movie)}
                                    >
                                      Éditer
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        basicImportingVerify ||
                                        bulkDeletingVerify
                                      }
                                      onClick={() =>
                                        void importBasicSingleVerifyMovie(movie)
                                      }
                                    >
                                      Import
                                    </button>
                                    <button
                                      type="button"
                                      className="verifySlideDeleteButton"
                                      disabled={
                                        deletingVerifyMovieId === movie.docId ||
                                        bulkDeletingVerify
                                      }
                                      onClick={() =>
                                        void deleteVerifyMovie(movie)
                                      }
                                      title="Supprimer définitivement ce film"
                                    >
                                      {deletingVerifyMovieId === movie.docId
                                        ? '…'
                                        : 'Supprimer'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                    </div>
                  )}

                </>

              ) : (

                <div
                  className="verifyEditor"
                >

                  <button
                    className="backButton"
                    onClick={() => {
                      setSelectedVerifyMovie(
                        null
                      );

                      setVerifyResults(
                        []
                      );

                      setVerifyQuery(
                        ''
                      );

                      setImdbCode(
                        ''
                      );

                      setMessage(
                        ''
                      );
                    }}
                  >
                    ← Retour aux films à rééditer
                  </button>


                  <div
                    className="verifyTitle"
                  >

                    <h1>
                      {
                        getMovieDisplayTitle(
                          selectedVerifyMovie
                        )
                      }
                    </h1>

                    <p>
                      Année :
                      {' '}
                      <strong>
                        {
                          selectedVerifyMovie.year ||
                          'inconnue'
                        }
                      </strong>
                    </p>

                  </div>


                  <button
                    type="button"
                    className="dangerButton verifyDeleteEditorButton"
                    disabled={
                      deletingVerifyMovieId ===
                        selectedVerifyMovie.docId
                    }
                    onClick={() =>
                      void deleteVerifyMovie(
                        selectedVerifyMovie
                      )
                    }
                  >
                    {deletingVerifyMovieId === selectedVerifyMovie.docId
                      ? 'Suppression…'
                      : 'Supprimer définitivement ce film'}
                  </button>


                  <div
                    className="imdbLookupBox"
                  >

                    <h2>
                      IMDb exact
                    </h2>

                    <p>
                      Code IMDb ou URL IMDb.
                    </p>

                    <form
                      className="imdbSearch"
                      onSubmit={
                        searchByImdbCode
                      }
                    >

                      <input
                        value={
                          imdbCode
                        }
                        onChange={(
                          e
                        ) =>
                          setImdbCode(
                            e.target.value
                          )
                        }
                        placeholder="tt0110912 ou URL IMDb"
                      />

                      <button
                        type="submit"
                        disabled={
                          imdbLookupLoading
                        }
                      >
                        {imdbLookupLoading
                          ? 'Recherche...'
                          : 'Trouver avec IMDb'}
                      </button>

                    </form>

                  </div>


                  <div
                    className="verifySeparator"
                  >
                    Titre
                  </div>


                  <form
                    className="search"
                    onSubmit={(
                      event
                    ) => {
                      event
                        .preventDefault();

                      searchVerifyCandidates();
                    }}
                  >

                    <input
                      value={
                        verifyQuery
                      }
                      onChange={(
                        e
                      ) =>
                        setVerifyQuery(
                          e.target.value
                        )
                      }
                      placeholder="Titre, ID IMDb ou URL IMDb..."
                    />

                    <button
                      type="submit"
                    >
                      Rechercher
                    </button>

                  </form>


                  {message && (

                    <p
                      className="status"
                    >
                      {message}
                    </p>

                  )}


                  {verifyLoading && (

                    <p
                      className="status"
                    >
                      Recherche TMDb...
                    </p>

                  )}


                  <div
                    className="verifyCandidates"
                  >

                    {verifyResults
                      .map(
                        (
                          candidate
                        ) => (

                          <article
                            className="verifyCandidate"
                            key={
                              candidate.id
                            }
                          >

                            <div
                              className="verifyPoster"
                            >

                              {candidate.poster_path ? (

                                <img
                                  src={`https://image.tmdb.org/t/p/w342${candidate.poster_path}`}
                                  alt={
                                    candidate.title
                                  }
                                  loading="lazy"
                                />

                              ) : (

                                <div
                                  className="noPoster"
                                >
                                  Pas d'affiche
                                </div>

                              )}

                            </div>


                            <div
                              className="verifyCandidateInfo"
                            >

                              <h3>
                                {
                                  candidate.title
                                }
                              </h3>


                              {candidate.original_title &&
                                candidate.original_title !==
                                  candidate.title && (

                                  <p
                                    className="originalTitle"
                                  >
                                    Titre original :
                                    {' '}
                                    {
                                      candidate.original_title
                                    }
                                  </p>

                                )}


                              <div
                                className="candidateYear"
                              >
                                {candidate.release_date
                                  ? candidate.release_date
                                      .substring(
                                        0,
                                        4
                                      )
                                  : 'Année inconnue'}
                              </div>


                              {candidate.overview && (

                                <p
                                  className="candidateOverview"
                                >
                                  {
                                    candidate.overview
                                  }
                                </p>

                              )}


                              <button
                                className="greenButton"
                                disabled={
                                  associatingMovie ===
                                  candidate.id
                                }
                                onClick={() =>
                                  associateTmdbMovie(
                                    candidate
                                  )
                                }
                              >
                                {associatingMovie ===
                                candidate.id
                                  ? 'Association...'
                                  : 'Associer ce film'}
                              </button>

                            </div>

                          </article>

                        )
                      )}

                  </div>

                </div>

              )}

            </section>

          )}


        {user &&
          page ===
            'import' && (

            <section
              className="importPage"
            >

              <h1>
                Sauvegarde
              </h1>


              {false && (
              <div
                className="backupImportGrid"
              >

                <section
                  className="importSection importCompactCard importBackupCard"
                >
                  <h2>Restaurer</h2>
                  <p>Restaurer une sauvegarde JSON.</p>

                  <label className="importButton">
                    {restoringBackup
                      ? 'Mise à jour…'
                      : 'Mettre à jour'}

                    <input
                      type="file"
                      accept=".json,application/json"
                      hidden
                      disabled={restoringBackup}
                      onChange={restoreBackup}
                    />
                  </label>
                </section>


                <section
                  className="importSection importCompactCard"
                >
                  <h2>Letterboxd</h2>
                  <p>Import de l’export Letterboxd.</p>

                  <label className="importButton">
                    {importing
                      ? 'Import…'
                      : 'JSON Letterboxd'}

                    <input
                      type="file"
                      accept=".json,application/json"
                      disabled={importing}
                      onChange={importLetterboxd}
                      hidden
                    />
                  </label>

                  {importProgress && (
                    <div className="importProgress">
                      {importProgress}
                    </div>
                  )}
                </section>


                <section
                  className="importSection importCompactCard"
                >
                  <h2>Diary</h2>
                  <p>Import des visionnages.</p>

                  <label className="importButton">
                    {diaryCsvImporting
                      ? 'Import…'
                      : 'CSV Diary'}

                    <input
                      type="file"
                      accept=".csv,.tsv,text/csv,text/tab-separated-values"
                      disabled={diaryCsvImporting}
                      onChange={importDiaryCsv}
                      hidden
                    />
                  </label>

                  {diaryCsvImportProgress && (
                    <div className="importProgress">
                      {diaryCsvImportProgress}
                    </div>
                  )}
                </section>


                <section
                  className="importSection importCompactCard"
                >
                  <h2>LP</h2>
                  <p>{savedAlbums.length} albums enregistrés.</p>

                  <label className="importButton">
                    {lpCsvImporting
                      ? 'Import…'
                      : 'CSV LP'}

                    <input
                      type="file"
                      accept=".csv,.tsv,text/csv,text/tab-separated-values"
                      disabled={lpCsvImporting}
                      onChange={importLpCsv}
                      hidden
                    />
                  </label>

                  {lpCsvImportProgress && (
                    <div className="importProgress">
                      {lpCsvImportProgress}
                    </div>
                  )}
                </section>


                <section
                  className="importSection importCompactCard"
                >
                  <h2>UCPM</h2>
                  <p>{ucpmMovies.length} films enregistrés.</p>

                  <label className="importButton">
                    {ucpmImporting
                      ? 'Import…'
                      : 'CSV UCPM'}

                    <input
                      type="file"
                      accept=".csv,.tsv,text/csv,text/tab-separated-values"
                      disabled={ucpmImporting}
                      onChange={importUcpm}
                      hidden
                    />
                  </label>

                  {ucpmImportProgress && (
                    <div className="importProgress">
                      {ucpmImportProgress}
                    </div>
                  )}
                </section>


                <section
                  className="importSection importCompactCard"
                >
                  <h2>Jellyfin</h2>
                  <p>{navJellyfinCount} films enregistrés.</p>

                  <label className="importButton">
                    {jellyfinImporting
                      ? 'Mise à jour…'
                      : 'Mise à jour Jellyfin'}

                    <input
                      type="file"
                      accept=".csv,.tsv,text/csv,text/tab-separated-values"
                      disabled={jellyfinImporting}
                      onChange={importJellyfinCsv}
                      hidden
                    />
                  </label>

                  {jellyfinImportProgress && (
                    <div className="importProgress">
                      {jellyfinImportProgress}
                    </div>
                  )}
                </section>

              </div>
              )}


              <section
                className="importBackupActionsCompact"
                aria-label="Sauvegardes"
              >
                <button
                  className="greenButton importBackupStandaloneButton"
                  type="button"
                  onClick={createBackup}
                  disabled={restoringBackup}
                >
                  Save
                </button>

                <label
                  className="importButton importBackupStandaloneButton"
                  aria-disabled={restoringBackup}
                >
                  {restoringBackup
                    ? '…'
                    : 'Restaurer'}

                  <input
                    type="file"
                    accept=".json,application/json"
                    hidden
                    disabled={restoringBackup}
                    onChange={restoreBackup}
                  />
                </label>

                <button
                  className="secondaryButton importBackupStandaloneButton"
                  type="button"
                  onClick={() =>
                    void restoreLastAutomaticBackup()
                  }
                  disabled={
                    restoringBackup ||
                    !lastAutoBackupAt
                  }
                  title={
                    lastAutoBackupAt
                      ? `Dernière sauvegarde automatique : ${new Date(lastAutoBackupAt).toLocaleString('fr-FR')}`
                      : 'Aucune sauvegarde automatique disponible'
                  }
                >
                  ↶ Dernière
                </button>
              </section>


              <section
                className="importMaintenanceActionsCompact"
                aria-label="Outils"
              >
                <button
                  className="secondaryButton importMaintenanceButton"
                  type="button"
                  onClick={() => {
                    setHistoryOpen(false);
                    setPage('verify');
                    window.scrollTo({
                      top: 0,
                      behavior: 'smooth',
                    });
                  }}
                  title="Contrôle d’intégrité : films incomplets à rééditer"
                >
                  Film à rééditer
                  {moviesToVerify.length > 0 && (
                    <span className="importMaintenanceCount">
                      {moviesToVerify.length}
                    </span>
                  )}
                </button>

                <button
                  className="secondaryButton importMaintenanceButton"
                  type="button"
                  onClick={() => {
                    setRecentAddedOpen(false);
                    setHistoryOpen(true);
                  }}
                  title="Restaurer une action récente, y compris une suppression"
                >
                  Corbeille / Annuler
                  {actionHistory.length > 0 && (
                    <span className="importMaintenanceCount">
                      {actionHistory.length}
                    </span>
                  )}
                </button>

                <label
                  className={
                    importing
                      ? 'secondaryButton importMaintenanceButton importLetterboxdCsvButton disabled'
                      : 'secondaryButton importMaintenanceButton importLetterboxdCsvButton'
                  }
                  title="Importer un ou plusieurs CSV standards exportés depuis Letterboxd (Diary, Ratings, Watched, Watchlist, Reviews)"
                >
                  {importing
                    ? 'Import…'
                    : 'Import CSV Letterboxd'}

                  <input
                    type="file"
                    accept=".csv,.tsv,text/csv,text/tab-separated-values"
                    multiple
                    hidden
                    disabled={importing}
                    onChange={importLetterboxdCsv}
                  />
                </label>

                <button
                  className="secondaryButton importMaintenanceButton importLetterboxdExportButton"
                  type="button"
                  onClick={exportLetterboxdCsv}
                  title="Exporter US, FR, B.O., UCPM, VUS et Movie Database dans un CSV compatible Letterboxd"
                >
                  Export CSV Letterboxd
                </button>
              </section>


              {importProgress && (
                <div className="importProgress importLetterboxdCsvProgress">
                  {importProgress}
                </div>
              )}


              {backupMessage && (
                backupMessage === 'Sauvegarde automatique créée avant le dernier ajout.' ? (
                  <button
                    className="importProgress importBackupStandaloneProgress importAutoBackupRestoreLink"
                    type="button"
                    onClick={restoreLastAutomaticBackup}
                    disabled={restoringBackup}
                    title="Restaurer la dernière sauvegarde automatique"
                  >
                    {restoringBackup
                      ? 'Restauration…'
                      : backupMessage}
                  </button>
                ) : (
                  <div className="importProgress importBackupStandaloneProgress">
                    {backupMessage}
                  </div>
                )
              )}


              {false && (importing ||
                Boolean(importProgress) ||
                diaryCsvImporting ||
                Boolean(diaryCsvImportProgress) ||
                ucpmImporting ||
                Boolean(ucpmImportProgress) ||
                jellyfinImporting ||
                Boolean(jellyfinImportProgress)) && (
                <>

              <hr
                className="separator"
              />


              <h2>
                Affiches et données TMDb
              </h2>


              <div
                className="tmdbStats"
              >

                <div>

                  <strong>
                    {
                      moviesWithoutTmdb
                    }
                  </strong>

                  <span>
                    Sans TMDb
                  </span>

                </div>


                <div
                  className={
                    pendingTmdbOpen
                      ? 'tmdbPendingStat active'
                      : 'tmdbPendingStat'
                  }
                >
                  <button
                    type="button"
                    className="tmdbPendingStatButton"
                    disabled={moviesPendingTmdb === 0}
                    onClick={() =>
                      setPendingTmdbOpen(
                        (open) => !open
                      )
                    }
                    title={
                      moviesPendingTmdb > 0
                        ? 'Afficher les films à traiter'
                        : 'Aucun film à traiter'
                    }
                  >
                    <strong>
                      {
                        moviesPendingTmdb
                      }
                    </strong>

                    <span>
                      À traiter
                    </span>
                  </button>
                </div>


                <div>

                  <strong>
                    {
                      moviesToVerify.length
                    }
                  </strong>

                  <span>
                    À vérifier
                  </span>

                </div>

              </div>


              {pendingTmdbOpen &&
                moviesPendingTmdbList.length > 0 && (

                <section
                  className="pendingTmdbPanel"
                >
                  <div
                    className="pendingTmdbHeader"
                  >
                    <div
                      className="pendingTmdbTitle"
                    >
                      <strong>
                        {moviesPendingTmdbList.length}
                      </strong>
                      <span>
                        film{moviesPendingTmdbList.length > 1 ? 's' : ''} à traiter
                      </span>
                    </div>

                    <div
                      className="pendingTmdbBulkActions"
                    >
                      <label
                        className="pendingTmdbSelectAll"
                      >
                        <input
                          type="checkbox"
                          checked={
                            moviesPendingTmdbList.length > 0 &&
                            selectedPendingTmdbIds.size === moviesPendingTmdbList.length
                          }
                          onChange={(event) => {
                            if (event.target.checked) {
                              selectAllPendingTmdbMovies();
                            } else {
                              clearPendingTmdbSelection();
                            }
                          }}
                          disabled={deletingPendingTmdb}
                        />
                        <span>Tous</span>
                      </label>

                      <span
                        className="pendingTmdbSelectedCount"
                      >
                        {selectedPendingTmdbIds.size}
                      </span>

                      <button
                        type="button"
                        className="dangerButton pendingTmdbDeleteSelected"
                        disabled={
                          selectedPendingTmdbIds.size === 0 ||
                          deletingPendingTmdb
                        }
                        onClick={() =>
                          void deleteSelectedPendingTmdbMovies()
                        }
                      >
                        {deletingPendingTmdb
                          ? 'Suppression…'
                          : 'Supprimer la sélection'}
                      </button>

                      <button
                        type="button"
                        className="dangerButton pendingTmdbDeleteAll"
                        disabled={
                          moviesPendingTmdbList.length === 0 ||
                          deletingPendingTmdb
                        }
                        onClick={() =>
                          void deleteAllPendingTmdbMovies()
                        }
                        title="Supprimer tous les films à traiter"
                      >
                        {deletingPendingTmdb
                          ? 'Suppression…'
                          : `Supprimer les ${moviesPendingTmdbList.length}`}
                      </button>

                      <button
                        type="button"
                        className="pendingTmdbClose"
                        onClick={() =>
                          setPendingTmdbOpen(false)
                        }
                        title="Fermer"
                        aria-label="Fermer la liste À traiter"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div
                    className="pendingTmdbList"
                  >
                    {[...moviesPendingTmdbList]
                      .sort((a, b) =>
                        getMovieDisplayTitle(a).localeCompare(
                          getMovieDisplayTitle(b),
                          'fr'
                        )
                      )
                      .map((movie) => (
                        <div
                          key={movie.docId}
                          className={
                            selectedPendingTmdbIds.has(movie.docId)
                              ? 'pendingTmdbItem selected'
                              : 'pendingTmdbItem'
                          }
                        >
                          <label
                            className="pendingTmdbItemMain"
                          >
                            <input
                              type="checkbox"
                              checked={
                                selectedPendingTmdbIds.has(movie.docId)
                              }
                              onChange={() =>
                                togglePendingTmdbSelection(movie.docId)
                              }
                              disabled={
                                deletingPendingTmdb ||
                                deletingPendingTmdbId === movie.docId
                              }
                            />

                            <span
                              className="pendingTmdbIdentity"
                            >
                              <strong>
                                {getMovieDisplayTitle(movie)}
                              </strong>
                              <span>
                                {movie.year || '—'}
                                {' · '}
                                {movie.tmdbId
                                  ? 'sans affiche'
                                  : 'sans TMDb'}
                              </span>
                            </span>
                          </label>

                          <div
                            className="pendingTmdbItemActions"
                          >
                            <button
                              type="button"
                              className="pendingTmdbEditButton"
                              onClick={() =>
                                void editPendingTmdbMovie(movie)
                              }
                              title="Corriger ce film"
                              aria-label={`Corriger ${getMovieDisplayTitle(movie)}`}
                            >
                              ✎
                            </button>

                            <button
                              type="button"
                              className="pendingTmdbDeleteButton"
                              disabled={
                                deletingPendingTmdb ||
                                deletingPendingTmdbId === movie.docId
                              }
                              onClick={() =>
                                void deletePendingTmdbMovie(movie)
                              }
                              title="Supprimer ce film"
                              aria-label={`Supprimer ${getMovieDisplayTitle(movie)}`}
                            >
                              {deletingPendingTmdbId === movie.docId
                                ? '…'
                                : '×'}
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </section>

              )}


              <div
                className="enrichmentButtons"
              >

                <button
                  className="greenButton"
                  disabled={
                    enriching ||
                    moviesPendingTmdb ===
                      0
                  }
                  onClick={() =>
                    enrichMovies(
                      50
                    )
                  }
                >
                  Enrichir les 50 prochains
                </button>


                <button
                  className="greenButton"
                  disabled={
                    enriching ||
                    moviesPendingTmdb ===
                      0
                  }
                  onClick={() =>
                    enrichMovies()
                  }
                >
                  Enrichir tous les films
                </button>


                {enriching && (

                  <button
                    className="stopButton"
                    onClick={
                      stopEnrichment
                    }
                  >
                    Arrêter
                  </button>

                )}

              </div>


              {(enriching ||
                enrichmentStats.total >
                  0) && (

                <div
                  className="enrichmentPanel"
                >

                  <div
                    className="progressHeader"
                  >

                    <span>
                      {
                        enrichmentStats.current
                      }
                      {' / '}
                      {
                        enrichmentStats.total
                      }
                    </span>

                    <strong>
                      {
                        progressPercent
                      }
                      %
                    </strong>

                  </div>


                  <div
                    className="progressBar"
                  >

                    <div
                      className="progressFill"
                      style={{
                        width:
                          `${progressPercent}%`,
                      }}
                    />

                  </div>


                  <p
                    className="currentMovie"
                  >
                    Film actuel :
                    {' '}
                    <strong>
                      {
                        enrichmentStats.currentMovie
                      }
                    </strong>
                  </p>


                  <div
                    className="progressCounters"
                  >

                    <span>
                      ✓ Trouvés :
                      {' '}
                      {
                        enrichmentStats.matched
                      }
                    </span>

                    <span>
                      ? À vérifier :
                      {' '}
                      {
                        enrichmentStats.unmatched
                      }
                    </span>

                    <span>
                      ⚠ Erreurs :
                      {' '}
                      {
                        enrichmentStats.errors
                      }
                    </span>

                  </div>

                </div>

              )}


              {enrichmentMessage && (

                <div
                  className="importProgress"
                >
                  {
                    enrichmentMessage
                  }
                </div>

              )}

                </>
              )}


              {/* Titres français : section retirée de MAJ. */}

            </section>

          )}


        {user &&
          page ===
            'search' && (

            <>

              <section
                className="hero"
              >

                <h1>
                  Rechercher un film
                </h1>


                <form
                  className="search"
                  onSubmit={
                    searchMovies
                  }
                >

                  <input
                    value={
                      query
                    }
                    onChange={(
                      e
                    ) =>
                      setQuery(
                        e.target.value
                      )
                    }
                    placeholder="Titre, ID IMDb ou URL IMDb..."
                  />

                  <button
                    type="submit"
                  >
                    Rechercher
                  </button>

                </form>


                {loading && (

                  <p
                    className="status"
                  >
                    Recherche...
                  </p>

                )}


                {message && (

                  <p
                    className="status"
                  >
                    {message}
                  </p>

                )}

              </section>


              <section
                className="movies movies-large"
              >

                {searchResults
                  .map(
                    (
                      movie
                    ) => {

                      const added =
                        movieIsSaved(
                          movie
                        );

                      const adding =
                        addingMovie ===
                        movie.id;

                      return (

                        <article
                          className="movie"
                          key={
                            movie.id
                          }
                        >

                          <div
                            className="poster"
                          >

                            {movie.poster_path ? (

                              <img
                                src={`https://image.tmdb.org/t/p/w500${movie.poster_path}`}
                                alt={
                                  movie.title
                                }
                                loading="lazy"
                                decoding="async"
                              />

                            ) : (

                              <div
                                className="noPoster"
                              >
                                Pas d'affiche
                              </div>

                            )}

                          </div>


                          <h2>
                            {
                              movie.title
                            }
                          </h2>


                          <p
                            className="year"
                          >
                            {movie.release_date
                              ? movie.release_date
                                  .substring(
                                    0,
                                    4
                                  )
                              : '—'}
                          </p>


                          <button
                            className="addButton"
                            disabled={
                              added ||
                              adding
                            }
                            onClick={() =>
                              addMovie(
                                movie
                              )
                            }
                          >
                            {added
                              ? '✓ Ajouté'
                              : adding
                              ? 'Ajout...'
                              : '+ Ajouter'}
                          </button>

                        </article>

                      );
                    }
                  )}

              </section>

            </>

          )}


        {user &&
          (
            page ===
              'topUS' ||
            page ===
              'topFR' ||
            page ===
              'soundtracks' ||
            page ===
              'ucpm' ||
            page ===
              'series' ||
            page ===
              'jellyfin' ||
            page ===
              'watchlist'
          ) && (

            <>

              <section
                className="hero heroWithControls legacyListHero"
              >

                <div
                  className="listHeroText"
                >

                  <div
                    className="mobileTitleRow"
                  >

                    <h1>

                      {page ===
                        'topUS' &&
                        'TOP US'}

                      {page ===
                        'topFR' &&
                        'TOP FR'}

                      {page ===
                        'soundtracks' &&
                        'Soundtracks'}

                      {page ===
                        'ucpm' &&
                        'UCPM'}

                      {page === 'series' && 'SÉRIES'}

                      {page === 'jellyfin' && 'MovieDB'}

                      {page === 'watchlist' && 'À VOIR'}


                    </h1>

                  </div>


                </div>


                {
                  renderListControls()
                }

              </section>


              <div className="sectionContentCount">
                {page === 'series'
                  ? `${navSeriesCount} série${navSeriesCount > 1 ? 's' : ''}`
                  : page === 'jellyfin'
                  ? `${navJellyfinCount} film${navJellyfinCount > 1 ? 's' : ''}`
                  : page === 'watchlist'
                  ? `${navWatchlistCount} film${navWatchlistCount > 1 ? 's' : ''}`
                  : `${
                      page === 'topUS'
                        ? navTopUSCount
                        : page === 'topFR'
                          ? navTopFRCount
                          : page === 'soundtracks'
                            ? navSoundtracksCount
                            : navUcpmCount
                    } film${
                      (page === 'topUS'
                        ? navTopUSCount
                        : page === 'topFR'
                          ? navTopFRCount
                          : page === 'soundtracks'
                            ? navSoundtracksCount
                            : navUcpmCount) > 1
                        ? 's'
                        : ''
                    }` }
              </div>

              {page === 'ucpm' && (
                <section
                  className="ucpmSixFilmsShowcase"
                  aria-label="Parties 6 films"
                >
                  {isMobileBanner &&
                    ucpmSixFilmsShowcaseGroups.length > 0 && (
                      <div
                        className="ucpmSixFilmsMobileButtons"
                        role="tablist"
                        aria-label="Choisir un bloc 6 films"
                      >
                        {ucpmSixFilmsShowcaseGroups.map((group) => (
                          <button
                            key={`ucpm-sixfilms-toggle-${group.number}`}
                            type="button"
                            className={`ucpmSixFilmsMobileToggle${
                              mobileUcpmSixFilmsOpenNumber === group.number
                                ? ' active'
                                : ''
                            }`}
                            onClick={() =>
                              setMobileUcpmSixFilmsOpenNumber((current) =>
                                current === group.number ? null : group.number
                              )
                            }
                            aria-pressed={
                              mobileUcpmSixFilmsOpenNumber === group.number
                            }
                            aria-controls={`ucpm-sixfilms-panel-${group.number}`}
                          >
                            {`6 films #${group.number}`}
                          </button>
                        ))}
                      </div>
                    )}

                  {(isMobileBanner
                    ? ucpmSixFilmsShowcaseGroups.filter(
                        (group) =>
                          group.number === mobileUcpmSixFilmsOpenNumber
                      )
                    : ucpmSixFilmsShowcaseGroups
                  ).map((group) => (
                    <article
                      key={group.number}
                      id={`ucpm-sixfilms-panel-${group.number}`}
                      className="ucpmSixFilmsGroupBubble"
                    >
                      <div className="ucpmSixFilmsActions">
                        <button
                          type="button"
                          className="ucpmSixFilmsEditButton"
                          disabled={
                            deletingUcpmSixFilmsGroup !== null ||
                            ucpmComposerSaving
                          }
                          onClick={() => openEditUcpmSixFilmsGroup(group)}
                          title={`Modifier 6 films #${group.number}`}
                          aria-label={`Modifier 6 films #${group.number}`}
                        >
                          Modifier
                        </button>

                        <button
                          type="button"
                          className="ucpmSixFilmsDeleteButton"
                          disabled={deletingUcpmSixFilmsGroup !== null}
                          onClick={() => void deleteUcpmSixFilmsGroup(group)}
                          title={`Supprimer 6 films #${group.number}`}
                          aria-label={`Supprimer 6 films #${group.number}`}
                        >
                          {deletingUcpmSixFilmsGroup === group.number ? '…' : '×'}
                        </button>
                      </div>

                      <div className="ucpmSixFilmsTopItem">
                        {`6 films #${group.number}`}
                      </div>

                      <div className="ucpmSixFilmsPosterRow">
                        {group.movies.map((movie) => {
                          const posterSrc = getListPosterSrc(movie, 'w185');
                          const title = getListDisplayTitle(movie);

                          return (
                            <div
                              key={movie.docId}
                              className={`ucpmSixFilmsPosterShell${
                                multiSelectMode && isMultiSelectMovieSelected(movie)
                                  ? ' multiSelectSelected'
                                  : ''
                              }`}
                              data-page-search-title={`${title} ${movie.title ?? ''} ${movie.originalTitle ?? ''} ${movie.year ?? ''}`}
                            >
                              <button
                                type="button"
                                className="ucpmSixFilmsPoster"
                                onClick={(event) => {
                                  if (multiSelectMode) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    toggleMultiSelectMovie(movie);
                                    return;
                                  }

                                  const rect = event.currentTarget.getBoundingClientRect();
                                  setMobileMovieAction({
                                    movie,
                                    diaryEntry: null,
                                    anchorRect: {
                                      left: rect.left,
                                      right: rect.right,
                                      top: rect.top,
                                      bottom: rect.bottom,
                                    },
                                  });
                                }}
                                title={title}
                                aria-label={`Ouvrir ${title}`}
                              >
                                {posterSrc ? (
                                  <img
                                    src={posterSrc}
                                    alt={title}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <span className="ucpmSixFilmsNoPoster">
                                    {title}
                                  </span>
                                )}
                              </button>

                              {renderUnratedPosterRating({
                                ratingKey: quickRatingKeyForList(
                                  movie,
                                  'ucpm'
                                ),
                                currentRating: getQuickListRating(
                                  movie,
                                  'ucpm'
                                ),
                                ariaLabel: `Noter rapidement ${title}`,
                                onSave: (ratingDraftOverride) =>
                                  saveQuickListRating(
                                    movie,
                                    'ucpm',
                                    null,
                                    false,
                                    ratingDraftOverride ?? null
                                  ),
                                showRated: true,
                              })}

                              {!isMobileIntro && !isMobileBanner && (
                                <button
                                  type="button"
                                  className="posterReviewedButton ucpmSixFilmsReviewedButton"
                                  disabled={reviewSavingMovieId !== null}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void markMovieAsReviewed(movie);
                                  }}
                                  title={`Ajouter un nouveau visionnage de ${title} dans VUS`}
                                  aria-label={`Revu : ajouter ${title} à VUS`}
                                >
                                  {reviewSavingMovieId === movie.docId ? '…' : 'Revu'}
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {group.movies.length === 0 && (
                          <span className="ucpmSixFilmsEmpty">—</span>
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              )}


              <section
                className={`movies movies-${posterSize}`}
              >

                {renderedGridMovies
                  .map(
                    (
                      movie,
                      index
                    ) => {

                      const posterSrc =
                        getListPosterSrc(
                          movie,
                          posterSize === 'huge' || posterSize === 'large'
                            ? 'w500'
                            : posterSize === 'medium'
                              ? 'w342'
                              : 'w185'
                        );

                      const displayTitle =
                        getListDisplayTitle(
                          movie
                        );

                      const hoverRating =
                        page === 'soundtracks'
                          ? movie.soundtrackRating ?? null
                          : page === 'jellyfin'
                            ? getMovieDatabaseEffectiveRating(movie)
                            : page === 'ucpm'
                              ? getUcpmCanonicalMovie(movie).rating ?? null
                              : movie.rating ?? null;

                      const hoverTitle = displayTitle;


                      const richPosterHover =
                        page === 'topUS' ||
                        page === 'topFR' ||
                        page === 'soundtracks' ||
                        page === 'series' ||
                        page === 'jellyfin' ||
                        page === 'watchlist';

                      const hoverYear =
                        movie.year != null && String(movie.year).trim()
                          ? String(movie.year)
                          : '—';

                      const ucpmPodcastGroup =
                        groupMoviesByUcpmPodcast
                          ? getUcpmPodcastGroup(
                              movie
                            )
                          : null;

                      const ucpmPodcastKey =
                        getUcpmPodcastGroupKey(
                          ucpmPodcastGroup
                        );

                      const previousUcpmPodcastKey =
                        groupMoviesByUcpmPodcast &&
                        index > 0
                          ? getUcpmPodcastGroupKey(
                              getUcpmPodcastGroup(
                                ucpmGridMovies[
                                  index - 1
                                ]
                              )
                            )
                          : null;

                      const showUcpmPodcastHeader =
                        groupMoviesByUcpmPodcast &&
                        (
                          index === 0 ||
                          ucpmPodcastKey !==
                            previousUcpmPodcastKey
                        );

                      const ucpmPodcastCount =
                        ucpmPodcastVisibleCounts.get(
                          ucpmPodcastKey
                        ) ||
                        0;

                      const ucpmPodcastNumber =
                        ucpmPodcastGroup &&
                        ucpmPodcastGroup.kind !== 'sixfilms'
                          ? ucpmPodcastGroupNumbers.get(
                              ucpmPodcastKey
                            ) || null
                          : null;

                      const ucpmPodcastYear =
                        ucpmPodcastGroup &&
                        ucpmPodcastGroup.kind !== 'sixfilms'
                          ? getUcpmPodcastYearLabel(
                              ucpmPodcastGroup
                            )
                          : null;


                      const soundtrackMode =
                        page ===
                        'soundtracks';

                      const decadeLabel =
                        groupMoviesByDecade
                          ? getDecadeLabel(
                              movie
                            )
                          : null;

                      const previousDecadeLabel =
                        groupMoviesByDecade &&
                        index > 0
                          ? getDecadeLabel(
                              visibleListMovies[
                                index - 1
                              ]
                            )
                          : null;

                      const showDecadeHeader =
                        groupMoviesByDecade &&
                        decadeLabel !==
                          previousDecadeLabel;

                      return (

                        <Fragment
                          key={
                            movie.docId
                          }
                        >

                          {showUcpmPodcastHeader && (

                            <div
                              className="ucpmPodcastHeading"
                            >
                              <strong className="ucpmPodcastMeta">
                                {ucpmPodcastGroup?.kind === 'sixfilms' ? (
                                  <>
                                    <span className="ucpmPodcastNumber">
                                      {`6 films #${String(
                                        ucpmSixFilmsGroupNumbers.get(ucpmPodcastKey) ?? 1
                                      ).padStart(2, '0')}`}
                                    </span>
                                    <span className="ucpmPodcastSeparator">·</span>
                                    <span className="ucpmPodcastCount">
                                      {`${ucpmPodcastCount} film${ucpmPodcastCount > 1 ? 's' : ''}`}
                                    </span>
                                  </>
                                ) : ucpmPodcastNumber ? (
                                  <>
                                    <span className="ucpmPodcastNumber">
                                      {`#${String(ucpmPodcastNumber).padStart(2, '0')}`}
                                    </span>
                                    {ucpmPodcastYear && (
                                      <>
                                        <span className="ucpmPodcastSeparator">·</span>
                                        <span className="ucpmPodcastYear">
                                          {ucpmPodcastYear}
                                        </span>
                                      </>
                                    )}
                                    <span className="ucpmPodcastSeparator">·</span>
                                    <span className="ucpmPodcastCount">
                                      <span
                                        className={
                                          ucpmPodcastRecordCount > 0 &&
                                          ucpmPodcastCount === ucpmPodcastRecordCount
                                            ? 'ucpmPodcastRecordValue'
                                            : undefined
                                        }
                                      >
                                        {ucpmPodcastCount}
                                      </span>
                                      {` film${ucpmPodcastCount > 1 ? 's' : ''}`}
                                    </span>
                                  </>
                                ) : ucpmPodcastGroup?.kind === 'legacy' && ucpmPodcastYear ? (
                                  <>
                                    <span className="ucpmPodcastUnclassified">Archives</span>
                                    <span className="ucpmPodcastSeparator">·</span>
                                    <span className="ucpmPodcastYear">
                                      {ucpmPodcastYear}
                                    </span>
                                    <span className="ucpmPodcastSeparator">·</span>
                                    <span className="ucpmPodcastCount">
                                      {`${ucpmPodcastCount} film${ucpmPodcastCount > 1 ? 's' : ''}`}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="ucpmPodcastUnclassified">Non classés</span>
                                    <span className="ucpmPodcastSeparator">·</span>
                                    <span className="ucpmPodcastCount">
                                      {`${ucpmPodcastCount} film${ucpmPodcastCount > 1 ? 's' : ''}`}
                                    </span>
                                  </>
                                )}
                              </strong>
                            </div>

                          )}


                          {showDecadeHeader && (

                            <div
                              style={{
                                gridColumn:
                                  '1 / -1',
                                marginTop:
                                  index === 0
                                    ? 0
                                    : '18px',
                                marginBottom:
                                  '4px',
                                paddingBottom:
                                  '8px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.15)',
                                fontSize:
                                  '1.15rem',
                                fontWeight:
                                  700,
                                letterSpacing:
                                  '0.02em',
                              }}
                            >
                              {
                                decadeLabel
                              }
                            </div>

                          )}


                        <article
                          className={[
                            reorderMode
                              ? soundtrackMode
                                ? 'movie reorderableMovie soundtrackMovie'
                                : 'movie reorderableMovie'
                              : soundtrackMode
                              ? 'movie soundtrackMovie'
                              : 'movie',
                            reorderMode &&
                            mobileReorderFocusId ===
                              movie.docId
                              ? 'mobileReorderFocus'
                              : '',
                            page === 'ucpm' &&
                            getUcpmFeaturedRank(movie) !== null
                              ? 'ucpmFeaturedMovie'
                              : '',
                            multiSelectMode && isMultiSelectMovieSelected(movie)
                              ? 'multiSelectSelected'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          key={
                            movie.docId
                          }
                          data-reorder-id={
                            reorderMode
                              ? movie.docId
                              : undefined
                          }
                          draggable={
                            reorderMode
                          }
                          onDragStart={(
                            event
                          ) => {
                            if (
                              reorderMode
                            ) {
                              handleReorderDragStart(
                                event,
                                movie.docId
                              );
                            }
                          }}
                          onDragOver={(
                            event
                          ) => {
                            if (
                              reorderMode
                            ) {
                              handleReorderDragOver(
                                event,
                                movie.docId
                              );
                            }
                          }}
                        >

                          {page === 'ucpm' &&
                            getUcpmFeaturedRank(movie) !== null && (
                              <div className="ucpmTopOfYearLabel">
                                TOP DE L'ANNÉE
                              </div>
                            )}

                          <div
                            className={
                              richPosterHover && !reorderMode
                                ? 'posterHoverShell richPosterHoverShell'
                                : 'posterHoverShell'
                            }
                            data-page-search-title={`${displayTitle} ${movie.title ?? ''} ${movie.originalTitle ?? ''} ${movie.year ?? ''}`}
                          >
                          <button
                            type="button"
                            className={
                              soundtrackMode
                                ? 'poster posterButton soundtrackCover'
                                : 'poster posterButton'
                            }
                            disabled={false}
                            onPointerDown={(event) => {
                              if (reorderMode) {
                                handleReorderPointerDown(
                                  event,
                                  movie.docId
                                );
                                setMobileReorderFocusId(movie.docId);
                                return;
                              }

                              handleMobileMovieHoldStart(
                                event,
                                movie
                              );
                            }}
                            onPointerMove={(event) => {
                              if (reorderMode) {
                                handleReorderPointerMove(event);
                                return;
                              }

                              handleMobileMovieHoldMove(event);
                            }}
                            onPointerUp={(event) => {
                              if (reorderMode) {
                                handleReorderPointerUp(event);
                                return;
                              }

                              handleMobileMovieHoldEnd();
                            }}
                            onPointerCancel={(event) => {
                              if (reorderMode) {
                                handleReorderPointerUp(event);
                                return;
                              }

                              handleMobileMovieHoldEnd();
                            }}
                            onContextMenu={(event) => {
                              if (
                                window.innerWidth <= 800
                              ) {
                                event.preventDefault();
                              }
                            }}
                            onClick={(event) => {
                              if (multiSelectMode) {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleMultiSelectMovie(movie);
                                return;
                              }

                              if (
                                consumeMobileMovieHoldClick(
                                  movie
                                )
                              ) {
                                event.preventDefault();
                                return;
                              }

                              if (
                                !reorderMode
                              ) {
                                const rect = event.currentTarget.getBoundingClientRect();
                                setMobileMovieAction({
                                  movie,
                                  diaryEntry: null,
                                  anchorRect: {
                                    left: rect.left,
                                    right: rect.right,
                                    top: rect.top,
                                    bottom: rect.bottom,
                                  },
                                });
                              }
                            }}
                            title={
                              reorderMode
                                ? 'Maintiens et déplace directement l’affiche'
                                : richPosterHover
                                  ? `${displayTitle} · ${hoverYear}`
                                  : hoverTitle
                            }
                          >

                            {posterSrc ? (

                              <img
                                src={
                                  posterSrc
                                }
                                alt={
                                  displayTitle
                                }
                                loading="lazy"
                                decoding="async"
                              />

                            ) : (

                              <span
                                className="noPoster"
                              >
                                {soundtrackMode
                                  ? 'Pochette à ajouter'
                                  : 'Affiche à récupérer'}
                              </span>

                            )}


                            {!reorderMode && !richPosterHover && (
                              <span className="posterHoverTitle">
                                {hoverTitle}
                              </span>
                            )}

                            {!reorderMode && !richPosterHover && movie.tmdbId && (
                              <span className="posterEditBadge">
                                ⋯ Actions
                              </span>
                            )}

                          </button>

                            {!reorderMode &&
                              renderUnratedPosterRating({
                                ratingKey: quickRatingKeyForList(
                                  movie,
                                  page as Exclude<AddTarget, 'diary'>
                                ),
                                currentRating: hoverRating,
                                ariaLabel: `Noter rapidement ${displayTitle}`,
                                onSave: (ratingDraftOverride) =>
                                  saveQuickListRating(
                                    movie,
                                    page as Exclude<AddTarget, 'diary'>,
                                    null,
                                    false,
                                    ratingDraftOverride ?? null
                                  ),
                                showRated: true,
                                disabled:
                                  page === 'jellyfin' &&
                                  Boolean(getMovieDatabaseEditAuthoritySource(movie)),
                                disabledTitle:
                                  page === 'jellyfin' &&
                                  getMovieDatabaseEditAuthoritySource(movie)
                                    ? `Note gérée par ${getMovieDatabaseEditAuthoritySource(movie)} : modification désactivée ici.`
                                    : undefined,
                              })}

                            {!reorderMode &&
                              !isMobileIntro &&
                              !isMobileBanner &&
                              (page === 'topUS' ||
                                page === 'topFR' ||
                                page === 'ucpm') && (
                                <button
                                  type="button"
                                  className="posterReviewedButton"
                                  disabled={reviewSavingMovieId !== null}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void markMovieAsReviewed(movie);
                                  }}
                                  title={`Ajouter un nouveau visionnage de ${displayTitle} dans VUS`}
                                  aria-label={`Revu : ajouter ${displayTitle} à VUS`}
                                >
                                  {reviewSavingMovieId === movie.docId ? '…' : 'Revu'}
                                </button>
                              )}

                            {richPosterHover && !reorderMode && (
                              <div className="posterHoverPanel">
                                <strong className="posterHoverPanelTitle">
                                  {displayTitle}
                                </strong>
                                <span className="posterHoverPanelYearTop">
                                  {hoverYear}
                                </span>
                                <button
                                  type="button"
                                  className={`posterHoverEraseButton${page === 'watchlist' ? ' watchlistPosterEraseButton' : ''}`}
                                  disabled={posterEraseMovieId === movie.docId}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    if (
                                      page ===
                                      'jellyfin'
                                    ) {
                                      void removeMovieFromMovieDatabase(
                                        movie
                                      );
                                    } else if (page === 'watchlist') {
                                      void removeMovieFromWatchlist(movie);
                                    } else {
                                      void eraseMovieFromPoster(
                                        movie
                                      );
                                    }
                                  }}
                                >
                                  {posterEraseMovieId === movie.docId
                                    ? '...'
                                    : page === 'jellyfin'
                                    ? 'Supprimer'
                                    : 'Effacer'}
                                </button>
                              </div>
                            )}
                          </div>

                        </article>

                        </Fragment>

                      );
                    }
                  )}


              </section>

            </>

          )}


        {user && (

          <div
            className="backToTopRow"
          >

            <button
              type="button"
              className="backToTopButton"
              onClick={() =>
                window.scrollTo({
                  top: 0,
                  behavior: 'smooth',
                })
              }
              aria-label="Remonter en haut de la page"
            >
              ↑ Haut
            </button>

          </div>

        )}

      </main>





      {user && (
        <div
          className={
            (
          page === 'topUS' ||
          page === 'topFR' ||
          page === 'soundtracks' ||
          page === 'ucpm' ||
          page === 'diary' ||
          page === 'lp' ||
          page === 'series' ||
          page === 'jellyfin' ||
          page === 'watchlist'
        )
              ? 'floatingUtilityActions floatingUtilityActionsWithAdd'
              : 'floatingUtilityActions'
          }
          aria-label="Actions rapides"
        >

          <button
            type="button"
            className={
              page === 'jellyfin'
                ? 'floatingUtilityButton mobileQuickNavButton mobileQuickMovieDatabase active'
                : 'floatingUtilityButton mobileQuickNavButton mobileQuickMovieDatabase'
            }
            onClick={() => {
              setHistoryOpen(false);
              setRecentAddedOpen(false);
              setPage('jellyfin');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            title="Movie Database"
            aria-label="Ouvrir Movie Database"
            aria-current={page === 'jellyfin' ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.7" y="5" width="18.6" height="14" rx="1.6" />
              <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
              <path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <button
            type="button"
            className={
              page === 'import'
                ? 'floatingUtilityButton mobileQuickNavButton mobileQuickUpdate active'
                : 'floatingUtilityButton mobileQuickNavButton mobileQuickUpdate'
            }
            onClick={() => {
              setHistoryOpen(false);
              setRecentAddedOpen(false);
              setPage('import');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            title="MAJ — mises à jour et imports"
            aria-label="Ouvrir les mises à jour et imports"
            aria-current={page === 'import' ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.3 6.2" />
              <path d="M20 4v7h-7" />
            </svg>
          </button>

          {(unratedQueueItems.length > 0 || page === 'unrated') && (
            <button
              type="button"
              className={
                page === 'unrated'
                  ? 'floatingUtilityButton floatingUtilityUnrated active'
                  : 'floatingUtilityButton floatingUtilityUnrated'
              }
              onClick={() => {
                setHistoryOpen(false);
                setRecentAddedOpen(false);
                setPage('unrated');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              title="Films sans note"
              aria-label={`${unratedQueueItems.length} film${unratedQueueItems.length > 1 ? 's' : ''} sans note`}
              aria-current={page === 'unrated' ? 'page' : undefined}
            >
              <span className="floatingUnratedStar" aria-hidden="true">★</span>
              {unratedQueueItems.length > 0 && (
                <span className="floatingUtilityCount">
                  {unratedQueueItems.length}
                </span>
              )}
            </button>
          )}

          {page === 'jellyfin' && movieDatabaseCoverRunning && (
            <div className="coverProgressPanel" aria-live="polite">
              <div className="coverProgressCurrent">
                {movieDatabaseCoverCurrentTitle
                  ? `En cours : ${movieDatabaseCoverCurrentTitle}`
                  : 'COVER en cours…'}
              </div>
              {movieDatabaseCoverRecentTitles.length > 0 && (
                <div className="coverProgressTicker">
                  <div className="coverProgressTickerTrack">
                    {movieDatabaseCoverRecentTitles.join('  •  ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {page === 'jellyfin' &&
            (movieDatabaseMoviesWithoutPoster.length > 0 || movieDatabaseCoverRunning) && (
            <div className="floatingCoverActionWrap">
              {movieDatabaseCoverRunning &&
                movieDatabaseCoverCancelMenuOpen &&
                !movieDatabaseCoverCancelRequested && (
                <div className="floatingCoverCancelMenu" role="dialog" aria-label="Arrêter COVER">
                  <button
                    type="button"
                    className="floatingCoverCancelChoice"
                    onClick={() => requestMovieDatabaseCoverCancel('undo')}
                    title="Arrêter COVER et restaurer toutes les affiches changées pendant cette session"
                  >
                    ANNULER
                  </button>
                  <button
                    type="button"
                    className="floatingCoverStopChoice"
                    onClick={() => requestMovieDatabaseCoverCancel('stop')}
                    title="Arrêter COVER et conserver les affiches déjà ajoutées"
                  >
                    STOP
                  </button>
                </div>
              )}

              <button
                type="button"
                className={
                  movieDatabaseCoverRunning
                    ? 'floatingUtilityButton floatingUtilityCover active'
                    : 'floatingUtilityButton floatingUtilityCover'
                }
                onClick={() => {
                  if (movieDatabaseCoverRunning) {
                    if (movieDatabaseCoverCancelRequested) {
                      return;
                    }

                    setMovieDatabaseCoverCancelMenuOpen((open) => !open);
                    return;
                  }

                  void repairMovieDatabaseEmptyCovers();
                }}
                disabled={movieDatabaseCoverCancelRequested}
                title={
                  movieDatabaseCoverRunning
                    ? movieDatabaseCoverCancelRequested
                      ? 'Arrêt de COVER en cours…'
                      : 'Choisir ANNULER ou STOP'
                    : 'Récupérer toutes les affiches vides de Movie Database'
                }
                aria-label={
                  movieDatabaseCoverRunning
                    ? movieDatabaseCoverCancelRequested
                      ? 'Arrêt de COVER en cours'
                      : 'Choisir entre annuler les changements ou simplement arrêter COVER'
                    : `Récupérer ${movieDatabaseMoviesWithoutPoster.length} affiche${movieDatabaseMoviesWithoutPoster.length > 1 ? 's' : ''} vide${movieDatabaseMoviesWithoutPoster.length > 1 ? 's' : ''}`
                }
              >
                <span>
                  {movieDatabaseCoverRunning
                    ? movieDatabaseCoverCancelRequested
                      ? 'ARRÊT…'
                      : 'ANNULER'
                    : 'COVER'}
                </span>
                <span className="floatingUtilityCount">
                  {movieDatabaseMoviesWithoutPoster.length}
                </span>
              </button>
            </div>
          )}

          <button
            type="button"
            className={
              page === 'verify'
                ? 'floatingUtilityButton floatingUtilityVerify active'
                : 'floatingUtilityButton floatingUtilityVerify'
            }
            onClick={() => {
              setHistoryOpen(false);
              setRecentAddedOpen(false);
              setPage('verify');
            }}
            title="Films à rééditer"
            aria-label="Films à rééditer"
          >
            <span aria-hidden="true">⛔</span>
            {moviesToVerify.length > 0 && (
              <span className="floatingUtilityCount">
                {moviesToVerify.length}
              </span>
            )}
          </button>

          <button
            type="button"
            className={
              historyOpen
                ? 'floatingUtilityButton floatingUtilityUndo active'
                : 'floatingUtilityButton floatingUtilityUndo'
            }
            onClick={() => {
              setRecentAddedOpen(false);
              setHistoryOpen((open) => !open);
            }}
            aria-expanded={historyOpen}
            title="Corbeille / Annuler — restaurer une des 20 dernières actions de la semaine"
          >
            <span aria-hidden="true">↩</span>
            {actionHistory.length > 0 && (
              <span className="floatingUtilityCount">
                {actionHistory.length}
              </span>
            )}
          </button>

          <button
            type="button"
            className={
              recentAddedOpen
                ? 'floatingUtilityButton floatingUtilityRecent active'
                : 'floatingUtilityButton floatingUtilityRecent'
            }
            onClick={() => {
              setHistoryOpen(false);
              setRecentAddedOpen((open) => !open);
            }}
            aria-expanded={recentAddedOpen}
            title="Derniers films ajoutés"
            aria-label="Derniers films ajoutés"
          >
            ↓
          </button>
        </div>
      )}


      {user &&
        (
          page === 'topUS' ||
          page === 'topFR' ||
          page === 'soundtracks' ||
          page === 'ucpm' ||
          page === 'diary' ||
          page === 'lp' ||
          page === 'series' ||
          page === 'jellyfin' ||
          page === 'watchlist'
        ) && (
        <button
          type="button"
          className="floatingAddButton"
          onClick={openAddForCurrentPage}
          aria-label={
            page === 'lp'
              ? 'Ajouter un album'
              : page === 'diary'
              ? 'Ajouter un film ou une série'
              : page === 'series'
              ? 'Ajouter une série'
              : page === 'jellyfin'
              ? 'Ajouter un film à Movie Database'
              : page === 'watchlist'
              ? 'Ajouter un film à voir'
              : page === 'ucpm'
              ? 'Créer un 6 films UCPM'
              : page === 'soundtracks'
              ? 'Ajouter une B.O.'
              : 'Ajouter un film'
          }
          title={
            page === 'lp'
              ? 'Ajouter un album'
              : page === 'diary'
              ? 'Ajouter un film ou une série'
              : page === 'series'
              ? 'Ajouter une série'
              : page === 'jellyfin'
              ? 'Ajouter un film à Movie Database'
              : page === 'watchlist'
              ? 'Ajouter un film à voir'
              : page === 'ucpm'
              ? 'Créer un 6 films UCPM'
              : page === 'soundtracks'
              ? 'Ajouter une B.O.'
              : 'Ajouter un film'
          }
        >
          +
        </button>
      )}




      {recentAddedOpen && (

        <div
          className="recentAddedBackdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setRecentAddedOpen(false);
            }
          }}
        >
          <section
            className="recentAddedModal"
            role="dialog"
            aria-modal="true"
            aria-label="Derniers films ajoutés"
          >
            <div className="recentAddedHeader">
              <div>
                <span>50 max</span>
                <h2>Derniers films ajoutés</h2>
              </div>

              <button
                type="button"
                className="movieMenuClose"
                onClick={() => setRecentAddedOpen(false)}
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <div className="recentAddedList">
              {recentAddedMovies.length === 0 ? (
                <div className="recentAddedEmpty">
                  Aucun ajout daté.
                </div>
              ) : (
                recentAddedMovies.map((movie, index) => (
                  <div
                    className="recentAddedRow"
                    key={movie.docId}
                  >
                    <span className="recentAddedIndex">
                      {index + 1}
                    </span>

                    <button
                      type="button"
                      className="recentAddedTitle"
                      onClick={() => openMovieMenu(movie)}
                      title="Éditer le film"
                    >
                      <strong>{getMovieDisplayTitle(movie)}</strong>
                      <span>{movie.year || '—'}</span>
                    </button>

                    <button
                      type="button"
                      className="recentAddedEdit"
                      onClick={() => openMovieMenu(movie)}
                      title="Éditer"
                    >
                      Éditer
                    </button>

                    <button
                      type="button"
                      className="recentAddedDelete"
                      disabled={deletingRecentMovieId === movie.docId}
                      onClick={() =>
                        void eraseRecentAddedMovie(movie)
                      }
                      title="Effacer"
                    >
                      {deletingRecentMovieId === movie.docId ? '…' : '×'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

      )}


      {mobileMovieAction && (

        <div
          className="mobileMovieActionBackdrop"
          onClick={(event) => {
            if (
              event.target ===
              event.currentTarget &&
              !mobileMovieActionSaving
            ) {
              setMobileMovieAction(
                null
              );
            }
          }}
        >

          <section
            className="mobileMovieActionSheet"
            role="dialog"
            aria-modal="true"
            aria-label="Actions du film"
            style={getMobileMovieActionPositionStyle()}
          >

            <div className="mobileMovieActionHeading">
              <button
                type="button"
                className="mobileMovieActionEdit"
                disabled={mobileMovieActionSaving}
                onClick={() => {
                  const action = mobileMovieAction;
                  setMobileMovieAction(null);
                  openMovieMenu(action.movie, action.diaryEntry);
                }}
                title="Modifier le film et son affiche"
              >
                ✎ Éditer
              </button>
              <button
                type="button"
                className="mobileMovieActionClose"
                disabled={mobileMovieActionSaving}
                onClick={() => setMobileMovieAction(null)}
                aria-label="Fermer"
                title="Fermer"
              >
                ×
              </button>
            </div>

            {(page === 'topUS' || page === 'topFR' || page === 'ucpm') && (
              <button
                type="button"
                className="mobileMovieActionReviewed"
                disabled={reviewSavingMovieId !== null}
                onClick={() => {
                  const movie = mobileMovieAction.movie;
                  setMobileMovieAction(null);
                  void markMovieAsReviewed(movie);
                }}
                title="Ajouter un nouveau visionnage dans VUS"
              >
                ↻ Revu
              </button>
            )}

            {page !== 'soundtracks' && (
              <>
                <div
                  className="mobileMovieMembershipBox"
                  aria-label="Présence du film dans les listes"
                >
                  <div className="mobileMovieMembershipGrid">
                    {([
                      ['topUS', 'US'],
                      ['topFR', 'FR'],
                      ['diary', 'VUS'],
                      ['watchlist', 'À VOIR'],
                      ['jellyfin', 'MOVIE DB'],
                    ] as const).map(([target, label]) => {
                      const active =
                        target === 'diary'
                          ? movieIsInDiary(mobileMovieAction.movie)
                          : movieIsInSection(mobileMovieAction.movie, target);

                      return (
                        <button
                          key={target}
                          type="button"
                          className={`mobileMovieMembershipButton${active ? ' active' : ''}${target === 'jellyfin' ? ' movieDb' : ''}`}
                          disabled={mobileMovieActionSaving}
                          onClick={() => void toggleMobileMovieMembership(target)}
                          aria-pressed={active}
                          title={`${active ? 'Retirer de' : 'Ajouter à'} ${label}`}
                        >
                          <span className="mobileMovieMembershipCheck">
                            {active ? '✓' : ''}
                          </span>
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  className="mobileMovieMultiSelectButton"
                  disabled={mobileMovieActionSaving}
                  onClick={startMultiSelectFromMobileAction}
                >
                  ☑ Sélection multiple
                </button>
              </>
            )}

            {page !== 'unrated' && page !== 'topUS' && page !== 'topFR' && page !== 'diary' && page !== 'jellyfin' && (
              <button
                type="button"
                className="mobileMovieActionDelete compactCurrentSectionRemove"
                disabled={mobileMovieActionSaving}
                onClick={() => void removeMobileMovieFromCurrentSection()}
              >
                Retirer de cette liste
              </button>
            )}

          </section>

        </div>

      )}


      {((reorderMode && currentPageSupportsMovieReorder()) || lpReorderMode) && (

        <div
          className="mobileReorderSaveBar"
          aria-label="Reclassement tactile"
        >

          <span>
            {lpReorderMode
              ? 'Sélectionne une pochette puis utilise ↑ ↓ ← →, ou maintiens-la pour la déplacer. La note sera ajustée à sa nouvelle place.'
              : 'Maintiens directement l’affiche et déplace-la. La note sera ajustée à sa nouvelle place.'}
          </span>

          {lpReorderMode && mobileReorderFocusId && (
            <div
              className="lpReorderDirectionControls"
              aria-label="Déplacer la pochette sélectionnée"
            >
              <button
                type="button"
                onClick={() => moveFocusedLpReorderAlbum('up')}
                title="Monter d’une ligne"
                aria-label="Monter la pochette"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveFocusedLpReorderAlbum('down')}
                title="Descendre d’une ligne"
                aria-label="Descendre la pochette"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => moveFocusedLpReorderAlbum('left')}
                title="Déplacer à gauche"
                aria-label="Déplacer la pochette à gauche"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => moveFocusedLpReorderAlbum('right')}
                title="Déplacer à droite"
                aria-label="Déplacer la pochette à droite"
              >
                →
              </button>
            </div>
          )}

          <div>
            <button
              type="button"
              className="mobileReorderSaveButton"
              disabled={
                lpReorderMode
                  ? !lpReorderDirty
                  : !reorderDirty
              }
              onClick={() =>
                lpReorderMode
                  ? void saveLpReorderedList()
                  : void saveReorderedList()
              }
            >
              ✓ Sauver
            </button>

            <button
              type="button"
              className="mobileReorderCancelButton"
              onClick={
                lpReorderMode
                  ? cancelLpReorderMode
                  : cancelReorderMode
              }
            >
              Annuler
            </button>
          </div>

        </div>

      )}


      {selectedMovieMenu && (

        <div
          className="movieMenuBackdrop"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeMovieMenu();
            }
          }}
        >

          <div
            className={
              page === 'soundtracks'
                ? 'movieMenuModal soundtrackMovieMenuModal'
                : 'movieMenuModal'
            }
          >

            <div
              className="movieMenuHeader"
            >

              <div>

                <span
                  className="movieMenuEyebrow"
                >
                  {page === 'series' ? 'Menu de la série' : page === 'soundtracks' ? 'Menu de la B.O.' : 'Menu du film'}
                </span>

                <h2>
                  {
                    page ===
                    'soundtracks'
                      ? getSoundtrackDisplayTitle(
                          selectedMovieMenu
                        )
                      : getMovieDisplayTitle(
                          selectedMovieMenu
                        )
                  }
                </h2>

              </div>


              <div
                className="movieMenuHeaderActions"
              >

                <div
                  className="movieMenuNavigation"
                  aria-label="Navigation entre les films"
                >
                  <button
                    type="button"
                    className="movieMenuNavButton"
                    onClick={() => navigateMovieMenu(-1)}
                    disabled={
                      savingMovieMenu ||
                      movieMenuHasChanges() ||
                      movieMenuNavigationIndex <= 0
                    }
                    title={
                      movieMenuHasChanges()
                        ? 'Sauvegarde les modifications avant de changer de film'
                        : 'Film précédent'
                    }
                    aria-label="Film précédent"
                  >
                    ‹
                  </button>

                  <span className="movieMenuNavCounter">
                    {movieMenuNavigationIndex >= 0
                      ? `${movieMenuNavigationIndex + 1}/${movieMenuNavigationItems.length}`
                      : `—/${movieMenuNavigationItems.length}`}
                  </span>

                  <button
                    type="button"
                    className="movieMenuNavButton"
                    onClick={() => navigateMovieMenu(1)}
                    disabled={
                      savingMovieMenu ||
                      movieMenuHasChanges() ||
                      movieMenuNavigationIndex < 0 ||
                      movieMenuNavigationIndex >= movieMenuNavigationItems.length - 1
                    }
                    title={
                      movieMenuHasChanges()
                        ? 'Sauvegarde les modifications avant de changer de film'
                        : 'Film suivant'
                    }
                    aria-label="Film suivant"
                  >
                    ›
                  </button>
                </div>

                <button
                  type="button"
                  className="greenButton compactMovieButton movieMenuHeaderSave"
                  disabled={
                    savingMovieMenu ||
                    !movieMenuHasChanges()
                  }
                  onClick={
                    saveMovieMenuChanges
                  }
                >
                  Save
                </button>


                <button
                  type="button"
                  className="dangerButton compactMovieButton movieMenuEraseButton movieMenuHeaderErase"
                  disabled={savingMovieMenu}
                  onClick={eraseSelectedMovieEverywhere}
                >
                  Effacer
                </button>


                <button
                  type="button"
                  className="movieMenuClose"
                  onClick={
                    closeMovieMenu
                  }
                >
                  ×
                </button>

              </div>

            </div>


            <div
              className="movieMenuSummary"
            >

              <div
                className="movieMenuPosterColumn"
              >

                {page === 'soundtracks' && (
                  <h3 className="moviePosterMenuLabel">
                    Pochette
                  </h3>
                )}

                <div
                  className={
                    page ===
                    'soundtracks'
                      ? 'movieMenuPoster soundtrackMenuPoster movieMenuPosterInteractive'
                      : 'movieMenuPoster'
                  }
                  role={
                    page === 'soundtracks'
                      ? 'button'
                      : undefined
                  }
                  tabIndex={
                    page === 'soundtracks'
                      ? 0
                      : undefined
                  }
                  title={
                    page === 'soundtracks'
                      ? '1 clic : iTunes · 2 clics : Upload'
                      : undefined
                  }
                  onClick={
                    page === 'soundtracks'
                      ? handleMovieMenuPosterClick
                      : undefined
                  }
                  onDoubleClick={
                    page === 'soundtracks'
                      ? handleMovieMenuPosterDoubleClick
                      : undefined
                  }
                  onKeyDown={(event) => {
                    if (
                      page === 'soundtracks' &&
                      (event.key === 'Enter' || event.key === ' ')
                    ) {
                      event.preventDefault();
                      openMovieMenuPosterSource();
                    }
                  }}
                >
  
                  {getListPosterSrc(
                    selectedMovieMenu,
                    'w342'
                  ) ? (
  
                    <img
                      src={
                        getListPosterSrc(
                          selectedMovieMenu,
                          'w342'
                        ) ||
                        ''
                      }
                      alt={
                        page ===
                        'soundtracks'
                          ? getSoundtrackDisplayTitle(
                              selectedMovieMenu
                            )
                          : getMovieDisplayTitle(
                              selectedMovieMenu
                            )
                      }
                    />
  
                  ) : (
  
                    <div
                      className="noPoster"
                    >
                      {page ===
                      'soundtracks'
                        ? 'Pas de pochette CD'
                        : "Pas d'affiche"}
                    </div>
  
                  )}
  
                </div>


                <div
                  className="moviePosterSourceControls"
                >

                  {page === 'soundtracks' ? (
                    <>
                      <span
                        className="moviePosterSourceLabel"
                      >
                        Pochette :
                      </span>

                      <button
                        type="button"
                        className="secondaryButton moviePosterSourceButton"
                        onClick={() =>
                          void runSoundtrackSearch(
                            selectedMovieMenu
                          )
                        }
                      >
                        iTunes
                      </button>

                      <label
                        className={
                          uploadingPoster
                            ? 'secondaryButton uploadPosterButton moviePosterSourceButton disabled'
                            : 'secondaryButton uploadPosterButton moviePosterSourceButton'
                        }
                      >
                        {uploadingPoster
                          ? 'Envoi...'
                          : 'Upload'}

                        <input
                          ref={moviePosterUploadInputRef}
                          type="file"
                          accept="image/*"
                          hidden
                          disabled={
                            uploadingPoster
                          }
                          onChange={
                            uploadCustomPoster
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="secondaryButton moviePosterSourceButton moviePosterTmdbOnlyButton"
                        disabled={
                          movieMenuSearchLoading ||
                          !movieMenuTitle.trim()
                        }
                        onClick={
                          startMovieMenuTmdbSearch
                        }
                      >
                        {movieMenuSearchLoading
                          ? 'Recherche…'
                          : 'TMDb'}
                      </button>

                      <input
                        ref={moviePosterUploadInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={
                          uploadingPoster
                        }
                        onChange={
                          uploadCustomPoster
                        }
                      />
                    </>
                  )}

                </div>

                <section
                  className="movieMenuSection moviePosterRatingSection"
                >

                  <h3>
                    Note
                  </h3>

                  <div
                    className="ratingEditor"
                  >

                    <div className="ratingEditorValue">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={
                          movieMenuRating
                        }
                        onChange={(
                          event
                        ) =>
                          setMovieMenuRating(
                            sanitizeRatingDraft(
                              event.target.value
                            )
                          )
                        }
                        placeholder="0,00"
                        maxLength={4}
                        disabled={
                          page === 'jellyfin' &&
                          Boolean(getMovieDatabaseEditAuthoritySource(selectedMovieMenu))
                        }
                        title={
                          page === 'jellyfin' &&
                          getMovieDatabaseEditAuthoritySource(selectedMovieMenu)
                            ? `Note imposée par ${getMovieDatabaseEditAuthoritySource(selectedMovieMenu)}`
                            : undefined
                        }
                      />
                    </div>

                  </div>

                </section>




              </div>



              <div
                className="movieMenuMain"
              >

                <section
                  className="movieMenuSection movieMenuTitleSection"
                >

                  <h3>
                    Titre, url ou Id IMDB
                  </h3>

                  <div className="movieMenuTitleFields">
                    <input
                      className="movieTitleEditor"
                      type="text"
                      value={
                        movieMenuTitle
                      }
                      onChange={(
                        event
                      ) =>
                        setMovieMenuTitle(
                          event.target.value
                        )
                      }
                      placeholder="Titre, ID IMDb ou URL IMDb"
                      title="Tu peux saisir un titre, un ID IMDb (ex. tt0110912) ou une URL IMDb, puis lancer la recherche TMDb."
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          startMovieMenuTmdbSearch();
                        }
                      }}
                    />

                    <input
                      className="movieMenuYearInput"
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={movieMenuYear}
                      onChange={(event) =>
                        setMovieMenuYear(
                          event.target.value
                            .replace(/[^0-9]/g, '')
                            .slice(0, 4)
                        )
                      }
                      placeholder="2025"
                      aria-label="Modifier l’année"
                    />
                  </div>

                </section>


                {page !== 'soundtracks' && (
                  <section className="movieMenuSection movieMenuImdbSection movieMenuPosterLookupSection">
                    <button
                      type="button"
                      className="secondaryButton movieMenuPosterLookupButton"
                      disabled={
                        movieMenuPosterLookupLoading ||
                        savingMovieMenu ||
                        !movieMenuTitle.trim()
                      }
                      onClick={() => void findMovieMenuPostersByTitle()}
                    >
                      {movieMenuPosterLookupLoading
                        ? 'Recherche…'
                        : 'Trouver avec IMDb'}
                    </button>
                  </section>
                )}



                {page !== 'soundtracks' &&
                  (movieMenuSearchLoading ||
                    movieMenuSearchResults.length > 0) && (
                  <section className="movieMenuSection movieMenuTmdbSearchSection">
                    <h3>
                      {movieMenuSearchLoading
                        ? `Recherche TMDb : ${movieMenuSearchQuery}`
                        : `Résultats TMDb : ${movieMenuSearchQuery}`}
                    </h3>
                    {movieMenuSearchResults.length > 0 && (
                      <div className="movieMenuTmdbResults">
                        {movieMenuSearchResults.map((candidate) => (
                          <button
                            type="button"
                            key={candidate.id}
                            className="movieMenuTmdbResult"
                            onClick={() => associateUnknownMovieFromMenu(candidate)}
                          >
                            <span>{candidate.title}</span>
                            <small>{candidate.release_date ? candidate.release_date.substring(0,4) : '—'}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                )}


                <div
                  className="moviePosterLists"
                >

                  <h3>
                    Listes
                  </h3>

                  <div
                    className="membershipButtons moviePosterMembershipButtons"
                  >

                    {((selectedMovieMenu.tmdbMediaType === 'tv' || page === 'series')
                      ? (['series'] as const)
                      : (['topUS','topFR','soundtracks','ucpm','jellyfin','watchlist'] as const)).map(
                      (
                        target
                      ) => {
                        const active =
                          movieIsInSection(
                            selectedMovieMenu,
                            target
                          );

                        const shortLabel =
                          target ===
                            'topUS'
                            ? 'US'
                            : target ===
                              'topFR'
                            ? 'FR'
                            : target ===
                              'soundtracks'
                            ? 'B.O'
                            : target === 'series'
                            ? 'SÉRIE'
                            : target === 'jellyfin'
                            ? 'MOVIE DATABASE'
                            : target === 'watchlist'
                            ? 'À VOIR'
                            : 'UCPM';

                        return (
                          <button
                            key={
                              target
                            }
                            type="button"
                            className={
                              `${
                                active
                                  ? 'membershipButton active moviePosterMembershipButton'
                                  : 'membershipButton moviePosterMembershipButton'
                              }${target === 'jellyfin' ? ' movieDatabaseMembershipButton' : ''}`
                            }
                            disabled={
                              savingMovieMenu
                            }
                            onClick={() =>
                              toggleMovieSection(
                                selectedMovieMenu,
                                target
                              )
                            }
                          >
                            {target === 'jellyfin' ? (
                              <span className="movieDatabaseMembershipLabel">
                                <span>{active ? '✓ MOVIE' : '+ MOVIE'}</span>
                                <span>DATABASE</span>
                              </span>
                            ) : (
                              active
                                ? '✓ ' + shortLabel
                                : '+ ' + shortLabel
                            )}
                          </button>
                        );
                      }
                    )}

                    <button
                      type="button"
                      className={
                        movieIsInDiary(
                          selectedMovieMenu
                        )
                          ? 'diaryAddButton compactMovieButton moviePosterDiaryButton active'
                          : 'diaryAddButton compactMovieButton moviePosterDiaryButton'
                      }
                      disabled={savingMovieMenu}
                      onClick={toggleCurrentMovieDiary}
                    >
                      {movieIsInDiary(selectedMovieMenu)
                        ? '✓ VU'
                        : '+ VU'}
                    </button>

                  </div>

                </div>






                {movieMenuMessage && (

                  <div
                    className="movieMenuMessage"
                  >
                    {
                      movieMenuMessage
                    }
                  </div>

                )}

              </div>

            </div>

          </div>

        </div>

      )}


      {ucpmComposerOpen && (

        <div
          className="sectionAddBackdrop ucpmComposerBackdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeUcpmComposer();
            }
          }}
        >

          <div className="sectionAddModal ucpmComposerModal">

            <div className="sectionAddHeader">
              <div>
                <span className="movieMenuEyebrow">
                  {editingUcpmSixFilmsGroup
                    ? 'Modifier 6 films UCPM'
                    : ucpmComposerMode === 'sixfilms'
                      ? 'Nouveau 6 films UCPM'
                      : 'Nouveau podcast UCPM'}
                </span>
                <h2>
                  {editingUcpmSixFilmsGroup || ucpmComposerMode === 'sixfilms'
                    ? `6 films #${ucpmComposerSixFilmsNumber}`
                    : `Podcast #${getNextUcpmPodcastMeta().number}`}
                </h2>
              </div>

              <button
                type="button"
                className="movieMenuClose"
                onClick={closeUcpmComposer}
                disabled={ucpmComposerSaving}
              >
                ×
              </button>
            </div>

            {!editingUcpmSixFilmsGroup && (
            <div className="ucpmComposerTypeSwitch" role="group" aria-label="Type de bloc UCPM">
              <button
                type="button"
                className={ucpmComposerMode === 'podcast' ? 'active' : ''}
                onClick={() => {
                  setUcpmComposerMode('podcast');
                  setUcpmComposerItems([]);
                  setUcpmComposerResults([]);
                  setUcpmComposerLocalResults([]);
                  setUcpmComposerMessage('');
                }}
              >
                Podcast année
              </button>
              <button
                type="button"
                className={ucpmComposerMode === 'sixfilms' ? 'active' : ''}
                onClick={() => {
                  setUcpmComposerMode('sixfilms');
                  setUcpmComposerItems([]);
                  setUcpmComposerResults([]);
                  setUcpmComposerLocalResults([]);
                                setUcpmComposerSixFilmsNumber(getNextUcpmSixFilmsNumber());
                  setUcpmComposerMessage('');
                }}
              >
                6 films
              </button>
            </div>
            )}

            <div className="ucpmComposerMeta">
              {ucpmComposerMode === 'podcast' ? (
                <>
                  <label>
                    <span>Numéro</span>
                    <input
                      value={`#${getNextUcpmPodcastMeta().number}`}
                      readOnly
                      aria-label="Prochain numéro de podcast"
                    />
                  </label>

                  <label>
                    <span>Année</span>
                    <input
                      value={String(getNextUcpmPodcastMeta().year)}
                      readOnly
                      aria-label="Année automatique du prochain podcast"
                    />
                  </label>

                  <label>
                    <span>Nb de films</span>
                    <input
                      value={String(ucpmComposerItems.length)}
                      readOnly
                      aria-label="Nombre de films calculé automatiquement"
                    />
                  </label>
                </>
              ) : (
                <div className="ucpmSixFilmsRule">
                  <label className="ucpmSixFilmsNumberPicker">
                    <span>Numéro du 6 films</span>
                    <input
                      value={`#${ucpmComposerSixFilmsNumber}`}
                      readOnly
                      aria-label="Prochain numéro libre de 6 films"
                    />
                  </label>
                  <div className="ucpmSixFilmsRuleText">
                    <strong>{`6 films #${ucpmComposerSixFilmsNumber}`}</strong>
                    <span>{editingUcpmSixFilmsGroup ? 'Numéro conservé pendant la modification.' : 'Prochain numéro libre attribué automatiquement.'} Ajoute exactement six films. Un film déjà présent dans UCPM ou Movie Database peut être réutilisé.</span>
                  </div>
                </div>
              )}

              <div className="ucpmComposerCounter">
                {ucpmComposerMode === 'podcast'
                  ? `${ucpmComposerItems.length} film${ucpmComposerItems.length > 1 ? 's' : ''}`
                  : `${ucpmComposerItems.length}/6`}
              </div>
            </div>

            <form
              className="sectionMovieSearch ucpmComposerSearch"
              onSubmit={searchUcpmComposerMovies}
            >
              <input
                value={ucpmComposerQuery}
                onChange={(event) => {
                  setUcpmComposerQuery(event.target.value);
                  if (ucpmComposerMessage) {
                    setUcpmComposerMessage('');
                  }
                }}
                placeholder="Titre, ID IMDb ou URL IMDb du film..."
              />
              <button type="submit" disabled={ucpmComposerSearching}>
                {ucpmComposerSearching ? 'Recherche...' : 'Rechercher'}
              </button>
            </form>

            <section className="ucpmComposerSelection ucpmComposerSelectionBeforeResults">
              <div className="ucpmComposerSelectionHeader">
                <strong>
                  {ucpmComposerMode === 'sixfilms'
                    ? `Aperçu — 6 films #${ucpmComposerSixFilmsNumber}`
                    : `Films du podcast #${getNextUcpmPodcastMeta().number} · ${getNextUcpmPodcastMeta().year}`}
                </strong>
                <span>
                  {ucpmComposerMode === 'podcast'
                    ? `${ucpmComposerItems.length} film${ucpmComposerItems.length > 1 ? 's' : ''}`
                    : `${ucpmComposerItems.length}/6`}
                </span>
              </div>

              {ucpmComposerItems.length === 0 ? (
                <div className="ucpmComposerEmpty">
                  Recherche un film puis clique sur « Ajouter ».
                </div>
              ) : (
                <div className="ucpmComposerSelectedGrid">
                  {ucpmComposerItems.map((item, index) => (
                    <article className="ucpmComposerSelectedCard" key={`${item.savedDocId || 'tmdb'}_${item.movie.id}`}>
                      <div className="ucpmComposerSelectedPoster">
                        {item.movie.poster_url || item.movie.poster_path ? (
                          <img
                            src={
                              item.movie.poster_url ||
                              `https://image.tmdb.org/t/p/w185${item.movie.poster_path}`
                            }
                            alt={item.movie.title}
                            loading="lazy"
                          />
                        ) : (
                          <span className="noPoster">Pas d'affiche</span>
                        )}
                        <span className="ucpmComposerIndex">{index + 1}</span>
                      </div>

                      <strong>{item.movie.title}</strong>

                      <label className="ucpmComposerRating">
                        <span>Note</span>
                        <input
                          value={item.rating}
                          inputMode="decimal"
                          placeholder="0,00"
                          maxLength={4}
                          onChange={(event) =>
                            updateUcpmComposerRating(
                              item.movie.id,
                              event.target.value
                            )
                          }
                        />
                      </label>

                      <button
                        type="button"
                        className="ucpmComposerRemove"
                        onClick={() => removeMovieFromUcpmComposer(item.movie.id)}
                      >
                        Retirer
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {ucpmComposerMessage && (
              <div className="movieMenuMessage ucpmComposerMessage">
                {ucpmComposerMessage}
              </div>
            )}

            {ucpmComposerLocalResults.length > 0 && (
              <section className="ucpmComposerResultBlock">
                <div className="ucpmComposerResultTitle">Déjà dans la base</div>
                <div className="ucpmComposerResults">
                  {ucpmComposerLocalResults.map((movie) => {
                    const tmdbId = Number(movie.tmdbId ?? 0);
                    const alreadyInBlock = ucpmComposerItems.some(
                      (item) =>
                        item.savedDocId === movie.docId ||
                        (Number.isFinite(tmdbId) && tmdbId > 0 && item.movie.id === tmdbId)
                    );
                    const full = ucpmComposerIsFull();
                    const posterSrc = getMoviePosterSrc(movie, 'w185');

                    return (
                      <article className="ucpmComposerSearchCard" key={`local_${movie.docId}`}>
                        <button
                          type="button"
                          className="greenButton ucpmComposerAddAbovePoster"
                          disabled={alreadyInBlock || full}
                          onClick={() => addSavedMovieToUcpmComposer(movie)}
                        >
                          {alreadyInBlock ? 'Ajouté' : 'Ajouter'}
                        </button>

                        <div className="ucpmComposerSearchPoster">
                          {posterSrc ? (
                            <img
                              src={posterSrc}
                              alt={getMovieDisplayTitle(movie)}
                              loading="lazy"
                            />
                          ) : (
                            <span className="noPoster">Pas d'affiche</span>
                          )}
                        </div>
                        <strong>{getMovieDisplayTitle(movie)}</strong>
                        <span>
                          {movie.year || '—'}
                          {movie.ucpm ? ' · UCPM' : ''}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {ucpmComposerResults.length > 0 && (
              <section className="ucpmComposerResultBlock">
                <div className="ucpmComposerResultTitle">Résultats TMDb</div>
                <div className="ucpmComposerResults">
                  {ucpmComposerResults.map((movie) => {
                    const existing = findExistingMovieForTmdb(movie, 'movie');
                    const alreadyInBlock = ucpmComposerItems.some(
                      (item) =>
                        item.movie.id === movie.id ||
                        Boolean(existing && item.savedDocId === existing.docId)
                    );
                    const full = ucpmComposerIsFull();

                    return (
                      <article className="ucpmComposerSearchCard" key={movie.id}>
                        <button
                          type="button"
                          className="greenButton ucpmComposerAddAbovePoster"
                          disabled={alreadyInBlock || full}
                          onClick={() =>
                            existing
                              ? addSavedMovieToUcpmComposer(existing)
                              : addMovieToUcpmComposer(movie)
                          }
                        >
                          {alreadyInBlock
                            ? 'Ajouté'
                            : existing
                              ? 'Ajouter (base)'
                              : 'Ajouter'}
                        </button>

                        <div className="ucpmComposerSearchPoster">
                          {movie.poster_path ? (
                            <img
                              src={`https://image.tmdb.org/t/p/w185${movie.poster_path}`}
                              alt={movie.title}
                              loading="lazy"
                            />
                          ) : (
                            <span className="noPoster">Pas d'affiche</span>
                          )}
                        </div>
                        <strong>{movie.title}</strong>
                        <span>
                          {movie.release_date
                            ? movie.release_date.substring(0, 4)
                            : '—'}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="ucpmComposerFooter">
              <button
                type="button"
                className="greenButton"
                disabled={ucpmComposerSaving}
                onClick={() => void saveUcpmComposer()}
              >
                {ucpmComposerSaving
                  ? editingUcpmSixFilmsGroup
                    ? 'Enregistrement…'
                    : 'Création…'
                  : editingUcpmSixFilmsGroup
                    ? 'Enregistrer'
                    : ucpmComposerMode === 'sixfilms'
                      ? `Créer 6 films #${ucpmComposerSixFilmsNumber}`
                      : `Créer podcast #${getNextUcpmPodcastMeta().number}`}
              </button>
              <button
                type="button"
                className="secondaryButton"
                disabled={ucpmComposerSaving}
                onClick={closeUcpmComposer}
              >
                Annuler
              </button>
            </div>

          </div>

        </div>

      )}


      {addTarget && (

        <div
          className="sectionAddBackdrop"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeAddToSection();
            }
          }}
        >

          <div
            className="sectionAddModal"
          >

            <div
              className="sectionAddHeader"
            >

              <div>

                <span
                  className="movieMenuEyebrow"
                >
                  {addTarget === 'diary'
                    ? 'Ajouter à VUS'
                    : addTarget === 'series'
                    ? 'Ajouter une série'
                    : addTarget === 'jellyfin'
                    ? 'Ajouter à Movie Database'
                    : addTarget === 'watchlist'
                    ? 'Ajouter à À VOIR'
                    : 'Ajouter un film'}
                </span>

                <h2>
                  {
                    sectionLabel(
                      addTarget
                    )
                  }
                </h2>

              </div>


              <button
                type="button"
                className="movieMenuClose"
                onClick={
                  closeAddToSection
                }
              >
                ×
              </button>

            </div>


            {addTarget ===
              'diary' && (

              <>

                <div
                  className="diaryMediaTypeSwitch"
                  role="group"
                  aria-label="Type de contenu à ajouter"
                >
                  <button
                    type="button"
                    className={
                      addDiaryMediaType === 'movie'
                        ? 'active'
                        : ''
                    }
                    onClick={() => {
                      setAddDiaryMediaType('movie');
                      setAddResults([]);
                      setAddMessage('');
                    }}
                  >
                    Film
                  </button>

                  <button
                    type="button"
                    className={
                      addDiaryMediaType === 'tv'
                        ? 'active'
                        : ''
                    }
                    onClick={() => {
                      setAddDiaryMediaType('tv');
                      setAddResults([]);
                      setAddMessage('');
                    }}
                  >
                    Série
                  </button>
                </div>

                <label
                  className="diaryDateField"
                >

                <span>
                  Date du visionnage
                </span>

                <input
                  type="date"
                  value={
                    addDiaryDate
                  }
                  onChange={(
                    event
                  ) =>
                    setAddDiaryDate(
                      event.target.value
                    )
                  }
                />

                </label>

              </>

            )}


            <form
              className="sectionMovieSearch"
              onSubmit={
                searchMoviesForSection
              }
            >

              <input
                ref={
                  addSearchInputRef
                }
                value={
                  addQuery
                }
                onChange={(
                  event
                ) => {
                  setAddQuery(
                    event.target.value
                  );

                  if (
                    addMessage
                  ) {
                    setAddMessage(
                      ''
                    );
                  }
                }}
                placeholder={
                  addTarget === 'series' ||
                  (addTarget === 'diary' && addDiaryMediaType === 'tv')
                    ? 'Titre, ID IMDb ou URL IMDb de la série...'
                    : 'Titre, ID IMDb ou URL IMDb du film...'
                }
              />

              <button
                type="submit"
                disabled={
                  addLoading
                }
              >
                {addLoading
                  ? 'Recherche...'
                  : 'Rechercher'}
              </button>

            </form>


            {(addSuggestionsLoading || addSuggestions.length > 0) && addQuery.trim() && (
              <div className="addSearchSuggestions">
                {addSuggestionsLoading && addSuggestions.length === 0 ? (
                  <span className="addSearchSuggestionLoading">Suggestions…</span>
                ) : (
                  addSuggestions.map((suggestion) => (
                    <button
                      key={`suggestion-${suggestion.id}`}
                      type="button"
                      className="addSearchSuggestion"
                      onClick={() => {
                        addSuggestionSelectedQueryRef.current =
                          suggestion.title;
                        setAddQuery(suggestion.title);
                        setAddSuggestions([]);
                        setAddSuggestionsLoading(false);
                        setAddResults([suggestion]);
                        setAddMessage('');
                        setAddLoading(false);
                      }}
                    >
                      <strong>{suggestion.title}</strong>
                      <span>
                        {suggestion.release_date
                          ? suggestion.release_date.substring(0, 4)
                          : '—'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}


            {addMessage && (

              <div
                className="movieMenuMessage"
              >
                {
                  addMessage
                }
              </div>

            )}


            <div
              className="sectionSearchResults"
            >

              {addResults.map(
                (
                  movie
                ) => {
                  const existing =
                    findExistingMovieForTmdb(
                      movie,
                      addTarget === 'series'
                        ? 'tv'
                        : addTarget === 'diary'
                        ? addDiaryMediaType
                        : 'movie'
                    );

                  const alreadyPresent =
                    Boolean(
                      existing &&
                      addTarget !==
                        'diary' &&
                      movieIsInSection(
                        existing,
                        addTarget as
                          Exclude<
                            AddTarget,
                            'diary'
                          >
                      )
                    );

                  return (
                    <article
                      className="sectionSearchResult"
                      key={
                        movie.id
                      }
                    >

                      <div className="sectionSearchActions sectionSearchActionsAbovePoster">
                        <button
                          type="button"
                          className="greenButton"
                          disabled={
                            alreadyPresent ||
                            addingToSection ===
                              movie.id
                          }
                          onClick={() =>
                            addTmdbMovieToSection(
                              movie
                            )
                          }
                        >
                          {alreadyPresent
                            ? 'Présent'
                            : addingToSection ===
                              movie.id
                            ? 'Ajout...'
                            : 'Ajouter'}
                        </button>
                      </div>

                      <div
                        className="sectionSearchPoster"
                      >

                        {movie.poster_path ? (

                          <img
                            src={`https://image.tmdb.org/t/p/w185${movie.poster_path}`}
                            alt={
                              movie.title
                            }
                            loading="lazy"
                          />

                        ) : (

                          <div
                            className="noPoster"
                          >
                            Pas d'affiche
                          </div>

                        )}

                      </div>


                      <div
                        className="sectionSearchInfo"
                      >

                        <strong>
                          {
                            movie.title
                          }
                        </strong>

                        <span>
                          {movie.release_date
                            ? movie.release_date.substring(
                                0,
                                4
                              )
                            : 'Année inconnue'}
                        </span>

                      </div>

                    </article>
                  );
                }
              )}

            </div>

          </div>

        </div>

      )}


      {selectedLpCoverAlbum && (
        <div
          className="posterModalBackdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeLpCoverPicker();
            }
          }}
        >
          <div
            className="posterModal soundtrackMusicModal lpCoverModal"
          >
            <div
              className="posterModalHeader lpCoverHeader"
            >
              <div>
                <span
                  className="posterModalEyebrow"
                >
                  Pochette LP
                </span>
                <h2>
                  {selectedLpCoverAlbum.title}
                </h2>
                <p>
                  {selectedLpCoverAlbum.artist}
                </p>
              </div>

              <button
                type="button"
                className="posterModalClose"
                onClick={closeLpCoverPicker}
              >
                ×
              </button>
            </div>

            <div className="lpCoverWorkspace">
              <button
                type="button"
                className="lpSelectedCoverPreview"
                onClick={handleLpCurrentCoverClick}
                onDoubleClick={handleLpCurrentCoverDoubleClick}
                title="1 clic : iTunes · 2 clics : Upload"
                aria-label="Pochette sélectionnée : un clic pour iTunes, double clic pour Upload"
              >
                {selectedLpCoverAlbum.artworkUrl ? (
                  <img
                    src={selectedLpCoverAlbum.artworkUrl}
                    alt={`${selectedLpCoverAlbum.title} — ${selectedLpCoverAlbum.artist}`}
                  />
                ) : (
                  <span className="noPoster lpBlankPoster">
                    Pochette
                  </span>
                )}
                <span className="lpSelectedCoverHint">
                  iTunes / Upload
                </span>
              </button>

              <div className="lpCoverWorkspaceMain">
                <form
                  className="soundtrackMusicSearchForm lpCoverSearchForm"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runLpCoverSearch(
                      selectedLpCoverAlbum,
                      lpCoverSearchQuery
                    );
                  }}
                >
                  <input
                    value={lpCoverSearchQuery}
                    onChange={(event) =>
                      setLpCoverSearchQuery(
                        event.target.value
                      )
                    }
                    placeholder={`Rechercher un album de ${selectedLpCoverAlbum.artist}...`}
                    aria-label={`Rechercher un album de ${selectedLpCoverAlbum.artist}`}
                  />

                  <button
                    type="submit"
                    className="secondaryButton"
                    disabled={lpCoverSearchLoading}
                  >
                    {lpCoverSearchLoading
                      ? '...'
                      : 'Rechercher'}
                  </button>

                  <button
                    type="button"
                    className="secondaryButton lpDiscographyButton"
                    disabled={lpCoverSearchLoading}
                    onClick={() => {
                      setLpCoverSearchQuery('');
                      void runLpCoverSearch(
                        selectedLpCoverAlbum,
                        ''
                      );
                    }}
                    title={`Afficher les albums de ${selectedLpCoverAlbum.artist}`}
                  >
                    Discographie
                  </button>
                </form>

                <div className="lpCoverExternalIdRow">
                  <input
                    value={lpCoverExternalIdInput}
                    onChange={(event) => {
                      setLpCoverExternalIdInput(event.target.value);
                      if (lpCoverMessage) {
                        setLpCoverMessage('');
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void addLpAlbumFromCoverExternalId('itunes');
                      }
                    }}
                    placeholder="ID / URL iTunes ou Musicboard"
                    aria-label="ID ou URL iTunes ou Musicboard de l’album à ajouter"
                  />

                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={
                      lpCoverExternalIdLoading !== null ||
                      !lpCoverExternalIdInput.trim()
                    }
                    onClick={() =>
                      void addLpAlbumFromCoverExternalId('itunes')
                    }
                  >
                    {lpCoverExternalIdLoading === 'itunes'
                      ? '...'
                      : 'iTunes'}
                  </button>

                  <button
                    type="button"
                    className="secondaryButton lpMusicboardIdButton"
                    disabled={
                      lpCoverExternalIdLoading !== null ||
                      !lpCoverExternalIdInput.trim()
                    }
                    onClick={() =>
                      void addLpAlbumFromCoverExternalId('musicboard')
                    }
                  >
                    {lpCoverExternalIdLoading === 'musicboard'
                      ? '...'
                      : 'Musicboard'}
                  </button>
                </div>

                <div
                  className="lpCoverToolbar"
                >
                  <div className="lpYearEditor">
                    <label>
                      <span>Année</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={lpCoverYear}
                        onChange={(event) =>
                          setLpCoverYear(
                            event.target.value
                              .replace(/\D/g, '')
                              .slice(0, 4)
                          )
                        }
                        placeholder="2026"
                        maxLength={4}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={savingLpYear}
                      onClick={saveSelectedLpYear}
                    >
                      {savingLpYear ? '...' : 'Sauver'}
                    </button>
                  </div>

                  <div className="lpYearEditor lpRatingEditor">
                    <label>
                      <span>Note</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={lpCoverRating}
                        onChange={(event) =>
                          setLpCoverRating(
                            sanitizeRatingDraft(
                              event.target.value
                            )
                          )
                        }
                        placeholder="0,00"
                        maxLength={4}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={savingLpRating}
                      onClick={saveSelectedLpRating}
                    >
                      {savingLpRating ? '...' : 'Sauver'}
                    </button>
                  </div>

                  <div
                    className="lpCoverToolbarActions"
                  >
                    <label
                      className={
                        uploadingLpCover
                          ? 'secondaryButton uploadPosterButton disabled'
                          : 'secondaryButton uploadPosterButton'
                      }
                    >
                      {uploadingLpCover
                        ? 'Envoi...'
                        : 'Upload'}

                      <input
                        ref={lpCoverUploadInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={uploadingLpCover || deletingLpAlbum}
                        onChange={uploadLpCover}
                      />
                    </label>

                    <button
                      type="button"
                      className="dangerButton lpDeleteAlbumButton"
                      disabled={
                        deletingLpAlbum ||
                        uploadingLpCover ||
                        savingLpCover != null
                      }
                      onClick={deleteSelectedLpAlbum}
                    >
                      {deletingLpAlbum
                        ? 'Suppression...'
                        : 'Supprimer l’album'}
                    </button>
                  </div>
                </div>

                <div className="lpCoverMiniHint">
                  Pochette = appliquer à l’album ouvert · <strong>+ LP</strong> = ajouter un autre album de {selectedLpCoverAlbum.artist} · ID / URL = ajout direct via iTunes ou Musicboard.
                </div>
              </div>
            </div>

            {lpCoverMessage && (
              <div
                className="movieMenuMessage lpCoverMessage"
              >
                {lpCoverMessage}
              </div>
            )}

            {lpCoverSearchLoading &&
              lpCoverSearchResults.length === 0 && (
                <div
                  className="posterModalStatus"
                >
                  Recherche des pochettes...
                </div>
              )}

            <div
              className="posterChoiceGrid lpCoverResults"
            >
              {lpCoverSearchResults.map(
                (candidate) => {
                  const cover =
                    upscaleItunesArtwork(
                      candidate.artworkUrl100
                    );

                  if (!cover) {
                    return null;
                  }

                  const isCurrent =
                    selectedLpCoverAlbum.artworkUrl ===
                    cover;

                  const alreadyPresent =
                    savedAlbums.some(
                      (saved) =>
                        (saved.itunesCollectionId != null &&
                          saved.itunesCollectionId === candidate.collectionId) ||
                        lpAlbumIdentityKey(
                          saved.title,
                          saved.artist
                        ) ===
                          lpAlbumIdentityKey(
                            candidate.collectionName,
                            candidate.artistName
                          )
                    );

                  return (
                    <article
                      className={
                        isCurrent
                          ? 'lpCoverChoice current'
                          : 'lpCoverChoice'
                      }
                      key={`${candidate.collectionId}_${cover}`}
                      title={`${candidate.collectionName} — ${candidate.artistName}`}
                    >
                      <button
                        type="button"
                        className="lpCoverChoiceCoverButton"
                        disabled={
                          savingLpCover === candidate.collectionId
                        }
                        onClick={() =>
                          chooseLpCover(
                            candidate
                          )
                        }
                        title={`Utiliser cette pochette pour ${selectedLpCoverAlbum.title}`}
                      >
                        <img
                          src={cover}
                          alt={candidate.collectionName}
                          loading="lazy"
                        />
                      </button>

                      <div
                        className="posterChoiceFooter lpCoverChoiceFooter"
                      >
                        <span
                          className="lpCoverChoiceIdentity"
                        >
                          <span
                            className="lpCoverChoiceAlbum"
                          >
                            {candidate.collectionName}
                          </span>
                          <span
                            className="lpCoverChoiceArtist"
                          >
                            {candidate.releaseDate
                              ? candidate.releaseDate.substring(0, 4)
                              : candidate.artistName}
                          </span>
                        </span>

                        <div className="lpCoverChoiceActions">
                          <button
                            type="button"
                            className="lpCoverChoiceAction"
                            disabled={
                              isCurrent ||
                              savingLpCover === candidate.collectionId
                            }
                            onClick={() =>
                              chooseLpCover(candidate)
                            }
                          >
                            {savingLpCover === candidate.collectionId
                              ? '...'
                              : isCurrent
                              ? '✓'
                              : 'Pochette'}
                          </button>

                          <button
                            type="button"
                            className="lpCoverChoiceAction lpCoverAddAlbumAction"
                            disabled={
                              alreadyPresent ||
                              addingLpAlbum !== null
                            }
                            onClick={() =>
                              void addItunesAlbumToLp(
                                candidate,
                                { keepCoverPickerOpen: true }
                              )
                            }
                            title={
                              alreadyPresent
                                ? 'Album déjà présent dans LP'
                                : 'Ajouter cet album à LP'
                            }
                          >
                            {alreadyPresent
                              ? 'LP ✓'
                              : addingLpAlbum === candidate.collectionId
                              ? '...'
                              : '+ LP'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          </div>
        </div>
      )}


      {lpAddOpen && (
        <div
          className="sectionAddBackdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeLpAdd();
            }
          }}
        >
          <div
            className="sectionAddModal"
          >
            <div
              className="sectionAddHeader"
            >
              <div>
                <span
                  className="movieMenuEyebrow"
                >
                  Ajouter un album
                </span>
                <h2>LP</h2>
              </div>

              <button
                type="button"
                className="movieMenuClose"
                onClick={closeLpAdd}
              >
                ×
              </button>
            </div>

            <form
              className="sectionMovieSearch"
              onSubmit={searchLpAlbums}
            >
              <input
                value={lpSearchQuery}
                onChange={(event) => {
                  setLpSearchQuery(
                    event.target.value
                  );
                  if (lpAddMessage) {
                    setLpAddMessage('');
                  }
                }}
                placeholder="Album ou artiste..."
                autoFocus
              />

              <button
                type="submit"
                disabled={lpSearchLoading}
              >
                {lpSearchLoading
                  ? 'Recherche...'
                  : 'Rechercher'}
              </button>
            </form>

            <div className="lpItunesIdBlock">
              <button
                type="button"
                className="lpItunesIdToggle"
                aria-expanded={lpItunesIdOpen}
                onClick={() => {
                  setLpItunesIdOpen((current) => !current);
                  setLpAddMessage('');
                }}
              >
                ID iTunes
              </button>

              {lpItunesIdOpen && (
                <div className="lpItunesIdRow">
                  <input
                    value={lpItunesIdInput}
                    onChange={(event) => {
                      setLpItunesIdInput(event.target.value);
                      if (lpAddMessage) {
                        setLpAddMessage('');
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void addLpAlbumByItunesId();
                      }
                    }}
                    placeholder="ID iTunes (ex. 1065975633)"
                    inputMode="numeric"
                    aria-label="ID iTunes de l’album"
                  />

                  <button
                    type="button"
                    className="greenButton"
                    disabled={
                      lpItunesIdLoading ||
                      !lpItunesIdInput.trim()
                    }
                    onClick={() =>
                      void addLpAlbumByItunesId()
                    }
                  >
                    {lpItunesIdLoading
                      ? 'Recherche…'
                      : 'Ajouter par ID'}
                  </button>
                </div>
              )}
            </div>

            {(lpSuggestionsLoading || lpSuggestions.length > 0) && lpSearchQuery.trim() && (
              <div className="addSearchSuggestions">
                {lpSuggestionsLoading && lpSuggestions.length === 0 ? (
                  <span className="addSearchSuggestionLoading">Suggestions…</span>
                ) : (
                  lpSuggestions.map((album) => (
                    <button
                      key={`lp-suggestion-${album.collectionId}`}
                      type="button"
                      className="addSearchSuggestion addSearchSuggestionAlbum"
                      onClick={() => {
                        setLpSearchQuery(album.collectionName);
                        setLpSuggestions([]);
                      }}
                    >
                      <strong>{album.collectionName}</strong>
                      <span>{album.artistName}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {lpAddMessage && (
              <div
                className="movieMenuMessage"
              >
                {lpAddMessage}
              </div>
            )}

            <div
              className="sectionSearchResults"
            >
              {lpSearchResults.map(
                (album) => {
                  const savedAlbum =
                    savedAlbums.find(
                      (saved) =>
                        (saved.itunesCollectionId != null &&
                          saved.itunesCollectionId === album.collectionId) ||
                        lpAlbumIdentityKey(saved.title, saved.artist) ===
                          lpAlbumIdentityKey(album.collectionName, album.artistName)
                    ) || null;
                  const alreadyPresent =
                    Boolean(savedAlbum);
                  const artwork =
                    upscaleItunesArtwork(
                      album.artworkUrl100
                    );

                  return (
                    <article
                      className="sectionSearchResult"
                      key={album.collectionId}
                    >
                      <div
                        className="sectionSearchPoster lpSearchPoster"
                      >
                        {artwork ? (
                          <img
                            src={artwork}
                            alt={album.collectionName}
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="noPoster lpBlankPoster"
                            aria-label="Pochette indisponible"
                          />
                        )}
                      </div>

                      <div
                        className="sectionSearchInfo"
                      >
                        <strong>
                          {album.collectionName}
                        </strong>
                        <span>
                          {album.artistName}
                          {album.releaseDate
                            ? ` · ${album.releaseDate.substring(0, 4)}`
                            : ''}
                        </span>
                      </div>

                      <div className="sectionSearchActions">
                        <button
                          type="button"
                          className="greenButton"
                          disabled={
                            alreadyPresent ||
                            addingLpAlbum ===
                              album.collectionId
                          }
                          onClick={() =>
                            addItunesAlbumToLp(
                              album
                            )
                          }
                        >
                          {alreadyPresent
                            ? 'Présent'
                            : addingLpAlbum ===
                              album.collectionId
                            ? 'Ajout...'
                            : 'Ajouter'}
                        </button>

                      </div>
                    </article>
                  );
                }
              )}
            </div>
          </div>
        </div>
      )}


      {selectedSoundtrackSearchMovie && (
        <div className="posterModalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSoundtrackSearch(); }}>
          <div className="posterModal soundtrackMusicModal">
            <div className="posterModalHeader">
              <div>
                <span className="posterModalEyebrow">Pochette de B.O. · iTunes</span>
                <h2>{getSoundtrackDisplayTitle(selectedSoundtrackSearchMovie)}</h2>
              </div>
              <button type="button" className="posterModalClose" onClick={closeSoundtrackSearch}>×</button>
            </div>
            <form className="soundtrackMusicSearchForm" onSubmit={(event) => { event.preventDefault(); void runSoundtrackSearch(selectedSoundtrackSearchMovie, soundtrackSearchQuery); }}>
              <input value={soundtrackSearchQuery} onChange={(event) => setSoundtrackSearchQuery(event.target.value)} placeholder="Film, ID/URL IMDb, B.O., compositeur..." />
              <button type="submit" className="secondaryButton" disabled={soundtrackSearchLoading}>{soundtrackSearchLoading ? '...' : 'Rechercher'}</button>
            </form>
            {soundtrackSearchMessage && <div className="movieMenuMessage">{soundtrackSearchMessage}</div>}
            <div className="soundtrackMusicResults">
              {soundtrackSearchResults.map((album) => {
                const cover = upscaleItunesArtwork(album.artworkUrl100);
                return (
                  <button type="button" className="soundtrackMusicResult" key={album.collectionId} onClick={() => chooseItunesSoundtrack(album)}>
                    {cover ? <img src={cover} alt={album.collectionName} loading="lazy" /> : <span className="noPoster">Pas de pochette</span>}
                    <strong>{album.collectionName}</strong>
                    <span>{album.artistName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}


      {selectedPosterMovie && (

        <div
          className="posterModalBackdrop"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closePosterPicker();
            }
          }}
        >

          <div
            className="posterModal"
          >

            <div
              className="posterModalHeader"
            >

              <div>

                <span
                  className="posterModalEyebrow"
                >
                  {posterPickerScope ===
                  'soundtrack'
                    ? 'Changer la pochette CD'
                    : "Changer l'affiche"}
                </span>

                <h2>
                  {posterPickerScope ===
                  'soundtrack'
                    ? getSoundtrackDisplayTitle(
                        selectedPosterMovie
                      )
                    : getMovieDisplayTitle(
                        selectedPosterMovie
                      )}
                </h2>

                <p>
                  {posterPickerScope ===
                  'soundtrack'
                    ? 'Choisis une image TMDb pour la pochette de cette B.O. uniquement.'
                    : 'Les affiches françaises sont affichées en priorité.'}
                </p>

              </div>


              <button
                type="button"
                className="posterModalClose"
                onClick={
                  closePosterPicker
                }
              >
                ×
              </button>

            </div>


            <div
              className="posterFilters"
            >

              <button
                className={
                  posterFilter ===
                  'fr'
                    ? 'posterFilter active'
                    : 'posterFilter'
                }
                onClick={() =>
                  setPosterFilter(
                    'fr'
                  )
                }
              >
                🇫🇷 Français ({posterCount('fr')})
              </button>


              <button
                className={
                  posterFilter ===
                  'none'
                    ? 'posterFilter active'
                    : 'posterFilter'
                }
                onClick={() =>
                  setPosterFilter(
                    'none'
                  )
                }
              >
                Sans texte ({posterCount('none')})
              </button>


              <button
                className={
                  posterFilter ===
                  'en'
                    ? 'posterFilter active'
                    : 'posterFilter'
                }
                onClick={() =>
                  setPosterFilter(
                    'en'
                  )
                }
              >
                🇬🇧 Anglais ({posterCount('en')})
              </button>


              <button
                className={
                  posterFilter ===
                  'other'
                    ? 'posterFilter active'
                    : 'posterFilter'
                }
                onClick={() =>
                  setPosterFilter(
                    'other'
                  )
                }
              >
                Autres ({posterCount('other')})
              </button>


              <button
                className={
                  posterFilter ===
                  'all'
                    ? 'posterFilter active'
                    : 'posterFilter'
                }
                onClick={() =>
                  setPosterFilter(
                    'all'
                  )
                }
              >
                Toutes ({posterCount('all')})
              </button>

            </div>


            {(
              posterPickerScope ===
              'soundtrack'
                ? Boolean(
                    selectedPosterMovie
                      .soundtrackCoverPath ||
                    selectedPosterMovie
                      .soundtrackCoverUrl
                  )
                : Boolean(
                    selectedPosterMovie
                      .customPosterPath ||
                    selectedPosterMovie
                      .customPosterUrl
                  )
            ) && (

              <div
                className="posterResetRow"
              >

                <button
                  className="resetPosterButton"
                  type="button"
                  onClick={
                    resetPosterChoice
                  }
                >
                  {posterPickerScope ===
                  'soundtrack'
                    ? 'Revenir à la pochette de départ'
                    : "Revenir à l'affiche automatique"}
                </button>

              </div>

            )}


            {posterLoading && (

              <div
                className="posterModalStatus"
              >
                Chargement des affiches TMDb...
              </div>

            )}


            {posterMessage && (

              <div
                className="posterModalStatus"
              >
                {
                  posterMessage
                }
              </div>

            )}


            {!posterLoading &&
              filteredPosterOptions
                .length ===
                0 &&
              !posterMessage && (

                <div
                  className="posterModalStatus"
                >
                  Aucune affiche dans cette catégorie.
                </div>

              )}


            <div
              className="posterChoiceGrid"
            >

              {filteredPosterOptions
                .map(
                  (
                    poster
                  ) => {

                    const currentPath =
                      posterPickerScope ===
                      'soundtrack'
                        ? (
                            selectedPosterMovie
                              .soundtrackCoverPath ||
                            selectedPosterMovie
                              .posterPath ||
                            null
                          )
                        : getMoviePosterPath(
                            selectedPosterMovie
                          );

                    const isCurrent =
                      currentPath ===
                      poster.file_path;

                    return (

                      <button
                        type="button"
                        className={
                          isCurrent
                            ? 'posterChoice current'
                            : 'posterChoice'
                        }
                        key={
                          poster.file_path
                        }
                        disabled={
                          savingPosterPath !==
                          null
                        }
                        onClick={() =>
                          choosePoster(
                            poster
                          )
                        }
                      >

                        <img
                          src={`https://image.tmdb.org/t/p/w342${poster.file_path}`}
                          alt=""
                          loading="lazy"
                        />


                        <span
                          className="posterChoiceFooter"
                        >

                          <span>

                            {poster.iso_639_1 ===
                              'fr' &&
                              '🇫🇷 FR'}

                            {poster.iso_639_1 ===
                              'en' &&
                              '🇬🇧 EN'}

                            {poster.iso_639_1 ===
                              null &&
                              'Sans texte'}

                            {poster.iso_639_1 !==
                              null &&
                              poster.iso_639_1 !==
                                'fr' &&
                              poster.iso_639_1 !==
                                'en' &&
                              poster.iso_639_1
                                .toUpperCase()}

                          </span>


                          <strong>

                            {savingPosterPath ===
                            poster.file_path
                              ? 'Enregistrement...'
                              : isCurrent
                              ? '✓ Actuelle'
                              : 'Choisir'}

                          </strong>

                        </span>

                      </button>

                    );
                  }
                )}

            </div>

          </div>

        </div>

      )}


      {selectedTitleMovie && (

        <div
          className="titleModalBackdrop"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeTitlePicker();
            }
          }}
        >

          <div
            className="titleModal"
          >

            <div
              className="titleModalHeader"
            >

              <div>

                <span
                  className="titleModalEyebrow"
                >
                  Changer le titre
                </span>

                <h2>
                  {
                    getMovieDisplayTitle(
                      selectedTitleMovie
                    )
                  }
                </h2>

                <p>
                  Choisis le titre affiché dans Merlymoviesbox.
                </p>

              </div>


              <button
                type="button"
                className="titleModalClose"
                onClick={
                  closeTitlePicker
                }
              >
                ×
              </button>

            </div>


            <div
              className="titleFilters"
            >

              <button
                className={
                  titleFilter ===
                  'fr'
                    ? 'titleFilter active'
                    : 'titleFilter'
                }
                onClick={() =>
                  setTitleFilter(
                    'fr'
                  )
                }
              >
                🇫🇷 Français ({titleCount('fr')})
              </button>


              <button
                className={
                  titleFilter ===
                  'en'
                    ? 'titleFilter active'
                    : 'titleFilter'
                }
                onClick={() =>
                  setTitleFilter(
                    'en'
                  )
                }
              >
                🇬🇧 Anglais ({titleCount('en')})
              </button>


              <button
                className={
                  titleFilter ===
                  'original'
                    ? 'titleFilter active'
                    : 'titleFilter'
                }
                onClick={() =>
                  setTitleFilter(
                    'original'
                  )
                }
              >
                🎬 Original ({titleCount('original')})
              </button>


              <button
                className={
                  titleFilter ===
                  'other'
                    ? 'titleFilter active'
                    : 'titleFilter'
                }
                onClick={() =>
                  setTitleFilter(
                    'other'
                  )
                }
              >
                Autres ({titleCount('other')})
              </button>


              <button
                className={
                  titleFilter ===
                  'all'
                    ? 'titleFilter active'
                    : 'titleFilter'
                }
                onClick={() =>
                  setTitleFilter(
                    'all'
                  )
                }
              >
                Tous ({titleCount('all')})
              </button>

            </div>


            {selectedTitleMovie
              .customTitle && (

              <div
                className="titleResetRow"
              >

                <button
                  className="resetTitleButton"
                  type="button"
                  onClick={
                    resetTitleChoice
                  }
                >
                  Revenir au titre français automatique
                </button>

              </div>

            )}


            {titleLoading && (

              <div
                className="titleModalStatus"
              >
                Chargement des titres TMDb...
              </div>

            )}


            {titleMessage && (

              <div
                className="titleModalStatus"
              >
                {
                  titleMessage
                }
              </div>

            )}


            {!titleLoading &&
              filteredTitleOptions
                .length ===
                0 &&
              !titleMessage && (

                <div
                  className="titleModalStatus"
                >
                  Aucun titre dans cette catégorie.
                </div>

              )}


            <div
              className="titleChoiceList"
            >

              {filteredTitleOptions
                .map(
                  (
                    option,
                    index
                  ) => {

                    const currentTitle =
                      getMovieDisplayTitle(
                        selectedTitleMovie
                      );

                    const isCurrent =
                      currentTitle ===
                      option.title;

                    return (

                      <button
                        type="button"
                        className={
                          isCurrent
                            ? 'titleChoice current'
                            : 'titleChoice'
                        }
                        key={`${option.title}_${index}`}
                        disabled={
                          savingTitleValue !==
                          null
                        }
                        onClick={() =>
                          chooseTitle(
                            option
                          )
                        }
                      >

                        <span
                          className="titleChoiceMain"
                        >

                          <strong>
                            {
                              option.title
                            }
                          </strong>

                          <span
                            className="titleChoiceMeta"
                          >

                            {option.language ===
                              'fr' &&
                              '🇫🇷 '}

                            {option.language ===
                              'en' &&
                              '🇬🇧 '}

                            {
                              option.label
                            }

                            {option.country &&
                              ` · ${option.country}`}

                          </span>

                        </span>


                        <span
                          className="titleChoiceAction"
                        >

                          {savingTitleValue ===
                          option.title
                            ? 'Enregistrement...'
                            : isCurrent
                            ? '✓ Actuel'
                            : 'Choisir'}

                        </span>

                      </button>

                    );
                  }
                )}

            </div>

          </div>

        </div>

      )}

      {user && (
        <>
          {historyOpen && (
            <aside
              className="historyPanel"
              aria-label="Corbeille et annulation des actions"
            >
              <div
                className="historyPanelHeader"
              >
                <div>
                  <strong>
                    Corbeille / Annuler
                  </strong>
                  <span>
                    20 dernières actions · restaurables pendant 7 jours
                  </span>
                </div>

                <button
                  type="button"
                  className="historyCloseButton"
                  onClick={() =>
                    setHistoryOpen(
                      false
                    )
                  }
                  aria-label="Fermer la corbeille / annuler"
                >
                  ×
                </button>
              </div>

              {actionHistory.length ===
                0 ? (
                <div
                  className="historyEmpty"
                >
                  Aucune action à annuler sur les 7 derniers jours.
                </div>
              ) : (
                <>
                  <div
                    className="historyEntries"
                  >
                    {actionHistory.map(
                      (entry) => {
                        const selected =
                          selectedHistoryIds.includes(
                            entry.id
                          );

                        return (
                          <div
                            className={
                              selected
                                ? 'historyEntry selected'
                                : 'historyEntry'
                            }
                            key={
                              entry.id
                            }
                          >
                            <div
                              className="historyEntryText"
                            >
                              <strong>
                                {entry.label}
                              </strong>
                              <span>
                                {formatHistoryTime(
                                  entry.createdAt
                                )}
                              </span>
                            </div>

                            <button
                              type="button"
                              className={
                                selected
                                  ? 'historyUndoButton selected'
                                  : 'historyUndoButton'
                              }
                              disabled={
                                undoingHistoryId !==
                                null
                              }
                              onClick={() =>
                                toggleHistorySelection(
                                  entry
                                )
                              }
                              aria-pressed={selected}
                            >
                              {selected
                                ? '✓ Sélectionné'
                                : 'Annuler'}
                            </button>
                          </div>
                        );
                      }
                    )}
                  </div>

                  <div className="historyPanelActions">
                    <button
                      type="button"
                      className="historyUndoSelectionButton"
                      disabled={
                        undoingHistoryId !== null ||
                        selectedHistoryIds.length === 0
                      }
                      onClick={() =>
                        void undoSelectedHistoryEntries()
                      }
                    >
                      {undoingHistoryId === '__history_selection__'
                        ? 'Annulation…'
                        : `Annuler la sélection${selectedHistoryIds.length > 0 ? ` (${selectedHistoryIds.length})` : ''}`}
                    </button>

                    <button
                      type="button"
                      className="historyClearButton"
                      disabled={
                        undoingHistoryId !==
                        null
                      }
                      onClick={() => {
                        setActionHistory([]);
                        setSelectedHistoryIds([]);
                      }}
                    >
                      Vider la corbeille
                    </button>
                  </div>
                </>
              )}
            </aside>
          )}
        </>
      )}

    </div>
  );
}


export default App;
