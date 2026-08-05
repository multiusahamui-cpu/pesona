// Aturan batas modul dipasang di sini. Jangan dilonggarkan tanpa ADR baru.
import { base } from '@pesona/config/eslint-base';
import { moduleBoundaries } from '@pesona/config/eslint-boundaries';

export default [...base, ...moduleBoundaries];
