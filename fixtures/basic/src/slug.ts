/** The longest slug `slugify` returns, in characters. */
export const MAX_SLUG_LENGTH = 60;

/** Loads the title stored for a slug, or `undefined` when there is none. */
export type TitleLoader = (slug: string) => Promise<string | undefined>;

/**
 * Turns a title into a URL slug.
 *
 * @remarks
 * Accents are stripped, runs of other characters become one hyphen and the result is cut
 * at `MAX_SLUG_LENGTH`. An empty title answers an empty slug, not an error.
 *
 * @param title - The title as an editor typed it.
 *
 * @example
 * ```ts
 * slugify('Hello, World!') // 'hello-world'
 * ```
 */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
}

/**
 * Finds the title stored for a slug.
 *
 * @param load - Reads one title from wherever titles are kept.
 * @param slug - The slug to look up.
 * @returns The title, or `null` when the slug is unknown.
 * @throws `Error` when `load` fails, with the original error as its `cause`.
 */
export async function findTitle(load: TitleLoader, slug: string): Promise<string | null> {
  try {
    return (await load(slug)) ?? null;
  } catch (error) {
    throw new Error(`title lookup failed for "${slug}"`, { cause: error });
  }
}
