/**
 * Dependency-free internationalization (i18n) system and bilingual dictionary (`id` and `en`)
 * for `@kujam/*` (BOARD-1909).
 */

/**
 * UI locales supported by the package.
 *
 * @public
 */
export type BoardLocale = 'id' | 'en';

/**
 * Supported locale identifiers.
 *
 * @public
 */
export const SUPPORTED_LOCALES: readonly BoardLocale[] = Object.freeze(['id', 'en']);

/**
 * Key-value map of translation strings for a single locale.
 *
 * @public
 */
export type LocaleMessages = Readonly<Record<string, string>>;

/**
 * Partial or complete map of locale dictionaries (`{ id?: ..., en?: ... }`).
 *
 * @public
 */
export type BoardMessages = Readonly<Partial<Record<BoardLocale, LocaleMessages>>>;

/**
 * Parameters interpolated into `{placeholder}` tokens inside translation templates.
 *
 * @public
 */
export type TranslationParams = Readonly<Record<string, string | number>>;

const RAW_DICTIONARY = {
  // Main toolbar & tools
  toolbar: { id: 'Alat', en: 'Tools' },
  moreOptions: { id: 'Pilihan lain', en: 'More options' },
  'tool.select': { id: 'Pilih', en: 'Select' },
  'tool.hand': { id: 'Tangan', en: 'Hand' },
  'tool.sticky': { id: 'Sticky', en: 'Sticky' },
  'tool.draw': { id: 'Pena', en: 'Pen' },
  'tool.shape': { id: 'Bentuk', en: 'Shape' },
  'tool.rectangle': { id: 'Kotak', en: 'Rectangle' },
  'tool.ellipse': { id: 'Elips', en: 'Ellipse' },
  'tool.triangle-down': { id: 'Segitiga terbalik', en: 'Inverted triangle' },
  'tool.pill': { id: 'Pil', en: 'Pill' },
  'tool.diamond': { id: 'Belah ketupat', en: 'Diamond' },
  'tool.triangle': { id: 'Segitiga', en: 'Triangle' },
  'tool.star': { id: 'Bintang', en: 'Star' },
  'tool.cloud': { id: 'Awan', en: 'Cloud' },
  'tool.arrow-right': { id: 'Panah kanan', en: 'Right arrow' },
  'tool.arrow-left': { id: 'Panah kiri', en: 'Left arrow' },
  'tool.connector': { id: 'Konektor', en: 'Connector' },
  'tool.text': { id: 'Teks', en: 'Text' },
  'tool.eraser': { id: 'Penghapus', en: 'Eraser' },
  'tool.frame': { id: 'Frame', en: 'Frame' },

  // Brushes & colors
  'style.color': { id: 'Warna', en: 'Color' },
  'style.brush': { id: 'Kuas', en: 'Brush' },
  'brush.pen': { id: 'Pena', en: 'Pen' },
  'brush.highlighter': { id: 'Stabilo', en: 'Highlighter' },
  'color.black': { id: 'Hitam', en: 'Black' },
  'color.grey': { id: 'Abu-abu', en: 'Grey' },
  'color.gray': { id: 'Abu-abu', en: 'Gray' },
  'color.white': { id: 'Putih', en: 'White' },
  'color.red': { id: 'Merah', en: 'Red' },
  'color.orange': { id: 'Oranye', en: 'Orange' },
  'color.yellow': { id: 'Kuning', en: 'Yellow' },
  'color.green': { id: 'Hijau', en: 'Green' },
  'color.blue': { id: 'Biru', en: 'Blue' },
  'color.violet': { id: 'Violet', en: 'Violet' },
  'color.purple': { id: 'Ungu', en: 'Purple' },
  'color.pink': { id: 'Merah muda', en: 'Pink' },

  // Zoom & history controls
  zoom: { id: 'Zoom', en: 'Zoom' },
  zoomIn: { id: 'Perbesar', en: 'Zoom in' },
  zoomOut: { id: 'Perkecil', en: 'Zoom out' },
  zoomOptions: { id: 'Pilihan zoom', en: 'Zoom options' },
  zoomLevel: { id: 'Zoom {percent}', en: 'Zoom {percent}' },
  zoomToFit: { id: 'Pas ke layar', en: 'Zoom to fit' },
  history: { id: 'Riwayat', en: 'History' },
  undo: { id: 'Urungkan', en: 'Undo' },
  redo: { id: 'Ulangi', en: 'Redo' },

  // Selection toolbar & element actions
  selectionToolbar: { id: 'Aksi elemen', en: 'Element actions' },
  group: { id: 'Grup', en: 'Group' },
  ungroup: { id: 'Lepas grup', en: 'Ungroup' },
  'frame.clip': { id: 'Potong konten frame', en: 'Clip frame content' },
  lock: { id: 'Kunci', en: 'Lock' },
  unlock: { id: 'Buka kunci', en: 'Unlock' },
  delete: { id: 'Hapus', en: 'Delete' },
  duplicate: { id: 'Duplikat', en: 'Duplicate' },
  layer: { id: 'Lapisan', en: 'Layer' },
  'layer.bringForward': { id: 'Bawa maju', en: 'Bring forward' },
  'layer.sendBackward': { id: 'Kirim mundur', en: 'Send backward' },
  'layer.bringToFront': { id: 'Bawa ke paling depan', en: 'Bring to front' },
  'layer.sendToBack': { id: 'Kirim ke paling belakang', en: 'Send to back' },

  // Style panel & contextual controls
  'style.fillColor': { id: 'Warna isian', en: 'Fill color' },
  'style.fill': { id: 'Isian', en: 'Fill' },
  'style.thickness': { id: 'Ketebalan', en: 'Thickness' },
  'style.dash': { id: 'Gaya garis', en: 'Line style' },
  'style.size': { id: 'Ukuran font', en: 'Font size' },
  'style.align': { id: 'Perataan', en: 'Alignment' },
  'style.connectorStyle': { id: 'Gaya konektor', en: 'Connector style' },
  'style.connectorStyle.straight': { id: 'Lurus', en: 'Straight' },
  'style.connectorStyle.elbow': { id: 'Siku', en: 'Elbow' },
  'style.connectorStyle.curved': { id: 'Lengkung', en: 'Curved' },
  'style.startArrow': { id: 'Panah awal', en: 'Start arrow' },
  'style.endArrow': { id: 'Panah akhir', en: 'End arrow' },
  'style.arrow.none': { id: 'Tanpa panah', en: 'None' },
  'style.arrow.arrow': { id: 'Panah', en: 'Arrow' },
  'style.arrow.triangle': { id: 'Segitiga', en: 'Triangle' },
  'style.arrow.dot': { id: 'Titik', en: 'Dot' },
  'style.arrow.diamond': { id: 'Belah ketupat', en: 'Diamond' },
  'style.fill.none': { id: 'Tanpa isian', en: 'None' },
  'style.fill.semi': { id: 'Transparan', en: 'Semi' },
  'style.fill.solid': { id: 'Penuh', en: 'Solid' },
  'style.dash.solid': { id: 'Penuh', en: 'Solid' },
  'style.dash.dashed': { id: 'Putus-putus', en: 'Dashed' },
  'style.dash.dotted': { id: 'Titik-titik', en: 'Dotted' },
  'style.align.start': { id: 'Awal', en: 'Start' },
  'style.align.center': { id: 'Tengah', en: 'Center' },
  'style.align.end': { id: 'Akhir', en: 'End' },
  'size.s': { id: 'Kecil', en: 'Small' },
  'size.m': { id: 'Sedang', en: 'Medium' },
  'size.l': { id: 'Besar', en: 'Large' },
  'size.xl': { id: 'Sangat besar', en: 'Extra large' },

  // Accessibility tree & announcements (BOARD-1901, BOARD-1909)
  'a11y.board': { id: 'Papan tulis', en: 'Whiteboard' },
  'a11y.roleDescription': { id: 'papan tulis', en: 'whiteboard' },
  'a11y.list': { id: 'Elemen papan', en: 'Board elements' },
  'a11y.help': {
    id:
      'Tab dan Shift+Tab berpindah antar elemen. Panah memindahkan elemen terpilih, ' +
      'Shift+panah sejauh 10 piksel. Enter mengedit. Esc keluar dari elemen; ' +
      'tekan Esc lalu Tab untuk keluar dari papan.',
    en:
      'Tab and Shift+Tab move between elements. Arrow keys move the selected element, ' +
      'Shift+arrow by 10 pixels. Enter edits. Esc leaves the element; ' +
      'press Esc, then Tab to leave the board.',
  },
  'a11y.element': { id: 'Elemen {type}', en: '{type} element' },
  'a11y.locked': { id: 'Terkunci', en: 'Locked' },
  'a11y.elementCreated': { id: '{label} dibuat', en: 'Created {label}' },
  'a11y.elementsCreated': { id: '{count} elemen dibuat', en: 'Created {count} elements' },
  'a11y.elementDeletedOne': { id: '{label} dihapus', en: 'Deleted {label}' },
  'a11y.elementDeleted': { id: '{count} elemen dihapus', en: 'Deleted {count} element(s)' },
  'a11y.selectionCount': { id: '{count} elemen dipilih', en: '{count} element(s) selected' },
  'a11y.selectionCleared': { id: 'Seleksi dikosongkan', en: 'Selection cleared' },
  'a11y.peerJoined': { id: '{names} bergabung', en: '{names} joined' },
  'a11y.peersJoined': { id: '{count} orang bergabung', en: '{count} people joined' },
  'a11y.peerLeft': { id: '{names} keluar', en: '{names} left' },
  'a11y.peersLeft': { id: '{count} orang keluar', en: '{count} people left' },
  'a11y.someone': { id: 'Seseorang', en: 'Someone' },
  'a11y.connectionLost': { id: 'Koneksi terputus', en: 'Connection lost' },
  'a11y.connectionRestored': { id: 'Tersambung kembali', en: 'Reconnected' },
  'a11y.connectionError': { id: 'Gagal tersambung', en: 'Connection failed' },

  // Built-in element kinds
  'element.sticky': { id: 'Sticky {color}', en: '{color} sticky' },
  'element.draw': { id: 'Coretan', en: 'Drawing' },
  'element.text': { id: 'Teks', en: 'Text' },
  'element.connector': { id: 'Garis penghubung', en: 'Connector' },
  'element.geo.rectangle': { id: 'Persegi panjang', en: 'Rectangle' },
  'element.geo.ellipse': { id: 'Elips', en: 'Ellipse' },
  'element.geo.diamond': { id: 'Belah ketupat', en: 'Diamond' },
  'element.geo.triangle': { id: 'Segitiga', en: 'Triangle' },
  'element.geo.star': { id: 'Bintang', en: 'Star' },
  'element.geo.cloud': { id: 'Awan', en: 'Cloud' },
  'element.geo.arrow-right': { id: 'Panah kanan', en: 'Right arrow' },
  'element.geo.arrow-left': { id: 'Panah kiri', en: 'Left arrow' },
  'element.group': { id: 'Grup', en: 'Group' },
  'element.frame': { id: 'Frame', en: 'Frame' },
  'element.image': { id: 'Gambar', en: 'Image' },
  'image.alt': { id: 'Teks alternatif', en: 'Alt text' },
  'image.crop': { id: 'Potong gambar', en: 'Crop image' },
  'image.resetCrop': { id: 'Reset potongan', en: 'Reset crop' },
  'image.retry': { id: 'Coba lagi unggah', en: 'Retry upload' },
  'image.uploading': { id: 'Mengunggah...', en: 'Uploading...' },
  'image.uploadFailed': { id: 'Gagal mengunggah', en: 'Upload failed' },

  // Commands
  'command.element.group': { id: 'Grup', en: 'Group' },
  'command.element.ungroup': { id: 'Lepas grup', en: 'Ungroup' },
  'command.align.left': { id: 'Rata kiri', en: 'Align left' },
  'command.align.right': { id: 'Rata kanan', en: 'Align right' },
  'command.align.top': { id: 'Rata atas', en: 'Align top' },
  'command.align.bottom': { id: 'Rata bawah', en: 'Align bottom' },
  'command.align.center-h': { id: 'Rata tengah horizontal', en: 'Align center horizontally' },
  'command.align.center-v': { id: 'Rata tengah vertikal', en: 'Align center vertically' },
  'command.distribute.horizontal': { id: 'Sebar horizontal', en: 'Distribute horizontally' },
  'command.distribute.vertical': { id: 'Sebar vertikal', en: 'Distribute vertically' },
  'command.arrange.grid': { id: 'Susun grid', en: 'Arrange in grid' },
  'command.arrange.row': { id: 'Susun baris', en: 'Arrange in row' },

  // Collaboration & Sync status (BOARD-1407, BOARD-1509)
  'sync.status.offline': { id: 'Offline', en: 'Offline' },
  'sync.status.connecting': { id: 'Menyambungkan...', en: 'Connecting...' },
  'sync.status.synced': { id: 'Tersinkron', en: 'Synced' },
  'sync.status.error': { id: 'Gagal tersambung', en: 'Connection error' },
  'sync.status.authFailed': { id: 'Autentikasi gagal', en: 'Authentication failed' },
  'presence.following': { id: 'Mengikuti {name}', en: 'Following {name}' },
  'presence.stopFollowing': { id: 'Berhenti mengikuti', en: 'Stop following' },
} as const satisfies Record<string, { readonly id: string; readonly en: string }>;

function buildDefaultMessages(): Readonly<Record<BoardLocale, LocaleMessages>> {
  const idMap: Record<string, string> = {};
  const enMap: Record<string, string> = {};
  for (const [key, entry] of Object.entries(RAW_DICTIONARY)) {
    idMap[key] = entry.id;
    enMap[key] = entry.en;
  }
  return Object.freeze({
    id: Object.freeze(idMap),
    en: Object.freeze(enMap),
  });
}

/**
 * Complete built-in Indonesian (`id`) and English (`en`) dictionaries (BOARD-1909).
 *
 * @public
 */
export const DEFAULT_MESSAGES: Readonly<Record<BoardLocale, LocaleMessages>> =
  buildDefaultMessages();

/**
 * Interpolates `{placeholder}` tokens in `template` using values from `params`.
 * Unmatched tokens are left untouched.
 *
 * @public
 */
export function interpolateMessage(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) && params[name] !== undefined ? String(params[name]) : match,
  );
}

/**
 * Normalizes a locale string to `'id'` or `'en'` (any `en*` variant resolves to `'en'`,
 * everything else defaults to `'id'`).
 *
 * @public
 */
export function normalizeLocale(locale?: string): BoardLocale {
  if (typeof locale === 'string' && locale.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return 'id';
}

/**
 * Translates `key` for `locale` with optional `params` and custom `messages` override,
 * falling back to `'id'` and then `key` itself.
 *
 * @public
 */
export function translate(
  key: string,
  locale: string = 'id',
  params?: TranslationParams,
  messages?: BoardMessages,
): string {
  const norm = normalizeLocale(locale);
  const template =
    messages?.[norm]?.[key] ??
    DEFAULT_MESSAGES[norm][key] ??
    messages?.id?.[key] ??
    DEFAULT_MESSAGES.id[key] ??
    key;
  return interpolateMessage(template, params);
}

/**
 * Validates a `BoardMessages` object (for `definePlugin` or `createBoard`), returning
 * an array of validation error descriptions.
 *
 * @internal
 */
export function checkMessagesMap(messages: unknown, prefix = 'messages'): string[] {
  if (typeof messages !== 'object' || messages === null || Array.isArray(messages)) {
    return [`${prefix} wajib berupa objek { id?: Record<string, string>, en?: Record<string, string> }.`];
  }
  const errors: string[] = [];
  for (const [locale, dict] of Object.entries(messages as Record<string, unknown>)) {
    if (locale !== 'id' && locale !== 'en') {
      errors.push(`${prefix}["${locale}"]: bahasa tidak didukung (gunakan "id" atau "en").`);
      continue;
    }
    if (typeof dict !== 'object' || dict === null || Array.isArray(dict)) {
      errors.push(`${prefix}.${locale} wajib berupa objek peta string.`);
      continue;
    }
    for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        errors.push(`${prefix}.${locale}["${k}"] wajib berupa string.`);
      }
    }
  }
  return errors;
}

/**
 * Runtime i18n controller attached to a `Board` (`board.i18n`, BOARD-1909).
 *
 * @public
 */
export interface BoardI18n {
  /** Active board locale (`'id'` or `'en'`). */
  readonly locale: BoardLocale;
  /** Changes the active board locale. */
  setLocale(locale: BoardLocale): void;
  /**
   * Translates `key` in the active board locale and interpolates `{param}` tokens from `params`.
   * Lookup order: user messages -> plugin messages -> built-in `DEFAULT_MESSAGES` -> `'id'` fallback -> `key`.
   */
  t(key: string, params?: TranslationParams): string;
  /**
   * Checks whether `key` is defined in the dictionary for `locale` (or any fallback dictionary when
   * `locale` is omitted).
   */
  has(key: string, locale?: BoardLocale): boolean;
  /** Merges additional user-level translation strings into the board dictionary. */
  addMessages(messages: BoardMessages): void;
  /** Merges additional user-level translation strings for one locale into the board dictionary. */
  addMessages(locale: BoardLocale, messages: LocaleMessages): void;
  /** Returns a frozen merged dictionary snapshot for `locale` (defaults to active locale). */
  getMessages(locale?: BoardLocale): LocaleMessages;
}

/** @internal */
export interface I18nRuntime {
  readonly api: BoardI18n;
  addPluginMessages(messages: BoardMessages): void;
}

/**
 * Creates the per-board i18n runtime (BOARD-1909).
 *
 * @internal
 */
export function createI18nRuntime(
  initialLocale: BoardLocale = 'id',
  initialUserMessages?: BoardMessages,
  onLocaleChange?: (locale: BoardLocale) => void,
): I18nRuntime {
  let currentLocale: BoardLocale = initialLocale;
  const pluginDict: Record<BoardLocale, Record<string, string>> = { id: {}, en: {} };
  const userDict: Record<BoardLocale, Record<string, string>> = { id: {}, en: {} };

  function mergeInto(
    target: Record<BoardLocale, Record<string, string>>,
    source: BoardMessages | undefined,
  ): void {
    if (!source) return;
    const issues = checkMessagesMap(source, 'messages');
    if (issues.length > 0) {
      throw new TypeError(`Opsi messages tidak valid: ${issues.join(' ')}`);
    }
    for (const loc of SUPPORTED_LOCALES) {
      const entries = source[loc];
      if (entries) {
        Object.assign(target[loc], entries);
      }
    }
  }

  mergeInto(userDict, initialUserMessages);

  function resolveTemplate(key: string, loc: BoardLocale): string | undefined {
    return (
      userDict[loc][key] ??
      pluginDict[loc][key] ??
      DEFAULT_MESSAGES[loc][key] ??
      userDict.id[key] ??
      pluginDict.id[key] ??
      DEFAULT_MESSAGES.id[key]
    );
  }

  const api: BoardI18n = Object.freeze({
    get locale() {
      return currentLocale;
    },
    setLocale(next: BoardLocale): void {
      if (next !== 'id' && next !== 'en') {
        throw new TypeError('Opsi locale wajib berupa "id" atau "en".');
      }
      if (next === currentLocale) return;
      currentLocale = next;
      onLocaleChange?.(currentLocale);
    },
    t(key: string, params?: TranslationParams): string {
      const template = resolveTemplate(key, currentLocale) ?? key;
      return interpolateMessage(template, params);
    },
    has(key: string, locale?: BoardLocale): boolean {
      if (locale !== undefined) {
        const loc = normalizeLocale(locale);
        return (
          Object.hasOwn(userDict[loc], key) ||
          Object.hasOwn(pluginDict[loc], key) ||
          Object.hasOwn(DEFAULT_MESSAGES[loc], key)
        );
      }
      return resolveTemplate(key, currentLocale) !== undefined;
    },
    addMessages(
      localeOrMessages: BoardLocale | BoardMessages,
      maybeMessages?: LocaleMessages,
    ): void {
      if (typeof localeOrMessages === 'string') {
        mergeInto(userDict, { [localeOrMessages]: maybeMessages } as BoardMessages);
        return;
      }
      mergeInto(userDict, localeOrMessages);
    },
    getMessages(locale: BoardLocale = currentLocale): LocaleMessages {
      const loc = normalizeLocale(locale);
      return Object.freeze({
        ...DEFAULT_MESSAGES[loc],
        ...pluginDict[loc],
        ...userDict[loc],
      });
    },
  });

  return {
    api,
    addPluginMessages(messages: BoardMessages): void {
      mergeInto(pluginDict, messages);
    },
  };
}
