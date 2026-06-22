// ── LANGUAGE SELECTOR ────────────────────────────────────────────────────────
// Selects language config based on the HTML element's lang attribute.
// hogwarts-espanol.html sets lang="es", hogwarts-english.html sets lang="en".
import es from './lang/es.js';
import en from './lang/en.js';
export default document.documentElement.lang === 'en' ? en : es;
